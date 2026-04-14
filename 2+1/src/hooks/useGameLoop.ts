import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { createPhaseSpace, type Vector4 } from "../physics";
import {
  DEFAULT_CAMERA_PITCH,
  ENERGY_MAX,
  ENERGY_PER_SHOT,
  ENERGY_RECOVERY_RATE,
  GAME_LOOP_INTERVAL,
  LASER_RANGE,
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
import type { Laser } from "../components/game/types";
import type { useStaleDetection } from "./useStaleDetection";
import type { useTouchInput } from "../components/game/touchInput";
import {
  gcLogs,
  selectDeadPlayerIds,
  selectInvincibleIds,
  useGameStore,
} from "../stores/game-store";

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
  getPlayerColor: (id: string) => string;

  // Local UI setters (transient, kept local for perf)
  setFps: React.Dispatch<React.SetStateAction<number>>;
  setEnergy: React.Dispatch<React.SetStateAction<number>>;
  setIsFiring: React.Dispatch<React.SetStateAction<boolean>>;
  setDeathFlash: React.Dispatch<React.SetStateAction<boolean>>;

  // Per-frame local refs (shared with SceneContent)
  cameraYawRef: MutableRefObject<number>;
  cameraPitchRef: MutableRefObject<number>;

  // Lifecycle (shared with useHostMigration)
  respawnTimeoutsRef: RefObject<Set<ReturnType<typeof setTimeout>>>;

  // Input (refs, stable references)
  keysPressed: RefObject<Set<string>>;
  touchInput: ReturnType<typeof useTouchInput>;

  // Stale detection (standalone hook)
  stale: ReturnType<typeof useStaleDetection>;
}

// --- Hook ---

/**
 * Dependency stability analysis:
 * - Store: read via useGameStore.getState() — always fresh, O(1)
 * - Refs: stable object, read via .current — always fresh
 * - React setState: React guarantees stable reference
 * - peerManager/myId: can transition null → value — must be in deps
 */
