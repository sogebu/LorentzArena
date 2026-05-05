import { gamma, type Vector3, type Vector4 } from "../../physics";
import { CAUSALITY_JUMP_EXIT_MARGIN_LS } from "./constants";

/**
 * Rule B (= 因果律対称ジャンプ) の中核計算。
 *
 * **Rule B**: me が peer の **過去光円錐内** (= peer.t > me.t AND timelike (peer - me)) にいる
 * とき、 me を `me + λ·u^μ` で advance させて peer の過去 null cone 表面 **+ exit margin** まで
 * forward exit する λ を求める。 peer から見れば「観測済の過去事象」 として既に光が届いた瞬間
 * の少し外側 (= spacelike 側) に対応。
 *
 * **公式の導出** (`plans/2026-05-02-causality-symmetric-jump.md` §3):
 *
 *   `me + λ·u^μ` が peer の null cone 上 (= 光速線):
 *     `(peer.t - (me.t + λγ))² = (peer.x - (me.x + λu_x))² + (peer.y - (me.y + λu_y))²`
 *
 *   展開し `γ² - u_x² - u_y² = 1` を使うと、 λ について 2 次方程式:
 *     `λ² - 2Bλ + C = 0`
 *
 *   ただし
 *     `B = γΔt - u_x·Δx - u_y·Δy`   (=「me と peer の 4-内積」 with signature 反転、 Δ ≡ peer - me)
 *     `C = Δt² - Δx² - Δy²`         (= timelike past で C > 0)
 *
 *   timelike past で B ≥ √C (= 逆 Cauchy-Schwarz)、 disc = B² - C ≥ 0。 forward exit (= 小さい
 *   方の正根) は:
 *     `λ_surface = B - √(B² - C)`
 *
 *   返り値: λ > 0 で forward exit が必要、 0 で対象外 (= spacelike already / future / disc 数値
 *   ガード等)。
 *
 * **Exit margin (= surface ぴったりではなく ε 内側に着地)**:
 *
 *   `λ_exit = λ_surface + CAUSALITY_JUMP_EXIT_MARGIN_LS`  (jump 発火時のみ)
 *
 *   旧仕様 (`λ = λ_surface`) は me を peer の null cone 表面ぴったり (= `l = (peer-me)·(peer-me)
 *   = 0` 境界) に着地させていたが、 次 tick の Rule A 判定 `l < -threshold` が virtualPos /
 *   数値誤差 / network jitter で ON/OFF を flip する boundary chatter race が判明
 *   (= 2026-05-05 LH flicker 仮説 i)。 着地点を spacelike 側に ε だけ押し込めば次 tick の
 *   Rule A は確実に no-freeze、 振動が消える。
 *
 *   ε は Rule A の `CAUSAL_FREEZE_HYSTERESIS` (l 単位、 wasFrozen=true 時のみ閾値厚) と
 *   complementary な対称構造: Rule A が「凍結状態を抜けるには明確に外側まで」、 Rule B が
 *   「jump 着地は surface より明確に内側まで」 で、 因果律 state machine 全体が boundary に
 *   張り付かない設計。 詳細: `constants.ts:CAUSALITY_JUMP_EXIT_MARGIN_LS` docstring +
 *   DESIGN.md §因果律対称化 + 5/5 exit margin 拡張。
 *
 * **B の符号と λ_exit の関係 (= 逆 Cauchy-Schwarz の系)**:
 * - me が peer の方向に「向かう」 (u·Δxy > 0): B 小、 λ_exit 大 (= cone 脱出は遅い、 peer の
 *   time-axis を追走する形になる)
 * - me が peer から「離れる」 (u·Δxy < 0): B 大、 λ_exit 小 (= 空間方向に逃げ切るので速く脱出)
 *
 * 直感とは逆だが、 peer の past null cone は peer.t に向けて狭くなるため、 空間的に近づく
 * ことは脱出に寄与しない。 plan §3.6 の intuition 表記とは逆向きだが、 公式自体は正しい
 * (数値検証は test 参照)。
 *
 * **codebase signature 注意**: `physics/vector.ts` の Minkowski 内積は (+,+,+,-) (= spacelike
 * positive、 `lorentzDot = x²+y²+z²-t²`)。 plan §3.1 は (+,-,-,-) を引き合いに出しているが、
 * `λ_surface = B - √(B²-C)` 公式は signature 不変な代数恒等式 `γ² - |u|² = 1` のみに依存し、
 * いずれの signature でも同じ。 本実装は coord time / spatial coord を直接扱うので signature
 * 影響なし。
 */
export const causalityJumpLambdaSingle = (
  meT: number,
  meX: number,
  meY: number,
  meU: Vector3,
  peerT: number,
  peerX: number,
  peerY: number,
): number => {
  const dt = peerT - meT;
  if (dt <= 0) return 0; // peer は me の過去 (or 同時刻) → Rule B 対象外 (= Rule A 領域)
  const dx = peerX - meX;
  const dy = peerY - meY;
  const C = dt * dt - dx * dx - dy * dy;
  if (C <= 0) return 0; // spacelike or null already → 何もしない (極小負値の数値誤差もここで吸収)
  const g = gamma(meU);
  const B = g * dt - meU.x * dx - meU.y * dy;
  const disc = B * B - C;
  if (disc < 0) return 0; // 数値ガード: 理論上 timelike past で disc ≥ 0 (逆 Cauchy-Schwarz)
  const lambdaSurface = B - Math.sqrt(disc);
  // jump 発火時のみ exit margin を加算 (= surface ぴったりの boundary chatter 回避)。
  // λ_surface ≤ 0 のケース (= 既に surface 上 / 数値誤差で過剰計算) は不発で 0 return。
  return lambdaSurface > 0 ? lambdaSurface + CAUSALITY_JUMP_EXIT_MARGIN_LS : 0;
};

/**
 * 全 peer に対する λ_exit の **最大値**。 me が複数 peer の過去光円錐内に同時にいるとき、
 * 全 peer の cone から脱出するために必要な forward distance (= 各 peer の単独脱出に必要な
 * λ のうち最大)。
 *
 * 適用後の me_new (= me + λ·u^μ) は、 max を与えた peer の過去 null cone 表面より
 * `CAUSALITY_JUMP_EXIT_MARGIN_LS` だけ spacelike 側に着地し、 他の peer の cone は既に
 * 外側にある (= max の定義より)。 全 peer に共通 ε が加算されるため argmax (= jump driver
 * の peer) は不変、 max を与える peer の挙動だけが boundary chatter を生まない設計。
 *
 * peers が空 / 全 peer が spacelike or future なら 0 を返す (= 何もしない、 ε 加算なし)。
 *
 * 詳細: `causalityJumpLambdaSingle` docstring §Exit margin。
 */
export const causalityJumpLambda = (
  me: Vector4,
  meU: Vector3,
  peers: ReadonlyArray<{ pos: Vector4 }>,
): number => {
  let maxLambda = 0;
  for (const p of peers) {
    const l = causalityJumpLambdaSingle(
      me.t,
      me.x,
      me.y,
      meU,
      p.pos.t,
      p.pos.x,
      p.pos.y,
    );
    if (l > maxLambda) maxLambda = l;
  }
  return maxLambda;
};
