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
 * 世界線上の2点間を線形補間し、観測者の過去光円錐と交差する点を見つける
 */
const findLightlikeIntersectionTime = (
  pos1: Vector4,
  pos2: Vector4,
  observerPos: Vector4,
): number => {
  // pos1 + t*(pos2 - pos1) が観測者の過去光円錐上にある t を求める
  // 条件: (observerPos - (pos1 + t*(pos2 - pos1)))^2 = 0
  
  const dx = subVector4(pos2, pos1);
  const x0 = subVector4(pos1, observerPos);
  
  // 2次方程式: a*t^2 + b*t + c = 0
  const a = intervalSquaredVector4(dx);
  const b = 2 * (x0.t * dx.t - x0.x * dx.x - x0.y * dx.y - x0.z * dx.z);
  const c = intervalSquaredVector4(x0);
  
  // 判別式
  const discriminant = b * b - 4 * a * c;
  
  if (discriminant < 0) {
    return -1; // 実数解なし
  }
  
  // 解の公式
  const sqrtDiscriminant = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDiscriminant) / (2 * a);
  const t2 = (-b + sqrtDiscriminant) / (2 * a);
  
  // 0 <= t <= 1 の範囲内で、観測者の過去にある解を選ぶ
  for (const t of [t1, t2]) {
    if (t >= 0 && t <= 1) {
      const pos = addVector4(pos1, scaleVector4(dx, t));
      const sep = subVector4(observerPos, pos);
      if (sep.t > 0) { // 観測者の過去
        return t;
      }
    }
  }
  
  return -1; // 有効な交点なし
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
 * 二分探索で適切な区間を見つける
 * 観測者の座標時間より前の最新の状態を探す
 */
const findRelevantInterval = (
  history: PhaseSpace[],
  observerTime: number,
): { startIdx: number; endIdx: number } | null => {
  if (history.length === 0) return null;
  
  let left = 0;
  let right = history.length - 1;
  
  // 全ての履歴が未来にある場合
  if (history[right].position4.t > observerTime) {
    return null;
  }
  
  // 全ての履歴が過去にある場合
  if (history[0].position4.t <= observerTime) {
    return { startIdx: 0, endIdx: right };
  }
  
  // 二分探索で境界を見つける
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (history[mid].position4.t <= observerTime) {
      right = mid;
    } else {
      left = mid + 1;
    }
  }
  
  return { startIdx: left, endIdx: history.length - 1 };
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
  if (wl.history.length === 1) {
    // 履歴が1つしかない場合、それが過去光円錐内にあるかチェック
    const state = wl.history[0];
    const separation = subVector4(observerPosition, state.position4);
    if (separation.t > 0) { // 観測者の過去
      return state;
    }
    return null;
  }

  // 二分探索で関連する区間を見つける
  const interval = findRelevantInterval(wl.history, observerPosition.t);
  if (!interval) return null;

  // 見つかった区間内で逆順に探索（最新から過去へ）
  for (let i = interval.endIdx; i > interval.startIdx; i--) {
    const state = wl.history[i];
    const prevState = wl.history[i - 1];
    
    // 両端点が観測者の過去にあるかチェック
    const sep1 = subVector4(observerPosition, prevState.position4);
    const sep2 = subVector4(observerPosition, state.position4);
    
    if (sep1.t <= 0 && sep2.t <= 0) {
      continue; // 両方とも未来にある
    }
    
    // 区間内で過去光円錐との交点を探す
    const t = findLightlikeIntersectionTime(
      prevState.position4,
      state.position4,
      observerPosition,
    );
    
    if (t >= 0 && t <= 1) {
      return interpolateStates(prevState, state, t);
    }
    
    // 交点が見つからない場合、区間内の点で最も光的に近いものを探す
    const interval1 = intervalSquaredVector4(sep1);
    const interval2 = intervalSquaredVector4(sep2);
    
    // 過去にある点で、より光的に近い方を選ぶ
    if (sep2.t > 0 && (sep1.t <= 0 || Math.abs(interval2) < Math.abs(interval1))) {
      if (Math.abs(interval2) < 0.1) { // 十分に光的に近い
        return state;
      }
    }
  }
  
  // 区間の最初の状態をチェック
  const firstState = wl.history[interval.startIdx];
  const separation = subVector4(observerPosition, firstState.position4);
  if (separation.t > 0) { // 観測者の過去
    return firstState;
  }
  
  return null; // 過去光円錐との交点なし
};

/**
 * 履歴をクリア
 */
export const clearWorldLine = (wl: WorldLine): WorldLine => ({
  ...wl,
  history: [],
});
