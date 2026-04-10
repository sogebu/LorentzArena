import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePeer } from "../hooks/usePeer";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
  evolvePhaseSpace,
  getVelocity4,
  lorentzDotVector4,
  subVector4,
  type Vector4,
  vector3Zero,
} from "../physics";
import { colorForPlayerId, getLaserColor } from "./game/colors";
import {
  HIT_RADIUS,
  LASER_COOLDOWN,
  LASER_RANGE,
  MAX_DEBRIS,
  MAX_FROZEN_WORLDLINES,
  MAX_LASERS,
  OFFSET,
  RESPAWN_DELAY,
  SPAWN_EFFECT_DURATION,
  SPAWN_RANGE,
} from "./game/constants";
import { generateExplosionParticles } from "./game/debris";
import { HUD } from "./game/HUD";
import { applyKill, applyRespawn } from "./game/killRespawn";
import { findLaserHitPosition } from "./game/laserPhysics";
import { createMessageHandler } from "./game/messageHandler";
import { SceneContent } from "./game/SceneContent";
import type {
  DeathEvent,
  DebrisRecord,
  FrozenWorldLine,
  Laser,
  PendingKillEvent,
  RelativisticPlayer,
  SpawnEffect,
} from "./game/types";

const RelativisticGame = () => {
  const { peerManager, myId, connections } = usePeer();
  const [players, setPlayers] = useState<Map<string, RelativisticPlayer>>(
    new Map(),
  );
  const [lasers, setLasers] = useState<Laser[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [spawns, setSpawns] = useState<SpawnEffect[]>([]);
  const [deathFlash, setDeathFlash] = useState(false);
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
  const [useOrthographic, setUseOrthographic] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTimeRef = useRef<number>(Date.now());
  const keysPressed = useRef<Set<string>>(new Set());
  const lastLaserTimeRef = useRef<number>(0);
  const playersRef = useRef<Map<string, RelativisticPlayer>>(new Map());
  const lasersRef = useRef<Laser[]>([]);
  const timeSyncedRef = useRef<boolean>(false);
  const processedLasersRef = useRef<Set<string>>(new Set());
  const deadPlayersRef = useRef<Set<string>>(new Set());
  const respawnTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );
  const pendingKillEventsRef = useRef<PendingKillEvent[]>([]);
  const [_screenSize, setScreenSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({ frameCount: 0, lastTime: performance.now() });
  const cameraYawRef = useRef(0);
  const cameraPitchRef = useRef(Math.PI / 6);

  // Kill 処理: 世界線凍結 + デブリ生成 + isDead 設定
  // ホストのゲームループと messageHandler の両方から呼ばれる
  // UI 副作用（キル通知・スコア）は pendingKillEvents に積み、過去光円錐到達時に発火
  const handleKill = useCallback(
    (
      victimId: string,
      killerId: string,
      hitPos: { t: number; x: number; y: number; z: number },
    ) => {
      const victim = playersRef.current.get(victimId);
      if (!victim) return;

      // 1. 世界線を凍結して世界オブジェクトに
      setFrozenWorldLines((prev) => {
        const frozen: FrozenWorldLine = {
          worldLine: victim.worldLine,
          color: victim.color,
          showHalfLine: victim.worldLine.origin !== null,
        };
        return [...prev, frozen].slice(-MAX_FROZEN_WORLDLINES);
      });

      // 2. デブリ生成（reducer 外で particle 生成: Math.random が StrictMode で二重実行されるのを防ぐ）
      const explosionParticles = generateExplosionParticles();
      setDebrisRecords((prev) => {
        const newDebris: DebrisRecord = {
          deathPos: hitPos,
          particles: explosionParticles,
          color: victim.color,
        };
        return [...prev, newDebris].slice(-MAX_DEBRIS);
      });

      // 3. プレイヤーを isDead に
      setPlayers((prev) => applyKill(prev, victimId));

      // 4. 自分が殺された場合: ゴーストカメラ用の DeathEvent を設定
      if (victimId === myId) {
        myDeathEventRef.current = {
          pos: victim.phaseSpace.pos,
          u: getVelocity4(victim.phaseSpace.u), // Vector3 → Vector4（γ を計算）
        };
        ghostTauRef.current = 0;
      }

      // 5. UI エフェクトを pending に追加（過去光円錐到達時に発火）
      // 自分が当事者（被害者 or 加害者）の場合のみ
      if (victimId === myId || killerId === myId) {
        pendingKillEventsRef.current.push({
          victimId,
          killerId,
          hitPos,
          victimName: victimId.slice(0, 6),
          victimColor: victim.color,
        });
        // 上限を超えたら最古のイベントを削除（メモリ保護）
        if (pendingKillEventsRef.current.length > 100) {
          pendingKillEventsRef.current =
            pendingKillEventsRef.current.slice(-100);
        }
      }
    },
    [myId],
  );

  // Respawn 処理
  const handleRespawn = useCallback(
    (
      playerId: string,
      position: { t: number; x: number; y: number; z: number },
    ) => {
      setPlayers((prev) => applyRespawn(prev, playerId, position));

      // 自分のリスポーン: ゴースト解除
      if (playerId === myId) {
        myDeathEventRef.current = null;
        ghostTauRef.current = 0;
      }

      // スポーンエフェクト（id と startTime は reducer 外で決定 = StrictMode 安全）
      const spawningPlayer = playersRef.current.get(playerId);
      const now = Date.now();
      const spawnEffect: SpawnEffect = {
        id: `spawn-${playerId}-${now}`,
        pos: position,
        color: spawningPlayer?.color ?? colorForPlayerId(playerId),
        startTime: now,
      };
      setSpawns((prev) => [...prev, spawnEffect]);
    },
    [myId],
  );

  // 初期化
  useEffect(() => {
    if (!myId) return;

    // 非決定的な値（Date.now, Math.random）は reducer 外で計算して closure に束縛。
    // StrictMode の reducer 二重実行でも同じ値を使うようにする。
    const initialPhaseSpace = createPhaseSpace(
      createVector4(
        Date.now() / 1000 - OFFSET,
        Math.random() * SPAWN_RANGE,
        Math.random() * SPAWN_RANGE,
        0.0,
      ),
      vector3Zero(),
    );
    let initialWorldLine = createWorldLine(5000, initialPhaseSpace);
    initialWorldLine = appendWorldLine(initialWorldLine, initialPhaseSpace);
    const initialColor = colorForPlayerId(myId);

    setPlayers((prev) => {
      if (prev.has(myId)) return prev;
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
  }, [myId]);

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

    if (peerManager?.getIsHost()) {
      const myPlayer = playersRef.current.get(myId);
      if (myPlayer) {
        for (const conn of connections) {
          if (conn.open && !prevConnectionIdsRef.current.has(conn.id)) {
            peerManager.sendTo(conn.id, {
              type: "syncTime",
              hostTime: myPlayer.phaseSpace.pos.t,
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
        if (!connectedIds.has(playerId)) {
          idsToRemove.push(playerId);
        }
      }
      if (idsToRemove.length === 0) return prev;
      const next = new Map(prev);
      for (const id of idsToRemove) {
        next.delete(id);
        deadPlayersRef.current.delete(id); // 切断時に dead 状態もクリア
      }
      return next;
    });
  }, [connections, myId, peerManager]);

  // メッセージ受信処理
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
        setSpawns,
        scoresRef,
        timeSyncedRef,
        handleKill,
        handleRespawn,
      }),
    );

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

  // キーボード入力処理
  useEffect(() => {
    const normalizeKey = (key: string) => {
      if (key.startsWith("Arrow")) return key;
      return key.toLowerCase();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "w",
          "W",
          "s",
          "S",
          " ",
        ].includes(e.key)
      ) {
        e.preventDefault();
      }
      keysPressed.current.add(normalizeKey(e.key));
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(normalizeKey(e.key));
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // ゲームループ
  useEffect(() => {
    if (!peerManager || !myId) return;

    const gameLoop = () => {
      const currentTime = Date.now();
      const rawDTau = (currentTime - lastTimeRef.current) / 1000;
      const dTau = Math.min(rawDTau, 0.1);
      lastTimeRef.current = currentTime;

      // 期限切れのスポーンエフェクトを削除
      setSpawns((prev) => {
        const alive = prev.filter(
          (e) => currentTime - e.startTime < SPAWN_EFFECT_DURATION,
        );
        return alive.length === prev.length ? prev : alive;
      });

      // FPS計算
      const now = performance.now();
      fpsRef.current.frameCount++;
      const elapsed = now - fpsRef.current.lastTime;
      if (elapsed >= 1000) {
        setFps(Math.round((fpsRef.current.frameCount * 1000) / elapsed));
        fpsRef.current.frameCount = 0;
        fpsRef.current.lastTime = now;
      }

      // カメラ制御（死亡中も操作可能）
      const yawSpeed = 0.8;
      const pitchSpeed = 0.5;
      const pitchMin = (-Math.PI * 89.9) / 180;
      const pitchMax = (Math.PI * 89.9) / 180;

      if (keysPressed.current.has("ArrowLeft")) {
        cameraYawRef.current += yawSpeed * dTau;
      }
      if (keysPressed.current.has("ArrowRight")) {
        cameraYawRef.current -= yawSpeed * dTau;
      }
      if (keysPressed.current.has("ArrowUp")) {
        cameraPitchRef.current = Math.min(
          pitchMax,
          cameraPitchRef.current + pitchSpeed * dTau,
        );
      }
      if (keysPressed.current.has("ArrowDown")) {
        cameraPitchRef.current = Math.max(
          pitchMin,
          cameraPitchRef.current - pitchSpeed * dTau,
        );
      }

      // 因果律遅延キル通知: pending kill events の過去光円錐チェック
      const myPos = playersRef.current.get(myId)?.phaseSpace.pos;
      if (myPos && pendingKillEventsRef.current.length > 0) {
        const fired: number[] = [];
        for (let i = 0; i < pendingKillEventsRef.current.length; i++) {
          const ev = pendingKillEventsRef.current[i];
          const diff = subVector4(
            createVector4(ev.hitPos.t, ev.hitPos.x, ev.hitPos.y, ev.hitPos.z),
            myPos,
          );
          // 過去光円錐内: lorentzDot <= 0（時間的 or 光的）かつ hitPos が過去
          if (lorentzDotVector4(diff, diff) <= 0 && myPos.t > ev.hitPos.t) {
            fired.push(i);
            // 自分が殺された: death flash
            if (ev.victimId === myId) {
              setDeathFlash(true);
              setTimeout(() => setDeathFlash(false), 600);
            }
            // 自分が殺した: kill notification（キル時空点に表示）
            if (ev.killerId === myId && ev.victimId !== myId) {
              setKillNotification({
                victimName: ev.victimName,
                color: ev.victimColor,
                hitPos: ev.hitPos,
              });
              setTimeout(() => setKillNotification(null), 1500);
            }
          }
        }
        if (fired.length > 0) {
          pendingKillEventsRef.current = pendingKillEventsRef.current.filter(
            (_, i) => !fired.includes(i),
          );
        }
      }

      const isDead = playersRef.current.get(myId)?.isDead ?? false;

      // レーザー発射（スペースキー）
      if (
        !isDead &&
        keysPressed.current.has(" ") &&
        currentTime - lastLaserTimeRef.current > LASER_COOLDOWN
      ) {
        const myPlayer = playersRef.current.get(myId);
        if (myPlayer) {
          lastLaserTimeRef.current = currentTime;
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

      if (isDead) {
        // 死亡中: ゴーストとして等速直線運動（DeathEvent から決定論的に計算）
        ghostTauRef.current += dTau;
        // observer 位置を更新（SceneContent が phaseSpace.pos を参照するため）
        const de = myDeathEventRef.current;
        if (de) {
          const tau = ghostTauRef.current;
          const ghostPos = createVector4(
            de.pos.t + de.u.t * tau,
            de.pos.x + de.u.x * tau,
            de.pos.y + de.u.y * tau,
            0,
          );
          setPlayers((prev) => {
            const me = prev.get(myId);
            if (!me) return prev;
            const next = new Map(prev);
            next.set(myId, {
              ...me,
              phaseSpace: createPhaseSpace(
                ghostPos,
                createVector3(de.u.x, de.u.y, de.u.z),
              ),
            });
            return next;
          });
        }
      } else {
        // 因果律チェックと物理積分を reducer 外で実行（StrictMode 安全）。
        // setPlayers reducer 内で peerManager.send を呼ぶと StrictMode の
        // 二重実行で dev モード時に送信が倍になる（色バグと同じ anti-pattern）。
        const me = playersRef.current.get(myId);
        if (me) {
          // 因果律の守護者
          let frozen = false;
          for (const [id, player] of playersRef.current) {
            if (id === myId) continue;
            if (player.isDead) continue;
            if (player.phaseSpace.pos.t > me.phaseSpace.pos.t) continue;
            const diff = subVector4(player.phaseSpace.pos, me.phaseSpace.pos);
            const l = lorentzDotVector4(diff, diff);
            if (l < 0) {
              frozen = true;
              break;
            }
          }

          if (!frozen) {
            let forwardAccel = 0;
            const accel = 8 / 10;
            if (keysPressed.current.has("w")) forwardAccel += accel;
            if (keysPressed.current.has("s")) forwardAccel -= accel;

            const ax = Math.cos(cameraYawRef.current) * forwardAccel;
            const ay = Math.sin(cameraYawRef.current) * forwardAccel;

            const mu = 0.5;
            const frictionX = -me.phaseSpace.u.x * mu;
            const frictionY = -me.phaseSpace.u.y * mu;

            const acceleration = createVector3(
              ax + frictionX,
              ay + frictionY,
              0,
            );

            const newPhaseSpace = evolvePhaseSpace(
              me.phaseSpace,
              acceleration,
              dTau,
            );
            const otherPositions: Vector4[] = [];
            for (const [id, p] of playersRef.current) {
              if (id !== myId) otherPositions.push(p.phaseSpace.pos);
            }
            const updatedWorldLine = appendWorldLine(
              me.worldLine,
              newPhaseSpace,
              otherPositions,
            );

            setPlayers((prev) => {
              const myPlayer = prev.get(myId);
              if (!myPlayer) return prev;
              const next = new Map(prev);
              next.set(myId, {
                ...myPlayer,
                phaseSpace: newPhaseSpace,
                worldLine: updatedWorldLine,
              });
              return next;
            });

            // ネットワーク送信（reducer の外、1 回だけ実行）
            const isHost = peerManager.getIsHost();
            if (isHost || timeSyncedRef.current) {
              const msg = {
                type: "phaseSpace" as const,
                senderId: myId,
                position: newPhaseSpace.pos,
                velocity: newPhaseSpace.u,
              };
              if (isHost) {
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
      }

      // ホストのみ: 当たり判定
      if (peerManager.getIsHost()) {
        const currentPlayers = playersRef.current;
        const currentLasers = lasersRef.current;
        const hitLaserIds: string[] = [];
        const kills: {
          victimId: string;
          killerId: string;
          hitPos: { t: number; x: number; y: number; z: number };
        }[] = [];

        let minPlayerT = Number.POSITIVE_INFINITY;
        for (const [, player] of currentPlayers) {
          if (player.phaseSpace.pos.t < minPlayerT) {
            minPlayerT = player.phaseSpace.pos.t;
          }
        }

        const killedThisFrame = new Set<string>();
        for (const laser of currentLasers) {
          if (processedLasersRef.current.has(laser.id)) continue;

          const laserEndT = laser.emissionPos.t + laser.range;
          if (minPlayerT > laserEndT) {
            processedLasersRef.current.add(laser.id);
            continue;
          }

          for (const [playerId, player] of currentPlayers) {
            if (playerId === laser.playerId) continue;
            if (killedThisFrame.has(playerId)) continue;
            if (deadPlayersRef.current.has(playerId)) continue;
            const hitPos = findLaserHitPosition(
              laser,
              player.worldLine,
              HIT_RADIUS,
            );
            if (hitPos) {
              kills.push({
                victimId: playerId,
                killerId: laser.playerId,
                hitPos,
              });
              hitLaserIds.push(laser.id);
              killedThisFrame.add(playerId);
              break;
            }
          }
        }

        // processedLasersRef のクリーンアップ
        const currentLaserIds = new Set(currentLasers.map((l) => l.id));
        for (const id of processedLasersRef.current) {
          if (!currentLaserIds.has(id)) {
            processedLasersRef.current.delete(id);
          }
        }
        // 安全弁: サイズ上限を超えたらクリア（長時間プレイでの蓄積防止）
        if (processedLasersRef.current.size > 2000) {
          processedLasersRef.current.clear();
        }

        if (kills.length > 0) {
          // ホスト権威: スコアは即時更新 + ブロードキャスト
          const newScores = { ...scoresRef.current };
          for (const { killerId } of kills) {
            newScores[killerId] = (newScores[killerId] || 0) + 1;
          }
          scoresRef.current = newScores;
          setScores(newScores);

          for (const id of hitLaserIds) {
            processedLasersRef.current.add(id);
          }

          for (const { victimId, killerId, hitPos } of kills) {
            deadPlayersRef.current.add(victimId);

            // kill 通知をブロードキャスト
            peerManager.send({
              type: "kill" as const,
              victimId,
              killerId,
              hitPos,
            });

            // データ更新 + UI pending: handleKill で一括処理
            handleKill(victimId, killerId, hitPos);

            // 遅延リスポーン
            const timerId = setTimeout(() => {
              respawnTimeoutsRef.current.delete(timerId);
              // 全プレイヤーのうち最も未来の座標時刻でリスポーン
              // → リスポーン直後に誰かの未来光円錐内に入って因果律の守護者が発動するのを防ぐ
              let maxT = 0;
              for (const [, p] of playersRef.current) {
                if (
                  Number.isFinite(p.phaseSpace.pos.t) &&
                  p.phaseSpace.pos.t > maxT
                ) {
                  maxT = p.phaseSpace.pos.t;
                }
              }
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

          peerManager.send({ type: "score" as const, scores: newScores });
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
  // NOTE: myDeathEvent is intentionally read via myDeathEventRef (not state)
  // to avoid re-running this effect on kill/respawn, which would clear
  // respawn timeouts and prevent the host from respawning.
  }, [peerManager, myId, handleKill, handleRespawn]);

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
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
        deathFlash={deathFlash}
        killGlow={killNotification !== null}
        killNotification={killNotification}
        myDeathEvent={myDeathEventRef.current}
        ghostTau={ghostTauRef.current}
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
