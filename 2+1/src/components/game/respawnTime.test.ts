import { describe, expect, it } from "vitest";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
} from "../../physics";
import { ENERGY_MAX, LIGHTHOUSE_ID_PREFIX, MAX_WORLDLINE_HISTORY } from "./constants";
import { isLighthouse } from "./lighthouse";
import { computeSpawnCoordTime, getLatestSpawnT } from "./respawnTime";
import type { KillEventRecord, RelativisticPlayer, RespawnEventRecord } from "./types";

function makePlayer(id: string, originT: number, nowT: number): RelativisticPlayer {
  const origin = createPhaseSpace(
    createVector4(originT, 0, 0, 0),
    createVector3(0, 0, 0),
  );
  const now = createPhaseSpace(
    createVector4(nowT, 0, 0, 0),
    createVector3(0, 0, 0),
  );
  const wl = appendWorldLine(
    appendWorldLine(createWorldLine(MAX_WORLDLINE_HISTORY), origin),
    now,
  );
  return {
    id,
    kind: isLighthouse(id) ? "npc" : "human",
    ownerId: id,
    phaseSpace: now,
    worldLine: wl,
    color: "#fff",
    energy: ENERGY_MAX,
  };
}

function respawn(
  playerId: string,
  posT: number,
  wallTime: number,
): RespawnEventRecord {
  return {
    playerId,
    position: { t: posT, x: 0, y: 0, z: 0 },
    wallTime,
  };
}

// computeSpawnCoordTime test 用 helper: alive player を任意 pos.t で作成。
// kind は ID prefix から自動 derive (= isLighthouse 判定)。
const makePlayerAt = (id: string, posT: number): RelativisticPlayer => {
  const ps = createPhaseSpace(
    createVector4(posT, 0, 0, 0),
    createVector3(0, 0, 0),
  );
  return {
    id,
    kind: isLighthouse(id) ? "npc" : "human",
    ownerId: id,
    phaseSpace: ps,
    worldLine: appendWorldLine(createWorldLine(MAX_WORLDLINE_HISTORY), ps),
    color: "#fff",
    energy: ENERGY_MAX,
  };
};

const NO_KILLS: readonly KillEventRecord[] = [];
const NO_DEAD: ReadonlySet<string> = new Set();
const NOW_WALL = 1_000_000;

