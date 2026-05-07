import type { MutableRefObject } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
} from "../../physics";
import { selectIsDead, useGameStore } from "../../stores/game-store";
import {
  ENERGY_MAX,
  LIGHTHOUSE_ID_PREFIX,
  MAX_WORLDLINE_HISTORY,
} from "./constants";
import { isLighthouse } from "./lighthouse";
import {
  applySnapshot,
  buildSnapshot,
  shouldPushSnapshotOnConnection,
} from "./snapshot";
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
    kind: isLighthouse(id) ? "npc" : "human",
    ownerId,
    phaseSpace,
    worldLine: appendWorldLine(
      createWorldLine(MAX_WORLDLINE_HISTORY),
      phaseSpace,
    ),
    color,
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
    staleFrozenIds: new Set(),
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

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef(), makeLastUpdateRef());

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

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef(), makeLastUpdateRef());

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

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef(), makeLastUpdateRef());

    const peer = useGameStore.getState().players.get("peer");
    expect(peer?.phaseSpace.pos.t).toBe(5.0);
    expect(peer?.phaseSpace.pos.x).toBe(100);
  });

  it("displayNames は local と snapshot を merge (snapshot 側で上書き、local-only エントリは保持)", () => {
    const myId = "me";
    // local: reconnection 前に残存していた旧 peerId → name のマップ
    useGameStore.setState({
      displayNames: new Map([
        ["old-peer", "Alice"],
        ["peer", "OldPeerName"],
      ]),
    });

    // snapshot: host から受信、"peer" の name は更新される、"old-peer" は含まれない
    const msg: SnapshotMsg = {
      ...makeSnapshot([
        { id: "me", posT: 1.0 },
        { id: "peer", posT: 1.0 },
      ]),
      displayNames: { peer: "Peer", me: "Me" },
    };

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef(), makeLastUpdateRef());

    const { displayNames } = useGameStore.getState();
    // snapshot 側で上書き
    expect(displayNames.get("peer")).toBe("Peer");
    expect(displayNames.get("me")).toBe("Me");
    // local-only エントリは残存 (killLog に残っている旧 peer の逆引き用)
    expect(displayNames.get("old-peer")).toBe("Alice");
  });

  it("Stage 1: migration path で snapshot-only の kill entry が union-merge される (firedForUi=false で追加)", () => {
    const myId = "me";
    useGameStore.setState({
      players: new Map([
        ["me", makePlayer("me", 5.0)],
        ["victim", makePlayer("victim", 5.0)],
      ]),
      killLog: [],
      respawnLog: [],
    });

    const msg: SnapshotMsg = {
      ...makeSnapshot([
        { id: "me", posT: 5.0 },
        { id: "victim", posT: 5.0 },
      ]),
      killLog: [
        {
          victimId: "victim",
          killerId: "me",
          hitPos: { t: 3.0, x: 0, y: 0, z: 0 },
          wallTime: 1000,
          victimName: "Victim",
          victimColor: "#fff",
          firedForUi: true,
          firedImageCells: ["0,0"], // beacon holder 側では past-cone 到達済み
        },
      ],
    };

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef(), makeLastUpdateRef());

    const { killLog } = useGameStore.getState();
    expect(killLog).toHaveLength(1);
    expect(killLog[0].victimId).toBe("victim");
    // 受信側観測者の past-cone 到達前なので firedForUi=false で追加される
    expect(killLog[0].firedForUi).toBe(false);
  });

  it("Stage 1: migration path で local 先行の kill entry は保持される (snapshot replace で消えない)", () => {
    const myId = "me";
    useGameStore.setState({
      players: new Map([
        ["me", makePlayer("me", 5.0)],
        ["victim", makePlayer("victim", 5.0)],
      ]),
      killLog: [
        {
          victimId: "victim",
          killerId: "me",
          hitPos: { t: 3.0, x: 0, y: 0, z: 0 },
          wallTime: 2000,
          victimName: "Victim",
          victimColor: "#fff",
          firedForUi: true,
          firedImageCells: ["0,0"],
        },
      ],
      respawnLog: [],
    });

    // snapshot: beacon holder にはまだ local の kill が到達していない (空)
    const msg = makeSnapshot([
      { id: "me", posT: 5.0 },
      { id: "victim", posT: 5.0 },
    ]);

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef(), makeLastUpdateRef());

    const { killLog } = useGameStore.getState();
    expect(killLog).toHaveLength(1);
    expect(killLog[0].wallTime).toBe(2000);
    // local の firedForUi=true 状態は保持される (UI 二重発火防止)
    expect(killLog[0].firedForUi).toBe(true);
  });

  it("Stage 1: migration path で missed respawn の自動救済 (isDead 張り付きが snapshot の respawn entry 流入で解消)", () => {
    const myId = "observer";
    // 2026-05-04 isDead 二重管理解消: 旧版は `deadVictim.isDead=true` を explicit 設定して
    // 「local が isDead=true 貼り付き」 を再現していたが、 isDead は killLog/respawnLog から
    // derive 唯一化したため、 `killLog に entry あり + respawnLog 空` で同じ状態が達成される。
    useGameStore.setState({
      players: new Map([
        ["observer", makePlayer("observer", 5.0)],
        ["victim", makePlayer("victim", 5.0)],
      ]),
      killLog: [
        {
          victimId: "victim",
          killerId: "observer",
          hitPos: { t: 3.0, x: 0, y: 0, z: 0 },
          wallTime: 1000,
          victimName: "Victim",
          victimColor: "#fff",
          firedForUi: true,
          firedImageCells: ["0,0"],
        },
      ],
      respawnLog: [], // respawn entry を local は取り逃している
    });

    // snapshot: beacon holder は respawn を受信していて respawnLog に含む
    const msg: SnapshotMsg = {
      ...makeSnapshot([
        { id: "observer", posT: 5.0 },
        { id: "victim", posT: 5.0 },
      ]),
      killLog: [
        {
          victimId: "victim",
          killerId: "observer",
          hitPos: { t: 3.0, x: 0, y: 0, z: 0 },
          wallTime: 1000,
          victimName: "Victim",
          victimColor: "#fff",
          firedForUi: true,
          firedImageCells: ["0,0"],
        },
      ],
      respawnLog: [
        {
          playerId: "victim",
          position: { t: 4.0, x: 0, y: 0, z: 0 },
          wallTime: 2000, // kill (1000) より後
        },
      ],
    };
    // snapshot の victim entry は isDead=false (beacon holder は respawn 済と認識)
    const victimEntry = msg.players.find((p) => p.id === "victim");
    if (victimEntry) victimEntry.isDead = false;

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef(), makeLastUpdateRef());

    const state = useGameStore.getState();
    expect(state.respawnLog).toHaveLength(1);
    expect(state.respawnLog[0].playerId).toBe("victim");
    // isDead が merged log から再導出され false に復帰 (= selectIsDead で確認)
    expect(selectIsDead(state, "victim")).toBe(false);
  });

  it("Stage 1.5: client の snapshot を BH が受信 → BH の missed kill が client 側観測から union-merge 流入", () => {
    // 状況: BH は victim の kill event を message 取りこぼしで保持していない。
    //       client (alice) は victim の kill を目撃して killLog に保持。
    //       Stage 1.5 で alice が自分の局所観測 snapshot を BH に送信 → BH が merge して
    //       他 client の missed kill を自動救済できる経路が開く。
    const bhId = "bh";
    useGameStore.setState({
      players: new Map([
        ["bh", makePlayer("bh", 5.0)],
        ["alice", makePlayer("alice", 5.0)],
        ["victim", makePlayer("victim", 5.0)],
      ]),
      killLog: [], // BH は kill を取り逃している
      respawnLog: [],
      scores: { bh: 0, alice: 0 },
    });

    // alice の局所観測 snapshot: victim を目撃した kill entry を保持
    const aliceSnapshot: SnapshotMsg = {
      ...makeSnapshot([
        { id: "bh", posT: 5.0 },
        { id: "alice", posT: 5.0 },
        { id: "victim", posT: 5.0 },
      ]),
      killLog: [
        {
          victimId: "victim",
          killerId: "alice",
          hitPos: { t: 3.0, x: 0, y: 0, z: 0 },
          wallTime: 1500,
          victimName: "Victim",
          victimColor: "#fff",
          firedForUi: true,
          firedImageCells: ["0,0"], // alice 側では発火済
        },
      ],
      scores: { alice: 1 }, // alice 観測者視点の scores (BH が上書きされないことも確認)
    };
    // alice の view では victim は isDead (alice が殺した直後)
    const victimEntry = aliceSnapshot.players.find((p) => p.id === "victim");
    if (victimEntry) victimEntry.isDead = true;

    // BH が alice の snapshot を受信 (Stage 1.5 で新たに開く経路)
    applySnapshot(bhId, aliceSnapshot, () => "#fff", makeLastUpdateRef(), makeLastUpdateRef());

    const state = useGameStore.getState();
    // BH の killLog に alice 観測の kill が union-merge される
    expect(state.killLog).toHaveLength(1);
    expect(state.killLog[0].victimId).toBe("victim");
    expect(state.killLog[0].killerId).toBe("alice");
    // receiver (BH) 側 past-cone 未到達なので firedForUi=false で追加
    expect(state.killLog[0].firedForUi).toBe(false);
    // victim の isDead は merged log から再導出され true になる (BH も victim を dead と認識)
    expect(selectIsDead(state, "victim")).toBe(true);
    // scores は BH の観測相対 (alice の観測の 1 で上書きされず、BH 初期値 0 のまま)。
    // 実際には次 game tick で firePendingKillEvents が BH の past-cone 到達で alice に +1 する。
    expect(state.scores.bh).toBe(0);
    expect(state.scores.alice).toBe(0);
  });

  it("Stage 1: migration path で local-only player は保護される (snapshot に含まれない entry も残る)", () => {
    const myId = "me";
    // local: relay 経由で "late-joiner" を受信済だが、beacon holder の snapshot build
    // は late-joiner が players に入る直前の state で作られた、という race を再現
    useGameStore.setState({
      players: new Map([
        ["me", makePlayer("me", 5.0)],
        ["late-joiner", makePlayer("late-joiner", 4.5, 77)],
      ]),
    });

    // snapshot: late-joiner は含まれていない
    const msg = makeSnapshot([{ id: "me", posT: 5.0 }]);

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef(), makeLastUpdateRef());

    const { players } = useGameStore.getState();
    // local-only だった late-joiner は保護されて残る (5 秒消えてから復帰の blip 防止)
    expect(players.has("late-joiner")).toBe(true);
    expect(players.get("late-joiner")?.phaseSpace.pos.t).toBe(4.5);
    expect(players.get("late-joiner")?.phaseSpace.pos.x).toBe(77);
  });

  it("Stage 1: migration path で scores は local を保持 (観測者相対性を破壊しない)", () => {
    const myId = "me";
    useGameStore.setState({
      players: new Map([["me", makePlayer("me", 5.0)]]),
      scores: { me: 3 }, // local 観測者の視点で 3 kill
    });

    const msg: SnapshotMsg = {
      ...makeSnapshot([{ id: "me", posT: 5.0 }]),
      scores: { me: 0, other: 5 }, // host 観測者の視点は別
    };

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef(), makeLastUpdateRef());

    const { scores } = useGameStore.getState();
    // local 観測者の scores は上書きされない
    expect(scores.me).toBe(3);
    expect(scores.other).toBeUndefined();
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

    applySnapshot(myId, msg, () => "#fff", makeLastUpdateRef(), makeLastUpdateRef());

    const peer = useGameStore.getState().players.get("peer");
    expect(peer?.phaseSpace.pos.t).toBe(5.0);
    expect(peer?.phaseSpace.pos.x).toBe(999);
  });
});

