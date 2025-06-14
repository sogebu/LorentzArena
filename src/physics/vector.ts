/**
 * 3次元ベクトル型
 */
export type Vector3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/**
 * 3次元ベクトルを作成
 */
export const createVector3 = (x: number, y: number, z: number): Vector3 => ({
  x,
  y,
  z,
});

/**
 * ゼロベクトルを作成
 */
export const vector3Zero = (): Vector3 => createVector3(0, 0, 0);

/**
 * ベクトルの加算
 */
export const addVector3 = (a: Vector3, b: Vector3): Vector3 =>
  createVector3(a.x + b.x, a.y + b.y, a.z + b.z);

/**
 * ベクトルの減算
 */
export const subVector3 = (a: Vector3, b: Vector3): Vector3 =>
  createVector3(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * ベクトルのスカラー倍
 */
export const scaleVector3 = (v: Vector3, scalar: number): Vector3 =>
  createVector3(v.x * scalar, v.y * scalar, v.z * scalar);

/**
 * ベクトルの内積
 */
export const dotVector3 = (a: Vector3, b: Vector3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * ベクトルの外積
 */
export const crossVector3 = (a: Vector3, b: Vector3): Vector3 =>
  createVector3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );

/**
 * ベクトルの長さの2乗
 */
export const lengthSquaredVector3 = (v: Vector3): number => dotVector3(v, v);

/**
 * ベクトルの長さ
 */
export const lengthVector3 = (v: Vector3): number =>
  Math.sqrt(lengthSquaredVector3(v));

/**
 * ベクトルの正規化
 */
export const normalizeVector3 = (v: Vector3): Vector3 => {
  const len = lengthVector3(v);
  if (len === 0) return vector3Zero();
  return scaleVector3(v, 1 / len);
};

/**
 * ベータ（v/c）を計算
 */
export const betaVector3 = (v: Vector3): number => lengthVector3(v);

/**
 * ガンマ因子を計算
 */
export const gammaVector3 = (v: Vector3): number => {
  const beta2 = lengthSquaredVector3(v);
  if (beta2 >= 1) {
    throw new Error("速度が光速を超えています");
  }
  return 1 / Math.sqrt(1 - beta2);
};

/**
 * 4次元ベクトル（時空ベクトル）型
 */
export type Vector4 = {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/**
 * 4次元ベクトルを作成
 */
export const createVector4 = (
  t: number,
  x: number,
  y: number,
  z: number,
): Vector4 => ({
  t,
  x,
  y,
  z,
});

/**
 * ゼロベクトルを作成
 */
export const vector4Zero = (): Vector4 => createVector4(0, 0, 0, 0);

/**
 * Vector3からVector4への変換（時間成分を追加）
 */
export const toVector4 = (v: Vector3, t: number): Vector4 =>
  createVector4(t, v.x, v.y, v.z);

/**
 * ベクトルの加算
 */
export const addVector4 = (a: Vector4, b: Vector4): Vector4 =>
  createVector4(a.t + b.t, a.x + b.x, a.y + b.y, a.z + b.z);

/**
 * ベクトルの減算
 */
export const subVector4 = (a: Vector4, b: Vector4): Vector4 =>
  createVector4(a.t - b.t, a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * ベクトルのスカラー倍
 */
export const scaleVector4 = (v: Vector4, scalar: number): Vector4 =>
  createVector4(v.t * scalar, v.x * scalar, v.y * scalar, v.z * scalar);

/**
 * ミンコフスキー内積
 */
export const lorentzDotVector4 = (a: Vector4, b: Vector4): number =>
  a.x * b.x + a.y * b.y + a.z * b.z - a.t * b.t;

/**
 * 空間成分のみ取得
 */
export const spatialVector4 = (v: Vector4): Vector3 =>
  createVector3(v.x, v.y, v.z);

/**
 * 固有時間間隔の2乗
 */
export const intervalSquaredVector4 = (v: Vector4): number =>
  lorentzDotVector4(v, v);

/**
 * 時空間隔のタイプを判定
 */
export const intervalTypeVector4 = (
  v: Vector4,
): "timelike" | "lightlike" | "spacelike" => {
  const s2 = intervalSquaredVector4(v);
  if (s2 < 0) return "timelike";
  if (s2 === 0) return "lightlike";
  return "spacelike";
};

/**
 * 4元速度の正規化（固有時間で微分された速度）
 */
export const normalizeVelocity4 = (v: Vector4): Vector4 => {
  // 4元速度の大きさは常に-1（timelike）でなければならない
  // u·u = -1
  const spatialVel = spatialVector4(v);
  const gamma = Math.sqrt(1 + lengthSquaredVector3(spatialVel));
  return createVector4(gamma, spatialVel.x, spatialVel.y, spatialVel.z);
};

/**
 * 4元速度からガンマ因子を取得
 */
export const gamma4Vector4 = (v: Vector4): number => {
  const spatial = spatialVector4(v);
  return Math.sqrt(1 + lengthSquaredVector3(spatial));
};
