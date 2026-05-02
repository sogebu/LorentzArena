import { describe, expect, it } from "vitest";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
} from "../../physics";
import {
  ENERGY_MAX,
  LARGE_JUMP_THRESHOLD_LS,
  MAX_FROZEN_WORLDLINES,
  MAX_WORLDLINE_HISTORY,
} from "./constants";
import type { FrozenWorldLine, RelativisticPlayer } from "./types";
import { isLargeJump, pushFrozenWorldLine } from "./worldLineGap";

const makePlayer = (
  id: string,
  options: { isDead?: boolean; emptyWL?: boolean } = {},
): RelativisticPlayer => {
  const ps = createPhaseSpace(
    createVector4(0, 0, 0, 0),
    createVector3(0, 0, 0),
  );
  let worldLine = createWorldLine(MAX_WORLDLINE_HISTORY);
  if (!options.emptyWL) {
    worldLine = appendWorldLine(worldLine, ps);
  }
  return {
    id,
    ownerId: id,
    phaseSpace: ps,
    worldLine,
    color: "#abc",
    isDead: options.isDead ?? false,
    energy: ENERGY_MAX,
  };
};

describe("isLargeJump — λ ≥ LARGE_JUMP_THRESHOLD_LS", () => {
  it("λ = 0: false", () => {
    expect(isLargeJump(0)).toBe(false);
  });
  it("λ < 閾値 (= 0.49): false", () => {
    expect(isLargeJump(LARGE_JUMP_THRESHOLD_LS - 0.01)).toBe(false);
  });
  it("λ = 閾値ぴったり: true (= ≥ で境界包含)", () => {
    expect(isLargeJump(LARGE_JUMP_THRESHOLD_LS)).toBe(true);
  });
  it("λ ≫ 閾値 (= 100): true", () => {
    expect(isLargeJump(100)).toBe(true);
  });
});

describe("pushFrozenWorldLine — 旧 WL を frozenWorldLines に容量上限付きで push", () => {
  it("alive + 非空 worldLine: prev に entry を append", () => {
    const prev: FrozenWorldLine[] = [];
    const p = makePlayer("p1");
    const next = pushFrozenWorldLine(prev, p);
    expect(next).toHaveLength(1);
    expect(next[0].playerId).toBe("p1");
    expect(next[0].color).toBe("#abc");
    expect(next[0].worldLine).toBe(p.worldLine);
  });

  it("dead player: no-op (= prev そのまま)", () => {
    const prev: FrozenWorldLine[] = [];
    const p = makePlayer("dead", { isDead: true });
    const next = pushFrozenWorldLine(prev, p);
    expect(next).toBe(prev); // identity 保持
  });

  it("空 worldLine (= history 0 件): no-op", () => {
    const prev: FrozenWorldLine[] = [];
    const p = makePlayer("p", { emptyWL: true });
    const next = pushFrozenWorldLine(prev, p);
    expect(next).toBe(prev);
  });

  it("容量上限 MAX_FROZEN_WORLDLINES で tail truncate", () => {
    // prev に MAX_FROZEN_WORLDLINES 件埋めて、 さらに 1 件 push → 先頭が落ちて末尾に新規
    const prev: FrozenWorldLine[] = Array.from(
      { length: MAX_FROZEN_WORLDLINES },
      (_, i) => ({
        playerId: `old-${i}`,
        worldLine: createWorldLine(MAX_WORLDLINE_HISTORY),
        color: "#000",
      }),
    );
    const p = makePlayer("new");
    const next = pushFrozenWorldLine(prev, p);
    expect(next).toHaveLength(MAX_FROZEN_WORLDLINES);
    expect(next[0].playerId).toBe("old-1"); // old-0 は落ちる
    expect(next[next.length - 1].playerId).toBe("new");
  });

  it("immutable: prev を mutate しない (= push 時は新規 array)", () => {
    const prev: FrozenWorldLine[] = [];
    const p = makePlayer("p");
    const next = pushFrozenWorldLine(prev, p);
    expect(prev).toHaveLength(0); // 元 array は未変更
    expect(next).not.toBe(prev); // push 時は新規 array
  });
});
