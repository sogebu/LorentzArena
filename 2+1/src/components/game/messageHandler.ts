import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
  displayPos,
  type Quaternion,
  quatIdentity,
  type Vector4,
  vector4Zero,
} from "../../physics";
import { useGameStore } from "../../stores/game-store";
import {
  ARENA_HALF_WIDTH,
  ENERGY_MAX,
  LIGHTHOUSE_COLOR,
  MAX_FROZEN_WORLDLINES,
  MAX_LASERS,
  MAX_WORLDLINE_HISTORY,
  WORLDLINE_GAP_THRESHOLD_MS,
} from "./constants";
import { isLighthouse } from "./lighthouse";
import { createRespawnPosition } from "./respawnTime";
import { applySnapshot, buildSnapshot } from "./snapshot";
import type { FrozenWorldLine, Laser, RelativisticPlayer } from "./types";

export type MessageHandlerDeps = {
  myId: string;
  peerManager: {
    getIsBeaconHolder(): boolean;
    send(msg: unknown): void;
    sendTo(peerId: string, msg: unknown): void;
  };
  getPlayerColor: (peerId: string) => string;
  lastUpdateTimeRef: React.MutableRefObject<Map<string, number>>;
  lastCoordTimeRef: React.MutableRefObject<Map<string, { wallTime: number; posT: number }>>;
  staleFrozenRef: React.MutableRefObject<Set<string>>;
};

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const isValidVector4 = (
  v: unknown,
): v is { t: number; x: number; y: number; z: number } =>
  v != null &&
  typeof v === "object" &&
  isFiniteNumber((v as Record<string, unknown>).t) &&
  isFiniteNumber((v as Record<string, unknown>).x) &&
  isFiniteNumber((v as Record<string, unknown>).y) &&
  isFiniteNumber((v as Record<string, unknown>).z);

const isValidVector3 = (v: unknown): v is { x: number; y: number; z: number } =>
  v != null &&
  typeof v === "object" &&
  isFiniteNumber((v as Record<string, unknown>).x) &&
  isFiniteNumber((v as Record<string, unknown>).y) &&
  isFiniteNumber((v as Record<string, unknown>).z);

/**
 * 旧 build 互換のため heading/alpha は optional。欠落・非 finite は default 補完。
 * heading は {w,x,y,z}、alpha は {t,x,y,z}。malformed は identity/zero に fallback
 * (接続を落とさない: 他 peer の不正 payload で自分の挙動を止める理由がない)。
 */
const parseOptionalQuaternion = (v: unknown): Quaternion => {
  if (
    v != null &&
    typeof v === "object" &&
    isFiniteNumber((v as Record<string, unknown>).w) &&
    isFiniteNumber((v as Record<string, unknown>).x) &&
    isFiniteNumber((v as Record<string, unknown>).y) &&
    isFiniteNumber((v as Record<string, unknown>).z)
  ) {
    const q = v as { w: number; x: number; y: number; z: number };
    return { w: q.w, x: q.x, y: q.y, z: q.z };
  }
  return quatIdentity();
};

const parseOptionalAlpha = (v: unknown): Vector4 => {
  if (
    v != null &&
    typeof v === "object" &&
    isFiniteNumber((v as Record<string, unknown>).t) &&
    isFiniteNumber((v as Record<string, unknown>).x) &&
    isFiniteNumber((v as Record<string, unknown>).y) &&
    isFiniteNumber((v as Record<string, unknown>).z)
  ) {
    const a = v as { t: number; x: number; y: number; z: number };
    return createVector4(a.t, a.x, a.y, a.z);
  }
  return vector4Zero();
};

const isValidString = (v: unknown, maxLen = 200): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= maxLen;

