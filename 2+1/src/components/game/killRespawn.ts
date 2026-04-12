import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
  vector3Zero,
} from "../../physics";
import type { RelativisticPlayer } from "./types";

/**
 * Kill: isDead=true にするだけ。
 * 世界線の凍結（frozenWorldLines への移動）とデブリ生成は呼び出し元で行う。
 */
export const applyKill = (
  prev: Map<string, RelativisticPlayer>,
  victimId: string,
): Map<string, RelativisticPlayer> => {
  const victim = prev.get(victimId);
  if (!victim) return prev;
  const next = new Map(prev);
  next.set(victimId, { ...victim, isDead: true });
  return next;
};

/**
 * Respawn: 新しい WorldLine で復活 + isDead=false
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
  let newWorldLine = createWorldLine(5000); // リスポーン: origin なし（過去に半直線を伸ばさない）
  newWorldLine = appendWorldLine(newWorldLine, ps);
  const next = new Map(prev);
  next.set(playerId, {
    ...player,
    phaseSpace: ps,
    worldLine: newWorldLine,
    isDead: false,
  });
  return next;
};
