/**
 * Stage 4 (= LH Rule B 置換) の挙動確認。 旧 minPlayerT scheme との違いを Bug 5 シナリオで
 * 直接 verify。 plans/2026-05-02-causality-symmetric-jump.md §6 Stage 4。
 *
 * 各 test は dTau=0 で evolvePhaseSpace を no-op 化し、 Rule B 単独の効果を測定。
 * spawn grace + fire interval は currentTime を spawn 直後 (= 0) にして fire を skip
 * させる (= laser 期待値を扱わず lhNewPs.pos のみ assert)。
 */
import { describe, expect, it } from "vitest";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
} from "../../physics";
import { ENERGY_MAX, MAX_WORLDLINE_HISTORY } from "./constants";
import { processLighthouseAI } from "./gameLoop";
import type { KillEventRecord, RelativisticPlayer } from "./types";

const LH_ID = "la-default-0";

const makePlayer = (
  id: string,
  pos: { t: number; x: number; y: number },
  u: { x: number; y: number } = { x: 0, y: 0 },
  isDead = false,
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
    color: "#abc",
    isDead,
    energy: ENERGY_MAX,
  };
};

const callLH = (
  players: Map<string, RelativisticPlayer>,
  options: {
    killLog?: readonly KillEventRecord[];
    lastUpdateTimes?: Map<string, number>;
    currentTime?: number;
  } = {},
) => {
  const lh = players.get(LH_ID);
  if (!lh) throw new Error("test setup: LH missing");
  return processLighthouseAI(
    players,
    LH_ID,
    lh,
    /* dTau */ 0,
    /* currentTime */ options.currentTime ?? 0,
    /* lastFireMap */ new Map(),
    /* spawnTimeMap */ new Map([[LH_ID, 0]]),
    options.killLog ?? [],
    options.lastUpdateTimes ?? new Map(),
    /* torusHalfWidth */ undefined,
  );
};

