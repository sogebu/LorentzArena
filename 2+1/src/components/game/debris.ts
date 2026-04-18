import {
  createVector4,
  pastLightConeIntersectionSegment,
  type Vector3,
  type Vector4,
} from "../../physics";
import {
  EXPLOSION_PARTICLE_COUNT,
  HIT_DEBRIS_KICK,
  HIT_DEBRIS_PARTICLE_COUNT,
} from "./constants";

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
 * Phase C1: 非致命ヒットのデブリ方向生成。爆発 (`generateExplosionParticles`)
 * の「半分」コンセプト: 個数・kick 幅・size を半分以下に。散らし中心は
 * **時空ベクトル** k^μ + u^μ の空間成分 ( = laserDir + victimU ) を baseU と
 * 解釈し、そこから固有速度空間で狭い cone 内にランダム摂動。
 *   k^μ (null laser): (1, dx_L, dy_L, 0)
 *   u^μ (victim): (γ, u_x, u_y, 0)
 * spatial(k+u) = (dx_L + u_x, dy_L + u_y) を baseU として、ut=√(1+|u|²) で
 * 3 速度 v = u/ut に落とす (自動的に |v|<1)。
 */
export const generateHitParticles = (victimU: Vector3, laserDir: Vector3) => {
  const particles: { dx: number; dy: number; speed: number; size: number }[] =
    [];

  const baseUx = laserDir.x + victimU.x;
  const baseUy = laserDir.y + victimU.y;

  for (let i = 0; i < HIT_DEBRIS_PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const kick = Math.random() * HIT_DEBRIS_KICK;
    const ux = baseUx + Math.cos(angle) * kick;
    const uy = baseUy + Math.sin(angle) * kick;
    const ut = Math.sqrt(1 + ux * ux + uy * uy);
    const dx = ux / ut;
    const dy = uy / ut;
    const speed = Math.sqrt(dx * dx + dy * dy);

    particles.push({
      dx,
      dy,
      speed,
      // size は explosion (0.2 + random*0.4) の半分。opacity も半分
      // (HIT_DEBRIS_*_OPACITY)。「爆発の半分」コンセプトに準拠
      // (2026-04-18 odakin 第 3 次指定)。
      size: 0.1 + Math.random() * 0.2,
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
