import { createPhaseSpace, type PhaseSpace } from "./mechanics";
import { shiftObserverToReferenceImage } from "./torus";
import {
  addVector4,
  createVector4,
  gamma,
  lorentzDotVector4,
  scaleVector4,
  slerpQuat,
  subVector4,
  type Vector4,
} from "./vector";

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
  readonly version: number; // append ごとにインクリメント。描画スロットリング用
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
  version: 0,
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
    version: wl.version + 1,
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

  // a ≈ 0 なら区間が光的（重複点 or 数値誤差）→ 交差なしとして扱う
  const EPS = 1e-12;
  if (Math.abs(a) < EPS) return -1;

  const discriminant = b * b - a * c;
  if (discriminant < 0) return -1;

  const sqrtDiscriminant = Math.sqrt(Math.max(0, discriminant));
  // Choose the solution that corresponds to the past-light-cone intersection.
  return (b + sqrtDiscriminant) / a;
};

/**
 * Find the latest index k such that history[k].pos.t <= t.
 * Returns -1 if all samples are in the future (history[0].pos.t > t).
 */
export const findLatestIndexAtOrBeforeTime = (
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

  return createPhaseSpace(intersectionPos, origin.u, origin.heading, origin.alpha);
};

/**
 * 線分 [prev, curr] 上の tParam ∈ [0, 1] における補間 PhaseSpace を構築する。
 * - pos: linear (既存どおり、呼出側で計算済の interpPos を渡す)
 * - u  : prev の値を採用 (既存慣例、segment 内で u は semi-constant)
 * - heading: spherical linear (slerp)
 * - alpha  : linear
 */
const interpolateSegmentPhaseSpace = (
  prev: PhaseSpace,
  curr: PhaseSpace,
  tParam: number,
  interpPos: Vector4,
): PhaseSpace => {
  const t1 = 1 - tParam;
  const headingAt = slerpQuat(prev.heading, curr.heading, tParam);
  const alphaAt = addVector4(
    scaleVector4(prev.alpha, t1),
    scaleVector4(curr.alpha, tParam),
  );
  return createPhaseSpace(interpPos, prev.u, headingAt, alphaAt);
};

/**
 * Linear scan reference implementation (O(N)).
 * Kept exported for regression tests against the binary-search production path.
 * 呼び出し元は `pastLightConeIntersectionWorldLine` (binary) を使うこと。
 */
export const pastLightConeIntersectionWorldLineLinear = (
  wl: WorldLine,
  observerPosition: Vector4,
  torusHalfWidth?: number,
): PhaseSpace | null => {
  const history = wl.history;
  // torus mode: 観測者を worldLine 最新点 (or origin) と同 image cell に shift してから
  // 連続値ベースの探索を実行。 詳細: physics/torus.ts shiftObserverToReferenceImage
  if (torusHalfWidth !== undefined) {
    const ref = history[history.length - 1]?.pos ?? wl.origin?.pos;
    if (ref) {
      observerPosition = shiftObserverToReferenceImage(
        observerPosition,
        ref,
        torusHalfWidth,
      );
    }
  }
  if (history.length === 0) {
    if (wl.origin) {
      return pastLightConeIntersectionHalfLine(wl.origin, observerPosition);
    }
    return null;
  }

  const lastPastIdx = findLatestIndexAtOrBeforeTime(
    history,
    observerPosition.t,
  );
  if (lastPastIdx < 0) {
    if (wl.origin) {
      return pastLightConeIntersectionHalfLine(wl.origin, observerPosition);
    }
    return null;
  }

  const startIdx = Math.min(history.length - 1, lastPastIdx + 1);

  for (let i = startIdx; i >= 1; i--) {
    const state = history[i];
    const prevState = history[i - 1];
    const sepPrev = subVector4(observerPosition, prevState.pos);
    const sepCurr = subVector4(observerPosition, state.pos);
    if (sepPrev.t <= 0 && sepCurr.t <= 0) continue;

    const tParam = findLightlikeIntersectionParam(
      prevState.pos,
      state.pos,
      observerPosition,
    );

    if (tParam >= 0 && tParam <= 1) {
      const t1 = 1 - tParam;
      const interpPos = createVector4(
        prevState.pos.t * t1 + state.pos.t * tParam,
        prevState.pos.x * t1 + state.pos.x * tParam,
        prevState.pos.y * t1 + state.pos.y * tParam,
        prevState.pos.z * t1 + state.pos.z * tParam,
      );
      return interpolateSegmentPhaseSpace(prevState, state, tParam, interpPos);
    }
  }

  if (wl.origin) {
    if (wl.origin.pos.t !== history[0].pos.t) {
      const tParam = findLightlikeIntersectionParam(
        wl.origin.pos,
        history[0].pos,
        observerPosition,
      );
      if (tParam >= 0 && tParam <= 1) {
        return createPhaseSpace(wl.origin.pos, wl.origin.u, wl.origin.heading, wl.origin.alpha);
      }
    }
    return pastLightConeIntersectionHalfLine(wl.origin, observerPosition);
  }

  return null;
};

