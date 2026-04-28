import { create } from "zustand";
import {
  ENERGY_MAX,
  EXPLOSION_DEBRIS_COLOR,
  HIT_DEBRIS_COLOR,
  INVINCIBILITY_DURATION,
  MAX_DEBRIS,
  MAX_FROZEN_WORLDLINES,
  MAX_HIT_LOG,
  MAX_KILL_LOG,
  MAX_PENDING_SPAWN_EVENTS,
  MAX_RESPAWN_LOG,
  MAX_WORLDLINE_HISTORY,
  POST_HIT_IFRAME_MS,
} from "../components/game/constants";
import {
  generateExplosionParticles,
  generateHitParticles,
} from "../components/game/debris";
import { applyKill } from "../components/game/killRespawn";
import {
  isLighthouse,
  LIGHTHOUSE_DISPLAY_NAME,
} from "../components/game/lighthouse";
import type {
  DeathEvent,
  DebrisRecord,
  FrozenWorldLine,
  HitEventRecord,
  KillEventRecord,
  KillNotification3D,
  Laser,
  PendingSpawnEvent,
  RelativisticPlayer,
  RespawnEventRecord,
  SpawnEffect,
} from "../components/game/types";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
  getVelocity4,
  type Vector3,
  vector3Zero,
} from "../physics";

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------

type PlayersUpdater = (
  prev: Map<string, RelativisticPlayer>,
) => Map<string, RelativisticPlayer>;
type LasersUpdater = (prev: Laser[]) => Laser[];
type SpawnsUpdater = (prev: SpawnEffect[]) => SpawnEffect[];

/**
 * 機体形状 (hull / 武装の見た目のみ。操作系は controlScheme で別軸)。
 * - 'classic': 六角プリズム + 4 RCS + 砲塔
 * - 'shooter': ロケット teardrop body (RocketShipRenderer)
 * - 'jellyfish': 半透明 dome + Verlet rope 触手
 *
 * UI dropdown は撤去 (一時的に classic のみ表示)。コードは 3 種維持、URL hash
 * `#ship=shooter` / `#ship=jellyfish` で override 可能。
 */
export type ViewMode = "classic" | "shooter" | "jellyfish";

const VIEW_MODE_LS_KEY = "la-view-mode";
const VIEW_MODE_VALUES: readonly ViewMode[] = [
  "classic",
  "shooter",
  "jellyfish",
];

const loadViewMode = (): ViewMode => {
  if (typeof localStorage === "undefined") return "classic";
  const v = localStorage.getItem(VIEW_MODE_LS_KEY);
  return (VIEW_MODE_VALUES as readonly string[]).includes(v ?? "")
    ? (v as ViewMode)
    : "classic";
};
const saveViewMode = (mode: ViewMode) => {
  if (typeof localStorage !== "undefined")
    localStorage.setItem(VIEW_MODE_LS_KEY, mode);
};

/**
 * 操作系 (control scheme)。viewMode (機体形状) と直交軸。
 *
 * - 'legacy_classic' (default): 旧 classic 挙動 = camera が heading に追従、機体本体が
 *   heading 方向に回り、WASD は機体相対 thrust (前後左右)、矢印 ←/→ で heading 連続旋回、
 *   ↑/↓ で camera pitch
 * - 'legacy_shooter': 旧 twin-stick = WASD = 画面相対の進みたい方向 → heading 即時スナップ
 *   + thrust。矢印 ←/→ で camera yaw を機体周りに回転 (camera と heading が独立)。
 *   機体は heading に追従して回る
 * - 'modern': 71e5788 で導入した統一操作系 = camera world basis 固定 (cameraYaw=0)、
 *   WASD は world basis thrust (heading 不変)、矢印 ←/→ で heading 旋回 (砲身/aim のみ)、
 *   機体本体は world basis 固定で砲塔のみ heading 追従
 *
 * UI dropdown は撤去 (一時的に legacy_classic のみ表示)。コードは 3 種維持、URL hash
 * `#controls=modern` / `#controls=legacy_shooter` で override 可能。
 */
