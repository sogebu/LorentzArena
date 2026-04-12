import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import {
  createVector4,
  futureLightConeIntersectionWorldLine,
  lorentzBoost,
  pastLightConeIntersectionWorldLine,
  type Vector4,
} from "../../physics";
import { DebrisRenderer } from "./DebrisRenderer";
import { LaserBatchRenderer } from "./LaserBatchRenderer";
import { SpawnRenderer } from "./SpawnRenderer";
import { WorldLineRenderer } from "./WorldLineRenderer";
import {
  transformEventForDisplay,
} from "./displayTransform";
import { futureLightConeIntersectionLaser, pastLightConeIntersectionLaser } from "./laserPhysics";
import {
  getThreeColor,
  sharedGeometries,
} from "./threeCache";
import type {
  DisplayLaser,
  Laser,
  SceneContentProps,
} from "./types";

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

  // Future light cone intersections with lasers
  const laserFutureIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];
    return lasers
      .map((laser) => {
        const intersection = futureLightConeIntersectionLaser(
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

      {/* レーザー未来光円錐交差マーカー（うっすら表示） */}
      {laserFutureIntersections.map(({ laser, pos }) => {
        const color = getThreeColor(laser.color);
        return (
          <group
            key={`laser-future-${laser.id}`}
            position={[pos.x, pos.y, pos.t]}
          >
            <mesh
              geometry={sharedGeometries.laserIntersectionDot}
              scale={[0.7, 0.7, 0.7]}
            >
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.15}
                depthWrite={false}
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
