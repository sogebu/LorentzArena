import { useFrame } from "@react-three/fiber";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createVector4,
  futureLightConeIntersectionWorldLine,
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

/** TubeGeometry regeneration interval (in append count).
 * Higher = fewer geometry rebuilds but choppier world lines. */
const TUBE_REGEN_INTERVAL = 8;

const WorldLineRenderer = ({
  worldLine: wl,
  color,
  showHalfLine,
  observerPos,
  observerBoost,
}: WorldLineRendererProps) => {
  const tubeRef = useRef<THREE.Mesh>(null);
  const halfLineRef = useRef<THREE.Mesh>(null);
  const prevTubeGeoRef = useRef<THREE.TubeGeometry | null>(null);
  const prevHalfLineGeoRef = useRef<THREE.TubeGeometry | null>(null);

  // version を TUBE_REGEN_INTERVAL で量子化して再生成を間引く
  const geoVersion = Math.floor(wl.version / TUBE_REGEN_INTERVAL);
  // biome-ignore lint/correctness/useExhaustiveDependencies: geoVersion throttles rebuild; wl.history has actual data
  const tubeGeo = useMemo(() => {
    prevTubeGeoRef.current?.dispose();
    if (wl.history.length < 2) {
      prevTubeGeoRef.current = null;
      return null;
    }
    const points = wl.history.map(
      (ps) => new THREE.Vector3(ps.pos.x, ps.pos.y, ps.pos.t),
    );
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.5);
    const segments = Math.max(1, points.length * 2);
    const geo = new THREE.TubeGeometry(curve, segments, 0.04, 6, false);
    prevTubeGeoRef.current = geo;
    return geo;
  }, [geoVersion]);

  const halfLineGeo = useMemo(() => {
    prevHalfLineGeoRef.current?.dispose();
    if (!showHalfLine || !wl.origin) {
      prevHalfLineGeoRef.current = null;
      return null;
    }
    const o = wl.origin;
    const len = 200;
    const start = positionAlongStraightWorldLine(o, len);
    const end = new THREE.Vector3(o.pos.x, o.pos.y, o.pos.t);
    const startVec = new THREE.Vector3(start.x, start.y, start.t);
    const curve = new THREE.LineCurve3(startVec, end);
    const geo = new THREE.TubeGeometry(curve, 2, 0.04, 6, false);
    prevHalfLineGeoRef.current = geo;
    return geo;
  }, [showHalfLine, wl.origin]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      prevTubeGeoRef.current?.dispose();
      prevHalfLineGeoRef.current?.dispose();
    };
  }, []);

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

