import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePeer } from "../hooks/usePeer";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
  getVelocity4,
  lorentzDotVector4,
  subVector4,
  type Vector4,
  vector3Zero,
} from "../physics";
import { getLaserColor } from "./game/colors";
import {
  ENERGY_MAX,
  ENERGY_PER_SHOT,
  ENERGY_RECOVERY_RATE,
  LASER_COOLDOWN,
  LASER_RANGE,
  LIGHTHOUSE_ID_PREFIX,
  MAX_LASERS,
  MAX_WORLDLINE_HISTORY,
  OFFSET,
  RESPAWN_DELAY,
  SPAWN_EFFECT_DURATION,
  SPAWN_RANGE,
} from "./game/constants";
import { HUD } from "./game/HUD";
import { applyKill, applyRespawn } from "./game/killRespawn";
import {
  createLighthouse,
  isLighthouse,
} from "./game/lighthouse";
import { createMessageHandler } from "./game/messageHandler";
import { SceneContent } from "./game/SceneContent";
import { useTouchInput } from "./game/touchInput";
import { generateExplosionParticles } from "./game/debris";
import type {
  DeathEvent,
  DebrisRecord,
  FrozenWorldLine,
  Laser,
  PendingKillEvent,
  PendingSpawnEvent,
  RelativisticPlayer,
  SpawnEffect,
} from "./game/types";
import {
  MAX_DEBRIS,
  MAX_FROZEN_WORLDLINES,
} from "./game/constants";
import {
  processCamera,
  processPlayerPhysics,
  processLighthouseAI,
  processHitDetection,
  processGhostPosition,
} from "./game/gameLoop";
import {
  firePendingKillEvents,
  firePendingSpawnEvents,
} from "./game/causalEvents";
import { useStaleDetection } from "../hooks/useStaleDetection";
import { useKeyboardInput } from "../hooks/useKeyboardInput";
import { useHighScoreSaver } from "../hooks/useHighScoreSaver";
import { useHostMigration } from "../hooks/useHostMigration";

