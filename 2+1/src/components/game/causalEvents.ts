import {
  createVector4,
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
 * **PBC universal cover (image observer past-cone pattern)**: 各 kill event について観測者
 * 中心の `(2R+1)²` image cells を image observer pattern で判定。 ship renderer 群と統一の
 * pattern:
 *   imageObserver = obs - 2L*(obsCell + cell.offset)
 *   isInPastLightCone(raw event.hitPos, imageObserver)  // raw 距離
 *   imagePos = event.hitPos + 2L*(obsCell + cell.offset)  // observer 中心 cell 位置で表示
 *
 * 各 image が past cone に入ると `firedImageCells` に key を append + visual effect。
 * Score は primary image (= `"0,0"`) 発火時のみ加算 (= double-count 防止)。 death flash /
 * kill notification も primary のみ (= 主観体験 1 度)。
 *
 * `torusHalfWidth === undefined` (open_cylinder) は primary cell 1 つのみ = 従来挙動。
 */
export function firePendingKillEvents(
  killLog: KillEventRecord[],
  myPos: Vector4,
  myId: string,
  scores: Record<string, number>,
  torusHalfWidth?: number,
  lightConeHeight?: number,
  obsCellX = 0,
  obsCellY = 0,
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
  const L = torusHalfWidth ?? 0;

  for (let i = 0; i < killLog.length; i++) {
    const ev = killLog[i];
    if (ev.firedForUi) continue;
    const alreadyFired = new Set(ev.firedImageCells);
    const newlyFired: string[] = [];
    let primaryJustFired = false;
    for (const cell of cells) {
      const key = imageCellKey(cell);
      if (alreadyFired.has(key)) continue;
      const dx = 2 * L * (obsCellX + cell.kx);
      const dy = 2 * L * (obsCellY + cell.ky);
      const imageObserverV4 = createVector4(
        myPos.t,
        myPos.x - dx,
        myPos.y - dy,
        myPos.z,
      );
      const evPosV4 = createVector4(
        ev.hitPos.t,
        ev.hitPos.x,
        ev.hitPos.y,
        ev.hitPos.z,
      );
      if (isInPastLightCone(evPosV4, imageObserverV4)) {
        newlyFired.push(key);
        if (key === PRIMARY_KEY) primaryJustFired = true;
        if (ev.victimId === myId) {
          if (key === PRIMARY_KEY) deathFlash = true;
        }
        if (ev.killerId === myId && ev.victimId !== myId) {
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
      if (primaryJustFired) {
        newScores[ev.killerId] = (newScores[ev.killerId] || 0) + 1;
      }
      // firedForUi は caller (useGameLoop) で `merged.length >= totalCells` 判定して立てる。
      void totalCells;
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
 * **PBC universal cover (image observer past-cone pattern)**: 各 spawn event について観測者
 * 中心の `(2R+1)²` image cells を image observer pattern で判定。 自機 / 他機 / 灯台 すべて
 * 対称扱い (= 自分の spawn event の echo image も他人と同じく観測者中心で表示)。
 *
 *   imageObserver = obs - 2L*(obsCell + cell.offset)
 *   isInPastLightCone(raw event.pos, imageObserver)  // raw 距離
 *   imagePos = event.pos + 2L*(obsCell + cell.offset)  // observer 中心 cell 位置で表示
 *
 * 各 image が past cone 到達 → spawn ring 1 個発生 (= echo)。 同じ event から複数 ring が
 * 時間差で出る (= 1 周遠い image は ~2L 古い timestamp で見える)。 全 image 発火で event
 * 消化 (= remaining から外す)。
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
  obsCellX = 0,
  obsCellY = 0,
): SpawnEventsResult {
  const firedSpawns: SpawnEffect[] = [];
  const remaining: PendingSpawnEvent[] = [];

  const R =
    torusHalfWidth !== undefined && lightConeHeight !== undefined
      ? requiredImageCellRadius(torusHalfWidth, lightConeHeight)
      : 0;
  const cells = visibleImageCells(torusHalfWidth, R);
  const totalCells = cells.length;
  const L = torusHalfWidth ?? 0;

  for (const ev of pending) {
    const alreadyFired = new Set(ev.firedImageCells);
    const newlyFired: string[] = [];
    for (const cell of cells) {
      const key = imageCellKey(cell);
      if (alreadyFired.has(key)) continue;
      const dx = 2 * L * (obsCellX + cell.kx);
      const dy = 2 * L * (obsCellY + cell.ky);
      const imageObserverV4 = createVector4(
        myPos.t,
        myPos.x - dx,
        myPos.y - dy,
        myPos.z,
      );
      const evPosV4 = createVector4(ev.pos.t, ev.pos.x, ev.pos.y, ev.pos.z);
      if (isInPastLightCone(evPosV4, imageObserverV4)) {
        newlyFired.push(key);
        const resolvedColor = players.get(ev.playerId)?.color ?? ev.color;
        const imagePos = {
          ...ev.pos,
          x: ev.pos.x + dx,
          y: ev.pos.y + dy,
        };
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
    if (merged.length < totalCells) {
      remaining.push({ ...ev, firedImageCells: merged });
    }
  }

  return { firedSpawns, remaining };
}
