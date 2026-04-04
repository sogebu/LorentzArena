import {
  type Vector4,
  createVector4,
  lorentzDotVector4,
  subVector4,
} from "../../physics";
import { EXPLOSION_PARTICLE_COUNT } from "./constants";

// 爆発パーティクルの方向を事前生成（未来光円錐内をランダムに飛散）
export const generateExplosionParticles = () => {
  const particles: { dx: number; dy: number; speed: number; size: number }[] = [];
  for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    // speed < 1 (光速未満) → 未来光円錐の内側を進む
    const speed = 0.2 + Math.random() * 0.7; // 0.2c ~ 0.9c
    particles.push({
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      speed,
      size: 0.2 + Math.random() * 0.4,
    });
  }
  return particles;
};

/**
 * Past light cone intersection for a debris particle (timelike straight worldline).
 *
 * Particle trajectory: P(λ) = start + λ * (dx, dy, 0, 1),  λ ∈ [0, maxLambda]
 * Solve lorentzDot(observer - P(λ), observer - P(λ)) = 0 for past intersection.
 */
export const pastLightConeIntersectionDebris = (
  start: Vector4,
  dx: number,
  dy: number,
  maxLambda: number,
  observerPos: Vector4,
): Vector4 | null => {
  // delta = direction 4-vector = (1, dx, dy, 0) * maxLambda → normalized to λ ∈ [0, 1]
  const delta = createVector4(maxLambda, dx * maxLambda, dy * maxLambda, 0);
  const sep = subVector4(observerPos, start);

  const a = lorentzDotVector4(delta, delta);
  const b = -2 * lorentzDotVector4(sep, delta);
  const c = lorentzDotVector4(sep, sep);

  const EPS = 1e-9;
  const candidates: number[] = [];

  if (Math.abs(a) < EPS) {
    if (Math.abs(b) < EPS) return null;
    candidates.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sqrtDisc = Math.sqrt(Math.max(0, disc));
    candidates.push((-b - sqrtDisc) / (2 * a));
    candidates.push((-b + sqrtDisc) / (2 * a));
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
    if (observerPos.t - point.t <= EPS) continue;
    if (!best || point.t > best.t) best = point;
  }

  return best;
};
