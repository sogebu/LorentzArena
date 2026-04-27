import { createVector4, isInPastLightCone, type Vector4 } from "../../physics";
import type { KillEventRecord, PendingSpawnEvent, SpawnEffect } from "./types";

export interface KillEventEffects {
  deathFlash: boolean;
  killNotification: {
    victimId: string;
    victimName: string;
    color: string;
    hitPos: { t: number; x: number; y: number; z: number };
  } | null;
}

export interface KillEventsResult {
  /** Indices into the input killLog whose firedForUi should be set true. */
  firedIndices: number[];
  newScores: Record<string, number>;
  effects: KillEventEffects;
}

/**
 * Fire UI effects for kill events that have just entered the observer's past
 * light cone. Consumes un-fired entries from `killLog` (those with
 * `firedForUi === false`); returns log indices to flag.
 *
 * `torusHalfWidth` 指定時は最短画像で過去光円錐到達判定 (= PBC で 1 周回って戻ってきた
 * event も近い image cell 経由で発火される)。
 */
export function firePendingKillEvents(
  killLog: KillEventRecord[],
  myPos: Vector4,
  myId: string,
  scores: Record<string, number>,
  torusHalfWidth?: number,
): KillEventsResult {
  const firedIndices: number[] = [];
  const newScores = { ...scores };
  let deathFlash = false;
  let killNotification: KillEventEffects["killNotification"] = null;

  for (let i = 0; i < killLog.length; i++) {
    const ev = killLog[i];
    if (ev.firedForUi) continue;
    const hitPosV4 = createVector4(
      ev.hitPos.t,
      ev.hitPos.x,
      ev.hitPos.y,
      ev.hitPos.z,
    );
    if (isInPastLightCone(hitPosV4, myPos, torusHalfWidth)) {
      firedIndices.push(i);
      newScores[ev.killerId] = (newScores[ev.killerId] || 0) + 1;
      if (ev.victimId === myId) {
        deathFlash = true;
      }
      if (ev.killerId === myId && ev.victimId !== myId) {
        killNotification = {
          victimId: ev.victimId,
          victimName: ev.victimName,
          color: ev.victimColor,
          hitPos: ev.hitPos,
        };
      }
    }
  }

  return { firedIndices, newScores, effects: { deathFlash, killNotification } };
}

export interface SpawnEventsResult {
  firedSpawns: SpawnEffect[];
  remaining: PendingSpawnEvent[];
}

export function firePendingSpawnEvents(
  pending: PendingSpawnEvent[],
  myPos: Vector4,
  fireTime: number,
  players: Map<string, { color: string }>,
  torusHalfWidth?: number,
): SpawnEventsResult {
  const firedSpawns: SpawnEffect[] = [];
  const remaining: PendingSpawnEvent[] = [];

  for (const ev of pending) {
    const spawnPosV4 = createVector4(ev.pos.t, ev.pos.x, ev.pos.y, ev.pos.z);
    if (isInPastLightCone(spawnPosV4, myPos, torusHalfWidth)) {
      // Resolve color from current player state (joinRegistry may have updated since creation)
      const resolvedColor = players.get(ev.playerId)?.color ?? ev.color;
      firedSpawns.push({
        id: ev.id,
        pos: ev.pos,
        color: resolvedColor,
        startTime: fireTime,
      });
    } else {
      remaining.push(ev);
    }
  }

  return { firedSpawns, remaining };
}
