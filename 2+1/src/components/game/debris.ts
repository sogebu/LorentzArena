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
 * 爆発パーティクル生成。 各 particle は 4-velocity 空間成分 `(ux, uy)` (= γ·v) で持つ
 * (DESIGN.md §「共変表現の徹底」)。 victim の 4-velocity 空間成分 `victimU` を中心に
 * 「固有速度空間 (γv 空間)」 で random kick を加える。 |v|<1 制約は別途要らず u 空間で
 * 自由に取れる。
 */
export const generateExplosionParticles = (victimU?: Vector3) => {
  const particles: { ux: number; uy: number; size: number }[] = [];

  const baseUx = victimU?.x ?? 0;
  const baseUy = victimU?.y ?? 0;

  for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    // 固有速度空間 (γv 単位) でのランダム摂動幅: 0 ~ 0.8。
    const kick = Math.random() * 0.8;
    const ux = baseUx + Math.cos(angle) * kick;
    const uy = baseUy + Math.sin(angle) * kick;
    particles.push({
      ux,
      uy,
      size: 0.2 + Math.random() * 0.4,
    });
  }
  return particles;
};

/**
 * Phase C1: 非致命ヒットのデブリ生成。 `generateExplosionParticles` の「半分」
 * コンセプト: 個数 / kick 幅 / size を半分以下に。 散らし中心は **時空ベクトルの空間成分**
 *   spatial(k^μ + u^μ) = laserDir + victimU
 * を baseU と解釈 (= 入射 null vector の空間成分 + victim の 4-velocity 空間成分)、
 * 固有速度空間 (γv 単位) で狭い cone 内にランダム摂動。 各 particle は 4-velocity 空間
 * 成分 `(ux, uy)` で出力 (DESIGN.md §「共変表現の徹底」)。
 */
export const generateHitParticles = (victimU: Vector3, laserDir: Vector3) => {
  const particles: { ux: number; uy: number; size: number }[] = [];

  const baseUx = laserDir.x + victimU.x;
  const baseUy = laserDir.y + victimU.y;

  for (let i = 0; i < HIT_DEBRIS_PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const kick = Math.random() * HIT_DEBRIS_KICK;
    const ux = baseUx + Math.cos(angle) * kick;
    const uy = baseUy + Math.sin(angle) * kick;
    particles.push({
      ux,
      uy,
      size: 0.2 + Math.random() * 0.4,
    });
  }
  return particles;
};

/**
 * Past light cone intersection for a debris particle (timelike straight worldline)。
 * 4-velocity `(ut, ux, uy, 0)` で proper-time 単位の direction 4-vector を形成し
 * `pastLightConeIntersectionSegment` に委譲。
 *
 * `dTauMax` は particle の最大固有時間 (= 寿命)。 内部で `(ut*dTauMax, ux*dTauMax,
 * uy*dTauMax, 0)` の delta 4-vector を作る (= 4-velocity を proper time で積分した
 * 共変量、 DESIGN.md §「共変表現の徹底」)。
 */
export const pastLightConeIntersectionDebris = (
  start: Vector4,
  ux: number,
  uy: number,
  dTauMax: number,
  observerPos: Vector4,
): Vector4 | null => {
  const ut = Math.sqrt(1 + ux * ux + uy * uy);
  const delta = createVector4(
    ut * dTauMax,
    ux * dTauMax,
    uy * dTauMax,
    0,
  );
  return pastLightConeIntersectionSegment(start, delta, observerPos);
};
