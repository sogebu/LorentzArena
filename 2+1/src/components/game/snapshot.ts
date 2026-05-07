import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
  type PhaseSpace,
  type Quaternion,
  quatIdentity,
  type Vector4,
  vector4Zero,
} from "../../physics";
import {
  selectDeadPlayerIds,
  selectIsDead,
  useGameStore,
} from "../../stores/game-store";
import {
  ENERGY_MAX,
  LONG_GAP_RESYNC_THRESHOLD_MS,
  MAX_WORLDLINE_HISTORY,
  SPAWN_RANGE,
} from "./constants";
import { isLighthouse } from "./lighthouse";
import { computeSpawnCoordTime } from "./respawnTime";
import type {
  KillEventRecord,
  RelativisticPlayer,
  RespawnEventRecord,
} from "./types";

/**
 * Authority 解体 Stage F / Stage 1.5: 周期 reconciliation または新規 join 送信用の
 * state 一式を組み立てる。
 *
 * Callers:
 *   - beacon holder (= host) が `peerManager.sendTo(newPeerId, buildSnapshot(myId, true))`
 *     で新 joiner に送る (Stage F)。
 *   - 全 peer が 5s 周期で `peerManager.send(buildSnapshot(myId, isBH))` を送る
 *     (Stage 1 + 1.5)。BH 以外は `isBeaconHolder=false` で呼ぶこと。
 *
 * `isBeaconHolder=true` のとき LH ownerId を caller (= myId) に強制 rewrite する
 * (migration 直後の 1-tick 窓で assumeHostRole の setPlayers コミットが snapshot
 * 発行より遅れても、新 joiner が古い死んだ host を LH owner と見る split を防ぐ)。
 *
 * `isBeaconHolder=false` (Stage 1.5 の client 送信) のとき LH ownerId は preserve。
 * クライアントが LH 所有権を主張すべきでなく、主張するとフェイクを BH が merge して
 * BH 自身の lh.ownerId が汚染され BH の LH AI 沈黙という catastrophic bug になる。
 */
