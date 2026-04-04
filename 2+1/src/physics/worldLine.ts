import {
  type Vector4,
  subVector4,
  lorentzDotVector4,
  createVector4,
  gamma,
} from "./vector";
import { type PhaseSpace, createPhaseSpace } from "./mechanics";

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
  readonly origin: PhaseSpace | null; // 無限の過去に延びる半直線の起点（最初のライフのみ。null なら半直線なし）
};

/**
 * Create a WorldLine.
 * origin を渡すと過去方向に半直線を延長する（最初のライフ用）。
 * リスポーン後のライフは origin なしで作成する。
 */
export const createWorldLine = (
  maxHistorySize = 5000,
  origin: PhaseSpace | null = null,
): WorldLine => ({
  history: [],
  maxHistorySize,
  origin,
});

/**
 * Append a PhaseSpace snapshot.
 *
 * 因果的 trimming: maxHistorySize を超えたとき、最古の点が全他プレイヤーの
 * 過去光円錐の過去側にある場合のみ削除。未来側にある点は保持。
 * otherPlayerPositions を省略すると従来通り無条件に削除。
 */
export const appendWorldLine = (
  wl: WorldLine,
  phaseSpace: PhaseSpace,
  otherPlayerPositions?: Vector4[],
): WorldLine => {
  const newHistory = [...wl.history, phaseSpace];

  if (newHistory.length > wl.maxHistorySize) {
    const oldest = newHistory[0];
    let canRemove = true;

    // 安全弁: maxHistorySize の2倍を超えたら因果的判定を無視して強制削除
    const forceRemove = newHistory.length > wl.maxHistorySize * 2;

    if (!forceRemove && otherPlayerPositions) {
      for (const otherPos of otherPlayerPositions) {
        const diff = subVector4(otherPos, oldest.pos); // other - oldest
        const s2 = lorentzDotVector4(diff, diff);
        // oldest を削除できるのは、otherPos の過去光円錐の内側にある場合のみ
        // = otherPos が oldest の未来側 (diff.t > 0) かつ時間的 (s2 < 0)
        const isInsidePastCone = diff.t > 0 && s2 < 0;
        if (!isInsidePastCone) {
          canRemove = false;
          break;
        }
      }
    }

    if (canRemove || forceRemove) {
      newHistory.shift();
    }
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
/**
 * Compute the 4-position at proper time offset s along a straight worldline
 * (constant velocity) from a given PhaseSpace, going into the past (s > 0 = past).
 */
export const positionAlongStraightWorldLine = (
  ps: PhaseSpace,
  s: number,
): Vector4 => {
  const g = gamma(ps.u);
  return createVector4(
    ps.pos.t - s * g,
    ps.pos.x - s * ps.u.x,
    ps.pos.y - s * ps.u.y,
    ps.pos.z - s * ps.u.z,
  );
};

/**
 * Find the past light cone intersection with a semi-infinite straight worldline
 * extending from `origin` into the past (constant velocity origin.u).
 * Returns the PhaseSpace at the intersection, or null.
 */
const pastLightConeIntersectionHalfLine = (
  origin: PhaseSpace,
  observerPosition: Vector4,
): PhaseSpace | null => {
  // Half-line: P(s) = origin.pos - s * u^μ, s >= 0 (s increases into the past)
  // u^μ = (γ, u_x, u_y, u_z)
  const g = gamma(origin.u);
  // Direction vector (into the past): d = (-γ, -u_x, -u_y, -u_z)
  const d: Vector4 = createVector4(-g, -origin.u.x, -origin.u.y, -origin.u.z);
  const x0 = subVector4(observerPosition, origin.pos);

  // Quadratic: a*s^2 - 2*b*s + c = 0
  const a = lorentzDotVector4(d, d);
  const b = lorentzDotVector4(d, x0);
  const c = lorentzDotVector4(x0, x0);

  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;

  const sqrtD = Math.sqrt(discriminant);
  // Both roots
  const s1 = (b + sqrtD) / a;
  const s2 = (b - sqrtD) / a;

  // We need s >= 0 (past direction). Pick the smallest positive s (closest to origin).
  let s = -1;
  if (s1 >= 0 && s2 >= 0) s = Math.min(s1, s2);
  else if (s1 >= 0) s = s1;
  else if (s2 >= 0) s = s2;
  if (s < 0) return null;

  // Also verify it's in the observer's past
  const intersectionPos = positionAlongStraightWorldLine(origin, s);
  if (intersectionPos.t > observerPosition.t) return null;

  return createPhaseSpace(intersectionPos, origin.u);
};

export const pastLightConeIntersectionWorldLine = (
  wl: WorldLine,
  observerPosition: Vector4,
): PhaseSpace | null => {
  const history = wl.history;
  if (history.length === 0) {
    // history が空でも origin があれば半直線で探す
    if (wl.origin) {
      return pastLightConeIntersectionHalfLine(wl.origin, observerPosition);
    }
    return null;
  }

  // We may have samples slightly "in the future" compared to the observer's t due to clock drift.
  // Start from the newest sample that is at/before observer time, but include one future sample
  // to cover the boundary segment.
  const lastPastIdx = findLatestIndexAtOrBeforeTime(
    history,
    observerPosition.t,
  );
  if (lastPastIdx < 0) {
    // history 全体が観測者の未来 → origin 半直線で探す
    if (wl.origin) {
      return pastLightConeIntersectionHalfLine(wl.origin, observerPosition);
    }
    return null;
  }

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

  // history を走査しても見つからなかった → origin 半直線で探す
  if (wl.origin) {
    // origin → history[0] のセグメントも探す（trimming でギャップがある場合）
    if (wl.origin.pos.t !== history[0].pos.t) {
      const tParam = findLightlikeIntersectionParam(
        wl.origin.pos,
        history[0].pos,
        observerPosition,
      );
      if (tParam >= 0 && tParam <= 1) {
        return createPhaseSpace(wl.origin.pos, wl.origin.u);
      }
    }

    // 半直線で探す
    return pastLightConeIntersectionHalfLine(wl.origin, observerPosition);
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
  origin: null,
});
