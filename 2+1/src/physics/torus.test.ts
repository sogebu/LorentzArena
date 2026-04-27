import { describe, expect, it } from "vitest";
import {
  displayPos,
  eventImage,
  imageCell,
  imageCellKey,
  isWrapCrossing,
  minImageDelta1D,
  minImageDelta4,
  observableImageCells,
  requiredImageCellRadius,
  shiftObserverToReferenceImage,
  subVector4Torus,
} from "./torus";

const L = 20;

describe("minImageDelta1D", () => {
  it("折り畳まない範囲は素通し", () => {
    expect(minImageDelta1D(0, L)).toBe(0);
    expect(minImageDelta1D(5, L)).toBe(5);
    expect(minImageDelta1D(-5, L)).toBe(-5);
    expect(minImageDelta1D(19.99, L)).toBeCloseTo(19.99, 10);
    expect(minImageDelta1D(-19.99, L)).toBeCloseTo(-19.99, 10);
  });

  it("L 超えで反対側に wrap", () => {
    expect(minImageDelta1D(22, L)).toBeCloseTo(-18, 10); // 22 - 40
    expect(minImageDelta1D(-22, L)).toBeCloseTo(18, 10); // -22 + 40
    expect(minImageDelta1D(35, L)).toBeCloseTo(-5, 10); // 35 - 40
  });

  it("複数周回", () => {
    expect(minImageDelta1D(50, L)).toBeCloseTo(10, 10); // 50 - 40
    expect(minImageDelta1D(82, L)).toBeCloseTo(2, 10); // 82 - 80
    expect(minImageDelta1D(-82, L)).toBeCloseTo(-2, 10);
  });
});

describe("minImageDelta4", () => {
  it("(x, y) のみ wrap、 t/z 不変", () => {
    const a = { t: 5, x: 22, y: -22, z: 0 };
    const b = { t: 1, x: 0, y: 0, z: 0 };
    const d = minImageDelta4(a, b, L);
    expect(d.t).toBe(4); // 5 - 1
    expect(d.x).toBeCloseTo(-18, 10); // 22 wrap
    expect(d.y).toBeCloseTo(18, 10); // -22 wrap
    expect(d.z).toBe(0);
  });
});

describe("imageCell", () => {
  const obs = { x: 0, y: 0 };

  it("primary cell は (0, 0)", () => {
    expect(imageCell({ x: 0, y: 0 }, obs, L)).toEqual({ kx: 0, ky: 0 });
    expect(imageCell({ x: 19.99, y: 0 }, obs, L)).toEqual({ kx: 0, ky: 0 });
    expect(imageCell({ x: -19.99, y: 0 }, obs, L)).toEqual({ kx: 0, ky: 0 });
  });

  it("境界 +L で次の cell に入る", () => {
    expect(imageCell({ x: 20, y: 0 }, obs, L)).toEqual({ kx: 1, ky: 0 });
    expect(imageCell({ x: 20.01, y: 0 }, obs, L)).toEqual({ kx: 1, ky: 0 });
  });

  it("境界 -L はまだ primary cell 内 ([-L, L) なので)", () => {
    expect(imageCell({ x: -20, y: 0 }, obs, L)).toEqual({ kx: 0, ky: 0 });
    expect(imageCell({ x: -20.01, y: 0 }, obs, L)).toEqual({ kx: -1, ky: 0 });
  });

  it("observer 中心が動いても cell は relative", () => {
    const obsShift = { x: 100, y: 0 };
    // primary cell = [80, 120)、隣接 cell -1 = [40, 80)、cell 1 = [120, 160)
    expect(imageCell({ x: 100, y: 0 }, obsShift, L)).toEqual({ kx: 0, ky: 0 });
    expect(imageCell({ x: 121, y: 0 }, obsShift, L)).toEqual({ kx: 1, ky: 0 });
    expect(imageCell({ x: 80.01, y: 0 }, obsShift, L)).toEqual({
      kx: 0,
      ky: 0,
    });
    expect(imageCell({ x: 79.99, y: 0 }, obsShift, L)).toEqual({
      kx: -1,
      ky: 0,
    });
  });
});

describe("displayPos", () => {
  const obs = { x: 0, y: 0 };

  it("primary cell 内は素通し (x, y のみ、 t/z も保持)", () => {
    const p = { t: 3, x: 5, y: -7, z: 0 };
    const d = displayPos(p, obs, L);
    expect(d).toEqual({ t: 3, x: 5, y: -7, z: 0 });
  });

  it("境界外は最短画像で primary cell 内に", () => {
    expect(displayPos({ t: 0, x: 22, y: 0, z: 0 }, obs, L)).toEqual({
      t: 0,
      x: -18,
      y: 0,
      z: 0,
    });
  });

  it("observer が動くと折り畳み中心も追従", () => {
    const obsShift = { x: 100, y: 0 };
    // 99 は obsShift から -1 → primary cell 内
    expect(displayPos({ t: 0, x: 99, y: 0, z: 0 }, obsShift, L)).toMatchObject({
      x: 99,
      y: 0,
    });
    // 125 は obsShift から +25 → wrap して -15 → display = 100 - 15 = 85
    expect(displayPos({ t: 0, x: 125, y: 0, z: 0 }, obsShift, L)).toMatchObject(
      {
        x: 85,
        y: 0,
      },
    );
  });
});

