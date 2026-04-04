import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
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
import {
  getDebrisMaterial,
  getThreeColor,
  sharedGeometries,
} from "./threeCache";
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
  color,
  showHalfLine,
  observerPos,
  observerBoost,
}: WorldLineRendererProps) => {
  const tubeRef = useRef<THREE.Mesh>(null);
  const halfLineRef = useRef<THREE.Mesh>(null);

  const tubeGeo = useMemo(() => {
    if (wl.history.length < 2) return null;
    const points = wl.history.map(
      (ps) => new THREE.Vector3(ps.pos.x, ps.pos.y, ps.pos.t),
    );
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.5);
    const segments = Math.max(1, points.length * 2);
    return new THREE.TubeGeometry(curve, segments, 0.04, 6, false);
  }, [wl.history]);

  const halfLineGeo = useMemo(() => {
    if (!showHalfLine || !wl.origin) return null;
    const o = wl.origin;
    const len = 200;
    const start = positionAlongStraightWorldLine(o, len);
    const end = new THREE.Vector3(o.pos.x, o.pos.y, o.pos.t);
    const startVec = new THREE.Vector3(start.x, start.y, start.t);
    const curve = new THREE.LineCurve3(startVec, end);
    return new THREE.TubeGeometry(curve, 2, 0.04, 6, false);
  }, [showHalfLine, wl.origin]);

  const displayMatrix = buildDisplayMatrix(observerPos, observerBoost);
  useFrame(() => {
    if (tubeRef.current) {
      tubeRef.current.matrix.copy(displayMatrix);
      tubeRef.current.matrixAutoUpdate = false;
    }
    if (halfLineRef.current) {
      halfLineRef.current.matrix.copy(displayMatrix);
      halfLineRef.current.matrixAutoUpdate = false;
    }
  });

  const threeColor = getThreeColor(color);
  return (
    <>
      {tubeGeo && (
        <mesh ref={tubeRef} geometry={tubeGeo}>
          <meshStandardMaterial
            color={threeColor}
            emissive={threeColor}
            emissiveIntensity={0.4}
            roughness={0.4}
            metalness={0.1}
          />
        </mesh>
      )}
      {halfLineGeo && (
        <mesh ref={halfLineRef} geometry={halfLineGeo}>
          <meshStandardMaterial
            color={threeColor}
            emissive={threeColor}
            emissiveIntensity={0.2}
            roughness={0.5}
            metalness={0.1}
            transparent
            opacity={0.5}
          />
        </mesh>
      )}
    </>
  );
};

// レーザー描画コンポーネント

const LaserRenderer = ({ laser }: { laser: DisplayLaser }) => {
  const points = useMemo(
    () => [
      new THREE.Vector3(laser.start.x, laser.start.y, laser.start.t),
      new THREE.Vector3(laser.end.x, laser.end.y, laser.end.t),
    ],
    [laser],
  );
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setFromPoints(points);
    return geo;
  }, [points]);
  const color = getThreeColor(laser.color);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.4} />
    </lineSegments>
  );
};

// スポーンエフェクト描画コンポーネント

const SpawnRenderer = ({
  spawn,
  observerPos,
  observerBoost,
}: {
  spawn: SpawnEffect;
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
}) => {
  const ref = useRef<THREE.Group>(null);
  const startTime = useRef(spawn.startTime);

  useFrame(() => {
    const elapsed = Date.now() - startTime.current;
    if (elapsed >= SPAWN_EFFECT_DURATION || !ref.current) return;
    const progress = elapsed / SPAWN_EFFECT_DURATION;
    const scale = 1 + progress * 2;
    const opacity = 1 - progress;
    ref.current.scale.set(scale, scale, scale);
    for (const child of ref.current.children) {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshBasicMaterial;
        mat.opacity = opacity;
      }
    }
  });

  const displayPos = transformEventForDisplay(
    createVector4(spawn.pos.t, spawn.pos.x, spawn.pos.y, spawn.pos.z),
    observerPos,
    observerBoost,
  );
  const color = getThreeColor(spawn.color);

  return (
    <group ref={ref} position={[displayPos.x, displayPos.y, displayPos.t]}>
      <mesh geometry={sharedGeometries.explosionParticle}>
        <meshBasicMaterial color={color} transparent opacity={1} />
      </mesh>
    </group>
  );
};

