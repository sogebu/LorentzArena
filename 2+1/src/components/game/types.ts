import type {
  lorentzBoost,
  PhaseSpace,
  Vector4,
  WorldLine,
} from "../../physics";

// 死亡時の爆散デブリ (`explosion`) + Phase C1 被弾時の小デブリ (`hit`)。
// 等速直線運動、永続データ、同じ `debrisRecords[]` 配列で共存。renderer は type を
// 参照しないので、個数・size・color の調整は生成器 (`generateExplosionParticles` /
// `generateHitParticles`) 側で完結させる (tag は GC や snapshot 等の識別用途)。
export type DebrisRecord = {
  readonly deathPos: { t: number; x: number; y: number; z: number };
  readonly particles: ReadonlyArray<{ dx: number; dy: number; size: number }>;
  readonly color: string;
  readonly type: "explosion" | "hit";
};

// 世界に残された凍結世界線（死んだプレイヤーの痕跡）
export type FrozenWorldLine = {
  readonly worldLine: WorldLine;
  readonly color: string;
};

// 死亡イベント（ゴーストカメラの起点）
export type DeathEvent = {
  readonly pos: Vector4; // 死亡位置（4元位置、fixed、UI key 等の参照用）
  readonly u: Vector4; // 死亡時の4元速度（fixed、ローレンツブースト初期値）
  /**
   * ghost の動的 phaseSpace。自機入力 (thrust/heading/friction/energy) で
   * 生存時と同じ物理 (`processPlayerPhysics`) を流用して更新される。
   * ローカルのみ更新・ネットワーク非送信。他 peer からは自機は死亡時刻で
   * 固定に見える (DESIGN.md §スポーン座標時刻 原則 3)。
   */
  readonly ghostPhaseSpace: PhaseSpace;
};

// スポーンイベント（過去光円錐到達まで UI 遅延）
export type PendingSpawnEvent = {
  readonly id: string;
  readonly playerId: string;
  readonly pos: { t: number; x: number; y: number; z: number };
  readonly color: string; // fallback color (may be stale at creation time)
};

/**
 * Authority 解体 Stage C の event log エントリ。
 * 全 kill は不変記録として killLog に append される。
 * `firedForUi`: 過去光円錐到達で UI score に反映済みかどうか
 * (firePendingKillEvents が書き換える)。
 * `wallTime`: invincibility / respawn timer / leaderboard の判定用。
 * coord time は `hitPos.t` で保持されるので冗長保存しない。
 * `victimName` / `victimColor`: kill 発生時点のスナップショット (後から
 * victim が disconnect しても UI 通知が成立するように)。
 */
export type KillEventRecord = {
  readonly victimId: string;
  readonly killerId: string;
  readonly hitPos: { t: number; x: number; y: number; z: number };
  readonly wallTime: number;
  readonly victimName: string;
  readonly victimColor: string;
  firedForUi: boolean;
};

/**
 * Authority 解体 Stage C の event log エントリ (respawn 側)。
 * coord time は `position.t` で保持。
 */
export type RespawnEventRecord = {
  readonly playerId: string;
  readonly position: { t: number; x: number; y: number; z: number };
  readonly wallTime: number;
};

/**
 * Phase C1: 被弾イベント。lethal / non-lethal を問わず append される。
 * - post-hit i-frame (POST_HIT_IFRAME_MS) の起点 (`selectPostHitUntil`)
 * - UI HIT flash / energy pulse の trigger (hitLog を subscribe)
 * `damage`: 実際に適用された damage 量 (i-frame で 0 クランプされた場合は 0)。
 */
export type HitEventRecord = {
  readonly victimId: string;
  readonly killerId: string;
  readonly hitPos: { t: number; x: number; y: number; z: number };
  readonly damage: number;
  readonly wallTime: number;
};

export type RelativisticPlayer = {
  id: string;
  /**
   * このプレイヤーを駆動する peer の ID。
   * - 人間プレイヤー: owner = 本人 (ownerId === id)
   * - Lighthouse: owner = 現 beacon holder（= 旧 host）
   *
   * Authority 解体アーキテクチャ（plans/2026-04-14-authority-dissolution.md）
   * Stage A で導入された識別フィールド。Stage B 以降で hit detection の
   * 絞り込みに使われる。Stage A 時点では振る舞い変更なし。
   */
  ownerId: string;
  phaseSpace: PhaseSpace;
  worldLine: WorldLine; // 現在の命の世界線（1本のみ）
  color: string;
  isDead: boolean;
  displayName?: string;
  /**
   * Damage-based death model (Phase C1): fire/thrust/damage 共有プール。
   * - humans: fire / thrust で消費 + damage 0.5 で減算、自然回復 ENERGY_RECOVERY_RATE。
   * - LH: damage 0.5 減算のみ。fire は timer-based なので非消費、**回復なし**。
   * `< 0` で死 (energy 0 は境界値、生存)。respawn で ENERGY_MAX にリセット。
   */
  energy: number;
};

export type Laser = {
  readonly id: string;
  readonly playerId: string;
  readonly emissionPos: { t: number; x: number; y: number; z: number };
  readonly direction: { x: number; y: number; z: number };
  readonly range: number;
  readonly color: string;
};

export type SpawnEffect = {
  readonly id: string;
  readonly pos: { t: number; x: number; y: number; z: number };
  readonly color: string;
  readonly startTime: number;
};

export type DisplayLaser = {
  readonly id: string;
  readonly color: string;
  readonly start: Vector4;
  readonly end: Vector4;
};

export type WorldLineRendererProps = {
  worldLine: WorldLine;
  color: string;
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
  tubeRadius?: number;
  tubeOpacity?: number;
};

export type KillNotification3D = {
  victimName: string;
  color: string;
  hitPos: { t: number; x: number; y: number; z: number };
};

// SceneContentProps is defined in SceneContent.tsx (reads most data from store directly)
