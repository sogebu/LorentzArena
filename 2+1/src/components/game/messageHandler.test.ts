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
import { ENERGY_MAX, MAX_WORLDLINE_HISTORY, WORLDLINE_GAP_THRESHOLD_MS } from "./constants";
import { isLighthouse } from "./lighthouse";
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
    kind: isLighthouse(id) ? "npc" : "human",
    ownerId: id,
    phaseSpace,
    worldLine: appendWorldLine(
      createWorldLine(MAX_WORLDLINE_HISTORY),
      phaseSpace,
    ),
    color,
    energy: ENERGY_MAX,
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
  lastWitnessTimeRef: MutableRefObject<Map<string, number>>;
  recoverStale: (playerId: string) => void;
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
    lastWitnessTimeRef: { current: new Map() },
    recoverStale: vi.fn(),
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

describe("messageHandler phaseSpace heading / alpha (backward compat)", () => {
  beforeEach(() => {
    resetStore();
  });

  it("旧 build 送信 (heading / alpha 欠落): 受信側は identity / zero で補完", () => {
    const deps = makeDeps("me");
    const handler = createMessageHandler(deps);
    handler("peer", makePhaseSpaceMsg("peer", 1.0, 0));
    const peer = useGameStore.getState().players.get("peer");
    expect(peer).toBeDefined();
    expect(peer?.phaseSpace.heading).toEqual({ w: 1, x: 0, y: 0, z: 0 });
    expect(peer?.phaseSpace.alpha).toEqual({ t: 0, x: 0, y: 0, z: 0 });
  });

  it("新 build 送信 (heading / alpha 同梱): 受信側は値を保持", () => {
    const deps = makeDeps("me");
    const handler = createMessageHandler(deps);
    handler("peer", {
      type: "phaseSpace" as const,
      senderId: "peer",
      position: { t: 1.0, x: 0, y: 0, z: 0 },
      velocity: { x: 0.3, y: 0.0, z: 0 },
      heading: { w: 0.7071, x: 0, y: 0, z: 0.7071 }, // yaw = π/2
      alpha: { t: 0.01, x: 0.5, y: 0, z: 0 },
    });
    const peer = useGameStore.getState().players.get("peer");
    expect(peer?.phaseSpace.heading.w).toBeCloseTo(0.7071, 4);
    expect(peer?.phaseSpace.heading.z).toBeCloseTo(0.7071, 4);
    expect(peer?.phaseSpace.alpha.t).toBeCloseTo(0.01, 6);
    expect(peer?.phaseSpace.alpha.x).toBeCloseTo(0.5, 6);
  });

  it("malformed heading (w が非 finite): identity に fallback", () => {
    const deps = makeDeps("me");
    const handler = createMessageHandler(deps);
    handler("peer", {
      type: "phaseSpace" as const,
      senderId: "peer",
      position: { t: 1.0, x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      heading: { w: NaN, x: 0, y: 0, z: 0 },
    });
    const peer = useGameStore.getState().players.get("peer");
    expect(peer?.phaseSpace.heading).toEqual({ w: 1, x: 0, y: 0, z: 0 });
  });
});

// Bug 14 完全治療 (2026-05-06 plan: bug14-global-active-time §2.3): selfActive flag に
// よる lastWitnessTimeRef gating の test。 lastUpdateTimeRef は unconditional 更新、
// lastWitnessTimeRef は selfActive=true のみ更新、 selfActive=undefined は旧 build 互換
// fallback で true 扱い、 が contract。
describe("messageHandler selfActive witness gating (Bug 14 plan)", () => {
  beforeEach(() => {
    resetStore();
  });

  it("selfActive=true: lastWitnessTimeRef + lastUpdateTimeRef 両方を更新", () => {
    const deps = makeDeps("me");
    const handler = createMessageHandler(deps);
    handler("peer", {
      type: "phaseSpace" as const,
      senderId: "peer",
      position: { t: 1.0, x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      selfActive: true,
    });
    expect(deps.lastUpdateTimeRef.current.has("peer")).toBe(true);
    expect(deps.lastWitnessTimeRef.current.has("peer")).toBe(true);
  });

  it("selfActive=false: lastUpdateTimeRef のみ更新、 lastWitnessTimeRef は更新しない", () => {
    const deps = makeDeps("me");
    const handler = createMessageHandler(deps);
    handler("peer", {
      type: "phaseSpace" as const,
      senderId: "peer",
      position: { t: 1.0, x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      selfActive: false,
    });
    expect(deps.lastUpdateTimeRef.current.has("peer")).toBe(true);
    expect(deps.lastWitnessTimeRef.current.has("peer")).toBe(false);
  });

  it("selfActive=undefined (旧 build 互換): fallback で active 扱い、 両方更新", () => {
    const deps = makeDeps("me");
    const handler = createMessageHandler(deps);
    handler("peer", {
      type: "phaseSpace" as const,
      senderId: "peer",
      position: { t: 1.0, x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      // selfActive 欠落 (= 旧 build broadcast)
    });
    expect(deps.lastUpdateTimeRef.current.has("peer")).toBe(true);
    expect(deps.lastWitnessTimeRef.current.has("peer")).toBe(true);
  });

  it("respawn message も selfActive で gate (= phaseSpace と対称)", () => {
    const deps = makeDeps("me");
    const handler = createMessageHandler(deps);

    // selfActive=false respawn: lastWitness 不変
    handler("peer", {
      type: "respawn" as const,
      playerId: "peer",
      position: { t: 1.0, x: 0, y: 0, z: 0 },
      selfActive: false,
    });
    expect(deps.lastUpdateTimeRef.current.has("peer")).toBe(true);
    expect(deps.lastWitnessTimeRef.current.has("peer")).toBe(false);

    // selfActive=true respawn: lastWitness 更新
    handler("peer", {
      type: "respawn" as const,
      playerId: "peer",
      position: { t: 2.0, x: 0, y: 0, z: 0 },
      selfActive: true,
    });
    expect(deps.lastWitnessTimeRef.current.has("peer")).toBe(true);
  });

  it("mutual amplification convergence: 連続 selfActive=false で lastWitness 古いまま", () => {
    const deps = makeDeps("me");
    const handler = createMessageHandler(deps);

    // T=10 active broadcast (= pre-hidden の最後の active witness)
    const t0 = Date.now();
    handler("peer", {
      type: "phaseSpace" as const,
      senderId: "peer",
      position: { t: 1.0, x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      selfActive: true,
    });
    const witnessAtActive = deps.lastWitnessTimeRef.current.get("peer");
    expect(witnessAtActive).toBeDefined();
    expect(witnessAtActive! >= t0).toBe(true);

    // 連続 selfActive=false (= hidden 後の broadcast)
    handler("peer", {
      type: "phaseSpace" as const,
      senderId: "peer",
      position: { t: 1.5, x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      selfActive: false,
    });
    handler("peer", {
      type: "phaseSpace" as const,
      senderId: "peer",
      position: { t: 2.0, x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      selfActive: false,
    });

    // lastWitness は active witness のまま、 lastUpdate は最新更新
    const witnessAfter = deps.lastWitnessTimeRef.current.get("peer");
    const updateAfter = deps.lastUpdateTimeRef.current.get("peer");
    expect(witnessAfter).toBe(witnessAtActive);
    expect(updateAfter).toBeDefined();
    expect(updateAfter! >= witnessAtActive!).toBe(true);
  });
});
