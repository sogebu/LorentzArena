import { describe, expect, it } from "vitest";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
} from "../../physics";
import { ENERGY_MAX, MAX_WORLDLINE_HISTORY } from "./constants";
import type { KillEventRecord, RelativisticPlayer } from "./types";
import { lastSyncForDead, virtualPos } from "./virtualWorldLine";

const makePlayer = (
  id: string,
  pos: { t: number; x: number; y: number },
  u: { x: number; y: number } = { x: 0, y: 0 },
): RelativisticPlayer => {
  const ps = createPhaseSpace(
    createVector4(pos.t, pos.x, pos.y, 0),
    createVector3(u.x, u.y, 0),
  );
  return {
    id,
    ownerId: id,
    phaseSpace: ps,
    worldLine: appendWorldLine(createWorldLine(MAX_WORLDLINE_HISTORY), ps),
    color: "#fff",
    energy: ENERGY_MAX,
  };
};

describe("virtualPos — alive / stale / dead 統一 inertial 延長", () => {
  it("静止 alive (u=0): tau=1s で pos.t は +1、 spatial 不変", () => {
    const p = makePlayer("p", { t: 100, x: 5, y: 7 });
    const now = 10_000;
    const lastSync = 9_000; // = now - 1000ms = tau 1s
    const out = virtualPos(p, lastSync, now);
    expect(out.t).toBeCloseTo(101, 9);
    expect(out.x).toBeCloseTo(5, 9);
    expect(out.y).toBeCloseTo(7, 9);
    expect(out.z).toBe(0);
  });

  it("動き alive (u=(0.6, 0)): tau=1s で pos.t += γ (=√1.36≈1.16619), pos.x += 0.6", () => {
    const p = makePlayer("p", { t: 100, x: 0, y: 0 }, { x: 0.6, y: 0 });
    const out = virtualPos(p, 9_000, 10_000);
    const gExpected = Math.sqrt(1 + 0.36);
    expect(out.t).toBeCloseTo(100 + gExpected, 9);
    expect(out.x).toBeCloseTo(0.6, 9);
    expect(out.y).toBeCloseTo(0, 9);
  });

  it("自機 alive (lastSync = now): tau=0、 phaseSpace.pos そのまま", () => {
    const p = makePlayer("self", { t: 50, x: -3, y: 4 }, { x: 0.8, y: 0.0 });
    const now = 12_345;
    const out = virtualPos(p, now, now);
    expect(out.t).toBeCloseTo(50, 12);
    expect(out.x).toBeCloseTo(-3, 12);
    expect(out.y).toBeCloseTo(4, 12);
  });

  it("dead 静止 (u=0、 死亡から 2s 経過): pos.t += 2、 spatial 不変", () => {
    const p = makePlayer("dead", { t: 200, x: 10, y: 10 }, { x: 0, y: 0 });
    const killWall = 1_000;
    const now = 3_000; // tau = 2
    const out = virtualPos(p, killWall, now);
    expect(out.t).toBeCloseTo(202, 9);
    expect(out.x).toBeCloseTo(10, 9);
    expect(out.y).toBeCloseTo(10, 9);
  });

  it("dead 動き (u=(0.6, 0)、 死亡時の慣性が残る): inertial 直線で xy も進む", () => {
    const p = makePlayer(
      "dead",
      { t: 100, x: 0, y: 0 },
      { x: 0.6, y: 0 },
    );
    const out = virtualPos(p, 0, 1_000); // tau = 1
    expect(out.t).toBeCloseTo(100 + Math.sqrt(1.36), 9);
    expect(out.x).toBeCloseTo(0.6, 9);
    expect(out.y).toBeCloseTo(0, 9);
  });

  it("負 tau (= clock skew で nowWall < lastSync): 数式どおり負方向に外挿される (caller 責任)", () => {
    // 負方向の clamp は本関数の責務外 (= caller 責任)。 正方向は別途 MAX_VIRTUAL_TAU_SEC
    // で cap する (= 2026-05-04 plan §3 Fix B、 別 it ブロックで verify)。 本 test では数式
    // 通りの値を返すことだけ確認。
    const p = makePlayer("p", { t: 100, x: 0, y: 0 }, { x: 1, y: 0 });
    const out = virtualPos(p, 2_000, 1_000); // tau = -1
    const gExpected = Math.sqrt(1 + 1);
    expect(out.t).toBeCloseTo(100 - gExpected, 9);
    expect(out.x).toBeCloseTo(-1, 9);
  });

  it("正 tau の upper bound (MAX_VIRTUAL_TAU_SEC = 2 sec): tau=10s 入力でも tau=2s 相当の advance に cap", () => {
    // Fix B (= 2026-05-04 plan §3): lastSyncWall が壊れて nowWall から 10 秒離れていても、
    // virtualPos の inertial 延長は最大 2 秒に bounded → 線形発散による Rule B 暴走を防止。
    const p = makePlayer("p", { t: 100, x: 0, y: 0 }, { x: 1, y: 0 });
    const out = virtualPos(p, 0, 10_000); // realTau = 10、 cap 後 tau = 2
    const gExpected = Math.sqrt(1 + 1); // u = (1, 0) の γ
    // tau = 2 で cap されているので: pos.t = 100 + γ × 2 ≈ 102.828、 pos.x = 0 + 1 × 2 = 2
    expect(out.t).toBeCloseTo(100 + gExpected * 2, 9);
    expect(out.x).toBeCloseTo(2, 9);
  });

  it("正 tau の boundary (MAX_VIRTUAL_TAU_SEC = 2 sec): tau=2s 入力で cap 効かず数式通り", () => {
    // 境界 tau = 2 sec は cap 適用外 (= Math.min(2, 2) = 2)、 数式通り進む。
    const p = makePlayer("p", { t: 100, x: 0, y: 0 }, { x: 0, y: 0 });
    const out = virtualPos(p, 0, 2_000); // realTau = 2、 cap 後 tau = 2 (同値)
    expect(out.t).toBeCloseTo(102, 9); // γ=1 (u=0) なので pos.t += 2
    expect(out.x).toBeCloseTo(0, 9);
  });
});

describe("lastSyncForDead — killLog から最新 wallTime 取得", () => {
  const mkKill = (
    victimId: string,
    wallTime: number,
  ): KillEventRecord => ({
    victimId,
    killerId: "k",
    hitPos: { t: 0, x: 0, y: 0, z: 0 },
    wallTime,
    victimName: "v",
    victimColor: "#fff",
    firedForUi: false,
    firedImageCells: [],
  });

  it("該当 victim の log 無し → undefined", () => {
    expect(lastSyncForDead("p", [])).toBeUndefined();
    expect(lastSyncForDead("p", [mkKill("other", 1_000)])).toBeUndefined();
  });

  it("単一 entry → その wallTime", () => {
    expect(lastSyncForDead("p", [mkKill("p", 1_500)])).toBe(1_500);
  });

  it("複数 entry → 最大 wallTime (= 最新 kill)", () => {
    const log = [
      mkKill("p", 1_000),
      mkKill("other", 99_999),
      mkKill("p", 5_000),
      mkKill("p", 3_000),
    ];
    expect(lastSyncForDead("p", log)).toBe(5_000);
  });

  it("非昇順 log でも最大値を返す (順序非依存)", () => {
    const log = [mkKill("p", 9_000), mkKill("p", 1_000), mkKill("p", 5_000)];
    expect(lastSyncForDead("p", log)).toBe(9_000);
  });
});
