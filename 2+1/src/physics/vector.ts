/**
 * Vector helpers used by the relativistic simulation.
 *
 * English:
 *   - We use units where **c = 1**.
 *   - `Vector3` is used for spatial vectors (including the spatial part of 4-velocity).
 *   - `Vector4` is a spacetime vector `(t, x, y, z)`.
 *   - Minkowski inner product uses signature (+,+,+,-): x²+y²+z²-t².
 *
 * 日本語:
 *   - 単位系は **c = 1** を前提にしています。
 *   - `Vector3` は空間ベクトル（4元速度の空間成分など）に使います。
 *   - `Vector4` は時空ベクトル `(t, x, y, z)` です。
 *   - ミンコフスキー内積の符号は (+,+,+,-): x²+y²+z²-t²。
 */

/**
 * 3D vector.
 * JP: 3次元ベクトル。
 */
export type Vector3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/**
 * Create a Vector3.
 * JP: Vector3 を作成。
 */
export const createVector3 = (x: number, y: number, z: number): Vector3 => ({
  x,
  y,
  z,
});

/**
 * Zero vector.
 * JP: ゼロベクトル。
 */
export const vector3Zero = (): Vector3 => createVector3(0, 0, 0);

/**
 * Add vectors.
 * JP: ベクトルの加算。
 */
export const addVector3 = (a: Vector3, b: Vector3): Vector3 =>
  createVector3(a.x + b.x, a.y + b.y, a.z + b.z);

/**
 * Subtract vectors.
 * JP: ベクトルの減算。
 */
