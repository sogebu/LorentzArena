import { inverseLorentzBoost, multiplyVector4Matrix4 } from "./matrix";
import {
  addVector3,
  addVector4,
  createVector4,
  getVelocity4,
  quatIdentity,
  type Quaternion,
  scaleVector3,
  scaleVector4,
  spatialVector4,
  type Vector3,
  type Vector4,
  vector4Zero,
} from "./vector";

/**
 * Relativistic mechanics utilities.
 *
 * English:
 *   - `PhaseSpace` stores 4-position, spatial part of 4-velocity, orientation
 *     quaternion, and world-frame 4-acceleration.
 *   - `evolvePhaseSpace` integrates motion in **proper time** dτ using proper
 *     acceleration. Heading is transported unchanged (no angular integration
 *     in current spec; caller sets heading externally e.g. from camera yaw).
 *
 * 日本語:
 *   - `PhaseSpace` は 4元位置 + 4元速度の空間成分 + 姿勢 quaternion + 世界系
 *     4元加速度を保持します。
 *   - `evolvePhaseSpace` は固有時間 dτ で固有加速度を積分します。heading は
 *     そのまま運搬 (角速度統合は現仕様外、呼び出し側が camera yaw 等から設定)。
 */

/**
 * Phase space (4-position + spatial part of 4-velocity + orientation + 4-acceleration).
 *
 * - `heading`: 姿勢 quaternion。2+1 では yaw 1 自由度 (`yawToQuat(θ)`)、3+1 移行時
 *   そのまま全姿勢へ拡張。
 * - `alpha`: world 系 4-acceleration `α^μ` (制約 `u·α = 0` は構築時に保証)。
 *   rest 系の proper acceleration `a^i` を `L(−u)·(0, a)` で世界系に boost した値。
 *   静止 / 無加速で `(0, 0, 0, 0)`。
 *
 * 型拡張は 2026-04-21 から (plan `2026-04-21-phaseSpace-heading-accel.md`)。
 * 旧呼出サイトは heading/alpha の default 引数で救済 (identity / zero)。
 *
 * JP: 相対論的位相空間 (位置 + 速度 + 姿勢 + 加速度)。
 */
export type PhaseSpace = {
  readonly pos: Vector4;
  readonly u: Vector3;
  readonly heading: Quaternion;
  readonly alpha: Vector4;
};

/**
 * Create a PhaseSpace。heading/alpha は省略時に identity / zero。
 * JP: PhaseSpace を作成。heading/alpha は省略可。
 */
export const createPhaseSpace = (
  pos: Vector4,
  u: Vector3,
  heading: Quaternion = quatIdentity(),
  alpha: Vector4 = vector4Zero(),
): PhaseSpace => ({
  pos,
  u,
  heading,
  alpha,
});

/**
 * Time evolution under proper acceleration (relativistic equation of motion).
 *
 * English:
 *   - `properAcceleration` is defined in the instantaneous rest frame (typically thrust).
 *   - We transform it to the world frame with an inverse boost.
 *   - Integration variable is proper time dτ.
 *   - Optional `frictionCoefficient` k applies world-frame linear friction
 *     `du/dτ ⊃ -k u` via **semi-implicit Euler** (= unconditionally stable for
 *     any dτ, no `dτ < 2/k` bound). For k=0 (= default), reduces to classic
 *     explicit Euler.
 *
 * 日本語:
 *   - `properAcceleration` は瞬間静止系で定義された固有加速度 (= thrust 想定)。
 *   - 逆ブーストで世界系へ変換して積分します。
 *   - 積分は固有時間 dτ で行います。
 *   - 任意 `frictionCoefficient` k で世界系線形摩擦 `du/dτ ⊃ -k u` を
 *     **semi-implicit Euler** で積分 (= 任意 dτ で unconditionally 安定、
 *     `dτ < 2/k` 制約なし)。 k=0 (= default) で旧 explicit Euler と等価。
 *
 * **数値解析根拠** (= 2026-05-06 LorentzArena Bug 14 完全治療 + post-deploy
 * implicit Euler refactor、 詳細: `claude-config/conventions/scientific-computing.md §2`):
 *
 * - Continuous: `du/dτ = a_world(u) - k × u` で friction は `u → 0` 指数減衰、 物理的に常に安定
 * - Explicit Euler: `newU = u + (a_world - k u) × dτ` → `Δ > 2/k` で発散 (= Bug 14 root cause、
 *   旧仕様で mobile suspend 復帰 1 tick で `u(1 - kΔ) = u × (-22499)` overflow)
 * - **Semi-implicit Euler**: `newU = (u + a_world × dτ) / (1 + γkΔ)` で任意 Δ で `|newU| ≤ |u +
 *   a × dτ|` の有界、 closed-form 1 step、 substep 不要、 `MAX_STABLE_SUB_DTAU` 等の安全 margin 不要
 * - γ は current u から (= boost matrix と同じ source)、 friction 部分のみ implicit (= newU 依存)
 *   で thrust + boost は explicit のまま (= 線形系なので closed-form solve が容易)
 *
 * 旧 substep 案との差: substep は explicit Euler を温存して dτ を分割する **数値 workaround**、
 * implicit Euler は L5 root level で「friction 項の数値不安定性自体を消す」 fundamental fix。
 * 詳細経緯: `plans/2026-05-06-bug14-global-active-time.md §6.5`、 `odakin-prefs/work-discipline.md
 * §「Fix 提案の 3 verification」` V1 reflection。
 */
