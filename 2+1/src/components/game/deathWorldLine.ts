import {
  addVector4,
  scaleVector4,
  type Vector4,
} from "../../physics/vector";

/**
 * 死亡 event の extrapolated 世界線 W_D(τ) = x_D + u_D·τ と観測者過去光円錐の交点 τ_0 を返す。
 *
 * 物理:
 *   - x_D: 死亡時空点 (4-position)
 *   - u_D: 死亡時 4-velocity (γ, γv_x, γv_y, γv_z)、Minkowski signature (+,-,-,-) で u_D·u_D = 1
 *     (timelike、光速以下)
 *   - W_D(τ): 死者 proper time τ に沿った "仮想慣性" 世界線。死者本人は自由に加速できるが、
 *     他者から見た死亡 event は u_D での extrapolation として扱う (死者は自分の world point を
 *     世界に announce しないため)。
 *   - 観測者過去光円錐: `observer.t − E.t = |E.xy − observer.xy|` を満たす event E。
 *
 * 二次方程式:
 *   `(Δt − u_D.t·τ)² = (Δx − u_D.x·τ)² + (Δy − u_D.y·τ)² + (Δz − u_D.z·τ)²` を整理し
 *   `u_D.t² − u_D.x² − u_D.y² − u_D.z² = 1` (timelike 正規化) を代入すると
 *     τ² − 2Bτ + C = 0
 *   ただし
 *     B = u_D.t·Δt − u_D.x·Δx − u_D.y·Δy − u_D.z·Δz   (Minkowski (+,-,-,-) inner product)
 *     C = Δt² − Δx² − Δy² − Δz²                        (Minkowski (+,-,-,-) norm²)
 *     Δ = observer − x_D
 *   → τ = B ± √(B² − C)。過去光円錐解は小さい方 `B − √(B² − C)` (= 観測者の過去側)。
 *
 * 戻り値:
 *   - τ_0 (number):
 *     - `≥ 0`: x_D の死亡 event が観測された後、extrapolated 世界線 上 τ_0 まで past-cone が sweep。
 *     - `< 0`: 観測者過去光円錐がまだ x_D に到達していない (= 死亡 event 未観測、live 世界線側)。
 *   - null: discriminant 負 (B² < C)。物理的には起こらないはず (x_D と observer が spacelike
 *     分離だったとしても、u_D が timelike なので W_D は observer の過去光円錐を必ず横切る)。
 *     防御的に null return、caller は「未観測」として扱う。
 */
export const pastLightConeIntersectionDeathWorldLine = (
  xD: Vector4,
  uD: Vector4,
  observerPos: Vector4,
): number | null => {
  const dt = observerPos.t - xD.t;
  const dx = observerPos.x - xD.x;
  const dy = observerPos.y - xD.y;
  const dz = observerPos.z - xD.z;
  const B = uD.t * dt - uD.x * dx - uD.y * dy - uD.z * dz;
  const C = dt * dt - dx * dx - dy * dy - dz * dz;
  const disc = B * B - C;
  if (disc < 0) return null;
  return B - Math.sqrt(disc);
};

/**
 * W_D(τ) = x_D + u_D·τ を評価。τ は死者 proper time。
 */
export const evaluateDeathWorldLine = (
  xD: Vector4,
  uD: Vector4,
  tau: number,
): Vector4 => addVector4(xD, scaleVector4(uD, tau));
