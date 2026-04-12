import { useEffect, useRef, type RefObject } from "react";
import { createPhaseSpace, type Vector4 } from "../physics";
import {
  ENERGY_MAX,
  ENERGY_RECOVERY_RATE,
  LASER_RANGE,
  MAX_LASERS,
  RESPAWN_DELAY,
  SPAWN_EFFECT_DURATION,
  SPAWN_RANGE,
} from "../components/game/constants";
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

  // State setters
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

  // Refs
  playersRef: RefObject<Map<string, RelativisticPlayer>>;
  lasersRef: RefObject<Laser[]>;
  processedLasersRef: RefObject<Set<string>>;
  deadPlayersRef: RefObject<Set<string>>;
  deathTimeMapRef: RefObject<Map<string, number>>; // used by handleKill/handleRespawn, passed through
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

  // Input
  keysPressed: RefObject<Set<string>>;
  touchInput: ReturnType<typeof useTouchInput>;

  // Callbacks
  handleKill: (victimId: string, killerId: string, hitPos: { t: number; x: number; y: number; z: number }) => void;
  handleRespawn: (playerId: string, position: { t: number; x: number; y: number; z: number }) => void;
  stale: ReturnType<typeof useStaleDetection>;
}

// --- Hook ---

export function useGameLoop(deps: GameLoopDeps): void {
  const lastTimeRef = useRef<number>(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const {
      peerManager, myId,
      setPlayers, setLasers, setSpawns, setScores, setFps, setEnergy, setIsFiring,
      setDeathFlash, setKillNotification,
      playersRef, lasersRef, processedLasersRef, deadPlayersRef,
      pendingKillEventsRef, pendingSpawnEventsRef, causalFrozenRef,
      lighthouseLastFireRef, lighthouseSpawnTimeRef, lastLaserTimeRef,
      myDeathEventRef, ghostTauRef, cameraYawRef, cameraPitchRef,
      energyRef, fpsRef, scoresRef, respawnTimeoutsRef,
      keysPressed, touchInput,
      handleKill, handleRespawn, stale,
    } = deps;

    if (!peerManager || !myId) return;

    const gameLoop = () => {
      if (document.hidden) {
        lastTimeRef.current = Date.now();
        return;
      }

      const currentTime = Date.now();
      const rawDTau = (currentTime - lastTimeRef.current) / 1000;
      const dTau = Math.min(rawDTau, 0.1);
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

          const laserMsg = {
            type: "laser" as const,
            ...laserResult.laser,
          };
          if (peerManager.getIsHost()) {
            peerManager.send(laserMsg);
          } else {
            const hostId = peerManager.getHostId();
            if (hostId) peerManager.sendTo(hostId, laserMsg);
          }
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
        stale.checkStale(currentTime, playersRef.current, myId);

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
          const msg = {
            type: "phaseSpace" as const,
            senderId: myId,
            position: physics.newPhaseSpace.pos,
            velocity: physics.newPhaseSpace.u,
          };
          if (peerManager.getIsHost()) {
            peerManager.send(msg);
          } else {
            const hostId = peerManager.getHostId();
            if (hostId) peerManager.sendTo(hostId, msg);
          }
        }
      }

      // --- Host: Lighthouse AI ---
      if (peerManager.getIsHost()) {
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

          setPlayers((prev) => {
            const existing = prev.get(lhId);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(lhId, {
              ...existing,
              phaseSpace: result.newPs,
              worldLine: result.newWl,
            });
            return next;
          });

          peerManager.send({
            type: "phaseSpace" as const,
            senderId: lhId,
            position: result.newPs.pos,
            velocity: result.newPs.u,
          });

          if (result.laser) {
            lighthouseLastFireRef.current.set(lhId, currentTime);
            setLasers((prev) => {
              const laser = result.laser;
              if (!laser) return prev;
              const updated = [...prev, laser];
              return updated.length > MAX_LASERS
                ? updated.slice(updated.length - MAX_LASERS)
                : updated;
            });
            peerManager.send({ type: "laser" as const, ...result.laser });
          }
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
        if (processedLasersRef.current.size > 500) {
          processedLasersRef.current.clear();
        }

        if (hitResult.kills.length > 0) {
          for (const id of hitResult.hitLaserIds) {
            processedLasersRef.current.add(id);
          }

          for (const { victimId, killerId, hitPos } of hitResult.kills) {
            deadPlayersRef.current.add(victimId);
            peerManager.send({ type: "kill" as const, victimId, killerId, hitPos });
            handleKill(victimId, killerId, hitPos);

            const timerId = setTimeout(() => {
              respawnTimeoutsRef.current.delete(timerId);
              let maxT = Number.NEGATIVE_INFINITY;
              for (const [, p] of playersRef.current) {
                if (p.isDead) continue;
                const t = p.phaseSpace.pos.t;
                if (Number.isFinite(t) && t > maxT) maxT = t;
              }
              if (!Number.isFinite(maxT)) maxT = 0;
              const respawnPos = {
                t: maxT,
                x: Math.random() * SPAWN_RANGE,
                y: Math.random() * SPAWN_RANGE,
                z: 0,
              };
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

    intervalRef.current = setInterval(gameLoop, 8);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      for (const id of deps.respawnTimeoutsRef.current) {
        clearTimeout(id);
      }
      deps.respawnTimeoutsRef.current.clear();
    };
  }, [deps]);
}