export const buildSnapshot = (myId: string, isBeaconHolder: boolean) => {
  const s = useGameStore.getState();
  // 新 joiner のスポーン時刻 = 全 peer の virtualPos.t の min と max の中間。 Stage 7
  // 以降は alive / stale / dead を `virtualPos` で統一処理 (= 詳細: respawnTime.ts の
  // computeSpawnCoordTime docstring)。 ここから lastUpdateTimes は取れない (= zustand
  // store に持っていない、 useStaleDetection 内 ref 専有) ため `undefined` を渡す
  // (= τ=0 fallback、 alive peer は phaseSpace.pos.t そのまま、 dead は killLog から
  // lastSyncForDead で extrapolate される)。
  //
  // **stale pre-filter**: snapshot 側では stale peer を hostTime 算出から除外する。
  // 理由: 新 joiner spawn の安全弁として、 broadcast 停止済 peer の (= 古くなって信頼でき
  // ない) pos.t に新 joiner が引っ張られる事故を防ぐ。 Stage 5 の Rule B convergence
  // でも事後的に収束するが、 buildSnapshot 時点での pull を未然に防ぐ caller-level
  // safeguard として維持。 plan §6 Stage 7 は plan-level で stale 除外撤廃を提唱するが、
  // buildSnapshot のような「broadcast せず内部で snapshot を組む」 経路では lastUpdateTimes
  // が無いため virtualPos も極端値になる → 旧 「stale は寄与させない」 セマンティクスを
  // pre-filter で保持。
  const aliveMap = new Map<string, RelativisticPlayer>();
  for (const [id, p] of s.players) {
    if (s.staleFrozenIds.has(id)) continue;
    aliveMap.set(id, p);
  }
  const hostTime = computeSpawnCoordTime(
    aliveMap,
    s.killLog,
    undefined,
    Date.now(),
    selectDeadPlayerIds(s),
  );

  type PhaseSpaceWire = {
    pos: { t: number; x: number; y: number; z: number };
    u: { x: number; y: number; z: number };
    heading?: { w: number; x: number; y: number; z: number };
    alpha?: { t: number; x: number; y: number; z: number };
  };
  const players: Array<{
    id: string;
    ownerId: string;
    color: string;
    displayName?: string;
    viewMode?: "classic" | "shooter" | "jellyfish";
    isDead: boolean;
    energy: number;
    phaseSpace: PhaseSpaceWire;
    worldLineHistory: Array<PhaseSpaceWire>;
    worldLineOrigin: PhaseSpaceWire | null;
  }> = [];

  // PhaseSpace → wire 形式。heading / alpha は default (identity / zero) の時は
  // 省略して帯域節約 + 旧 build 互換。
  const toPhaseSpaceWire = (ps: PhaseSpace): PhaseSpaceWire => {
    const wire: PhaseSpaceWire = {
      pos: { t: ps.pos.t, x: ps.pos.x, y: ps.pos.y, z: ps.pos.z },
      u: { x: ps.u.x, y: ps.u.y, z: ps.u.z },
    };
    const h = ps.heading;
    if (h.w !== 1 || h.x !== 0 || h.y !== 0 || h.z !== 0) {
      wire.heading = { w: h.w, x: h.x, y: h.y, z: h.z };
    }
    const a = ps.alpha;
    if (a.t !== 0 || a.x !== 0 || a.y !== 0 || a.z !== 0) {
      wire.alpha = { t: a.t, x: a.x, y: a.y, z: a.z };
    }
    return wire;
  };

  // stale 判定済 peer は新 joiner 向け snapshot から除外。 stale player は host が
  // 「もう居ない」 と判定済 (5s 以上 phaseSpace なし) で、 古い pos.t を持ったまま
  // 新 joiner に渡すと **新 joiner の過去光円錐内 phantom → freeze 永続** の bug に
  // なる (2026-04-28「後から入った client 永遠凍結」 root cause)。 既存 peer の view
  // は applySnapshot の local-only 保護で維持される (= 周期 broadcast でも消えない)。
  const staleFrozenIds = s.staleFrozenIds;
  for (const [, p] of s.players) {
    if (staleFrozenIds.has(p.id)) continue;
    // LH owner: BH caller のみ自分に強制 rewrite (migration 安全弁)。非 BH caller
    // (Stage 1.5 client) は preserve — 非 BH が LH 所有権を主張すると BH が merge
    // 時に lh.ownerId を汚染される (BH の LH AI 沈黙の catastrophic bug)。
    // 人間プレイヤーは常に self-own 維持。
    const ownerId = isLighthouse(p.id) && isBeaconHolder ? myId : p.ownerId;
    players.push({
      id: p.id,
      ownerId,
      color: p.color,
      displayName: p.displayName,
      viewMode: p.viewMode,
      // 2026-05-04 isDead 二重管理解消: internal field 撤廃で送信値は selectIsDead
      // で derive。 wire format には旧 client 互換のため残す (= pass-through pattern、
      // option (C))。 受信側 (= 新 client) は applySnapshot で読まずに log から再 derive。
      isDead: selectIsDead(s, p.id),
      energy: p.energy,
      phaseSpace: toPhaseSpaceWire(p.phaseSpace),
      worldLineHistory: p.worldLine.history.map(toPhaseSpaceWire),
      worldLineOrigin: p.worldLine.origin
        ? toPhaseSpaceWire(p.worldLine.origin)
        : null,
    });
  }

  return {
    type: "snapshot" as const,
    hostTime,
    scores: { ...s.scores },
    displayNames: Object.fromEntries(s.displayNames),
    killLog: s.killLog.map((e) => ({ ...e })),
    respawnLog: s.respawnLog.map((e) => ({ ...e })),
    players,
  };
};

type SnapshotMsg = ReturnType<typeof buildSnapshot>;

/**
 * Host (= beacon holder) が new connection event 時に snapshot を push すべきかの
 * 判定 predicate。 RelativisticGame.tsx の prevConnectionIdsRef useEffect 内で各
 * newPeerId に対し呼ばれる。
 *
 * 設計対称性 (= plans/2026-05-06-snapshot-rejoin-host-push.md §2):
 * - **新規 joiner** (= isNewJoiner=true、 store.players に entry 無し) → push
 * - **短期 disconnect / reconnect** (= isNewJoiner=false ∧ now - lastSeen ≤ threshold)
 *   → skip。 通常 broadcast で event log self-maintained を仮定、 spurious push 抑制
 * - **長期 disconnect (= mobile suspend、 wake-from-suspend)** (= isNewJoiner=false ∧
 *   now - lastSeen > threshold) → push。 stale reconnect 例外、 broadcast 停止期間中の
 *   missed event を snapshot で sync
 * - **migration** (= player entry 削除 + 再登録、 通常 case 1 と同等) → push
 *
 * 旧設計欠陥 (= 2026-05-07 修正前): 「has(newId) なら skip」 は 「player entry が
 * 連続的に最新 broadcast で self-maintained」 という暗黙の時間軸前提を持ち、 long
 * disconnect で event log が stale 化する case で破れていた (= debugging-discipline §4
 * 「skip 条件が時間軸を考慮していない」 設計欠陥 pattern)。
 */