describe("isWrapCrossing", () => {
  const obs = { x: 0, y: 0 };

  it("通常 1 tick (Δ=0.02) は繋ぐ", () => {
    const p0 = { x: 5, y: 0 };
    const p1 = { x: 5.02, y: 0 };
    expect(isWrapCrossing(p0, p1, obs, L)).toBe(false);
  });

  it("境界跨ぎ瞬間 (19.99 → 20.01、 obs=0) は cell 比較で切る", () => {
    const p0 = { x: 19.99, y: 0 };
    const p1 = { x: 20.01, y: 0 };
    // raw Δ = 0.02 (small)、 cell(19.99) = 0、 cell(20.01) = 1 → 切る
    expect(isWrapCrossing(p0, p1, obs, L)).toBe(true);
  });

  it("broadcast 欠落 (raw Δ=22) は raw 判定で切る", () => {
    const p0 = { x: 10, y: 0 };
    const p1 = { x: 32, y: 0 };
    expect(isWrapCrossing(p0, p1, obs, L)).toBe(true);
  });

  it("観測者真反対 (P_0=15, P_1=-15、 obs=0、 raw Δ=30) は raw 判定で切る", () => {
    const p0 = { x: 15, y: 0 };
    const p1 = { x: -15, y: 0 };
    // raw Δ = 30 > L = 20 → 切る (cell は両方 0 だが defensive 判定で塞ぐ)
    expect(isWrapCrossing(p0, p1, obs, L)).toBe(true);
  });

  it("observer の真反対側に worldLine が連続的にいるなら繋ぐ", () => {
    // P_0 = 19.99 (obs cell 0)、 P_1 = 19.5 (obs cell 0)、 raw Δ = 0.49 < L → 同じ cell
    const p0 = { x: 19.99, y: 0 };
    const p1 = { x: 19.5, y: 0 };
    expect(isWrapCrossing(p0, p1, obs, L)).toBe(false);
  });

  it("y 軸でも判定が機能", () => {
    expect(isWrapCrossing({ x: 0, y: 19.99 }, { x: 0, y: 20.01 }, obs, L)).toBe(
      true,
    );
    expect(isWrapCrossing({ x: 0, y: 0 }, { x: 0, y: 25 }, obs, L)).toBe(true); // raw Δ
  });

  it("複数周回した worldLine 各点の隣接判定", () => {
    // primary [-20, 20)、 cell 1 [20, 60)、 cell 2 [60, 100)
    expect(isWrapCrossing({ x: 19.98, y: 0 }, { x: 20.0, y: 0 }, obs, L)).toBe(
      true,
    ); // cell 0 → 1
    expect(isWrapCrossing({ x: 20.0, y: 0 }, { x: 20.02, y: 0 }, obs, L)).toBe(
      false,
    ); // 同 cell 1
    expect(isWrapCrossing({ x: 39.99, y: 0 }, { x: 40.01, y: 0 }, obs, L)).toBe(
      false,
    ); // 同 cell 1 (境界は 60)
    expect(isWrapCrossing({ x: 59.99, y: 0 }, { x: 60.01, y: 0 }, obs, L)).toBe(
      true,
    ); // cell 1 → 2
  });

  it("微振動 (境界 ±0.02) は毎 tick 切る (PBC として自然)", () => {
    // 19.99 ↔ 20.01 で振動 → cell 0 ↔ cell 1 → 各 tick 切る
    expect(isWrapCrossing({ x: 19.99, y: 0 }, { x: 20.01, y: 0 }, obs, L)).toBe(
      true,
    );
    expect(isWrapCrossing({ x: 20.01, y: 0 }, { x: 19.99, y: 0 }, obs, L)).toBe(
      true,
    );
  });
});

describe("subVector4Torus", () => {
  it("torusHalfWidth 未指定なら通常の subVector4 と等価", () => {
    const a = { t: 5, x: 22, y: -22, z: 0 };
    const b = { t: 1, x: 0, y: 0, z: 0 };
    expect(subVector4Torus(a, b)).toEqual({ t: 4, x: 22, y: -22, z: 0 });
  });
  it("torusHalfWidth 指定で (x,y) のみ最短画像化", () => {
    const a = { t: 5, x: 22, y: -22, z: 0 };
    const b = { t: 1, x: 0, y: 0, z: 0 };
    const d = subVector4Torus(a, b, L);
    expect(d.t).toBe(4);
    expect(d.x).toBeCloseTo(-18, 10);
    expect(d.y).toBeCloseTo(18, 10);
    expect(d.z).toBe(0);
  });
});

