import {
  createVector4,
  pastLightConeIntersectionSegment,
  subVector4,
  type Vector4,
  type WorldLine,
} from "../../physics";
import type { Laser } from "./types";

/**
 * Find the hit position where a laser intersects a world line.
 * Returns the world-frame hit position (on the player's worldline), or null if no hit.
 *
 * Laser trajectory: L(λ) = emissionPos + λ * (dir, 1),  λ ∈ [0, range]
 * World line segment: W(μ) = p1 + μ * (p2 - p1),  μ ∈ [0, 1]
 */
export const findLaserHitPosition = (
  laser: Laser,
  worldLine: WorldLine,
  hitRadius: number,
): { t: number; x: number; y: number; z: number } | null => {
  const history = worldLine.history;
  if (history.length < 2) return null;

  const eT = laser.emissionPos.t;
  const eX = laser.emissionPos.x;
  const eY = laser.emissionPos.y;
  const dX = laser.direction.x;
  const dY = laser.direction.y;
  const range = laser.range;
  const r2 = hitRadius * hitRadius;

  for (let i = 1; i < history.length; i++) {
    const p1 = history[i - 1].pos;
    const p2 = history[i].pos;

    const wdT = p2.t - p1.t;
    const wdX = p2.x - p1.x;
    const wdY = p2.y - p1.y;

    const checkAtMu = (
      mu: number,
    ): { t: number; x: number; y: number; z: number } | null => {
      if (mu < 0 || mu > 1) return null;
      const lambda = p1.t + mu * wdT - eT;
      if (lambda < 0 || lambda > range) return null;

      const dx = eX + dX * lambda - (p1.x + mu * wdX);
      const dy = eY + dY * lambda - (p1.y + mu * wdY);
      if (dx * dx + dy * dy > r2) return null;

      // ヒット位置はプレイヤーのワールドライン上の点
      return {
        t: p1.t + mu * wdT,
        x: p1.x + mu * wdX,
        y: p1.y + mu * wdY,
        z: 0,
      };
    };

    const hit0 = checkAtMu(0);
    if (hit0) return hit0;
    const hit1 = checkAtMu(1);
    if (hit1) return hit1;

    const lambda0 = p1.t - eT;
    const A = eX + dX * lambda0 - p1.x;
    const a = dX * wdT - wdX;
    const B = eY + dY * lambda0 - p1.y;
    const b = dY * wdT - wdY;

    const denom = a * a + b * b;
    if (denom > 1e-12) {
      const muStar = -(a * A + b * B) / denom;
      const hitStar = checkAtMu(muStar);
      if (hitStar) return hitStar;
    }
  }

  return null;
};

/**
 * Find intersection of "observer past light cone" and a laser world-line segment.
 * Delegates to the generic pastLightConeIntersectionSegment solver.
 *
 * JP: レーザー軌跡を時空区間に変換し、汎用ソルバーで過去光円錐交差を求める。
 */
export const pastLightConeIntersectionLaser = (
  laser: Laser,
  observerPos: Vector4,
): Vector4 | null => {
  const start = createVector4(
    laser.emissionPos.t,
    laser.emissionPos.x,
    laser.emissionPos.y,
    laser.emissionPos.z,
  );
  const end = createVector4(
    laser.emissionPos.t + laser.range,
    laser.emissionPos.x + laser.direction.x * laser.range,
    laser.emissionPos.y + laser.direction.y * laser.range,
    laser.emissionPos.z + laser.direction.z * laser.range,
  );
  return pastLightConeIntersectionSegment(start, subVector4(end, start), observerPos);
};