export const subVector3 = (a: Vector3, b: Vector3): Vector3 =>
  createVector3(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Scale a vector by a scalar.
 * JP: ベクトルのスカラー倍。
 */
export const scaleVector3 = (v: Vector3, scalar: number): Vector3 =>
  createVector3(v.x * scalar, v.y * scalar, v.z * scalar);

/**
 * Dot product.
 * JP: ベクトルの内積。
 */
export const dotVector3 = (a: Vector3, b: Vector3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Cross product.
 * JP: ベクトルの外積。
 */
export const crossVector3 = (a: Vector3, b: Vector3): Vector3 =>
  createVector3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );

/**
 * Squared length.
 * JP: ベクトルの長さの2乗。
 */
export const lengthSquaredVector3 = (v: Vector3): number => dotVector3(v, v);

/**
 * Length.
 * JP: ベクトルの長さ。
 */
export const lengthVector3 = (v: Vector3): number =>
  Math.sqrt(lengthSquaredVector3(v));

/**
 * Normalize.
 * JP: ベクトルの正規化。
 */
export const normalizeVector3 = (v: Vector3): Vector3 => {
  const len = lengthVector3(v);
  if (len === 0) return vector3Zero();
  return scaleVector3(v, 1 / len);
};

/**
 * Gamma factor from the spatial part of the 4-velocity.
 *
 * English:
 *   - In this codebase `u` is treated as the spatial part of the 4-velocity
 *     (a.k.a. proper velocity), so γ = sqrt(1 + |u|^2).
 *
 * 日本語:
 *   - このコードでは `u` を4元速度の空間成分（いわゆる固有速度）として扱うため、
 *     γ = sqrt(1 + |u|^2) になります。
 */
export const gamma = (u: Vector3): number => {
  return Math.sqrt(1.0 + lengthSquaredVector3(u));
};

/**
 * 4D spacetime vector (t, x, y, z).
 * JP: 4次元ベクトル（時空ベクトル）。
 */
export type Vector4 = {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/**
 * Create a Vector4.
 * JP: Vector4 を作成。
 */
export const createVector4 = (
  t: number,
  x: number,
  y: number,
  z: number,
): Vector4 => ({
  t,
  x,
  y,
  z,
});

/**
 * Zero spacetime vector.
 * JP: ゼロベクトル。
 */
export const vector4Zero = (): Vector4 => createVector4(0, 0, 0, 0);

/**
 * Convert Vector3 to Vector4 by adding time component.
 * JP: Vector3 から Vector4 へ（時間成分を追加）。
 */
export const toVector4 = (v: Vector3, t: number): Vector4 =>
  createVector4(t, v.x, v.y, v.z);

/**
 * Add Vector4.
 * JP: Vector4 の加算。
 */
export const addVector4 = (a: Vector4, b: Vector4): Vector4 =>
  createVector4(a.t + b.t, a.x + b.x, a.y + b.y, a.z + b.z);

/**
 * Subtract Vector4.
 * JP: Vector4 の減算。
 */
export const subVector4 = (a: Vector4, b: Vector4): Vector4 =>
  createVector4(a.t - b.t, a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Scale Vector4.
 * JP: Vector4 のスカラー倍。
 */
export const scaleVector4 = (v: Vector4, scalar: number): Vector4 =>
  createVector4(v.t * scalar, v.x * scalar, v.y * scalar, v.z * scalar);

/**
 * Minkowski inner product with signature (+,+,+,-).
 * JP: ミンコフスキー内積（符号 +,+,+,-）。
 */
export const lorentzDotVector4 = (a: Vector4, b: Vector4): number =>
  a.x * b.x + a.y * b.y + a.z * b.z - a.t * b.t;

/**
 * Check if an event is in the observer's past light cone.
 * True when the separation is timelike or lightlike AND the event is in the past.
 * JP: event が observer の過去光円錐内（時間的 or 光的、かつ過去）にあるか判定。
 *
 * **PBC 対応**: caller 側で event を image cell ごとに `eventImage(event, cell, L)` で
 * 並進してから本関数を呼ぶ pattern (= universal cover の image loop)。 本関数自体は
 * unwrapped 連続値前提で計算する純粋関数。 詳細: `causalEvents.ts` の image cell loop。
 */
export const isInPastLightCone = (
  event: Vector4,
  observer: Vector4,
): boolean => {
  const diff = subVector4(event, observer);
  return lorentzDotVector4(diff, diff) <= 0 && observer.t > event.t;
};

/**
 * Extract spatial part.
 * JP: 空間成分のみ取得。
 */
export const spatialVector4 = (v: Vector4): Vector3 =>
  createVector3(v.x, v.y, v.z);

/**
 * Convert spatial part of 4-velocity to full 4-velocity.
 * JP: 4元速度（u^μ）を作る。
 */
export const getVelocity4 = (u: Vector3): Vector4 =>
  createVector4(gamma(u), u.x, u.y, u.z);

/**
 * Classify spacetime interval type.
 * JP: 時空間隔のタイプを判定。
 */
export const intervalTypeVector4 = (
  v: Vector4,
): "timelike" | "lightlike" | "spacelike" => {
  const s2 = lorentzDotVector4(v, v);
  if (s2 < 0) return "timelike";
  if (s2 === 0) return "lightlike";
  return "spacelike";
};

/**
 * Find the intersection of a spacetime segment with the observer's past light cone.
 *
 * The segment is parametrized as X(λ) = start + λ * delta, λ ∈ [0, 1].
 * Solves lorentzDot(observer - X, observer - X) = 0 and returns the latest
 * past intersection point, or null if none exists.
 *
 * JP: 時空区間 X(λ) = start + λ * delta (λ ∈ [0,1]) と
 * 観測者の過去光円錐の交点を求める。最も未来側の過去交点を返す。
 */
/**
 * Generic light cone intersection solver for a spacetime segment.
 * `mode`: "past" returns the latest point in the observer's past,
 *         "future" returns the earliest point in the observer's future.
 */
const lightConeIntersectionSegmentImpl = (
  start: Vector4,
  delta: Vector4,
  observerPos: Vector4,
  mode: "past" | "future",
): Vector4 | null => {
  const sep = subVector4(observerPos, start);

  const a = lorentzDotVector4(delta, delta);
  const b = -2 * lorentzDotVector4(sep, delta);
  const c = lorentzDotVector4(sep, sep);

  const EPS = 1e-9;
  const candidates: number[] = [];

  if (Math.abs(a) < EPS) {
    if (Math.abs(b) < EPS) return null;
    candidates.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sqrtDisc = Math.sqrt(Math.max(0, disc));
    candidates.push((-b - sqrtDisc) / (2 * a));
    candidates.push((-b + sqrtDisc) / (2 * a));
  }

  let best: Vector4 | null = null;
  for (const lambda of candidates) {
    if (lambda < -EPS || lambda > 1 + EPS) continue;
    const t = Math.min(1, Math.max(0, lambda));
    const point = createVector4(
      start.t + delta.t * t,
      start.x + delta.x * t,
      start.y + delta.y * t,
      start.z + delta.z * t,
    );
    if (mode === "past") {
      if (observerPos.t - point.t <= EPS) continue;
      if (!best || point.t > best.t) best = point;
    } else {
      if (point.t - observerPos.t <= EPS) continue;
      if (!best || point.t < best.t) best = point;
    }
  }

  return best;
};

export const pastLightConeIntersectionSegment = (
  start: Vector4,
  delta: Vector4,
  observerPos: Vector4,
): Vector4 | null =>
  lightConeIntersectionSegmentImpl(start, delta, observerPos, "past");

export const futureLightConeIntersectionSegment = (
  start: Vector4,
  delta: Vector4,
  observerPos: Vector4,
): Vector4 | null =>
  lightConeIntersectionSegmentImpl(start, delta, observerPos, "future");

// ─────────────────────────────────────────────────────────────────────────────
// Quaternion (3+1 互換の姿勢表現)。
//
// 2+1 ゲームでは yaw 1 自由度しか使わないが、3+1 移行時の spec 再書きを避けるため
// 4 成分の quaternion で保持する。2+1 限定で使う場合の慣例:
//   - 回転軸は display z 軸 (= world t 軸 = camera.up)、つまり xy spatial plane 内 rotation
//   - `yawToQuat(θ) = (cos(θ/2), 0, 0, sin(θ/2))` (w, x, y, z)
//
// 四元数の乗法は `a * b` = 「先に b、次に a を適用」(Hamilton convention)。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 3D 回転の四元数表現 `q = w + x·i + y·j + z·k`。
 * JP: 3D 回転を表す四元数。
 */
export type Quaternion = {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/** 単位四元数 (回転なし)。 */
export const quatIdentity = (): Quaternion => ({ w: 1, x: 0, y: 0, z: 0 });

/**
 * 2+1 の yaw → quaternion。回転軸は `(0, 0, 1)` (display z、= world t 軸まわり)。
 */
export const yawToQuat = (yaw: number): Quaternion => ({
  w: Math.cos(yaw / 2),
  x: 0,
  y: 0,
  z: Math.sin(yaw / 2),
});

/**
 * 2+1 限定: z 軸まわりの pure rotation quaternion から yaw を復元。
 * x / y 成分があっても無視される (3D 一般回転は対象外、2+1 では z 軸成分のみ使う)。
 */
export const quatToYaw = (q: Quaternion): number => 2 * Math.atan2(q.z, q.w);

/**
 * Quaternion 乗法 (Hamilton 規約: `a · b` は「先に b、次に a」)。
 */
export const multiplyQuat = (a: Quaternion, b: Quaternion): Quaternion => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

/**
 * 共役 (逆回転を与える、単位四元数なら inverse と一致)。
 */
export const conjugateQuat = (q: Quaternion): Quaternion => ({
  w: q.w,
  x: -q.x,
  y: -q.y,
  z: -q.z,
});

/**
 * ノルム 1 に正規化。数値誤差蓄積対策で broadcast 直前や integration 後に呼ぶ。
 * ゼロ四元数は identity に fallback (drawing を死なせない最小防衛)。
 */
export const normalizeQuat = (q: Quaternion): Quaternion => {
  const n2 = q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z;
  if (n2 === 0) return quatIdentity();
  const inv = 1 / Math.sqrt(n2);
  return { w: q.w * inv, x: q.x * inv, y: q.y * inv, z: q.z * inv };
};

/**
 * Spherical linear interpolation。履歴 replay や他機姿勢補間に使う。
 * `t ∈ [0, 1]` で a→b。近接時は linear lerp + 正規化に fallback (数値安定)。
 */
export const slerpQuat = (
  a: Quaternion,
  b: Quaternion,
  t: number,
): Quaternion => {
  let dot = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  // 二重被覆 (q と -q は同じ回転) — 短経路を取るため dot<0 なら b を反転
  if (dot < 0) {
    dot = -dot;
    bw = -bw;
    bx = -bx;
    by = -by;
    bz = -bz;
  }
  if (dot > 0.9995) {
    // 近接時は lerp + 正規化
    return normalizeQuat({
      w: a.w + t * (bw - a.w),
      x: a.x + t * (bx - a.x),
      y: a.y + t * (by - a.y),
      z: a.z + t * (bz - a.z),
    });
  }
  const theta0 = Math.acos(dot);
  const sinTheta0 = Math.sin(theta0);
  const theta = theta0 * t;
  const s1 = Math.sin(theta) / sinTheta0;
  const s0 = Math.cos(theta) - dot * s1;
  return {
    w: s0 * a.w + s1 * bw,
    x: s0 * a.x + s1 * bx,
    y: s0 * a.y + s1 * by,
    z: s0 * a.z + s1 * bz,
  };
};