const RelativisticGame = ({ displayName }: { displayName: string }) => {
  const {
    peerManager,
    myId,
    connections,
    isMigrating,
    completeMigration,
    getPlayerColor,
    joinRegistryVersion,
  } = usePeer();
  const [players, setPlayers] = useState<Map<string, RelativisticPlayer>>(
    new Map(),
  );
  const [lasers, setLasers] = useState<Laser[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [spawns, setSpawns] = useState<SpawnEffect[]>([]);
  const [deathFlash, setDeathFlash] = useState(false);
  const [isFiring, setIsFiring] = useState(false);
  const [killNotification, setKillNotification] = useState<{
    victimName: string;
    color: string;
    hitPos: { t: number; x: number; y: number; z: number };
  } | null>(null);

  // 世界オブジェクト（プレイヤーから独立）
  const [frozenWorldLines, setFrozenWorldLines] = useState<FrozenWorldLine[]>(
    [],
  );
  const [debrisRecords, setDebrisRecords] = useState<DebrisRecord[]>([]);
  const myDeathEventRef = useRef<DeathEvent | null>(null);
  const ghostTauRef = useRef<number>(0);

  const scoresRef = useRef<Record<string, number>>({});
  const [showInRestFrame, setShowInRestFrame] = useState(true);
  const [useOrthographic, setUseOrthographic] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTimeRef = useRef<number>(Date.now());
  const playersRef = useRef<Map<string, RelativisticPlayer>>(new Map());
  const lasersRef = useRef<Laser[]>([]);
  const processedLasersRef = useRef<Set<string>>(new Set());
  const deadPlayersRef = useRef<Set<string>>(new Set());
  const deathTimeMapRef = useRef<Map<string, number>>(new Map());
  const pendingKillEventsRef = useRef<PendingKillEvent[]>([]);
  const displayNamesRef = useRef<Map<string, string>>(new Map());
  const pendingSpawnEventsRef = useRef<PendingSpawnEvent[]>([]);
  const causalFrozenRef = useRef<boolean>(false);
  const lighthouseLastFireRef = useRef<Map<string, number>>(new Map());
  const lighthouseSpawnTimeRef = useRef<Map<string, number>>(new Map());
  const lastLaserTimeRef = useRef<number>(0);
  const [_screenSize, setScreenSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({ frameCount: 0, lastTime: performance.now() });
  const cameraYawRef = useRef(0);
  const cameraPitchRef = useRef(Math.PI / 6);
  const energyRef = useRef(ENERGY_MAX);
  const [energy, setEnergy] = useState(ENERGY_MAX);

  // Extracted hooks
  const keysPressed = useKeyboardInput();
  const touchInput = useTouchInput();
  const stale = useStaleDetection();
  useHighScoreSaver(myId, displayName, peerManager, scoresRef);

  // Stable ref wrapper for handleRespawn (defined further below).
  // Declared here so useHostMigration can reference it without forward-reference issues.
  const handleRespawnRef = useRef<(id: string, pos: { t: number; x: number; y: number; z: number }) => void>(() => {});
  const handleRespawnStable = useCallback(
    (playerId: string, position: { t: number; x: number; y: number; z: number }) => {
      handleRespawnRef.current(playerId, position);
    },
    [],
  );

  const respawnTimeoutsRef = useHostMigration({
    isMigrating,
    peerManager,
    myId,
    connections,
    playersRef,
    scoresRef,
    deadPlayersRef,
    deathTimeMapRef,
    displayNamesRef,
    handleRespawn: handleRespawnStable,
    completeMigration,
  });

  // Kill 処理: 世界線凍結 + デブリ生成 + isDead 設定
  const handleKill = useCallback(
    (
      victimId: string,
      killerId: string,
      hitPos: { t: number; x: number; y: number; z: number },
    ) => {
      const victim = playersRef.current.get(victimId);
      if (!victim) return;

      setFrozenWorldLines((prev) => {
        const frozen: FrozenWorldLine = {
          worldLine: victim.worldLine,
          color: victim.color,
          showHalfLine: victim.worldLine.origin !== null,
        };
        return [...prev, frozen].slice(-MAX_FROZEN_WORLDLINES);
      });

      const explosionParticles = generateExplosionParticles(victim.phaseSpace.u);
      setDebrisRecords((prev) => {
        const newDebris: DebrisRecord = {
          deathPos: hitPos,
          particles: explosionParticles,
          color: victim.color,
        };
        return [...prev, newDebris].slice(-MAX_DEBRIS);
      });

      setPlayers((prev) => applyKill(prev, victimId));

      if (victimId === myId) {
        myDeathEventRef.current = {
          pos: victim.phaseSpace.pos,
          u: getVelocity4(victim.phaseSpace.u),
        };
        ghostTauRef.current = 0;
      }

      deathTimeMapRef.current.set(victimId, Date.now());

      pendingKillEventsRef.current.push({
        victimId,
        killerId,
        hitPos,
        victimName: isLighthouse(victimId) ? "Lighthouse" : (playersRef.current.get(victimId)?.displayName ?? victimId.slice(0, 6)),
        victimColor: victim.color,
      });
      if (pendingKillEventsRef.current.length > 100) {
        pendingKillEventsRef.current =
          pendingKillEventsRef.current.slice(-100);
      }
    },
    [myId],
  );

  // Respawn 処理
  // biome-ignore lint/correctness/useExhaustiveDependencies: getPlayerColor is read at spawn time only, not a reactive dependency
  const handleRespawn = useCallback(
    (
      playerId: string,
      position: { t: number; x: number; y: number; z: number },
    ) => {
      setPlayers((prev) => applyRespawn(prev, playerId, position));

      deathTimeMapRef.current.delete(playerId);

      // Lighthouse: reset spawn grace timer on respawn
      if (isLighthouse(playerId)) {
        lighthouseSpawnTimeRef.current.set(playerId, Date.now());
      }

      if (playerId === myId) {
        myDeathEventRef.current = null;
        ghostTauRef.current = 0;
        cameraYawRef.current = 0;
        cameraPitchRef.current = Math.PI / 6;
        energyRef.current = ENERGY_MAX;
      }

      const spawningPlayer = playersRef.current.get(playerId);
      const color = spawningPlayer?.color ?? getPlayerColor(playerId);
      const now = Date.now();

      if (playerId === myId) {
        setSpawns((prev) => [
          ...prev,
          {
            id: `spawn-${playerId}-${now}`,
            pos: position,
            color,
            startTime: now,
          },
        ]);
      } else {
        pendingSpawnEventsRef.current = [
          ...pendingSpawnEventsRef.current,
          { id: `spawn-${playerId}-${now}`, pos: position, color },
        ];
        if (pendingSpawnEventsRef.current.length > 50) {
          pendingSpawnEventsRef.current =
            pendingSpawnEventsRef.current.slice(-50);
        }
      }
    },
    [myId],
  );

  // Keep handleRespawnRef in sync with the latest handleRespawn
  handleRespawnRef.current = handleRespawn;

  // 初期化: ホスト・クライアント共通でプレイヤー作成（固定 OFFSET により syncTime 不要）
  const isHost = peerManager?.getIsHost() ?? false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: getPlayerColor is read at init time only
  useEffect(() => {
    if (!myId) return;

    // 非決定的な値を reducer 外で計算（StrictMode 安全）
    const initialPhaseSpace = createPhaseSpace(
      createVector4(
        Date.now() / 1000 - OFFSET,
        Math.random() * SPAWN_RANGE,
        Math.random() * SPAWN_RANGE,
        0.0,
      ),
      vector3Zero(),
    );
    let initialWorldLine = createWorldLine(MAX_WORLDLINE_HISTORY, initialPhaseSpace);
    initialWorldLine = appendWorldLine(initialWorldLine, initialPhaseSpace);
    const initialColor = getPlayerColor(myId);

    setPlayers((prev) => {
      if (prev.has(myId)) return prev; // Already initialized (reconnect/migration)
      const next = new Map(prev);
      next.set(myId, {
        id: myId,
        phaseSpace: initialPhaseSpace,
        worldLine: initialWorldLine,
        color: initialColor,
        isDead: false,
      });
      return next;
    });

    // Host only: Lighthouse AI + score sync to connected clients
    if (isHost) {
      const lighthouseId = `${LIGHTHOUSE_ID_PREFIX}0`;
      const lighthouse = createLighthouse(
        lighthouseId,
        Date.now() / 1000 - OFFSET,
      );

      lighthouseSpawnTimeRef.current.set(lighthouseId, Date.now());
      stale.staleFrozenRef.current.delete(lighthouseId);

      setPlayers((prev) => {
        const next = new Map(prev);
        next.set(lighthouseId, lighthouse);
        return next;
      });

      if (peerManager) {
        for (const conn of connections) {
          if (conn.open) {
            peerManager.sendTo(conn.id, {
              type: "syncTime",
              hostTime: initialPhaseSpace.pos.t,
              scores: scoresRef.current,
            });
          }
        }
      }
    }
  }, [myId, isHost]);

  // ref を最新の state に同期
  useEffect(() => {
    playersRef.current = players;
  }, [players]);
  useEffect(() => {
    lasersRef.current = lasers;
  }, [lasers]);

  // 切断したプレイヤーを削除 & 新規接続にsyncTime送信
  const prevConnectionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!myId) return;

    const connectedIds = new Set(connections.map((c) => c.id));
    connectedIds.add(myId);

    if (peerManager?.getIsHost() && !isMigrating) {
      const myPlayer = playersRef.current.get(myId);
      if (myPlayer) {
        for (const conn of connections) {
          if (conn.open && !prevConnectionIdsRef.current.has(conn.id)) {
            peerManager.sendTo(conn.id, {
              type: "syncTime",
              hostTime: myPlayer.phaseSpace.pos.t,
              scores: scoresRef.current,
            });
          }
        }
      }
    }
    prevConnectionIdsRef.current = new Set(
      connections.filter((c) => c.open).map((c) => c.id),
    );

    setPlayers((prev) => {
      const idsToRemove: string[] = [];
      for (const playerId of prev.keys()) {
        if (!connectedIds.has(playerId) && !isLighthouse(playerId)) {
          idsToRemove.push(playerId);
        }
      }
      if (idsToRemove.length === 0) return prev;
      const next = new Map(prev);
      for (const id of idsToRemove) {
        next.delete(id);
        deadPlayersRef.current.delete(id);
        deathTimeMapRef.current.delete(id);
      }
      stale.cleanupDisconnected(connectedIds);
      return next;
    });
  }, [connections, myId, peerManager, isMigrating, stale]);

  // joinRegistry 変化時に全プレイヤーの色を再計算
  useEffect(() => {
    if (joinRegistryVersion === 0) return;
    setPlayers((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, player] of next) {
        if (isLighthouse(id)) continue; // Lighthouse uses fixed LIGHTHOUSE_COLOR
        const correctColor = getPlayerColor(id);
        if (player.color !== correctColor) {
          next.set(id, { ...player, color: correctColor });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [joinRegistryVersion, getPlayerColor]);

  // メッセージ受信処理
  // biome-ignore lint/correctness/useExhaustiveDependencies: getPlayerColor is passed to messageHandler but should not trigger re-registration
  useEffect(() => {
    if (!peerManager || !myId) return;

    peerManager.onMessage(
      "relativistic",
      createMessageHandler({
        myId,
        peerManager,
        setPlayers,
        setLasers,
        setScores,
        scoresRef,
        handleKill,
        handleRespawn,
        getPlayerColor,
        lastUpdateTimeRef: stale.lastUpdateTimeRef,
        lastCoordTimeRef: stale.lastCoordTimeRef,
        playersRef,
        staleFrozenRef: stale.staleFrozenRef,
        displayNamesRef,
      }),
    );

    peerManager.send({
      type: "intro",
      senderId: myId,
      displayName,
    });

    if (!peerManager.getIsHost()) {
      peerManager.send({ type: "requestPeerList" });
    }

    displayNamesRef.current.set(myId, displayName);

    return () => {
      peerManager.offMessage("relativistic");
    };
  }, [peerManager, myId, handleKill, handleRespawn]);


  // ウィンドウリサイズの検出
  useEffect(() => {
    const handleResize = () => {
      setScreenSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ゲームループ
  // biome-ignore lint/correctness/useExhaustiveDependencies: touchInput is a stable ref (like keysPressed) — reading .current in the loop is intentional
  useEffect(() => {
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

      // 期限切れスポーンエフェクト削除
      setSpawns((prev) => {
        const alive = prev.filter(
          (e) => currentTime - e.startTime < SPAWN_EFFECT_DURATION,
        );
        return alive.length === prev.length ? prev : alive;
      });

      // 古いレーザー削除
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

      // FPS計算
      const now = performance.now();
      fpsRef.current.frameCount++;
      const elapsed = now - fpsRef.current.lastTime;
      if (elapsed >= 1000) {
        setFps(Math.round((fpsRef.current.frameCount * 1000) / elapsed));
        fpsRef.current.frameCount = 0;
        fpsRef.current.lastTime = now;
      }

      // カメラ制御
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
      // Consume touch deltas
      touch.yawDelta = 0;
      if (isDeadForCamera) touch.pitchDelta = 0;

      // 因果律遅延キル通知 + スコア
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

      // 因果律遅延スポーンエフェクト
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

      const isDead = playersRef.current.get(myId)?.isDead ?? false;

      // レーザー発射 + エネルギー管理
      const firingNow =
        !isDead && (keysPressed.current.has(" ") || touch.firing);
      if (
        firingNow &&
        energyRef.current >= ENERGY_PER_SHOT &&
        currentTime - lastLaserTimeRef.current > LASER_COOLDOWN
      ) {
        const myPlayer = playersRef.current.get(myId);
        if (myPlayer) {
          lastLaserTimeRef.current = currentTime;
          energyRef.current -= ENERGY_PER_SHOT;
          const dx = Math.cos(cameraYawRef.current);
          const dy = Math.sin(cameraYawRef.current);

          const newLaser: Laser = {
            id: `${myId}-${currentTime}`,
            playerId: myId,
            emissionPos: {
              t: myPlayer.phaseSpace.pos.t,
              x: myPlayer.phaseSpace.pos.x,
              y: myPlayer.phaseSpace.pos.y,
              z: 0,
            },
            direction: { x: dx, y: dy, z: 0 },
            range: LASER_RANGE,
            color: getLaserColor(myPlayer.color),
          };

          setLasers((prev) => {
            const updated = [...prev, newLaser];
            return updated.length > MAX_LASERS
              ? updated.slice(updated.length - MAX_LASERS)
              : updated;
          });

          const laserMsg = {
            type: "laser" as const,
            id: newLaser.id,
            playerId: newLaser.playerId,
            emissionPos: newLaser.emissionPos,
            direction: newLaser.direction,
            range: newLaser.range,
            color: newLaser.color,
          };

          if (peerManager.getIsHost()) {
            peerManager.send(laserMsg);
          } else {
            const hostId = peerManager.getHostId();
            if (hostId) {
              peerManager.sendTo(hostId, laserMsg);
            }
          }
        }
      }

      // エネルギー回復
      if (!firingNow && !isDead) {
        energyRef.current = Math.min(
          ENERGY_MAX,
          energyRef.current + ENERGY_RECOVERY_RATE * dTau,
        );
      }
      setEnergy(energyRef.current);
      setIsFiring(firingNow && energyRef.current >= ENERGY_PER_SHOT);

      if (isDead) {
        // 死亡中: ゴースト等速直線運動
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
      } else {
        const me = playersRef.current.get(myId);
        if (me) {
          // Stale 検知
          stale.checkStale(currentTime, playersRef.current, myId);

          // 因果律の守護者
          let frozen = false;
          for (const [id, player] of playersRef.current) {
            if (id === myId) continue;
            if (player.isDead) continue;
            if (isLighthouse(id)) continue;
            if (stale.staleFrozenRef.current.has(id)) continue;
            if (player.phaseSpace.pos.t > me.phaseSpace.pos.t) continue;
            const diff = subVector4(player.phaseSpace.pos, me.phaseSpace.pos);
            const l = lorentzDotVector4(diff, diff);
            const threshold = causalFrozenRef.current ? 2.0 : 0;
            if (l < -threshold) {
              frozen = true;
              break;
            }
          }
          causalFrozenRef.current = frozen;

          if (!frozen) {
            // プレイヤー物理
            const otherPositions: Vector4[] = [];
            for (const [id, p] of playersRef.current) {
              if (id !== myId) otherPositions.push(p.phaseSpace.pos);
            }
            const physics = processPlayerPhysics(
              me,
              keysPressed.current,
              touch,
              cameraYawRef.current,
              dTau,
              otherPositions,
            );

            setPlayers((prev) => {
              const myPlayer = prev.get(myId);
              if (!myPlayer) return prev;
              // playersRef は useEffect で同期されるため、リスポーン直後は
              // 古い worldLine ベースの physics.updatedWorldLine になりうる。
              // prev（React 最新 state）の worldLine に append し直す。
              const freshWorldLine = appendWorldLine(
                myPlayer.worldLine,
                physics.newPhaseSpace,
                otherPositions,
              );
              const next = new Map(prev);
              next.set(myId, {
                ...myPlayer,
                phaseSpace: physics.newPhaseSpace,
                worldLine: freshWorldLine,
              });
              return next;
            });

            // ネットワーク送信
            const isHostNow = peerManager.getIsHost();
            const msg = {
              type: "phaseSpace" as const,
              senderId: myId,
              position: physics.newPhaseSpace.pos,
              velocity: physics.newPhaseSpace.u,
            };
            if (isHostNow) {
              peerManager.send(msg);
            } else {
              const hostId = peerManager.getHostId();
              if (hostId) {
                peerManager.sendTo(hostId, msg);
              }
            }
          }
        }
      }

      // ホストのみ: Lighthouse AI
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
            peerManager.send({
              type: "laser" as const,
              ...result.laser,
            });
          }
        }
      }

      // ホストのみ: 当たり判定
      if (peerManager.getIsHost()) {
        const hitResult = processHitDetection(
          playersRef.current,
          lasersRef.current,
          processedLasersRef.current,
          deadPlayersRef.current,
        );

        // processedLasersRef クリーンアップ
        const currentLaserIds = new Set(lasersRef.current.map((l) => l.id));
        for (const id of processedLasersRef.current) {
          if (!currentLaserIds.has(id)) {
            processedLasersRef.current.delete(id);
          }
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

            peerManager.send({
              type: "kill" as const,
              victimId,
              killerId,
              hitPos,
            });

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
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      for (const id of respawnTimeoutsRef.current) {
        clearTimeout(id);
      }
      respawnTimeoutsRef.current.clear();
    };
  }, [peerManager, myId, handleKill, handleRespawn, stale, keysPressed]);

  return (
    <div
      style={{
        position: "relative",
        width: "100dvw",
        height: "100dvh",
        backgroundColor: "#000",
        overflow: "hidden",
      }}
    >
      <HUD
        players={players}
        myId={myId}
        scores={scores}
        fps={fps}
        showInRestFrame={showInRestFrame}
        setShowInRestFrame={setShowInRestFrame}
        useOrthographic={useOrthographic}
        setUseOrthographic={setUseOrthographic}
        energy={energy}
        isFiring={isFiring}
        myLaserColor={
          myId
            ? getLaserColor(
                players.get(myId)?.color ?? getPlayerColor(myId),
              )
            : ""
        }
        deathFlash={deathFlash}
        killGlow={killNotification !== null}
        killNotification={killNotification}
        myDeathEvent={myDeathEventRef.current}
        getPlayerColor={getPlayerColor}
      />

      {useOrthographic ? (
        <Canvas
          key="ortho"
          orthographic
          camera={{
            zoom: 30,
            position: [0, 0, 100],
            near: -10000,
            far: 10000,
          }}
        >
          <SceneContent
            players={players}
            myId={myId}
            lasers={lasers}
            spawns={spawns}
            frozenWorldLines={frozenWorldLines}
            debrisRecords={debrisRecords}
            killNotification={killNotification}
            showInRestFrame={showInRestFrame}
            useOrthographic={true}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
          />
        </Canvas>
      ) : (
        <Canvas key="persp" camera={{ position: [0, 0, 0], fov: 75 }}>
          <SceneContent
            players={players}
            myId={myId}
            lasers={lasers}
            spawns={spawns}
            frozenWorldLines={frozenWorldLines}
            debrisRecords={debrisRecords}
            killNotification={killNotification}
            showInRestFrame={showInRestFrame}
            useOrthographic={false}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
          />
        </Canvas>
      )}
    </div>
  );
};

export default RelativisticGame;
