import {
  type Vector3,
  type Vector4,
  createVector4,
  getVelocity4,
  addVector3,
  addVector4,
  scaleVector3,
  scaleVector4,
} from "./vector";
import {
  inverseLorentzBoost,
  multiplyVector4Matrix4,
} from "./matrix";

/**
 * 相対論的位相空間（4元位置と4元速度）型
 */
export type PhaseSpace = {
  readonly pos: Vector4;
  readonly u: Vector3;
};

/**
 * 相対論的位相空間を作成
 */
export const createPhaseSpace = (  pos: Vector4,  u: Vector3): PhaseSpace => ({  pos,  u });

/**
 * 加速度による時間発展（相対論的運動方程式）
 * @param ps 現在の世界系での位相空間
 * @param properAcceleration 固有加速度（瞬間静止系での加速度）
 * @param dTau 固有時間の変化量
 */
export const evolvePhaseSpace = (
  ps: PhaseSpace,
  properAcceleration: Vector3,
  dTau: number,
): PhaseSpace => {
  // 瞬間静止系での加速度を現在の系に変換
  const accel4Rest = createVector4(
    0.0,
    properAcceleration.x,
    properAcceleration.y,
    properAcceleration.z,
  );

  // 静止系→世界系のローレンツ変換を作る
  const boostMatrix = inverseLorentzBoost(ps.u);
  const accel4 = multiplyVector4Matrix4(boostMatrix, accel4Rest);

  // 4元速度の更新（du/dτ = a）
  const newU = addVector3(ps.u, scaleVector3(accel4, dTau));

  // 位置の更新（dx/dτ = u）
  const newPos = addVector4(
    ps.pos,
    scaleVector4(getVelocity4(newU), dTau),
  );

  return createPhaseSpace(newPos, newU);
};

/**
 * 過去光円錐との交点を計算（観測者が実際に見る位置）
 * @param _observerPos 観測者の4元位置
 * @param worldline 対象のワールドライン（時系列）
 */
export const pastLightConeIntersectionPhaseSpace = (
  _observerPos: Vector4,
  worldline: PhaseSpace[],
): PhaseSpace | null => {
  // 簡略化のため、最新の位置を返す
  // TODO: 実際の過去光円錐交点計算を実装
  return worldline[worldline.length - 1] || null;
};
