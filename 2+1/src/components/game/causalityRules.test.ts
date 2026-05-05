import { describe, expect, it } from "vitest";
import { createVector3, createVector4 } from "../../physics";
import {
  causalityJumpLambda,
  causalityJumpLambdaSingle,
} from "./causalityRules";
import { CAUSALITY_JUMP_EXIT_MARGIN_LS } from "./constants";

const ZERO_U = createVector3(0, 0, 0);
// jump 発火時 (= λ_surface > 0) のみ exit margin を加算する。 λ=0 case (= peer 過去 / 同時刻
// / spacelike / future) は不変。 詳細: `causalityRules.ts:causalityJumpLambdaSingle` docstring
// + `constants.ts:CAUSALITY_JUMP_EXIT_MARGIN_LS`。
const EPS = CAUSALITY_JUMP_EXIT_MARGIN_LS;

describe("causalityJumpLambdaSingle", () => {
  it("peer が me の過去 (dt < 0): Rule A 領域 → 0", () => {
    const lambda = causalityJumpLambdaSingle(10, 0, 0, ZERO_U, 5, 0, 0);
    expect(lambda).toBe(0);
  });

  it("peer と me が同時刻 (dt = 0): 0", () => {
    const lambda = causalityJumpLambdaSingle(10, 0, 0, ZERO_U, 10, 5, 0);
    expect(lambda).toBe(0);
  });

  it("spacelike (Δt² < |Δxy|², C ≤ 0): 0", () => {
    // Δt = 1, |Δxy| = 5 → C = 1 - 25 = -24 < 0
    const lambda = causalityJumpLambdaSingle(0, 0, 0, ZERO_U, 1, 5, 0);
    expect(lambda).toBe(0);
  });

  it("数値誤差ガード: C 極小負値 (≈ -1e-12) → 0", () => {
    // Δt = 5, |Δxy| ≈ 5 + 1e-13 → C ≈ -1e-12
    const lambda = causalityJumpLambdaSingle(
      0,
      0,
      0,
      ZERO_U,
      5,
      5 + 1e-13,
      0,
    );
    expect(lambda).toBe(0);
  });

  it("静止 me (u=0)、 peer が同 xy で純時間方向 future: λ_surface = peer.t - me.t、 + EPS で着地", () => {
    // C = Δt² = 100、 B = Δt = 10、 disc = 0、 λ_surface = 10
    const lambda = causalityJumpLambdaSingle(0, 0, 0, ZERO_U, 10, 0, 0);
    expect(lambda).toBeCloseTo(10 + EPS, 9);
  });

  it("静止 me (u=0)、 peer が空間 offset 付き future: λ_surface = Δt - |Δxy|、 + EPS で着地", () => {
    // Δt = 10, Δxy = (4, 3), |Δxy| = 5 → C = 100 - 25 = 75, B = 10, disc = 25, λ_surface = 5
    const lambda = causalityJumpLambdaSingle(0, 0, 0, ZERO_U, 10, 4, 3);
    expect(lambda).toBeCloseTo(5 + EPS, 9);
  });

  it("動き me が peer の方向に向かう (u·Δxy > 0): B 小、 λ_exit 大 (= cone 脱出は遅い)", () => {
    // me=(0,0,0), u=(0.5, 0, 0), peer=(10, 5, 0)
    // γ = √1.25 ≈ 1.11803, B = γ·10 - 0.5·5 = 11.18 - 2.5 = 8.68
    // C = 100 - 25 = 75, disc = 75.34 - 75 = 0.34
    // λ_surface = 8.68 - √0.34 ≈ 8.68 - 0.583 ≈ 8.10、 着地は λ_surface + EPS
    const u = createVector3(0.5, 0, 0);
    const lambda = causalityJumpLambdaSingle(0, 0, 0, u, 10, 5, 0);
    expect(lambda).toBeGreaterThan(8); // 静止 me の値 (= 5) より大
    expect(lambda).toBeLessThan(9);
    // exact check via formula (= λ_surface + EPS)
    const gExpected = Math.sqrt(1 + 0.25);
    const Bexp = gExpected * 10 - 0.5 * 5;
    const Cexp = 100 - 25;
    const expected = Bexp - Math.sqrt(Bexp * Bexp - Cexp) + EPS;
    expect(lambda).toBeCloseTo(expected, 9);
  });

  it("動き me が peer から離れる (u·Δxy < 0): B 大、 λ_exit 小 (= cone 脱出は速い)", () => {
    // me=(0,0,0), u=(-0.5, 0, 0), peer=(10, 5, 0)
    // γ = √1.25, B = γ·10 - (-0.5)·5 = 11.18 + 2.5 = 13.68
    // C = 75, disc = 187.14 - 75 = 112.14, λ_surface = 13.68 - √112.14 ≈ 3.09
    const u = createVector3(-0.5, 0, 0);
    const lambda = causalityJumpLambdaSingle(0, 0, 0, u, 10, 5, 0);
    expect(lambda).toBeGreaterThan(2);
    expect(lambda).toBeLessThan(4);
    const gExpected = Math.sqrt(1 + 0.25);
    const Bexp = gExpected * 10 - -0.5 * 5;
    const Cexp = 100 - 25;
    const expected = Bexp - Math.sqrt(Bexp * Bexp - Cexp) + EPS;
    expect(lambda).toBeCloseTo(expected, 9);
  });

  it("適用後の me_new は peer の past null cone surface + EXIT_MARGIN 分 spacelike 側 (= boundary chatter 防止)", () => {
    // 旧仕様: surface ぴったり (Δt² - |Δxy|² = 0) に着地。 5/5 後: λ_surface + EPS で
    // spacelike 側に余裕、 (Δt² - |Δxy|²) は EPS 線形オーダで負 (= |Δxy|² > Δt²) になる。
    // 詳細: DESIGN.md §因果律対称化 + 5/5 exit margin 拡張。
    const u = createVector3(0.6, 0.3, 0);
    const meT = 0,
      meX = 0,
      meY = 0;
    const peerT = 8,
      peerX = 4,
      peerY = -2;
    const lambda = causalityJumpLambdaSingle(
      meT,
      meX,
      meY,
      u,
      peerT,
      peerX,
      peerY,
    );
    expect(lambda).toBeGreaterThan(0);
    const g = Math.sqrt(1 + 0.36 + 0.09);
    const newT = meT + lambda * g;
    const newX = meX + lambda * u.x;
    const newY = meY + lambda * u.y;
    const dt2 = (peerT - newT) ** 2;
    const dxy2 = (peerX - newX) ** 2 + (peerY - newY) ** 2;
    // me は cone surface よりわずかに spacelike 側 = (Δt² - |Δxy|²) < 0
    expect(dt2 - dxy2).toBeLessThan(0);
    // 厳密展開: λ = λ_surface + EPS で me_new を eval すると、
    //   l(λ) = (peer.t - λγ)² - |peer.xy - λ·u_xy|²
    // を λ で微分すると dl/dλ = -2·(γ·(peer.t - λγ) - u·(peer.xy - λ·u_xy)) = -2·B'(λ)。
    // λ_surface で l = 0、 B'(λ_surface) = B - λ_surface = √disc (= 既存 docstring §B 参照)。
    // 2 階微分は dl²/dλ² = 2·(γ² - |u|²) = 2 (= u^μ unit timelike の代数恒等式)。
    // → l(λ_surface + EPS) = 0 - 2·B'·EPS + EPS²。 EPS = 1e-3 なので 2 nd 項は negligible
    // (= 1e-6) だが test では exact 値で assert。
    const lambdaSurface = lambda - EPS;
    const Bprime =
      g * (peerT - lambdaSurface * g) -
      u.x * (peerX - lambdaSurface * u.x) -
      u.y * (peerY - lambdaSurface * u.y);
    const expected = -2 * Bprime * EPS + EPS ** 2;
    expect(dt2 - dxy2).toBeCloseTo(expected, 9);
  });
});

