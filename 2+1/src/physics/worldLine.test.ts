import { describe, expect, it } from "vitest";
import { createPhaseSpace, type PhaseSpace } from "./mechanics";
import { createVector3, createVector4, vector4Zero, yawToQuat } from "./vector";
import {
  appendWorldLine,
  createWorldLine,
  futureLightConeIntersectionWorldLine,
  futureLightConeIntersectionWorldLineLinear,
  pastLightConeIntersectionWorldLine,
  pastLightConeIntersectionWorldLineLinear,
  type WorldLine,
} from "./worldLine";

// 数値誤差許容度 (findLightlikeIntersectionParam の Float64 演算で同一入力 →
// 同一出力なので厳密に一致するはずだが、浮動小数点の order-of-operations を
// 考慮して小さな tolerance を許容)。
const EPS = 1e-9;

function phaseSpacesClose(
  a: PhaseSpace | null,
  b: PhaseSpace | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const fields: Array<[number, number]> = [
    [a.pos.t, b.pos.t],
    [a.pos.x, b.pos.x],
    [a.pos.y, b.pos.y],
    [a.pos.z, b.pos.z],
    [a.u.x, b.u.x],
    [a.u.y, b.u.y],
    [a.u.z, b.u.z],
  ];
  for (const [p, q] of fields) {
    if (Math.abs(p - q) > EPS) return false;
  }
  return true;
}

function diagnostic(a: PhaseSpace | null, b: PhaseSpace | null): string {
  const fmt = (x: PhaseSpace | null) =>
    x === null
      ? "null"
      : `(t=${x.pos.t.toFixed(6)}, x=${x.pos.x.toFixed(6)}, y=${x.pos.y.toFixed(6)})`;
  return `binary=${fmt(a)} linear=${fmt(b)}`;
}

// Reproducible PRNG (LCG)。
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state & 0x7fffffff) / 0x7fffffff;
  };
}

/**
 * Random-walk proper-velocity で worldLine を生成。
 * 4 速度 u の |u| ≤ 2 (γ ≤ √5 ≈ 2.24) に抑えて現実的な速度範囲。
 */
function randomWorldLine(nSamples: number, rng: () => number): WorldLine {
  let wl = createWorldLine(nSamples + 10);
  let x = 0;
  let y = 0;
  let t = 0;
  let ux = 0;
  let uy = 0;
  const dt = 0.008;
  for (let i = 0; i < nSamples; i++) {
    ux += (rng() - 0.5) * 0.2;
    uy += (rng() - 0.5) * 0.2;
    const m = Math.sqrt(ux * ux + uy * uy);
    if (m > 2) {
      ux *= 2 / m;
      uy *= 2 / m;
    }
    const gamma = Math.sqrt(1 + ux * ux + uy * uy);
    t += dt * gamma;
    x += dt * ux;
    y += dt * uy;
    wl = appendWorldLine(
      wl,
      createPhaseSpace(
        createVector4(t, x, y, 0),
        createVector3(ux, uy, 0),
      ),
    );
  }
  return wl;
}

