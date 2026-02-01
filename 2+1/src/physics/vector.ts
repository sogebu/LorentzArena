/**
 * Vector helpers used by the relativistic simulation.
 *
 * English:
 *   - We use units where **c = 1**.
 *   - `Vector3` is used for spatial vectors (including the spatial part of 4-velocity).
 *   - `Vector4` is a spacetime vector `(t, x, y, z)`.
 *   - Minkowski inner product uses signature (+,+,+,-): x²+y²+z²-t².
 *
 * 日本語:
 *   - 単位系は **c = 1** を前提にしています。
 *   - `Vector3` は空間ベクトル（4元速度の空間成分など）に使います。
 *   - `Vector4` は時空ベクトル `(t, x, y, z)` です。
 *   - ミンコフスキー内積の符号は (+,+,+,-): x²+y²+z²-t²。
 */

/**
 * 3D vector.
 * JP: 3次元ベクトル。
 */
export type Vector3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/**
 * Create a Vector3.
 * JP: Vector3 を作成。
 */
export const createVector3 = (x: number, y: number, z: number): Vector3 => ({
  x,
  y,
  z,
});

/**
 * Zero vector.
 * JP: ゼロベクトル。
 */
export const vector3Zero = (): Vector3 => createVector3(0, 0, 0);

/**
 * Add vectors.
 * JP: ベクトルの加算。
 */
export const addVector3 = (a: Vector3, b: Vector3): Vector3 =>
  createVector3(a.x + b.x, a.y + b.y, a.z + b.z);

/**
 * Subtract vectors.
 * JP: ベクトルの減算。
 */
export const subVector3 = (a: Vector3, b: Vector3): Vector3 =>
  createVector3(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Scale a vector by a scalar.
 * JP: ベクトルのスカラー倍。
 */
export const scaleVector3 = (v: Vector3, scalar: number): Vector3 =>
  createVector3(v.x * scalar, v.y * scalar, v.z * scalar);

/**
 * Dot product.
 * JP: ベクトルの内積。
 */
export const dotVector3 = (a: Vector3, b: Vector3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Cross product.
 * JP: ベクトルの外積。
 */
export const crossVector3 = (a: Vector3, b: Vector3): Vector3 =>
  createVector3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );

/**
 * Squared length.
 * JP: ベクトルの長さの2乗。
 */
export const lengthSquaredVector3 = (v: Vector3): number => dotVector3(v, v);

/**
 * Length.
 * JP: ベクトルの長さ。
 */
export const lengthVector3 = (v: Vector3): number =>
  Math.sqrt(lengthSquaredVector3(v));

/**
 * Normalize.
 * JP: ベクトルの正規化。
 */
export const normalizeVector3 = (v: Vector3): Vector3 => {
  const len = lengthVector3(v);
  if (len === 0) return vector3Zero();
  return scaleVector3(v, 1 / len);
};

/**
 * Gamma factor from the spatial part of the 4-velocity.
 *
 * English:
 *   - In this codebase `u` is treated as the spatial part of the 4-velocity
 *     (a.k.a. proper velocity), so γ = sqrt(1 + |u|^2).
 *
 * 日本語:
 *   - このコードでは `u` を4元速度の空間成分（いわゆる固有速度）として扱うため、
 *     γ = sqrt(1 + |u|^2) になります。
 */
export const gamma = (u: Vector3): number => {
  return Math.sqrt(1.0 + lengthSquaredVector3(u));
};

/**
 * 4D spacetime vector (t, x, y, z).
 * JP: 4次元ベクトル（時空ベクトル）。
 */
export type Vector4 = {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/**
 * Create a Vector4.
 * JP: Vector4 を作成。
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
 * Zero spacetime vector.
 * JP: ゼロベクトル。
 */
export const vector4Zero = (): Vector4 => createVector4(0, 0, 0, 0);

/**
 * Convert Vector3 to Vector4 by adding time component.
 * JP: Vector3 から Vector4 へ（時間成分を追加）。
 */
export const toVector4 = (v: Vector3, t: number): Vector4 =>
  createVector4(t, v.x, v.y, v.z);

/**
 * Add Vector4.
 * JP: Vector4 の加算。
 */
export const addVector4 = (a: Vector4, b: Vector4): Vector4 =>
  createVector4(a.t + b.t, a.x + b.x, a.y + b.y, a.z + b.z);

/**
 * Subtract Vector4.
 * JP: Vector4 の減算。
 */
export const subVector4 = (a: Vector4, b: Vector4): Vector4 =>
  createVector4(a.t - b.t, a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Scale Vector4.
 * JP: Vector4 のスカラー倍。
 */
export const scaleVector4 = (v: Vector4, scalar: number): Vector4 =>
  createVector4(v.t * scalar, v.x * scalar, v.y * scalar, v.z * scalar);

/**
 * Minkowski inner product with signature (+,+,+,-).
 * JP: ミンコフスキー内積（符号 +,+,+,-）。
 */
export const lorentzDotVector4 = (a: Vector4, b: Vector4): number =>
  a.x * b.x + a.y * b.y + a.z * b.z - a.t * b.t;

/**
 * Extract spatial part.
 * JP: 空間成分のみ取得。
 */
export const spatialVector4 = (v: Vector4): Vector3 =>
  createVector3(v.x, v.y, v.z);

/**
 * Convert spatial part of 4-velocity to full 4-velocity.
 * JP: 4元速度（u^μ）を作る。
 */
export const getVelocity4 = (u: Vector3): Vector4 =>
  createVector4(gamma(u), u.x, u.y, u.z);

/**
 * Classify spacetime interval type.
 * JP: 時空間隔のタイプを判定。
 */
export const intervalTypeVector4 = (
  v: Vector4,
): "timelike" | "lightlike" | "spacelike" => {
  const s2 = lorentzDotVector4(v, v);
  if (s2 < 0) return "timelike";
  if (s2 === 0) return "lightlike";
  return "spacelike";
};
