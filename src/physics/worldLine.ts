import { type Vector4, subVector4, lorentzDotVector4 } from "./vector";
import type { PhaseSpace } from "./mechanics";

/**
 * World line utilities (history of PhaseSpace snapshots).
 *
 * English:
 *   - A world line is a discretized trajectory through spacetime.
 *   - We use it to compute “what you can see” via a past-light-cone intersection.
 *
 * 日本語:
 *   - ワールドラインは位相空間スナップショットの時系列（時空間上の軌跡の離散近似）です。
 *   - 過去光円錐との交点を求めることで「見える位置」を計算します。
 */

/**
 * WorldLine stores a finite history of PhaseSpace samples.
 * JP: ワールドライン（履歴付き）。
 */
export type WorldLine = {
  readonly history: PhaseSpace[];
  readonly maxHistorySize: number;
};

/**
 * Create a WorldLine.
 * JP: ワールドラインを作成。
 */
export const createWorldLine = (maxHistorySize = 1000): WorldLine => ({
  history: [],
  maxHistorySize,
});

/**
 * Append a PhaseSpace snapshot.
 *
 * English: Keeps history length under `maxHistorySize`.
 * 日本語: `maxHistorySize` を超えたら古いものを捨てます。
 */
export const appendWorldLine = (
  wl: WorldLine,
  phaseSpace: PhaseSpace,
): WorldLine => {
  const newHistory = [...wl.history, phaseSpace];

  if (newHistory.length > wl.maxHistorySize) {
    newHistory.shift();
  }

  return {
    ...wl,
    history: newHistory,
  };
};

/**
 * Get the latest state.
 * JP: 現在（最新）の状態を取得。
 */
export const getCurrentWorldLine = (wl: WorldLine): PhaseSpace | null =>
  wl.history[wl.history.length - 1] || null;

/**
 * Get the full trajectory (copy).
 * JP: 履歴全体を取得（コピー）。
 */
export const getTrajectoryWorldLine = (wl: WorldLine): PhaseSpace[] => [
  ...wl.history,
];

/**
 * Solve for t in [0,1] where the line segment intersects the observer's past light cone.
 *
 * We find t such that:
 *   (observerPos - (pos1 + t*(pos2-pos1)))^2 = 0
 * under the Minkowski metric.
 */
const findLightlikeIntersectionParam = (
  pos1: Vector4,
  pos2: Vector4,
  observerPos: Vector4,
): number => {
  const dx = subVector4(pos2, pos1);
  const x0 = subVector4(observerPos, pos1);

  // Quadratic: a t^2 - 2 b t + c = 0
  const a = lorentzDotVector4(dx, dx);
  const b = lorentzDotVector4(dx, x0);
  const c = lorentzDotVector4(x0, x0);

  const discriminant = b * b - a * c;
  if (discriminant < 0) return -1;

  const sqrtDiscriminant = Math.sqrt(discriminant);
  // Choose the solution that corresponds to the past-light-cone intersection.
  return (b + sqrtDiscriminant) / a;
};

/**
 * Find the latest index k such that history[k].pos.t <= t.
 * Returns -1 if all samples are in the future (history[0].pos.t > t).
 */
const findLatestIndexAtOrBeforeTime = (
  history: PhaseSpace[],
  t: number,
): number => {
  if (history.length === 0) return -1;

  // History is stored in increasing time order (oldest → newest).
  if (history[0].pos.t > t) return -1;
  if (history[history.length - 1].pos.t <= t) return history.length - 1;

  let left = 0;
  let right = history.length - 1;

  // Invariant: history[left].t <= t < history[right].t
  while (right - left > 1) {
    const mid = Math.floor((left + right) / 2);
    if (history[mid].pos.t <= t) {
      left = mid;
    } else {
      right = mid;
    }
  }

  return left;
};

/**
 * Past light-cone intersection between an observer event and a world line.
 *
 * English:
 *   - Walks the world line from newest to oldest and looks for the first segment
 *     that intersects the observer's past light cone.
 *   - Returns an *approximate* PhaseSpace (currently no interpolation).
 *
 * 日本語:
 *   - 世界線を最新→過去へ辿り、過去光円錐と交差する区間を探します。
 *   - 返す PhaseSpace は暫定（現在は補間していません）。
 */
export const pastLightConeIntersectionWorldLine = (
  wl: WorldLine,
  observerPosition: Vector4,
): PhaseSpace | null => {
  const history = wl.history;
  if (history.length === 0) return null;

  // We may have samples slightly "in the future" compared to the observer's t due to clock drift.
  // Start from the newest sample that is at/before observer time, but include one future sample
  // to cover the boundary segment.
  const lastPastIdx = findLatestIndexAtOrBeforeTime(
    history,
    observerPosition.t,
  );
  if (lastPastIdx < 0) return null;

  const startIdx = Math.min(history.length - 1, lastPastIdx + 1);

  for (let i = startIdx; i >= 1; i--) {
    const state = history[i];
    const prevState = history[i - 1];

    // If both endpoints are not in the observer's past, skip.
    // We use separation = observer - event; separation.t > 0 means "event is in the past".
    const sepPrev = subVector4(observerPosition, prevState.pos);
    const sepCurr = subVector4(observerPosition, state.pos);

    if (sepPrev.t <= 0 && sepCurr.t <= 0) {
      continue;
    }

    const tParam = findLightlikeIntersectionParam(
      prevState.pos,
      state.pos,
      observerPosition,
    );

    if (tParam >= 0 && tParam <= 1) {
      // TODO: interpolate PhaseSpace between prevState and state using tParam.
      // For now we return the older endpoint as an approximation.
      return prevState;
    }
  }

  return null;
};

/**
 * Clear history.
 * JP: 履歴をクリア。
 */
export const clearWorldLine = (wl: WorldLine): WorldLine => ({
  ...wl,
  history: [],
});
