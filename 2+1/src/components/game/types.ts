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
//
// `particles[i].{ux, uy}` は particle の 4-velocity 空間成分 (= γ·v、 codebase 共通
// convention)。 ut = γ は必要時に `sqrt(1 + ux² + uy²)` で給与し state には保存しない
// (DESIGN.md §「共変表現の徹底」)。 旧 `{dx, dy}` 表現 (= 3-velocity v) は非共変量を state
// 化していたため 2026-04-28 に廃止。
export type DebrisRecord = {
  readonly deathPos: { t: number; x: number; y: number; z: number };
  readonly particles: ReadonlyArray<{ ux: number; uy: number; size: number }>;
  readonly color: string;
  readonly type: "explosion" | "hit";
};

// 世界に残された凍結世界線（死んだプレイヤーの痕跡）
export type FrozenWorldLine = {
  /**
   * 各 frozen entry を unique に識別する id。 SceneContent の renderer key に使う
   * (`key={frozen-${id}}`)、 frozenWorldLines 配列の cycling (= MAX_FROZEN_WORLDLINES
   * truncate で先頭削除 + 末尾追加) で「同じ entry が配列上の位置を変える」 ケースで
   * **同一 React mount を維持**するための identity。
   *
   * 旧設計 (= `key={frozen-${i}-${first.pos.t}}` で配列 index と first event の coord
   * time から構築) は cycling で「異なる entry が同じ i に来る → key 変化 → unmount/
   * mount 連発」 を起こし、 mount 毎に WorldLineRenderer の TubeGeometry build
   * (≈24000 vertex) が走って main thread saturation → setInterval Violation → rAF
   * starve → 全世界凍結 + Context Lost (= 2026-05-04 user 観察「星屑が固まる」 の真因
   * 残存分)。 5/2 fix の wlRef pattern は同 component instance 内 rebuild throttle で
   * mount/unmount 自体には効かない、 stable id で mount 維持して根本解消する。
   *
   * id 生成: `pushFrozenWorldLine` / `messageHandler` 等の生成箇所で monotonic counter
   * 採番 (= `worldLineGap.ts` の `nextFrozenId` helper)、 形式 `${playerId}-${counter}`
   * で human readable + 衝突なし。
   */
  readonly id: string;
  readonly playerId: string;
  readonly worldLine: WorldLine;
  readonly color: string;
};

// 死亡イベントの複合型 (= 旧 `DeathEvent`) は 2026-05-04 plan で分解された:
//   - 静的 death meta (= 死亡時 pos / u / heading) → `players.get(myId).phaseSpace`
//     から derive (= applyKill で死亡時刻凍結保持されるため自動同期、 set 漏れ不可能)
//   - 動的 ghost phaseSpace (= 自機入力で processPlayerPhysics 流用 update) →
//     store の `myGhostPhaseSpace: PhaseSpace | null` field で explicit 管理、
//     useGameLoop dead branch で lazy init (= `?? freshMe.phaseSpace` で fallback)
// 詳細: `plans/2026-05-04-mydeathevent-decomposition.md`

// スポーンイベント（過去光円錐到達まで UI 遅延）
//
// PBC universal cover: spawn event も kill と同じく `(2R+1)²` image cell に複製、 各 image
// 到達で spawn ring が trigger される (echo)。 `firedImageCells` で発火済み image を追跡、
// 全 image 完了で event を消化 (`remaining` から外す)。 open_cylinder mode では primary
// 1 つで完了 = 従来挙動。
export type PendingSpawnEvent = {
  readonly id: string;
  readonly playerId: string;
  readonly pos: { t: number; x: number; y: number; z: number };
  readonly color: string; // fallback color (may be stale at creation time)
  firedImageCells: string[];
};

/**
 * Authority 解体 Stage C の event log エントリ。
 * 全 kill は不変記録として killLog に append される。
 *
 * **PBC universal cover semantics**: PBC torus mode では同じ event が `(2R+1)²` image
 * cell に複製されて各々独立に観測者の過去光円錐に到達する (= echo)。
 * - `firedImageCells: string[]`: 発火済み image cell key (= `"kx,ky"`) のリスト。 各 image
 *   到達で push、 visual effect (death flash / kill notification) trigger。 score は primary
 *   image (= `"0,0"`) 発火時のみ加算 (= double-count 防止)
 * - `firedForUi: boolean` (legacy + derived): 「全 image 発火済」 = `firedImageCells.length
 *   === totalImageCells`。 game-store の selectPendingKills や gcLogs で「完全消化判定」 に
 *   使う。 open_cylinder mode では `(2R+1)² = 1` (= primary のみ) なので primary 発火 =
 *   firedForUi = true で従来挙動維持
 *
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
  firedImageCells: string[];
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
  /**
   * 自機本体周辺で世界線が砲身等と被るのを抑制する inner-hide 半径 (display 原点から
   * この距離未満の vertex は alpha=0)。自機の世界線にだけ渡す。省略時は hide なし。
   */
  innerHideRadius?: number;
};

export type KillNotification3D = {
  victimId: string;
  victimName: string;
  color: string;
  hitPos: { t: number; x: number; y: number; z: number };
};

// SceneContentProps is defined in SceneContent.tsx (reads most data from store directly)
