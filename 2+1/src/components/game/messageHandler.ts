import type React from "react";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
} from "../../physics";
import { pickDistinctColor } from "./colors";
import { MAX_LASERS } from "./constants";
import { applyKill, applyRespawn } from "./killRespawn";
import type { Laser, RelativisticPlayer, SpawnEffect } from "./types";

export type MessageHandlerDeps = {
  myId: string;
  peerManager: {
    getIsHost(): boolean;
    send(msg: unknown): void;
  };
  setPlayers: React.Dispatch<
    React.SetStateAction<Map<string, RelativisticPlayer>>
  >;
  setLasers: React.Dispatch<React.SetStateAction<Laser[]>>;
  setScores: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setSpawns: React.Dispatch<React.SetStateAction<SpawnEffect[]>>;
  setDeathFlash: React.Dispatch<React.SetStateAction<boolean>>;
  setKillNotification: React.Dispatch<
    React.SetStateAction<{ victimName: string; color: string } | null>
  >;
  scoresRef: React.RefObject<Record<string, number>>;
  playersRef: React.RefObject<Map<string, RelativisticPlayer>>;
  timeSyncedRef: React.MutableRefObject<boolean>;
  pendingColorsRef: React.RefObject<Map<string, string>>;
};

// biome-ignore lint/suspicious/noExplicitAny: Message type is generic from PeerManager
export const createMessageHandler =
  (deps: MessageHandlerDeps) => (_: string, msg: any) => {
    const {
      myId,
      peerManager,
      setPlayers,
      setLasers,
      setScores,
      setSpawns,
      setDeathFlash,
      setKillNotification,
      scoresRef,
      playersRef,
      timeSyncedRef,
      pendingColorsRef,
    } = deps;

    if (msg.type === "phaseSpace") {
      const playerId = msg.senderId;
      setPlayers((prev) => {
        const next = new Map(prev);

        const phaseSpace = createPhaseSpace(msg.position, msg.velocity);

        const existing = prev.get(playerId);
        // 死亡中（世界線凍結中）なら phaseSpace を無視
        if (existing?.isDead) return prev;

        const existingLives = existing?.lives || [];
        const lastLife =
          existingLives[existingLives.length - 1] ||
          createWorldLine(5000, phaseSpace); // 新規プレイヤーの最初のライフ: origin 付き
        const updatedLife = appendWorldLine(lastLife, phaseSpace);
        const lives =
          existingLives.length > 0
            ? [...existingLives.slice(0, -1), updatedLife]
            : [updatedLife];

        // 色の決定: pending にあればそれを使う、なければホストが割り当て
        let color = existing?.color;
        if (!color) {
          const pending = pendingColorsRef.current.get(playerId);
          if (pending) {
            color = pending;
            pendingColorsRef.current.delete(playerId);
          } else if (peerManager.getIsHost()) {
            color = pickDistinctColor(playerId, prev);
            peerManager.send({ type: "playerColor" as const, playerId, color });
          } else {
            color = "hsl(0, 0%, 70%)"; // 仮色（playerColor 受信まで）
          }
        }

        next.set(playerId, {
          id: playerId,
          phaseSpace,
          lives,
          debrisRecords: existing?.debrisRecords || [],
          color,
          isDead: false,
        });
        return next;
      });
    } else if (msg.type === "syncTime") {
      timeSyncedRef.current = true;
      setPlayers((prev) => {
        const me = prev.get(myId);
        if (!me) return prev;
        const synced = createPhaseSpace(
          createVector4(
            msg.hostTime,
            me.phaseSpace.pos.x,
            me.phaseSpace.pos.y,
            me.phaseSpace.pos.z,
          ),
          me.phaseSpace.u,
        );
        let newLife = createWorldLine(5000, synced); // 時刻同期: 最初のライフ、origin 付き
        newLife = appendWorldLine(newLife, synced);
        const next = new Map(prev);
        next.set(myId, { ...me, phaseSpace: synced, lives: [newLife] });
        return next;
      });
    } else if (msg.type === "laser") {
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
        if (updated.length > MAX_LASERS) {
          return updated.slice(updated.length - MAX_LASERS);
        }
        return updated;
      });
    } else if (msg.type === "respawn") {
      setPlayers((prev) => applyRespawn(prev, msg.playerId, msg.position));
      // スポーンエフェクト
      const spawningPlayer = playersRef.current.get(msg.playerId);
      setSpawns((prev) => [
        ...prev,
        {
          id: `spawn-${msg.playerId}-${Date.now()}`,
          pos: msg.position,
          color: spawningPlayer?.color ?? "white",
          startTime: Date.now(),
        },
      ]);
    } else if (msg.type === "score") {
      scoresRef.current = msg.scores;
      setScores(msg.scores);
    } else if (msg.type === "kill") {
      // UI 副作用
      if (msg.victimId === myId) {
        setDeathFlash(true);
        setTimeout(() => setDeathFlash(false), 600);
      }
      if (msg.killerId === myId && msg.victimId !== myId) {
        const v = playersRef.current.get(msg.victimId);
        setKillNotification({
          victimName: msg.victimId.slice(0, 6),
          color: v?.color ?? "white",
        });
        setTimeout(() => setKillNotification(null), 1500);
      }
      // 状態更新: 世界線凍結 + デブリ + isDead
      setPlayers((prev) => applyKill(prev, msg.victimId, msg.hitPos));
    } else if (msg.type === "playerColor") {
      pendingColorsRef.current.set(msg.playerId, msg.color);
      setPlayers((prev) => {
        const player = prev.get(msg.playerId);
        if (!player) return prev;
        if (player.color === msg.color) return prev;
        const next = new Map(prev);
        next.set(msg.playerId, { ...player, color: msg.color });
        return next;
      });
    }
  };
