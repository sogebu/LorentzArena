import { describe, expect, it } from "vitest";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
} from "../../physics";
import { ENERGY_MAX, MAX_WORLDLINE_HISTORY } from "./constants";
import { getLatestSpawnT } from "./respawnTime";
import type { RelativisticPlayer, RespawnEventRecord } from "./types";

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
    ownerId: id,
    phaseSpace: now,
    worldLine: wl,
    color: "#fff",
    isDead: false,
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