export const shouldPushSnapshotOnConnection = (
  isNewJoiner: boolean,
  lastSeenMs: number | undefined,
  nowMs: number,
  thresholdMs: number = LONG_GAP_RESYNC_THRESHOLD_MS,
): boolean => {
  if (isNewJoiner) return true;
  // existing peer: stale reconnect だけ例外的に push
  const lastSeen = lastSeenMs ?? 0;
  return nowMs - lastSeen > thresholdMs;
};

/**
 * 新規 join 側が受信した snapshot から store を初期化する。syncTime の処理を
 * 置き換える: 自機の OFFSET 起点、invincibility 起点 (respawnLog)、他プレイヤーの
 * 世界線履歴、scores / displayNames / event logs を一気に導入する。
 */
export const applySnapshot = (
  myId: string,
  msg: SnapshotMsg,
  getPlayerColor: (id: string) => string,
  lastUpdateTimeRef: React.MutableRefObject<Map<string, number>>,
  lastWitnessTimeRef: React.MutableRefObject<Map<string, number>>,
): void => {
  const store = useGameStore.getState();
  // 既に自機 state がある = migration / snapshotRequest retry 経路。
  // snapshot は「ホスト視点」の一式なので、relay gap 中に取り逃した phaseSpace
  // が含まれず local より古い場合がある。この経路では (a) 自機 state は local
  // を保持、(b) 他 peer は pos.t が新しい方を採用、の防御的 merge を行う。
  // 新規 join (既存 state 無し) は従来通り unconditional replace。
  const isMigrationPath = store.players.has(myId);

  // wire → heading / alpha 復元。旧 build 送信 (欠落) は default。
  const parseHeading = (h?: {
    w: number;
    x: number;
    y: number;
    z: number;
  }): Quaternion =>
    h && [h.w, h.x, h.y, h.z].every(Number.isFinite)
      ? { w: h.w, x: h.x, y: h.y, z: h.z }
      : quatIdentity();

  const parseAlpha = (a?: {
    t: number;
    x: number;
    y: number;
    z: number;
  }): Vector4 =>
    a && [a.t, a.x, a.y, a.z].every(Number.isFinite)
      ? createVector4(a.t, a.x, a.y, a.z)
      : vector4Zero();

  const fromPhaseSpaceWire = (w: {
    pos: { t: number; x: number; y: number; z: number };
    u: { x: number; y: number; z: number };
    heading?: { w: number; x: number; y: number; z: number };
    alpha?: { t: number; x: number; y: number; z: number };
  }): PhaseSpace =>
    createPhaseSpace(
      createVector4(w.pos.t, w.pos.x, w.pos.y, w.pos.z),
      createVector3(w.u.x, w.u.y, w.u.z),
      parseHeading(w.heading),
      parseAlpha(w.alpha),
    );

  // Rehydrate players (me を含む全員)
  const nextPlayers = new Map<string, RelativisticPlayer>();
  for (const sp of msg.players) {
    const phaseSpace = fromPhaseSpaceWire(sp.phaseSpace);
    const origin = sp.worldLineOrigin
      ? fromPhaseSpaceWire(sp.worldLineOrigin)
      : null;
    let wl = createWorldLine(MAX_WORLDLINE_HISTORY, origin);
    for (const h of sp.worldLineHistory) {
      wl = appendWorldLine(wl, fromPhaseSpaceWire(h));
    }
    // viewMode 検証 (= snapshot schema 2026-05-07 拡張): 旧 client は欠落 → undefined、
    // 受信側 SceneContent dispatch で undefined → "classic" fallback。 stray value も undefined。
    const validViewModes: ReadonlyArray<"classic" | "shooter" | "jellyfish"> = [
      "classic",
      "shooter",
      "jellyfish",
    ];
    const spViewMode =
      sp.viewMode && validViewModes.includes(sp.viewMode)
        ? sp.viewMode
        : undefined;
    nextPlayers.set(sp.id, {
      id: sp.id,
      // 2026-05-06 NPC 非対称 plan: kind は ID prefix から derive (= wire format に kind
      // を乗せず、 受信側で `isLighthouse(sp.id) ? 'npc' : 'human'` で復元、 旧 client
      // 互換性維持)。
      kind: isLighthouse(sp.id) ? "npc" : "human",
      ownerId: sp.ownerId,
      phaseSpace,
      worldLine: wl,
      color: sp.color,
      // 2026-05-04 isDead 二重管理解消: 内部 RelativisticPlayer から field 撤廃。
      // wire の `sp.isDead` は ignore (= 旧 client 互換 pass-through で送られてくるが、
      // 受信側は merged killLog/respawnLog から `selectIsDead` で再 derive する)。
      displayName: sp.displayName,
      viewMode: spViewMode,
      energy: typeof sp.energy === "number" ? sp.energy : ENERGY_MAX,
    });
    // Stage 3 (2026-04-21): 新規追加時のみ lastUpdate を初期化。既存 entry を
    // snapshot で refresh すると Stage 3 GC が無効化される — Bug X resurrection で
    // C の周期 snapshot が BH.lastUpdate[B] を永久に refresh し続け、BH の stale
    // 検出が発動しないため。snapshot は弱い presence 信号、phaseSpace (直接 or
    // relay 経由の生存信号) のみが lastUpdate を refresh すべき。
    // 新規 join: store.players 空 → 全 sp に対してここで初期化 (従来通り)。
    // 既存 peer (isMigrationPath): 既知 id は skip、未知 id (= 再 add via snapshot
    // or 新規 peer) のみ初期化 → freeze + GC 時計が正しく回る。
    if (!store.players.has(sp.id)) {
      const snapshotNow = Date.now();
      lastUpdateTimeRef.current.set(sp.id, snapshotNow);
      // Bug 14 完全治療 (2026-05-06): snapshot は host が active で送信しているという
      // 強い signal、 含まれる peer も pre-snapshot 時点では active だった可能性が高い
      // ため bootstrap として witness 化。 transient false-positive (= 含まれた peer が
      // 実は idle の場合) は joiner の prev tick が snapshot 時刻を超えて自然解消する。
      lastWitnessTimeRef.current.set(sp.id, snapshotNow);
    }
  }

  // displayNames は local と snapshot を merge。snapshot に含まれる ID は上書き
  // (host 側が最新)、含まれない旧 ID (reconnection で消えた peer) は local を保持 →
  // killLog に残存する旧 peerId → displayName の逆引きが壊れないようにする。
  const mergedDisplayNames = new Map(store.displayNames);
  for (const [id, name] of Object.entries(msg.displayNames)) {
    mergedDisplayNames.set(id, name);
  }

  // playerViewModes は intro 経路の staging map と整合させるため、 snapshot 経由で来た
  // 各 player の viewMode も同 map に save する (= local intro より snapshot が遅れて
  // 来る順序でも viewMode を取りこぼさない)。
  const mergedPlayerViewModes = new Map(store.playerViewModes);
  for (const sp of msg.players) {
    if (sp.viewMode === undefined) continue;
    if (
      sp.viewMode !== "classic" &&
      sp.viewMode !== "shooter" &&
      sp.viewMode !== "jellyfish"
    )
      continue;
    mergedPlayerViewModes.set(sp.id, sp.viewMode);
  }

  if (isMigrationPath) {
    // 自機: local 優先 (snapshot の自機エントリがあっても上書きしない)
    const existingMine = store.players.get(myId);
    if (existingMine) nextPlayers.set(myId, existingMine);
    // 他 peer: pos.t が local の方が新しければ local を採用
    for (const [id, snapshotPlayer] of nextPlayers) {
      if (id === myId) continue;
      const local = store.players.get(id);
      if (local && local.phaseSpace.pos.t >= snapshotPlayer.phaseSpace.pos.t) {
        nextPlayers.set(id, local);
      }
    }

    // Stage 1 (2026-04-20): 周期 snapshot broadcast + migration 経路共通の union-merge。
    // 既存 migration 経路は log を wholesale replace していたが、周期 snapshot では
    // local に最新 kill/respawn が先行している場合があり (自機 own-authoritative イベント
    // が beacon holder に到達する前) その entry を取りこぼすと一時的に state が巻き戻る。
    // 対処: (key = victimId/playerId + wallTime) で dedupe しつつ union。local 側の entry を
    // 優先保持し snapshot-only の新規 entry だけを追加する。これで:
    //   - local 先行の kill/respawn: そのまま保持 (replace だと消える)
    //   - snapshot 先行の kill/respawn (他 peer が起こし local が取り逃したイベント):
    //     マージで流入、受信側の past-cone 到達で firedForUi が true に遷移
    //   - firedForUi 状態: local が true なら維持 (UI 二重発火防止)、snapshot-only の
    //     entry は false で追加 (ローカル観測者の past-cone 判定はまだ)
    const killKey = (e: { victimId: string; wallTime: number }) =>
      `${e.victimId}@${e.wallTime}`;
    const localKillKeys = new Set(store.killLog.map(killKey));
    const snapshotOnlyKills: KillEventRecord[] = msg.killLog
      .filter((e) => !localKillKeys.has(killKey(e)))
      .map((e) => ({ ...e, firedForUi: false, firedImageCells: [] }));
    const mergedKillLog: KillEventRecord[] = [
      ...store.killLog,
      ...snapshotOnlyKills,
    ].sort((a, b) => a.wallTime - b.wallTime);

    const respawnKey = (e: { playerId: string; wallTime: number }) =>
      `${e.playerId}@${e.wallTime}`;
    const localRespawnKeys = new Set(store.respawnLog.map(respawnKey));
    const snapshotOnlyRespawns: RespawnEventRecord[] = msg.respawnLog
      .filter((e) => !localRespawnKeys.has(respawnKey(e)))
      .map((e) => ({ ...e }));
    const mergedRespawnLog: RespawnEventRecord[] = [
      ...store.respawnLog,
      ...snapshotOnlyRespawns,
    ].sort((a, b) => a.wallTime - b.wallTime);

    // Stage 1: local-only player の保護。nextPlayers は msg.players から構築される
    // ため、local store にあるが snapshot に無い entry は素朴に setState すると消失する。
    // star topology では beacon holder が常に最新 view を持つので理論上発生稀だが、
    // 以下の race で実害あり:
    //   - peer X が beacon holder に join → phaseSpace を broadcast → beacon holder が
    //     relay で他 peer Y に伝搬、の途中で beacon holder が snapshot を build
    //     (= X が players に入る前の snapshot) → Y は relay 経由で X を既に保持 →
    //     snapshot 適用で X が 5 秒消える → 次 snapshot で復帰 (= 新 joiner の blip)
    //   - host migration 過渡期の view 不一致でも同様
    // local-only entry を nextPlayers に 1 本移植するだけで防げる。
    for (const [id, localPlayer] of store.players) {
      if (!nextPlayers.has(id)) {
        nextPlayers.set(id, localPlayer);
      }
    }

    // 2026-05-04 isDead 二重管理解消: 旧版はここで「nextPlayers の各 entry の isDead を
    // mergedKillLog/mergedRespawnLog から強制同期」 する patch (= drift 検知 → override)
    // が貼ってあった (= 二重管理の絆創膏 sign、 meta-principles M26 例 1)。 internal
    // RelativisticPlayer から isDead field 撤廃 + 全 read を selectIsDead derive に統一
    // したため、 当該 patch は不要 (= drift する store がそもそも無い)。 missed respawn
    // 等の救済は merged respawnLog の流入で自動達成 (= 全 read 経路が log を見るため、
    // log が更新された瞬間に isDead 結果も更新)。

    useGameStore.setState({
      players: nextPlayers,
      // scores は観測者相対なので local を保持 (firePendingKillEvents が past-cone
      // 到達時に各 peer で独立に加算する)。snapshot の scores で上書きすると
      // 全 peer が beacon holder の観測に同期して相対論的独立性が壊れる。
      displayNames: mergedDisplayNames,
      playerViewModes: mergedPlayerViewModes,
      killLog: mergedKillLog,
      respawnLog: mergedRespawnLog,
    });
  } else {
    // 新規 join: 既存 state が無いので snapshot を wholesale 適用。scores を含めて
    // 初期 seed (host 観測時点の kill を past-cone 処理前の状態で引き継ぐ)。
    useGameStore.setState({
      players: nextPlayers,
      scores: { ...msg.scores },
      displayNames: mergedDisplayNames,
      playerViewModes: mergedPlayerViewModes,
      killLog: msg.killLog.map((e) => ({ ...e })),
      respawnLog: msg.respawnLog.map((e) => ({ ...e })),
    });
  }

  // 自機が snapshot に含まれていない場合 (新規 join の一般ケース) は、
  // 「宇宙の最新時刻」(= snapshot 送信時点で host が算出した最大 .pos.t) で
  // handleSpawn を呼ぶ。これで players + respawnLog (invincibility 起点) +
  // pendingSpawnEvents (spawn ring) が一括登録される。RelativisticGame init
  // (beacon holder) と完全対称。
  if (!nextPlayers.has(myId)) {
    useGameStore.getState().handleSpawn(
      myId,
      {
        t: msg.hostTime,
        x: (Math.random() - 0.5) * SPAWN_RANGE,
        y: (Math.random() - 0.5) * SPAWN_RANGE,
        z: 0,
      },
      myId,
      getPlayerColor(myId),
      { ownerId: myId },
    );
  }
};
