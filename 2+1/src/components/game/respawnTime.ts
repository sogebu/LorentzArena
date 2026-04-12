import { OFFSET } from "./constants";
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
