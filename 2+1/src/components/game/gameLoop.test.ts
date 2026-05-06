import { describe, expect, it } from "vitest";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
} from "../../physics";
import {
  ENERGY_MAX,
  FRICTION_COEFFICIENT,
  MAX_WORLDLINE_HISTORY,
} from "./constants";
import { processPlayerPhysics } from "./gameLoop";
import type { RelativisticPlayer } from "./types";

// Bug 14 完全治療 implicit Euler refactor (2026-05-06 post-deploy):
// processPlayerPhysics が `evolvePhaseSpace` の `frictionCoefficient` 引数経由で
// **semi-implicit Euler** で friction を解くことで、 任意 dTau で unconditionally stable
// (= 旧 substep workaround を撤廃)。
//
// 旧 explicit Euler (= 5/2 deploy 時点) は `dτ > 2/k = 4 sec` で `newU = u(1-kΔ)` が
// 発散、 mobile 12.5h suspend 復帰時の self.pos.t = 20.37M sec runaway を生んだ root
// cause (= live capture: repro/2026-05-06-bug14-state/)。 5/6 plan 初版では substep で
// workaround、 後続 user push back を契機に **「explicit を温存して dτ を分割する数値
// workaround」 ではなく「friction 数値不安定性自体を消す」 implicit Euler が L5 root
// fix と判明** ([`claude-config/conventions/debugging-discipline.md §1`](../../../claude-config/conventions/debugging-discipline.md))、
// substep 撤廃 + implicit Euler refactor。
//
// implicit Euler の数値特性: `newU = (u + a × dτ) / (1 + γkΔ)` で
// - 任意 dτ で `|newU| ≤ |u + a × dτ|` (= 分母 ≥ 1 で有界)
// - 大 dτ で `newU → 0` (= friction で完全減衰、 但し substep のような denormalized 値ではなく
//   `u/(1+γkΔ)` の有限値、 例: dτ=45000, k=0.5, γ=1, u=1.6 で newU = 1.6/22501 ≈ 7.1e-5)
// - sign 不変 (= 分子 / 分母とも sign 保持、 1 step で sign flip しない、 旧 explicit Euler の
//   `Δ > 2/k` 領域での sign flip 発散の対極)

function makePlayer(
  id: string,
  u: { x: number; y: number; z: number },
): RelativisticPlayer {
  const phaseSpace = createPhaseSpace(
    createVector4(0, 0, 0, 0),
    createVector3(u.x, u.y, u.z),
  );
  return {
    id,
    kind: "human",
    ownerId: id,
    phaseSpace,
    worldLine: appendWorldLine(
      createWorldLine(MAX_WORLDLINE_HISTORY),
      phaseSpace,
    ),
    color: "#fff",
    energy: ENERGY_MAX,
  };
}

