import { type Vector3, Vector4 } from "./vector";

/**
 * 4x4行列クラス（ローレンツ変換用）
 */
export class Matrix4 {
  private data: number[];

  constructor(data?: number[]) {
    if (data && data.length !== 16) {
      throw new Error("Matrix4には16個の要素が必要です");
    }
    this.data = data || new Array(16).fill(0);
  }

  static identity(): Matrix4 {
    const m = new Matrix4();
    m.data[0] = 1;
    m.data[5] = 1;
    m.data[10] = 1;
    m.data[15] = 1;
    return m;
  }

  /**
   * ローレンツブースト変換行列を生成（4元速度から）
   * @param velocity4 4元速度ベクトル（u = (γ, γvx, γvy, γvz)）
   */
  static lorentzBoostFrom4Velocity(velocity4: Vector4): Matrix4 {
    const ut = velocity4.t;
    const ux = velocity4.x;
    const uy = velocity4.y;
    const uz = velocity4.z;

    const r = ux * ux + uy * uy + uz * uz;

    if (r === 0) {
      return Matrix4.identity();
    }

    const gamma = ut;
    const m = new Matrix4();

    // Based on LSBattle's implementation
    // Row 0 (time)
    m.set(0, 0, gamma);
    m.set(0, 1, -ux);
    m.set(0, 2, -uy);
    m.set(0, 3, -uz);

    // Row 1 (x)
    m.set(1, 0, -ux);
    m.set(1, 1, (gamma * ux * ux + uy * uy + uz * uz) / r);
    m.set(1, 2, ((gamma - 1) * ux * uy) / r);
    m.set(1, 3, ((gamma - 1) * ux * uz) / r);

    // Row 2 (y)
    m.set(2, 0, -uy);
    m.set(2, 1, ((gamma - 1) * ux * uy) / r);
    m.set(2, 2, (ux * ux + gamma * uy * uy + uz * uz) / r);
    m.set(2, 3, ((gamma - 1) * uy * uz) / r);

    // Row 3 (z)
    m.set(3, 0, -uz);
    m.set(3, 1, ((gamma - 1) * ux * uz) / r);
    m.set(3, 2, ((gamma - 1) * uy * uz) / r);
    m.set(3, 3, (ux * ux + uy * uy + gamma * uz * uz) / r);

    return m;
  }

  /**
   * ローレンツブースト変換行列を生成
   * @param velocity 速度ベクトル（v/c単位）
   */
  static lorentzBoost(velocity: Vector3): Matrix4 {
    const v = velocity;
    const v2 = v.lengthSquared();

    if (v2 === 0) {
      return Matrix4.identity();
    }

    if (v2 >= 1) {
      throw new Error("速度が光速を超えています");
    }

    const gamma = 1 / Math.sqrt(1 - v2);
    const velocity4 = new Vector4(gamma, gamma * v.x, gamma * v.y, gamma * v.z);
    return Matrix4.lorentzBoostFrom4Velocity(velocity4);
  }

  /**
   * 逆ローレンツブースト変換行列を生成
   * @param velocity 速度ベクトル（v/c単位）
   */
  static inverseLorentzBoost(velocity: Vector3): Matrix4 {
    // 逆変換は速度の符号を反転するだけ
    return Matrix4.lorentzBoost(velocity.scale(-1));
  }

  get(row: number, col: number): number {
    return this.data[row * 4 + col];
  }

  set(row: number, col: number, value: number): void {
    this.data[row * 4 + col] = value;
  }

  /**
   * 4次元ベクトルとの積
   */
  multiplyVector4(v: Vector4): Vector4 {
    return new Vector4(
      this.get(0, 0) * v.t +
        this.get(0, 1) * v.x +
        this.get(0, 2) * v.y +
        this.get(0, 3) * v.z,
      this.get(1, 0) * v.t +
        this.get(1, 1) * v.x +
        this.get(1, 2) * v.y +
        this.get(1, 3) * v.z,
      this.get(2, 0) * v.t +
        this.get(2, 1) * v.x +
        this.get(2, 2) * v.y +
        this.get(2, 3) * v.z,
      this.get(3, 0) * v.t +
        this.get(3, 1) * v.x +
        this.get(3, 2) * v.y +
        this.get(3, 3) * v.z,
    );
  }

  /**
   * 行列同士の積
   */
  multiply(other: Matrix4): Matrix4 {
    const result = new Matrix4();
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += this.get(i, k) * other.get(k, j);
        }
        result.set(i, j, sum);
      }
    }
    return result;
  }

  /**
   * 転置行列
   */
  transpose(): Matrix4 {
    const result = new Matrix4();
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        result.set(j, i, this.get(i, j));
      }
    }
    return result;
  }
}
