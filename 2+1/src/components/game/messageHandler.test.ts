import type { MutableRefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
} from "../../physics";
import { useGameStore } from "../../stores/game-store";
import { MAX_WORLDLINE_HISTORY, WORLDLINE_GAP_THRESHOLD_MS } from "./constants";
import {
  createMessageHandler,
  type MessageHandlerDeps,
} from "./messageHandler";
import type { RelativisticPlayer } from "./types";

function makePlayer(
  id: string,
  posT: number,
  posX = 0,
  color = "#fff",
): RelativisticPlayer {
  const phaseSpace = createPhaseSpace(
    createVector4(posT, posX, 0, 0),
    createVector3(0, 0, 0),
  );
  return {
    id,
    ownerId: id,
    phaseSpace,
    worldLine: appendWorldLine(
      createWorldLine(MAX_WORLDLINE_HISTORY),
      phaseSpace,
    ),
    color,
    isDead: false,
  };
}

function makeDeps(
  myId = "me",
  lastCoord = new Map<string, { wallTime: number; posT: number }>(),
): MessageHandlerDeps & {
  lastUpdateTimeRef: MutableRefObject<Map<string, number>>;
  lastCoordTimeRef: MutableRefObject<
    Map<string, { wallTime: number; posT: number }>
  >;
  staleFrozenRef: MutableRefObject<Set<string>>;
} {
  return {
    myId,
    peerManager: {
      getIsBeaconHolder: () => false,
      send: vi.fn(),
      sendTo: vi.fn(),
    },
    getPlayerColor: () => "#fff",
    lastUpdateTimeRef: { current: new Map() },
    lastCoordTimeRef: { current: lastCoord },
    staleFrozenRef: { current: new Set() },
  };
}

function makePhaseSpaceMsg(
  senderId: string,
  posT: number,
  posX = 0,
): {
  type: "phaseSpace";
  senderId: string;
  position: { t: number; x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
} {
  return {
    type: "phaseSpace" as const,
    senderId,
    position: { t: posT, x: posX, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
}

function resetStore() {
  useGameStore.setState({
    players: new Map(),
    frozenWorldLines: [],
    lasers: [],
    scores: {},
    killLog: [],
    respawnLog: [],
  });
}

describe("messageHandler phaseSpace gap detection", () => {
  beforeEach(() => {
    resetStore();
  });

  it("gap 小 (< threshold): 既存 worldLine に append、frozenWorldLines 不変", () => {
    const deps = makeDeps("me");
    const handler = createMessageHandler(deps);

    // Pre-populate peer with 1 history point
    useGameStore.setState({
      players: new Map([["peer", makePlayer("peer", 1.0, 0)]]),
    });
    deps.lastCoordTimeRef.current.set("peer", {
      wallTime: Date.now(),
      posT: 1.0,
    });

    handler("peer", makePhaseSpaceMsg("peer", 1.1, 0.5));

    const { players, frozenWorldLines } = useGameStore.getState();
    expect(frozenWorldLines.length).toBe(0);
    expect(players.get("peer")?.worldLine.history.length).toBe(2);
  });

  it("gap 大 (≥ threshold) + 既存 history: 既存 WL を frozen に移し、新 WL 1 点から", () => {
    const deps = makeDeps("me");
    const handler = createMessageHandler(deps);

    useGameStore.setState({
      players: new Map([["peer", makePlayer("peer", 1.0, 0, "hsl(0,0%,50%)")]]),
    });
    // 前回受信は十分昔
    deps.lastCoordTimeRef.current.set("peer", {
      wallTime: Date.now() - WORLDLINE_GAP_THRESHOLD_MS - 100,
      posT: 1.0,
    });

    handler("peer", makePhaseSpaceMsg("peer", 3.6, 10));

    const { players, frozenWorldLines } = useGameStore.getState();
    expect(frozenWorldLines.length).toBe(1);
    expect(frozenWorldLines[0].color).toBe("hsl(0,0%,50%)");
    expect(frozenWorldLines[0].worldLine.history.length).toBe(1);
    // peer の現在 WL は new WL (history=1)
    expect(players.get("peer")?.worldLine.history.length).toBe(1);
    expect(players.get("peer")?.phaseSpace.pos.t).toBe(3.6);
    expect(players.get("peer")?.phaseSpace.pos.x).toBe(10);
  });

  it("gap 大 + 既存 history 空: frozen に push しない (空 WL は凍結しない)", () => {
    const deps = makeDeps("me");
    const handler = createMessageHandler(deps);

    // Player exists but worldLine.history is empty
    const emptyPlayer: RelativisticPlayer = {
      ...makePlayer("peer", 1.0, 0),
      worldLine: createWorldLine(MAX_WORLDLINE_HISTORY),
    };
    useGameStore.setState({
      players: new Map([["peer", emptyPlayer]]),
    });
    deps.lastCoordTimeRef.current.set("peer", {
      wallTime: Date.now() - WORLDLINE_GAP_THRESHOLD_MS - 100,
      posT: 1.0,
    });

    handler("peer", makePhaseSpaceMsg("peer", 3.6, 10));

    const { frozenWorldLines } = useGameStore.getState();
    expect(frozenWorldLines.length).toBe(0);
  });

  it("gap なし (prevCoord 未登録、初回受信): frozen に push しない", () => {
    const deps = makeDeps("me");
    const handler = createMessageHandler(deps);

    handler("peer", makePhaseSpaceMsg("peer", 1.0, 0));

    const { players, frozenWorldLines } = useGameStore.getState();
    expect(frozenWorldLines.length).toBe(0);
    expect(players.get("peer")?.worldLine.history.length).toBe(1);
  });
});
