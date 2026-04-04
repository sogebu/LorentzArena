import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  createVector4,
  lorentzBoost,
  pastLightConeIntersectionWorldLine,
  positionAlongStraightWorldLine,
  type Vector4,
} from "../../physics";
import { SPAWN_EFFECT_DURATION } from "./constants";
import { pastLightConeIntersectionDebris } from "./debris";
import {
  buildDisplayMatrix,
  transformEventForDisplay,
} from "./displayTransform";
import { pastLightConeIntersectionLaser } from "./laserPhysics";
import { getThreeColor, sharedGeometries } from "./threeCache";
import type {
  DisplayLaser,
  Laser,
  SceneContentProps,
  SpawnEffect,
  WorldLineRendererProps,
} from "./types";

// WorldLineRenderer コンポーネント - 個別のワールドラインを描画

const WorldLineRenderer = ({
  worldLine: wl,
  color: colorStr,
  showHalfLine,
  observerPos,
  observerBoost,
}: WorldLineRendererProps) => {
  const [geometry, setGeometry] = useState<THREE.TubeGeometry | null>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const history = wl.history;
  const origin = wl.origin;

  // geometry は世界系座標で生成（history が変わったときだけ再生成）
  // showHalfLine が true なら origin から過去方向への半直線も含む
  useEffect(() => {
    if (history.length < 2 && !(showHalfLine && origin)) {
      // リスポーン直後など: 古い geometry をクリア
      setGeometry((prev) => {
        if (prev) prev.dispose();
        return null;
      });
      return;
    }

    const points: THREE.Vector3[] = [];

    // 半直線の端点: origin から��去方向に座標時間100単位分（最初の命のみ）
    if (showHalfLine && origin) {
      const HALF_LINE_LENGTH = 100; // 座標時間で100単位分
      const pastEnd = positionAlongStraightWorldLine(origin, HALF_LINE_LENGTH);
      points.push(new THREE.Vector3(pastEnd.x, pastEnd.y, pastEnd.t));

      // origin 自体が history[0] と異なる場合（trimming 後）origin を追加
      if (history.length === 0 || origin.pos.t !== history[0].pos.t) {
        points.push(
          new THREE.Vector3(origin.pos.x, origin.pos.y, origin.pos.t),
        );
      }
    }

    // history の各点
    for (const ps of history) {
      points.push(new THREE.Vector3(ps.pos.x, ps.pos.y, ps.pos.t));
    }

    if (points.length < 2) {
      setGeometry((prev) => {
        if (prev) prev.dispose();
        return null;
      });
      return;
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeometry = new THREE.TubeGeometry(
      curve,
      Math.min(points.length * 2, 1000),
      0.05,
      8,
      false,
    );

    setGeometry((prev) => {
      if (prev) prev.dispose();
      return tubeGeometry;
    });
  }, [history, origin, showHalfLine]);

  // 表示変換はメッシュの行列として毎フレーム適用（geometry 再生成不要）
  useFrame(() => {
    if (!meshRef.current) return;
    const displayMatrix = buildDisplayMatrix(observerPos, observerBoost);
    meshRef.current.matrix.copy(displayMatrix);
    meshRef.current.matrixWorldNeedsUpdate = true;
  });

  // アンマウント時に geometry を破棄
  useEffect(() => {
    return () => {
      setGeometry((prev) => {
        if (prev) prev.dispose();
        return null;
      });
    };
  }, []);

  const color = getThreeColor(colorStr);

  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} matrixAutoUpdate={false}>
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.9}
      />
    </mesh>
  );
};

// LaserRenderer コンポーネント - 個別のレーザーを���画
const LaserRenderer = ({ laser }: { laser: DisplayLaser }) => {
  const geometry = useMemo(() => {
    const startPoint = new THREE.Vector3(
      laser.start.x,
      laser.start.y,
      laser.start.t,
    );
    const endPoint = new THREE.Vector3(laser.end.x, laser.end.y, laser.end.t);
    const curve = new THREE.LineCurve3(startPoint, endPoint);
    return new THREE.TubeGeometry(curve, 2, 0.05, 8, false);
  }, [laser]);

  const color = useMemo(() => getThreeColor(laser.color), [laser.color]);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.4,
      }),
    [color],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return <mesh geometry={geometry} material={material} />;
};

