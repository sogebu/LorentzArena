import { describe, expect, it } from "vitest";
import {
  firePendingKillEvents,
  firePendingSpawnEvents,
} from "./causalEvents";
import { ARENA_HALF_WIDTH, LIGHT_CONE_HEIGHT } from "./constants";
import type { KillEventRecord, PendingSpawnEvent } from "./types";

const L = ARENA_HALF_WIDTH; // 20
const LCH = LIGHT_CONE_HEIGHT; // 20 → R = 1, 9 image cells
const FIRE_TIME = 1_000;

const players: Map<string, { color: string }> = new Map([
  ["p1", { color: "#fff" }],
  ["killer", { color: "#aaa" }],
]);

const spawnAt = (
  pos: { t: number; x: number; y: number; z: number },
  firedImageCells: string[] = [],
): PendingSpawnEvent => ({
  id: "s1",
  playerId: "p1",
  pos,
  color: "#fff",
  firedImageCells,
});

const killAt = (
  hitPos: { t: number; x: number; y: number; z: number },
  victimId = "p1",
  killerId = "killer",
): KillEventRecord => ({
  victimId,
  killerId,
  hitPos,
  wallTime: 1,
  victimName: victimId,
  victimColor: "#fff",
  firedForUi: false,
  firedImageCells: [],
});

describe("firePendingSpawnEvents — PBC wrap pattern", () => {
  it("9 image fire: primary は suffix なし ev.id、 残り 8 は suffix 付き", () => {
    // event は (0,0) cell 内、 観測者も (0,0) cell 内、 全 image past cone 入り
    const event = spawnAt({ t: 0, x: 5, y: 0, z: 0 });
    const myPos = { t: 1_000, x: 5, y: 0, z: 0 };
    const r = firePendingSpawnEvents(
      [event],
      myPos,
      FIRE_TIME,
      players,
      L,
      LCH,
    );
    expect(r.firedSpawns).toHaveLength(9);
    expect(r.remaining).toHaveLength(0);
    const primaryEntries = r.firedSpawns.filter((s) => s.id === event.id);
    expect(primaryEntries).toHaveLength(1);
    const suffixed = r.firedSpawns.filter((s) => s.id.includes("#"));
    expect(suffixed).toHaveLength(8);
  });

  it("regression: 観測者が他 cell raw 位置に居ても 9 image が観測者周りに描画される", () => {
    // event raw は world cell (1, 0)、 観測者 raw も world cell (1, 0)。 observer 中心 wrap
    // で event は observer の primary cell `[obs-L, obs+L)` に折り畳み (= 既に同 cell なので
    // wrap 不要)。 image cells は observer 周りの (2R+1)² に並ぶ。
    const event = spawnAt({ t: 0, x: 25, y: 0, z: 0 }); // raw cell (1, 0)
    const myPos = { t: 1_000, x: 25, y: 0, z: 0 }; // raw cell (1, 0)
    const r = firePendingSpawnEvents(
      [event],
      myPos,
      FIRE_TIME,
      players,
      L,
      LCH,
    );
    expect(r.firedSpawns).toHaveLength(9);
    // wrappedEv = displayPos(event, observer, L) = (25, 0) (= observer raw と一致、 距離 0)
    const primary = r.firedSpawns.find((s) => s.id === event.id);
    expect(primary).toBeDefined();
    expect(primary?.pos.x).toBeCloseTo(25, 10); // = observer raw、 描画は observer 真上
    expect(primary?.pos.y).toBeCloseTo(0, 10);
    // 隣接 image cell (1, 0) image = wrappedEv + (40, 0) = (65, 0) (= observer の +1 cell)
    const right = r.firedSpawns.find((s) => s.id === `${event.id}#1,0`);
    expect(right?.pos.x).toBeCloseTo(65, 10);
  });

  it("regression: 観測者跨ぎ前後で同 event の 9 image が重複 fire しない", () => {
    // 跨ぎ前 fire 済 1 image (= primary "0,0")
    const event = spawnAt({ t: 0, x: 0, y: 0, z: 0 }, ["0,0"]);
    // 跨ぎ後 観測者 raw cell (1, 0) (wrap で (0,0) cell に折り畳まれる)
    const myPos = { t: 1_000, x: 25, y: 0, z: 0 };
    const r = firePendingSpawnEvents(
      [event],
      myPos,
      FIRE_TIME,
      players,
      L,
      LCH,
    );
    // 残 8 image fire (= primary は既 fire でスキップ)
    expect(r.firedSpawns).toHaveLength(8);
    expect(r.remaining).toHaveLength(0); // 9 image 累計達成 → 消化
    // primary の重複なし
    const primaryEntries = r.firedSpawns.filter((s) => s.id === event.id);
    expect(primaryEntries).toHaveLength(0);
  });

  it("open_cylinder mode (torusHalfWidth undefined) は primary 1 image のみ = 従来挙動", () => {
    const event = spawnAt({ t: 0, x: 0, y: 0, z: 0 });
    const myPos = { t: 1_000, x: 0, y: 0, z: 0 };
    const r = firePendingSpawnEvents(
      [event],
      myPos,
      FIRE_TIME,
      players,
      undefined,
      undefined,
    );
    expect(r.firedSpawns).toHaveLength(1);
    expect(r.firedSpawns[0].id).toBe(event.id); // primary suffix なし
    expect(r.remaining).toHaveLength(0);
  });
});