export const evolvePhaseSpace = (
  ps: PhaseSpace,
  properAcceleration: Vector3,
  dTau: number,
  frictionCoefficient = 0,
): PhaseSpace => {
  // 1) Acceleration in the instantaneous rest frame (a^μ_rest).
  // JP: 瞬間静止系での加速度を4元ベクトルにする。
  const accel4Rest = createVector4(
    0.0,
    properAcceleration.x,
    properAcceleration.y,
    properAcceleration.z,
  );

  // 2) Rest frame → world frame.
  // JP: 静止系→世界系のローレンツ変換。
  const boostMatrix = inverseLorentzBoost(ps.u);
  const accel4World = multiplyVector4Matrix4(boostMatrix, accel4Rest);

  // 3) Update spatial part of 4-velocity via semi-implicit Euler.
  // JP: 4元速度の空間成分を semi-implicit Euler で更新。
  // For k=0: newU = u + a_world × dτ (= classic explicit Euler、 旧仕様と等価)
  // For k>0: newU = (u + a_world × dτ) / (1 + γkΔ) (= friction implicit、 任意 Δ で安定)
  // γ は ps.u から計算 (= boost matrix と同 source、 semi-implicit semantics)
  const accel4WorldSpatial = spatialVector4(accel4World);
  const explicitU = addVector3(ps.u, scaleVector3(accel4WorldSpatial, dTau));
  let newU: Vector3;
  if (frictionCoefficient > 0) {
    const gamma = Math.sqrt(
      1 + ps.u.x * ps.u.x + ps.u.y * ps.u.y + ps.u.z * ps.u.z,
    );
    const denom = 1 + gamma * frictionCoefficient * dTau;
    newU = {
      x: explicitU.x / denom,
      y: explicitU.y / denom,
      z: explicitU.z / denom,
    };
  } else {
    newU = explicitU;
  }

  // 4) Update position: dx/dτ = u^μ (semi-implicit Euler: uses newU, not old ps.u).
  // JP: 位置の更新（dx/dτ = u^μ、semi-implicit Euler: 加速後の newU を使用）。
  const newPos = addVector4(ps.pos, scaleVector4(getVelocity4(newU), dTau));

  // 5) heading は角速度統合なしで運搬、alpha は今回計算した world 系 4-加速度を格納。
  //    制約 u·α=0 は rest 系 (0, a) を Lorentz 変換しただけなので自動で満たされる。
  //    friction は newU 計算時にのみ反映、 alpha 表示には含めない (= thrust 由来の
  //    world-frame 4-acceleration で表示一貫性を保つ、 静止漂流時に矢印反転を防ぐ)。
  // JP: heading は保持、alpha は今ステップの world 4-加速度を格納。
  return createPhaseSpace(newPos, newU, ps.heading, accel4World);
};

