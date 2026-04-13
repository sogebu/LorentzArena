import { create } from "zustand";
import { getVelocity4 } from "../physics";
import {
  INVINCIBILITY_DURATION,
  MAX_DEBRIS,
  MAX_FROZEN_WORLDLINES,
  MAX_PENDING_KILL_EVENTS,
  MAX_PENDING_SPAWN_EVENTS,
} from "../components/game/constants";
import { generateExplosionParticles } from "../components/game/debris";
import { applyKill, applyRespawn } from "../components/game/killRespawn";
import { isLighthouse } from "../components/game/lighthouse";
import type {
  DeathEvent,
  DebrisRecord,
  FrozenWorldLine,
  KillNotification3D,
  Laser,
  PendingKillEvent,
  PendingSpawnEvent,
  RelativisticPlayer,
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
  deadPlayers: Set<string>;
  invincibleUntil: Map<string, number>;
  processedLasers: Set<string>;
  deathTimeMap: Map<string, number>;
  pendingKillEvents: PendingKillEvent[];
  pendingSpawnEvents: PendingSpawnEvent[];
  displayNames: Map<string, string>;
  lighthouseSpawnTime: Map<string, number>;

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
  deadPlayers: new Set(),
  invincibleUntil: new Map(),
  processedLasers: new Set(),
  deathTimeMap: new Map(),
  pendingKillEvents: [],
  pendingSpawnEvents: [],
  displayNames: new Map(),
  lighthouseSpawnTime: new Map(),

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

    // Freeze world line
    const frozen: FrozenWorldLine = {
      worldLine: victim.worldLine,
      color: victim.color,
      showHalfLine: victim.worldLine.origin !== null,
    };

    // Generate debris
    const explosionParticles = generateExplosionParticles(victim.phaseSpace.u);
    const newDebris: DebrisRecord = {
      deathPos: hitPos,
      particles: explosionParticles,
      color: victim.color,
    };

    // Pending kill event (for causal delay)
    const killEvent: PendingKillEvent = {
      victimId,
      killerId,
      hitPos,
      victimName: isLighthouse(victimId)
        ? "Lighthouse"
        : (state.players.get(victimId)?.displayName ?? victimId.slice(0, 6)),
      victimColor: victim.color,
    };

    // In-place mutations on shared Set/Map instances (survive state transitions)
    state.deadPlayers.add(victimId);
    state.deathTimeMap.set(victimId, Date.now());

    // Batch update (arrays must go through set() to survive state transitions)
    set({
      players: applyKill(state.players, victimId),
      frozenWorldLines: [...state.frozenWorldLines, frozen].slice(-MAX_FROZEN_WORLDLINES),
      debrisRecords: [...state.debrisRecords, newDebris].slice(-MAX_DEBRIS),
      pendingKillEvents: [...state.pendingKillEvents, killEvent].slice(-MAX_PENDING_KILL_EVENTS),
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

    // Non-reactive mutations
    state.deathTimeMap.delete(playerId);
    state.deadPlayers.delete(playerId);
    if (!isLighthouse(playerId)) {
      state.invincibleUntil.set(playerId, Date.now() + INVINCIBILITY_DURATION);
    }
    if (isLighthouse(playerId)) {
      state.lighthouseSpawnTime.set(playerId, Date.now());
    }

    // Spawn effect
    const spawningPlayer = state.players.get(playerId);
    const color = spawningPlayer?.color ?? getPlayerColor(playerId);
    const now = Date.now();

    if (playerId === myId) {
      // Self spawn: immediate spawn effect
      set({
        players: applyRespawn(state.players, playerId, position),
        myDeathEvent: null,
        spawns: [
          ...state.spawns,
          { id: `spawn-${playerId}-${now}`, pos: position, color, startTime: now },
        ],
      });
    } else {
      // Other player: causal delay via pending events
      set({
        players: applyRespawn(state.players, playerId, position),
        pendingSpawnEvents: [
          ...state.pendingSpawnEvents,
          { id: `spawn-${playerId}-${now}`, pos: position, color },
        ].slice(-MAX_PENDING_SPAWN_EVENTS),
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
      state.deadPlayers.delete(playerId);
      state.deathTimeMap.delete(playerId);
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
