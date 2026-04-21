import { inverseLorentzBoost, multiplyVector4Matrix4 } from "./matrix";
import {
  addVector3,
  addVector4,
  createVector4,
  getVelocity4,
  quatIdentity,
  type Quaternion,
  scaleVector3,
  scaleVector4,
  spatialVector4,
  type Vector3,
  type Vector4,
  vector4Zero,
} from "./vector";

/**
 * Relativistic mechanics utilities.
 *
 * English:
 *   - `PhaseSpace` stores 4-position, spatial part of 4-velocity, orientation
 *     quaternion, and world-frame 4-acceleration.
 *   - `evolvePhaseSpace` integrates motion in **proper time** dτ using proper
 *     acceleration. Heading is transported unchanged (no angular integration
 *     in current spec; caller sets heading externally e.g. from camera yaw).
 *
 * 日本語:
 *   - `PhaseSpace` は 4元位置 + 4元速度の空間成分 + 姿勢 quaternion + 世界系
 *     4元加速度を保持します。
 *   - `evolvePhaseSpace` は固有時間 dτ で固有加速度を積分します。heading は
 *     そのまま運搬 (角速度統合は現仕様外、呼び出し側が camera yaw 等から設定)。
 */

/**
 * Phase space (4-position + spatial part of 4-velocity + orientation + 4-acceleration).
 *
 * - `heading`: 姿勢 quaternion。2+1 では yaw 1 自由度 (`yawToQuat(θ)`)、3+1 移行時
 *   そのまま全姿勢へ拡張。
 * - `alpha`: world 系 4-acceleration `α^μ` (制約 `u·α = 0` は構築時に保証)。
 *   rest 系の proper acceleration `a^i` を `L(−u)·(0, a)` で世界系に boost した値。
 *   静止 / 無加速で `(0, 0, 0, 0)`。
 *
 * 型拡張は 2026-04-21 から (plan `2026-04-21-phaseSpace-heading-accel.md`)。
 * 旧呼出サイトは heading/alpha の default 引数で救済 (identity / zero)。
 *
 * JP: 相対論的位相空間 (位置 + 速度 + 姿勢 + 加速度)。
 */
export type PhaseSpace = {
  readonly pos: Vector4;
  readonly u: Vector3;
  readonly heading: Quaternion;
  readonly alpha: Vector4;
};

/**
 * Create a PhaseSpace。heading/alpha は省略時に identity / zero。
 * JP: PhaseSpace を作成。heading/alpha は省略可。
 */
export const createPhaseSpace = (
  pos: Vector4,
  u: Vector3,
  heading: Quaternion = quatIdentity(),
  alpha: Vector4 = vector4Zero(),
): PhaseSpace => ({
  pos,
  u,
  heading,
  alpha,
});

/**
 * Time evolution under proper acceleration (relativistic equation of motion).
 *
 * English:
 *   - `properAcceleration` is defined in the instantaneous rest frame.
 *   - We transform it to the world frame with an inverse boost.
 *   - Integration variable is proper time dτ.
 *
 * 日本語:
 *   - `properAcceleration` は瞬間静止系で定義された固有加速度。
 *   - 逆ブーストで世界系へ変換して積分します。
 *   - 積分は固有時間 dτ で行います。
 */
export const evolvePhaseSpace = (
  ps: PhaseSpace,
  properAcceleration: Vector3,
  dTau: number,
): PhaseSpace => {
  // 1) Acceleration in the instantaneous rest frame (a^μ_rest).
  // JP: 瞬間静止系での加速度を4元ベクトルにする。
  const accel4Rest = createVector4(
    0.0,
    properAcceleration.x,
    properAcceleration.y,
    properAcceleration.z,
  );

  // 2) Rest frame → world frame.
  // JP: 静止系→世界系のローレンツ変換。
  const boostMatrix = inverseLorentzBoost(ps.u);
  const accel4World = multiplyVector4Matrix4(boostMatrix, accel4Rest);

  // 3) Update spatial part of 4-velocity: du/dτ = a (spatial part).
  // JP: 4元速度の空間成分を更新（du/dτ = a の空間成分）。
  const newU = addVector3(
    ps.u,
    scaleVector3(spatialVector4(accel4World), dTau),
  );

  // 4) Update position: dx/dτ = u^μ (semi-implicit Euler: uses newU, not old ps.u).
  // JP: 位置の更新（dx/dτ = u^μ、semi-implicit Euler: 加速後の newU を使用）。
  const newPos = addVector4(ps.pos, scaleVector4(getVelocity4(newU), dTau));

  // 5) heading は角速度統合なしで運搬、alpha は今回計算した world 系 4-加速度を格納。
  //    制約 u·α=0 は rest 系 (0, a) を Lorentz 変換しただけなので自動で満たされる。
  // JP: heading は保持、alpha は今ステップの world 4-加速度を格納。
  return createPhaseSpace(newPos, newU, ps.heading, accel4World);
};

