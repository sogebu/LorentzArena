import type {
  lorentzBoost,
  PhaseSpace,
  Vector4,
  WorldLine,
} from "../../physics";

// 死亡時の爆散デブリ（等速直線運動、永続データ）
export type DebrisRecord = {
  readonly deathPos: { t: number; x: number; y: number; z: number };
  readonly particles: ReadonlyArray<{ dx: number; dy: number; size: number }>;
  readonly color: string;
};

// 世界に残された凍結世界線（死んだプレイヤーの痕跡）
export type FrozenWorldLine = {
  readonly worldLine: WorldLine;
  readonly color: string;
};

// 死亡イベント（ゴーストカメラの起点）
export type DeathEvent = {
  readonly pos: Vector4; // 死亡位置（4元位置）
  readonly u: Vector4; // 死亡時の4元速度（ローレンツブースト計算用）
};

// スポーンイベント（過去光円錐到達まで UI 遅延）
export type PendingSpawnEvent = {
  readonly id: string;
  readonly playerId: string;
  readonly pos: { t: number; x: number; y: number; z: number };
  readonly color: string; // fallback color (may be stale at creation time)
};

// キルイベント（過去光円錐到達まで UI 遅延）
export type PendingKillEvent = {
  readonly victimId: string;
  readonly killerId: string;
  readonly hitPos: { t: number; x: number; y: number; z: number };
  readonly victimName: string;
  readonly victimColor: string;
};

/**
 * Authority 解体 Stage C の event log エントリ。
 * 全 kill は不変記録として killLog に append される。
 * `firedForUi`: 過去光円錐到達で UI score に反映済みかどうか (Stage C-3 で
 * firePendingKillEvents が書き換える)。
 * `wallTime`: invincibility / respawn timer / leaderboard の判定用。
 * coord time は `hitPos.t` で保持されるので冗長保存しない。
 */
export type KillEventRecord = {
  readonly victimId: string;
  readonly killerId: string;
  readonly hitPos: { t: number; x: number; y: number; z: number };
  readonly wallTime: number;
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