describe("pastLightConeIntersectionWorldLine — binary vs linear regression", () => {
  it("empty history returns null (both)", () => {
    const wl = createWorldLine();
    const obs = createVector4(5, 0, 0, 0);
    const a = pastLightConeIntersectionWorldLine(wl, obs);
    const b = pastLightConeIntersectionWorldLineLinear(wl, obs);
    expect(a).toBeNull();
    expect(b).toBeNull();
  });

  it("short history (N = 1,2,3,5,10)", () => {
    const rng = makeRng(1);
    for (const N of [1, 2, 3, 5, 10]) {
      const wl = randomWorldLine(N, rng);
      const lastT = wl.history[wl.history.length - 1]?.pos.t ?? 0;
      for (let trial = 0; trial < 20; trial++) {
        const obs = createVector4(
          rng() * lastT * 2 - lastT * 0.5,
          (rng() - 0.5) * 10,
          (rng() - 0.5) * 10,
          0,
        );
        const a = pastLightConeIntersectionWorldLine(wl, obs);
        const b = pastLightConeIntersectionWorldLineLinear(wl, obs);
        expect(phaseSpacesClose(a, b), diagnostic(a, b)).toBe(true);
      }
    }
  });

  it("large random history (N = 50..1000, 100 trials)", () => {
    const rng = makeRng(42);
    for (let trial = 0; trial < 100; trial++) {
      const N = 50 + Math.floor(rng() * 950);
      const wl = randomWorldLine(N, rng);
      const finalT = wl.history[wl.history.length - 1].pos.t;
      const obs = createVector4(
        (rng() * 1.5 - 0.25) * finalT, // observer.t を history span 周辺に散らす
        (rng() - 0.5) * 40,
        (rng() - 0.5) * 40,
        0,
      );
      const a = pastLightConeIntersectionWorldLine(wl, obs);
      const b = pastLightConeIntersectionWorldLineLinear(wl, obs);
      expect(phaseSpacesClose(a, b), `trial=${trial} N=${N} ${diagnostic(a, b)}`).toBe(true);
    }
  });

  it("observer at worldLine end (typical SceneContent case)", () => {
    const rng = makeRng(7);
    for (let trial = 0; trial < 50; trial++) {
      const N = 500 + Math.floor(rng() * 500);
      const wl = randomWorldLine(N, rng);
      const last = wl.history[wl.history.length - 1];
      // 観測者は worldLine の最新時刻から少し未来、空間は少し離れる
      const obs = createVector4(
        last.pos.t + rng() * 5,
        last.pos.x + (rng() - 0.5) * 20,
        last.pos.y + (rng() - 0.5) * 20,
        0,
      );
      const a = pastLightConeIntersectionWorldLine(wl, obs);
      const b = pastLightConeIntersectionWorldLineLinear(wl, obs);
      expect(phaseSpacesClose(a, b), `trial=${trial} ${diagnostic(a, b)}`).toBe(true);
    }
  });

  it("observer far in the spatial distance (stress non-monotonic g)", () => {
    const rng = makeRng(13);
    for (let trial = 0; trial < 50; trial++) {
      const N = 300 + Math.floor(rng() * 300);
      const wl = randomWorldLine(N, rng);
      const finalT = wl.history[wl.history.length - 1].pos.t;
      // 空間的に遠い観測者 → 光円錐境界が古い側に寄る (非単調 g のリスク)
      const obs = createVector4(
        finalT + rng() * 3,
        (rng() - 0.5) * 500,
        (rng() - 0.5) * 500,
        0,
      );
      const a = pastLightConeIntersectionWorldLine(wl, obs);
      const b = pastLightConeIntersectionWorldLineLinear(wl, obs);
      expect(phaseSpacesClose(a, b), `trial=${trial} ${diagnostic(a, b)}`).toBe(true);
    }
  });

  it("observer before the worldLine starts (no past cone intersection)", () => {
    const rng = makeRng(99);
    const wl = randomWorldLine(100, rng);
    const obs = createVector4(
      wl.history[0].pos.t - 5,
      0,
      0,
      0,
    );
    const a = pastLightConeIntersectionWorldLine(wl, obs);
    const b = pastLightConeIntersectionWorldLineLinear(wl, obs);
    expect(a).toBeNull();
    expect(b).toBeNull();
  });
});

describe("futureLightConeIntersectionWorldLine — binary vs linear regression", () => {
  it("history length < 2 returns null (both)", () => {
    const wl0 = createWorldLine();
    const wl1 = randomWorldLine(1, makeRng(5));
    const obs = createVector4(0, 0, 0, 0);
    for (const wl of [wl0, wl1]) {
      const a = futureLightConeIntersectionWorldLine(wl, obs);
      const b = futureLightConeIntersectionWorldLineLinear(wl, obs);
      expect(phaseSpacesClose(a, b)).toBe(true);
    }
  });

  it("observer before history (future intersection should match)", () => {
    const rng = makeRng(11);
    for (let trial = 0; trial < 50; trial++) {
      const N = 100 + Math.floor(rng() * 400);
      const wl = randomWorldLine(N, rng);
      // 観測者を history の開始より前に置く → future cone が history 全体に届くかも
      const obs = createVector4(
        wl.history[0].pos.t - rng() * 3,
        (rng() - 0.5) * 10,
        (rng() - 0.5) * 10,
        0,
      );
      const a = futureLightConeIntersectionWorldLine(wl, obs);
      const b = futureLightConeIntersectionWorldLineLinear(wl, obs);
      expect(phaseSpacesClose(a, b), `trial=${trial} ${diagnostic(a, b)}`).toBe(true);
    }
  });

  it("observer in the middle of history (large random)", () => {
    const rng = makeRng(777);
    for (let trial = 0; trial < 100; trial++) {
      const N = 100 + Math.floor(rng() * 900);
      const wl = randomWorldLine(N, rng);
      const finalT = wl.history[wl.history.length - 1].pos.t;
      const obs = createVector4(
        rng() * finalT,
        (rng() - 0.5) * 30,
        (rng() - 0.5) * 30,
        0,
      );
      const a = futureLightConeIntersectionWorldLine(wl, obs);
      const b = futureLightConeIntersectionWorldLineLinear(wl, obs);
      expect(phaseSpacesClose(a, b), `trial=${trial} N=${N} ${diagnostic(a, b)}`).toBe(true);
    }
  });

  it("observer after history end (no future intersection)", () => {
    const rng = makeRng(31);
    const wl = randomWorldLine(100, rng);
    const last = wl.history[wl.history.length - 1];
    const obs = createVector4(last.pos.t + 100, 0, 0, 0);
    const a = futureLightConeIntersectionWorldLine(wl, obs);
    const b = futureLightConeIntersectionWorldLineLinear(wl, obs);
    expect(a).toBeNull();
    expect(b).toBeNull();
  });
});

