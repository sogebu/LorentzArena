import { describe, expect, it } from "vitest";
import { createVector3, createVector4 } from "../../physics";
import {
  causalityJumpLambda,
  causalityJumpLambdaSingle,
} from "./causalityRules";

const ZERO_U = createVector3(0, 0, 0);

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

  it("静止 me (u=0)、 peer が同 xy で純時間方向 future: λ = peer.t - me.t", () => {
    // C = Δt² = 100、 B = Δt = 10、 disc = 0、 λ = 10
    const lambda = causalityJumpLambdaSingle(0, 0, 0, ZERO_U, 10, 0, 0);
    expect(lambda).toBeCloseTo(10, 9);
  });

  it("静止 me (u=0)、 peer が空間 offset 付き future: λ = Δt - |Δxy|", () => {
    // Δt = 10, Δxy = (4, 3), |Δxy| = 5 → C = 100 - 25 = 75, B = 10, disc = 25, λ = 5
    const lambda = causalityJumpLambdaSingle(0, 0, 0, ZERO_U, 10, 4, 3);
    expect(lambda).toBeCloseTo(5, 9);
  });

  it("動き me が peer の方向に向かう (u·Δxy > 0): B 小、 λ_exit 大 (= cone 脱出は遅い)", () => {
    // me=(0,0,0), u=(0.5, 0, 0), peer=(10, 5, 0)
    // γ = √1.25 ≈ 1.11803, B = γ·10 - 0.5·5 = 11.18 - 2.5 = 8.68
    // C = 100 - 25 = 75, disc = 75.34 - 75 = 0.34
    // λ = 8.68 - √0.34 ≈ 8.68 - 0.583 ≈ 8.10
    const u = createVector3(0.5, 0, 0);
    const lambda = causalityJumpLambdaSingle(0, 0, 0, u, 10, 5, 0);
    expect(lambda).toBeGreaterThan(8); // 静止 me の値 (= 5) より大
    expect(lambda).toBeLessThan(9);
    // exact check via formula
    const gExpected = Math.sqrt(1 + 0.25);
    const Bexp = gExpected * 10 - 0.5 * 5;
    const Cexp = 100 - 25;
    const expected = Bexp - Math.sqrt(Bexp * Bexp - Cexp);
    expect(lambda).toBeCloseTo(expected, 9);
  });

  it("動き me が peer から離れる (u·Δxy < 0): B 大、 λ_exit 小 (= cone 脱出は速い)", () => {
    // me=(0,0,0), u=(-0.5, 0, 0), peer=(10, 5, 0)
    // γ = √1.25, B = γ·10 - (-0.5)·5 = 11.18 + 2.5 = 13.68
    // C = 75, disc = 187.14 - 75 = 112.14, λ = 13.68 - √112.14 ≈ 3.09
    const u = createVector3(-0.5, 0, 0);
    const lambda = causalityJumpLambdaSingle(0, 0, 0, u, 10, 5, 0);
    expect(lambda).toBeGreaterThan(2);
    expect(lambda).toBeLessThan(4);
    const gExpected = Math.sqrt(1 + 0.25);
    const Bexp = gExpected * 10 - -0.5 * 5;
    const Cexp = 100 - 25;
    const expected = Bexp - Math.sqrt(Bexp * Bexp - Cexp);
    expect(lambda).toBeCloseTo(expected, 9);
  });

  it("適用後の me_new はちょうど peer の null cone 上 (Δt² - |Δxy|² → 0)", () => {
    // 任意の test case で me + λ·u^μ が cone surface に乗るか確認
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
    expect(dt2 - dxy2).toBeCloseTo(0, 8);
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

  it("単一 peer: causalityJumpLambdaSingle と同値", () => {
    const me = createVector4(0, 0, 0, 0);
    const peers = [{ pos: createVector4(10, 0, 0, 0) }];
    expect(causalityJumpLambda(me, ZERO_U, peers)).toBeCloseTo(10, 9);
  });

  it("複数 peer: 各 λ_exit の max が選ばれる", () => {
    const me = createVector4(0, 0, 0, 0);
    // peer1: λ=8 (静止 me + Δt=8 同 xy)、 peer2: λ=12、 peer3: λ=5
    const peers = [
      { pos: createVector4(8, 0, 0, 0) },
      { pos: createVector4(12, 0, 0, 0) },
      { pos: createVector4(5, 0, 0, 0) },
    ];
    expect(causalityJumpLambda(me, ZERO_U, peers)).toBeCloseTo(12, 9);
  });

  it("混在 (timelike past + spacelike + dt < 0): timelike past の max のみ反映", () => {
    const me = createVector4(0, 0, 0, 0);
    const peers = [
      { pos: createVector4(10, 0, 0, 0) }, // λ=10
      { pos: createVector4(1, 5, 0, 0) }, // spacelike → 0
      { pos: createVector4(-5, 0, 0, 0) }, // dt<0 → 0
      { pos: createVector4(7, 0, 0, 0) }, // λ=7
    ];
    expect(causalityJumpLambda(me, ZERO_U, peers)).toBeCloseTo(10, 9);
  });
});
