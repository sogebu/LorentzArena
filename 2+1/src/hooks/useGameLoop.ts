import { useEffect, useRef, type RefObject } from "react";
import { createPhaseSpace, type Vector4 } from "../physics";
import {
  ENERGY_MAX,
  ENERGY_RECOVERY_RATE,
  GAME_LOOP_INTERVAL,
  LASER_RANGE,
  MAX_DELTA_TAU,
  MAX_LASERS,
  PROCESSED_LASERS_CLEANUP_THRESHOLD,
  RESPAWN_DELAY,
  SPAWN_EFFECT_DURATION,
} from "../components/game/constants";
import { createRespawnPosition } from "../components/game/respawnTime";
import { isLighthouse } from "../components/game/lighthouse";
import {
  processCamera,
  processPlayerPhysics,
  processLighthouseAI,
  processHitDetection,
  processGhostPosition,
  checkCausalFreeze,
  processLaserFiring,
} from "../components/game/gameLoop";
import {
  firePendingKillEvents,
  firePendingSpawnEvents,
} from "../components/game/causalEvents";
import type {
  DeathEvent,
  Laser,
  PendingKillEvent,
  PendingSpawnEvent,
  RelativisticPlayer,
  SpawnEffect,
} from "../components/game/types";
import type { useStaleDetection } from "./useStaleDetection";
import type { useTouchInput } from "../components/game/touchInput";

// --- Types ---

type PeerManager = {
  getIsHost: () => boolean;
  getHostId: () => string | null;
  send: (msg: unknown) => void;
  sendTo: (id: string, msg: unknown) => void;
};

export interface GameLoopDeps {
  peerManager: PeerManager | null;
  myId: string | null;

  // State setters (React guarantees stable references)
  setPlayers: (updater: (prev: Map<string, RelativisticPlayer>) => Map<string, RelativisticPlayer>) => void;
  setLasers: React.Dispatch<React.SetStateAction<Laser[]>>;
  setSpawns: React.Dispatch<React.SetStateAction<SpawnEffect[]>>;
  setScores: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setFps: React.Dispatch<React.SetStateAction<number>>;
  setEnergy: React.Dispatch<React.SetStateAction<number>>;
  setIsFiring: React.Dispatch<React.SetStateAction<boolean>>;
  setDeathFlash: React.Dispatch<React.SetStateAction<boolean>>;
  setKillNotification: React.Dispatch<React.SetStateAction<{
    victimName: string;
    color: string;
    hitPos: { t: number; x: number; y: number; z: number };
  } | null>>;

  // Refs (stable references, read via .current)
  playersRef: RefObject<Map<string, RelativisticPlayer>>;
  lasersRef: RefObject<Laser[]>;
  processedLasersRef: RefObject<Set<string>>;
  deadPlayersRef: RefObject<Set<string>>;
  deathTimeMapRef: RefObject<Map<string, number>>;
  pendingKillEventsRef: RefObject<PendingKillEvent[]>;
  pendingSpawnEventsRef: RefObject<PendingSpawnEvent[]>;
  causalFrozenRef: RefObject<boolean>;
  lighthouseLastFireRef: RefObject<Map<string, number>>;
  lighthouseSpawnTimeRef: RefObject<Map<string, number>>;
  lastLaserTimeRef: RefObject<number>;
  myDeathEventRef: RefObject<DeathEvent | null>;
  ghostTauRef: RefObject<number>;
  cameraYawRef: RefObject<number>;
  cameraPitchRef: RefObject<number>;
  energyRef: RefObject<number>;
  fpsRef: RefObject<{ frameCount: number; lastTime: number }>;
  scoresRef: RefObject<Record<string, number>>;
  respawnTimeoutsRef: RefObject<Set<ReturnType<typeof setTimeout>>>;

  // Input (refs, stable references)
  keysPressed: RefObject<Set<string>>;
  touchInput: ReturnType<typeof useTouchInput>;

