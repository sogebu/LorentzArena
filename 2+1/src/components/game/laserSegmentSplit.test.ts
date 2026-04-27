import { describe, expect, it } from "vitest";
import { buildLaserSegments } from "./laserSegmentSplit";

const L = 20;
const obs = { t: 0, x: 0, y: 0, z: 0 };

describe("buildLaserSegments", () => {
  it("torusHalfWidth undefined (open_cylinder) は単一 segment", () => {
    const e = { x: 0, y: 0, t: 0 };
    const tip = { x: 30, y: 0, t: 30 };
    const segs = buildLaserSegments(e, tip, obs, undefined);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({
      sx: 0,
      sy: 0,
      st: 0,
      ex: 30,
      ey: 0,
      et: 30,
    });
  });

  it("observerPos null は単一 segment", () => {
    const e = { x: 0, y: 0, t: 0 };
    const tip = { x: 30, y: 0, t: 30 };
    const segs = buildLaserSegments(e, tip, null, L);
    expect(segs).toHaveLength(1);
  });

  it("emission と tip が同じ image cell なら単一 segment", () => {
    const e = { x: 5, y: 0, t: 0 };
    const tip = { x: 15, y: 0, t: 10 };
    const segs = buildLaserSegments(e, tip, obs, L);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ sx: 5, ex: 15 });
  });

  it("x 軸正方向の cell 跨ぎで 2 segment に分割 (境界 +L で切れる)", () => {
    // emission cell 0 (= [-20, 20))、 tip cell 1 (= [20, 60))。 境界 x=20 で切れる
    const e = { x: 15, y: 0, t: 0 };
    const tip = { x: 25, y: 0, t: 10 };
    const segs = buildLaserSegments(e, tip, obs, L);
    expect(segs).toHaveLength(2);
    // segment 1 終端 ≈ (20, 0) 手前 ε、 segment 2 始端 ≈ (20, 0) 奥 ε
    expect(segs[0].ex).toBeCloseTo(20 - 1e-3, 5);
    expect(segs[1].sx).toBeCloseTo(20 + 1e-3, 5);
    // start / end の連続性
    expect(segs[0].sx).toBe(15);
    expect(segs[1].ex).toBe(25);
  });

  it("x 軸負方向の cell 跨ぎ (境界 -L で切れる)", () => {
    const e = { x: -15, y: 0, t: 0 };
    const tip = { x: -25, y: 0, t: 10 };
    const segs = buildLaserSegments(e, tip, obs, L);
    expect(segs).toHaveLength(2);
    expect(segs[0].ex).toBeCloseTo(-20 + 1e-3, 5);
    expect(segs[1].sx).toBeCloseTo(-20 - 1e-3, 5);
  });

  it("y 軸方向の cell 跨ぎ", () => {
    const e = { x: 0, y: 15, t: 0 };
    const tip = { x: 0, y: 25, t: 10 };
    const segs = buildLaserSegments(e, tip, obs, L);
    expect(segs).toHaveLength(2);
    expect(segs[0].ey).toBeCloseTo(20 - 1e-3, 5);
    expect(segs[1].sy).toBeCloseTo(20 + 1e-3, 5);
  });

  it("斜め方向で cell 跨ぎ (x 軸境界が先に来る)", () => {
    // direction (1, 0.5)、 x 境界 +20 で切れる (s_x = 5/10 = 0.5)、 y 境界 +20 で s_y = 17.5/5 = 3.5
    // → x 境界が先 (sExit = 0.5)。 spatial epsilon 1e-3 を direction magnitude (= sqrt(10²+5²))
    // で割った sEps だけ s 値を戻す → ex = 20 - 1e-3 * (10 / sqrt(125))
    const e = { x: 15, y: 2.5, t: 0 };
    const tip = { x: 25, y: 7.5, t: 10 };
    const segs = buildLaserSegments(e, tip, obs, L);
    expect(segs).toHaveLength(2);
    const dirLen = Math.hypot(10, 5);
    const xOffset = (1e-3 * 10) / dirLen;
    expect(segs[0].ex).toBeCloseTo(20 - xOffset, 5);
    expect(segs[1].sx).toBeCloseTo(20 + xOffset, 5);
  });

  it("observerPos がオフセットしていても relative cell で動作", () => {
    // observer = (100, 0)、 primary cell = [80, 120)、 隣 = [120, 160)
    const obsShift = { t: 0, x: 100, y: 0, z: 0 };
    const e = { x: 115, y: 0, t: 0 };
    const tip = { x: 125, y: 0, t: 10 };
    const segs = buildLaserSegments(e, tip, obsShift, L);
    expect(segs).toHaveLength(2);
    expect(segs[0].ex).toBeCloseTo(120 - 1e-3, 5);
    expect(segs[1].sx).toBeCloseTo(120 + 1e-3, 5);
  });

  it("時間成分 t は spatial 距離 epsilon に比例して線形補間される", () => {
    const e = { x: 15, y: 0, t: 100 };
    const tip = { x: 25, y: 0, t: 110 };
    const segs = buildLaserSegments(e, tip, obs, L);
    // dirLen=10、 spatial epsilon=1e-3、 sEps=1e-4、 sExit=0.5、
    // t at sBefore = 100 + 0.4999 * 10 = 104.999、 t at sAfter = 100 + 0.5001 * 10 = 105.001
    expect(segs[0].et).toBeCloseTo(104.999, 5);
    expect(segs[1].st).toBeCloseTo(105.001, 5);
  });
});
