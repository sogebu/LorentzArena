/**
 * 3次元ベクトルクラス
 */
export class Vector3 {
  constructor(
    public x: number,
    public y: number,
    public z: number,
  ) {}

  static zero(): Vector3 {
    return new Vector3(0, 0, 0);
  }

  add(other: Vector3): Vector3 {
    return new Vector3(this.x + other.x, this.y + other.y, this.z + other.z);
  }

  sub(other: Vector3): Vector3 {
    return new Vector3(this.x - other.x, this.y - other.y, this.z - other.z);
  }

  scale(scalar: number): Vector3 {
    return new Vector3(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  dot(other: Vector3): number {
    return this.x * other.x + this.y * other.y + this.z * other.z;
  }

  cross(other: Vector3): Vector3 {
    return new Vector3(
      this.y * other.z - this.z * other.y,
      this.z * other.x - this.x * other.z,
      this.x * other.y - this.y * other.x,
    );
  }

  length(): number {
    return Math.sqrt(this.dot(this));
  }

  lengthSquared(): number {
    return this.dot(this);
  }

  normalize(): Vector3 {
    const len = this.length();
    if (len === 0) return Vector3.zero();
    return this.scale(1 / len);
  }

  /** ベータ（v/c）を計算 */
  beta(): number {
    return this.length();
  }

  /** ガンマ因子を計算 */
  gamma(): number {
    const beta2 = this.lengthSquared();
    if (beta2 >= 1) {
      throw new Error("速度が光速を超えています");
    }
    return 1 / Math.sqrt(1 - beta2);
  }

  /** Vector4への変換（時間成分を追加） */
  toVector4(t: number): Vector4 {
    return new Vector4(t, this.x, this.y, this.z);
  }
}

/**
 * 4次元ベクトル（時空ベクトル）クラス
 */
export class Vector4 {
  constructor(
    public t: number,
    public x: number,
    public y: number,
    public z: number,
  ) {}

  static zero(): Vector4 {
    return new Vector4(0, 0, 0, 0);
  }

  add(other: Vector4): Vector4 {
    return new Vector4(
      this.t + other.t,
      this.x + other.x,
      this.y + other.y,
      this.z + other.z,
    );
  }

  sub(other: Vector4): Vector4 {
    return new Vector4(
      this.t - other.t,
      this.x - other.x,
      this.y - other.y,
      this.z - other.z,
    );
  }

  scale(scalar: number): Vector4 {
    return new Vector4(
      this.t * scalar,
      this.x * scalar,
      this.y * scalar,
      this.z * scalar,
    );
  }

  /** ミンコフスキー内積 */
  lorentzDot(other: Vector4): number {
    return (
      this.t * other.t - this.x * other.x - this.y * other.y - this.z * other.z
    );
  }

  /** 空間成分のみ取得 */
  spatial(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  /** 固有時間間隔の2乗 */
  intervalSquared(): number {
    return this.lorentzDot(this);
  }

  /** 時空間隔のタイプを判定 */
  intervalType(): "timelike" | "lightlike" | "spacelike" {
    const s2 = this.intervalSquared();
    if (s2 > 0) return "timelike";
    if (s2 === 0) return "lightlike";
    return "spacelike";
  }
}