describe("shiftObserverToReferenceImage", () => {
  it("undefined L なら素通し", () => {
    const obs2 = { t: 0, x: 0, y: 0, z: 0 };
    const ref = { t: 0, x: 50, y: 0, z: 0 };
    expect(shiftObserverToReferenceImage(obs2, ref)).toEqual(obs2);
  });
  it("observer を reference と同 cell に shift (例 obs=(0,0), ref=(50,0), L=20 → (40,0))", () => {
    const obs2 = { t: 0, x: 0, y: 0, z: 0 };
    const ref = { t: 0, x: 50, y: 0, z: 0 };
    const r = shiftObserverToReferenceImage(obs2, ref, L);
    expect(r.x).toBeCloseTo(40, 10);
    expect(r.y).toBe(0);
    expect(r.t).toBe(0);
    // shifted observer と reference の delta が最短画像 = 同 cell
    expect(Math.abs(r.x - ref.x)).toBeLessThanOrEqual(L);
    expect(Math.abs(r.y - ref.y)).toBeLessThanOrEqual(L);
  });
  it("既に同 cell なら no-op", () => {
    const obs2 = { t: 0, x: 5, y: 0, z: 0 };
    const ref = { t: 0, x: 10, y: 0, z: 0 };
    const r = shiftObserverToReferenceImage(obs2, ref, L);
    expect(r.x).toBeCloseTo(5, 10);
  });
  it("y 軸も同様に shift", () => {
    const obs2 = { t: 0, x: 0, y: 0, z: 0 };
    const ref = { t: 0, x: 0, y: -50, z: 0 };
    const r = shiftObserverToReferenceImage(obs2, ref, L);
    expect(r.x).toBe(0);
    expect(r.y).toBeCloseTo(-40, 10);
  });
  it("複数周回した reference でも shift で同 cell", () => {
    const obs2 = { t: 0, x: 0, y: 0, z: 0 };
    const ref = { t: 0, x: 130, y: 0, z: 0 };
    const r = shiftObserverToReferenceImage(obs2, ref, L);
    // reference との最短画像 delta = 130 - 120 = 10 → shifted obs = 130 - 10 = 120
    expect(r.x).toBeCloseTo(120, 10);
    expect(Math.abs(r.x - ref.x)).toBeLessThanOrEqual(L);
  });
});

describe("observableImageCells", () => {
  it("R=0 は primary cell のみ", () => {
    const cells = observableImageCells(0);
    expect(cells).toEqual([{ kx: 0, ky: 0 }]);
  });
  it("R=1 は 9 cells (primary 先頭)", () => {
    const cells = observableImageCells(1);
    expect(cells).toHaveLength(9);
    expect(cells[0]).toEqual({ kx: 0, ky: 0 });
  });
  it("R=2 は 25 cells", () => {
    expect(observableImageCells(2)).toHaveLength(25);
  });
});

describe("imageCellKey", () => {
  it("'kx,ky' 文字列を返す", () => {
    expect(imageCellKey({ kx: 0, ky: 0 })).toBe("0,0");
    expect(imageCellKey({ kx: -1, ky: 1 })).toBe("-1,1");
  });
});

describe("eventImage", () => {
  it("primary cell は素通し", () => {
    const e = { x: 5, y: -7, t: 100, z: 0 };
    expect(eventImage(e, { kx: 0, ky: 0 }, 20)).toEqual(e);
  });
  it("(x, y) を 2L*(kx, ky) shift、 t/z 不変", () => {
    const e = { x: 5, y: -7, t: 100, z: 0 };
    const r = eventImage(e, { kx: 1, ky: -1 }, 20);
    expect(r).toEqual({ x: 45, y: -47, t: 100, z: 0 });
  });
});

describe("requiredImageCellRadius", () => {
  it("LCH = L → R = 1 (= 3x3 で十分)", () => {
    expect(requiredImageCellRadius(20, 20)).toBe(1);
  });
  it("LCH = 2L → R = 1 (= 隣接が境界、 余裕には R=2)", () => {
    expect(requiredImageCellRadius(20, 40)).toBe(1);
  });
  it("LCH = 3L → R = 2 (= 5x5)", () => {
    expect(requiredImageCellRadius(20, 60)).toBe(2);
  });
  it("LCH < L → R = 1 (ceil)", () => {
    expect(requiredImageCellRadius(20, 10)).toBe(1);
  });
});
