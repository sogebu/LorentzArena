import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
  type PhaseSpace,
} from "../../physics";
import { useGameStore } from "../../stores/game-store";
import { ENERGY_MAX, MAX_WORLDLINE_HISTORY, SPAWN_RANGE } from "./constants";
import { isLighthouse } from "./lighthouse";
import { computeSpawnCoordTime } from "./respawnTime";
import type { KillEventRecord, RelativisticPlayer, RespawnEventRecord } from "./types";

/**
 * Authority 解体 Stage F: 新規 join peer 1 人に送る state 一式を組み立てる。
 *
 * beacon holder (= host) が `peerManager.sendTo(newPeerId, buildSnapshot(myId))`
 * で送る。既存 peer には送らない (彼らの state は event log から自己維持)。
 *
 * LH ownerId は caller (= beacon holder) に常時 rewrite する。migration 直後の
 * 1-tick 窓で assumeHostRole() の setPlayers コミットが snapshot 発行より遅れても
 * 新 joiner が古い (死んだ) host を LH owner と見る split を防ぐ。
 */
export const buildSnapshot = (myId: string) => {
  const s = useGameStore.getState();
  // 新 joiner のスポーン時刻は「宇宙の最新時刻」= 全プレイヤーの .pos.t の max。
  // beacon holder が高 γ で座標時間が遅れている / ghosting 等でも正しい時刻が取れる。
  const hostTime = computeSpawnCoordTime(s.players);

  const players: Array<{
    id: string;
    ownerId: string;
    color: string;
    displayName?: string;
    isDead: boolean;
    energy: number;
    phaseSpace: {
      pos: { t: number; x: number; y: number; z: number };
      u: { x: number; y: number; z: number };
    };
    worldLineHistory: Array<{
      pos: { t: number; x: number; y: number; z: number };
      u: { x: number; y: number; z: number };
    }>;
    worldLineOrigin: {
      pos: { t: number; x: number; y: number; z: number };
      u: { x: number; y: number; z: number };
    } | null;
  }> = [];

  for (const [, p] of s.players) {
    // LH owner は caller (beacon holder) に強制。他プレイヤーは self-own 維持。
    const ownerId = isLighthouse(p.id) ? myId : p.ownerId;
    players.push({
      id: p.id,
      ownerId,
      color: p.color,
      displayName: p.displayName,
      isDead: p.isDead,
      energy: p.energy,
      phaseSpace: {
        pos: { t: p.phaseSpace.pos.t, x: p.phaseSpace.pos.x, y: p.phaseSpace.pos.y, z: p.phaseSpace.pos.z },
        u: { x: p.phaseSpace.u.x, y: p.phaseSpace.u.y, z: p.phaseSpace.u.z },
      },
      worldLineHistory: p.worldLine.history.map((ps: PhaseSpace) => ({
        pos: { t: ps.pos.t, x: ps.pos.x, y: ps.pos.y, z: ps.pos.z },
        u: { x: ps.u.x, y: ps.u.y, z: ps.u.z },
      })),
      worldLineOrigin: p.worldLine.origin
        ? {
            pos: {
              t: p.worldLine.origin.pos.t,
              x: p.worldLine.origin.pos.x,
              y: p.worldLine.origin.pos.y,
              z: p.worldLine.origin.pos.z,
            },
            u: {
              x: p.worldLine.origin.u.x,
              y: p.worldLine.origin.u.y,
              z: p.worldLine.origin.u.z,
            },
          }
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
 * 新規 join 側が受信した snapshot から store を初期化する。syncTime の処理を
 * 置き換える: 自機の OFFSET 起点、invincibility 起点 (respawnLog)、他プレイヤーの
 * 世界線履歴、scores / displayNames / event logs を一気に導入する。
 */
export const applySnapshot = (
  myId: string,
  msg: SnapshotMsg,
  getPlayerColor: (id: string) => string,
  lastUpdateTimeRef: React.MutableRefObject<Map<string, number>>,
): void => {
  const store = useGameStore.getState();
  // 既に自機 state がある = migration / snapshotRequest retry 経路。
  // snapshot は「ホスト視点」の一式なので、relay gap 中に取り逃した phaseSpace
  // が含まれず local より古い場合がある。この経路では (a) 自機 state は local
  // を保持、(b) 他 peer は pos.t が新しい方を採用、の防御的 merge を行う。
  // 新規 join (既存 state 無し) は従来通り unconditional replace。
  const isMigrationPath = store.players.has(myId);

  // Rehydrate players (me を含む全員)
  const nextPlayers = new Map<string, RelativisticPlayer>();
  for (const sp of msg.players) {
    const phaseSpace = createPhaseSpace(
      createVector4(sp.phaseSpace.pos.t, sp.phaseSpace.pos.x, sp.phaseSpace.pos.y, sp.phaseSpace.pos.z),
      createVector3(sp.phaseSpace.u.x, sp.phaseSpace.u.y, sp.phaseSpace.u.z),
    );
    const origin = sp.worldLineOrigin
      ? createPhaseSpace(
          createVector4(sp.worldLineOrigin.pos.t, sp.worldLineOrigin.pos.x, sp.worldLineOrigin.pos.y, sp.worldLineOrigin.pos.z),
          createVector3(sp.worldLineOrigin.u.x, sp.worldLineOrigin.u.y, sp.worldLineOrigin.u.z),
        )
      : null;
    let wl = createWorldLine(MAX_WORLDLINE_HISTORY, origin);
    for (const h of sp.worldLineHistory) {
      const ps = createPhaseSpace(
        createVector4(h.pos.t, h.pos.x, h.pos.y, h.pos.z),
        createVector3(h.u.x, h.u.y, h.u.z),
      );
      wl = appendWorldLine(wl, ps);
    }
    nextPlayers.set(sp.id, {
      id: sp.id,
      ownerId: sp.ownerId,
      phaseSpace,
      worldLine: wl,
      color: sp.color,
      isDead: sp.isDead,
      displayName: sp.displayName,
      energy: typeof sp.energy === "number" ? sp.energy : ENERGY_MAX,
    });
    lastUpdateTimeRef.current.set(sp.id, Date.now());
  }

  // displayNames は local と snapshot を merge。snapshot に含まれる ID は上書き
  // (host 側が最新)、含まれない旧 ID (reconnection で消えた peer) は local を保持 →
  // killLog に残存する旧 peerId → displayName の逆引きが壊れないようにする。
  const mergedDisplayNames = new Map(store.displayNames);
  for (const [id, name] of Object.entries(msg.displayNames)) {
    mergedDisplayNames.set(id, name);
  }

  if (isMigrationPath) {
    // 自機: local 優先 (snapshot の自機エントリがあっても上書きしない)
    const existingMine = store.players.get(myId);
    if (existingMine) nextPlayers.set(myId, existingMine);
    // 他 peer: pos.t が local の方が新しければ local を採用
    for (const [id, snapshotPlayer] of nextPlayers) {
      if (id === myId) continue;
      const local = store.players.get(id);
      if (
        local &&
        local.phaseSpace.pos.t >= snapshotPlayer.phaseSpace.pos.t
      ) {
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
      .map((e) => ({ ...e, firedForUi: false }));
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
    // local-only entry を nextPlayers に 1 本移植するだけで防げる。snapshot の isDead
    // 再導出 (下) は merged log ベースなので、local-only entry にも正しく作用する。
    for (const [id, localPlayer] of store.players) {
      if (!nextPlayers.has(id)) {
        nextPlayers.set(id, localPlayer);
      }
    }

    // isDead を merged log から再導出し、nextPlayers の各 entry に反映する。
    // これが周期 snapshot の中核: missed respawn で local が isDead=true 貼り付きに
    // なっていても、snapshot 経由で respawnLog entry が流入すると latestRespawn >
    // latestKill に遷移し isDead=false に復帰する (ghost stuck / B' 消失の自動救済)。
    const lastKillByVictim = new Map<string, number>();
    for (const e of mergedKillLog) {
      const prev = lastKillByVictim.get(e.victimId);
      if (prev === undefined || e.wallTime > prev)
        lastKillByVictim.set(e.victimId, e.wallTime);
    }
    const lastRespawnByPlayer = new Map<string, number>();
    for (const e of mergedRespawnLog) {
      const prev = lastRespawnByPlayer.get(e.playerId);
      if (prev === undefined || e.wallTime > prev)
        lastRespawnByPlayer.set(e.playerId, e.wallTime);
    }
    for (const [id, p] of nextPlayers) {
      const kTime = lastKillByVictim.get(id);
      const derivedDead =
        kTime !== undefined && kTime > (lastRespawnByPlayer.get(id) ?? -Infinity);
      if (derivedDead !== p.isDead) {
        nextPlayers.set(id, { ...p, isDead: derivedDead });
      }
    }

    useGameStore.setState({
      players: nextPlayers,
      // scores は観測者相対なので local を保持 (firePendingKillEvents が past-cone
      // 到達時に各 peer で独立に加算する)。snapshot の scores で上書きすると
      // 全 peer が beacon holder の観測に同期して相対論的独立性が壊れる。
      displayNames: mergedDisplayNames,
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
        x: Math.random() * SPAWN_RANGE,
        y: Math.random() * SPAWN_RANGE,
        z: 0,
      },
      myId,
      getPlayerColor(myId),
      { ownerId: myId },
    );
  }
};
