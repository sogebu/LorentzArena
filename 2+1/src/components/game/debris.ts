import {
  createVector4,
  pastLightConeIntersectionSegment,
  type Vector4,
} from "../../physics";
import { EXPLOSION_PARTICLE_COUNT } from "./constants";

// 爆発パーティクルの方向を事前生成（未来光円錐内をランダムに飛散）
export const generateExplosionParticles = () => {
  const particles: { dx: number; dy: number; speed: number; size: number }[] =
    [];
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
 * Delegates to the generic pastLightConeIntersectionSegment solver.
 *
 * JP: デブリ粒子の時空直線と観測者の過去光円錐の交差を汎用ソルバーで求める。
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
  return pastLightConeIntersectionSegment(start, delta, observerPos);
};
