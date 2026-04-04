import {
  type Vector4,
  type WorldLine,
  createVector4,
  lorentzDotVector4,
  subVector4,
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

    const checkAtMu = (mu: number): { t: number; x: number; y: number; z: number } | null => {
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
 *
 * English:
 *   - Laser trajectory is modeled as a spacetime segment:
 *       X(lambda) = start + lambda * (end - start), lambda in [0, 1]
 *   - We solve lorentzDot(observer - X, observer - X) = 0 and keep the past solution.
 *
 * 日本語:
 *   - レーザー軌跡を時空区間として扱い、
 *       X(lambda) = start + lambda * (end - start), lambda in [0, 1]
 *   - lorentzDot(observer - X, observer - X) = 0 を解いて、
 *     観測者より過去にある解のみ採用します。
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

  const delta = subVector4(end, start);
  const separationAtStart = subVector4(observerPos, start);

  // a*lambda^2 + b*lambda + c = 0
  const a = lorentzDotVector4(delta, delta);
  const b = -2 * lorentzDotVector4(separationAtStart, delta);
  const c = lorentzDotVector4(separationAtStart, separationAtStart);

  const EPS = 1e-9;
  const candidates: number[] = [];

  // Laser segment is (almost) lightlike, so treat near-linear case robustly.
  if (Math.abs(a) < EPS) {
    if (Math.abs(b) < EPS) return null;
    candidates.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const sqrtDiscriminant = Math.sqrt(Math.max(0, discriminant));
    candidates.push((-b - sqrtDiscriminant) / (2 * a));
    candidates.push((-b + sqrtDiscriminant) / (2 * a));
  }

  let best: Vector4 | null = null;
  for (const lambda of candidates) {
    if (lambda < -EPS || lambda > 1 + EPS) continue;
    const t = Math.min(1, Math.max(0, lambda));
    const point = createVector4(
      start.t + delta.t * t,
      start.x + delta.x * t,
      start.y + delta.y * t,
      start.z + delta.z * t,
    );

    // We only want events in observer's past.
    if (observerPos.t - point.t <= EPS) continue;
    if (!best || point.t > best.t) best = point;
  }

  return best;
};
