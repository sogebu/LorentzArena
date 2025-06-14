import {
  type Vector3,
  type Vector4,
  createVector3,
  createVector4,
  lengthSquaredVector3,
  gammaVector3,
  spatialVector4,
  normalizeVelocity4,
  addVector4,
  scaleVector4,
  scaleVector3,
} from "./vector";
import {
  lorentzBoostFrom4Velocity,
  lorentzBoost,
  multiplyVector4Matrix4,
} from "./matrix";

/**
 * 相対論的位相空間（4元位置と4元速度）型
 */
export type PhaseSpace = {
  readonly position4: Vector4;
  readonly velocity4: Vector4;
};

/**
 * 相対論的位相空間を作成
 */
export const createPhaseSpace = (
  position4: Vector4,
  velocity4: Vector4,
): PhaseSpace => ({
  position4,
  // 4元速度を正規化（u·u = -1）
  velocity4: normalizeVelocity4(velocity4),
});

/**
 * 3次元位置と3次元速度から位相空間を作成
 */
export const phaseSpaceFromPosition3Velocity3 = (
  position: Vector3,
  velocity: Vector3,
  coordinateTime = 0,
): PhaseSpace => {
  if (lengthSquaredVector3(velocity) >= 1) {
    throw new Error("速度が光速を超えています");
  }

  const gamma = gammaVector3(velocity);
  const position4 = createVector4(
    coordinateTime,
    position.x,
    position.y,
    position.z,
  );
  const velocity4 = createVector4(
    gamma,
    gamma * velocity.x,
    gamma * velocity.y,
    gamma * velocity.z,
  );

  return createPhaseSpace(position4, velocity4);
};

/**
 * 3次元位置を取得
 */
export const getPositionPhaseSpace = (ps: PhaseSpace): Vector3 =>
  spatialVector4(ps.position4);

/**
 * 3次元速度を取得
 */
export const getVelocityPhaseSpace = (ps: PhaseSpace): Vector3 => {
  const gamma = ps.velocity4.t;
  return createVector3(
    ps.velocity4.x / gamma,
    ps.velocity4.y / gamma,
    ps.velocity4.z / gamma,
  );
};

/**
 * ガンマ因子を取得
 */
export const getGammaPhaseSpace = (ps: PhaseSpace): number => ps.velocity4.t;

/**
 * 固有時間を取得（worldlineに沿った時間）
 */
export const getProperTimePhaseSpace = (ps: PhaseSpace): number => {
  // 簡略化のため、座標時間から計算
  return ps.position4.t / getGammaPhaseSpace(ps);
};

/**
 * 座標時間を取得
 */
export const getCoordinateTimePhaseSpace = (ps: PhaseSpace): number =>
  ps.position4.t;

/**
 * 加速度による時間発展（相対論的運動方程式）
 * @param ps 現在の位相空間
 * @param properAcceleration 固有加速度（瞬間静止系での加速度）
 * @param dTau 固有時間の変化量
 */
export const evolveProperTimePhaseSpace = (
  ps: PhaseSpace,
  properAcceleration: Vector3,
  dTau: number,
): PhaseSpace => {
  // 瞬間静止系での加速度を現在の系に変換
  const accel4Rest = createVector4(
    0,
    properAcceleration.x,
    properAcceleration.y,
    properAcceleration.z,
  );

  // 現在の速度でブースト変換
  const boostMatrix = lorentzBoostFrom4Velocity(ps.velocity4);
  const accel4 = multiplyVector4Matrix4(boostMatrix, accel4Rest);

  // 4元速度の更新（du/dτ = a）
  const newVelocity4 = addVector4(ps.velocity4, scaleVector4(accel4, dTau));

  // 4元速度の正規化を維持
  const normalizedVelocity4 = normalizeVelocity4(newVelocity4);

  // 位置の更新（dx/dτ = u）
  const avgVelocity4 = scaleVector4(
    addVector4(ps.velocity4, normalizedVelocity4),
    0.5,
  );
  const newPosition4 = addVector4(
    ps.position4,
    scaleVector4(avgVelocity4, dTau),
  );

  return createPhaseSpace(newPosition4, normalizedVelocity4);
};

/**
 * 座標時間での発展
 * @param ps 現在の位相空間
 * @param acceleration 座標系での加速度
 * @param dt 座標時間の変化量
 */
export const evolvePhaseSpace = (
  ps: PhaseSpace,
  acceleration: Vector3,
  dt: number,
): PhaseSpace => {
  // 固有時間に変換
  const gamma = getGammaPhaseSpace(ps);
  const dTau = dt / gamma;

  // 座標系での加速度を固有加速度に変換（近似）
  const properAccel = scaleVector3(acceleration, gamma);

  return evolveProperTimePhaseSpace(ps, properAccel, dTau);
};

/**
 * 別の慣性系から見たときの位相空間
 * @param ps 位相空間
 * @param observerVelocity 観測者の速度
 */
export const transformToPhaseSpace = (
  ps: PhaseSpace,
  observerVelocity: Vector3,
): PhaseSpace => {
  // ローレンツ変換行列
  const boost = lorentzBoost(observerVelocity);

  // 位置と速度を変換
  const newPosition4 = multiplyVector4Matrix4(boost, ps.position4);
  const newVelocity4 = multiplyVector4Matrix4(boost, ps.velocity4);

  return createPhaseSpace(newPosition4, newVelocity4);
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