describe("processLighthouseAI Rule B integration", () => {
  it("solo (no peer): no jump", () => {
    const lh = makePlayer(LH_ID, { t: 50, x: 0, y: 0 });
    const players = new Map([[LH_ID, lh]]);
    const result = callLH(players);
    expect(result.newPs.pos.t).toBeCloseTo(50, 9);
  });

  it("1 alive peer in past (peer.t < lh.t): no jump (Rule A 領域、 Rule B skip)", () => {
    const lh = makePlayer(LH_ID, { t: 100, x: 0, y: 0 });
    const peer = makePlayer("p", { t: 80, x: 0, y: 0 });
    const players = new Map([
      [LH_ID, lh],
      ["p", peer],
    ]);
    const result = callLH(players);
    expect(result.newPs.pos.t).toBeCloseTo(100, 9);
  });

  it("1 alive peer at same xy in future: λ = Δt、 LH catches up to peer.t exactly", () => {
    const lh = makePlayer(LH_ID, { t: 50, x: 0, y: 0 });
    const peer = makePlayer("p", { t: 100, x: 0, y: 0 }); // Δt=50, |Δxy|=0
    const players = new Map([
      [LH_ID, lh],
      ["p", peer],
    ]);
    const result = callLH(players);
    expect(result.newPs.pos.t).toBeCloseTo(100, 9);
  });

  it("1 alive peer offset spatially: λ = Δt - |Δxy| (= peer's past null cone surface at LH's xy)", () => {
    const lh = makePlayer(LH_ID, { t: 50, x: 0, y: 0 });
    const peer = makePlayer("p", { t: 100, x: 30, y: 0 }); // Δt=50, |Δxy|=30 → λ=20
    const players = new Map([
      [LH_ID, lh],
      ["p", peer],
    ]);
    const result = callLH(players);
    expect(result.newPs.pos.t).toBeCloseTo(70, 9); // 50 + 20
  });

  it("1 alive peer too far spatially (Δt² < |Δxy|², spacelike): no jump", () => {
    const lh = makePlayer(LH_ID, { t: 50, x: 0, y: 0 });
    const peer = makePlayer("p", { t: 60, x: 100, y: 0 }); // Δt=10, |Δxy|=100 → spacelike
    const players = new Map([
      [LH_ID, lh],
      ["p", peer],
    ]);
    const result = callLH(players);
    expect(result.newPs.pos.t).toBeCloseTo(50, 9);
  });

  it("Bug 5 scenario: host 静止 + client 高 γ で LH は client 寄りまで catch up (旧 minPlayerT 仕様との挙動差)", () => {
    // 旧仕様: LH = minPlayerT = host.t (= 100)
    // 新仕様 (Rule B): LH = max_P (P.t - |P.xy - LH.xy|)
    //   - host contribution: 100 - 0 = 100
    //   - client contribution: 200 - 10 = 190
    //   max = 190 → LH jumps to lh.t + (190 - 50) = 50 + 140 = 190
    const lh = makePlayer(LH_ID, { t: 50, x: 0, y: 0 });
    const host = makePlayer("host", { t: 100, x: 0, y: 0 }); // u=0
    const client = makePlayer("client", { t: 200, x: 10, y: 0 }, { x: 1, y: 0 });
    const players = new Map([
      [LH_ID, lh],
      ["host", host],
      ["client", client],
    ]);
    const result = callLH(players);
    expect(result.newPs.pos.t).toBeCloseTo(190, 9);
    expect(result.newPs.pos.t).toBeGreaterThan(100); // 旧仕様の「host 時刻に anchor」 ではない
  });

  it("dead peer: virtualPos が lastSyncForDead から inertial 延長され Rule B に貢献", () => {
    // dead peer は lastSyncForDead で kill wallTime を取り virtualPos で前進。
    // 死亡時 (kill.wallTime=0、 phaseSpace.pos.t=80, u=(1,0)) → currentTime=2000 (= 2s 経過)
    // で virtualPos.t = 80 + γ·2 = 80 + √2·2 ≈ 82.83、 virtualPos.x = 0 + 1·2 = 2
    // LH (50, 0, 0) からの λ = (82.83 - 50) - |2 - 0| = 32.83 - 2 = 30.83
    // → LH.t_new ≈ 50 + 30.83 = 80.83
    const lh = makePlayer(LH_ID, { t: 50, x: 0, y: 0 });
    const dead = makePlayer(
      "victim",
      { t: 80, x: 0, y: 0 },
      { x: 1, y: 0 },
      true,
    );
    const players = new Map([
      [LH_ID, lh],
      ["victim", dead],
    ]);
    const killLog: KillEventRecord[] = [
      {
        victimId: "victim",
        killerId: "k",
        hitPos: { t: 80, x: 0, y: 0, z: 0 },
        wallTime: 0,
        victimName: "v",
        victimColor: "#fff",
        firedForUi: false,
        firedImageCells: [],
      },
    ];
    const result = callLH(players, { killLog, currentTime: 2000 });
    const tauExpected = 2.0;
    const gammaExpected = Math.sqrt(1 + 1);
    const vPosT = 80 + gammaExpected * tauExpected;
    const vPosX = 0 + 1 * tauExpected;
    const lambdaExpected = vPosT - 50 - Math.abs(vPosX);
    expect(result.newPs.pos.t).toBeCloseTo(50 + lambdaExpected, 6);
  });

  it("multi peer mix (alive + dead): max λ over all virtualPos", () => {
    const lh = makePlayer(LH_ID, { t: 100, x: 0, y: 0 });
    const a = makePlayer("a", { t: 110, x: 0, y: 0 }); // λ_a = 10
    const b = makePlayer("b", { t: 130, x: 5, y: 0 }); // λ_b = 130 - 100 - 5 = 25
    const c = makePlayer("c", { t: 105, x: 0, y: 0 }); // λ_c = 5
    const players = new Map([
      [LH_ID, lh],
      ["a", a],
      ["b", b],
      ["c", c],
    ]);
    const result = callLH(players, { currentTime: 0 });
    // alive peer の lastUpdateTimes 未指定 → fallback currentTime → tau=0 → virtualPos = pos そのまま
    expect(result.newPs.pos.t).toBeCloseTo(125, 9); // 100 + max(10, 25, 5) = 125
  });
});
