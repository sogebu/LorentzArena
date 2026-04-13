import type React from "react";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
} from "../../physics";
import { colorForPlayerId } from "./colors"; // fallback for syncTime init
import { INVINCIBILITY_DURATION, MAX_LASERS, MAX_WORLDLINE_HISTORY, SPAWN_RANGE } from "./constants";
import { createRespawnPosition } from "./respawnTime";
import type { Laser, RelativisticPlayer } from "./types";

export type MessageHandlerDeps = {
  myId: string;
  peerManager: {
    getIsHost(): boolean;
    send(msg: unknown): void;
    sendTo(peerId: string, msg: unknown): void;
  };
  setPlayers: React.Dispatch<
    React.SetStateAction<Map<string, RelativisticPlayer>>
  >;
  setLasers: React.Dispatch<React.SetStateAction<Laser[]>>;
  setScores: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  scoresRef: React.RefObject<Record<string, number>>;
  handleKill: (
    victimId: string,
    killerId: string,
    hitPos: { t: number; x: number; y: number; z: number },
  ) => void;
  handleRespawn: (
    playerId: string,
    position: { t: number; x: number; y: number; z: number },
  ) => void;
  getPlayerColor: (peerId: string) => string;
  lastUpdateTimeRef: React.MutableRefObject<Map<string, number>>;
  lastCoordTimeRef: React.MutableRefObject<Map<string, { wallTime: number; posT: number }>>;
  playersRef: React.RefObject<Map<string, RelativisticPlayer>>;
  staleFrozenRef: React.MutableRefObject<Set<string>>;
  displayNamesRef: React.MutableRefObject<Map<string, string>>;
  invincibleUntilRef: React.MutableRefObject<Map<string, number>>;
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

export const createMessageHandler =
  // biome-ignore lint/suspicious/noExplicitAny: Network messages require runtime validation
  (deps: MessageHandlerDeps) => (_senderId: string, msg: any) => {
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    const {
      myId,
      peerManager,
      setPlayers,
      setLasers,
      setScores,
      scoresRef,
      handleKill,
      handleRespawn,
      getPlayerColor,
      lastUpdateTimeRef,
      lastCoordTimeRef,
      playersRef,
      staleFrozenRef,
      displayNamesRef,
      invincibleUntilRef,
    } = deps;

    if (msg.type === "phaseSpace") {
      if (
        !isValidString(msg.senderId) ||
        !isValidVector4(msg.position) ||
        !isValidVector3(msg.velocity)
      )
        return;
      const playerId = msg.senderId;

      // Stale 復帰検知: stale 凍結されたプレイヤーから phaseSpace が来た
      if (staleFrozenRef.current.has(playerId)) {
        if (!peerManager.getIsHost()) return; // クライアントはホストの respawn を待つ
        const respawnPos = createRespawnPosition(playersRef.current);
        staleFrozenRef.current.delete(playerId);
        lastUpdateTimeRef.current.set(playerId, Date.now());
        peerManager.send({
          type: "respawn" as const,
          playerId,
          position: respawnPos,
        });
        handleRespawn(playerId, respawnPos);
        return;
      }

      lastUpdateTimeRef.current.set(playerId, Date.now());
      lastCoordTimeRef.current.set(playerId, {
        wallTime: Date.now(),
        posT: msg.position.t,
      });
      setPlayers((prev) => {
        const phaseSpace = createPhaseSpace(msg.position, msg.velocity);

        const existing = prev.get(playerId);
        // 死亡中（世界線凍結中）なら phaseSpace を無視
        if (existing?.isDead) return prev;

        const existingWorldLine = existing?.worldLine;
        const worldLine = existingWorldLine
          ? appendWorldLine(existingWorldLine, phaseSpace)
          : (() => {
              let wl = createWorldLine(MAX_WORLDLINE_HISTORY, phaseSpace); // 新規プレイヤー: origin 付き
              wl = appendWorldLine(wl, phaseSpace);
              return wl;
            })();

        // 色は ID から決定的に算出（joinRegistryVersion 変化時に再計算される）
        const color = existing?.color ?? getPlayerColor(playerId);

        const displayName = existing?.displayName ?? displayNamesRef.current.get(playerId);

        const next = new Map(prev);
        next.set(playerId, {
          id: playerId,
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
      displayNamesRef.current.set(msg.senderId, msg.displayName);
      // Update existing player if already in the map
      setPlayers((prev) => {
        const existing = prev.get(msg.senderId);
        if (!existing) return prev;
        if (existing.displayName === msg.displayName) return prev;
        const next = new Map(prev);
        next.set(msg.senderId, { ...existing, displayName: msg.displayName });
        return next;
      });
    } else if (msg.type === "syncTime") {
      if (!isFiniteNumber(msg.hostTime)) return;
      // スコア同期（途中参加時に過去のキルスコアを引き継ぐ）
      const syncScores = parseScores(msg.scores);
      if (syncScores) {
        scoresRef.current = syncScores;
        setScores(syncScores);
      }
      // Initialize client player at the host's current coordinate time.
      // This is the client's first player creation (init effect skips for non-hosts).
      const spawnX = Math.random() * SPAWN_RANGE;
      const spawnY = Math.random() * SPAWN_RANGE;
      setPlayers((prev) => {
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
        let newWorldLine = createWorldLine(MAX_WORLDLINE_HISTORY, synced);
        newWorldLine = appendWorldLine(newWorldLine, synced);
        const next = new Map(prev);
        next.set(myId, {
          id: myId,
          phaseSpace: synced,
          worldLine: newWorldLine,
          color: me?.color ?? colorForPlayerId(myId),
          isDead: false,
        });
        return next;
      });
      invincibleUntilRef.current.set(myId, Date.now() + INVINCIBILITY_DURATION);
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
      setLasers((prev) => {
        if (prev.some((l) => l.id === receivedLaser.id)) return prev;
        const updated = [...prev, receivedLaser];
        return updated.length > MAX_LASERS
          ? updated.slice(updated.length - MAX_LASERS)
          : updated;
      });
    } else if (msg.type === "respawn") {
      if (peerManager.getIsHost()) return;
      if (!isValidString(msg.playerId) || !isValidVector4(msg.position)) return;
      staleFrozenRef.current.delete(msg.playerId);
      lastUpdateTimeRef.current.set(msg.playerId, Date.now());
      handleRespawn(msg.playerId, msg.position);
    } else if (msg.type === "score") {
      if (peerManager.getIsHost()) return;
      const scores = parseScores(msg.scores);
      if (!scores) return;
      scoresRef.current = scores;
      setScores(scores);
    } else if (msg.type === "kill") {
      if (peerManager.getIsHost()) return;
      if (
        !isValidString(msg.victimId) ||
        !isValidString(msg.killerId) ||
        !isValidVector4(msg.hitPos)
      )
        return;
      // データ更新 + UI pending: handleKill で一括処理
      handleKill(msg.victimId, msg.killerId, msg.hitPos);
    } else if (msg.type === "hostMigration") {
      // Host migration: sync scores from new host.
      // Skip if we ARE the new host (we already have the state).
      if (peerManager.getIsHost()) return;
      if (!isValidString(msg.newHostId)) return;
      const scores = parseScores(msg.scores);
      if (!scores) return;
      scoresRef.current = scores;
      setScores(scores);
      // Sync display names from migrating host
      if (
        msg.displayNames &&
        typeof msg.displayNames === "object" &&
        !Array.isArray(msg.displayNames)
      ) {
        for (const [id, name] of Object.entries(msg.displayNames)) {
          if (isValidString(id) && isValidString(name, 20)) {
            displayNamesRef.current.set(id, name as string);
          }
        }
        // Propagate display names into existing player entries immediately
        setPlayers((prev) => {
          let changed = false;
          const next = new Map(prev);
          for (const [id, player] of next) {
            const dn = displayNamesRef.current.get(id);
            if (dn && player.displayName !== dn) {
              next.set(id, { ...player, displayName: dn });
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
      // eslint-disable-next-line no-console
      console.log(
        "[messageHandler] hostMigration received from",
        msg.newHostId,
        "scores:",
        scores,
      );
    }
  };
