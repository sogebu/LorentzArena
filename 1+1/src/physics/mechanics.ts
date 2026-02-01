import {
  type Vector3,
  type Vector4,
  createVector4,
  getVelocity4,
  addVector3,
  addVector4,
  scaleVector3,
  scaleVector4,
  spatialVector4,
} from "./vector";
import { inverseLorentzBoost, multiplyVector4Matrix4 } from "./matrix";

/**
 * Relativistic mechanics utilities.
 *
 * English:
 *   - `PhaseSpace` stores 4-position and (spatial part of) 4-velocity.
 *   - `evolvePhaseSpace` integrates motion in **proper time** dτ using proper acceleration.
 *
 * 日本語:
 *   - `PhaseSpace` は 4元位置と4元速度の空間成分を保持します。
 *   - `evolvePhaseSpace` は固有時間 dτ で固有加速度を積分します。
 */

/**
 * Phase space (4-position + spatial part of 4-velocity).
 * JP: 相対論的位相空間（4元位置 + 4元速度の空間成分）。
 */
export type PhaseSpace = {
  readonly pos: Vector4;
  readonly u: Vector3;
};

/**
 * Create a PhaseSpace.
 * JP: PhaseSpace を作成。
 */
export const createPhaseSpace = (pos: Vector4, u: Vector3): PhaseSpace => ({
  pos,
  u,
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

  // 4) Update position: dx/dτ = u^μ.
  // JP: 位置の更新（dx/dτ = u^μ）。
  const newPos = addVector4(ps.pos, scaleVector4(getVelocity4(newU), dTau));

  return createPhaseSpace(newPos, newU);
};

/**
 * Past light-cone intersection (what the observer can actually see).
 *
 * English:
 *   - This is a placeholder and is not used by the current renderer.
 *   - The actual intersection logic lives in the game component.
 *
 * 日本語:
 *   - これは未実装のプレースホルダで、現状の描画では使っていません。
 *   - 実際の交点計算はコンポーネント側にあります。
 */
export const pastLightConeIntersectionPhaseSpace = (
  _observerPos: Vector4,
  worldline: PhaseSpace[],
): PhaseSpace | null => {
  return worldline[worldline.length - 1] || null;
};
