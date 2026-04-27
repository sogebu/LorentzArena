import {
  createVector4,
  eventImage,
  type ImageCell,
  imageCellKey,
  isInPastLightCone,
  observableImageCells,
  requiredImageCellRadius,
  type Vector4,
} from "../../physics";
import type { KillEventRecord, PendingSpawnEvent, SpawnEffect } from "./types";

export interface KillEventEffects {
  deathFlash: boolean;
  killNotification: {
    victimId: string;
    victimName: string;
    color: string;
    hitPos: { t: number; x: number; y: number; z: number };
  } | null;
}

export interface KillEventsResult {
  /** Indices into the input killLog whose firedForUi/firedImageCells should be updated. */
  firedIndices: number[];
  /** For each fired index, the new firedImageCells array (= union of old + newly fired this tick). */
  firedImageCellsByIndex: Map<number, string[]>;
  newScores: Record<string, number>;
  effects: KillEventEffects;
}

/**
 * Image cell loop helper: 観測者から見える `(2R+1)²` image cell について、 各 image が
 * 過去光円錐に到達したら呼ぶ。 `alreadyFired` (= Set of `"kx,ky"` 文字列) を毎 image
 * チェックして既発火 image はスキップ。
 *
 * `torusHalfWidth === undefined` (= open_cylinder) のときは primary cell `(0, 0)` 1 個のみ
 * 巡回 (= 従来挙動と等価)。
 */
const visibleImageCells = (
  torusHalfWidth: number | undefined,
  R: number,
): ImageCell[] =>
  torusHalfWidth === undefined ? [{ kx: 0, ky: 0 }] : observableImageCells(R);

const PRIMARY_KEY = "0,0";

/**
 * Fire UI effects for kill events that have just entered the observer's past light cone.
 *
 * **PBC universal cover**: each kill event has `(2R+1)²` image cells in the universal
 * cover; each image is independently checked against the observer's past light cone. As
 * each image enters the cone, its key is appended to `firedImageCells` and visual effects
 * (death flash / kill notification) are triggered (= echo). Score is incremented only for
 * the primary image (= `"0,0"`) firing to prevent double-counting.
 *
 * `torusHalfWidth === undefined` (open_cylinder) は primary cell 1 つのみ巡回 = 従来挙動。
 */
export function firePendingKillEvents(
  killLog: KillEventRecord[],
  myPos: Vector4,
  myId: string,
  scores: Record<string, number>,
  torusHalfWidth?: number,
  lightConeHeight?: number,
): KillEventsResult {
  const firedIndices: number[] = [];
  const firedImageCellsByIndex = new Map<number, string[]>();
  const newScores = { ...scores };
  let deathFlash = false;
  let killNotification: KillEventEffects["killNotification"] = null;

  const R =
    torusHalfWidth !== undefined && lightConeHeight !== undefined
      ? requiredImageCellRadius(torusHalfWidth, lightConeHeight)
      : 0;
  const cells = visibleImageCells(torusHalfWidth, R);
  const totalCells = cells.length;

  for (let i = 0; i < killLog.length; i++) {
    const ev = killLog[i];
    if (ev.firedForUi) continue;
    const alreadyFired = new Set(ev.firedImageCells);
    const newlyFired: string[] = [];
    let primaryJustFired = false;
    for (const cell of cells) {
      const key = imageCellKey(cell);
      if (alreadyFired.has(key)) continue;
      const imagePos =
        torusHalfWidth !== undefined
          ? eventImage(ev.hitPos, cell, torusHalfWidth)
          : ev.hitPos;
      const imageV4 = createVector4(
        imagePos.t,
        imagePos.x,
        imagePos.y,
        imagePos.z,
      );
      if (isInPastLightCone(imageV4, myPos)) {
        newlyFired.push(key);
        if (key === PRIMARY_KEY) primaryJustFired = true;
        if (ev.victimId === myId) {
          // death flash は primary image でのみ trigger (= 主観的には 1 度だけ)
          if (key === PRIMARY_KEY) deathFlash = true;
        }
        if (ev.killerId === myId && ev.victimId !== myId) {
          // kill notification は primary image でのみ
          if (key === PRIMARY_KEY) {
            killNotification = {
              victimId: ev.victimId,
              victimName: ev.victimName,
              color: ev.victimColor,
              hitPos: ev.hitPos,
            };
          }
        }
      }
    }
    if (newlyFired.length > 0) {
      firedIndices.push(i);
      const merged = [...ev.firedImageCells, ...newlyFired];
      firedImageCellsByIndex.set(i, merged);
      // Score は primary image 発火時のみ加算 (double-count 防止)。 echo (隣接 image 到達)
      // は visual effect なし、 score 不変。
      if (primaryJustFired) {
        newScores[ev.killerId] = (newScores[ev.killerId] || 0) + 1;
      }
      // 全 image fired → firedForUi = true (= caller が既存 logic で消化判定に使う)
      if (merged.length >= totalCells) {
        // firedForUi 自体は caller 側 (useGameLoop) で `merged.length >= totalCells` 判定して
        // 立てる。 ここでは firedImageCells のみ返す。
      }
    }
  }

  return {
    firedIndices,
    firedImageCellsByIndex,
    newScores,
    effects: { deathFlash, killNotification },
  };
}