// レーザーバッチ描画コンポーネント（全レーザーを1つの BufferGeometry にまとめる）
const LaserBatchRenderer = ({
  displayLasers,
}: { displayLasers: DisplayLaser[] }) => {
  const geoRef = useRef<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    return () => {
      geoRef.current?.dispose();
      geoRef.current = null;
    };
  }, []);

  const geometry = useMemo(() => {
    geoRef.current?.dispose();
    if (displayLasers.length === 0) {
      geoRef.current = null;
      return null;
    }
    const vertices = new Float32Array(displayLasers.length * 6);
    const colors = new Float32Array(displayLasers.length * 6);
    for (let i = 0; i < displayLasers.length; i++) {
      const l = displayLasers[i];
      const c = getThreeColor(l.color);
      const off = i * 6;
      vertices[off] = l.start.x;
      vertices[off + 1] = l.start.y;
      vertices[off + 2] = l.start.t;
      vertices[off + 3] = l.end.x;
      vertices[off + 4] = l.end.y;
      vertices[off + 5] = l.end.t;
      colors[off] = c.r;
      colors[off + 1] = c.g;
      colors[off + 2] = c.b;
      colors[off + 3] = c.r;
      colors[off + 4] = c.g;
      colors[off + 5] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geoRef.current = geo;
    return geo;
  }, [displayLasers]);

  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.4} />
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
        const ringProgress = (progress * 3 + i / ringCount) % 1;
        const ringRadius = (1 - ringProgress) * 4;
        const ringOpacity = opacity * (1 - ringProgress) * 0.8;
        const ringT = spawn.pos.t + i * 0.5;

        const worldPos = createVector4(ringT, spawn.pos.x, spawn.pos.y, 0);
        const displayPos = transformEventForDisplay(
          worldPos,
          observerPos,
          observerBoost,
        );

        if (ringRadius < 0.1 || ringOpacity < 0.01) return null;

        return (
          <mesh
            key={`ring-${spawn.id}-${i}`}
            position={[displayPos.x, displayPos.y, displayPos.t]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[ringRadius, ringRadius, 1]}
            geometry={sharedGeometries.spawnRing}
          >
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
            scale={[1, pillarHeight, 1]}
            geometry={sharedGeometries.spawnPillar}
          >
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

// デブリ描画コンポーネント（BufferGeometry のライフサイクル管理）
const DebrisRenderer = ({
  debrisRecords,
  myPlayer,
  observerPos,
  observerBoost,
}: {
  debrisRecords: SceneContentProps["debrisRecords"];
  myPlayer: { phaseSpace: { pos: Vector4 }; color: string };
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
}) => {
  const debrisLineGeoRef = useRef<THREE.BufferGeometry | null>(null);

  // dispose on unmount or when debris changes
  useEffect(() => {
    return () => {
      debrisLineGeoRef.current?.dispose();
      debrisLineGeoRef.current = null;
    };
  }, []);

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
    const maxLambda = 5;
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

  if (lineVertices.length === 0) return <>{markerElements}</>;

  // 前回の geometry を dispose して新しいものを作成
  debrisLineGeoRef.current?.dispose();
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(lineVertices, 3),
  );
  geom.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
  debrisLineGeoRef.current = geom;

  return (
    <>
      <lineSegments geometry={geom}>
        <lineBasicMaterial vertexColors transparent opacity={0.15} />
      </lineSegments>
      {markerElements}
    </>
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
  killNotification,
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
    const camX = targetX + distance * Math.cos(pitch) * Math.cos(yaw + Math.PI);
    const camY = targetY + distance * Math.cos(pitch) * Math.sin(yaw + Math.PI);
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
    for (let fi = 0; fi < frozenWorldLines.length; fi++) {
      const fw = frozenWorldLines[fi];
      const intersection = pastLightConeIntersectionWorldLine(
        fw.worldLine,
        myPlayer.phaseSpace.pos,
      );
      if (intersection) {
        results.push({
          playerId: `frozen-${fi}-${fw.worldLine.history[0]?.pos.t ?? 0}`,
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
  }, [
    myPlayer,
    myId,
    playerList,
    frozenWorldLines,
    observerPos,
    observerBoost,
  ]);

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

  // Future light cone intersections: where a signal from the observer would reach each player
  const futureLightConeIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];
    const results: { playerId: string; color: string; pos: Vector4 }[] = [];
    for (const player of playerList) {
      if (player.id === myId) continue;
      const intersection = futureLightConeIntersectionWorldLine(
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
    return results;
  }, [myPlayer, myId, playerList, observerPos, observerBoost]);

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
                  opacity={0.1}
                  side={THREE.DoubleSide}
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
                  opacity={0.1}
                  side={THREE.DoubleSide}
                  depthWrite={false}
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

      {/* 未来光円錐交差マーカー（うっすら表示） */}
      {futureLightConeIntersections.map(({ playerId, color: colorText, pos }) => {
        const color = getThreeColor(colorText);
        return (
          <group
            key={`future-${playerId}`}
            position={[pos.x, pos.y, pos.t]}
          >
            <mesh
              geometry={sharedGeometries.intersectionSphere}
              scale={[0.6, 0.6, 0.6]}
            >
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.15}
                depthWrite={false}
              />
            </mesh>
            <mesh
              geometry={sharedGeometries.intersectionRing}
              scale={[0.8, 0.8, 0.8]}
            >
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.12}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}

      {/* レーザー描画（バッチ） */}
      <LaserBatchRenderer displayLasers={displayLasers} />

      {/* デブリの世界線とマーカー（世界オブジェクト） */}
      {myPlayer && (
        <DebrisRenderer
          debrisRecords={debrisRecords}
          myPlayer={myPlayer}
          observerPos={observerPos}
          observerBoost={observerBoost}
        />
      )}

      {/* キル通知（キル時空点に 3D 表示） */}
      {killNotification &&
        observerPos &&
        (() => {
          const displayPos = transformEventForDisplay(
            createVector4(
              killNotification.hitPos.t,
              killNotification.hitPos.x,
              killNotification.hitPos.y,
              killNotification.hitPos.z,
            ),
            observerPos,
            observerBoost,
          );
          const killColor = getThreeColor(killNotification.color);
          return (
            <group position={[displayPos.x, displayPos.y, displayPos.t]}>
              <mesh geometry={sharedGeometries.killSphere}>
                <meshBasicMaterial
                  color={killColor}
                  transparent
                  opacity={0.6}
                />
              </mesh>
              <mesh geometry={sharedGeometries.killRing}>
                <meshBasicMaterial
                  color={killColor}
                  transparent
                  opacity={0.8}
                  side={THREE.DoubleSide}
                />
              </mesh>
            </group>
          );
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