// 3Dシーンコンテンツコンポーネント
export const SceneContent = ({
  players,
  myId,
  lasers,
  spawns,
  frozenWorldLines,
  debrisRecords,
  showInRestFrame,
  useOrthographic,
  cameraYawRef,
  cameraPitchRef,
}: SceneContentProps) => {
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

  // カメラ制御
  useFrame(({ camera }) => {
    if (!myPlayer) return;
    const playerPos = transformEventForDisplay(
      myPlayer.phaseSpace.pos,
      observerPos,
      observerBoost,
    );
    const targetX = playerPos.x;
    const targetY = playerPos.y;
    const targetT = playerPos.t;

    const yaw = cameraYawRef.current;
    const pitch = cameraPitchRef.current;
    const distance = useOrthographic ? 100 : 15;
    const camX =
      targetX + distance * Math.cos(pitch) * Math.cos(yaw + Math.PI);
    const camY =
      targetY + distance * Math.cos(pitch) * Math.sin(yaw + Math.PI);
    const camT = targetT + distance * Math.sin(pitch);

    camera.position.set(camX, camY, camT);
    camera.lookAt(targetX, targetY, targetT);
    camera.up.set(0, 0, 1);
  });

  // 世界線の過去光円錐交差（他プレイヤーの現在の worldLine + 凍結世界線）
  const worldLineIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];

    const results: { playerId: string; color: string; pos: Vector4 }[] = [];

    // 他プレイヤーの現在の worldLine を検索
    for (const player of playerList) {
      if (player.id === myId) continue;
      const intersection = pastLightConeIntersectionWorldLine(
        player.worldLine,
        myPlayer.phaseSpace.pos,
      );
      if (intersection) {
        results.push({
          playerId: player.id,
          color: player.color,
          pos: transformEventForDisplay(
            intersection.pos,
            observerPos,
            observerBoost,
          ),
        });
      }
    }

    // 凍結世界線も検索
    for (const fw of frozenWorldLines) {
      const intersection = pastLightConeIntersectionWorldLine(
        fw.worldLine,
        myPlayer.phaseSpace.pos,
      );
      if (intersection) {
        results.push({
          playerId: `frozen-${fw.worldLine.history[0]?.pos.t ?? 0}`,
          color: fw.color,
          pos: transformEventForDisplay(
            intersection.pos,
            observerPos,
            observerBoost,
          ),
        });
      }
    }

    return results;
  }, [myPlayer, myId, playerList, frozenWorldLines, observerPos, observerBoost]);

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

      {/* 凍結世界線（世界オブジェクト）を描画 */}
      {frozenWorldLines.map((fw, i) => (
        <WorldLineRenderer
          key={`frozen-${i}-${fw.worldLine.history[0]?.pos.t ?? 0}`}
          worldLine={fw.worldLine}
          color={fw.color}
          showHalfLine={fw.showHalfLine}
          observerPos={observerPos}
          observerBoost={observerBoost}
        />
      ))}

      {/* 生存プレイヤーの現在の世界線を描画 */}
      {playerList.map((player) => (
        <WorldLineRenderer
          key={`worldline-${player.id}`}
          worldLine={player.worldLine}
          color={player.color}
          showHalfLine={player.worldLine.origin !== null}
          observerPos={observerPos}
          observerBoost={observerBoost}
        />
      ))}

      {/* 各プレイヤーのマーカー（死亡中の自分のみ非表示） */}
      {playerList.map((player) => {
        if (player.id === myId && player.isDead) return null;

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

      {/* 自分の光円錐のみ描画 */}
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

          return (
            <group key={`lightcone-${player.id}`}>
              <mesh
                position={[pos.x, pos.y, pos.t + coneHeight / 2]}
                rotation={[-Math.PI / 2, 0.0, 0.0]}
                geometry={sharedGeometries.lightCone}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={0.2}
                  side={THREE.FrontSide}
                  depthWrite={false}
                />
              </mesh>
              <mesh
                position={[pos.x, pos.y, pos.t + coneHeight / 2]}
                rotation={[-Math.PI / 2, 0.0, 0.0]}
                geometry={sharedGeometries.lightCone}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={0.3}
                  side={THREE.FrontSide}
                  wireframe
                />
              </mesh>
              <mesh
                position={[pos.x, pos.y, pos.t - coneHeight / 2]}
                rotation={[Math.PI / 2, 0.0, 0.0]}
                geometry={sharedGeometries.lightCone}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={0.2}
                  side={THREE.FrontSide}
                  depthWrite={false}
                />
              </mesh>
              <mesh
                position={[pos.x, pos.y, pos.t - coneHeight / 2]}
                rotation={[Math.PI / 2, 0.0, 0.0]}
                geometry={sharedGeometries.lightCone}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={0.3}
                  side={THREE.FrontSide}
                  wireframe
                />
              </mesh>
            </group>
          );
        })}

      {/* 世界線の過去光円錐交差マーカー */}
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

      {/* レーザー交差マーカー */}
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

      {/* レーザー描画 */}
      {displayLasers.map((laser) => (
        <LaserRenderer key={laser.id} laser={laser} />
      ))}

      {/* デブリの世界線とマーカー（世界オブジェクト） */}
      {myPlayer &&
        (() => {
          const lineVertices: number[] = [];
          const lineColors: number[] = [];
          const markerElements: React.ReactNode[] = [];

          for (let di = 0; di < debrisRecords.length; di++) {
            const debris = debrisRecords[di];
            const deathEvent = createVector4(
              debris.deathPos.t,
              debris.deathPos.x,
              debris.deathPos.y,
              0,
            );
            // デブリ世界線は世界オブジェクト: 十分大きい範囲で探索
            // 過去光円錐との交差条件 (observer.t > intersection.t) がカバーするので
            // observer の時刻に依存する必要はない
            const maxLambda = 200;
            const debrisColor = getThreeColor(debris.color);
            const r = debrisColor.r;
            const g = debrisColor.g;
            const b = debrisColor.b;

            const startDisplay = transformEventForDisplay(
              deathEvent,
              observerPos,
              observerBoost,
            );

            for (let pi = 0; pi < debris.particles.length; pi++) {
              const p = debris.particles[pi];

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
              lineVertices.push(
                startDisplay.x,
                startDisplay.y,
                startDisplay.t,
                endDisplay.x,
                endDisplay.y,
                endDisplay.t,
              );
              lineColors.push(r, g, b, r, g, b);

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
                markerElements.push(
                  <mesh
                    key={`debris-${di}-${pi}`}
                    position={[displayPos.x, displayPos.y, displayPos.t]}
                    scale={[p.size * 1.5, p.size * 1.5, p.size * 1.5]}
                    geometry={sharedGeometries.explosionParticle}
                    material={getDebrisMaterial(debrisColor)}
                  />,
                );
              }
            }
          }

          if (lineVertices.length === 0) return markerElements;

          const geom = new THREE.BufferGeometry();
          geom.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(lineVertices, 3),
          );
          geom.setAttribute(
            "color",
            new THREE.Float32BufferAttribute(lineColors, 3),
          );

          return [
            <lineSegments key="debris-lines" geometry={geom}>
              <lineBasicMaterial vertexColors transparent opacity={0.4} />
            </lineSegments>,
            ...markerElements,
          ];
        })()}

      {/* スポーンエフェクト */}
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
