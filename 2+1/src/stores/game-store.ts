import { create } from "zustand";
import { getVelocity4 } from "../physics";
import {
  INVINCIBILITY_DURATION,
  MAX_DEBRIS,
  MAX_FROZEN_WORLDLINES,
  MAX_PENDING_SPAWN_EVENTS,
} from "../components/game/constants";
import { generateExplosionParticles } from "../components/game/debris";
import { applyKill, applyRespawn } from "../components/game/killRespawn";
import { isLighthouse } from "../components/game/lighthouse";
import type {
  DeathEvent,
  DebrisRecord,
  FrozenWorldLine,
  KillEventRecord,
  KillNotification3D,
  Laser,
  PendingSpawnEvent,
  RelativisticPlayer,
  RespawnEventRecord,
  SpawnEffect,
} from "../components/game/types";

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------

type PlayersUpdater = (prev: Map<string, RelativisticPlayer>) => Map<string, RelativisticPlayer>;
type LasersUpdater = (prev: Laser[]) => Laser[];
type SpawnsUpdater = (prev: SpawnEffect[]) => SpawnEffect[];

export interface GameState {
  // --- Reactive state (components subscribe via selectors) ---
  players: Map<string, RelativisticPlayer>;
  lasers: Laser[];
  scores: Record<string, number>;
  spawns: SpawnEffect[];
  frozenWorldLines: FrozenWorldLine[];
  debrisRecords: DebrisRecord[];
  killNotification: KillNotification3D | null;
  myDeathEvent: DeathEvent | null;

  // --- Non-reactive state (read via getState() only, no re-render) ---
  processedLasers: Set<string>;
  pendingSpawnEvents: PendingSpawnEvent[];
  displayNames: Map<string, string>;
  lighthouseSpawnTime: Map<string, number>;
  /**
   * Authority 解体 Stage C: kill/respawn の authoritative event log。
   * deadPlayers / invincibleUntil / scores / pendingKillEvents はすべて
   * これらの log から派生 (selectIsDead / selectInvincibleIds /
   * selectPendingKillEvents)。
   */
  killLog: KillEventRecord[];
  respawnLog: RespawnEventRecord[];

  // --- Actions: state setters ---
  setPlayers: (updater: PlayersUpdater) => void;
  setLasers: (updater: LasersUpdater) => void;
  setScores: (scores: Record<string, number>) => void;
  setSpawns: (updater: SpawnsUpdater) => void;
  setFrozenWorldLines: (updater: (prev: FrozenWorldLine[]) => FrozenWorldLine[]) => void;
  setDebrisRecords: (updater: (prev: DebrisRecord[]) => DebrisRecord[]) => void;
  setKillNotification: (v: KillNotification3D | null) => void;
  setMyDeathEvent: (v: DeathEvent | null) => void;

  // --- Actions: game logic ---
  handleKill: (
    victimId: string,
    killerId: string,
    hitPos: { t: number; x: number; y: number; z: number },
    myId: string | null,
  ) => void;
  handleRespawn: (
    playerId: string,
    position: { t: number; x: number; y: number; z: number },
    myId: string | null,
    getPlayerColor: (id: string) => string,
  ) => void;

