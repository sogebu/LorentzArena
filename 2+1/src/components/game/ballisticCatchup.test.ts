import { describe, expect, it } from "vitest";
import {
  createPhaseSpace,
  createVector3,
  createVector4,
  vector4Zero,
} from "../../physics";
import { ENERGY_MAX } from "./constants";
import { ballisticCatchupPhaseSpace } from "./gameLoop";

describe("ballisticCatchupPhaseSpace — thrust + friction + energy 込み 通常 tick 再生", () => {
  it("alpha=0 (= thrust なし) + u=0: 不動、 energy は recovery で満タン維持", () => {
    const ps = createPhaseSpace(
      createVector4(100, 3, 4, 0),
      createVector3(0, 0, 0),
      undefined,
      vector4Zero(), // alpha=0 → thrust なし
    );
    const { newPs, newEnergy } = ballisticCatchupPhaseSpace(
      ps,
      2.57,
      ENERGY_MAX,
    );
    expect(newPs.pos.t).toBeCloseTo(102.57, 6);
    expect(newPs.pos.x).toBeCloseTo(3, 6);
    expect(newPs.pos.y).toBeCloseTo(4, 6);
    expect(newPs.u.x).toBeCloseTo(0, 10);
    expect(newPs.u.y).toBeCloseTo(0, 10);
    expect(newEnergy).toBe(ENERGY_MAX); // 既に MAX、 recovery clamp
  });

  it("alpha=0 + u≠0: thrust なし → friction で減速 → 通常 tick 互換", () => {
    // 初期 u = (0.5, 0, 0)、 alpha=0、 friction で指数減衰 (= 通常 tick の friction-only
    // 漂流停止 UX と同じ)。 u → 0 に向かう、 energy は thrust なしで recovery。
    const ps = createPhaseSpace(
      createVector4(0, 0, 0, 0),
      createVector3(0.5, 0, 0),
      undefined,
      vector4Zero(),
    );
    const { newPs, newEnergy } = ballisticCatchupPhaseSpace(ps, 30, ENERGY_MAX);
    // 30 秒 friction (FRICTION_COEFFICIENT = 0.5、 時間定数 2s) で u → 0 に近く
    expect(Math.abs(newPs.u.x)).toBeLessThan(1e-3);
    expect(Math.abs(newPs.u.y)).toBeLessThan(1e-6);
    // energy は recovery で満タン
    expect(newEnergy).toBe(ENERGY_MAX);
  });

  it("regression: thrust 継続中の player は energy 切れまで加速、 切れたら friction のみ", () => {
    // alpha = 機体 +x 方向に最大 thrust (= world frame thrust accel ≈ rest 系で同じ、 u=0 開始時)。
    // PLAYER_ACCELERATION = 0.8、 hidden 中 thrust 継続 → energy 消費 (THRUST_ENERGY_RATE = 1/90、
    // 2026-05-02 に 1/9 から 1/10 に減らした)。 ENERGY_MAX (default 1) なら 90 秒で枯渇 → 以降
    // friction のみ。 dτ=100 で「90 秒 thrust + 10 秒 friction 単独」 を再生する。
    const ps = createPhaseSpace(
      createVector4(0, 0, 0, 0),
      createVector3(0, 0, 0),
      undefined,
      createVector4(0, 0.8, 0, 0), // alpha world ≈ rest at u=0
    );
    const { newPs, newEnergy } = ballisticCatchupPhaseSpace(ps, 100, 1);
    expect(newEnergy).toBe(0); // 完全枯渇
    // 100 秒経過: 90 秒加速 (途中で terminal velocity 達する: thrust = friction →
    // 0.8 = 0.5 * |u| → |u|=1.6 で釣り合う、 ただし step 0.1s + 線形近似で 1.6 は飽和近似)、
    // その後 10 秒 friction 単独で減速。 final u は friction 減衰で大きく下がってる。
    expect(newPs.u.x).toBeGreaterThan(0); // 何らかの forward velocity 残る
    expect(newPs.u.x).toBeLessThan(1.6); // terminal 以下
  });

  it("zero dTau: phaseSpace + energy 不変", () => {
    const ps = createPhaseSpace(
      createVector4(5, 1, 2, 0),
      createVector3(0.3, -0.2, 0),
      undefined,
      vector4Zero(),
    );
    const { newPs, newEnergy } = ballisticCatchupPhaseSpace(ps, 0, 0.5);
    expect(newPs.pos.t).toBe(5);
    expect(newPs.pos.x).toBe(1);
    expect(newPs.pos.y).toBe(2);
    expect(newPs.u.x).toBeCloseTo(0.3, 10);
    expect(newPs.u.y).toBeCloseTo(-0.2, 10);
    expect(newEnergy).toBe(0.5);
  });
});
