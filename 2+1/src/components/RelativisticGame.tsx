import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { usePeer } from "../hooks/usePeer";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
  evolvePhaseSpace,
  lorentzDotVector4,
  subVector4,
  type Vector4,
  vector3Zero,
} from "../physics";
import { getLaserColor, pickDistinctColor } from "./game/colors";
import {
  HIT_RADIUS,
  LASER_RANGE,
  MAX_LASERS,
  OFFSET,
  RESPAWN_DELAY,
  SPAWN_EFFECT_DURATION,
} from "./game/constants";
import { HUD } from "./game/HUD";
import { applyKill, applyRespawn } from "./game/killRespawn";
import { findLaserHitPosition } from "./game/laserPhysics";
import { createMessageHandler } from "./game/messageHandler";
import { SceneContent } from "./game/SceneContent";
import type { Laser, RelativisticPlayer, SpawnEffect } from "./game/types";
import { currentLife } from "./game/types";

/**
 * RelativisticGame (2+1 spacetime).
 *
 * English:
 *   - Renders an x-y-time arena in 3D using three.js (@react-three/fiber).
 *   - Time coordinate t is mapped to the Z axis for visualization.
 *   - Multiplayer state is synced via PeerJS (WebRTC). In this app, clients send to the host and the host relays.
 *
 * 日本語:
 *   - x-y-t のアリーナを three.js（@react-three/fiber）で 3D 表示します。
 *   - 可視化のため、時間座標 t を Z 軸に割り当てています。
 *   - マルチプレイ同期は PeerJS（WebRTC）。このアプリは基本的にホスト中継型です。
 */

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
  } | null>(null);
  const scoresRef = useRef<Record<string, number>>({});
  const [showInRestFrame, setShowInRestFrame] = useState(true);
  const [useOrthographic, setUseOrthographic] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTimeRef = useRef<number>(Date.now());
  const keysPressed = useRef<Set<string>>(new Set());
  const lastLaserTimeRef = useRef<number>(0); // レーザー発射クールダウン用
  const playersRef = useRef<Map<string, RelativisticPlayer>>(new Map()); // ゲームループ用
  const lasersRef = useRef<Laser[]>([]); // ゲームループ用（当たり判定）
  const timeSyncedRef = useRef<boolean>(false); // syncTime 受信済みフラグ（クライアント用）
  const processedLasersRef = useRef<Set<string>>(new Set()); // 判定済みレーザーID
  const deadPlayersRef = useRef<Set<string>>(new Set()); // リスポーン待ちのプレイヤー（ホスト用、同一フレーム二重キル防止）
  const pendingColorsRef = useRef<Map<string, string>>(new Map()); // playerColor が先に届いた場合の一時保存
  const [_screenSize, setScreenSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({ frameCount: 0, lastTime: performance.now() });
  // カメラ制御用の状態（ref のみで管理し、不要な再レンダーを防ぐ）
  const cameraYawRef = useRef(0); // xy平面内でのカメラの向き（ラジアン）
  const cameraPitchRef = useRef(Math.PI / 6); // 仰角（ラジアン、0=水平、正=上から見下ろす）初期値は30度

  // 初期化
  useEffect(() => {
    if (!myId) return;

    // 自分のプレイヤーを初期化（まだ存在しない場合のみ）
    setPlayers((prev) => {
      if (prev.has(myId)) {
        return prev;
      }

      const initialPhaseSpace = createPhaseSpace(
        createVector4(
          Date.now() / 1000 - OFFSET,
          Math.random() * 10,
          Math.random() * 10,
          0.0,
        ),
        vector3Zero(),
      );
      let worldLine = createWorldLine();
      worldLine = appendWorldLine(worldLine, initialPhaseSpace);

      const next = new Map(prev);
      next.set(myId, {
        id: myId,
        phaseSpace: initialPhaseSpace,
        lives: [worldLine],
        debrisRecords: [],
        color: pendingColorsRef.current.get(myId) ?? "hsl(0, 0%, 70%)", // pending にあれば使う、なければ仮色
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

    // 接続中のピアIDセット（自分自身を含む）
    const connectedIds = new Set(connections.map((c) => c.id));
    connectedIds.add(myId);

    // ホストの場合: 新 peer に syncTime + 色送信
    if (peerManager?.getIsHost()) {
      const myPlayer = playersRef.current.get(myId);
      if (myPlayer) {
        for (const conn of connections) {
          if (conn.open && !prevConnectionIdsRef.current.has(conn.id)) {
            peerManager.sendTo(conn.id, {
              type: "syncTime",
              hostTime: myPlayer.phaseSpace.pos.t,
            });
            // 既存全プレイヤーの色を新クライアントに送信
            for (const [pid, player] of playersRef.current) {
              peerManager.sendTo(conn.id, {
                type: "playerColor",
                playerId: pid,
                color: player.color,
              });
            }
          }
        }
      }
    }
    // open な接続のみ記録（open前に記録すると open時に「既知」扱いされてしまう）
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
        setDeathFlash,
        setKillNotification,
        scoresRef,
        playersRef,
        timeSyncedRef,
        pendingColorsRef,
      }),
    );

    return () => {
      peerManager.offMessage("relativistic");
    };
  }, [peerManager, myId]);

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
      // 矢印キーはそのまま、それ以外は小文字に
      if (key.startsWith("Arrow")) return key;
      return key.toLowerCase();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // 矢印キーとW/Sキーとスペースキーの場合はデフォルトの動作（スクロール）を防ぐ
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
      const dTau = Math.min(rawDTau, 0.1); // 上限100ms（タブ復帰時の巨大ジャンプ防止）
      lastTimeRef.current = currentTime;

      // ホスト: 自分の色が仮色なら確定させてブロードキャスト
      if (peerManager.getIsHost()) {
        const me = playersRef.current.get(myId);
        if (me && me.color === "hsl(0, 0%, 70%)") {
          const hostColor = pickDistinctColor(myId, playersRef.current);
          setPlayers((prev) => {
            const p = prev.get(myId);
            if (!p || p.color !== "hsl(0, 0%, 70%)") return prev;
            const next = new Map(prev);
            next.set(myId, { ...p, color: hostColor });
            return next;
          });
          peerManager.send({
            type: "playerColor" as const,
            playerId: myId,
            color: hostColor,
          });
        }
      }

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
        const calculatedFps = Math.round(
          (fpsRef.current.frameCount * 1000) / elapsed,
        );
        setFps(calculatedFps);
        fpsRef.current.frameCount = 0;
        fpsRef.current.lastTime = now;
      }

      // カメラ制御: 左右キーでyaw回転、上下キーでpitch回転（プレイヤーを中心に球面上を移動）
      const yawSpeed = 0.8; // rad/s
      const pitchSpeed = 0.5; // rad/s
      const pitchMin = (-Math.PI * 89.9) / 180; // 下限
      const pitchMax = (Math.PI * 89.9) / 180; // 上限

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

      // 死亡中は物理更新・レーザー発射・ネットワーク送信をスキップ
      // player.isDead フラグが正（kill で true、respawn メッセージで false）
      const isDead = playersRef.current.get(myId)?.isDead ?? false;

      // レーザー発射（スペースキー）
      const laserCooldown = 100; // ミリ秒
      if (
        !isDead &&
        keysPressed.current.has(" ") &&
        currentTime - lastLaserTimeRef.current > laserCooldown
      ) {
        const myPlayer = playersRef.current.get(myId);
        if (myPlayer) {
          lastLaserTimeRef.current = currentTime;

          // カメラyawから方向を計算
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

          // ローカルで追加
          setLasers((prev) => {
            const updated = [...prev, newLaser];
            // 最大数を超えたら古いものを削除
            if (updated.length > MAX_LASERS) {
              return updated.slice(updated.length - MAX_LASERS);
            }
            return updated;
          });

          // ネットワーク送信
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
        // 死亡中: 幽霊として等速直線運動（加速度ゼロ・摩擦ゼロ）
        // phaseSpace のみ更新（世界線追加なし、ネットワーク送信なし、他プレイヤーからは不可視）
        setPlayers((prev) => {
          const myPlayer = prev.get(myId);
          if (!myPlayer) return prev;
          const ghostAcceleration = createVector3(0, 0, 0);
          const ghostPhaseSpace = evolvePhaseSpace(
            myPlayer.phaseSpace,
            ghostAcceleration,
            dTau,
          );
          const next = new Map(prev);
          next.set(myId, { ...myPlayer, phaseSpace: ghostPhaseSpace });
          return next;
        });
      } else
        setPlayers((prev) => {
          const myPlayer = prev.get(myId);
          if (!myPlayer) return prev;
          // 他の誰かの未来光円錐を未来側に超えてしまうと因果律の守護者に時間停止を喰らう
          for (const [id, player] of prev) {
            if (id === myId) continue;
            if (player.phaseSpace.pos.t > myPlayer.phaseSpace.pos.t) continue;
            const diff = subVector4(
              player.phaseSpace.pos,
              myPlayer.phaseSpace.pos,
            );
            const l = lorentzDotVector4(diff, diff);
            if (l < 0) return prev;
          }

          const next = new Map(prev);

          // 加速度を計算（W/Sキー入力に基づく、カメラの向きに沿った方向）
          let forwardAccel = 0;
          const accel = 8 / 10; // 加速度 (c/s)

          if (keysPressed.current.has("w")) forwardAccel += accel;
          if (keysPressed.current.has("s")) forwardAccel -= accel;

          // カメラの向き（yaw）から前進方向を計算
          const ax = Math.cos(cameraYawRef.current) * forwardAccel;
          const ay = Math.sin(cameraYawRef.current) * forwardAccel;

          // 摩擦
          const mu = 0.5;
          const frictionX = -myPlayer.phaseSpace.u.x * mu;
          const frictionY = -myPlayer.phaseSpace.u.y * mu;

          const acceleration = createVector3(ax + frictionX, ay + frictionY, 0);

          // 相対論的運動方程式で更新
          const newPhaseSpace = evolvePhaseSpace(
            myPlayer.phaseSpace,
            acceleration,
            dTau,
          );
          // 他プレイヤーの位置を収集（因果的 trimming 用）
          const otherPositions: Vector4[] = [];
          for (const [id, p] of prev) {
            if (id !== myId) otherPositions.push(p.phaseSpace.pos);
          }
          const lastLife = currentLife(myPlayer);
          const updatedLife = appendWorldLine(
            lastLife,
            newPhaseSpace,
            otherPositions,
          );
          const lives = [...myPlayer.lives.slice(0, -1), updatedLife];
          next.set(myId, {
            ...myPlayer,
            phaseSpace: newPhaseSpace,
            lives,
          });

          // 他のプレイヤーに送信（クライアントは syncTime 受信後のみ）
          if (peerManager) {
            const isHost = peerManager.getIsHost();
            if (isHost || timeSyncedRef.current) {
              const msg = {
                type: "phaseSpace" as const,
                senderId: myId,
                position: newPhaseSpace.pos,
                velocity: newPhaseSpace.u,
              };

              if (isHost) {
                // ホストは直接全員に送信
                peerManager.send(msg);
              } else {
                // クライアントはホストにのみ送信
                const hostId = peerManager.getHostId();
                if (hostId) {
                  peerManager.sendTo(hostId, msg);
                }
              }
            }
          }

          return next;
        });

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

        // 全プレイヤーの最小 t を取得（レーザー期限切れ判定用）
        let minPlayerT = Number.POSITIVE_INFINITY;
        for (const [, player] of currentPlayers) {
          if (player.phaseSpace.pos.t < minPlayerT) {
            minPlayerT = player.phaseSpace.pos.t;
          }
        }

        const killedThisFrame = new Set<string>(); // 同フレーム二重キル防止
        for (const laser of currentLasers) {
          if (processedLasersRef.current.has(laser.id)) continue;

          // レーザーの到達時刻を超えていたらもう当たらない → 判定済みにする
          const laserEndT = laser.emissionPos.t + laser.range;
          if (minPlayerT > laserEndT) {
            processedLasersRef.current.add(laser.id);
            continue;
          }

          for (const [playerId, player] of currentPlayers) {
            if (playerId === laser.playerId) continue; // 自分のレーザーは除外
            if (killedThisFrame.has(playerId)) continue; // 既にこのフレームでキル済み
            if (deadPlayersRef.current.has(playerId)) continue; // リスポーン待ち中
            const hitPos = findLaserHitPosition(
              laser,
              currentLife(player),
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
              break; // 1レーザーにつき1キルまで
            }
          }
        }

        // processedLasersRef のクリーンアップ: lasers に存在しないIDを除去
        const currentLaserIds = new Set(currentLasers.map((l) => l.id));
        for (const id of processedLasersRef.current) {
          if (!currentLaserIds.has(id)) {
            processedLasersRef.current.delete(id);
          }
        }

        if (kills.length > 0) {
          // スコア更新
          const newScores = { ...scoresRef.current };
          for (const { killerId } of kills) {
            newScores[killerId] = (newScores[killerId] || 0) + 1;
          }
          scoresRef.current = newScores;
          setScores(newScores);

          // 判定済みレーザーを記録
          for (const id of hitLaserIds) {
            processedLasersRef.current.add(id);
          }

          // キル通知 → 爆発エフェクト → 遅延リスポーン
          for (const { victimId, killerId, hitPos } of kills) {
            const victim = currentPlayers.get(victimId);

            // 死亡プレイヤーとして登録（リスポーンまで当たり判定から除外）
            deadPlayersRef.current.add(victimId);

            // kill 通知をブロードキャスト
            peerManager.send({
              type: "kill" as const,
              victimId,
              killerId,
              hitPos,
            });

            // UI 副作用
            if (victimId === myId) {
              setDeathFlash(true);
              setTimeout(() => setDeathFlash(false), 600);
            }
            if (killerId === myId && victimId !== myId) {
              setKillNotification({
                victimName: victimId.slice(0, 6),
                color: victim?.color ?? "white",
              });
              setTimeout(() => setKillNotification(null), 1500);
            }

            // 状態更新: 世界線凍結 + デブリ + isDead
            setPlayers((prev) => applyKill(prev, victimId, hitPos));

            // 遅延リスポーン
            setTimeout(() => {
              const hostPlayer = playersRef.current.get(myId);
              const hostT = hostPlayer?.phaseSpace.pos.t ?? 0;
              const respawnPos = {
                t: hostT,
                x: Math.random() * 10,
                y: Math.random() * 10,
                z: 0,
              };

              deadPlayersRef.current.delete(victimId);
              peerManager.send({
                type: "respawn" as const,
                playerId: victimId,
                position: respawnPos,
              });

              // ローカルでもリスポーン適用
              setPlayers((prev) => applyRespawn(prev, victimId, respawnPos));

              // スポーンエフェクト
              const spawningPlayer = playersRef.current.get(victimId);
              setSpawns((prev) => [
                ...prev,
                {
                  id: `spawn-${victimId}-${Date.now()}`,
                  pos: respawnPos,
                  color: spawningPlayer?.color ?? "white",
                  startTime: Date.now(),
                },
              ]);
            }, RESPAWN_DELAY);
          }

          peerManager.send({ type: "score" as const, scores: newScores });
        }
      }
    };

    // setInterval を使用（requestAnimationFrame はタブ非アクティブ時に停止するため）
    intervalRef.current = setInterval(gameLoop, 8); // ~120fps

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [peerManager, myId]);

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
        killNotification={killNotification}
      />

      {useOrthographic ? (
        <Canvas
          key="ortho"
          orthographic
          camera={{ zoom: 30, position: [0, 0, 100], near: -10000, far: 10000 }}
        >
          <SceneContent
            players={players}
            myId={myId}
            lasers={lasers}
            spawns={spawns}
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