export type ControlScheme = "legacy_classic" | "legacy_shooter" | "modern";

const CONTROL_SCHEME_LS_KEY = "la-control-scheme";
const CONTROL_SCHEME_VALUES: readonly ControlScheme[] = [
  "legacy_classic",
  "legacy_shooter",
  "modern",
];

const loadControlScheme = (): ControlScheme => {
  if (typeof localStorage === "undefined") return "legacy_classic";
  const v = localStorage.getItem(CONTROL_SCHEME_LS_KEY);
  return (CONTROL_SCHEME_VALUES as readonly string[]).includes(v ?? "")
    ? (v as ControlScheme)
    : "legacy_classic";
};
const saveControlScheme = (scheme: ControlScheme) => {
  if (typeof localStorage !== "undefined")
    localStorage.setItem(CONTROL_SCHEME_LS_KEY, scheme);
};

/**
 * アリーナ境界の挙動 (plans/2026-04-27-pbc-torus.md)。
 *
 * - 'open_cylinder' (default): 視覚ガイドのみの円柱、 物理的な閉じ込めなし、
 *   プレイヤーはどこまでも飛んでいける。 元の ArenaRenderer (= 2026-04-28 以前の
 *   default に戻した: PBC torus は新 client 永遠凍結等の派生 bug が複数あり一旦保留)。
 * - 'torus': PBC = 周期的境界条件。 アリーナは正方形 `[-L, L]²` のトーラス、
 *   プレイヤーが境界を超えると反対側から出現、 距離計算 (hit detection / 過去光円錐) も
 *   最短画像。 視覚は正方形枠 (= `arenaWallsVisible=true` の時のみ表示)。
 *
 * UI dropdown は撤去 (隠しオプション)。 切替は URL hash `#boundary=torus`。
 */
export type BoundaryMode = "torus" | "open_cylinder";

const BOUNDARY_MODE_LS_KEY = "la-boundary-mode";
const BOUNDARY_MODE_VALUES: readonly BoundaryMode[] = [
  "torus",
  "open_cylinder",
];

const loadBoundaryMode = (): BoundaryMode => {
  if (typeof localStorage === "undefined") return "open_cylinder";
  const v = localStorage.getItem(BOUNDARY_MODE_LS_KEY);
  return (BOUNDARY_MODE_VALUES as readonly string[]).includes(v ?? "")
    ? (v as BoundaryMode)
    : "open_cylinder";
};
const saveBoundaryMode = (mode: BoundaryMode) => {
  if (typeof localStorage !== "undefined")
    localStorage.setItem(BOUNDARY_MODE_LS_KEY, mode);
};

/**
 * Torus PBC の正方形枠 (SquareArenaRenderer) を視覚表示するか。 default false
 * (= 完全非表示)、 物理 PBC は引き続き有効。 オプション保持目的の隠しフラグで、
 * 切替は URL hash `#walls=show` または LS 直接編集。
 */
