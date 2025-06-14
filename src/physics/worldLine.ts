import {
  type Vector4,
  subVector4,
  addVector4,
  scaleVector4,
  intervalSquaredVector4,
} from "./vector";
import { type PhaseSpace, createPhaseSpace } from "./mechanics";

/**
 * ワールドライン（時空における軌跡）型
 */
export type WorldLine = {
  readonly history: PhaseSpace[];
  readonly maxHistorySize: number;
};

/**
 * ワールドラインを作成
 */
export const createWorldLine = (maxHistorySize = 1000): WorldLine => ({
  history: [],
  maxHistorySize,
});

/**
 * 位相空間の状態を記録
 */
export const appendWorldLine = (
  wl: WorldLine,
  phaseSpace: PhaseSpace,
): WorldLine => {
  const newHistory = [...wl.history, phaseSpace];

  // 履歴サイズの制限
  if (newHistory.length > wl.maxHistorySize) {
    newHistory.shift();
  }

  return {
    ...wl,
    history: newHistory,
  };
};

/**
 * 現在の状態を取得
 */
export const getCurrentWorldLine = (wl: WorldLine): PhaseSpace | null =>
  wl.history[wl.history.length - 1] || null;

/**
 * 履歴全体を取得
 */
export const getTrajectoryWorldLine = (wl: WorldLine): PhaseSpace[] => [
  ...wl.history,
];

/**
 * 2つの状態間で光的分離となる時刻を求める
 */
const findLightlikeIntersectionTime = (
  pos1: Vector4,
  pos2: Vector4,
  observerPos: Vector4,
): number => {
  // 簡略化のため、線形補間でのパラメータを返す
  // 実際には2次方程式を解く必要がある

  const sep1 = subVector4(observerPos, pos1);
  const sep2 = subVector4(observerPos, pos2);
  const interval1 = intervalSquaredVector4(sep1);
  const interval2 = intervalSquaredVector4(sep2);

  // 符号が異なる場合、間に光的分離点がある
  if (interval1 * interval2 < 0) {
    return Math.abs(interval1) / (Math.abs(interval1) + Math.abs(interval2));
  }

  return -1; // 交点なし
};

/**
 * 2つの状態を補間
 */
const interpolateStates = (
  state1: PhaseSpace,
  state2: PhaseSpace,
  t: number,
): PhaseSpace => {
  const pos = addVector4(
    state1.position4,
    scaleVector4(subVector4(state2.position4, state1.position4), t),
  );
  const vel = addVector4(
    state1.velocity4,
    scaleVector4(subVector4(state2.velocity4, state1.velocity4), t),
  );

  return createPhaseSpace(pos, vel);
};

/**
 * 観測者の過去光円錐とワールドラインの交点を求める
 * @param wl ワールドライン
 * @param observerPosition 観測者の4元位置
 * @returns 交点での位相空間状態（観測者が実際に見る状態）
 */
export const pastLightConeIntersectionWorldLine = (
  wl: WorldLine,
  observerPosition: Vector4,
): PhaseSpace | null => {
  if (wl.history.length === 0) return null;

  // 逆順に探索（最新から過去へ）
  for (let i = wl.history.length - 1; i >= 0; i--) {
    const state = wl.history[i];
    const separation = subVector4(observerPosition, state.position4);

    // 時空間隔を計算
    const interval = intervalSquaredVector4(separation);

    // 光的分離（過去光円錐上）に最も近い点を探す
    if (Math.abs(interval) < 0.01) {
      // 許容誤差
      return state;
    }

    // 観測者の過去にある場合
    if (separation.t > 0 && interval < 0) {
      // 光が到達可能な最も近い状態
      if (i === wl.history.length - 1) {
        return state;
      }

      // 線形補間で正確な交点を求める（簡略化）
      const nextState = wl.history[i + 1];
      const t = findLightlikeIntersectionTime(
        state.position4,
        nextState.position4,
        observerPosition,
      );

      if (t >= 0 && t <= 1) {
        return interpolateStates(state, nextState, t);
      }
    }
  }

  // 交点が見つからない場合は最も古い状態を返す
  return wl.history[0];
};

/**
 * 履歴をクリア
 */
export const clearWorldLine = (wl: WorldLine): WorldLine => ({
  ...wl,
  history: [],
});
