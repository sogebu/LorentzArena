import type React from "react";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
} from "../../physics";
import { pickDistinctColor } from "./colors";
import { MAX_LASERS } from "./constants";
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
  handleKill: (
    victimId: string,
    hitPos: { t: number; x: number; y: number; z: number },
  ) => void;
  handleRespawn: (
    playerId: string,
    position: { t: number; x: number; y: number; z: number },
  ) => void;
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

const isValidVector3 = (
  v: unknown,
): v is { x: number; y: number; z: number } =>
  v != null &&
  typeof v === "object" &&
  isFiniteNumber((v as Record<string, unknown>).x) &&
  isFiniteNumber((v as Record<string, unknown>).y) &&
  isFiniteNumber((v as Record<string, unknown>).z);

const isValidColor = (v: unknown): v is string =>
  typeof v === "string" && v.length < 100 && /^(hsl|rgb|#)/i.test(v);

export const createMessageHandler =
  // biome-ignore lint/suspicious/noExplicitAny: Network messages require runtime validation
  (deps: MessageHandlerDeps) => (_: string, msg: any) => {
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    const {
      myId,
      peerManager,
      setPlayers,
      setLasers,
      setScores,
      setDeathFlash,
      setKillNotification,
      scoresRef,
      playersRef,
      timeSyncedRef,
      pendingColorsRef,
      handleKill,
      handleRespawn,
    } = deps;

    if (msg.type === "phaseSpace") {
      if (!isValidVector4(msg.position) || !isValidVector3(msg.velocity))
        return;
      const playerId = msg.senderId;
      setPlayers((prev) => {
        const next = new Map(prev);

        const phaseSpace = createPhaseSpace(msg.position, msg.velocity);

        const existing = prev.get(playerId);
        // 死亡中（世界線凍結中）なら phaseSpace を無視
        if (existing?.isDead) return prev;

        const existingWorldLine = existing?.worldLine;
        const worldLine = existingWorldLine
          ? appendWorldLine(existingWorldLine, phaseSpace)
          : (() => {
              let wl = createWorldLine(5000, phaseSpace); // 新規プレイヤー: origin 付き
              wl = appendWorldLine(wl, phaseSpace);
              return wl;
            })();

        // 色の決定
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
            color = "hsl(0, 0%, 70%)";
          }
        }

        next.set(playerId, {
          id: playerId,
          phaseSpace,
          worldLine,
          color,
          isDead: false,
        });
        return next;
      });
    } else if (msg.type === "syncTime") {
      if (!isFiniteNumber(msg.hostTime)) return;
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
        let newWorldLine = createWorldLine(5000, synced);
        newWorldLine = appendWorldLine(newWorldLine, synced);
        const next = new Map(prev);
        next.set(myId, { ...me, phaseSpace: synced, worldLine: newWorldLine });
        return next;
      });
    } else if (msg.type === "laser") {
      if (
        !isValidVector4(msg.emissionPos) ||
        !isValidVector3(msg.direction) ||
        !isFiniteNumber(msg.range) ||
        msg.range > 1000
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
      if (!isValidVector4(msg.position)) return;
      handleRespawn(msg.playerId, msg.position);
    } else if (msg.type === "score") {
      if (peerManager.getIsHost()) return;
      scoresRef.current = msg.scores;
      setScores(msg.scores);
    } else if (msg.type === "kill") {
      if (peerManager.getIsHost()) return;
      if (!isValidVector4(msg.hitPos)) return;
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
      // データ更新: handleKill で世界線凍結 + デブリ生成 + isDead
      handleKill(msg.victimId, msg.hitPos);
    } else if (msg.type === "playerColor") {
      if (!isValidColor(msg.color)) return;
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
