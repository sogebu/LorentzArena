import {
  type Vector3,
  type Vector4,
  createVector4,
  gamma,
  scaleVector3,
} from "./vector";

/**
 * Lorentz transformation matrices (4x4).
 *
 * English:
 *   - Matrices are stored in a flat array (row-major): data[row*4 + col].
 *   - `lorentzBoost(u)` builds a boost matrix from a spatial part of 4-velocity.
 *
 * 日本語:
 *   - 4x4 行列を一次元配列（row-major: data[row*4 + col]）で保持します。
 *   - `lorentzBoost(u)` は 4元速度の空間成分からローレンツブースト行列を生成します。
 */

/**
 * 4x4 matrix type.
 * JP: 4x4行列型（ローレンツ変換用）。
 */
export type Matrix4 = {
  readonly data: readonly number[];
};

/**
 * Create a Matrix4.
 *
 * English: If `data` is omitted, initializes with zeros.
 * 日本語: `data` 省略時はゼロ埋め行列。
 */
export const createMatrix4 = (data?: number[]): Matrix4 => {
  if (data && data.length !== 16) {
    throw new Error(
      "Matrix4には16個の要素が必要です / Matrix4 needs 16 elements",
    );
  }
  return {
    data: data || new Array(16).fill(0),
  };
};

/**
 * Identity matrix.
 * JP: 単位行列。
 */
export const matrix4Identity = (): Matrix4 => {
  const data = new Array(16).fill(0);
  data[0] = 1;
  data[5] = 1;
  data[10] = 1;
  data[15] = 1;
  return createMatrix4(data);
};

/**
 * Get element (row, col).
 * JP: 行列の要素を取得。
 */
export const getMatrix4 = (m: Matrix4, row: number, col: number): number =>
  m.data[row * 4 + col];

/**
 * Set element (row, col) and return a new matrix.
 * JP: 行列の要素を設定（新しい行列を返す）。
 */
export const setMatrix4 = (
  m: Matrix4,
  row: number,
  col: number,
  value: number,
): Matrix4 => {
  const newData = [...m.data];
  newData[row * 4 + col] = value;
  return createMatrix4(newData);
};

/**
 * Set multiple elements on a raw data array (in-place).
 * JP: 複数の要素をまとめて設定（内部ユーティリティ）。
 */
const setMultipleMatrix4 = (
  data: number[],
  updates: Array<[row: number, col: number, value: number]>,
): void => {
  for (const [row, col, value] of updates) {
    data[row * 4 + col] = value;
  }
};

/**
 * Lorentz boost matrix from spatial part of 4-velocity.
 *
 * English:
 *   - Returns a matrix that transforms **world frame → comoving frame**.
 *   - When |u| = 0, returns identity.
 *
 * 日本語:
 *   - 世界系 → 静止系（共動系）への変換行列。
 *   - |u| = 0 なら単位行列。
 */
export const lorentzBoost = (u: Vector3): Matrix4 => {
  const ux = u.x;
  const uy = u.y;
  const uz = u.z;
  const ut = gamma(u);

  const u2 = ux * ux + uy * uy + uz * uz;

  if (u2 === 0) {
    return matrix4Identity();
  }

  const data = new Array(16).fill(0);

  // Based on LSBattle's implementation.
  // This is a compact form of the standard boost matrix written in terms of 4-velocity.
  setMultipleMatrix4(data, [
    // Row 0 (time)
    [0, 0, ut],
    [0, 1, -ux],
    [0, 2, -uy],
    [0, 3, -uz],
    // Row 1 (x)
    [1, 0, -ux],
    [1, 1, (ut * ux * ux + uy * uy + uz * uz) / u2],
    [1, 2, ((ut - 1.0) * ux * uy) / u2],
    [1, 3, ((ut - 1.0) * ux * uz) / u2],
    // Row 2 (y)
    [2, 0, -uy],
    [2, 1, ((ut - 1.0) * ux * uy) / u2],
    [2, 2, (ux * ux + ut * uy * uy + uz * uz) / u2],
    [2, 3, ((ut - 1.0) * uy * uz) / u2],
    // Row 3 (z)
    [3, 0, -uz],
    [3, 1, ((ut - 1.0) * ux * uz) / u2],
    [3, 2, ((ut - 1.0) * uy * uz) / u2],
    [3, 3, (ux * ux + uy * uy + ut * uz * uz) / u2],
  ]);

  return createMatrix4(data);
};

/**
 * Inverse Lorentz boost.
 *
 * English: For this boost form, inverse is obtained by flipping the velocity sign.
 * 日本語: この形では速度（u）の符号反転で逆変換になります。
 */
export const inverseLorentzBoost = (velocity: Vector3): Matrix4 => {
  return lorentzBoost(scaleVector3(velocity, -1.0));
};

/**
 * Multiply Matrix4 × Vector4.
 * JP: 4x4行列と4次元ベクトルの積。
 */
export const multiplyVector4Matrix4 = (m: Matrix4, v: Vector4): Vector4 =>
  createVector4(
    getMatrix4(m, 0, 0) * v.t +
      getMatrix4(m, 0, 1) * v.x +
      getMatrix4(m, 0, 2) * v.y +
      getMatrix4(m, 0, 3) * v.z,
    getMatrix4(m, 1, 0) * v.t +
      getMatrix4(m, 1, 1) * v.x +
      getMatrix4(m, 1, 2) * v.y +
      getMatrix4(m, 1, 3) * v.z,
    getMatrix4(m, 2, 0) * v.t +
      getMatrix4(m, 2, 1) * v.x +
      getMatrix4(m, 2, 2) * v.y +
      getMatrix4(m, 2, 3) * v.z,
    getMatrix4(m, 3, 0) * v.t +
      getMatrix4(m, 3, 1) * v.x +
      getMatrix4(m, 3, 2) * v.y +
      getMatrix4(m, 3, 3) * v.z,
  );

/**
 * Multiply Matrix4 × Matrix4.
 * JP: 行列同士の積。
 */
export const multiplyMatrix4 = (a: Matrix4, b: Matrix4): Matrix4 => {
  const data = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += getMatrix4(a, i, k) * getMatrix4(b, k, j);
      }
      data[i * 4 + j] = sum;
    }
  }
  return createMatrix4(data);
};

/**
 * Transpose.
 * JP: 転置行列。
 */
export const transposeMatrix4 = (m: Matrix4): Matrix4 => {
  const data = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      data[j * 4 + i] = getMatrix4(m, i, j);
    }
  }
  return createMatrix4(data);
};
