/**
 * pastConeIntersectionWithFrozenFallback の動作 verify。
 *
 * Fix C 副作用 fix (2026-05-04 plan §3): Rule B 大ジャンプ後の 1 点 worldLine で
 * pastLightConeIntersectionWorldLine が null を返す flicker を frozenWorldLines
 * fallback で連続描画させる helper。
 *
 * test setup の物理: pastLightConeIntersectionWorldLine は worldLine 上で観測者の
 * 過去光円錐 (= null cone surface) との交差 event を返す。 全 history が観測者の
 * null cone の内側 (= timelike past、 g(i) ≥ 0 全部) or 外側 (= spacelike、 g(i) < 0
 * 全部) なら boundary が見つからず null fall back。 観測者を「最新 history が future、
 * 古い history が past」 の境界を跨ぐ位置に設定する必要。
 */
import { describe, expect, it } from "vitest";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
} from "../../physics";
import { MAX_WORLDLINE_HISTORY } from "./constants";
import { pastConeIntersectionWithFrozenFallback } from "./pastConeFallback";
import type { FrozenWorldLine } from "./types";

const buildWorldLine = (
  events: { t: number; x: number; y: number }[],
) => {
  let wl = createWorldLine(MAX_WORLDLINE_HISTORY);
  for (const e of events) {
    const ps = createPhaseSpace(
      createVector4(e.t, e.x, e.y, 0),
      createVector3(0, 0, 0),
    );
    wl = appendWorldLine(wl, ps);
  }
  return wl;
};

describe("pastConeIntersectionWithFrozenFallback", () => {
  it("primary success (current worldLine に交差点あり): primary を返す、 frozen 未走査", () => {
    // current: 静止 worldLine [(0..10, 0, 0)]、 観測者 (5, 0, 0)
    // → g(0)=5≥0 (内), g(1)=-5<0 (外) → 線分内に null cone surface あり、 t=5 で intersect
    const current = buildWorldLine([
      { t: 0, x: 0, y: 0 },
      { t: 10, x: 0, y: 0 },
    ]);
    const frozen: FrozenWorldLine[] = [];
    const observer = createVector4(5, 0, 0, 0);
    const result = pastConeIntersectionWithFrozenFallback(
      current,
      frozen,
      "lh-0",
      observer,
    );
    expect(result).not.toBeNull();
    expect(result!.pos.t).toBeCloseTo(5, 9);
  });

  it("primary null + frozen hit: 1 点 worldLine では null、 frozen で fallback intersection を返す", () => {
    // Fix C シナリオ模擬: current = 大ジャンプ直後の 1 点 (= 線分なし)、 旧軌跡 = frozen
    const current = buildWorldLine([{ t: 100, x: 0, y: 0 }]); // 1 点
    const oldWl = buildWorldLine([
      { t: 0, x: 0, y: 0 },
      { t: 10, x: 0, y: 0 },
    ]);
    const frozen: FrozenWorldLine[] = [
      { playerId: "lh-0", worldLine: oldWl, color: "#abc" },
    ];
    const observer = createVector4(5, 0, 0, 0);
    const result = pastConeIntersectionWithFrozenFallback(
      current,
      frozen,
      "lh-0",
      observer,
    );
    // current 1 点 → 線分なし → null。 frozen の旧軌跡で t=5 intersection
    expect(result).not.toBeNull();
    expect(result!.pos.t).toBeCloseTo(5, 9);
  });

  it("frozen に同 playerId が複数: 逆順走査で最新優先 (= push 最後の frozen から試す)", () => {
    const current = buildWorldLine([{ t: 200, x: 0, y: 0 }]); // 1 点
    const frozenOld = buildWorldLine([
      { t: 0, x: 0, y: 0 },
      { t: 10, x: 0, y: 0 },
    ]);
    const frozenNew = buildWorldLine([
      { t: 50, x: 0, y: 0 },
      { t: 60, x: 0, y: 0 },
    ]);
    const frozen: FrozenWorldLine[] = [
      { playerId: "lh-0", worldLine: frozenOld, color: "#abc" },
      { playerId: "lh-0", worldLine: frozenNew, color: "#abc" },
    ];
    const observer = createVector4(55, 0, 0, 0);
    const result = pastConeIntersectionWithFrozenFallback(
      current,
      frozen,
      "lh-0",
      observer,
    );
    // 観測者 t=55 は frozenNew (t=50..60) で boundary 跨ぎ → intersection (t=55)
    // frozenOld は全内 (g(0)=55, g(1)=45 共に ≥0) → null fall back、 frozenNew が逆順 1st 採用
    expect(result).not.toBeNull();
    expect(result!.pos.t).toBeCloseTo(55, 9);
  });

  it("frozen の playerId が異なる: skip して該当 frozen で試す", () => {
    const current = buildWorldLine([{ t: 100, x: 0, y: 0 }]); // 1 点
    const otherWl = buildWorldLine([
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 0, y: 0 },
    ]);
    const ownWl = buildWorldLine([
      { t: 5, x: 0, y: 0 },
      { t: 15, x: 0, y: 0 },
    ]);
    const frozen: FrozenWorldLine[] = [
      { playerId: "other-player", worldLine: otherWl, color: "#fff" },
      { playerId: "lh-0", worldLine: ownWl, color: "#abc" },
    ];
    const observer = createVector4(10, 0, 0, 0);
    const result = pastConeIntersectionWithFrozenFallback(
      current,
      frozen,
      "lh-0",
      observer,
    );
    // 該当 lh-0 frozen (t=5..15) で観測者 t=10: g(0)=5, g(1)=-5 → boundary 跨ぎ → t=10 intersect
    expect(result).not.toBeNull();
    expect(result!.pos.t).toBeCloseTo(10, 9);
  });

  it("primary null + frozen 該当なし: null を返す", () => {
    const current = buildWorldLine([{ t: 100, x: 0, y: 0 }]); // 1 点
    const frozen: FrozenWorldLine[] = [];
    const observer = createVector4(5, 0, 0, 0);
    const result = pastConeIntersectionWithFrozenFallback(
      current,
      frozen,
      "lh-0",
      observer,
    );
    expect(result).toBeNull();
  });
});
