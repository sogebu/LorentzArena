import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
} from "../../physics";
import { useGameStore } from "../../stores/game-store";
import { LIGHTHOUSE_COLOR, MAX_LASERS, MAX_WORLDLINE_HISTORY, SPAWN_RANGE } from "./constants";
import { isLighthouse } from "./lighthouse";
import { createRespawnPosition } from "./respawnTime";
import { applySnapshot } from "./snapshot";
import type { Laser, RelativisticPlayer } from "./types";

export type MessageHandlerDeps = {
  myId: string;
  peerManager: {
    getIsHost(): boolean;
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

const isValidString = (v: unknown, maxLen = 200): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= maxLen;

const isValidColor = (v: unknown): v is string =>
  typeof v === "string" && v.length < 100 && /^(hsl|rgb|#)/i.test(v);

/** Validate and extract a scores object. Returns null if invalid. */
const parseScores = (raw: unknown): Record<string, number> | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const scores: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!isValidString(key) || !isFiniteNumber(val)) return null;
    scores[key] = val as number;
  }
  return scores;
};

/**
 * Each message handler is a synchronous block that calls store.setXxx() at most once per field.
 * Since no set() call intervenes within a single handler, reading from `store` (= getState()
 * at handler entry) is always fresh. Do NOT call getState() again mid-handler.
 */
export const createMessageHandler =
  // biome-ignore lint/suspicious/noExplicitAny: Network messages require runtime validation
  (deps: MessageHandlerDeps) => (_senderId: string, msg: any) => {
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

      // Stale 復帰検知: stale 凍結されたプレイヤーから phaseSpace が来た
      if (staleFrozenRef.current.has(playerId)) {
        if (!peerManager.getIsHost()) return; // クライアントはホストの respawn を待つ
        const respawnPos = createRespawnPosition(store.players);
        staleFrozenRef.current.delete(playerId);
        lastUpdateTimeRef.current.set(playerId, Date.now());
        peerManager.send({
          type: "respawn" as const,
          playerId,
          position: respawnPos,
        });
        store.handleRespawn(playerId, respawnPos, myId, getPlayerColor);
        return;
      }

      lastUpdateTimeRef.current.set(playerId, Date.now());
      lastCoordTimeRef.current.set(playerId, {
        wallTime: Date.now(),
        posT: msg.position.t,
      });
      store.setPlayers((prev: Map<string, RelativisticPlayer>) => {
        const phaseSpace = createPhaseSpace(msg.position, msg.velocity);

        const existing = prev.get(playerId);
        // 死亡中（世界線凍結中）なら phaseSpace を無視
        if (existing?.isDead) return prev;

        const existingWorldLine = existing?.worldLine;
        const worldLine = existingWorldLine
          ? appendWorldLine(existingWorldLine, phaseSpace)
          : (() => {
              let wl = createWorldLine(MAX_WORLDLINE_HISTORY);
              wl = appendWorldLine(wl, phaseSpace);
              return wl;
            })();

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
      // Stage F: syncTime + hostMigration を統合した新規 join 用 state 一式。
      // バリデーションは applySnapshot 内でも行うが、外周で基本形だけ確認。
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
    } else if (msg.type === "syncTime") {
      if (!isFiniteNumber(msg.hostTime)) return;
      const syncScores = parseScores(msg.scores);
      if (syncScores) {
        store.setScores(syncScores);
      }
      const spawnX = Math.random() * SPAWN_RANGE;
      const spawnY = Math.random() * SPAWN_RANGE;
      store.setPlayers((prev) => {
        const me = prev.get(myId);
        const synced = createPhaseSpace(
          createVector4(
            msg.hostTime,
            me?.phaseSpace.pos.x ?? spawnX,
            me?.phaseSpace.pos.y ?? spawnY,
            0,
          ),
          me?.phaseSpace.u ?? { x: 0, y: 0, z: 0 },
        );
        let newWorldLine = createWorldLine(MAX_WORLDLINE_HISTORY);
        newWorldLine = appendWorldLine(newWorldLine, synced);
        const next = new Map(prev);
        next.set(myId, {
          id: myId,
          ownerId: myId,
          phaseSpace: synced,
          worldLine: newWorldLine,
          color: me?.color ?? getPlayerColor(myId),
          isDead: false,
        });
        return next;
      });
      // Stage C: 初期 invincibility は respawnLog 経由で derive。
      // 「client 初回スポーン = 初回 respawn」として扱う。
      // setPlayers 後なので fresh state から読む
      const freshState = useGameStore.getState();
      const freshMe = freshState.players.get(myId);
      const spawnPos = {
        t: msg.hostTime,
        x: freshMe?.phaseSpace.pos.x ?? spawnX,
        y: freshMe?.phaseSpace.pos.y ?? spawnY,
        z: 0,
      };
      useGameStore.setState((state) => ({
        respawnLog: [
          ...state.respawnLog,
          { playerId: myId, position: spawnPos, wallTime: Date.now() },
        ],
        pendingSpawnEvents: [
          ...state.pendingSpawnEvents,
          {
            id: `spawn-${myId}-${Date.now()}`,
            playerId: myId,
            pos: spawnPos,
            color: freshMe?.color ?? getPlayerColor(myId),
          },
        ],
      }));
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
    } else if (msg.type === "respawn") {
      // Stage D: respawn は owner 発信。host は他 peer の respawn を受信したら
      // handleRespawn を実行 + registerHostRelay が relay を担当。
      if (!isValidString(msg.playerId) || !isValidVector4(msg.position)) return;
      staleFrozenRef.current.delete(msg.playerId);
      lastUpdateTimeRef.current.set(msg.playerId, Date.now());
      store.handleRespawn(msg.playerId, msg.position, myId, getPlayerColor);
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
    } else if (msg.type === "hostMigration") {
      if (peerManager.getIsHost()) return;
      if (!isValidString(msg.newHostId)) return;
      const scores = parseScores(msg.scores);
      if (!scores) return;
      store.setScores(scores);
      // Sync display names from migrating host
      if (
        msg.displayNames &&
        typeof msg.displayNames === "object" &&
        !Array.isArray(msg.displayNames)
      ) {
        for (const [id, name] of Object.entries(msg.displayNames)) {
          if (isValidString(id) && isValidString(name, 20)) {
            store.displayNames.set(id, name as string);
          }
        }
        // Propagate display names into existing player entries immediately
        store.setPlayers((prev) => {
          let changed = false;
          const next = new Map(prev);
          for (const [id, player] of next) {
            const dn = store.displayNames.get(id);
            if (dn && player.displayName !== dn) {
              next.set(id, { ...player, displayName: dn });
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
      console.log(
        "[messageHandler] hostMigration received from",
        msg.newHostId,
        "scores:",
        scores,
      );
    }
  };
