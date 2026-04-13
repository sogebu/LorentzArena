import { createVector4, isInPastLightCone, type Vector4 } from "../../physics";
import type { PendingKillEvent, PendingSpawnEvent, SpawnEffect } from "./types";

export interface KillEventEffects {
  deathFlash: boolean;
  killNotification: {
    victimName: string;
    color: string;
    hitPos: { t: number; x: number; y: number; z: number };
  } | null;
}

export interface KillEventsResult {
  firedIndices: number[];
  newScores: Record<string, number>;
  effects: KillEventEffects;
}

export function firePendingKillEvents(
  pending: PendingKillEvent[],
  myPos: Vector4,
  myId: string,
  scores: Record<string, number>,
): KillEventsResult {
  const firedIndices: number[] = [];
  const newScores = { ...scores };
  let deathFlash = false;
  let killNotification: KillEventEffects["killNotification"] = null;

  for (let i = 0; i < pending.length; i++) {
    const ev = pending[i];
    const hitPosV4 = createVector4(ev.hitPos.t, ev.hitPos.x, ev.hitPos.y, ev.hitPos.z);
    if (isInPastLightCone(hitPosV4, myPos)) {
      firedIndices.push(i);
      newScores[ev.killerId] = (newScores[ev.killerId] || 0) + 1;
      if (ev.victimId === myId) {
        deathFlash = true;
      }
      if (ev.killerId === myId && ev.victimId !== myId) {
        killNotification = {
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
): SpawnEventsResult {
  const firedSpawns: SpawnEffect[] = [];
  const remaining: PendingSpawnEvent[] = [];

  for (const ev of pending) {
    const spawnPosV4 = createVector4(ev.pos.t, ev.pos.x, ev.pos.y, ev.pos.z);
    if (isInPastLightCone(spawnPosV4, myPos)) {
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
