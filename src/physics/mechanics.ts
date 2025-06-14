import { Vector3, Vector4 } from "./vector";
import { Matrix4 } from "./matrix";

/**
 * 相対論的位相空間（4元位置と4元速度）
 */
export class PhaseSpace {
  public position4: Vector4;
  public velocity4: Vector4;

  constructor(position4: Vector4, velocity4: Vector4) {
    this.position4 = position4;
    // 4元速度を正規化（u·u = -1）
    this.velocity4 = velocity4.normalizeVelocity4();
  }

  /**
   * 3次元位置と3次元速度から初期化
   */
  static fromPosition3Velocity3(
    position: Vector3,
    velocity: Vector3,
    coordinateTime = 0,
  ): PhaseSpace {
    if (velocity.lengthSquared() >= 1) {
      throw new Error("速度が光速を超えています");
    }

    const gamma = velocity.gamma();
    const position4 = new Vector4(
      coordinateTime,
      position.x,
      position.y,
      position.z,
    );
    const velocity4 = new Vector4(
      gamma,
      gamma * velocity.x,
      gamma * velocity.y,
      gamma * velocity.z,
    );

    return new PhaseSpace(position4, velocity4);
  }

  /**
   * 3次元位置を取得
   */
  get position(): Vector3 {
    return this.position4.spatial();
  }

  /**
   * 3次元速度を取得
   */
  get velocity(): Vector3 {
    const gamma = this.velocity4.t;
    return new Vector3(
      this.velocity4.x / gamma,
      this.velocity4.y / gamma,
      this.velocity4.z / gamma,
    );
  }

  /**
   * ガンマ因子を取得
   */
  get gamma(): number {
    return this.velocity4.t;
  }

  /**
   * 固有時間を取得（worldlineに沿った時間）
   */
  get properTime(): number {
    // 簡略化のため、座標時間から計算
    return this.position4.t / this.gamma;
  }

  /**
   * 座標時間を取得
   */
  get coordinateTime(): number {
    return this.position4.t;
  }

  /**
   * 加速度による時間発展（相対論的運動方程式）
   * @param properAcceleration 固有加速度（瞬間静止系での加速度）
   * @param dTau 固有時間の変化量
   */
  evolveProperTime(properAcceleration: Vector3, dTau: number): PhaseSpace {
    // 瞬間静止系での加速度を現在の系に変換
    const accel4Rest = new Vector4(
      0,
      properAcceleration.x,
      properAcceleration.y,
      properAcceleration.z,
    );

    // 現在の速度でブースト変換
    const boostMatrix = Matrix4.lorentzBoostFrom4Velocity(this.velocity4);
    const accel4 = boostMatrix.multiplyVector4(accel4Rest);

    // 4元速度の更新（du/dτ = a）
    const newVelocity4 = this.velocity4.add(accel4.scale(dTau));

    // 4元速度の正規化を維持
    const normalizedVelocity4 = newVelocity4.normalizeVelocity4();

    // 位置の更新（dx/dτ = u）
    const avgVelocity4 = this.velocity4.add(normalizedVelocity4).scale(0.5);
    const newPosition4 = this.position4.add(avgVelocity4.scale(dTau));

    return new PhaseSpace(newPosition4, normalizedVelocity4);
  }

  /**
   * 座標時間での発展
   * @param acceleration 座標系での加速度
   * @param dt 座標時間の変化量
   */
  evolve(acceleration: Vector3, dt: number): PhaseSpace {
    // 固有時間に変換
    const dTau = dt / this.gamma;

    // 座標系での加速度を固有加速度に変換（近似）
    const properAccel = acceleration.scale(this.gamma);

    return this.evolveProperTime(properAccel, dTau);
  }

  /**
   * 別の慣性系から見たときの位相空間
   * @param observerVelocity 観測者の速度
   */
  transformTo(observerVelocity: Vector3): PhaseSpace {
    // ローレンツ変換行列
    const boost = Matrix4.lorentzBoost(observerVelocity);

    // 位置と速度を変換
    const newPosition4 = boost.multiplyVector4(this.position4);
    const newVelocity4 = boost.multiplyVector4(this.velocity4);

    return new PhaseSpace(newPosition4, newVelocity4);
  }

  /**
   * 過去光円錐との交点を計算（観測者が実際に見る位置）
   * @param _observerPos 観測者の4元位置
   * @param worldline 対象のワールドライン（時系列）
   */
  static pastLightConeIntersection(
    _observerPos: Vector4,
    worldline: PhaseSpace[],
  ): PhaseSpace | null {
    // 簡略化のため、最新の位置を返す
    // TODO: 実際の過去光円錐交点計算を実装
    return worldline[worldline.length - 1] || null;
  }
}