export function useGameLoop({
  peerManager,
  myId,
  getPlayerColor,
  setFps,
  setEnergy,
  setIsFiring,
  setDeathFlash,
  cameraYawRef,
  cameraPitchRef,
  respawnTimeoutsRef,
  keysPressed,
  touchInput,
  stale,
}: GameLoopDeps): void {
  const lastTimeRef = useRef<number>(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Internal refs (previously in RelativisticGame, now local to the game loop)
  const causalFrozenRef = useRef<boolean>(false);
  const lighthouseLastFireRef = useRef<Map<string, number>>(new Map());
  const lastLaserTimeRef = useRef<number>(0);
  const fpsRef = useRef({ frameCount: 0, lastTime: performance.now() });
  const energyRef = useRef(ENERGY_MAX);
  const ghostTauRef = useRef<number>(0);

  // Track myDeathEvent transitions (for ghostTau + camera/energy reset)
  const prevMyDeathEventRef = useRef<unknown>(null);

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
      const dTau = (currentTime - lastTimeRef.current) / 1000;
      lastTimeRef.current = currentTime;

      const store = useGameStore.getState();

      // --- Detect myDeathEvent transitions for local ref resets ---
      const currentMyDeathEvent = store.myDeathEvent;
      if (prevMyDeathEventRef.current !== null && currentMyDeathEvent === null) {
        // non-null → null: self-respawn just happened → reset local refs
        cameraYawRef.current = 0;
        cameraPitchRef.current = DEFAULT_CAMERA_PITCH;
        energyRef.current = ENERGY_MAX;
        ghostTauRef.current = 0;
      } else if (prevMyDeathEventRef.current === null && currentMyDeathEvent !== null) {
        // null → non-null: self-death just happened → reset ghost
        ghostTauRef.current = 0;
      }
      prevMyDeathEventRef.current = currentMyDeathEvent;

      // --- Cleanup ---
      store.setSpawns((prev) => {
        const alive = prev.filter(
          (e) => currentTime - e.startTime < SPAWN_EFFECT_DURATION,
        );
        return alive.length === prev.length ? prev : alive;
      });

      const myT = store.players.get(myId)?.phaseSpace.pos.t;
      if (myT !== undefined && store.lasers.length > 0) {
        const cutoff = myT - LASER_RANGE * 2;
        store.setLasers((prev) => {
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
      const isDeadForCamera = store.players.get(myId)?.isDead ?? false;
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
      // Stage C: pending kill events は killLog.filter(!firedForUi) で derive。
      // 過去光円錐到達で firedForUi を立て、scores を加算する。
      const myPos = store.players.get(myId)?.phaseSpace.pos;
      if (myPos && store.killLog.some((e) => !e.firedForUi)) {
        const result = firePendingKillEvents(
          store.killLog,
          myPos,
          myId,
          store.scores,
        );
        if (result.firedIndices.length > 0) {
          const firedSet = new Set(result.firedIndices);
          const nextLog = store.killLog.map((e, i) =>
            firedSet.has(i) ? { ...e, firedForUi: true } : e,
          );
          useGameStore.setState({
            killLog: nextLog,
            scores: { ...result.newScores },
          });

          if (result.effects.deathFlash) {
            setDeathFlash(true);
            setTimeout(() => setDeathFlash(false), 600);
          }
          if (result.effects.killNotification) {
            useGameStore.setState({ killNotification: result.effects.killNotification });
            setTimeout(() => useGameStore.setState({ killNotification: null }), 1500);
          }
        }
      }

      if (myPos && store.pendingSpawnEvents.length > 0) {
        const result = firePendingSpawnEvents(
          store.pendingSpawnEvents,
          myPos,
          Date.now(),
          store.players,
        );
        if (result.firedSpawns.length > 0) {
          useGameStore.setState({ pendingSpawnEvents: result.remaining });
          useGameStore.getState().setSpawns((prev) => [...prev, ...result.firedSpawns]);
        }
      }

      // --- Laser firing + energy ---
      const isDead = store.players.get(myId)?.isDead ?? false;
      const wantsFire = !isDead && (keysPressed.current.has(" ") || touch.firing);
      const myPlayer = store.players.get(myId);

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

          store.setLasers((prev) => {
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
      setIsFiring(wantsFire && energyRef.current >= ENERGY_PER_SHOT);

      // S-5: stale 検知は死亡中も走らせる（他プレイヤーの stale を検知するため）
      stale.checkStale(currentTime, store.players, myId);

      // --- Ghost or physics ---
      // Re-read fresh state to avoid stale worldLine after respawn
      {
        const fresh = useGameStore.getState();
        const freshMe = fresh.players.get(myId);
        const freshDead = freshMe?.isDead ?? true;

        if (freshDead) {
          ghostTauRef.current += dTau;
          const de = fresh.myDeathEvent;
          if (de) {
            const ghostPos = processGhostPosition(de, ghostTauRef.current);
            fresh.setPlayers((prev) => {
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
        } else if (freshMe) {

          const frozen = checkCausalFreeze(
            fresh.players,
            myId,
            freshMe,
            stale.staleFrozenRef.current,
            causalFrozenRef.current,
          );
          causalFrozenRef.current = frozen;

          if (!frozen) {
            const otherPositions: Vector4[] = [];
            for (const [id, p] of fresh.players) {
              if (id !== myId) otherPositions.push(p.phaseSpace.pos);
            }
            const physics = processPlayerPhysics(
              freshMe,
              keysPressed.current,
              touch,
              cameraYawRef.current,
              dTau,
              otherPositions,
            );

            fresh.setPlayers((prev) => {
              const me = prev.get(myId);
              if (!me) return prev;
              // Guard: respawn が間に入って worldLine が変わっていたら skip
              if (me.worldLine !== freshMe.worldLine) return prev;
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
      }

      // --- Host: Lighthouse AI (batched updates) ---
      if (peerManager.getIsHost()) {
        const freshForLH = useGameStore.getState();
        const lhUpdates: Array<{ id: string; ps: ReturnType<typeof createPhaseSpace>; wl: ReturnType<typeof freshForLH.players.get> extends infer P ? P extends { worldLine: infer W } ? W : never : never }> = [];
        const lhLasers: Laser[] = [];

        for (const [lhId, lh] of freshForLH.players) {
          if (!isLighthouse(lhId)) continue;
          if (lh.isDead) continue;

          const result = processLighthouseAI(
            freshForLH.players,
            lhId,
            lh,
            dTau,
            currentTime,
            lighthouseLastFireRef.current,
            freshForLH.lighthouseSpawnTime,
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
          freshForLH.setPlayers((prev) => {
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
          freshForLH.setLasers((prev) => {
            const updated = [...prev, ...lhLasers];
            return updated.length > MAX_LASERS
              ? updated.slice(updated.length - MAX_LASERS)
              : updated;
          });
        }
      }

      // --- Target-authoritative hit detection (Stage B) ---
      // 全 peer が自分の owner player の kill を判定する。
      // - 人間: 自分だけ
      // - host (= beacon holder): 自分 + Lighthouse (LH.ownerId = host myId)
      {
        const freshForHit = useGameStore.getState();
        // Stage C: dead / invincible は log から derive (O(log) だが log は
        // GC で小さく保たれる)。per-frame のコストは無視できる。
        const invincibleIds = selectInvincibleIds(freshForHit, currentTime);
        const deadIds = selectDeadPlayerIds(freshForHit);

        const hitResult = processHitDetection(
          freshForHit.players,
          freshForHit.lasers,
          myId,
          freshForHit.processedLasers,
          deadIds,
          invincibleIds,
        );

        // Cleanup processedLasers
        const currentLaserIds = new Set(freshForHit.lasers.map((l) => l.id));
        for (const id of freshForHit.processedLasers) {
          if (!currentLaserIds.has(id)) freshForHit.processedLasers.delete(id);
        }
        if (freshForHit.processedLasers.size > PROCESSED_LASERS_CLEANUP_THRESHOLD) {
          freshForHit.processedLasers.clear();
        }

        if (hitResult.kills.length > 0) {
          const isHost = peerManager.getIsHost();
          for (const id of hitResult.hitLaserIds) {
            freshForHit.processedLasers.add(id);
          }

          for (const { victimId, killerId, hitPos } of hitResult.kills) {
            stale.staleFrozenRef.current.delete(victimId); // S-2: kill で stale クリア（二重 respawn 防止）
            // target 自身が kill を broadcast（host: 全員へ、client: host 経由で relay）
            sendToNetwork({ type: "kill" as const, victimId, killerId, hitPos });
            useGameStore.getState().handleKill(victimId, killerId, hitPos, myId);

            // respawn timer は Stage D まで host 集中。ここは自分が owner で
            // かつ host でもあるケース（host 自身 or LH）をハンドル。
            // 非 owner 側の kill は messageHandler 経由で host がスケジュール。
            if (isHost) {
              const timerId = setTimeout(() => {
                respawnTimeoutsRef.current.delete(timerId);
                const currentStore = useGameStore.getState();
                const respawnPos = createRespawnPosition(currentStore.players);
                peerManager.send({
                  type: "respawn" as const,
                  playerId: victimId,
                  position: respawnPos,
                });
                currentStore.handleRespawn(victimId, respawnPos, myId, getPlayerColor);
              }, RESPAWN_DELAY);
              respawnTimeoutsRef.current.add(timerId);
            }
          }
        }
      }

      // --- Stage C-4: GC (pair 成立 kill 除去、respawn は latest のみ残す) ---
      {
        const gcState = useGameStore.getState();
        const gc = gcLogs(gcState.killLog, gcState.respawnLog);
        if (gc.killLog !== gcState.killLog || gc.respawnLog !== gcState.respawnLog) {
          useGameStore.setState({ killLog: gc.killLog, respawnLog: gc.respawnLog });
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
