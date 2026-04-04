import type React from "react";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
  vector3Zero,
} from "../../physics";
import { pickDistinctColor } from "./colors";
import { MAX_LASERS, MAX_PAST_WORLDLINES, RESPAWN_DELAY } from "./constants";
import { generateExplosionParticles } from "./debris";
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
  deadUntilRef: React.MutableRefObject<number>;
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
      deadUntilRef,
    } = deps;

    if (msg.type === "phaseSpace") {
      const playerId = msg.senderId;
      setPlayers((prev) => {
        const next = new Map(prev);

        const phaseSpace = createPhaseSpace(msg.position, msg.velocity);

        // 既存のプレイヤーの現在のライフに追加、または新規作成
        const existing = prev.get(playerId);
        const existingLives = existing?.lives || [];
        const lastLife =
          existingLives[existingLives.length - 1] || createWorldLine();
        // 死亡中（respawn 待ち）なら phaseSpace を無視
        if (
          lastLife.history.length === 0 &&
          lastLife.origin === null &&
          existingLives.length > 0
        )
          return prev;
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
        });
        return next;
      });
    } else if (msg.type === "syncTime") {
      // ホストから世界系時刻を受信 → 自分の t を揃える
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
        let newLife = createWorldLine();
        newLife = appendWorldLine(newLife, synced);
        const next = new Map(prev);
        next.set(myId, { ...me, phaseSpace: synced, lives: [newLife] });
        return next;
      });
    } else if (msg.type === "laser") {
      // 他プレイヤーからのレーザーを追加
      const receivedLaser: Laser = {
        id: msg.id,
        playerId: msg.playerId,
        emissionPos: msg.emissionPos,
        direction: msg.direction,
        range: msg.range,
        color: msg.color,
      };
      setLasers((prev) => {
        // 重複チェック
        if (prev.some((l) => l.id === receivedLaser.id)) {
          return prev;
        }
        const updated = [...prev, receivedLaser];
        // 最大数を超えたら古いものを削除
        if (updated.length > MAX_LASERS) {
          return updated.slice(updated.length - MAX_LASERS);
        }
        return updated;
      });
    } else if (msg.type === "respawn") {
      // リスポーン: 現在のライフ（空）に最初の点を追加
      setPlayers((prev) => {
        const player = prev.get(msg.playerId);
        if (!player) return prev;
        const respawnPhaseSpace = createPhaseSpace(
          createVector4(
            msg.position.t,
            msg.position.x,
            msg.position.y,
            msg.position.z,
          ),
          vector3Zero(),
        );
        const lastLife =
          player.lives[player.lives.length - 1] || createWorldLine();
        const updatedLife = appendWorldLine(lastLife, respawnPhaseSpace);
        const lives = [...player.lives.slice(0, -1), updatedLife];
        const next = new Map(prev);
        next.set(msg.playerId, {
          ...player,
          phaseSpace: respawnPhaseSpace,
          lives,
        });
        return next;
      });
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
      // 自分が死んだら画面フラッシュ + 物理停止
      if (msg.victimId === myId) {
        setDeathFlash(true);
        setTimeout(() => setDeathFlash(false), 600);
        deadUntilRef.current = Date.now() + RESPAWN_DELAY;
      }
      // 自分がキラーならキル通知
      if (msg.killerId === myId && msg.victimId !== myId) {
        const v = playersRef.current.get(msg.victimId);
        setKillNotification({
          victimName: msg.victimId.slice(0, 6),
          color: v?.color ?? "white",
        });
        setTimeout(() => setKillNotification(null), 1500);
      }
      // kill 時点で新ライフを開始 + デブリ記録
      setPlayers((prev) => {
        const victim = prev.get(msg.victimId);
        if (!victim) return prev;
        const debrisParticles = generateExplosionParticles();
        const debrisRecords = [
          ...victim.debrisRecords,
          {
            deathPos: msg.hitPos,
            particles: debrisParticles,
            color: victim.color,
          },
        ].slice(-MAX_PAST_WORLDLINES);
        const lives = [...victim.lives, createWorldLine()].slice(
          -MAX_PAST_WORLDLINES,
        );
        const next = new Map(prev);
        next.set(msg.victimId, { ...victim, lives, debrisRecords });
        return next;
      });
    } else if (msg.type === "playerColor") {
      // ホストからの色割り当て → 上書き（プレイヤー未到着なら一時保存）
      pendingColorsRef.current.set(msg.playerId, msg.color);
      setPlayers((prev) => {
        const player = prev.get(msg.playerId);
        if (!player) return prev; // まだ phaseSpace が届いていない → pendingColors に保存済み
        if (player.color === msg.color) return prev;
        const next = new Map(prev);
        next.set(msg.playerId, { ...player, color: msg.color });
        return next;
      });
    }
  };
