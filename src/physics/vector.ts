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
 * ガンマ因子を計算
 */
export const gamma = (u: Vector3): number => {
  return Math.sqrt(1.0 + lengthSquaredVector3(u));
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

export const getVelocity4 = (u: Vector3): Vector4 =>
  createVector4(
    gamma(u),
    u.x,
    u.y,
    u.z,
  );

/**
 * 時空間隔のタイプを判定
 */
export const intervalTypeVector4 = (
  v: Vector4,
): "timelike" | "lightlike" | "spacelike" => {
  const s2 = lorentzDotVector4(v, v);
  if (s2 < 0) return "timelike";
  if (s2 === 0) return "lightlike";
  return "spacelike";
};
