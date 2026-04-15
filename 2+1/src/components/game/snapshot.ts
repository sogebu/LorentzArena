import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
  type PhaseSpace,
} from "../../physics";
import { useGameStore } from "../../stores/game-store";
import { MAX_WORLDLINE_HISTORY, SPAWN_RANGE } from "./constants";
import { computeSpawnCoordTime } from "./respawnTime";
import type { RelativisticPlayer } from "./types";

/**
 * Authority 解体 Stage F: 新規 join peer 1 人に送る state 一式を組み立てる。
 *
 * beacon holder (= host) が `peerManager.sendTo(newPeerId, buildSnapshot(myId))`
 * で送る。既存 peer には送らない (彼らの state は event log から自己維持)。
 */
export const buildSnapshot = (myId: string) => {
  const s = useGameStore.getState();
  // 新 joiner のスポーン時刻は「宇宙の最新時刻」= 全プレイヤーの .pos.t の max。
  // beacon holder が高 γ で座標時間が遅れている / ghosting 等でも正しい時刻が取れる。
  // `myId` は将来の用途のため引数に残すが、現状は players Map 全体から導出する。
  void myId;
  const hostTime = computeSpawnCoordTime(s.players);

  const players: Array<{
    id: string;
    ownerId: string;
    color: string;
    displayName?: string;
    isDead: boolean;
    phaseSpace: {
      pos: { t: number; x: number; y: number; z: number };
      u: { x: number; y: number; z: number };
    };
    worldLineHistory: Array<{
      pos: { t: number; x: number; y: number; z: number };
      u: { x: number; y: number; z: number };
    }>;
    worldLineOrigin: {
      pos: { t: number; x: number; y: number; z: number };
      u: { x: number; y: number; z: number };
    } | null;
  }> = [];

  for (const [, p] of s.players) {
    players.push({
      id: p.id,
      ownerId: p.ownerId,
      color: p.color,
      displayName: p.displayName,
      isDead: p.isDead,
      phaseSpace: {
        pos: { t: p.phaseSpace.pos.t, x: p.phaseSpace.pos.x, y: p.phaseSpace.pos.y, z: p.phaseSpace.pos.z },
        u: { x: p.phaseSpace.u.x, y: p.phaseSpace.u.y, z: p.phaseSpace.u.z },
      },
      worldLineHistory: p.worldLine.history.map((ps: PhaseSpace) => ({
        pos: { t: ps.pos.t, x: ps.pos.x, y: ps.pos.y, z: ps.pos.z },
        u: { x: ps.u.x, y: ps.u.y, z: ps.u.z },
      })),
      worldLineOrigin: p.worldLine.origin
        ? {
            pos: {
              t: p.worldLine.origin.pos.t,
              x: p.worldLine.origin.pos.x,
              y: p.worldLine.origin.pos.y,
              z: p.worldLine.origin.pos.z,
            },
            u: {
              x: p.worldLine.origin.u.x,
              y: p.worldLine.origin.u.y,
              z: p.worldLine.origin.u.z,
            },
          }
        : null,
    });
  }

  return {
    type: "snapshot" as const,
    hostTime,
    scores: { ...s.scores },
    displayNames: Object.fromEntries(s.displayNames),
    killLog: s.killLog.map((e) => ({ ...e })),
    respawnLog: s.respawnLog.map((e) => ({ ...e })),
    players,
  };
};

type SnapshotMsg = ReturnType<typeof buildSnapshot>;

/**
 * 新規 join 側が受信した snapshot から store を初期化する。syncTime の処理を
 * 置き換える: 自機の OFFSET 起点、invincibility 起点 (respawnLog)、他プレイヤーの
 * 世界線履歴、scores / displayNames / event logs を一気に導入する。
 */
