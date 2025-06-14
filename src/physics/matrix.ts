import {
  type Vector3,
  type Vector4,
  createVector4,
  lengthSquaredVector3,
  gammaVector3,
  scaleVector3,
} from "./vector";

/**
 * 4x4行列型（ローレンツ変換用）
 */
export type Matrix4 = {
  readonly data: readonly number[];
};

/**
 * 4x4行列を作成
 */
export const createMatrix4 = (data?: number[]): Matrix4 => {
  if (data && data.length !== 16) {
    throw new Error("Matrix4には16個の要素が必要です");
  }
  return {
    data: data || new Array(16).fill(0),
  };
};

/**
 * 単位行列を作成
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
 * 行列の要素を取得
 */
export const getMatrix4 = (m: Matrix4, row: number, col: number): number =>
  m.data[row * 4 + col];

/**
 * 行列の要素を設定（新しい行列を返す）
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
 * 複数の要素を一度に設定（効率的な更新）
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
 * ローレンツブースト変換行列を生成（4元速度から）
 * @param velocity4 4元速度ベクトル（u = (γ, γvx, γvy, γvz)）
 */
export const lorentzBoostFrom4Velocity = (velocity4: Vector4): Matrix4 => {
  const ut = velocity4.t;
  const ux = velocity4.x;
  const uy = velocity4.y;
  const uz = velocity4.z;

  const r = ux * ux + uy * uy + uz * uz;

  if (r === 0) {
    return matrix4Identity();
  }

  const gamma = ut;
  const data = new Array(16).fill(0);

  // Based on LSBattle's implementation
  setMultipleMatrix4(data, [
    // Row 0 (time)
    [0, 0, gamma],
    [0, 1, -ux],
    [0, 2, -uy],
    [0, 3, -uz],
    // Row 1 (x)
    [1, 0, -ux],
    [1, 1, (gamma * ux * ux + uy * uy + uz * uz) / r],
    [1, 2, ((gamma - 1) * ux * uy) / r],
    [1, 3, ((gamma - 1) * ux * uz) / r],
    // Row 2 (y)
    [2, 0, -uy],
    [2, 1, ((gamma - 1) * ux * uy) / r],
    [2, 2, (ux * ux + gamma * uy * uy + uz * uz) / r],
    [2, 3, ((gamma - 1) * uy * uz) / r],
    // Row 3 (z)
    [3, 0, -uz],
    [3, 1, ((gamma - 1) * ux * uz) / r],
    [3, 2, ((gamma - 1) * uy * uz) / r],
    [3, 3, (ux * ux + uy * uy + gamma * uz * uz) / r],
  ]);

  return createMatrix4(data);
};

/**
 * ローレンツブースト変換行列を生成
 * @param velocity 速度ベクトル（v/c単位）
 */
export const lorentzBoost = (velocity: Vector3): Matrix4 => {
  const v2 = lengthSquaredVector3(velocity);

  if (v2 === 0) {
    return matrix4Identity();
  }

  if (v2 >= 1) {
    throw new Error("速度が光速を超えています");
  }

  const gamma = gammaVector3(velocity);
  const velocity4 = createVector4(
    gamma,
    gamma * velocity.x,
    gamma * velocity.y,
    gamma * velocity.z,
  );
  return lorentzBoostFrom4Velocity(velocity4);
};

/**
 * 逆ローレンツブースト変換行列を生成
 * @param velocity 速度ベクトル（v/c単位）
 */
export const inverseLorentzBoost = (velocity: Vector3): Matrix4 => {
  // 逆変換は速度の符号を反転するだけ
  return lorentzBoost(scaleVector3(velocity, -1));
};

/**
 * 4次元ベクトルとの積
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
 * 行列同士の積
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
 * 転置行列
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