describe("computeSpawnCoordTime — (γ') mean formula + NPC skip + self 包含", () => {
  // §1.2 (I) NPC 非対称: NPC を peer set から除外
  it("alive human のみ + LH 1 → human の pos.t のみで決まる (= LH 値を変えても結果不変)", () => {
    const human = makePlayerAt("human-a", 100);
    const lh = makePlayerAt(`${LIGHTHOUSE_ID_PREFIX}0`, 1_000_000); // 大きく振っても影響しない
    const players = new Map([
      ["human-a", human],
      [`${LIGHTHOUSE_ID_PREFIX}0`, lh],
    ]);
    expect(
      computeSpawnCoordTime(players, NO_KILLS, undefined, NOW_WALL, NO_DEAD),
    ).toBe(100);
  });

  it("alive humans 2 + LH 1 → human 2 人の mean のみ", () => {
    const players = new Map([
      ["human-a", makePlayerAt("human-a", 100)],
      ["human-b", makePlayerAt("human-b", 200)],
      [`${LIGHTHOUSE_ID_PREFIX}0`, makePlayerAt(`${LIGHTHOUSE_ID_PREFIX}0`, 999_999)],
    ]);
    // mean(100, 200) = 150
    expect(
      computeSpawnCoordTime(players, NO_KILLS, undefined, NOW_WALL, NO_DEAD),
    ).toBe(150);
  });

  // §1.3 (II''') mean formula: outlier robustness vs midpoint
  it("通常 cluster {10, 11, 12} → mean = midpoint = 11 (= 同値)", () => {
    const players = new Map([
      ["a", makePlayerAt("a", 10)],
      ["b", makePlayerAt("b", 11)],
      ["c", makePlayerAt("c", 12)],
    ]);
    // mean(10, 11, 12) = 11、 midpoint も 11、 通常 plays では同値
    expect(
      computeSpawnCoordTime(players, NO_KILLS, undefined, NOW_WALL, NO_DEAD),
    ).toBe(11);
  });

  it("outlier 1 つ {10, 11, 12, 100} → mean = 33.25 (= midpoint 55 と異なる、 robust)", () => {
    const players = new Map([
      ["a", makePlayerAt("a", 10)],
      ["b", makePlayerAt("b", 11)],
      ["c", makePlayerAt("c", 12)],
      ["d", makePlayerAt("d", 100)],
    ]);
    // mean(10, 11, 12, 100) = 133/4 = 33.25
    // (旧 midpoint だと (10+100)/2 = 55、 outlier full pull)
    expect(
      computeSpawnCoordTime(players, NO_KILLS, undefined, NOW_WALL, NO_DEAD),
    ).toBe(33.25);
  });

  // §1.3 self 包含 (= excludeId 撤去): self も virtualPos で寄与
  it("solo 1 human (alive) → self の pos.t がそのまま結果 (= 単一値の mean は値そのもの)", () => {
    const players = new Map([["solo", makePlayerAt("solo", 42)]]);
    expect(
      computeSpawnCoordTime(players, NO_KILLS, undefined, NOW_WALL, NO_DEAD),
    ).toBe(42);
  });

  it("solo 1 human (dead) → death event coord time + γ_death × elapsed の virtualPos.t", () => {
    // dead self の virtualPos = pos.t + γ × (nowWall - killWall)/1000
    // u=0、 γ=1、 elapsed = 1 sec (= MAX_VIRTUAL_TAU_SEC=2 内) → vp.t = 50 + 1 = 51
    const ps = createPhaseSpace(
      createVector4(50, 0, 0, 0), // death event coord time
      createVector3(0, 0, 0), // u=0、 γ=1
    );
    const player: RelativisticPlayer = {
      id: "solo",
      kind: "human",
      ownerId: "solo",
      phaseSpace: ps,
      worldLine: appendWorldLine(createWorldLine(MAX_WORLDLINE_HISTORY), ps),
      color: "#fff",
      energy: ENERGY_MAX,
    };
    const killLog: KillEventRecord[] = [
      {
        victimId: "solo",
        killerId: "killer",
        hitPos: { t: 50, x: 0, y: 0, z: 0 },
        wallTime: NOW_WALL - 1_000, // 1 sec ago (= MAX_VIRTUAL_TAU_SEC cap 内)
        victimName: "Solo",
        victimColor: "#fff",
        firedForUi: false,
        firedImageCells: [],
      },
    ];
    const players = new Map([["solo", player]]);
    const deadIds = new Set(["solo"]);
    // virtualPos: lastSync = killWall = NOW_WALL - 1000、 tau = 1 sec (= cap 内)
    // vp.t = 50 + 1 × 1 = 51
    expect(
      computeSpawnCoordTime(players, killLog, undefined, NOW_WALL, deadIds),
    ).toBe(51);
  });

  it("dead self の elapsed が MAX_VIRTUAL_TAU_SEC を超えても tau cap で bounded", () => {
    // virtualWorldLine.ts の MAX_VIRTUAL_TAU_SEC = 2 sec safety net で advance 上限
    const ps = createPhaseSpace(
      createVector4(50, 0, 0, 0),
      createVector3(0, 0, 0),
    );
    const player: RelativisticPlayer = {
      id: "solo",
      kind: "human",
      ownerId: "solo",
      phaseSpace: ps,
      worldLine: appendWorldLine(createWorldLine(MAX_WORLDLINE_HISTORY), ps),
      color: "#fff",
      energy: ENERGY_MAX,
    };
    const killLog: KillEventRecord[] = [
      {
        victimId: "solo",
        killerId: "killer",
        hitPos: { t: 50, x: 0, y: 0, z: 0 },
        wallTime: NOW_WALL - 100_000, // 100 sec ago
        victimName: "Solo",
        victimColor: "#fff",
        firedForUi: false,
        firedImageCells: [],
      },
    ];
    const players = new Map([["solo", player]]);
    const deadIds = new Set(["solo"]);
    // tau capped at 2 sec、 vp.t = 50 + 1 × 2 = 52
    expect(
      computeSpawnCoordTime(players, killLog, undefined, NOW_WALL, deadIds),
    ).toBe(52);
  });

  // §5.1 fallback (= 想定外 defensive): 全 peer NPC で count=0
  it("LH のみ (= 全 NPC) → fallback 0 return (defensive、 想定外)", () => {
    const players = new Map([
      [`${LIGHTHOUSE_ID_PREFIX}0`, makePlayerAt(`${LIGHTHOUSE_ID_PREFIX}0`, 100)],
    ]);
    expect(
      computeSpawnCoordTime(players, NO_KILLS, undefined, NOW_WALL, NO_DEAD),
    ).toBe(0);
  });

  it("空 players → fallback 0 return (defensive、 想定外)", () => {
    const players = new Map<string, RelativisticPlayer>();
    expect(
      computeSpawnCoordTime(players, NO_KILLS, undefined, NOW_WALL, NO_DEAD),
    ).toBe(0);
  });

  // §1.3 dead を spawn 計算で virtualPos 寄与 (= 5/2 §4 維持、 時刻 split 抑制)
  it("alive human + dead human → dead は virtualPos extension で寄与 (= 死亡時 + γ × elapsed)", () => {
    const alive = makePlayerAt("alive", 100);
    // dead at (50, 0, 0)、 u=0、 elapsed = 1 sec → virtualPos.t = 50 + 1 = 51
    const deadPs = createPhaseSpace(
      createVector4(50, 0, 0, 0),
      createVector3(0, 0, 0),
    );
    const dead: RelativisticPlayer = {
      id: "dead",
      kind: "human",
      ownerId: "dead",
      phaseSpace: deadPs,
      worldLine: appendWorldLine(createWorldLine(MAX_WORLDLINE_HISTORY), deadPs),
      color: "#fff",
      energy: ENERGY_MAX,
    };
    const killLog: KillEventRecord[] = [
      {
        victimId: "dead",
        killerId: "killer",
        hitPos: { t: 50, x: 0, y: 0, z: 0 },
        wallTime: NOW_WALL - 1_000, // 1 sec ago (= cap 内)
        victimName: "Dead",
        victimColor: "#fff",
        firedForUi: false,
        firedImageCells: [],
      },
    ];
    const players = new Map([
      ["alive", alive],
      ["dead", dead],
    ]);
    const deadIds = new Set(["dead"]);
    // mean(alive.pos.t=100, dead.virtualPos.t=51) = 75.5
    expect(
      computeSpawnCoordTime(players, killLog, undefined, NOW_WALL, deadIds),
    ).toBe(75.5);
  });
});