const ARENA_WALLS_LS_KEY = "la-arena-walls-visible";
const loadArenaWallsVisible = (): boolean => {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(ARENA_WALLS_LS_KEY) === "1";
};
const saveArenaWallsVisible = (v: boolean) => {
  if (typeof localStorage !== "undefined")
    localStorage.setItem(ARENA_WALLS_LS_KEY, v ? "1" : "0");
};

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
  /**
   * 自機が他機の未来光円錐内に居て因果律保持のため freeze 中かどうか。 useGameLoop の
   * `checkCausalFreeze` 結果が変化した tick で update される。 UI overlay (= 「因果律凍結 /
   * Causal Freeze」 表示) が subscribe する。
   */
  causallyFrozen: boolean;
  displayNames: Map<string, string>;

  // --- Non-reactive state (read via getState() only, no re-render) ---
  processedLasers: Set<string>;
  pendingSpawnEvents: PendingSpawnEvent[];
  lighthouseSpawnTime: Map<string, number>;
  /**
   * Authority 解体 Stage E: 各 peer が観測した LH の最後の laser 発射 wallTime。
   * LH owner はこの Map を読んで fire interval を守る。非 owner peer も laser
   * 受信時に更新するため、beacon migration で owner が交代しても自動的に連続性が保たれる。
   */
  lighthouseLastFireTime: Map<string, number>;
  /**
   * Authority 解体 Stage C: kill/respawn の authoritative event log。
   * deadPlayers / invincibleUntil / scores / pendingKillEvents はすべて
   * これらの log から派生 (selectIsDead / selectInvincibleIds /
   * selectPendingKillEvents)。
   */
  killLog: KillEventRecord[];
  respawnLog: RespawnEventRecord[];
  /**
   * Phase C1: 被弾 event log。selectPostHitUntil (i-frame 起点) + UI HIT flash
   * の trigger に使う。lethal / non-lethal 問わず append、tail slice で cap。
   */
  hitLog: HitEventRecord[];

  // --- 視点・操作系設定 ---
  viewMode: ViewMode;
  controlScheme: ControlScheme;
  boundaryMode: BoundaryMode;
  arenaWallsVisible: boolean;

  /**
   * Stale 判定済 peer ID 集合 (= 5s 以上 phaseSpace が来てない) の **store mirror**。
   * 正本は `useStaleDetection.staleFrozenRef` (hot path 用 ref)、 ここは
   * `buildSnapshot` 等の zustand-only コードから読むための同期コピー。 ref と store
   * の二重保持: ref は tick 毎読みを軽くする、 store は外側コンテキスト (PeerProvider
   * 周期 broadcast) から見るため。
   *
   * **用途**: `buildSnapshot` で stale 判定済 peer を新 joiner 向け snapshot から
   * 除外する。 stale player は host が「もう居ない」 と判定済なので、 新 joiner に
   * 渡すと **古い pos.t を持つ phantom player → 新 joiner の過去光円錐内 → freeze 永続**
   * の bug 源になる (2026-04-28 「後から入った client 永遠凍結」 root cause)。
   */
  staleFrozenIds: ReadonlySet<string>;

  // --- Actions: state setters ---
  setPlayers: (updater: PlayersUpdater) => void;
  setLasers: (updater: LasersUpdater) => void;
  setScores: (scores: Record<string, number>) => void;
  setSpawns: (updater: SpawnsUpdater) => void;
  setFrozenWorldLines: (
    updater: (prev: FrozenWorldLine[]) => FrozenWorldLine[],
  ) => void;
  setDebrisRecords: (updater: (prev: DebrisRecord[]) => DebrisRecord[]) => void;
  setKillNotification: (v: KillNotification3D | null) => void;
  setMyDeathEvent: (v: DeathEvent | null) => void;
  setCausallyFrozen: (v: boolean) => void;

  // --- Actions: game logic ---
  handleKill: (
    victimId: string,
    killerId: string,
    hitPos: { t: number; x: number; y: number; z: number },
    myId: string | null,
  ) => void;
  /**
   * 統合 spawn/respawn action。新規 player (init / snapshot) も既存 player の
   * respawn も同じ経路を通り、必ず以下を行う:
   *   1. phaseSpace + worldLine を spawn 位置 (静止) で再生成
   *   2. respawnLog に entry 追加 (invincibility 起点)
   *   3. pendingSpawnEvents に entry 追加 (過去光円錐到達で spawn ring 発火)
   *   4. LH なら lighthouseSpawnTime を更新
   *   5. 自機なら myDeathEvent を null にリセット
   * 「既存」「新規」の差は phaseSpace/worldLine の作り方ではなく、保存する識別情報
   * (color / displayName / ownerId) の出所のみ。spawn ring の出方は player 種別に
   * 関係なく統一 (旧 handleRespawn の self 即時 spawns / 他者 pendingSpawnEvents の
   * 二経路を一本化)。Migration 経路 (= LH の owner 差し替えだけで spawn 不要) は
   * 呼び出し側で setPlayers 直更新する。
   */
  handleSpawn: (
    playerId: string,
    position: { t: number; x: number; y: number; z: number },
    myId: string | null,
    color: string,
    options?: {
      displayName?: string;
      ownerId?: string;
      /**
       * 4-velocity 空間成分 (= γ·v)。 死亡 → 復活の通常経路では省略 (= u=0 静止)、
       * stale 復帰の ballistic 経路では凍結時 u を継承するために渡す。
       */
      u?: { x: number; y: number; z: number };
    },
  ) => void;
  /**
   * Phase C1: 被弾処理。energy を damage 減算し、`< 0` なら handleKill を呼ぶ。
   * post-hit i-frame / respawn 無敵 / 既死の場合は no-op。
   * owner 側 (victim === myId、または LH owner) だけが呼ぶべきだが、本体は呼び
   * 出し側がフィルタ済みという前提で素直に実行する。
   */
  handleDamage: (
    victimId: string,
    killerId: string,
    hitPos: { t: number; x: number; y: number; z: number },
    damage: number,
    laserDir: Vector3,
    myId: string | null,
  ) => void;
  /** Phase C1: energy のみ set (自機 fire/thrust 消費 + 自然回復の tick で使う)。 */
  setPlayerEnergy: (playerId: string, energy: number) => void;

  // --- Actions: small helpers ---
  removePlayer: (playerId: string) => void;
  setDisplayName: (playerId: string, name: string) => void;
  addProcessedLaser: (laserId: string) => void;
  cleanupProcessedLasers: (threshold: number) => void;

  // --- 視点・操作系 setters ---
  setViewMode: (mode: ViewMode) => void;
  setControlScheme: (scheme: ControlScheme) => void;
  setBoundaryMode: (mode: BoundaryMode) => void;
  setArenaWallsVisible: (v: boolean) => void;

  /** stale set の mirror update 用。 useStaleDetection が ref 変更時に同期コピー。 */
  setStaleFrozenIds: (ids: ReadonlySet<string>) => void;
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
  causallyFrozen: false,
  displayNames: new Map(),

  // Non-reactive
  processedLasers: new Set(),
  pendingSpawnEvents: [],
  lighthouseSpawnTime: new Map(),
  lighthouseLastFireTime: new Map(),
  killLog: [],
  respawnLog: [],
  hitLog: [],

  // 視点・操作系 default は localStorage から復元
  viewMode: loadViewMode(),
  controlScheme: loadControlScheme(),
  boundaryMode: loadBoundaryMode(),
  arenaWallsVisible: loadArenaWallsVisible(),

  staleFrozenIds: new Set<string>(),

  // -----------------------------------------------------------------------
  // State setters
  // -----------------------------------------------------------------------

  setPlayers: (updater) =>
    set((state) => ({ players: updater(state.players) })),

  setLasers: (updater) => set((state) => ({ lasers: updater(state.lasers) })),

  setScores: (scores) => set({ scores }),

  setSpawns: (updater) => set((state) => ({ spawns: updater(state.spawns) })),

  setFrozenWorldLines: (updater) =>
    set((state) => ({ frozenWorldLines: updater(state.frozenWorldLines) })),

  setDebrisRecords: (updater) =>
    set((state) => ({ debrisRecords: updater(state.debrisRecords) })),

  setKillNotification: (v) => set({ killNotification: v }),
  setMyDeathEvent: (v) => set({ myDeathEvent: v }),
  setCausallyFrozen: (v) => set({ causallyFrozen: v }),

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
      playerId: victimId,
      worldLine: victim.worldLine,
      color: victim.color,
    };

    // Generate debris (2026-04-21 odakin: per-victim 色から universal EXPLOSION_DEBRIS_COLOR へ)
    const explosionParticles = generateExplosionParticles(victim.phaseSpace.u);
    const newDebris: DebrisRecord = {
      deathPos: hitPos,
      particles: explosionParticles,
      color: EXPLOSION_DEBRIS_COLOR,
      type: "explosion",
    };

    const victimName = isLighthouse(victimId)
      ? LIGHTHOUSE_DISPLAY_NAME
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
      firedImageCells: [],
    };

    // Batch update (arrays must go through set() to survive state transitions)
    set({
      players: applyKill(state.players, victimId),
      frozenWorldLines: [...state.frozenWorldLines, frozen].slice(
        -MAX_FROZEN_WORLDLINES,
      ),
      debrisRecords: [...state.debrisRecords, newDebris].slice(-MAX_DEBRIS),
      killLog: [...state.killLog, killLogEntry],
      myDeathEvent:
        victimId === myId
          ? {
              pos: victim.phaseSpace.pos,
              u: getVelocity4(victim.phaseSpace.u),
              heading: victim.phaseSpace.heading,
              // ghost の動的 phaseSpace 初期値: 死亡時 phaseSpace を copy。
              // 以後 useGameLoop の死亡分岐で生存時物理を流用して更新される。
              ghostPhaseSpace: victim.phaseSpace,
            }
          : state.myDeathEvent,
    });
  },

  // -----------------------------------------------------------------------
  // handleSpawn — 統合 spawn/respawn (旧 handleRespawn + RelativisticGame init
  // + snapshot self-not-in-snapshot を一本化)
  // -----------------------------------------------------------------------

  handleSpawn: (playerId, position, myId, color, options) => {
    const state = get();

    if (isLighthouse(playerId)) {
      state.lighthouseSpawnTime.set(playerId, Date.now());
    }

    const now = Date.now();

    // Spawn 位置で phaseSpace + worldLine を再生成。 通常 (死亡 → 復活) は u=0 静止、
    // stale 復帰 ballistic では options.u に凍結時 u を渡して慣性運動継続。
    const u =
      options?.u !== undefined
        ? createVector3(options.u.x, options.u.y, options.u.z)
        : vector3Zero();
    const ps = createPhaseSpace(
      createVector4(position.t, position.x, position.y, position.z),
      u,
    );
    const newWorldLine = appendWorldLine(
      createWorldLine(MAX_WORLDLINE_HISTORY),
      ps,
    );

    const existing = state.players.get(playerId);
    const player: RelativisticPlayer = existing
      ? {
          ...existing,
          phaseSpace: ps,
          worldLine: newWorldLine,
          isDead: false,
          energy: ENERGY_MAX,
        }
      : {
          id: playerId,
          ownerId: options?.ownerId ?? playerId,
          phaseSpace: ps,
          worldLine: newWorldLine,
          color,
          isDead: false,
          displayName: options?.displayName,
          energy: ENERGY_MAX,
        };

    const nextPlayers = new Map(state.players);
    nextPlayers.set(playerId, player);

    const respawnLogEntry: RespawnEventRecord = {
      playerId,
      position,
      wallTime: now,
    };
    const pendingSpawnEvent: PendingSpawnEvent = {
      id: `spawn-${playerId}-${now}`,
      playerId,
      pos: position,
      color: player.color,
      firedImageCells: [],
    };

    set({
      players: nextPlayers,
      respawnLog: [...state.respawnLog, respawnLogEntry],
      pendingSpawnEvents: [
        ...state.pendingSpawnEvents,
        pendingSpawnEvent,
      ].slice(-MAX_PENDING_SPAWN_EVENTS),
      ...(playerId === myId ? { myDeathEvent: null } : {}),
    });
  },

  // -----------------------------------------------------------------------
  // handleDamage (Phase C1) — energy 減算 + 致命判定
  // -----------------------------------------------------------------------

  handleDamage: (victimId, killerId, hitPos, damage, laserDir, myId) => {
    const state = get();
    const victim = state.players.get(victimId);
    if (!victim) return;
    // 既死: 何もしない (kill 発生後にリレー遅延で届く hit 対策)
    if (selectIsDead(state, victimId)) return;
    const now = Date.now();
    // respawn 無敵中: damage 無視 (kill も発生させない)
    if (selectInvincibleUntil(state, victimId) > now) return;
    // Post-hit i-frame: 直近 hit から POST_HIT_IFRAME_MS 未満は完全 no-op。
    // hitLog にも append しない (さもないと i-frame が連打で無限延長、UI も
    // latest wallTime を読んで flash が消えなくなる)。
    if (selectPostHitUntil(state, victimId) > now) return;

    const newEnergy = victim.energy - damage;
    const isLethal = newEnergy < 0;

    const hitEntry: HitEventRecord = {
      victimId,
      killerId,
      hitPos,
      damage,
      wallTime: now,
    };
    const nextHitLog = [...state.hitLog, hitEntry].slice(-MAX_HIT_LOG);

    // 被弾デブリは lethal / non-lethal 問わず生成。2026-04-21 odakin 指定で
    // per-killer 色から universal `HIT_DEBRIS_COLOR` (warm silver) へ移行。
    // lethal path では handleKill が追加で EXPLOSION_DEBRIS_COLOR の explosion を重ねる
    // (hit = 明るい軽煙 / explosion = 暗い重煙で視覚区別)。
    const hitParticles = generateHitParticles(victim.phaseSpace.u, laserDir);
    const hitDebris: DebrisRecord = {
      deathPos: hitPos,
      particles: hitParticles,
      color: HIT_DEBRIS_COLOR,
      type: "hit",
    };
    const nextDebris = [...state.debrisRecords, hitDebris].slice(-MAX_DEBRIS);

    // Non-lethal: energy を更新、hitLog + hit debris を commit。kill は出さない。
    if (!isLethal) {
      const nextPlayers = new Map(state.players);
      nextPlayers.set(victimId, { ...victim, energy: newEnergy });
      set({
        players: nextPlayers,
        hitLog: nextHitLog,
        debrisRecords: nextDebris,
      });
      return;
    }

    // Lethal: hitLog + hit debris を先に commit、その後 handleKill へ委譲して
    // 上に victim 色の explosion を重ねる。energy は明示 0 にしておく
    // (respawn で ENERGY_MAX にリセット)。
    const nextPlayers = new Map(state.players);
    nextPlayers.set(victimId, { ...victim, energy: 0 });
    set({
      players: nextPlayers,
      hitLog: nextHitLog,
      debrisRecords: nextDebris,
    });
    get().handleKill(victimId, killerId, hitPos, myId);
  },

  setPlayerEnergy: (playerId, energy) =>
    set((state) => {
      const p = state.players.get(playerId);
      if (!p) return state;
      if (p.energy === energy) return state;
      const next = new Map(state.players);
      next.set(playerId, { ...p, energy });
      return { players: next };
    }),

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
    set((state) => {
      if (state.displayNames.get(playerId) === name) return state;
      const next = new Map(state.displayNames);
      next.set(playerId, name);
      return { displayNames: next };
    });
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

  setViewMode: (viewMode) => {
    saveViewMode(viewMode);
    set({ viewMode });
  },

  setControlScheme: (controlScheme) => {
    saveControlScheme(controlScheme);
    set({ controlScheme });
  },

  setBoundaryMode: (boundaryMode) => {
    saveBoundaryMode(boundaryMode);
    set({ boundaryMode });
  },

  setArenaWallsVisible: (v) => {
    saveArenaWallsVisible(v);
    set({ arenaWallsVisible: v });
  },

  setStaleFrozenIds: (ids) => set({ staleFrozenIds: ids }),
}));