describe("firePendingKillEvents — PBC wrap pattern", () => {
  it("primary fire で score 加算 + 跨ぎ後の追加 fire は加算しない", () => {
    const ev = killAt({ t: 0, x: 0, y: 0, z: 0 });

    // tick 1: 観測者 (0,0) で全 9 image fire (= primary 含む)
    const r1 = firePendingKillEvents(
      [ev],
      { t: 1_000, x: 0, y: 0, z: 0 },
      "p1",
      { killer: 5 },
      L,
      LCH,
    );
    expect(r1.newScores.killer).toBe(6); // primary +1
    const merged = r1.firedImageCellsByIndex.get(0) ?? [];
    expect(merged).toContain("0,0");

    // tick 2: 同 event を観測者跨ぎ後 raw 位置で再 evaluate
    const ev2: KillEventRecord = { ...ev, firedImageCells: merged };
    const r2 = firePendingKillEvents(
      [ev2],
      { t: 1_000, x: 25, y: 0, z: 0 },
      "p1",
      { killer: 6 },
      L,
      LCH,
    );
    // 既 9 image fire 済 → 追加 fire 無し → score 加算なし
    expect(r2.newScores.killer).toBe(6);
  });

  it("regression: 観測者が他 cell raw 位置で死亡しても deathFlash trigger", () => {
    // 自機 = victim、 raw cell (1, 0) で死亡 hit、 観測者も同 raw cell。
    // 旧 bug (PRIMARY="0,0" 世界原点 + obsCell 入り dx): deathFlash 不発。
    // 新仕様 (wrap pattern): wrappedEv = wrappedObs = (-15, 0)、 cell (0,0) image は
    // 距離 0 で past cone in → primary fire → deathFlash trigger。
    const ev = killAt({ t: 0, x: 25, y: 0, z: 0 }, "p1", "killer");
    const myPos = { t: 1_000, x: 25, y: 0, z: 0 };
    const r = firePendingKillEvents(
      [ev],
      myPos,
      "p1",
      { killer: 0 },
      L,
      LCH,
    );
    expect(r.effects.deathFlash).toBe(true);
    expect(r.newScores.killer).toBe(1);
  });

  it("regression: 観測者が遠 cell raw 位置で他機 kill notification trigger", () => {
    // 自機 = killer、 victim が遠 cell で死亡、 観測者は別 raw cell。
    // 旧 bug: PRIMARY="0,0" 固定で観測者位置依存に primary 一致せず killNotification 不発。
    // 新仕様: wrap で両者 (0,0) cell に折り畳み → cell (0,0) image が必ず primary 一致。
    const ev: KillEventRecord = {
      victimId: "v1",
      killerId: "p1",
      hitPos: { t: 0, x: -25, y: 25, z: 0 }, // raw cell (-1, 1)
      wallTime: 1,
      victimName: "v1",
      victimColor: "#0f0",
      firedForUi: false,
      firedImageCells: [],
    };
    const myPos = { t: 5_000, x: 80, y: -40, z: 0 }; // raw cell (2, -1)
    const r = firePendingKillEvents(
      [ev],
      myPos,
      "p1",
      { p1: 0 },
      L,
      LCH,
    );
    expect(r.effects.killNotification).not.toBeNull();
    expect(r.effects.killNotification?.victimId).toBe("v1");
    expect(r.newScores.p1).toBe(1);
  });
});
