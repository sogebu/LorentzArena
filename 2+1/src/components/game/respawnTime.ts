import { OFFSET, SPAWN_RANGE } from "./constants";
import type { RelativisticPlayer } from "./types";

/**
 * リスポーン用の座標時間を算出。
 * 生存プレイヤーがいれば最大の座標時間、全員死亡なら壁時計から算出。
 */
export const getRespawnCoordTime = (
  players: Map<string, RelativisticPlayer>,
): number => {
  let maxT = Number.NEGATIVE_INFINITY;
  for (const [, p] of players) {
    if (p.isDead) continue;
    const t = p.phaseSpace.pos.t;
    if (Number.isFinite(t) && t > maxT) maxT = t;
  }
  return Number.isFinite(maxT) ? maxT : Date.now() / 1000 - OFFSET;
};

/**
 * リスポーン位置を生成（座標時間 + ランダム空間位置）。
 */
export const createRespawnPosition = (
  players: Map<string, RelativisticPlayer>,
): { t: number; x: number; y: number; z: number } => ({
  t: getRespawnCoordTime(players),
  x: Math.random() * SPAWN_RANGE,
  y: Math.random() * SPAWN_RANGE,
  z: 0,
});
