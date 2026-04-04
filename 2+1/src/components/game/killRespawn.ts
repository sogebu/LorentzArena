import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
  vector3Zero,
} from "../../physics";
import { MAX_PAST_WORLDLINES } from "./constants";
import { generateExplosionParticles } from "./debris";
import type { RelativisticPlayer } from "./types";

/**
 * Kill: 世界線を凍結（そのまま残す）+ デブリ記録 + isDead=true
 * 純粋関数: setPlayers(prev => applyKill(prev, victimId, hitPos)) として使う
 */
export const applyKill = (
  prev: Map<string, RelativisticPlayer>,
  victimId: string,
  hitPos: { t: number; x: number; y: number; z: number },
): Map<string, RelativisticPlayer> => {
  const victim = prev.get(victimId);
  if (!victim) return prev;
  const debrisParticles = generateExplosionParticles();
  const debrisRecords = [
    ...victim.debrisRecords,
    { deathPos: hitPos, particles: debrisParticles, color: victim.color },
  ].slice(-MAX_PAST_WORLDLINES);
  const next = new Map(prev);
  next.set(victimId, { ...victim, debrisRecords, isDead: true });
  return next;
};

/**
 * Respawn: 新しい WorldLine を lives に追加（前の世界線とは完全に独立）+ isDead=false
 * 純粋関数: setPlayers(prev => applyRespawn(prev, playerId, position)) として使う
 */
export const applyRespawn = (
  prev: Map<string, RelativisticPlayer>,
  playerId: string,
  position: { t: number; x: number; y: number; z: number },
): Map<string, RelativisticPlayer> => {
  const player = prev.get(playerId);
  if (!player) return prev;
  const ps = createPhaseSpace(
    createVector4(position.t, position.x, position.y, position.z),
    vector3Zero(),
  );
  let newLife = createWorldLine();
  newLife = appendWorldLine(newLife, ps);
  const lives = [...player.lives, newLife].slice(-MAX_PAST_WORLDLINES);
  const next = new Map(prev);
  next.set(playerId, { ...player, phaseSpace: ps, lives, isDead: false });
  return next;
};
