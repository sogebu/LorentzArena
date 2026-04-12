import {
  appendWorldLine,
  type createPhaseSpace,
  createVector3,
  createVector4,
  evolvePhaseSpace,
  pastLightConeIntersectionWorldLine,
  vector3Zero,
  type Vector4,
} from "../../physics";
import { getLaserColor } from "./colors";
import {
  HIT_RADIUS,
  LASER_RANGE,
  LIGHTHOUSE_FIRE_INTERVAL,
  LIGHTHOUSE_SPAWN_GRACE,
} from "./constants";
import { computeInterceptDirection, isLighthouse } from "./lighthouse";
import { findLaserHitPosition } from "./laserPhysics";
import type { Laser, RelativisticPlayer } from "./types";

// --- Camera ---

export interface CameraState {
  yaw: number;
  pitch: number;
}

const YAW_SPEED = 0.8;
const PITCH_SPEED = 0.5;
const PITCH_MIN = (-Math.PI * 89.9) / 180;
const PITCH_MAX = (Math.PI * 89.9) / 180;

export function processCamera(
  keys: Set<string>,
  touch: { yawDelta: number; pitchDelta: number },
  dTau: number,
  camera: CameraState,
  isDeadForCamera: boolean,
): CameraState {
  let { yaw, pitch } = camera;

  if (keys.has("ArrowLeft")) yaw += YAW_SPEED * dTau;
  if (keys.has("ArrowRight")) yaw -= YAW_SPEED * dTau;
  if (keys.has("ArrowUp")) pitch = Math.min(PITCH_MAX, pitch + PITCH_SPEED * dTau);
  if (keys.has("ArrowDown")) pitch = Math.max(PITCH_MIN, pitch - PITCH_SPEED * dTau);

  if (touch.yawDelta !== 0) {
    yaw += touch.yawDelta;
  }

  if (isDeadForCamera && touch.pitchDelta !== 0) {
    pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch + touch.pitchDelta));
  }

  return { yaw, pitch };
}

// --- Player Physics ---

export interface PhysicsResult {
  newPhaseSpace: ReturnType<typeof createPhaseSpace>;
  updatedWorldLine: ReturnType<typeof appendWorldLine>;
}

export function processPlayerPhysics(
  me: RelativisticPlayer,
  keys: Set<string>,
  touch: { thrust: number },
  yaw: number,
  dTau: number,
  otherPositions: Vector4[],
): PhysicsResult {
  const accel = 8 / 10;
  let forwardAccel = 0;
  let lateralAccel = 0;

  if (keys.has("w")) forwardAccel += accel;
  if (keys.has("s")) forwardAccel -= accel;
  if (keys.has("a")) lateralAccel -= accel;
  if (keys.has("d")) lateralAccel += accel;

  if (touch.thrust !== 0) {
    forwardAccel += accel * touch.thrust;
  }

  const rawLen = Math.sqrt(forwardAccel * forwardAccel + lateralAccel * lateralAccel);
  if (rawLen > accel) {
    forwardAccel *= accel / rawLen;
    lateralAccel *= accel / rawLen;
  }

  const ax = Math.cos(yaw) * forwardAccel + Math.cos(yaw + Math.PI / 2) * lateralAccel;
  const ay = Math.sin(yaw) * forwardAccel + Math.sin(yaw + Math.PI / 2) * lateralAccel;

  const mu = 0.5;
  const frictionX = -me.phaseSpace.u.x * mu;
  const frictionY = -me.phaseSpace.u.y * mu;

  const acceleration = createVector3(ax + frictionX, ay + frictionY, 0);
  const newPhaseSpace = evolvePhaseSpace(me.phaseSpace, acceleration, dTau);
  const updatedWorldLine = appendWorldLine(me.worldLine, newPhaseSpace, otherPositions);

  return { newPhaseSpace, updatedWorldLine };
}

// --- Lighthouse AI ---

export interface LighthouseResult {
  newPs: ReturnType<typeof createPhaseSpace>;
  newWl: ReturnType<typeof appendWorldLine>;
  laser: Laser | null;
}