export interface SpawnEventsResult {
  firedSpawns: SpawnEffect[];
  remaining: PendingSpawnEvent[];
}

/**
 * **PBC universal cover**: each spawn event has `(2R+1)²` image cells; each independently
 * triggers a spawn ring as it enters the observer's past light cone. `firedImageCells`
 * tracks which images have already triggered. Event is removed from `remaining` only when
 * all images have fired.
 *
 * Each fired image emits a `SpawnEffect` (= spawn ring), so a single event can produce
 * multiple rings over time as echoes from different image cells reach the observer.
 *
 * `torusHalfWidth === undefined` (open_cylinder) は primary 1 image のみ = 従来挙動。
 */
export function firePendingSpawnEvents(
  pending: PendingSpawnEvent[],
  myPos: Vector4,
  fireTime: number,
  players: Map<string, { color: string }>,
  torusHalfWidth?: number,
  lightConeHeight?: number,
): SpawnEventsResult {
  const firedSpawns: SpawnEffect[] = [];
  const remaining: PendingSpawnEvent[] = [];

  const R =
    torusHalfWidth !== undefined && lightConeHeight !== undefined
      ? requiredImageCellRadius(torusHalfWidth, lightConeHeight)
      : 0;
  const cells = visibleImageCells(torusHalfWidth, R);
  const totalCells = cells.length;

  for (const ev of pending) {
    const alreadyFired = new Set(ev.firedImageCells);
    const newlyFired: string[] = [];
    for (const cell of cells) {
      const key = imageCellKey(cell);
      if (alreadyFired.has(key)) continue;
      const imagePos =
        torusHalfWidth !== undefined
          ? eventImage(ev.pos, cell, torusHalfWidth)
          : ev.pos;
      const imageV4 = createVector4(
        imagePos.t,
        imagePos.x,
        imagePos.y,
        imagePos.z,
      );
      if (isInPastLightCone(imageV4, myPos)) {
        newlyFired.push(key);
        const resolvedColor = players.get(ev.playerId)?.color ?? ev.color;
        // 各 image 独立に spawn ring を出す (= echo として複数回 trigger)。
        // id を image key で suffix 化して uniqueness 保証 (= ring が overlap しても別 entity)。
        firedSpawns.push({
          id: key === PRIMARY_KEY ? ev.id : `${ev.id}#${key}`,
          pos: imagePos,
          color: resolvedColor,
          startTime: fireTime,
        });
      }
    }
    const merged = [...ev.firedImageCells, ...newlyFired];
    // 全 image fired なら event を消化 (= remaining から外す)、 そうでなければ更新版を維持。
    if (merged.length < totalCells) {
      remaining.push({ ...ev, firedImageCells: merged });
    }
  }

  return { firedSpawns, remaining };
}