describe("processPlayerPhysics implicit Euler stability (Bug 14 plan §2.1, post-deploy refactor)", () => {
  it("通常 dTau (= 0.008 sec、 N=1): 安定、 通常挙動", () => {
    const me = makePlayer("me", { x: 0.5, y: 0, z: 0 });
    const result = processPlayerPhysics(
      me,
      new Set(),
      { thrust: 0 },
      0,
      0.008,
      [],
      ENERGY_MAX,
    );
    // 1 substep で friction が微小減衰させる (= u_new < u₀、 sign 不変、 γ-amplified)
    // 解析: u_new = u₀ × (1 - γ × k × dτ) where γ=√(1+0.25)=1.118
    // = 0.5 × (1 - 1.118 × 0.5 × 0.008) ≈ 0.4978
    expect(result.newPhaseSpace.u.x).toBeLessThan(0.5);
    expect(result.newPhaseSpace.u.x).toBeGreaterThan(0.497);
    expect(result.newPhaseSpace.u.x).toBeGreaterThan(0); // sign 不変
    // pos.t は γ × dTau のオーダー
    expect(result.newPhaseSpace.pos.t).toBeGreaterThan(0);
    expect(result.newPhaseSpace.pos.t).toBeLessThan(0.01);
  });

  it("中 dTau (= 1 sec、 N=10): 安定、 friction で減衰", () => {
    const me = makePlayer("me", { x: 1.0, y: 0, z: 0 });
    const result = processPlayerPhysics(
      me,
      new Set(),
      { thrust: 0 },
      0,
      1.0,
      [],
      ENERGY_MAX,
    );
    // 解析解 (= γ 効果込み) は単純 1D friction より速く減衰: rest frame friction
    // を inverseLorentzBoost で world frame に持ち上げる際 γ 倍されるため、
    // effective k = γ × FRICTION_COEFFICIENT。 u₀=1 で γ₀=√2、 effective k≈0.71、
    // 1 sec で u(1) ≈ 0.49 オーダー。 厳密値は γ も時変なので analytic 式は無いが、
    // **stability test として「発散していない + 単調減衰」 が要件**。
    expect(result.newPhaseSpace.u.x).toBeGreaterThan(0); // sign 不変
    expect(result.newPhaseSpace.u.x).toBeLessThan(1.0); // 減衰
    expect(Number.isFinite(result.newPhaseSpace.u.x)).toBe(true); // 有限
  });

  it("巨大 dTau (= 45000 sec ≈ 12.5h): 旧 explicit Euler で発散する範囲、 implicit Euler で 1 step 安定", () => {
    // Bug 14 の Pixel 7a 12.5h suspend と同等条件
    const me = makePlayer("me", { x: 1.6, y: 0, z: 0 }); // terminal velocity
    const result = processPlayerPhysics(
      me,
      new Set(),
      { thrust: 0 },
      0,
      45000,
      [],
      ENERGY_MAX,
    );

    // 1) implicit Euler: newU = u / (1 + γkΔ) = 1.6 / (1 + 1.886 × 0.5 × 45000) ≈ 1.6/42436 ≈ 3.77e-5
    //    (= γ_initial 1.886 from |u|=1.6、 substep のような denormalized ではなく有限値、 完全減衰)
    //    旧 explicit Euler の `1.6 × -22499 = -35998` 発散と全く違う
    expect(result.newPhaseSpace.u.x).toBeGreaterThan(0); // sign 不変
    expect(result.newPhaseSpace.u.x).toBeLessThan(1e-3); // 完全減衰オーダー

    // 2) pos.t は γ(newU) × dτ で進む。 newU ≈ 0 で newGamma ≈ 1、 pos.t ≈ dτ。
    //    旧 explicit Euler 1.6 × 10^9 オーダーの runaway とは比較にならない
    expect(result.newPhaseSpace.pos.t).toBeGreaterThan(45000); // γ ≥ 1
    expect(result.newPhaseSpace.pos.t).toBeLessThan(45010); // 解析的有界
  });

  it("超巨大 dTau (= 86400 sec = 24h): 同様に安定", () => {
    const me = makePlayer("me", { x: 1.6, y: 1.0, z: 0 });
    const result = processPlayerPhysics(
      me,
      new Set(),
      { thrust: 0 },
      0,
      86400,
      [],
      ENERGY_MAX,
    );
    expect(Number.isFinite(result.newPhaseSpace.pos.t)).toBe(true);
    expect(Number.isFinite(result.newPhaseSpace.u.x)).toBe(true);
    // implicit Euler: newU = u / (1 + γkΔ)、 dτ=86400 で分母 ~ 86400 倍以上、 newU ~ 1e-5 オーダー
    expect(Math.abs(result.newPhaseSpace.u.x)).toBeLessThan(1e-3);
    expect(result.newPhaseSpace.pos.t).toBeLessThan(86420);
  });

  it("単調減衰: 連続呼び出しで u が単調減少 (発散しない、 振動しない)", () => {
    // substep が安定なら、 thrust 無しで連続 step 呼ぶと u は単調減衰
    let me = makePlayer("me", { x: 1.5, y: 0, z: 0 });
    let prevAbsU = Math.abs(me.phaseSpace.u.x);
    for (let i = 0; i < 20; i++) {
      const result = processPlayerPhysics(
        me,
        new Set(),
        { thrust: 0 },
        0,
        0.5, // N = 5 substep each call
        [],
        ENERGY_MAX,
      );
      const newAbsU = Math.abs(result.newPhaseSpace.u.x);
      // 単調 |u| 減少 (= 安定 + friction 効果)
      expect(newAbsU).toBeLessThanOrEqual(prevAbsU);
      // sign 不変 (= 旧仕様 dτ > 4 sec 領域での sign flip 発散の負例として check)
      expect(result.newPhaseSpace.u.x).toBeGreaterThanOrEqual(0);
      prevAbsU = newAbsU;
      me = { ...me, phaseSpace: result.newPhaseSpace, worldLine: result.updatedWorldLine };
    }
  });

  it("FRICTION_COEFFICIENT が想定通り (= 0.5)、 implicit Euler 計算の前提", () => {
    // この test は implicit Euler の前提条件 docstring の意味を fix する。 friction 値
    // が変更されたら test の expected value (= u/(1+γkΔ) で導出) も再計算が必要なため
    // 警告として機能。 `newU = (u + a × dτ) / (1 + γkΔ)` の k がここで定義される。
    expect(FRICTION_COEFFICIENT).toBe(0.5);
  });
});