  // --- Actions: small helpers ---
  removePlayer: (playerId: string) => void;
  setDisplayName: (playerId: string, name: string) => void;
  addProcessedLaser: (laserId: string) => void;
  cleanupProcessedLasers: (threshold: number) => void;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useGameStore = create<GameState>()((set, get) => ({
  // Reactive
  players: new Map(),
  lasers: [],
  scores: {},
  spawns: [],
  frozenWorldLines: [],
  debrisRecords: [],
  killNotification: null,
  myDeathEvent: null,

  // Non-reactive
  processedLasers: new Set(),
  pendingSpawnEvents: [],
  displayNames: new Map(),
  lighthouseSpawnTime: new Map(),
  killLog: [],
  respawnLog: [],

  // -----------------------------------------------------------------------
  // State setters
  // -----------------------------------------------------------------------

  setPlayers: (updater) =>
    set((state) => ({ players: updater(state.players) })),

  setLasers: (updater) =>
    set((state) => ({ lasers: updater(state.lasers) })),

  setScores: (scores) => set({ scores }),

  setSpawns: (updater) =>
    set((state) => ({ spawns: updater(state.spawns) })),

  setFrozenWorldLines: (updater) =>
    set((state) => ({ frozenWorldLines: updater(state.frozenWorldLines) })),

  setDebrisRecords: (updater) =>
    set((state) => ({ debrisRecords: updater(state.debrisRecords) })),

  setKillNotification: (v) => set({ killNotification: v }),
  setMyDeathEvent: (v) => set({ myDeathEvent: v }),

  // -----------------------------------------------------------------------
  // handleKill — absorbs RelativisticGame.tsx L155-208
  // -----------------------------------------------------------------------

  handleKill: (victimId, killerId, hitPos, myId) => {
    const state = get();
    const victim = state.players.get(victimId);
    if (!victim) return;
    // Guard: already dead (derive from killLog vs respawnLog)
    if (selectIsDead(state, victimId)) return;

    // Freeze world line
    const frozen: FrozenWorldLine = {
      worldLine: victim.worldLine,
      color: victim.color,
    };

    // Generate debris
    const explosionParticles = generateExplosionParticles(victim.phaseSpace.u);
    const newDebris: DebrisRecord = {
      deathPos: hitPos,
      particles: explosionParticles,
      color: victim.color,
    };

    const victimName = isLighthouse(victimId)
      ? "Lighthouse"
      : (victim.displayName ?? victimId.slice(0, 6));

    // Stage C: authoritative event log entry (now source of truth for
    // UI-pending kill rendering and score derivation)
    const killLogEntry: KillEventRecord = {
      victimId,
      killerId,
      hitPos,
      wallTime: Date.now(),
      victimName,
      victimColor: victim.color,
      firedForUi: false,
    };

    // Batch update (arrays must go through set() to survive state transitions)
    set({
      players: applyKill(state.players, victimId),
      frozenWorldLines: [...state.frozenWorldLines, frozen].slice(-MAX_FROZEN_WORLDLINES),
      debrisRecords: [...state.debrisRecords, newDebris].slice(-MAX_DEBRIS),
      killLog: [...state.killLog, killLogEntry],
      myDeathEvent:
        victimId === myId
          ? { pos: victim.phaseSpace.pos, u: getVelocity4(victim.phaseSpace.u) }
          : state.myDeathEvent,
    });
  },

  // -----------------------------------------------------------------------
  // handleRespawn — absorbs RelativisticGame.tsx L212-263
  // -----------------------------------------------------------------------

  handleRespawn: (playerId, position, myId, getPlayerColor) => {
    const state = get();

    // LH spawn time はゲームルール上 respawn とは別管理 (LH fire cooldown の起点)
    if (isLighthouse(playerId)) {
      state.lighthouseSpawnTime.set(playerId, Date.now());
    }

    // Spawn effect
    const spawningPlayer = state.players.get(playerId);
    const color = spawningPlayer?.color ?? getPlayerColor(playerId);
    const now = Date.now();

    // Stage C: authoritative event log entry (source of truth for
    // deadPlayers derivation + invincibility timing)
    const respawnLogEntry: RespawnEventRecord = {
      playerId,
      position,
      wallTime: now,
    };

    if (playerId === myId) {
      // Self spawn: immediate spawn effect
      set({
        players: applyRespawn(state.players, playerId, position),
        myDeathEvent: null,
        spawns: [
          ...state.spawns,
          { id: `spawn-${playerId}-${now}`, pos: position, color, startTime: now },
        ],
        respawnLog: [...state.respawnLog, respawnLogEntry],
      });
    } else {
      // Other player: causal delay via pending events
      set({
        players: applyRespawn(state.players, playerId, position),
        pendingSpawnEvents: [
          ...state.pendingSpawnEvents,
          { id: `spawn-${playerId}-${now}`, playerId, pos: position, color },
        ].slice(-MAX_PENDING_SPAWN_EVENTS),
        respawnLog: [...state.respawnLog, respawnLogEntry],
      });
    }
  },

  // -----------------------------------------------------------------------
  // Small helpers
  // -----------------------------------------------------------------------

  removePlayer: (playerId) =>
    set((state) => {
      const next = new Map(state.players);
      next.delete(playerId);
      return { players: next };
    }),

  setDisplayName: (playerId, name) => {
    get().displayNames.set(playerId, name);
  },

  addProcessedLaser: (laserId) => {
    get().processedLasers.add(laserId);
  },

  cleanupProcessedLasers: (threshold) => {
    const state = get();
    if (state.processedLasers.size > threshold) {
      state.processedLasers.clear();
    }
  },
}));

// ---------------------------------------------------------------------------
// Selectors (Stage C: event log を source of truth に)
// ---------------------------------------------------------------------------

type LogState = Pick<GameState, "killLog" | "respawnLog">;

/** 各プレイヤーの latest kill wallTime。victimId ごとに最大値。 */
const latestKillTime = (state: LogState): Map<string, number> => {
  const m = new Map<string, number>();
  for (const e of state.killLog) {
    const prev = m.get(e.victimId);
    if (prev === undefined || e.wallTime > prev) m.set(e.victimId, e.wallTime);
  }
  return m;
};

/** 各プレイヤーの latest respawn wallTime。playerId ごとに最大値。 */
const latestRespawnTime = (state: LogState): Map<string, number> => {
  const m = new Map<string, number>();
  for (const e of state.respawnLog) {
    const prev = m.get(e.playerId);
    if (prev === undefined || e.wallTime > prev) m.set(e.playerId, e.wallTime);
  }
  return m;
};

/** プレイヤーが現在死んでいるか (latest kill > latest respawn)。 */
export const selectIsDead = (state: LogState, playerId: string): boolean => {
  const kills = latestKillTime(state).get(playerId);
  if (kills === undefined) return false;
  const resp = latestRespawnTime(state).get(playerId) ?? -Infinity;
  return kills > resp;
};

/** 現在死んでいる全プレイヤー ID。hit detection の dead フィルタ用。 */
export const selectDeadPlayerIds = (state: LogState): Set<string> => {
  const lastKill = latestKillTime(state);
  const lastResp = latestRespawnTime(state);
  const dead = new Set<string>();
  for (const [id, kTime] of lastKill) {
    const rTime = lastResp.get(id) ?? -Infinity;
    if (kTime > rTime) dead.add(id);
  }
  return dead;
};

/**
 * プレイヤーの invincibility 終了 wallTime。respawn が無ければ 0 (= never)。
 * LH は invincibility 対象外なので -Infinity。
 */
export const selectInvincibleUntil = (state: LogState, playerId: string): number => {
  if (isLighthouse(playerId)) return -Infinity;
  const rTime = latestRespawnTime(state).get(playerId);
  return rTime === undefined ? 0 : rTime + INVINCIBILITY_DURATION;
};

/** 現在無敵中の全プレイヤー ID。hit detection の invincible フィルタ用。 */
export const selectInvincibleIds = (state: LogState, now: number): Set<string> => {
  const ids = new Set<string>();
  for (const [id, rTime] of latestRespawnTime(state)) {
    if (isLighthouse(id)) continue;
    if (rTime + INVINCIBILITY_DURATION > now) ids.add(id);
  }
  return ids;
};

/** UI 反映待ちの kill events (firedForUi === false)。過去光円錐到達判定で消化される。 */
export const selectPendingKillEvents = (state: LogState): KillEventRecord[] =>
  state.killLog.filter((e) => !e.firedForUi);
