import {
  createVector4,
  pastLightConeIntersectionSegment,
  type Vector3,
  type Vector4,
} from "../../physics";
import { EXPLOSION_PARTICLE_COUNT } from "./constants";

/**
 * 爆発パーティクルの方向を生成（未来光円錐内をランダムに飛散）。
 * victimU（4元速度の空間成分 = 固有速度 γv）が与えられた場合、
 * その成分にランダム摂動を加え、ut = √(1 + ux² + uy² + uz²) で正規化。
 * 3速度 v = u_spatial / γ なので |v| < 1 は自動的に保証される。
 */
export const generateExplosionParticles = (victimU?: Vector3) => {
  const particles: { dx: number; dy: number; speed: number; size: number }[] =
    [];

  const baseUx = victimU?.x ?? 0;
  const baseUy = victimU?.y ?? 0;

  for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    // 固有速度空間でのランダム摂動幅: 0.2 ~ 2.0 (γv 単位)
    const kick = Math.random() * 0.8;
    const ux = baseUx + Math.cos(angle) * kick;
    const uy = baseUy + Math.sin(angle) * kick;
    // ut = γ = √(1 + |u|²)
    const ut = Math.sqrt(1 + ux * ux + uy * uy);
    // 3速度 = u_spatial / γ (自動的に |v| < 1)
    const dx = ux / ut;
    const dy = uy / ut;
    const speed = Math.sqrt(dx * dx + dy * dy);

    particles.push({
      dx,
      dy,
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