  // Callbacks (change only when myId changes, which is in effect deps)
  handleKill: (victimId: string, killerId: string, hitPos: { t: number; x: number; y: number; z: number }) => void;
  handleRespawn: (playerId: string, position: { t: number; x: number; y: number; z: number }) => void;
  stale: ReturnType<typeof useStaleDetection>;
}

// --- Hook ---

/**
 * Dependency stability analysis (why only peerManager/myId are in useEffect deps):
 *
 * - Refs (playersRef, etc.): stable object, read via .current — always fresh
 * - React setState (setLasers, etc.): React guarantees stable reference
 * - setPlayers: useCallback([]) — stable
 * - handleKill/handleRespawn: useCallback([myId, setPlayers]) — change only when myId changes
 * - stale: properties are refs — reading via .current is always fresh
 * - touchInput/keysPressed: refs — stable
 * - peerManager: can transition null → value — must be in deps
 * - myId: can transition null → string — must be in deps
 *
 * When myId changes, the effect re-runs, capturing new handleKill/handleRespawn closures.
 */
export function useGameLoop({
  peerManager,
  myId,
  setPlayers,
  setLasers,
  setSpawns,
  setScores,
  setFps,
  setEnergy,
  setIsFiring,
  setDeathFlash,
  setKillNotification,
  playersRef,
  lasersRef,
  processedLasersRef,
  deadPlayersRef,
  pendingKillEventsRef,
  pendingSpawnEventsRef,
  causalFrozenRef,
  lighthouseLastFireRef,
  lighthouseSpawnTimeRef,
  lastLaserTimeRef,
  myDeathEventRef,
  ghostTauRef,
  cameraYawRef,
  cameraPitchRef,
  energyRef,
  fpsRef,
  scoresRef,
  respawnTimeoutsRef,
  keysPressed,
  touchInput,
  handleKill,
  handleRespawn,
  stale,
}: GameLoopDeps): void {
  const lastTimeRef = useRef<number>(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: see stability analysis above — all other deps are refs or stable callbacks
  useEffect(() => {
    if (!peerManager || !myId) return;

    /** Send a message to the network: host broadcasts, client sends to host. */
    const sendToNetwork = (msg: unknown) => {
      if (peerManager.getIsHost()) {
        peerManager.send(msg);
      } else {
        const hostId = peerManager.getHostId();
        if (hostId) peerManager.sendTo(hostId, msg);
      }
    };

    const gameLoop = () => {
      if (document.hidden) {
        lastTimeRef.current = Date.now();
        return;
      }

      const currentTime = Date.now();
      const rawDTau = (currentTime - lastTimeRef.current) / 1000;
      const dTau = Math.min(rawDTau, MAX_DELTA_TAU);
      lastTimeRef.current = currentTime;

      // --- Cleanup ---
      setSpawns((prev) => {
        const alive = prev.filter(
          (e) => currentTime - e.startTime < SPAWN_EFFECT_DURATION,
        );
        return alive.length === prev.length ? prev : alive;
      });

      const myT = playersRef.current.get(myId)?.phaseSpace.pos.t;
      if (myT !== undefined && lasersRef.current.length > 0) {
        const cutoff = myT - LASER_RANGE * 2;
        setLasers((prev) => {
          const alive = prev.filter(
            (l) => l.emissionPos.t + l.range > cutoff,
          );
          return alive.length === prev.length ? prev : alive;
        });
      }

      // --- FPS ---
      const now = performance.now();
      fpsRef.current.frameCount++;
      const elapsed = now - fpsRef.current.lastTime;
      if (elapsed >= 1000) {
        setFps(Math.round((fpsRef.current.frameCount * 1000) / elapsed));
        fpsRef.current.frameCount = 0;
        fpsRef.current.lastTime = now;
      }

      // --- Camera ---
      const touch = touchInput.current;
      const isDeadForCamera = playersRef.current.get(myId)?.isDead ?? false;
      const cam = processCamera(
        keysPressed.current,
        touch,
        dTau,
        { yaw: cameraYawRef.current, pitch: cameraPitchRef.current },
        isDeadForCamera,
      );
      cameraYawRef.current = cam.yaw;
      cameraPitchRef.current = cam.pitch;
      touch.yawDelta = 0;
      if (isDeadForCamera) touch.pitchDelta = 0;

      // --- Causal events ---
      const myPos = playersRef.current.get(myId)?.phaseSpace.pos;
      if (myPos && pendingKillEventsRef.current.length > 0) {
        const result = firePendingKillEvents(
          pendingKillEventsRef.current,
          myPos,
          myId,
          scoresRef.current,
        );
        if (result.firedIndices.length > 0) {
          pendingKillEventsRef.current = pendingKillEventsRef.current.filter(
            (_, i) => !result.firedIndices.includes(i),
          );
          scoresRef.current = result.newScores;
          setScores({ ...result.newScores });

          if (result.effects.deathFlash) {
            setDeathFlash(true);
            setTimeout(() => setDeathFlash(false), 600);
          }
          if (result.effects.killNotification) {
            setKillNotification(result.effects.killNotification);
            setTimeout(() => setKillNotification(null), 1500);
          }
        }
      }

      if (myPos && pendingSpawnEventsRef.current.length > 0) {
        const result = firePendingSpawnEvents(
          pendingSpawnEventsRef.current,
          myPos,
          Date.now(),
        );
        if (result.firedSpawns.length > 0) {
          pendingSpawnEventsRef.current = result.remaining;
          setSpawns((prev) => [...prev, ...result.firedSpawns]);
        }
      }

      // --- Laser firing + energy ---
      const isDead = playersRef.current.get(myId)?.isDead ?? false;
      const wantsFire = !isDead && (keysPressed.current.has(" ") || touch.firing);
      const myPlayer = playersRef.current.get(myId);

      if (myPlayer && !isDead) {
        const laserResult = processLaserFiring(
          myPlayer,
          myId,
          cameraYawRef.current,
          currentTime,
          energyRef.current,
          lastLaserTimeRef.current,
          wantsFire,
        );

        if (laserResult.laser) {
          lastLaserTimeRef.current = currentTime;
          energyRef.current = laserResult.newEnergy;

          setLasers((prev) => {
            const updated = [...prev, laserResult.laser as Laser];
            return updated.length > MAX_LASERS
              ? updated.slice(updated.length - MAX_LASERS)
              : updated;
          });

          sendToNetwork({ type: "laser" as const, ...laserResult.laser });
        }
      }

      // Energy recovery
      if (!wantsFire && !isDead) {
        energyRef.current = Math.min(
          ENERGY_MAX,
          energyRef.current + ENERGY_RECOVERY_RATE * dTau,
        );
      }
      setEnergy(energyRef.current);
      setIsFiring(wantsFire && energyRef.current >= 0);

      // S-5: stale 検知は死亡中も走らせる（他プレイヤーの stale を検知するため）
      stale.checkStale(currentTime, playersRef.current, myId);

      // --- Ghost or physics ---
      if (isDead) {
        ghostTauRef.current += dTau;
        const de = myDeathEventRef.current;
        if (de) {
          const ghostPos = processGhostPosition(de, ghostTauRef.current);
          setPlayers((prev) => {
            const me = prev.get(myId);
            if (!me || !me.isDead) return prev;
            const next = new Map(prev);
            next.set(myId, {
              ...me,
              phaseSpace: createPhaseSpace(
                ghostPos,
                { x: de.u.x, y: de.u.y, z: de.u.z },
              ),
            });
            return next;
          });
        }
      } else if (myPlayer) {

        const frozen = checkCausalFreeze(
          playersRef.current,
          myId,
          myPlayer,
          stale.staleFrozenRef.current,
          causalFrozenRef.current,
        );
        causalFrozenRef.current = frozen;

        if (!frozen) {
          const otherPositions: Vector4[] = [];
          for (const [id, p] of playersRef.current) {
            if (id !== myId) otherPositions.push(p.phaseSpace.pos);
          }
          const physics = processPlayerPhysics(
            myPlayer,
            keysPressed.current,
            touch,
            cameraYawRef.current,
            dTau,
            otherPositions,
          );

          setPlayers((prev) => {
            const me = prev.get(myId);
            if (!me) return prev;
            const next = new Map(prev);
            next.set(myId, {
              ...me,
              phaseSpace: physics.newPhaseSpace,
              worldLine: physics.updatedWorldLine,
            });
            return next;
          });

          // Network send
          sendToNetwork({
            type: "phaseSpace" as const,
            senderId: myId,
            position: physics.newPhaseSpace.pos,
            velocity: physics.newPhaseSpace.u,
          });
        }
      }

      // --- Host: Lighthouse AI (batched updates) ---
      if (peerManager.getIsHost()) {
        const lhUpdates: Array<{ id: string; ps: ReturnType<typeof createPhaseSpace>; wl: RelativisticPlayer["worldLine"] }> = [];
        const lhLasers: Laser[] = [];

        for (const [lhId, lh] of playersRef.current) {
          if (!isLighthouse(lhId)) continue;
          if (lh.isDead) continue;

          const result = processLighthouseAI(
            playersRef.current,
            lhId,
            lh,
            dTau,
            currentTime,
            lighthouseLastFireRef.current,
            lighthouseSpawnTimeRef.current,
          );

          lhUpdates.push({ id: lhId, ps: result.newPs, wl: result.newWl });
          peerManager.send({
            type: "phaseSpace" as const,
            senderId: lhId,
            position: result.newPs.pos,
            velocity: result.newPs.u,
          });

          if (result.laser) {
            lighthouseLastFireRef.current.set(lhId, currentTime);
            lhLasers.push(result.laser);
            peerManager.send({ type: "laser" as const, ...result.laser });
          }
        }

        // Batch apply all lighthouse state updates
        if (lhUpdates.length > 0) {
          setPlayers((prev) => {
            const next = new Map(prev);
            for (const { id, ps, wl } of lhUpdates) {
              const existing = next.get(id);
              if (existing) {
                next.set(id, { ...existing, phaseSpace: ps, worldLine: wl });
              }
            }
            return next;
          });
        }
        if (lhLasers.length > 0) {
          setLasers((prev) => {
            const updated = [...prev, ...lhLasers];
            return updated.length > MAX_LASERS
              ? updated.slice(updated.length - MAX_LASERS)
              : updated;
          });
        }
      }

      // --- Host: Hit detection ---
      if (peerManager.getIsHost()) {
        const hitResult = processHitDetection(
          playersRef.current,
          lasersRef.current,
          processedLasersRef.current,
          deadPlayersRef.current,
        );

        // Cleanup processedLasers
        const currentLaserIds = new Set(lasersRef.current.map((l) => l.id));
        for (const id of processedLasersRef.current) {
          if (!currentLaserIds.has(id)) processedLasersRef.current.delete(id);
        }
        if (processedLasersRef.current.size > PROCESSED_LASERS_CLEANUP_THRESHOLD) {
          processedLasersRef.current.clear();
        }

        if (hitResult.kills.length > 0) {
          for (const id of hitResult.hitLaserIds) {
            processedLasersRef.current.add(id);
          }

          for (const { victimId, killerId, hitPos } of hitResult.kills) {
            deadPlayersRef.current.add(victimId);
            stale.staleFrozenRef.current.delete(victimId); // S-2: kill で stale クリア（二重 respawn 防止）
            peerManager.send({ type: "kill" as const, victimId, killerId, hitPos });
            handleKill(victimId, killerId, hitPos);

            const timerId = setTimeout(() => {
              respawnTimeoutsRef.current.delete(timerId);
              const respawnPos = createRespawnPosition(playersRef.current);
              deadPlayersRef.current.delete(victimId);
              peerManager.send({
                type: "respawn" as const,
                playerId: victimId,
                position: respawnPos,
              });
              handleRespawn(victimId, respawnPos);
            }, RESPAWN_DELAY);
            respawnTimeoutsRef.current.add(timerId);
          }
        }
      }
    };

    intervalRef.current = setInterval(gameLoop, GAME_LOOP_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      for (const id of respawnTimeoutsRef.current) {
        clearTimeout(id);
      }
      respawnTimeoutsRef.current.clear();
    };
  }, [peerManager, myId]);
}
