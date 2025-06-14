import type { Vector3 } from "./vector";
import { PhaseSpace } from "./mechanics";

/**
 * 世界線のインターフェース
 */
export interface WorldLine {
  /**
   * 指定された固有時間での位相空間を取得
   * @param properTime 固有時間
   */
  getPhaseSpace(properTime: number): PhaseSpace;

  /**
   * 光の遅延を考慮した観測位置を計算
   * @param observerPosition 観測者の位置
   * @param observerTime 観測者の時刻
   */
  getObservedPosition(
    observerPosition: Vector3,
    observerTime: number,
  ): Vector3 | null;
}

/**
 * 等速直線運動の世界線
 */
export class UniformWorldLine implements WorldLine {
  constructor(
    private initialPosition: Vector3,
    private velocity: Vector3,
    private initialProperTime = 0,
  ) {
    if (velocity.lengthSquared() >= 1) {
      throw new Error("速度が光速を超えています");
    }
  }

  getPhaseSpace(properTime: number): PhaseSpace {
    const dt = properTime - this.initialProperTime;
    const gamma = this.velocity.gamma();
    const coordinateTime = dt * gamma;
    const position = this.initialPosition.add(
      this.velocity.scale(coordinateTime),
    );
    return new PhaseSpace(position, this.velocity, properTime);
  }

  getObservedPosition(
    observerPosition: Vector3,
    observerTime: number,
  ): Vector3 | null {
    // 光の遅延を考慮した逆算
    // 観測者に光が届く時刻を t_obs とすると
    // |r(t_emit) - r_obs| = c * (t_obs - t_emit)
    // ここで c = 1 (自然単位系)

    // 二分探索で放出時刻を求める
    let tMin = -1000;
    let tMax = observerTime;

    for (let i = 0; i < 50; i++) {
      const tMid = (tMin + tMax) / 2;
      const emitPosition = this.initialPosition.add(this.velocity.scale(tMid));
      const distance = emitPosition.sub(observerPosition).length();
      const lightTravelTime = distance;

      if (Math.abs(tMid + lightTravelTime - observerTime) < 1e-6) {
        return emitPosition;
      }

      if (tMid + lightTravelTime < observerTime) {
        tMin = tMid;
      } else {
        tMax = tMid;
      }
    }

    return null;
  }
}

/**
 * 加速度運動の世界線
 */
export class AcceleratedWorldLine implements WorldLine {
  private trajectory: PhaseSpace[] = [];
  private timeStep = 0.01;

  constructor(
    private initialPhaseSpace: PhaseSpace,
    private accelerationFunction: (t: number) => Vector3,
  ) {
    this.trajectory.push(initialPhaseSpace);
  }

  getPhaseSpace(properTime: number): PhaseSpace {
    // 必要に応じて軌道を計算
    while (
      this.trajectory[this.trajectory.length - 1].properTime < properTime
    ) {
      const current = this.trajectory[this.trajectory.length - 1];
      const acceleration = this.accelerationFunction(current.properTime);
      const next = current.evolveProper(this.timeStep, acceleration);
      this.trajectory.push(next);
    }

    // 線形補間
    for (let i = 1; i < this.trajectory.length; i++) {
      if (this.trajectory[i].properTime >= properTime) {
        const prev = this.trajectory[i - 1];
        const next = this.trajectory[i];
        const t =
          (properTime - prev.properTime) / (next.properTime - prev.properTime);

        const position = prev.position.scale(1 - t).add(next.position.scale(t));
        const velocity = prev.velocity.scale(1 - t).add(next.velocity.scale(t));

        return new PhaseSpace(position, velocity, properTime);
      }
    }

    return this.trajectory[this.trajectory.length - 1];
  }

  getObservedPosition(
    observerPosition: Vector3,
    observerTime: number,
  ): Vector3 | null {
    // 簡略化のため、最も近い時刻の位置を返す
    for (let i = this.trajectory.length - 1; i >= 0; i--) {
      const ps = this.trajectory[i];
      const distance = ps.position.sub(observerPosition).length();
      const lightTravelTime = distance;
      const emissionTime = observerTime - lightTravelTime;

      if (ps.properTime * ps.gamma <= emissionTime) {
        return ps.position;
      }
    }

    return this.initialPhaseSpace.position;
  }
}