const isValidColor = (v: unknown): v is string =>
  typeof v === "string" && v.length < 100 && /^(hsl|rgb|#)/i.test(v);

/**
 * Each message handler is a synchronous block that calls store.setXxx() at most once per field.
 * Since no set() call intervenes within a single handler, reading from `store` (= getState()
 * at handler entry) is always fresh. Do NOT call getState() again mid-handler.
 */
export const createMessageHandler =
  // biome-ignore lint/suspicious/noExplicitAny: Network messages require runtime validation
  (deps: MessageHandlerDeps) => (senderId: string, msg: any) => {
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    const {
      myId,
      peerManager,
      getPlayerColor,
      lastUpdateTimeRef,
      lastCoordTimeRef,
      staleFrozenRef,
    } = deps;
    const store = useGameStore.getState();

    if (msg.type === "snapshotRequest") {
      // 新規 join client からの pull retry。host だけが返答する。
      if (!peerManager.getIsBeaconHolder()) return;
      if (!isValidString(senderId)) return;
      peerManager.sendTo(senderId, buildSnapshot(myId, true));
      return;
    }

    if (msg.type === "phaseSpace") {
      if (
        !isValidString(msg.senderId) ||
        !isValidVector4(msg.position) ||
        !isValidVector3(msg.velocity)
      )
        return;
      const playerId = msg.senderId;

      // 自分のリレーされた phaseSpace は無視（ゲームループで処理済み。
      // ホストがリレーした古い phaseSpace がリスポーン後に届くと、
      // 新しい WorldLine に古い位置が appendWorldLine される）
      if (playerId === myId) return;

      // Stale 復帰検知: stale 凍結されたプレイヤーから phaseSpace が来た。
      //
      // Ballistic 復帰: 凍結中も他機は等速直線運動してたとみなし、
      //   new pos = pos + u * dτ                           (4-velocity を proper time で積分)
      //   t component:  pos.t + γ * dτ   (= u^0 * dτ)
      // で凍結直前 phaseSpace から復帰位置を計算 → `displayPos` で torus (0,0) cell に wrap
      // して torus universe 内に正しく収める (= 「実体は (0,0) cell に閉じる」 設計思想)。
      // dτ は host 観測者の壁時計経過 (= 厳密には player 本人 proper time とは異なるが、
      // game 的に十分な近似)。 `oldPs` / `lastUpdateTimeRef` 不在の防御 fallback で
      // 従来 random 復帰経路を維持。
      if (staleFrozenRef.current.has(playerId)) {
        if (!peerManager.getIsBeaconHolder()) return; // クライアントはホストの respawn を待つ
        const oldPs = store.players.get(playerId)?.phaseSpace;
        const oldUpdate = lastUpdateTimeRef.current.get(playerId);
        let respawnPos: { t: number; x: number; y: number; z: number };
        if (oldPs && oldUpdate !== undefined) {
          const dTau = (Date.now() - oldUpdate) / 1000;
          const u = oldPs.u;
          const gamma = Math.sqrt(1 + u.x * u.x + u.y * u.y + u.z * u.z);
          const ballisticPos = createVector4(
            oldPs.pos.t + gamma * dTau,
            oldPs.pos.x + u.x * dTau,
            oldPs.pos.y + u.y * dTau,
            oldPs.pos.z + u.z * dTau,
          );
          const wrapped =
            useGameStore.getState().boundaryMode === "torus"
              ? displayPos(ballisticPos, { x: 0, y: 0 }, ARENA_HALF_WIDTH)
              : ballisticPos;
          respawnPos = {
            t: wrapped.t,
            x: wrapped.x,
            y: wrapped.y,
            z: wrapped.z,
          };
        } else {
          respawnPos = createRespawnPosition(store.players, playerId);
        }
        staleFrozenRef.current.delete(playerId);
        lastUpdateTimeRef.current.set(playerId, Date.now());
        const ballisticU = oldPs?.u
          ? { x: oldPs.u.x, y: oldPs.u.y, z: oldPs.u.z }
          : undefined;
        peerManager.send({
          type: "respawn" as const,
          playerId,
          position: respawnPos,
          ...(ballisticU ? { u: ballisticU } : {}),
        });
        const existingColor =
          store.players.get(playerId)?.color ?? getPlayerColor(playerId);
        store.handleSpawn(playerId, respawnPos, myId, existingColor, {
          ...(ballisticU ? { u: ballisticU } : {}),
        });
        return;
      }

      // Gap 検出: 前回 phaseSpace 受信からの wall-time gap が閾値超なら、
      // 既存 worldLine を frozenWorldLines に凍結し、新 WL を 1 点から始める。
      // CatmullRomCurve3 が gap 両端を直線補間して tube に橋を生やすのを防ぐ。
      // host migration (2.5s heartbeat) / tab background 復帰時に発火。
      const prevCoord = lastCoordTimeRef.current.get(playerId);
      const now = Date.now();
      const shouldResetWorldLine =
        prevCoord !== undefined &&
        now - prevCoord.wallTime > WORLDLINE_GAP_THRESHOLD_MS;

      if (shouldResetWorldLine) {
        const existingPlayer = store.players.get(playerId);
        if (
          existingPlayer &&
          !existingPlayer.isDead &&
          existingPlayer.worldLine.history.length > 0
        ) {
          const frozen: FrozenWorldLine = {
            playerId,
            worldLine: existingPlayer.worldLine,
            color: existingPlayer.color,
          };
          store.setFrozenWorldLines((prev) =>
            [...prev, frozen].slice(-MAX_FROZEN_WORLDLINES),
          );
        }
      }

      lastUpdateTimeRef.current.set(playerId, now);
      lastCoordTimeRef.current.set(playerId, {
        wallTime: now,
        posT: msg.position.t,
      });
      store.setPlayers((prev: Map<string, RelativisticPlayer>) => {
        // heading / alpha は旧 build からの broadcast では欠落 → default 補完。
        const heading = parseOptionalQuaternion(msg.heading);
        const alpha = parseOptionalAlpha(msg.alpha);
        const phaseSpace = createPhaseSpace(
          createVector4(msg.position.t, msg.position.x, msg.position.y, msg.position.z),
          createVector3(msg.velocity.x, msg.velocity.y, msg.velocity.z),
          heading,
          alpha,
        );

        const existing = prev.get(playerId);
        // 死亡中（世界線凍結中）なら phaseSpace を無視
        if (existing?.isDead) return prev;

        const existingWorldLine = existing?.worldLine;
        const worldLine =
          shouldResetWorldLine || !existingWorldLine
            ? appendWorldLine(createWorldLine(MAX_WORLDLINE_HISTORY), phaseSpace)
            : appendWorldLine(existingWorldLine, phaseSpace);

        const color = existing?.color ?? (isLighthouse(playerId) ? LIGHTHOUSE_COLOR : getPlayerColor(playerId));
        const displayName = existing?.displayName ?? store.displayNames.get(playerId);

        const next = new Map(prev);
        // ownerId: 人間プレイヤーは自己所有 (= playerId)。Lighthouse は host が owner だが、
        // 受信側からは即座に特定できないため、既存値を保持 (Stage E で正式化)。
        const ownerId = existing?.ownerId ?? (isLighthouse(playerId) ? "" : playerId);
        next.set(playerId, {
          id: playerId,
          ownerId,
          phaseSpace,
          worldLine,
          color,
          isDead: false,
          displayName,
          energy: existing?.energy ?? ENERGY_MAX,
        });
        return next;
      });
    } else if (msg.type === "intro") {
      if (!isValidString(msg.senderId) || !isValidString(msg.displayName, 20))
        return;
      store.setDisplayName(msg.senderId, msg.displayName);
      store.setPlayers((prev) => {
        const existing = prev.get(msg.senderId);
        if (!existing) return prev;
        if (existing.displayName === msg.displayName) return prev;
        const next = new Map(prev);
        next.set(msg.senderId, { ...existing, displayName: msg.displayName });
        return next;
      });
    } else if (msg.type === "snapshot") {
      // 3 経路の union:
      //   - Stage F: 新規 join client への host 一発送信 (sendTo)
      //   - Stage 1 (2026-04-20): BH → 全 client への 5s 周期 reconciliation broadcast
      //   - Stage 1.5 (2026-04-21): 全 peer → conns への 5s 周期 peer 貢献 snapshot
      //     (client → BH 方向も open、BH が各 peer の局所観測を union-merge)
      // いずれも applySnapshot 内 isMigrationPath 分岐で union-merge + isDead 再導出が
      // 走るので sender authority に依らず安全。senderId は intentionally check しない
      // (Stage 1.5 で「peer 貢献を歓迎」方向に反転)。validation は applySnapshot 内でも
      // 行うが、外周で基本形だけ確認。
      if (
        !isFiniteNumber(msg.hostTime) ||
        !msg.scores ||
        typeof msg.scores !== "object" ||
        !msg.displayNames ||
        typeof msg.displayNames !== "object" ||
        !Array.isArray(msg.killLog) ||
        !Array.isArray(msg.respawnLog) ||
        !Array.isArray(msg.players)
      ) {
        return;
      }
      applySnapshot(myId, msg, getPlayerColor, lastUpdateTimeRef);
    } else if (msg.type === "laser") {
      if (
        !isValidString(msg.id) ||
        !isValidString(msg.playerId) ||
        !isValidVector4(msg.emissionPos) ||
        !isValidVector3(msg.direction) ||
        !isFiniteNumber(msg.range) ||
        msg.range <= 0 ||
        msg.range > 100 ||
        !isValidColor(msg.color)
      )
        return;
      const receivedLaser: Laser = {
        id: msg.id,
        playerId: msg.playerId,
        emissionPos: msg.emissionPos,
        direction: msg.direction,
        range: msg.range,
        color: msg.color,
      };
      store.setLasers((prev) => {
        if (prev.some((l) => l.id === receivedLaser.id)) return prev;
        const updated = [...prev, receivedLaser];
        return updated.length > MAX_LASERS
          ? updated.slice(updated.length - MAX_LASERS)
          : updated;
      });
      // Stage E: LH laser の観測記録 (beacon migration 時の fire continuity 用)
      if (isLighthouse(msg.playerId)) {
        store.lighthouseLastFireTime.set(msg.playerId, Date.now());
      }
    } else if (msg.type === "hit") {
      // Phase C1: 被弾イベント (target-authoritative)。victim の owner が発信。
      // 受信側は handleDamage で energy 減算 + (致命なら) handleKill を連鎖させる。
      // kill イベント自体は別途 `kill` message で届く (victim owner が broadcast)。
      if (
        !isValidString(msg.victimId) ||
        !isValidString(msg.killerId) ||
        !isValidVector4(msg.hitPos) ||
        !isFiniteNumber(msg.damage) ||
        msg.damage < 0 ||
        msg.damage > 10 ||
        !isValidVector3(msg.laserDir)
      )
        return;
      // 自分が owner の victim (自機 or 自分所有 LH) は local の hit detection
      // で既に処理済み。relay 経由の自己 echo は無視。
      const victim = store.players.get(msg.victimId);
      if (victim?.ownerId === myId) return;
      store.handleDamage(
        msg.victimId,
        msg.killerId,
        msg.hitPos,
        msg.damage,
        msg.laserDir,
        myId,
      );
    } else if (msg.type === "respawn") {
      // Stage D: respawn は owner 発信。host は他 peer の respawn を受信したら
      // handleSpawn を実行 + registerHostRelay が relay を担当。
      if (!isValidString(msg.playerId) || !isValidVector4(msg.position)) return;
      // 自機 respawn の relay echo は無視 (自機側は useGameLoop の respawn poll が
      // 直接 handleSpawn 済 → echo で再 handleSpawn すると pendingSpawnEvents が二重に
      // append され spawn ring が PBC 9 image × 2 = 最大 18 個出る (= 「同セル内に次々と
      // リスポーンエフェクト」 bug)。 phaseSpace / hit handler と同じ self echo guard。
      if (msg.playerId === myId) return;
      staleFrozenRef.current.delete(msg.playerId);
      lastUpdateTimeRef.current.set(msg.playerId, Date.now());
      const existingColor =
        store.players.get(msg.playerId)?.color ?? getPlayerColor(msg.playerId);
      // ballistic stale 復帰の場合 msg.u がある (= 凍結時 4-velocity を継承)。
      // 通常 (死亡 → 復活) は msg.u 省略 = u=0 静止復活 (= 既存挙動)。
      const ballisticU =
        msg.u && isValidVector3(msg.u)
          ? { x: msg.u.x, y: msg.u.y, z: msg.u.z }
          : undefined;
      store.handleSpawn(msg.playerId, msg.position, myId, existingColor, {
        ...(ballisticU ? { u: ballisticU } : {}),
      });
    } else if (msg.type === "kill") {
      // Stage B: kill は誰からでも受理（host skip を撤去）。
      // host も自身が owner でない player の kill は messageHandler 経由で受信する。
      if (
        !isValidString(msg.victimId) ||
        !isValidString(msg.killerId) ||
        !isValidVector4(msg.hitPos)
      )
        return;
      const { victimId, killerId, hitPos } = msg;
      // S-2: kill で stale クリア（二重 respawn 防止）
      staleFrozenRef.current.delete(victimId);
      store.handleKill(victimId, killerId, hitPos, myId);
      // Stage D: respawn schedule は owner local (= target 本人 or LH owner) が
      // useGameLoop 側で担当。ここでは何もしない。
    }
  };
