import { type Vector4, subVector4, lorentzDotVector4 } from "./vector";
import type { PhaseSpace } from "./mechanics";

/**
 * ワールドライン
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
  //    x0 = observerPos - pos1
  //    dx = pos2 - pos1
  // -> (x0 - t*dx))^2 = 0
  // -> dx^2 t^2 - 2*dx*x0*t + x0^2 = 0
  // -> a*t^2 - 2*b*t + c = 0

  const dx = subVector4(pos2, pos1);
  const x0 = subVector4(observerPos, pos1);

  // 2次方程式: a*t^2 - 2*b*t + c = 0
  const a = lorentzDotVector4(dx, dx); // 負
  const b = lorentzDotVector4(dx, x0); // 負
  const c = lorentzDotVector4(x0, x0); // 負

  // 判別式
  const discriminant = b * b - a * c;
  if (discriminant < 0) {
    return -1; // 実数解なし
  }

  // 解の公式
  const sqrtDiscriminant = Math.sqrt(discriminant);
  // a < 0 なので (b+√D)/a が過去側
  return (b + sqrtDiscriminant) / a;
};

/**
 * 二分探索で適切な区間を見つける
 * 観測者の座標時間より前の最新の状態を探す
 */
const findRelevantInterval = (
  history: PhaseSpace[],
  observerTime: number,
): number | null => {
  if (history.length === 0) return null;

  let left = 0;
  let right = history.length - 1;

  // 全ての履歴が未来にある場合
  if (history[right].pos.t > observerTime) {
    return null;
  }

  // 全ての履歴が過去にある場合
  if (history[0].pos.t <= observerTime) {
    return 0;
  }

  // 二分探索で境界を見つける
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (history[mid].pos.t <= observerTime) {
      right = mid;
    } else {
      left = mid + 1;
    }
  }

  return left;
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
    const separation = subVector4(observerPosition, state.pos);
    if (separation.t > 0) {
      // 観測者の過去
      return state;
    }
    return null;
  }

  // 二分探索で関連する区間を見つける
  const startIdx = findRelevantInterval(wl.history, observerPosition.t);
  if (startIdx === null) return null;

  // 見つかった区間内で逆順に探索（最新から過去へ）
  for (let i = wl.history.length - 1; i > startIdx; i--) {
    const state = wl.history[i];
    const prevState = wl.history[i - 1];

    // 両端点が観測者の過去にあるかチェック
    const sep1 = subVector4(prevState.pos, observerPosition);
    const sep2 = subVector4(state.pos, observerPosition);

    if (sep1.t >= 0 && sep2.t >= 0) {
      continue; // 両方とも未来にある
    }

    // 区間内で過去光円錐との交点を探す
    const t = findLightlikeIntersectionTime(
      prevState.pos,
      state.pos,
      observerPosition,
    );

    if (t >= 0 && t <= 1) {
      // TODO: 補完
      return prevState;
    }
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
