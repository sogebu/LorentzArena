import type { Vector4 } from "./vector";
import { PhaseSpace } from "./mechanics";

/**
 * ワールドライン（時空における軌跡）を管理するクラス
 */
export class WorldLine {
  private history: PhaseSpace[] = [];
  private maxHistorySize = 1000;

  /**
   * 位相空間の状態を記録
   */
  append(phaseSpace: PhaseSpace): void {
    this.history.push(phaseSpace);

    // 履歴サイズの制限
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * 現在の状態を取得
   */
  get current(): PhaseSpace | null {
    return this.history[this.history.length - 1] || null;
  }

  /**
   * 履歴全体を取得
   */
  get trajectory(): PhaseSpace[] {
    return [...this.history];
  }

  /**
   * 観測者の過去光円錐とワールドラインの交点を求める
   * @param observerPosition 観測者の4元位置
   * @returns 交点での位相空間状態（観測者が実際に見る状態）
   */
  pastLightConeIntersection(observerPosition: Vector4): PhaseSpace | null {
    if (this.history.length === 0) return null;

    // 逆順に探索（最新から過去へ）
    for (let i = this.history.length - 1; i >= 0; i--) {
      const state = this.history[i];
      const separation = observerPosition.sub(state.position4);

      // 時空間隔を計算
      const interval = separation.intervalSquared();

      // 光的分離（過去光円錐上）に最も近い点を探す
      if (Math.abs(interval) < 0.01) {
        // 許容誤差
        return state;
      }

      // 観測者の過去にある場合
      if (separation.t > 0 && interval < 0) {
        // 光が到達可能な最も近い状態
        if (i === this.history.length - 1) {
          return state;
        }

        // 線形補間で正確な交点を求める（簡略化）
        const nextState = this.history[i + 1];
        const t = this.findLightlikeIntersectionTime(
          state.position4,
          nextState.position4,
          observerPosition,
        );

        if (t >= 0 && t <= 1) {
          return this.interpolateStates(state, nextState, t);
        }
      }
    }

    // 交点が見つからない場合は最も古い状態を返す
    return this.history[0];
  }

  /**
   * 2つの状態間で光的分離となる時刻を求める
   */
  private findLightlikeIntersectionTime(
    pos1: Vector4,
    pos2: Vector4,
    observerPos: Vector4,
  ): number {
    // 簡略化のため、線形補間でのパラメータを返す
    // 実際には2次方程式を解く必要がある

    const sep1 = observerPos.sub(pos1);
    const sep2 = observerPos.sub(pos2);
    const interval1 = sep1.intervalSquared();
    const interval2 = sep2.intervalSquared();

    // 符号が異なる場合、間に光的分離点がある
    if (interval1 * interval2 < 0) {
      return Math.abs(interval1) / (Math.abs(interval1) + Math.abs(interval2));
    }

    return -1; // 交点なし
  }

  /**
   * 2つの状態を補間
   */
  private interpolateStates(
    state1: PhaseSpace,
    state2: PhaseSpace,
    t: number,
  ): PhaseSpace {
    const pos = state1.position4.add(
      state2.position4.sub(state1.position4).scale(t),
    );
    const vel = state1.velocity4.add(
      state2.velocity4.sub(state1.velocity4).scale(t),
    );

    return new PhaseSpace(pos, vel);
  }

  /**
   * 履歴をクリア
   */
  clear(): void {
    this.history = [];
  }
}