describe("binary search gives identical result under extreme conditions", () => {
  it("highly curved world line (rapid direction changes)", () => {
    // 急激に方向転換する worldLine で g(i) が非単調になりうるケース
    const rng = makeRng(2024);
    let wl = createWorldLine(10000);
    const dt = 0.008;
    let t = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < 500; i++) {
      // 強い振動する u (高頻度で符号変化)
      const phase = i * 0.3;
      const ux = 1.5 * Math.sin(phase);
      const uy = 1.5 * Math.cos(phase);
      const gamma = Math.sqrt(1 + ux * ux + uy * uy);
      t += dt * gamma;
      x += dt * ux;
      y += dt * uy;
      wl = appendWorldLine(
        wl,
        createPhaseSpace(
          createVector4(t, x, y, 0),
          createVector3(ux, uy, 0),
        ),
      );
    }
    const finalT = wl.history[wl.history.length - 1].pos.t;
    for (let trial = 0; trial < 50; trial++) {
      const obs = createVector4(
        rng() * finalT * 1.2,
        (rng() - 0.5) * 15,
        (rng() - 0.5) * 15,
        0,
      );
      const pa = pastLightConeIntersectionWorldLine(wl, obs);
      const pb = pastLightConeIntersectionWorldLineLinear(wl, obs);
      expect(phaseSpacesClose(pa, pb), `past trial=${trial} ${diagnostic(pa, pb)}`).toBe(true);

      const fa = futureLightConeIntersectionWorldLine(wl, obs);
      const fb = futureLightConeIntersectionWorldLineLinear(wl, obs);
      expect(phaseSpacesClose(fa, fb), `future trial=${trial} ${diagnostic(fa, fb)}`).toBe(true);
    }
  });
});

describe("past/future cone 交点で heading (slerp) / alpha (linear) を補間", () => {
  // 静止 worldline: prev (t=0) heading yaw=0、curr (t=2) heading yaw=π/2、
  // alpha: prev (0, 0, 0, 0)、curr (0, 1, 0, 0)。観測者 (t=2, x=1) で交点
  // 計算 → 2 点区間の tParam 依存で補間される heading / alpha を観測する。
  it("中点で yaw 補間 (slerp) と alpha linear 補間", () => {
    const prev = createPhaseSpace(
      createVector4(0, 0, 0, 0),
      createVector3(0, 0, 0),
      yawToQuat(0),
      vector4Zero(),
    );
    const curr = createPhaseSpace(
      createVector4(2, 0, 0, 0),
      createVector3(0, 0, 0),
      yawToQuat(Math.PI / 2),
      createVector4(0, 1, 0, 0),
    );
    const wl: WorldLine = {
      history: [prev, curr],
      maxHistorySize: 10,
      origin: null,
      version: 0,
    };
    // 静止 worldline で観測者が (t=2, x=1, y=0) → 区間中点 t=1、x=0 で光円錐交点
    // (観測者から見て Δt=1、|Δx|=1 で lightlike separation)
    const obs = createVector4(2, 1, 0, 0);
    const result = pastLightConeIntersectionWorldLine(wl, obs);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.pos.t).toBeCloseTo(1, 9);
    expect(result.pos.x).toBeCloseTo(0, 9);
    // tParam = 0.5 → heading は yaw(π/4)、alpha は (0, 0.5, 0, 0)
    expect(result.heading.w).toBeCloseTo(Math.cos(Math.PI / 8), 6);
    expect(result.heading.z).toBeCloseTo(Math.sin(Math.PI / 8), 6);
    expect(result.alpha.x).toBeCloseTo(0.5, 9);
    expect(result.alpha.t).toBeCloseTo(0, 9);
  });

  it("linear reference も同じ補間を返す (binary と一致)", () => {
    const prev = createPhaseSpace(
      createVector4(0, 0, 0, 0),
      createVector3(0, 0, 0),
      yawToQuat(0),
      vector4Zero(),
    );
    const curr = createPhaseSpace(
      createVector4(2, 0, 0, 0),
      createVector3(0, 0, 0),
      yawToQuat(Math.PI / 2),
      createVector4(0, 1, 0, 0),
    );
    const wl: WorldLine = {
      history: [prev, curr],
      maxHistorySize: 10,
      origin: null,
      version: 0,
    };
    const obs = createVector4(2, 1, 0, 0);
    const b = pastLightConeIntersectionWorldLine(wl, obs);
    const l = pastLightConeIntersectionWorldLineLinear(wl, obs);
    expect(b?.heading.w).toBeCloseTo(l?.heading.w ?? NaN, 9);
    expect(b?.heading.z).toBeCloseTo(l?.heading.z ?? NaN, 9);
    expect(b?.alpha.x).toBeCloseTo(l?.alpha.x ?? NaN, 9);
  });
});
