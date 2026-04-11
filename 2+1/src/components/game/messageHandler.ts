import type React from "react";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
} from "../../physics";
import { colorForPlayerId } from "./colors"; // fallback for syncTime init
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
  scoresRef: React.RefObject<Record<string, number>>;
  timeSyncedRef: React.MutableRefObject<boolean>;
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
  (deps: MessageHandlerDeps) => (_: string, msg: any) => {
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    const {
      myId,
      peerManager,
      setPlayers,
      setLasers,
      setScores,
      scoresRef,
      timeSyncedRef,
      handleKill,
      handleRespawn,
      getPlayerColor,
    } = deps;

    if (msg.type === "phaseSpace") {
      if (
        !isValidString(msg.senderId) ||
        !isValidVector4(msg.position) ||
        !isValidVector3(msg.velocity)
      )
        return;
      const playerId = msg.senderId;
      setPlayers((prev) => {
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

        // 色は ID から決定的に算出（純関数、副作用なし）
        const color = existing?.color ?? getPlayerColor(playerId);

        const next = new Map(prev);
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
      // ランダム値を reducer 外で生成（StrictMode 安全）
      const spawnX = Math.random() * 20; // SPAWN_RANGE
      const spawnY = Math.random() * 20;
      setPlayers((prev) => {
        const me = prev.get(myId);
        // ホストの座標時刻でプレイヤーを作成/更新。
        // クライアントはこの時点で初めてプレイヤーを作成する
        // （init effect はホスト専用、クライアントは syncTime で初期化）。
        const synced = createPhaseSpace(
          createVector4(
            msg.hostTime,
            me?.phaseSpace.pos.x ?? spawnX,
            me?.phaseSpace.pos.y ?? spawnY,
            0,
          ),
          me?.phaseSpace.u ?? { x: 0, y: 0, z: 0 },
        );
        let newWorldLine = createWorldLine(5000, synced);
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
      // eslint-disable-next-line no-console
      console.log(
        "[messageHandler] hostMigration received from",
        msg.newHostId,
        "scores:",
        scores,
      );
    }
  };