export function processLighthouseAI(
  players: Map<string, RelativisticPlayer>,
  lhId: string,
  lh: RelativisticPlayer,
  dTau: number,
  currentTime: number,
  lastFireMap: Map<string, number>,
  spawnTimeMap: Map<string, number>,
): LighthouseResult {
  const lhNewPs = evolvePhaseSpace(lh.phaseSpace, vector3Zero(), dTau);
  const lhNewWl = appendWorldLine(lh.worldLine, lhNewPs);

  // Grace period after spawn
  const spawnTime = spawnTimeMap.get(lhId) ?? 0;
  if (currentTime - spawnTime < LIGHTHOUSE_SPAWN_GRACE) {
    return { newPs: lhNewPs, newWl: lhNewWl, laser: null };
  }

  // Fire interval check
  const lastFire = lastFireMap.get(lhId) ?? 0;
  if (currentTime - lastFire < LIGHTHOUSE_FIRE_INTERVAL) {
    return { newPs: lhNewPs, newWl: lhNewWl, laser: null };
  }

  // Find best target
  let bestDir: { x: number; y: number; z: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const [pId, player] of players) {
    if (isLighthouse(pId)) continue;
    if (player.isDead) continue;

    const observed = pastLightConeIntersectionWorldLine(player.worldLine, lhNewPs.pos);
    if (!observed) continue;

    const dir = computeInterceptDirection(lhNewPs.pos, observed.pos, observed.u);
    if (!dir) continue;

    const dx = observed.pos.x - lhNewPs.pos.x;
    const dy = observed.pos.y - lhNewPs.pos.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestDir = dir;
    }
  }

  if (!bestDir) {
    return { newPs: lhNewPs, newWl: lhNewWl, laser: null };
  }

  const laser: Laser = {
    id: `${lhId}-${currentTime}`,
    playerId: lhId,
    emissionPos: {
      t: lhNewPs.pos.t,
      x: lhNewPs.pos.x,
      y: lhNewPs.pos.y,
      z: 0,
    },
    direction: bestDir,
    range: LASER_RANGE,
    color: getLaserColor(lh.color),
  };

  return { newPs: lhNewPs, newWl: lhNewWl, laser };
}

// --- Hit Detection ---

export interface HitDetectionResult {
  kills: Array<{
    victimId: string;
    killerId: string;
    hitPos: { t: number; x: number; y: number; z: number };
  }>;
  hitLaserIds: string[];
}

export function processHitDetection(
  players: Map<string, RelativisticPlayer>,
  lasers: Laser[],
  processedIds: Set<string>,
  deadIds: Set<string>,
): HitDetectionResult {
  const kills: HitDetectionResult["kills"] = [];
  const hitLaserIds: string[] = [];

  let minPlayerT = Number.POSITIVE_INFINITY;
  for (const [, player] of players) {
    if (player.phaseSpace.pos.t < minPlayerT) {
      minPlayerT = player.phaseSpace.pos.t;
    }
  }

  const killedThisFrame = new Set<string>();
  for (const laser of lasers) {
    if (processedIds.has(laser.id)) continue;

    const laserEndT = laser.emissionPos.t + laser.range;
    if (minPlayerT > laserEndT) {
      processedIds.add(laser.id);
      continue;
    }

    for (const [playerId, player] of players) {
      if (playerId === laser.playerId) continue;
      if (killedThisFrame.has(playerId)) continue;
      if (deadIds.has(playerId)) continue;
      const hitPos = findLaserHitPosition(laser, player.worldLine, HIT_RADIUS);
      if (hitPos) {
        kills.push({ victimId: playerId, killerId: laser.playerId, hitPos });
        hitLaserIds.push(laser.id);
        killedThisFrame.add(playerId);
        break;
      }
    }
  }

  return { kills, hitLaserIds };
}

// --- Ghost movement ---

export function processGhostPosition(
  deathEvent: { pos: Vector4; u: Vector4 },
  ghostTau: number,
): Vector4 {
  return createVector4(
    deathEvent.pos.t + deathEvent.u.t * ghostTau,
    deathEvent.pos.x + deathEvent.u.x * ghostTau,
    deathEvent.pos.y + deathEvent.u.y * ghostTau,
    0,
  );
}

