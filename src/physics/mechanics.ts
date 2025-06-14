import { Vector3, Vector4 } from "./vector";
import { Matrix4 } from "./matrix";

/**
 * 相対論的位相空間（位置と速度）
 */
export class PhaseSpace {
  constructor(
    public position: Vector3,
    public velocity: Vector3,
    public properTime = 0,
  ) {
    if (velocity.lengthSquared() >= 1) {
      throw new Error("速度が光速を超えています");
    }
  }

  /**
   * ガンマ因子を取得
   */
  get gamma(): number {
    return this.velocity.gamma();
  }

  /**
   * 4元位置ベクトルを取得
   */
  get position4(): Vector4 {
    return this.position.toVector4(this.properTime);
  }

  /**
   * 4元速度ベクトルを取得
   */
  get velocity4(): Vector4 {
    const gamma = this.gamma;
    return new Vector4(
      gamma,
      gamma * this.velocity.x,
      gamma * this.velocity.y,
      gamma * this.velocity.z,
    );
  }

  /**
   * 加速度による時間発展（相対論的運動方程式）
   * @param acceleration 3次元加速度ベクトル（固有加速度）
   * @param dt 座標時間の変化量
   */
  evolve(acceleration: Vector3, dt: number): PhaseSpace {
    // 現在の速度でのガンマ因子
    const gamma = this.gamma;

    // 相対論的な速度更新
    // a' = a / γ³ (並行成分) + a / γ (垂直成分)
    // 簡略化のため、低速近似を使用
    const dv = acceleration.scale(dt / gamma);
    let newVelocity = this.velocity.add(dv);

    // 速度が光速を超えないように制限
    const newBeta = newVelocity.length();
    if (newBeta >= 1) {
      newVelocity = newVelocity.normalize().scale(0.999);
    }

    // 位置の更新
    const avgVelocity = this.velocity.add(newVelocity).scale(0.5);
    const newPosition = this.position.add(avgVelocity.scale(dt));

    // 固有時間の更新
    const avgGamma = (gamma + newVelocity.gamma()) / 2;
    const newProperTime = this.properTime + dt / avgGamma;

    return new PhaseSpace(newPosition, newVelocity, newProperTime);
  }

  /**
   * 別の慣性系から見たときの位相空間
   * @param observerVelocity 観測者の速度
   */
  transformTo(observerVelocity: Vector3): PhaseSpace {
    // ローレンツ変換行列
    const boost = Matrix4.lorentzBoost(observerVelocity);

    // 位置の変換
    const pos4 = boost.multiplyVector4(this.position4);
    const newPosition = pos4.spatial();

    // 速度の合成則
    // v' = (v - u) / (1 - v·u/c²)
    // 簡略化のため、ローレンツ変換を使用
    const vel4 = boost.multiplyVector4(this.velocity4);
    const newGamma = vel4.t;
    const newVelocity = new Vector3(
      vel4.x / newGamma,
      vel4.y / newGamma,
      vel4.z / newGamma,
    );

    // 固有時間は不変
    return new PhaseSpace(newPosition, newVelocity, this.properTime);
  }

  /**
   * 静止系での時間発展
   * @param dt 固有時間の変化量
   * @param acceleration 固有加速度
   */
  evolveProper(dt: number, acceleration: Vector3): PhaseSpace {
    // 固有時間での発展は座標時間での発展に変換
    const coordinateDt = dt * this.gamma;
    return this.evolve(acceleration, coordinateDt);
  }
}
