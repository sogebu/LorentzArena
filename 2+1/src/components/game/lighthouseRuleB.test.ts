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

  it("dead peer は LH の Rule B target から除外 (= 2026-05-02 hotfix で dead skip 復活)", () => {
    // 旧 plan §6 Stage 7 / §7.10 では dead を LH Rule B に含める方針 (= dead.virtualPos の
    // inertial 延長で LH catchup) だったが、 実機検証で「dead-me の virtualPos が alive
    // peer (= LH 含む) を不当に追従させる」 regression が判明、 hotfix で dead skip 復活。
    // dead 単独 + 他 alive 無しの状況では LH は通常 advance (= λ=0) のみ。
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
    // dead skip → peer 0 → λ=0 → LH は dτ=0 + λ=0 で 50 のまま
    expect(result.newPs.pos.t).toBeCloseTo(50, 9);
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

// Fix C (= 2026-05-04 plan §3): LH の Rule B 大ジャンプ時、 旧 LH worldLine を frozenWorldLines
// に凍結すべきことを result.largeJumpFrozenLh で caller に通知する (= self alive Rule B branch
// と対称構造、 5/2 plan §5.5 の意図 implementation gap fix)。 LARGE_JUMP_THRESHOLD_LS = 0.5 ls。
describe("processLighthouseAI Rule B 大ジャンプ凍結 (Fix C)", () => {
  it("大ジャンプ (λ ≥ 0.5 ls): result.largeJumpFrozenLh に旧 LH player を返す", () => {
    const lh = makePlayer(LH_ID, { t: 50, x: 0, y: 0 });
    const peer = makePlayer("p", { t: 60, x: 0, y: 0 }); // λ = 10 (= 大ジャンプ)
    const players = new Map([
      [LH_ID, lh],
      ["p", peer],
    ]);
    const result = callLH(players);
    expect(result.newPs.pos.t).toBeCloseTo(60, 9);
    expect(result.largeJumpFrozenLh).toBeDefined();
    expect(result.largeJumpFrozenLh!.id).toBe(LH_ID);
    expect(result.largeJumpFrozenLh!.color).toBe(lh.color);
    // 旧 worldLine (= jump 前の history) を保持
    expect(result.largeJumpFrozenLh!.worldLine.history.length).toBeGreaterThan(0);
    // newWl は 1 点 (= 新セグメント開始)
    expect(result.newWl.history.length).toBe(1);
    expect(result.newWl.history[0].pos.t).toBeCloseTo(60, 9);
  });

  it("小ジャンプ (λ < 0.5 ls): result.largeJumpFrozenLh は undefined、 worldLine 連続", () => {
    const lh = makePlayer(LH_ID, { t: 50, x: 0, y: 0 });
    const peer = makePlayer("p", { t: 50.3, x: 0, y: 0 }); // λ = 0.3 (< 0.5、 小ジャンプ)
    const players = new Map([
      [LH_ID, lh],
      ["p", peer],
    ]);
    const result = callLH(players);
    expect(result.newPs.pos.t).toBeCloseTo(50.3, 9);
    expect(result.largeJumpFrozenLh).toBeUndefined();
    // newWl は前 history (= initial 1 点) + 新 1 点 = 2 点
    expect(result.newWl.history.length).toBe(2);
  });

  it("no jump (λ = 0、 Rule A 領域): result.largeJumpFrozenLh は undefined", () => {
    const lh = makePlayer(LH_ID, { t: 100, x: 0, y: 0 });
    const peer = makePlayer("p", { t: 80, x: 0, y: 0 }); // peer が過去 → Rule B skip
    const players = new Map([
      [LH_ID, lh],
      ["p", peer],
    ]);
    const result = callLH(players);
    expect(result.newPs.pos.t).toBeCloseTo(100, 9);
    expect(result.largeJumpFrozenLh).toBeUndefined();
  });
});