describe("buildSnapshot", () => {
  beforeEach(() => {
    resetStore();
  });

  it("isBeaconHolder=true: LH ownerId は caller に強制 rewrite (migration 安全弁)", () => {
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

    const msg = buildSnapshot(newHostId, true);

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

  it("Stage 1.5: isBeaconHolder=false (client 送信) は LH ownerId を preserve、自分を主張しない", () => {
    const lhId = `${LIGHTHOUSE_ID_PREFIX}1`;
    const bhId = "bh-legit";
    const clientId = "client-a";
    useGameStore.setState({
      players: new Map([
        // LH の正当な owner は BH
        [lhId, makePlayer(lhId, 1.0, 0, "#ff0", bhId)],
        [bhId, makePlayer(bhId, 1.0, 0, "#fff")],
        [clientId, makePlayer(clientId, 1.0, 0, "#0ff")],
      ]),
    });

    // client が自分の局所観測を Stage 1.5 で送る (isBeaconHolder=false)
    const msg = buildSnapshot(clientId, false);

    const lhEntry = msg.players.find((p) => p.id === lhId);
    expect(lhEntry).toBeDefined();
    // LH ownerId は正当な BH を preserve、client の id にしない。
    // (client が BH 権限を主張するフェイクを送ると BH merge 時に LH 所有権汚染 →
    //  BH の LH AI 沈黙という catastrophic bug になる)
    expect(lhEntry?.ownerId).toBe(bhId);
    expect(lhEntry?.ownerId).not.toBe(clientId);
  });

  it("staleFrozenIds の peer は snapshot.players から除外 (= 「永遠凍結」 bug 治癒)", () => {
    const myId = "host";
    const stalePeer = "stale-disconnected";
    const alivePeer = "alive";
    useGameStore.setState({
      players: new Map([
        [myId, makePlayer(myId, 100.0, 0, "#fff")],
        // stale な peer は古い pos.t を持つ (= disconnect 時の値で停止)
        [stalePeer, makePlayer(stalePeer, 50.0, 0, "#888")],
        [alivePeer, makePlayer(alivePeer, 99.0, 0, "#0f0")],
      ]),
      // host は stale-disconnected を 5s 以上沈黙で stale 判定済
      staleFrozenIds: new Set([stalePeer]),
    });

    const msg = buildSnapshot(myId, true);

    // stale peer は snapshot から除外
    expect(msg.players.find((p) => p.id === stalePeer)).toBeUndefined();
    // 生きてる peer / 自機は含まれる
    expect(msg.players.find((p) => p.id === myId)).toBeDefined();
    expect(msg.players.find((p) => p.id === alivePeer)).toBeDefined();
    // hostTime = (min + max) / 2 = (99 + 100) / 2 = 99.5 (= stale 50 を除外して計算)。
    // 旧仕様 (max only) では 100 だったが 2026-04-28 から中間値 (= 後 join client 永遠
    // 凍結 bug 治癒)。
    expect(msg.hostTime).toBe(99.5);
  });

  it("staleFrozenIds の peer が hostTime に影響しない (= stale が高 pos.t でも除外)", () => {
    const myId = "host";
    const stalePeer = "stale-with-high-t";
    useGameStore.setState({
      players: new Map([
        [myId, makePlayer(myId, 30.0, 0, "#fff")],
        // stale peer は disconnect 前に高 γ で走り続けて高い pos.t に居た
        [stalePeer, makePlayer(stalePeer, 200.0, 0, "#888")],
      ]),
      staleFrozenIds: new Set([stalePeer]),
    });

    const msg = buildSnapshot(myId, true);

    // hostTime = 30 (stale の 200 を採用しない)。 さもないと新 joiner が
    // 異常に未来側 (t=200) で spawn → 多数 player 過去光円錐内 → freeze 連鎖。
    expect(msg.hostTime).toBe(30.0);
    expect(msg.players.find((p) => p.id === stalePeer)).toBeUndefined();
  });
});

describe("buildSnapshot / applySnapshot heading / alpha round-trip", () => {
  beforeEach(() => {
    useGameStore.setState({
      players: new Map(),
      frozenWorldLines: [],
      lasers: [],
      scores: {},
      killLog: [],
      respawnLog: [],
      displayNames: new Map(),
    });
  });

  it("非 default の heading / alpha を build → wire に同梱 → apply で復元", async () => {
    const { yawToQuat } = await import("../../physics");
    const heading = yawToQuat(Math.PI / 3);
    const alpha = createVector4(0.01, 0.2, 0.1, 0);
    const myId = "me";
    const peerId = "peer";
    const mePs = createPhaseSpace(
      createVector4(5, 1, 2, 0),
      createVector3(0.3, 0, 0),
      heading,
      alpha,
    );
    useGameStore.setState({
      players: new Map([
        [myId, { ...makePlayer(myId, 5, 1), phaseSpace: mePs }],
        [peerId, makePlayer(peerId, 4, 3, "#f00")],
      ]),
    });

    const msg = buildSnapshot(myId, true);
    const myEntry = msg.players.find((p) => p.id === myId);
    expect(myEntry?.phaseSpace.heading).toBeDefined();
    expect(myEntry?.phaseSpace.heading?.w).toBeCloseTo(heading.w, 9);
    expect(myEntry?.phaseSpace.heading?.z).toBeCloseTo(heading.z, 9);
    expect(myEntry?.phaseSpace.alpha).toBeDefined();
    expect(myEntry?.phaseSpace.alpha?.x).toBeCloseTo(0.2, 9);

    // default な peer は wire から省略 (帯域節約)
    const peerEntry = msg.players.find((p) => p.id === peerId);
    expect(peerEntry?.phaseSpace.heading).toBeUndefined();
    expect(peerEntry?.phaseSpace.alpha).toBeUndefined();

    // 新規 join 側で applySnapshot して state が復元されるか
    const clientId = "newjoiner";
    useGameStore.setState({ players: new Map() });
    applySnapshot(clientId, msg, () => "#fff", { current: new Map() }, { current: new Map() });
    const rehydratedMe = useGameStore.getState().players.get(myId);
    expect(rehydratedMe?.phaseSpace.heading.w).toBeCloseTo(heading.w, 9);
    expect(rehydratedMe?.phaseSpace.alpha.x).toBeCloseTo(0.2, 9);
  });

  it("旧 build 送信 (heading / alpha 欠落 wire): apply 側で identity / zero 補完", () => {
    // makeSnapshot helper は heading / alpha を吐かない旧形式 → backward compat 経路
    const msg = makeSnapshot([
      { id: "a", posT: 1 },
      { id: "b", posT: 2 },
    ]);
    useGameStore.setState({ players: new Map() });
    applySnapshot("me", msg, () => "#fff", { current: new Map() }, { current: new Map() });
    const a = useGameStore.getState().players.get("a");
    expect(a?.phaseSpace.heading).toEqual({ w: 1, x: 0, y: 0, z: 0 });
    expect(a?.phaseSpace.alpha).toEqual({ t: 0, x: 0, y: 0, z: 0 });
  });
});

// ===========================================================================
// shouldPushSnapshotOnConnection — host push 4 case verify
// (= plans/2026-05-06-snapshot-rejoin-host-push.md §3 V1 scenario trace)
// ===========================================================================
describe("shouldPushSnapshotOnConnection", () => {
  const THRESHOLD_MS = 10000;
  const NOW_MS = 1_000_000_000_000;

  it("case 1: 新規 joiner (= isNewJoiner=true) は lastSeen に依らず push する", () => {
    // lastSeen は新規 joiner では meaningless (= まだ broadcast 受けていない)
    expect(
      shouldPushSnapshotOnConnection(true, undefined, NOW_MS, THRESHOLD_MS),
    ).toBe(true);
    // 仮に lastSeen があっても (= migration 直後等の edge) 新規 joiner 扱いは push
    expect(
      shouldPushSnapshotOnConnection(true, NOW_MS - 100, NOW_MS, THRESHOLD_MS),
    ).toBe(true);
  });

  it("case 2: 短期 disconnect (= 既存 peer ∧ lastSeen 新しい) は skip する", () => {
    // network blip 1 sec — broadcast で event log self-maintained を仮定、 spurious
    // push 抑制が正しい
    expect(
      shouldPushSnapshotOnConnection(false, NOW_MS - 1000, NOW_MS, THRESHOLD_MS),
    ).toBe(false);
    // 閾値ピッタリ (= 10000 ms) は skip 側 (= 境界包含、 「>」 strict)
    expect(
      shouldPushSnapshotOnConnection(false, NOW_MS - 10000, NOW_MS, THRESHOLD_MS),
    ).toBe(false);
  });

  it("case 3: 長期 disconnect (= mobile suspend、 wake-from-suspend) は push する", () => {
    // 閾値超過 1 ms 超えで stale reconnect 例外発動、 missed event sync のため push
    expect(
      shouldPushSnapshotOnConnection(false, NOW_MS - 10001, NOW_MS, THRESHOLD_MS),
    ).toBe(true);
    // 数分の suspend
    expect(
      shouldPushSnapshotOnConnection(
        false,
        NOW_MS - 5 * 60 * 1000,
        NOW_MS,
        THRESHOLD_MS,
      ),
    ).toBe(true);
    // 12.5 hour mobile suspend (= Bug 14 live capture シナリオ)
    expect(
      shouldPushSnapshotOnConnection(
        false,
        NOW_MS - 12.5 * 3600 * 1000,
        NOW_MS,
        THRESHOLD_MS,
      ),
    ).toBe(true);
  });

  it("case 4: migration (= player entry 削除 + 再登録) は case 1 と同等で push", () => {
    // migration 経路では player entry が削除されるため再 connect 時点で
    // !players.has(newId) → isNewJoiner=true として呼ばれる、 これは case 1 同等
    expect(
      shouldPushSnapshotOnConnection(true, undefined, NOW_MS, THRESHOLD_MS),
    ).toBe(true);
  });

  it("既存 peer ∧ lastSeen 未記録 (= undefined) は long-gap として push する", () => {
    // lastUpdateTimeRef に entry 無い (= 通常起きないが、 race で player entry は
    // あるが lastUpdateTimeRef 未 set の edge case)。 undefined → 0 fallback で
    // now - 0 = NOW_MS が threshold を遥かに超え、 push 側に倒れる安全寄りの挙動
    expect(
      shouldPushSnapshotOnConnection(false, undefined, NOW_MS, THRESHOLD_MS),
    ).toBe(true);
  });

  it("default threshold (= LONG_GAP_RESYNC_THRESHOLD_MS=10000) も同じ挙動", () => {
    // signature の 4 番目引数 default を省略しても constant が effective
    expect(shouldPushSnapshotOnConnection(false, NOW_MS - 5000, NOW_MS)).toBe(
      false,
    );
    expect(shouldPushSnapshotOnConnection(false, NOW_MS - 15000, NOW_MS)).toBe(
      true,
    );
  });
});
