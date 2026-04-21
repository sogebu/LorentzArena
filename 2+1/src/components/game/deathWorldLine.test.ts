import { describe, expect, it } from "vitest";
import { createVector4 } from "../../physics/vector";
import {
  evaluateDeathWorldLine,
  pastLightConeIntersectionDeathWorldLine,
} from "./deathWorldLine";

describe("pastLightConeIntersectionDeathWorldLine", () => {
  // 静止 u_D (γ=1, v=0)。死亡時 4-velocity = (1, 0, 0, 0)。
  const uStill = createVector4(1, 0, 0, 0);

  it("観測者が x_D と同一時刻・同一地点: τ_0 = 0 (光は瞬時)", () => {
    const xD = createVector4(10, 3, 4, 0);
    const obs = createVector4(10, 3, 4, 0);
    const tau = pastLightConeIntersectionDeathWorldLine(xD, uStill, obs);
    expect(tau).not.toBeNull();
    expect(tau!).toBeCloseTo(0, 10);
  });

  it("観測者が ρ=5 光秒離れ、Δt=5: 丁度 x_D に到達 (τ_0 = 0)", () => {
    // x_D = (0, 0, 0, 0), observer at (5, 5, 0, 0). 光速 1 で 5 光秒ぴったり到達。
    const xD = createVector4(0, 0, 0, 0);
    const obs = createVector4(5, 5, 0, 0);
    const tau = pastLightConeIntersectionDeathWorldLine(xD, uStill, obs);
    expect(tau).not.toBeNull();
    expect(tau!).toBeCloseTo(0, 10);
  });

  it("観測者が ρ=5 離れ、Δt=3: τ_0 = -2 (past-cone 未到達)", () => {
    const xD = createVector4(0, 0, 0, 0);
    const obs = createVector4(3, 5, 0, 0);
    const tau = pastLightConeIntersectionDeathWorldLine(xD, uStill, obs);
    expect(tau).not.toBeNull();
    expect(tau!).toBeCloseTo(-2, 10);
  });

  it("観測者が ρ=5 離れ、Δt=8: τ_0 = 3 (past-cone 到達後 3 秒分 extrapolated worldline を sweep)", () => {
    const xD = createVector4(0, 0, 0, 0);
    const obs = createVector4(8, 5, 0, 0);
    const tau = pastLightConeIntersectionDeathWorldLine(xD, uStill, obs);
    expect(tau).not.toBeNull();
    expect(tau!).toBeCloseTo(3, 10);
  });

  it("観測者が死亡点に静止し、時間が進行: τ_0 = Δt (光遅延ゼロ)", () => {
    const xD = createVector4(0, 10, 20, 0);
    const obs = createVector4(7, 10, 20, 0);
    const tau = pastLightConeIntersectionDeathWorldLine(xD, uStill, obs);
    expect(tau).not.toBeNull();
    expect(tau!).toBeCloseTo(7, 10);
  });

  it("死者が +x 方向に v=0.8c で死亡 → extrapolated worldline と past-cone の解析解", () => {
    // u_D = (γ, γv, 0, 0) with v=0.8 → γ = 1/√(1-0.64) = 1/0.6 ≈ 1.6667
    const gamma = 1 / Math.sqrt(1 - 0.64);
    const uD = createVector4(gamma, gamma * 0.8, 0, 0);
    // x_D = (0, 0, 0, 0). observer が (T, 0, 0, 0) の静止。
    // W_D(τ) = (γτ, 0.8γτ, 0, 0) を past-cone T - W.t = |W.xy - 0| で解く:
    //   T - γτ = 0.8γτ  (W.x = 0.8γτ, 観測者 obs.x=0 なので距離 = 0.8γτ)
    //   T = γτ(1 + 0.8) = 1.8 γτ
    //   τ = T / (1.8 γ)
    const T = 5;
    const obs = createVector4(T, 0, 0, 0);
    const xD = createVector4(0, 0, 0, 0);
    const tau = pastLightConeIntersectionDeathWorldLine(xD, uD, obs);
    expect(tau).not.toBeNull();
    expect(tau!).toBeCloseTo(T / (1.8 * gamma), 8);
  });

  it("evaluateDeathWorldLine: W_D(τ) = x_D + u_D·τ", () => {
    const xD = createVector4(10, 1, 2, 0);
    const uD = createVector4(2, 1, 0, 0); // (γ=2, γv_x=1, …)。未正規化でも式は成立。
    const W = evaluateDeathWorldLine(xD, uD, 3);
    expect(W.t).toBe(10 + 2 * 3);
    expect(W.x).toBe(1 + 1 * 3);
    expect(W.y).toBe(2 + 0 * 3);
    expect(W.z).toBe(0);
  });
});