/**
 * Signed "past cone distance" at history[i] relative to an observer event:
 *   g(i) = (observer.t − history[i].t) − |observer.xy(z) − history[i].xy(z)|
 * g > 0: history[i] is inside the observer's past light cone (timelike past).
 * g < 0: spacelike-separated or in the observer's future.
 *
 * In typical play g(i) is *roughly* monotonic decreasing as i increases
 * (observer.t − t_i shrinks linearly while ρ_i varies at speeds < c).
 * We use this for an O(log N) binary search, then scan a small ±K neighborhood
 * around the boundary as a safety net against non-monotonic target motion.
 */
const pastConeSignedDistance = (
  sample: PhaseSpace,
  observer: Vector4,
): number => {
  const dt = observer.t - sample.pos.t;
  const dx = observer.x - sample.pos.x;
  const dy = observer.y - sample.pos.y;
  const dz = observer.z - sample.pos.z;
  return dt - Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/**
 * Binary-search the largest index in `[lo, hi]` with g(i) ≥ 0 (= still inside
 * the observer's past light cone). Returns -1 if g(lo) < 0 (no such index).
 */
const findPastConeBoundary = (
  history: PhaseSpace[],
  lo: number,
  hi: number,
  observer: Vector4,
): number => {
  if (lo > hi) return -1;
  if (pastConeSignedDistance(history[lo], observer) < 0) return -1;
  if (pastConeSignedDistance(history[hi], observer) >= 0) return hi;
  let left = lo;
  let right = hi;
  // invariant: g(left) ≥ 0, g(right) < 0
  while (right - left > 1) {
    const mid = (left + right) >> 1;
    if (pastConeSignedDistance(history[mid], observer) >= 0) {
      left = mid;
    } else {
      right = mid;
    }
  }
  return left;
};

/** ± how many segments to linearly scan around the binary-search boundary. */
const CONE_NEIGHBORHOOD = 16;

/**
 * Past light-cone intersection between an observer event and a world line.
 *
 * **Algorithm (binary search + neighborhood scan, O(log N + K))**:
 *   1. Binary-search `findLatestIndexAtOrBeforeTime(history, observer.t)` to
 *      skip samples in the observer's future (clock drift tolerance).
 *   2. Binary-search `findPastConeBoundary` to find the largest i with g(i) ≥ 0,
 *      where g(i) = (observer.t − t_i) − ρ_i.
 *   3. Linearly scan ±`CONE_NEIGHBORHOOD` segments around the boundary from newest
 *      to oldest to find the first segment that actually intersects the null cone
 *      (via `findLightlikeIntersectionParam`). Neighborhood scan handles
 *      non-monotonic g cases (rare, but possible with fast-moving targets).
 *   4. Fall back to `origin` half-line if no segment intersects (respawn gap or
 *      history entirely in spacelike region).
 *
 * This replaces the O(N) full-history scan (see `*Linear` above) while
 * preserving identical results in all test cases.
 *
 * JP: 観測者の過去光円錐と世界線の交差 (最新側)。O(log N + K) で探す。
 */
export const pastLightConeIntersectionWorldLine = (
  wl: WorldLine,
  observerPosition: Vector4,
  torusHalfWidth?: number,
): PhaseSpace | null => {
  const history = wl.history;
  // torus mode: 観測者を worldLine 最新点 (or origin) と同 image cell に shift してから
  // 連続値ベースの探索を実行 (詳細: physics/torus.ts shiftObserverToReferenceImage)。
  // worldLine は連続値で保持されているので、 観測者を最新点近傍に持ってくれば過去光円錐
  // 探索が連続値で正常動作する。 履歴 ~16s に対して一周 ~40s 必要なので「光が一周回って
  // 届く」エッジケースは実用上発生しない。
  if (torusHalfWidth !== undefined) {
    const ref = history[history.length - 1]?.pos ?? wl.origin?.pos;
    if (ref) {
      observerPosition = shiftObserverToReferenceImage(
        observerPosition,
        ref,
        torusHalfWidth,
      );
    }
  }
  if (history.length === 0) {
    if (wl.origin) {
      return pastLightConeIntersectionHalfLine(wl.origin, observerPosition);
    }
    return null;
  }

  const lastPastIdx = findLatestIndexAtOrBeforeTime(
    history,
    observerPosition.t,
  );
  if (lastPastIdx < 0) {
    if (wl.origin) {
      return pastLightConeIntersectionHalfLine(wl.origin, observerPosition);
    }
    return null;
  }

  const startIdx = Math.min(history.length - 1, lastPastIdx + 1);

  // Binary-search the boundary where g(i) changes sign (≥ 0 → < 0).
  // boundary = -1 if every sample in [0, startIdx] is spacelike (rare).
  const boundary = findPastConeBoundary(history, 0, startIdx, observerPosition);
  const center = boundary >= 0 ? boundary : startIdx;
  const hi = Math.min(startIdx, center + CONE_NEIGHBORHOOD);
  const lo = Math.max(1, center - CONE_NEIGHBORHOOD);

  for (let i = hi; i >= lo; i--) {
    const state = history[i];
    const prevState = history[i - 1];
    const sepPrev = subVector4(observerPosition, prevState.pos);
    const sepCurr = subVector4(observerPosition, state.pos);
    if (sepPrev.t <= 0 && sepCurr.t <= 0) continue;

    const tParam = findLightlikeIntersectionParam(
      prevState.pos,
      state.pos,
      observerPosition,
    );

    if (tParam >= 0 && tParam <= 1) {
      const t1 = 1 - tParam;
      const interpPos = createVector4(
        prevState.pos.t * t1 + state.pos.t * tParam,
        prevState.pos.x * t1 + state.pos.x * tParam,
        prevState.pos.y * t1 + state.pos.y * tParam,
        prevState.pos.z * t1 + state.pos.z * tParam,
      );
      return interpolateSegmentPhaseSpace(prevState, state, tParam, interpPos);
    }
  }

  if (wl.origin) {
    if (wl.origin.pos.t !== history[0].pos.t) {
      const tParam = findLightlikeIntersectionParam(
        wl.origin.pos,
        history[0].pos,
        observerPosition,
      );
      if (tParam >= 0 && tParam <= 1) {
        return createPhaseSpace(wl.origin.pos, wl.origin.u, wl.origin.heading, wl.origin.alpha);
      }
    }
    return pastLightConeIntersectionHalfLine(wl.origin, observerPosition);
  }

  return null;
};

/**
 * Linear scan reference implementation (O(N)).
 * Kept exported for regression tests. 呼び出し元は `futureLightConeIntersectionWorldLine` を使うこと。
 */
export const futureLightConeIntersectionWorldLineLinear = (
  wl: WorldLine,
  observerPosition: Vector4,
): PhaseSpace | null => {
  const history = wl.history;
  if (history.length < 2) return null;

  for (let i = 1; i < history.length; i++) {
    const prevState = history[i - 1];
    const state = history[i];
    const sepPrev = subVector4(prevState.pos, observerPosition);
    const sepCurr = subVector4(state.pos, observerPosition);
    if (sepPrev.t < 0 && sepCurr.t < 0) continue;

    const tParam = findLightlikeIntersectionParam(
      prevState.pos,
      state.pos,
      observerPosition,
    );

    if (tParam >= 0 && tParam <= 1) {
      const t1 = 1 - tParam;
      const intersectionT = prevState.pos.t * t1 + state.pos.t * tParam;
      if (intersectionT <= observerPosition.t) continue;
      const interpPos = createVector4(
        intersectionT,
        prevState.pos.x * t1 + state.pos.x * tParam,
        prevState.pos.y * t1 + state.pos.y * tParam,
        prevState.pos.z * t1 + state.pos.z * tParam,
      );
      return interpolateSegmentPhaseSpace(prevState, state, tParam, interpPos);
    }
  }

  return null;
};

/**
 * Signed "future cone distance":
 *   f(i) = (history[i].t − observer.t) − |history[i].xy(z) − observer.xy(z)|
 * f > 0: history[i] is inside the observer's future light cone.
 */
const futureConeSignedDistance = (
  sample: PhaseSpace,
  observer: Vector4,
): number => {
  const dt = sample.pos.t - observer.t;
  const dx = sample.pos.x - observer.x;
  const dy = sample.pos.y - observer.y;
  const dz = sample.pos.z - observer.z;
  return dt - Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/**
 * Binary-search the smallest index in `[lo, hi]` with f(i) ≥ 0 (= inside the
 * observer's future light cone). Returns -1 if f(hi) < 0 (no such index).
 */
const findFutureConeBoundary = (
  history: PhaseSpace[],
  lo: number,
  hi: number,
  observer: Vector4,
): number => {
  if (lo > hi) return -1;
  if (futureConeSignedDistance(history[hi], observer) < 0) return -1;
  if (futureConeSignedDistance(history[lo], observer) >= 0) return lo;
  let left = lo;
  let right = hi;
  // invariant: f(left) < 0, f(right) ≥ 0
  while (right - left > 1) {
    const mid = (left + right) >> 1;
    if (futureConeSignedDistance(history[mid], observer) >= 0) {
      right = mid;
    } else {
      left = mid;
    }
  }
  return right;
};

/**
 * Future light-cone intersection between an observer event and a world line
 * (earliest intersection = where a signal sent NOW first reaches the target).
 *
 * **Algorithm (binary search + neighborhood scan, O(log N + K))**:
 *   1. Skip past samples via `findLatestIndexAtOrBeforeTime(history, observer.t)`.
 *      Only samples in the observer's future (t > observer.t) can be inside the
 *      future light cone.
 *   2. Binary-search `findFutureConeBoundary` to find the smallest i with f(i) ≥ 0.
 *   3. Linearly scan ±`CONE_NEIGHBORHOOD` around the boundary from oldest to newest,
 *      returning the earliest segment that actually intersects the null cone.
 *
 * 「今レーザーを撃ったら、どこでターゲットの世界線と交わるか」を表す最も過去側の交点。
 */
export const futureLightConeIntersectionWorldLine = (
  wl: WorldLine,
  observerPosition: Vector4,
): PhaseSpace | null => {
  const history = wl.history;
  if (history.length < 2) return null;

  const lastPastIdx = findLatestIndexAtOrBeforeTime(
    history,
    observerPosition.t,
  );
  const startIdx = Math.max(1, lastPastIdx + 1);
  const endIdx = history.length - 1;
  if (startIdx > endIdx) return null;

  const boundary = findFutureConeBoundary(
    history,
    startIdx,
    endIdx,
    observerPosition,
  );
  const center = boundary >= 0 ? boundary : startIdx;
  const lo = Math.max(1, center - CONE_NEIGHBORHOOD);
  const hi = Math.min(endIdx, center + CONE_NEIGHBORHOOD);

  for (let i = lo; i <= hi; i++) {
    const prevState = history[i - 1];
    const state = history[i];
    const sepPrev = subVector4(prevState.pos, observerPosition);
    const sepCurr = subVector4(state.pos, observerPosition);
    if (sepPrev.t < 0 && sepCurr.t < 0) continue;

    const tParam = findLightlikeIntersectionParam(
      prevState.pos,
      state.pos,
      observerPosition,
    );

    if (tParam >= 0 && tParam <= 1) {
      const t1 = 1 - tParam;
      const intersectionT = prevState.pos.t * t1 + state.pos.t * tParam;
      if (intersectionT <= observerPosition.t) continue;
      const interpPos = createVector4(
        intersectionT,
        prevState.pos.x * t1 + state.pos.x * tParam,
        prevState.pos.y * t1 + state.pos.y * tParam,
        prevState.pos.z * t1 + state.pos.z * tParam,
      );
      return interpolateSegmentPhaseSpace(prevState, state, tParam, interpPos);
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
  origin: null,
  version: wl.version + 1,
});
