import { describe, expect, it } from "vitest";
import {
  createPhaseSpace,
  createVector3,
  createVector4,
} from "../../physics";
import { FRICTION_COEFFICIENT } from "./constants";
import { ballisticCatchupPhaseSpace } from "./gameLoop";

describe("ballisticCatchupPhaseSpace", () => {
  it("stationary player: pos.t advances by dTau, pos.xy and u unchanged", () => {
    const ps = createPhaseSpace(
      createVector4(100, 3, 4, 0),
      createVector3(0, 0, 0),
    );
    const result = ballisticCatchupPhaseSpace(ps, 2.57);
    expect(result.pos.t).toBeCloseTo(102.57, 6);
    expect(result.pos.x).toBeCloseTo(3, 6);
    expect(result.pos.y).toBeCloseTo(4, 6);
    expect(result.u.x).toBeCloseTo(0, 10);
    expect(result.u.y).toBeCloseTo(0, 10);
  });

  it("moving player: u decays exponentially toward 0 via friction", () => {
    // 初期 u = (0.5, 0, 0)、十分長い catchup で u が 0 に収束することを確認。
    // 時間定数 1/FRICTION_COEFFICIENT = 2s、dTau = 30s で e^-15 ≈ 3e-7、実質 0。
    const ps = createPhaseSpace(
      createVector4(0, 0, 0, 0),
      createVector3(0.5, 0, 0),
    );
    const result = ballisticCatchupPhaseSpace(ps, 30);
    expect(Math.abs(result.u.x)).toBeLessThan(1e-3);
    expect(Math.abs(result.u.y)).toBeLessThan(1e-6);
    // pos.x は有限の漸近値に到達 (数値積分なので exact には解析解と一致しないが有限)。
    expect(Number.isFinite(result.pos.x)).toBe(true);
  });

  it("zero dTau: phaseSpace unchanged", () => {
    const ps = createPhaseSpace(
      createVector4(5, 1, 2, 0),
      createVector3(0.3, -0.2, 0),
    );
    const result = ballisticCatchupPhaseSpace(ps, 0);
    expect(result.pos.t).toBe(5);
    expect(result.pos.x).toBe(1);
    expect(result.pos.y).toBe(2);
    expect(result.u.x).toBeCloseTo(0.3, 10);
    expect(result.u.y).toBeCloseTo(-0.2, 10);
  });

  it("short dTau: friction linear approximation holds", () => {
    // dTau = 0.1s で u.x が FRICTION_COEFFICIENT * dTau * u.x = 0.05 * 0.5 = 0.025 分
    // 減衰する近似値 (sub-step で 1 step 分、ほぼ線形領域)。
    const ps = createPhaseSpace(
      createVector4(0, 0, 0, 0),
      createVector3(0.5, 0, 0),
    );
    const result = ballisticCatchupPhaseSpace(ps, 0.1);
    const expectedU = 0.5 * (1 - FRICTION_COEFFICIENT * 0.1);
    expect(result.u.x).toBeCloseTo(expectedU, 2);
  });

  it("dTau covers exactly N sub-steps: no remainder drift", () => {
    // STEP = 0.1 内部定数、dTau = 1.0 で 10 sub-steps、remainder = 0。
    const ps = createPhaseSpace(
      createVector4(0, 0, 0, 0),
      createVector3(0, 0, 0),
    );
    const result = ballisticCatchupPhaseSpace(ps, 1.0);
    expect(result.pos.t).toBeCloseTo(1.0, 6);
  });
});