// ---------------------------------------------------------------------------
// Selectors (Stage C: event log を source of truth に)
// ---------------------------------------------------------------------------

type LogState = Pick<GameState, "killLog" | "respawnLog" | "hitLog">;

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
export const selectInvincibleUntil = (
  state: LogState,
  playerId: string,
): number => {
  if (isLighthouse(playerId)) return -Infinity;
  const rTime = latestRespawnTime(state).get(playerId);
  return rTime === undefined ? 0 : rTime + INVINCIBILITY_DURATION;
};

/** 現在無敵中の全プレイヤー ID。hit detection の invincible フィルタ用。 */
export const selectInvincibleIds = (
  state: LogState,
  now: number,
): Set<string> => {
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

/**
 * Phase C1: 被弾 i-frame 終了 wallTime。hitLog の victimId 最新 wallTime +
 * POST_HIT_IFRAME_MS。hit 履歴が無ければ 0 (= never)。
 * handleDamage が同 frame 複数 hit を 1 発扱いにするために使う。
 *
 * 灯台にも適用 (2026-04-19): 以前は LH 短絡 `return 0` で毎発有効としていたが、
 * 集中砲火で LH が即死する挙動が爽快感より理不尽寄りに振れるとの判断で人間と
 * 共通化。LIGHTHOUSE_HIT_DAMAGE = 0.2 / ENERGY_MAX = 1.0 で 6 発死は変えず、
 * 最短殺害時間が 5 × POST_HIT_IFRAME_MS = 2.5s になる。なお `selectInvincibleUntil`
 * は依然として LH 短絡 (-Infinity) — 5s respawn 無敵は LH には不要。
 */
export const selectPostHitUntil = (
  state: LogState,
  victimId: string,
): number => {
  let latest = 0;
  for (const e of state.hitLog) {
    if (e.victimId !== victimId) continue;
    if (e.wallTime > latest) latest = e.wallTime;
  }
  return latest === 0 ? 0 : latest + POST_HIT_IFRAME_MS;
};

// ---------------------------------------------------------------------------
// GC (Stage C-4)
// ---------------------------------------------------------------------------

/**
 * Event log の garbage collection。
 * - killLog: firedForUi 済み + 対応 respawn が存在する (= 既に復活した) kill を削除。
 *   UI 未反映 (firedForUi=false) のものは過去光円錐到達で消化するまで残す。
 * - respawnLog: 各プレイヤーの latest 1 件のみ残す (invincibility 計算に必要)。
 *   古い respawn は kill とペアで消費済み。
 * - 両者とも safety cap (MAX_KILL_LOG / MAX_RESPAWN_LOG) を超えたら古いものから切る。
 *
 * 変更が無い場合は **同じ参照** を返し、zustand の set をトリガーしない。
 */
export const gcLogs = (
  killLog: KillEventRecord[],
  respawnLog: RespawnEventRecord[],
): { killLog: KillEventRecord[]; respawnLog: RespawnEventRecord[] } => {
  // 各プレイヤーの latest respawn wallTime
  const latestResp = new Map<string, number>();
  for (const e of respawnLog) {
    const prev = latestResp.get(e.playerId);
    if (prev === undefined || e.wallTime > prev)
      latestResp.set(e.playerId, e.wallTime);
  }

  const nextKill = killLog.filter((e) => {
    if (!e.firedForUi) return true; // UI 消化待ち
    const r = latestResp.get(e.victimId);
    if (r === undefined) return true; // respawn 未発生 (= 死亡継続)
    return r <= e.wallTime; // respawn 発生前の kill は削除済み、これはまだ未解決
  });

  // 各プレイヤーの最新 respawn 1 件のみ残す
  const seen = new Set<string>();
  const reversed: RespawnEventRecord[] = [];
  for (let i = respawnLog.length - 1; i >= 0; i--) {
    const e = respawnLog[i];
    if (seen.has(e.playerId)) continue;
    seen.add(e.playerId);
    reversed.push(e);
  }
  const nextResp = reversed.reverse();

  // Safety cap
  const capKill =
    nextKill.length > MAX_KILL_LOG ? nextKill.slice(-MAX_KILL_LOG) : nextKill;
  const capResp =
    nextResp.length > MAX_RESPAWN_LOG
      ? nextResp.slice(-MAX_RESPAWN_LOG)
      : nextResp;

  // 長さ不変なら同じ参照を返す (kill / respawn の transform は削除のみなので
  // 長さ不変 ⇔ 内容不変)
  return {
    killLog: capKill.length === killLog.length ? killLog : capKill,
    respawnLog: capResp.length === respawnLog.length ? respawnLog : capResp,
  };
};
