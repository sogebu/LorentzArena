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

  // --- 自機 ghost 観測者シナリオ (2026-04-22 self-death-marker regression の物理確認)。
  // SceneContent の myPlayer swap で observer = ghost.pos、xD = 凍結死亡時空点、
  // DeathMarker/DeadShipRenderer は tau_0 の窓 [0, DEATH_TAU_EFFECT_MAX=2] / [0, DEATH_TAU_MAX=3]
  // で on/off を制御する想定。以下はその窓で発火するはずの典型点を pure 関数 side で保証する。
  describe("自機 ghost シナリオ (static correctness)", () => {
    it("死亡直後 (ghost ≈ xD、同地点 dt=0.01): tau_0 ≈ 0、marker [0,2] / ship [0,3] 窓内", () => {
      const xD = createVector4(100, 5, -3, 0);
      const ghost = createVector4(100.01, 5, -3, 0);
      const tau = pastLightConeIntersectionDeathWorldLine(xD, uStill, ghost);
      expect(tau).not.toBeNull();
      expect(tau!).toBeCloseTo(0.01, 8);
      expect(tau!).toBeGreaterThanOrEqual(0);
      expect(tau!).toBeLessThanOrEqual(2); // DEATH_TAU_EFFECT_MAX
    });

    it("死亡後 ghost が同地点で coord time 1.5s 経過 (静止死): tau_0 = 1.5、marker on, ship on", () => {
      const xD = createVector4(100, 0, 0, 0);
      const ghost = createVector4(101.5, 0, 0, 0);
      const tau = pastLightConeIntersectionDeathWorldLine(xD, uStill, ghost);
      expect(tau!).toBeCloseTo(1.5, 10);
      expect(tau!).toBeLessThanOrEqual(2); // marker 窓内
    });

    it("死亡後 ghost が同地点で 2.5s 経過: tau_0 = 2.5、marker off, ship on", () => {
      const xD = createVector4(100, 0, 0, 0);
      const ghost = createVector4(102.5, 0, 0, 0);
      const tau = pastLightConeIntersectionDeathWorldLine(xD, uStill, ghost);
      expect(tau!).toBeCloseTo(2.5, 10);
      expect(tau!).toBeGreaterThan(2); // marker 窓外
      expect(tau!).toBeLessThanOrEqual(3); // ship 窓内
    });

    it("死亡後 ghost が同地点で 3.5s 経過: tau_0 = 3.5、marker + ship 両方 off", () => {
      const xD = createVector4(100, 0, 0, 0);
      const ghost = createVector4(103.5, 0, 0, 0);
      const tau = pastLightConeIntersectionDeathWorldLine(xD, uStill, ghost);
      expect(tau!).toBeCloseTo(3.5, 10);
      expect(tau!).toBeGreaterThan(3); // ship 窓外
    });

    it("静止死亡 + ghost が x 方向に ρ=1.0 離れる位置で Δt=1.2: tau_0 = 0.2 (光遅延 1.0 分差し引き)", () => {
      // ghost 自身が加速した結果 dx=1.0, dt=1.2 で静止しているシーン。
      // past-cone: obs.t - W.t = |W.xy - obs.xy|、W = xD = (100,0,0,0), 観測者 = (101.2, 1.0, 0, 0)
      // u_D = (1,0,0,0) なので tau = Δt - ρ = 1.2 - 1.0 = 0.2
      const xD = createVector4(100, 0, 0, 0);
      const ghost = createVector4(101.2, 1.0, 0, 0);
      const tau = pastLightConeIntersectionDeathWorldLine(xD, uStill, ghost);
      expect(tau!).toBeCloseTo(0.2, 10);
      expect(tau!).toBeGreaterThanOrEqual(0);
      expect(tau!).toBeLessThanOrEqual(2);
    });

    it("discriminant guard: ghost と xD が完全同一 (dt=0, ρ=0) でも null にならず tau_0=0", () => {
      // 理論上は disc = B^2 - C = 0 - 0 = 0、B=0、→ tau = 0。早期 return しない。
      const xD = createVector4(100, 5, -3, 0);
      const ghost = createVector4(100, 5, -3, 0);
      const tau = pastLightConeIntersectionDeathWorldLine(xD, uStill, ghost);
      expect(tau).not.toBeNull();
      expect(tau!).toBe(0);
    });
  });
});
