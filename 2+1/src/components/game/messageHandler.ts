import type React from "react";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
} from "../../physics";
import { colorForPlayerId } from "./colors"; // fallback for syncTime init
import { MAX_LASERS, MAX_WORLDLINE_HISTORY, SPAWN_RANGE } from "./constants";
import { getRespawnCoordTime } from "./respawnTime";
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

export const createMessageHandler =
  // biome-ignore lint/suspicious/noExplicitAny: Network messages require runtime validation
  (deps: MessageHandlerDeps) => (senderId: string, msg: any) => {
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
    } = deps;

    // Host: respond to requestPeerList with syncTime (client may have missed
    // the initial syncTime while still in the lobby before messageHandler was registered)
    if (msg.type === "requestPeerList" && peerManager.getIsHost()) {
      const me = playersRef.current.get(myId);
      if (me) {
        peerManager.sendTo(senderId, {
          type: "syncTime" as const,
          hostTime: me.phaseSpace.pos.t,
          scores: scoresRef.current,
        });
      }
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

      // Stale 復帰検知: stale 凍結されたプレイヤーから phaseSpace が来た
      if (staleFrozenRef.current.has(playerId)) {
        if (!peerManager.getIsHost()) return; // クライアントはホストの respawn を待つ
        // ホスト: maxT + ランダム位置でリスポーン（通常 respawn と同じ）
        const respawnPos = {
          t: getRespawnCoordTime(playersRef.current),
          x: Math.random() * SPAWN_RANGE,
          y: Math.random() * SPAWN_RANGE,
          z: 0,
        };
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
      if (
        msg.scores &&
        typeof msg.scores === "object" &&
        !Array.isArray(msg.scores)
      ) {
        const scores: Record<string, number> = {};
        for (const [key, val] of Object.entries(msg.scores)) {
          if (isValidString(key) && isFiniteNumber(val)) {
            scores[key] = val as number;
          }
        }
        scoresRef.current = scores;
        setScores(scores);
      }
      // Correct time coordinate to match host's time origin.
      // Player may already exist (self-initialized) — syncTime updates
      // the time coordinate and resets the world line.
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
      if (
        !msg.scores ||
        typeof msg.scores !== "object" ||
        Array.isArray(msg.scores)
      )
        return;
      // Validate each score entry
      const scores: Record<string, number> = {};
      for (const [key, val] of Object.entries(msg.scores)) {
        if (!isValidString(key) || !isFiniteNumber(val)) return;
        scores[key] = val as number;
      }
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
      if (
        !isValidString(msg.newHostId) ||
        !msg.scores ||
        typeof msg.scores !== "object" ||
        Array.isArray(msg.scores)
      )
        return;
      // Sync scores
      const scores: Record<string, number> = {};
      for (const [key, val] of Object.entries(msg.scores)) {
        if (isValidString(key) && isFiniteNumber(val)) {
          scores[key] = val as number;
        }
      }
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