describe("getLatestSpawnT", () => {
  it("respawnLog の最新 entry を採用 (log が先、history[0] は無視)", () => {
    const p = makePlayer("me", 100, 120); // history[0].t = 100
    const log = [
      respawn("me", 50, 1000),
      respawn("other", 60, 1001),
      respawn("me", 110, 1002), // ← latest for "me"
    ];
    expect(getLatestSpawnT(log, p)).toBe(110);
  });

  it("respawnLog が空なら worldLine.history[0] にフォールバック", () => {
    const p = makePlayer("me", 100, 120);
    expect(getLatestSpawnT([], p)).toBe(100);
  });

  it("respawnLog に該当 playerId が無ければ history[0] にフォールバック", () => {
    const p = makePlayer("me", 100, 120);
    const log = [respawn("other", 50, 1000)];
    expect(getLatestSpawnT(log, p)).toBe(100);
  });

  it("gap-reset で worldLine.history[0] が書き換わった後も respawnLog は spawn coord time を保持", () => {
    // 再現シナリオ:
    //   1. handleSpawn(me, t=50) → respawnLog に entry、worldLine [ps(t=50)]
    //   2. phaseSpace gap-reset 発火 → worldLine が [ps(t=120)] に置換
    //   3. getLatestSpawnT は respawnLog 経由で 50 を返し続けるべき
    const postResetPlayer = makePlayer("me", 120, 130); // history[0] は "reset 後の現在時刻" で bumped
    const log = [respawn("me", 50, 1000)];
    expect(getLatestSpawnT(log, postResetPlayer)).toBe(50);
  });
});
