import { describe, expect, it } from "vitest";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
} from "../../physics";
import { ARENA_HALF_WIDTH, ENERGY_MAX, MAX_WORLDLINE_HISTORY } from "./constants";
import { checkCausalFreeze } from "./gameLoop";
import type { KillEventRecord, RelativisticPlayer } from "./types";

const L = ARENA_HALF_WIDTH; // 20

const NO_KILLS: readonly KillEventRecord[] = [];

function makePlayer(
  id: string,
  pos: { t: number; x: number; y: number; z?: number },
  options: { isDead?: boolean; u?: { x: number; y: number } } = {},
): RelativisticPlayer {
  const u = options.u ?? { x: 0, y: 0 };
  const ps = createPhaseSpace(
    createVector4(pos.t, pos.x, pos.y, pos.z ?? 0),
    createVector3(u.x, u.y, 0),
  );
  const wl = appendWorldLine(createWorldLine(MAX_WORLDLINE_HISTORY), ps);
  return {
    id,
    ownerId: id,
    phaseSpace: ps,
    worldLine: wl,
    color: "#fff",
    isDead: options.isDead ?? false,
    energy: ENERGY_MAX,
  };
}

describe("checkCausalFreeze — Stage 7 (virtualPos 統一)", () => {
  it("同 cell 内で他機が時間的近接 → freeze 発動 (= guard 機能維持)", () => {
    // me at (10, 0, 0)、 t=100。 other at (10, 0, 0)、 t=99.5 (= 0.5 秒前)。
    // distance 0、 dt 0.5、 s² = -0.25 < 0 → 時間的 → 発動
    const me = makePlayer("me", { t: 100, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 99.5, x: 10, y: 0 });
    const players = new Map([
      ["me", me],
      ["o1", other],
    ]);
    expect(checkCausalFreeze(players, "me", me, NO_KILLS, false, L)).toBe(true);
  });

  it("regression: 観測者跨ぎで他機 universal cover image との距離急変があっても、 同 raw 配置なら freeze 状態が安定", () => {
    const other = makePlayer("o1", { t: 100, x: -15, y: 0 });

    const meLeft = makePlayer("me", { t: 101, x: 25, y: 0 });
    const playersLeft = new Map([
      ["me", meLeft],
      ["o1", other],
    ]);
    const frozenLeft = checkCausalFreeze(
      playersLeft,
      "me",
      meLeft,
      NO_KILLS,
      false,
      L,
    );

    const meRight = makePlayer("me", { t: 101, x: 35, y: 0 });
    const playersRight = new Map([
      ["me", meRight],
      ["o1", other],
    ]);
    const frozenRight = checkCausalFreeze(
      playersRight,
      "me",
      meRight,
      NO_KILLS,
      false,
      L,
    );

    expect(frozenLeft).toBe(true); // distance 0、 dt 1 → 時間的
    expect(frozenRight).toBe(false); // distance 10、 dt 1 → 空間的
  });

  it("観測者と他機が同じ raw 位置でも、 (0,0) wrap で別 cell に折り畳まれた結果 distance が大きくなり freeze 発動しない", () => {
    const me = makePlayer("me", { t: 101, x: 15, y: 0 });
    const other = makePlayer("o1", { t: 100, x: -25, y: 0 });
    const players = new Map([
      ["me", me],
      ["o1", other],
    ]);
    expect(checkCausalFreeze(players, "me", me, NO_KILLS, false, L)).toBe(true);
  });

  it("open_cylinder (torusHalfWidth undefined) は wrap せず raw 距離で判定", () => {
    const me = makePlayer("me", { t: 101, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 100, x: 10.5, y: 0 });
    const players = new Map([
      ["me", me],
      ["o1", other],
    ]);
    expect(checkCausalFreeze(players, "me", me, NO_KILLS, false)).toBe(true);
  });

  it("他機が未来にいる (player.t > me.t) なら判定対象外 (skip)", () => {
    const me = makePlayer("me", { t: 100, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 101, x: 10, y: 0 });
    const players = new Map([
      ["me", me],
      ["o1", other],
    ]);
    expect(checkCausalFreeze(players, "me", me, NO_KILLS, false, L)).toBe(false);
  });

  it("Lighthouse は判定対象外 (= `lighthouse-` prefix の ID で常時 skip)", () => {
    const me = makePlayer("me", { t: 101, x: 10, y: 0 });
    // isLighthouse は `lighthouse-` prefix 判定 (= constants.ts LIGHTHOUSE_ID_PREFIX)。
    // beacon ID の `la-{room}` とは別系統。
    const lhId = "lighthouse-test-0";
    const lh = makePlayer(lhId, { t: 100, x: 10, y: 0 });
    const players = new Map([
      ["me", me],
      [lhId, lh],
    ]);
    expect(checkCausalFreeze(players, "me", me, NO_KILLS, false, L)).toBe(false);
  });

  it("dead は判定対象 (= virtualPos 経由)、 死亡時 phaseSpace + 経過 τ で評価", () => {
    // dead.phaseSpace は死亡時値で固定 (applyKill が残す)、 virtualPos は killLog の
    // wallTime から forward 延長。 nowWall = killWall (= τ=0) なら virtualPos = phaseSpace.pos
    // そのまま → 旧仕様 dead skip と同じ「death pos.t で評価」 だが今回は scope に含まれる。
    const me = makePlayer("me", { t: 101, x: 10, y: 0 });
    const dead = makePlayer("o1", { t: 100, x: 10, y: 0 }, { isDead: true });
    const killLog: KillEventRecord[] = [
      {
        victimId: "o1",
        killerId: "k",
        hitPos: { t: 100, x: 10, y: 0, z: 0 },
        wallTime: 1_000,
        victimName: "o1",
        victimColor: "#fff",
        firedForUi: false,
        firedImageCells: [],
      },
    ];
    const players = new Map([
      ["me", me],
      ["o1", dead],
    ]);
    // currentWallTime = 1000 → τ=0 → virtualPos = (100, 10, 0)、 me と timelike near → freeze
    expect(
      checkCausalFreeze(
        players,
        "me",
        me,
        killLog,
        false,
        L,
        new Map([["o1", 1_000]]), // lastUpdate = killTime (= within grace)
        1_000,
      ),
    ).toBe(true);
  });

  it("他機の最終 phaseSpace 受信が 1.5 秒以上前なら freeze 判定対象外 (= 落ちてる人 sub-grace)", () => {
    const me = makePlayer("me", { t: 101, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 100, x: 10, y: 0 });
    const players = new Map([
      ["me", me],
      ["o1", other],
    ]);
    const now = 10_000;
    const lastUpdate = new Map([["o1", now - 2000]]); // 2 秒前 = grace 超過
    expect(
      checkCausalFreeze(
        players,
        "me",
        me,
        NO_KILLS,
        false,
        L,
        lastUpdate,
        now,
      ),
    ).toBe(false);
  });

  it("他機の最終 phaseSpace 受信が 1 秒前なら通常通り freeze 発動 (= grace 内 = まだ live 扱い)", () => {
    // virtualPos extrapolation を考慮: peer.pos.t = 98、 u=0、 τ=1s で virtualPos.t = 99。
    // me.t = 101 → diff t = -2、 distance 0 → timelike past で freeze。
    const me = makePlayer("me", { t: 101, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 98, x: 10, y: 0 });
    const players = new Map([
      ["me", me],
      ["o1", other],
    ]);
    const now = 10_000;
    const lastUpdate = new Map([["o1", now - 1000]]); // 1 秒前 = grace 内
    expect(
      checkCausalFreeze(
        players,
        "me",
        me,
        NO_KILLS,
        false,
        L,
        lastUpdate,
        now,
      ),
    ).toBe(true);
  });

  it("lastUpdateTime / currentWallTime 未指定なら全 peer 評価 (= 既存 caller との後方互換)", () => {
    const me = makePlayer("me", { t: 101, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 100, x: 10, y: 0 });
    const players = new Map([
      ["me", me],
      ["o1", other],
    ]);
    expect(checkCausalFreeze(players, "me", me, NO_KILLS, false, L)).toBe(true);
  });

  it("Stage 7 新挙動: stale (= 5s+ broadcast 停止) も virtualPos で評価対象、 旧 staleFrozen 引数除外を撤廃", () => {
    // 旧仕様は `staleFrozenIds.has(id)` を 4th arg で受けて skip していたが、 Stage 7 で
    // signature 変更 + virtualPos 統一。 stale peer も lastUpdate ベースの 1.5s grace で
    // skip され得るが、 直接 stale ID set を渡す経路は無くなった。
    const me = makePlayer("me", { t: 101, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 100, x: 10, y: 0 });
    const players = new Map([
      ["me", me],
      ["o1", other],
    ]);
    const now = 20_000;
    // stale 状態 (= last broadcast 6s 前) → grace 超過で skip
    const lastUpdate = new Map([["o1", now - 6000]]);
    expect(
      checkCausalFreeze(
        players,
        "me",
        me,
        NO_KILLS,
        false,
        L,
        lastUpdate,
        now,
      ),
    ).toBe(false);
  });
});