// スポーンエフェクトコンポーネント — 同心円リングが時間軸に沿って脈動
const SpawnRenderer = ({
  spawn,
  observerPos,
  observerBoost,
}: {
  spawn: SpawnEffect;
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
}) => {
  const elapsed = Date.now() - spawn.startTime;
  const progress = Math.min(elapsed / SPAWN_EFFECT_DURATION, 1);
  const opacity = 1 - progress;

  const color = useMemo(() => getThreeColor(spawn.color), [spawn.color]);

  if (opacity <= 0) return null;

  const spawnEvent = createVector4(
    spawn.pos.t,
    spawn.pos.x,
    spawn.pos.y,
    spawn.pos.z,
  );

  // 5本のリングが時間軸に沿って配置、収縮アニメーション
  const ringCount = 5;
  return (
    <>
      {Array.from({ length: ringCount }, (_, i) => {
        const ringProgress = (progress * 3 + i / ringCount) % 1; // 各リングの位相をずらす
        const ringRadius = (1 - ringProgress) * 4; // 収縮: 大きい → 小さい
        const ringOpacity = opacity * (1 - ringProgress) * 0.8;
        const ringT = spawn.pos.t + i * 0.5; // 時間軸に沿って配置

        const worldPos = createVector4(ringT, spawn.pos.x, spawn.pos.y, 0);
        const displayPos = transformEventForDisplay(
          worldPos,
          observerPos,
          observerBoost,
        );

        if (ringRadius < 0.1 || ringOpacity < 0.01) return null;

        return (
          <mesh
            key={i}
            position={[displayPos.x, displayPos.y, displayPos.t]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <torusGeometry args={[ringRadius, 0.06, 8, 24]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={ringOpacity}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
      {/* 中心の光柱（時間軸方向） */}
      {(() => {
        const pillarHeight = 6 * (1 - progress * 0.5);
        const displayPos = transformEventForDisplay(
          spawnEvent,
          observerPos,
          observerBoost,
        );
        return (
          <mesh
            position={[
              displayPos.x,
              displayPos.y,
              displayPos.t + pillarHeight / 2,
            ]}
          >
            <cylinderGeometry args={[0.08, 0.08, pillarHeight, 6]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={opacity * 0.6}
            />
          </mesh>
        );
      })()}
    </>
  );
};

// 3Dシーンコンテンツコンポーネント
export const SceneContent = ({
  players,
  myId,
  lasers,
  spawns,
  showInRestFrame,
  useOrthographic,
  cameraYawRef,
  cameraPitchRef,
}: SceneContentProps) => {
  // プレイヤーリストをメモ化
  const playerList = useMemo(() => Array.from(players.values()), [players]);
  const myPlayer = useMemo(
    () => (myId ? (players.get(myId) ?? null) : null),
    [players, myId],
  );
  const observerPos = myPlayer?.phaseSpace.pos ?? null;
  const observerBoost = useMemo(
    () =>
      showInRestFrame && myPlayer ? lorentzBoost(myPlayer.phaseSpace.u) : null,
    [showInRestFrame, myPlayer],
  );
  const displayLasers = useMemo<DisplayLaser[]>(() => {
    return lasers.map((laser) => {
      const worldStart = createVector4(
        laser.emissionPos.t,
        laser.emissionPos.x,
        laser.emissionPos.y,
        laser.emissionPos.z,
      );
      const worldEnd = createVector4(
        laser.emissionPos.t + laser.range,
        laser.emissionPos.x + laser.direction.x * laser.range,
        laser.emissionPos.y + laser.direction.y * laser.range,
        laser.emissionPos.z + laser.direction.z * laser.range,
      );

      return {
        id: laser.id,
        color: laser.color,
        start: transformEventForDisplay(worldStart, observerPos, observerBoost),
        end: transformEventForDisplay(worldEnd, observerPos, observerBoost),
      };
    });
  }, [lasers, observerPos, observerBoost]);

  // カメラの位置をプレイヤー位置から計算（球面座標）
  useFrame(({ camera }) => {
    if (!myPlayer) return;

    // 静止系: 原点追尾、世界系: プレイヤーの世界系座標に追随
    const targetX = showInRestFrame ? 0 : myPlayer.phaseSpace.pos.x;
    const targetY = showInRestFrame ? 0 : myPlayer.phaseSpace.pos.y;
    const targetT = showInRestFrame ? 0 : myPlayer.phaseSpace.pos.t;
    // カメラの距離（プレイヤーからの距離、固定）
    const cameraDistance = useOrthographic ? 100 : 15;
    // カメラ位置: プレイヤーを中心とした球面上
    const cameraYaw = cameraYawRef.current;
    const cameraPitch = cameraPitchRef.current;
    // 球面座標からデカルト座標へ変換
    const camX =
      targetX - Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraDistance;
    const camY =
      targetY - Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraDistance;
    const camT = targetT - Math.sin(cameraPitch) * cameraDistance;

    camera.position.set(camX, camY, camT);
    camera.lookAt(targetX, targetY, targetT);
    camera.up.set(0, 0, 1);
  });
  const worldLineIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];

    return playerList
      .filter((player) => player.id !== myId)
      .flatMap((player) => {
        // 全ライフを新→旧の順に検索
        for (let j = player.lives.length - 1; j >= 0; j--) {
          const wl = player.lives[j];
          const intersection = pastLightConeIntersectionWorldLine(
            wl,
            myPlayer.phaseSpace.pos,
          );
          if (intersection) {
            return [
              {
                playerId: player.id,
                color: player.color,
                pos: transformEventForDisplay(
                  intersection.pos,
                  observerPos,
                  observerBoost,
                ),
              },
            ];
          }
        }
        return [];
      });
  }, [myPlayer, myId, playerList, observerPos, observerBoost]);
  const laserIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];

    return lasers
      .map((laser) => {
        const intersection = pastLightConeIntersectionLaser(
          laser,
          myPlayer.phaseSpace.pos,
        );
        if (!intersection) return null;
        return {
          laser,
          pos: transformEventForDisplay(
            intersection,
            observerPos,
            observerBoost,
          ),
        };
      })
      .filter(
        (value): value is { laser: Laser; pos: Vector4 } => value !== null,
      );
  }, [lasers, myPlayer, myId, observerPos, observerBoost]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />

      {/* 全プレイヤーの全ライフの世界線を描画 */}
      {playerList.map((player) => (
        <group key={`worldlines-${player.id}`}>
          {player.lives.map((wl, i) => (
            <WorldLineRenderer
              key={`worldline-${player.id}-${i}-${wl.history[0]?.pos.t ?? 0}`}
              worldLine={wl}
              color={player.color}
              showHalfLine={i === 0}
              observerPos={observerPos}
              observerBoost={observerBoost}
            />
          ))}
        </group>
      ))}

      {/* 各プレイヤーのマーカー（死亡中 → 非表示） */}
      {playerList.map((player) => {
        if (player.isDead) return null;

        const pos = transformEventForDisplay(
          player.phaseSpace.pos,
          observerPos,
          observerBoost,
        );
        const isMe = player.id === myId;
        const color = getThreeColor(player.color);
        const size = isMe ? 0.42 : 0.2;

        return (
          <group key={`player-${player.id}`} position={[pos.x, pos.y, pos.t]}>
            <mesh
              scale={[size, size, size]}
              geometry={sharedGeometries.playerSphere}
            >
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={isMe ? 1.0 : 0.4}
                roughness={0.3}
                metalness={0.1}
                transparent={!isMe}
                opacity={isMe ? 1.0 : 0.5}
              />
            </mesh>
            <mesh
              scale={[size * 1.8, size * 1.8, size * 1.8]}
              geometry={sharedGeometries.playerSphere}
            >
              <meshBasicMaterial
                color={color}
                transparent
                opacity={isMe ? 0.32 : 0.1}
              />
            </mesh>
          </group>
        );
      })}

      {/* 自分の光円錐のみ描画（死亡中も表示 = 幽霊の位置に追随） */}
      {playerList
        .filter((p) => p.id === myId)
        .map((player) => {
          const pos = transformEventForDisplay(
            player.phaseSpace.pos,
            observerPos,
            observerBoost,
          );
          const color = getThreeColor(player.color);
          const coneHeight = 40;
          const coneMat = (
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.5}
              side={THREE.DoubleSide}
              wireframe
            />
          );

          return (
            <group key={`lightcone-${player.id}`}>
              {/* 未来光円錐 */}
              <mesh
                position={[pos.x, pos.y, pos.t + coneHeight / 2]}
                rotation={[-Math.PI / 2, 0.0, 0.0]}
                geometry={sharedGeometries.lightCone}
              >
                {coneMat}
              </mesh>
              {/* 過去光円錐 */}
              <mesh
                position={[pos.x, pos.y, pos.t - coneHeight / 2]}
                rotation={[Math.PI / 2, 0.0, 0.0]}
                geometry={sharedGeometries.lightCone}
              >
                {coneMat}
              </mesh>
            </group>
          );
        })}

      {/* 自分の過去光円錐と他プレイヤーの世界線の交点 */}
      {worldLineIntersections.map(({ playerId, color: colorText, pos }) => {
        const color = getThreeColor(colorText);
        return (
          <group
            key={`intersection-${playerId}`}
            position={[pos.x, pos.y, pos.t]}
          >
            <mesh geometry={sharedGeometries.intersectionSphere}>
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={1.15}
              />
            </mesh>
            <mesh geometry={sharedGeometries.intersectionCore}>
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            <mesh geometry={sharedGeometries.intersectionRing}>
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.9}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        );
      })}

      {/* 各レーザーと自分の過去光円錐の交点（自分のレーザーも含む） */}
      {laserIntersections.map(({ laser, pos }) => {
        const color = getThreeColor(laser.color);
        return (
          <group
            key={`laser-intersection-${laser.id}`}
            position={[pos.x, pos.y, pos.t]}
          >
            <mesh geometry={sharedGeometries.laserIntersectionDot}>
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={1.1}
                roughness={0.25}
                metalness={0.1}
              />
            </mesh>
          </group>
        );
      })}

      {/* レーザーを描画 */}
      {displayLasers.map((laser) => (
        <LaserRenderer key={laser.id} laser={laser} />
      ))}

      {/* 永続デブリの世界線 + 過去光円錐交差マーカー */}
      {myPlayer &&
        playerList.flatMap((player) =>
          player.debrisRecords.flatMap((debris, di) => {
            const deathEvent = createVector4(
              debris.deathPos.t,
              debris.deathPos.x,
              debris.deathPos.y,
              0,
            );
            const maxLambda = Math.max(
              0,
              myPlayer.phaseSpace.pos.t - debris.deathPos.t,
            );
            if (maxLambda < 0.5) return [];
            const debrisColor = getThreeColor(debris.color);

            return debris.particles.flatMap((p, pi) => {
              const elements: React.ReactNode[] = [];

              // デブリの世界線チューブ（始点 → 観測者の時刻まで）
              const startDisplay = transformEventForDisplay(
                deathEvent,
                observerPos,
                observerBoost,
              );
              const endWorld = createVector4(
                debris.deathPos.t + maxLambda,
                debris.deathPos.x + p.dx * maxLambda,
                debris.deathPos.y + p.dy * maxLambda,
                0,
              );
              const endDisplay = transformEventForDisplay(
                endWorld,
                observerPos,
                observerBoost,
              );
              const lineGeom = new THREE.BufferGeometry();
              lineGeom.setAttribute(
                "position",
                new THREE.Float32BufferAttribute(
                  [
                    startDisplay.x, startDisplay.y, startDisplay.t,
                    endDisplay.x, endDisplay.y, endDisplay.t,
                  ],
                  3,
                ),
              );
              elements.push(
                <line key={`debris-line-${player.id}-${di}-${pi}`} geometry={lineGeom}>
                  <lineBasicMaterial
                    color={debrisColor}
                    transparent
                    opacity={0.15}
                  />
                </line>,
              );

              // 過去光円錐との交差マーカー
              const intersection = pastLightConeIntersectionDebris(
                deathEvent,
                p.dx,
                p.dy,
                maxLambda,
                myPlayer.phaseSpace.pos,
              );
              if (intersection) {
                const displayPos = transformEventForDisplay(
                  intersection,
                  observerPos,
                  observerBoost,
                );
                elements.push(
                  <mesh
                    key={`debris-${player.id}-${di}-${pi}`}
                    position={[displayPos.x, displayPos.y, displayPos.t]}
                    scale={[p.size * 1.5, p.size * 1.5, p.size * 1.5]}
                    geometry={sharedGeometries.explosionParticle}
                  >
                    <meshBasicMaterial
                      color={debrisColor}
                      transparent
                      opacity={0.7}
                    />
                  </mesh>,
                );
              }

              return elements;
            });
          }),
        )}

      {/* スポーンエフェクトを描画 */}
      {spawns.map((spawn) => (
        <SpawnRenderer
          key={spawn.id}
          spawn={spawn}
          observerPos={observerPos}
          observerBoost={observerBoost}
        />
      ))}
    </>
  );
};