describe("causalityJumpLambda (= max over peers)", () => {
  it("solo (peers 空): 0", () => {
    const me = createVector4(0, 0, 0, 0);
    expect(causalityJumpLambda(me, ZERO_U, [])).toBe(0);
  });

  it("全 peer が spacelike: 0", () => {
    const me = createVector4(0, 0, 0, 0);
    const peers = [
      { pos: createVector4(1, 5, 0, 0) }, // |Δxy|=5 > Δt=1 → spacelike
      { pos: createVector4(2, 0, 10, 0) },
    ];
    expect(causalityJumpLambda(me, ZERO_U, peers)).toBe(0);
  });

  it("単一 peer: causalityJumpLambdaSingle と同値 (= 共通の EXIT_MARGIN 加算込み)", () => {
    const me = createVector4(0, 0, 0, 0);
    const peers = [{ pos: createVector4(10, 0, 0, 0) }];
    expect(causalityJumpLambda(me, ZERO_U, peers)).toBeCloseTo(10 + EPS, 9);
  });

  it("複数 peer: 各 λ_surface + EPS の max が選ばれる", () => {
    const me = createVector4(0, 0, 0, 0);
    // peer1: λ_surface=8 (静止 me + Δt=8 同 xy)、 peer2: λ_surface=12、 peer3: λ_surface=5
    // 全 peer に共通 EPS が加算されるため、 max 順位は不変 (= peer2 が max)。
    const peers = [
      { pos: createVector4(8, 0, 0, 0) },
      { pos: createVector4(12, 0, 0, 0) },
      { pos: createVector4(5, 0, 0, 0) },
    ];
    expect(causalityJumpLambda(me, ZERO_U, peers)).toBeCloseTo(12 + EPS, 9);
  });

  it("混在 (timelike past + spacelike + dt < 0): timelike past の max のみ反映 (= 不発 peer は 0、 EPS 加算なし)", () => {
    const me = createVector4(0, 0, 0, 0);
    const peers = [
      { pos: createVector4(10, 0, 0, 0) }, // λ_surface=10 → 10 + EPS
      { pos: createVector4(1, 5, 0, 0) }, // spacelike → 0 (= EPS 加算なし、 不発の semantics 維持)
      { pos: createVector4(-5, 0, 0, 0) }, // dt<0 → 0
      { pos: createVector4(7, 0, 0, 0) }, // λ_surface=7 → 7 + EPS
    ];
    expect(causalityJumpLambda(me, ZERO_U, peers)).toBeCloseTo(10 + EPS, 9);
  });
});
