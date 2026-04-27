import { describe, expect, it } from "vitest";
import { buildWorldLineSegments } from "./WorldLineRenderer";

const L = 20;
const obs = { t: 0, x: 0, y: 0, z: 0 };

const ps = (x: number, y: number) => ({ pos: { x, y } });

describe("buildWorldLineSegments", () => {
  it("history.length < 2 は空配列 (TubeGeometry を作れないので落とす)", () => {
    expect(buildWorldLineSegments([], obs, L)).toEqual([]);
    expect(buildWorldLineSegments([ps(0, 0)], obs, L)).toEqual([]);
  });

  it("torusHalfWidth undefined (= open_cylinder) なら全 history を 1 segment で返す", () => {
    const h = [ps(0, 0), ps(10, 0), ps(30, 0)];
    const result = buildWorldLineSegments(h, obs, undefined);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(h);
  });

  it("observerPos null なら全 history を 1 segment で返す", () => {
    const h = [ps(0, 0), ps(10, 0), ps(30, 0)];
    const result = buildWorldLineSegments(h, null, L);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(h);
  });

  it("torus mode で wrap 跨ぎ無しなら 1 segment", () => {
    const h = [ps(0, 0), ps(5, 0), ps(10, 0), ps(15, 0)];
    const result = buildWorldLineSegments(h, obs, L);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(h);
  });

  it("cell 跨ぎで segment 分割 (19.99 → 20.01)", () => {
    const h = [ps(15, 0), ps(19.99, 0), ps(20.01, 0), ps(25, 0)];
    const result = buildWorldLineSegments(h, obs, L);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([ps(15, 0), ps(19.99, 0)]);
    expect(result[1]).toEqual([ps(20.01, 0), ps(25, 0)]);
  });

  it("raw |Δ|>L (broadcast 欠落) で defensive 分割", () => {
    // 10 → 32 は cell も変わるが (cell 0 → 1)、 まず raw 判定で塞ぐ
    const h = [ps(0, 0), ps(10, 0), ps(32, 0), ps(35, 0)];
    const result = buildWorldLineSegments(h, obs, L);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([ps(0, 0), ps(10, 0)]);
    expect(result[1]).toEqual([ps(32, 0), ps(35, 0)]);
  });

  it("孤立した 1 vertex segment は捨てる (連続 wrap で間に挟まれた場合)", () => {
    // 19 → 21 (cell 0 → 1)、 21 → 45 (raw Δ=24 で defensive 跨ぎ)、 45 → 45.5 (同 cell 1)
    // → seg A=[19] (drop), seg B=[21] (drop), seg C=[45, 45.5]
    const h = [ps(19, 0), ps(21, 0), ps(45, 0), ps(45.5, 0)];
    const result = buildWorldLineSegments(h, obs, L);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([ps(45, 0), ps(45.5, 0)]);
  });

  it("複数 wrap で複数 segment", () => {
    // primary cell [-20,20)、 cell 1 [20,60)、 cell 2 [60,100)
    const h = [
      ps(15, 0),
      ps(18, 0),
      ps(22, 0), // 18→22: cell 0→1 で分割
      ps(25, 0),
      ps(40, 0),
      ps(58, 0),
      ps(61, 0), // 58→61: cell 1→2 で分割
      ps(70, 0),
    ];
    const result = buildWorldLineSegments(h, obs, L);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual([ps(15, 0), ps(18, 0)]);
    expect(result[1]).toEqual([ps(22, 0), ps(25, 0), ps(40, 0), ps(58, 0)]);
    expect(result[2]).toEqual([ps(61, 0), ps(70, 0)]);
  });

  it("y 軸方向の wrap も検出", () => {
    const h = [ps(0, 15), ps(0, 19), ps(0, 22), ps(0, 25)];
    const result = buildWorldLineSegments(h, obs, L);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([ps(0, 15), ps(0, 19)]);
    expect(result[1]).toEqual([ps(0, 22), ps(0, 25)]);
  });

  it("observer がオフセットしていても relative cell で動作", () => {
    // observer = (100, 0)、 primary cell = [80, 120)、 隣 = [120, 160)
    const obsShift = { t: 0, x: 100, y: 0, z: 0 };
    const h = [ps(115, 0), ps(119, 0), ps(122, 0), ps(125, 0)];
    const result = buildWorldLineSegments(h, obsShift, L);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([ps(115, 0), ps(119, 0)]);
    expect(result[1]).toEqual([ps(122, 0), ps(125, 0)]);
  });
});
