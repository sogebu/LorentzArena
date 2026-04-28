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
import type { RelativisticPlayer } from "./types";

const L = ARENA_HALF_WIDTH; // 20

function makePlayer(
  id: string,
  pos: { t: number; x: number; y: number; z?: number },
): RelativisticPlayer {
  const ps = createPhaseSpace(
    createVector4(pos.t, pos.x, pos.y, pos.z ?? 0),
    createVector3(0, 0, 0),
  );
  const wl = appendWorldLine(createWorldLine(MAX_WORLDLINE_HISTORY), ps);
  return {
    id,
    ownerId: id,
    phaseSpace: ps,
    worldLine: wl,
    color: "#fff",
    isDead: false,
    energy: ENERGY_MAX,
  };
}

const NO_STALE = new Set<string>();

describe("checkCausalFreeze — PBC (0,0) wrap pattern", () => {
  it("同 cell 内で他機が時間的近接 → freeze 発動 (= guard 機能維持)", () => {
    // me at (10, 0, 0)、 t=100。 other at (5, 0, 0)、 t=99 (= 1 秒前)。
    // distance = 5、 dt = 1 → s² = -1 + 25 = 24 > 0、 spacelike → 無発動
    // よって時間的に詰めるには distance < dt 必要。 distance 0.5、 dt 1 → s² = -1 + 0.25 = -0.75 < 0 → 発動
    const me = makePlayer("me", { t: 100, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 99.5, x: 10, y: 0 }); // distance 0、 dt 0.5、 s²=-0.25
    const players = new Map([
      ["me", me],
      ["o1", other],
    ]);
    expect(checkCausalFreeze(players, "me", me, NO_STALE, false, L)).toBe(true);
  });

  it("regression: 観測者跨ぎで他機 universal cover image との距離急変があっても、 同 raw 配置なら freeze 状態が変わらない", () => {
    // 設定: 他機 raw (-15, 0)、 観測者を raw cell 1 (= [20, 60)) に置き、 raw 配置を保ったまま
    // 観測者位置を (25, 0) と (35, 0) で比べる。 旧 subVector4Torus 実装では minimum image
    // 距離が観測者 cell 切替で discontinuous jump するため、 跨ぎ前後で freeze 状態が flip
    // し得た。 (0,0) wrap pattern では 他機 wrap 位置が固定 (-15, 0)、 観測者 wrap も raw
    // 位置に応じて連続的に動く → 跨ぎで freeze 状態が安定。
    const other = makePlayer("o1", { t: 100, x: -15, y: 0 });

    // 跨ぎ前: 観測者 cell 1 の左端 raw (25, 0) → wrap (-15, 0)、 他機 wrap (-15, 0)、 distance 0
    const meLeft = makePlayer("me", { t: 101, x: 25, y: 0 });
    const playersLeft = new Map([["me", meLeft], ["o1", other]]);
    const frozenLeft = checkCausalFreeze(
      playersLeft,
      "me",
      meLeft,
      NO_STALE,
      false,
      L,
    );

    // 跨ぎ後 (raw cell 1 内移動): 観測者 raw (35, 0) → wrap (-5, 0)、 他機 wrap (-15, 0)、 distance 10
    const meRight = makePlayer("me", { t: 101, x: 35, y: 0 });
    const playersRight = new Map([["me", meRight], ["o1", other]]);
    const frozenRight = checkCausalFreeze(
      playersRight,
      "me",
      meRight,
      NO_STALE,
      false,
      L,
    );

    // 旧 subVector4Torus では: 観測者 (25,0) で minimum image of (-15,0) = (-15,0)、 distance 40
    // (= cell の反対端)、 観測者 (35,0) で minimum image (= -15+40=25,0)、 distance 10
    // → 跨ぎで minimum image 切替で flicker。
    // (0,0) wrap では: 観測者 wrap が (-15,0) → (-5,0) に連続、 他機 wrap は (-15,0) で固定、
    // distance 0 → 10 で連続的に変化、 jump なし。 dt=1 で distance 10 は spacelike → freeze なし。
    expect(frozenLeft).toBe(true); // distance 0、 dt 1 → 時間的
    expect(frozenRight).toBe(false); // distance 10、 dt 1 → 空間的
    // 重要: 観測者 raw 連続移動 (25→35) で freeze on→off は connected な遷移、 jump 無し。
  });

  it("観測者と他機が同じ raw 位置でも、 (0,0) wrap で別 cell に折り畳まれた結果 distance が大きくなり freeze 発動しない", () => {
    // me raw (15, 0) → wrap (15, 0)、 other raw (-25, 0) → wrap = (-25 + 40 = 15, 0)、 distance 0
    // 同じ wrap 位置に来たので freeze 発動。
    const me = makePlayer("me", { t: 101, x: 15, y: 0 });
    const other = makePlayer("o1", { t: 100, x: -25, y: 0 });
    const players = new Map([["me", me], ["o1", other]]);
    // (0,0) wrap: distance 0、 dt 1 → 時間的 → 発動
    expect(checkCausalFreeze(players, "me", me, NO_STALE, false, L)).toBe(true);
  });

  it("open_cylinder (torusHalfWidth undefined) は wrap せず raw 距離で判定", () => {
    // me raw (10, 0)、 other raw (10.5, 0)、 dt 1 → distance 0.5、 時間的 → 発動
    const me = makePlayer("me", { t: 101, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 100, x: 10.5, y: 0 });
    const players = new Map([["me", me], ["o1", other]]);
    expect(checkCausalFreeze(players, "me", me, NO_STALE, false)).toBe(true);
  });

  it("他機が未来にいる (player.t > me.t) なら判定対象外 (skip)", () => {
    const me = makePlayer("me", { t: 100, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 101, x: 10, y: 0 }); // 未来
    const players = new Map([["me", me], ["o1", other]]);
    expect(checkCausalFreeze(players, "me", me, NO_STALE, false, L)).toBe(false);
  });

  it("他機 dead / Lighthouse / staleFrozen は判定対象外", () => {
    const me = makePlayer("me", { t: 101, x: 10, y: 0 });
    const dead = { ...makePlayer("o1", { t: 100, x: 10, y: 0 }), isDead: true };
    const stale = makePlayer("o2", { t: 100, x: 10, y: 0 });
    const players = new Map([["me", me], ["o1", dead], ["o2", stale]]);
    const staleSet = new Set(["o2"]);
    expect(checkCausalFreeze(players, "me", me, staleSet, false, L)).toBe(false);
  });

  it("他機の最終 phaseSpace 受信が 1.5 秒以上前なら freeze 判定対象外 (= 落ちてる人 sub-grace)", () => {
    // me と other は同 wrap 位置 + 時間的近接 (= 通常なら freeze 発動)。 ただし other の最終
    // update が 2 秒前 → staleFrozen 立つ前の sub-grace 期間 → freeze 対象外で skip。
    const me = makePlayer("me", { t: 101, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 100, x: 10, y: 0 });
    const players = new Map([["me", me], ["o1", other]]);
    const now = 10_000;
    const lastUpdate = new Map([["o1", now - 2000]]); // 2 秒前 = grace 超過
    expect(
      checkCausalFreeze(players, "me", me, NO_STALE, false, L, lastUpdate, now),
    ).toBe(false);
  });

  it("他機の最終 phaseSpace 受信が 1 秒前なら通常通り freeze 発動 (= grace 内 = まだ live 扱い)", () => {
    const me = makePlayer("me", { t: 101, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 100, x: 10, y: 0 });
    const players = new Map([["me", me], ["o1", other]]);
    const now = 10_000;
    const lastUpdate = new Map([["o1", now - 1000]]); // 1 秒前 = grace 内
    expect(
      checkCausalFreeze(players, "me", me, NO_STALE, false, L, lastUpdate, now),
    ).toBe(true);
  });

  it("lastUpdateTime / currentWallTime 未指定なら従来挙動 (= 既存 caller との後方互換)", () => {
    const me = makePlayer("me", { t: 101, x: 10, y: 0 });
    const other = makePlayer("o1", { t: 100, x: 10, y: 0 });
    const players = new Map([["me", me], ["o1", other]]);
    expect(checkCausalFreeze(players, "me", me, NO_STALE, false, L)).toBe(true);
  });
});
