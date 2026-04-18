import type { MutableRefObject } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
} from "../../physics";
import { useGameStore } from "../../stores/game-store";
import { ENERGY_MAX, LIGHTHOUSE_ID_PREFIX, MAX_WORLDLINE_HISTORY } from "./constants";
import { applySnapshot, buildSnapshot } from "./snapshot";
import type { RelativisticPlayer } from "./types";

type SnapshotMsg = ReturnType<typeof buildSnapshot>;

function makePlayer(
  id: string,
  posT: number,
  posX = 0,
  color = "#fff",
  ownerId: string = id,
): RelativisticPlayer {
  const phaseSpace = createPhaseSpace(
    createVector4(posT, posX, 0, 0),
    createVector3(0, 0, 0),
  );
  return {
    id,
    ownerId,
    phaseSpace,
    worldLine: appendWorldLine(
      createWorldLine(MAX_WORLDLINE_HISTORY),
      phaseSpace,
    ),
    color,
    isDead: false,
    energy: ENERGY_MAX,
  };
}

function makeSnapshot(
  players: Array<{ id: string; posT: number; posX?: number; color?: string }>,
): SnapshotMsg {
  return {
    type: "snapshot" as const,
    hostTime: 0,
    scores: {},
    displayNames: {},
    killLog: [],
    respawnLog: [],
    players: players.map((p) => ({
      id: p.id,
      ownerId: p.id,
      color: p.color ?? "#fff",
      displayName: undefined,
      isDead: false,
      energy: ENERGY_MAX,
      phaseSpace: {
        pos: { t: p.posT, x: p.posX ?? 0, y: 0, z: 0 },
        u: { x: 0, y: 0, z: 0 },
      },
      worldLineHistory: [
        {
          pos: { t: p.posT, x: p.posX ?? 0, y: 0, z: 0 },
          u: { x: 0, y: 0, z: 0 },
        },
      ],
      worldLineOrigin: null,
    })),
  };
}

function makeLastUpdateRef(): MutableRefObject<Map<string, number>> {
  return { current: new Map() };
}

function resetStore() {
  useGameStore.setState({
    players: new Map(),
    scores: {},
    killLog: [],
    respawnLog: [],
    displayNames: new Map(),
    pendingSpawnEvents: [],
  });
}

describe("applySnapshot", () => {
  beforeEach(() => {
    resetStore();
  });

  it("新規 join path: 既存 state が無いと全プレイヤーを snapshot から構築", () => {
    const myId = "me";
    const msg = makeSnapshot([
      { id: "me", posT: 1.0, posX: 1 },
      { id: "peer", posT: 1.0, posX: 2 },
    ]);

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef());

    const { players } = useGameStore.getState();
    expect(players.has("me")).toBe(true);
    expect(players.has("peer")).toBe(true);
    expect(players.get("me")?.phaseSpace.pos.x).toBe(1);
    expect(players.get("peer")?.phaseSpace.pos.x).toBe(2);
  });

  it("migration path: 自機 local state を保持 (snapshot 側の自機エントリは無視)", () => {
    const myId = "me";
    // local: 自機は pos.t=5
    useGameStore.setState({
      players: new Map([["me", makePlayer("me", 5.0, 42)]]),
    });

    // snapshot: host が相対的に古い自機情報を持っている (pos.t=2)
    const msg = makeSnapshot([{ id: "me", posT: 2.0, posX: 999 }]);

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef());

    const me = useGameStore.getState().players.get("me");
    expect(me).toBeDefined();
    expect(me?.phaseSpace.pos.t).toBe(5.0);
    expect(me?.phaseSpace.pos.x).toBe(42);
  });

  it("migration path: 他 peer は pos.t の新しい方を採用 (local が新しい場合 local を保持)", () => {
    const myId = "me";
    useGameStore.setState({
      players: new Map([
        ["me", makePlayer("me", 5.0)],
        ["peer", makePlayer("peer", 5.0, 100)], // local: peer.pos.t=5, x=100
      ]),
    });

    // snapshot: peer は pos.t=2, x=999 (host の view は古い)
    const msg = makeSnapshot([
      { id: "me", posT: 5.0 },
      { id: "peer", posT: 2.0, posX: 999 },
    ]);

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef());

    const peer = useGameStore.getState().players.get("peer");
    expect(peer?.phaseSpace.pos.t).toBe(5.0);
    expect(peer?.phaseSpace.pos.x).toBe(100);
  });

  it("migration path: snapshot 側の pos.t が新しい場合は snapshot を採用", () => {
    const myId = "me";
    useGameStore.setState({
      players: new Map([
        ["me", makePlayer("me", 5.0)],
        ["peer", makePlayer("peer", 2.0, 100)], // local: 古い
      ]),
    });

    // snapshot: peer は pos.t=5 (より新しい)
    const msg = makeSnapshot([
      { id: "me", posT: 5.0 },
      { id: "peer", posT: 5.0, posX: 999 },
    ]);

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef());

    const peer = useGameStore.getState().players.get("peer");
    expect(peer?.phaseSpace.pos.t).toBe(5.0);
    expect(peer?.phaseSpace.pos.x).toBe(999);
  });
});

describe("buildSnapshot", () => {
  beforeEach(() => {
    resetStore();
  });

  it("LH ownerId は caller (= beacon holder) に rewrite される", () => {
    const lhId = `${LIGHTHOUSE_ID_PREFIX}1`;
    const newHostId = "new-host";
    const oldHostId = "old-host";
    useGameStore.setState({
      players: new Map([
        // LH は old host が owner だった (migration 前 / assumeHostRole 前の state)
        [lhId, makePlayer(lhId, 1.0, 0, "#ff0", oldHostId)],
        [newHostId, makePlayer(newHostId, 1.0, 0, "#fff")],
        ["peer", makePlayer("peer", 1.0, 0, "#0ff")],
      ]),
    });

    const msg = buildSnapshot(newHostId);

    const lhEntry = msg.players.find((p) => p.id === lhId);
    expect(lhEntry).toBeDefined();
    // LH ownerId は caller (= newHostId) に強制 rewrite
    expect(lhEntry?.ownerId).toBe(newHostId);

    // 人間プレイヤーの ownerId は self-own を維持 (rewrite しない)
    const peerEntry = msg.players.find((p) => p.id === "peer");
    expect(peerEntry?.ownerId).toBe("peer");
    const meEntry = msg.players.find((p) => p.id === newHostId);
    expect(meEntry?.ownerId).toBe(newHostId);
  });
});