export const applySnapshot = (
  myId: string,
  msg: SnapshotMsg,
  getPlayerColor: (id: string) => string,
  lastUpdateTimeRef: React.MutableRefObject<Map<string, number>>,
): void => {
  const store = useGameStore.getState();

  // Rehydrate players (me を含む全員)
  const nextPlayers = new Map<string, RelativisticPlayer>();
  for (const sp of msg.players) {
    const phaseSpace = createPhaseSpace(
      createVector4(sp.phaseSpace.pos.t, sp.phaseSpace.pos.x, sp.phaseSpace.pos.y, sp.phaseSpace.pos.z),
      createVector3(sp.phaseSpace.u.x, sp.phaseSpace.u.y, sp.phaseSpace.u.z),
    );
    const origin = sp.worldLineOrigin
      ? createPhaseSpace(
          createVector4(sp.worldLineOrigin.pos.t, sp.worldLineOrigin.pos.x, sp.worldLineOrigin.pos.y, sp.worldLineOrigin.pos.z),
          createVector3(sp.worldLineOrigin.u.x, sp.worldLineOrigin.u.y, sp.worldLineOrigin.u.z),
        )
      : null;
    let wl = createWorldLine(MAX_WORLDLINE_HISTORY, origin);
    for (const h of sp.worldLineHistory) {
      const ps = createPhaseSpace(
        createVector4(h.pos.t, h.pos.x, h.pos.y, h.pos.z),
        createVector3(h.u.x, h.u.y, h.u.z),
      );
      wl = appendWorldLine(wl, ps);
    }
    nextPlayers.set(sp.id, {
      id: sp.id,
      ownerId: sp.ownerId,
      phaseSpace,
      worldLine: wl,
      color: sp.color,
      isDead: sp.isDead,
      displayName: sp.displayName,
    });
    lastUpdateTimeRef.current.set(sp.id, Date.now());
  }

  // 自機が snapshot に含まれていない場合 (新規 join の一般ケース) は、
  // 「宇宙の最新時刻」(= snapshot 送信時点で host が算出した最大 .pos.t) で
  // 自前の spawn を作る。
  if (!nextPlayers.has(myId)) {
    const spawnX = Math.random() * SPAWN_RANGE;
    const spawnY = Math.random() * SPAWN_RANGE;
    const phaseSpace = createPhaseSpace(
      createVector4(msg.hostTime, spawnX, spawnY, 0),
      createVector3(0, 0, 0),
    );
    let wl = createWorldLine(MAX_WORLDLINE_HISTORY);
    wl = appendWorldLine(wl, phaseSpace);
    nextPlayers.set(myId, {
      id: myId,
      ownerId: myId,
      phaseSpace,
      worldLine: wl,
      color: getPlayerColor(myId),
      isDead: false,
    });
  }

  // displayNames / scores
  for (const [id, name] of Object.entries(msg.displayNames)) {
    store.displayNames.set(id, name);
  }

  useGameStore.setState({
    players: nextPlayers,
    scores: { ...msg.scores },
    killLog: msg.killLog.map((e) => ({ ...e })),
    respawnLog: msg.respawnLog.map((e) => ({ ...e })),
  });

  // 初回 spawn = 初回 respawn として respawnLog に entry 追加 (invincibility 起点)
  // snapshot.respawnLog に既に自分の entry が含まれている場合は追加しない
  const haveMyRespawn = msg.respawnLog.some((e) => e.playerId === myId);
  if (!haveMyRespawn) {
    const me = nextPlayers.get(myId);
    if (me) {
      useGameStore.setState((state) => ({
        respawnLog: [
          ...state.respawnLog,
          {
            playerId: myId,
            position: {
              t: me.phaseSpace.pos.t,
              x: me.phaseSpace.pos.x,
              y: me.phaseSpace.pos.y,
              z: 0,
            },
            wallTime: Date.now(),
          },
        ],
        pendingSpawnEvents: [
          ...state.pendingSpawnEvents,
          {
            id: `spawn-${myId}-${Date.now()}`,
            playerId: myId,
            pos: {
              t: me.phaseSpace.pos.t,
              x: me.phaseSpace.pos.x,
              y: me.phaseSpace.pos.y,
              z: 0,
            },
            color: me.color,
          },
        ],
      }));
    }
  }
};
