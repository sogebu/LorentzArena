import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createVector4,
  futureLightConeIntersectionWorldLine,
  lorentzBoost,
  pastLightConeIntersectionWorldLine,
  type Vector4,
} from "../../physics";
import { useGameStore } from "../../stores/game-store";
import { DebrisRenderer } from "./DebrisRenderer";
import { LaserBatchRenderer } from "./LaserBatchRenderer";
import { isLighthouse } from "./lighthouse";
import { SpawnRenderer } from "./SpawnRenderer";
import { WorldLineRenderer } from "./WorldLineRenderer";
import {
  CAMERA_DISTANCE_ORTHOGRAPHIC,
  CAMERA_DISTANCE_PERSPECTIVE,
  LIGHT_CONE_HEIGHT,
  PLAYER_MARKER_SIZE_OTHER,
  PLAYER_MARKER_SIZE_SELF,
} from "./constants";
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
} from "./types";

export type SceneContentProps = {
  myId: string | null;
  showInRestFrame: boolean;
  useOrthographic: boolean;
  cameraYawRef: React.RefObject<number>;
  cameraPitchRef: React.RefObject<number>;
  isFiring: boolean;
};

// 3Dシーンコンテンツコンポーネント
export const SceneContent = ({
  myId,
  showInRestFrame,
  useOrthographic,
  cameraYawRef,
  cameraPitchRef,
  isFiring,
}: SceneContentProps) => {
  // --- Firing start time (for sequential arrow animation) ---
  const firingStartRef = useRef<number>(0);
  if (isFiring && firingStartRef.current === 0) firingStartRef.current = Date.now();
  if (!isFiring) firingStartRef.current = 0;

  // --- Store selectors ---
  const players = useGameStore((s) => s.players);
  const lasers = useGameStore((s) => s.lasers);
  const spawns = useGameStore((s) => s.spawns);
  const frozenWorldLines = useGameStore((s) => s.frozenWorldLines);
  const debrisRecords = useGameStore((s) => s.debrisRecords);
  const killNotification = useGameStore((s) => s.killNotification);

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
    const distance = useOrthographic ? CAMERA_DISTANCE_ORTHOGRAPHIC : CAMERA_DISTANCE_PERSPECTIVE;
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
      <pointLight position={[5, 5, 5]} intensity={1} />

      {/* 凍結世界線（世界オブジェクト）を描画 */}
      {frozenWorldLines.map((fw, i) => (
        <WorldLineRenderer
          key={`frozen-${i}-${fw.worldLine.history[0]?.pos.t ?? 0}`}
          worldLine={fw.worldLine}
          color={fw.color}
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
          observerPos={observerPos}
          observerBoost={observerBoost}
          {...(isLighthouse(player.id) ? { tubeRadius: 0.06, tubeOpacity: 0.4 } : {})}
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
        const size = isMe ? PLAYER_MARKER_SIZE_SELF : PLAYER_MARKER_SIZE_OTHER;
        const invUntil = useGameStore.getState().invincibleUntil.get(player.id);
        const isInvincible = invUntil !== undefined && Date.now() < invUntil;
        // Pulse: opacity oscillates 0.3–1.0 at 2Hz during invincibility
        const pulse = isInvincible ? 0.65 + 0.35 * Math.sin(Date.now() * 0.012) : 1.0;

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
                transparent
                opacity={(isMe ? 1.0 : 0.5) * pulse}
              />
            </mesh>
            <mesh
              scale={[size * 1.8, size * 1.8, size * 1.8]}
              geometry={sharedGeometries.playerSphere}
            >
              <meshBasicMaterial
                color={color}
                transparent
                opacity={(isMe ? 0.32 : 0.1) * pulse}
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

          return (
            <group key={`lightcone-${player.id}`}>
              {/* Future cone: surface + wireframe */}
              <mesh
                position={[pos.x, pos.y, pos.t + LIGHT_CONE_HEIGHT / 2]}
                rotation={[-Math.PI / 2, 0.0, 0.0]}
                geometry={sharedGeometries.lightCone}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={0.08}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
              <mesh
                position={[pos.x, pos.y, pos.t + LIGHT_CONE_HEIGHT / 2]}
                rotation={[-Math.PI / 2, 0.0, 0.0]}
                geometry={sharedGeometries.lightCone}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={0.12}
                  wireframe
                  depthWrite={false}
                />
              </mesh>
              {/* Past cone: surface + wireframe */}
              <mesh
                position={[pos.x, pos.y, pos.t - LIGHT_CONE_HEIGHT / 2]}
                rotation={[Math.PI / 2, 0.0, 0.0]}
                geometry={sharedGeometries.lightCone}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={0.08}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
              <mesh
                position={[pos.x, pos.y, pos.t - LIGHT_CONE_HEIGHT / 2]}
                rotation={[Math.PI / 2, 0.0, 0.0]}
                geometry={sharedGeometries.lightCone}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={0.12}
                  wireframe
                  depthWrite={false}
                />
              </mesh>
            </group>
          );
        })}

      {/* 世界線の過去光円錐交差マーカー（実体: 球+コア+リング） */}
      {worldLineIntersections.map(({ playerId, color: colorText, pos }) => {
        const c = getThreeColor(colorText);
        return (
          <group key={`intersection-${playerId}`} position={[pos.x, pos.y, pos.t]}>
            <mesh geometry={sharedGeometries.intersectionSphere}>
              <meshStandardMaterial color={c} emissive={c} emissiveIntensity={1.15} />
            </mesh>
            <mesh geometry={sharedGeometries.intersectionCore}>
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            <mesh geometry={sharedGeometries.intersectionRing}>
              <meshBasicMaterial color={c} transparent opacity={0.9} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}

      {/* レーザー過去光円錐交差マーカー（ドット） */}
      {laserIntersections.map(({ laser, pos }) => {
        const c = getThreeColor(laser.color);
        return (
          <group key={`laser-intersection-${laser.id}`} position={[pos.x, pos.y, pos.t]}>
            <mesh geometry={sharedGeometries.laserIntersectionDot}>
              <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.5} roughness={0.6} metalness={0.0} />
            </mesh>
          </group>
        );
      })}

      {/* 未来光円錐交差マーカー（うっすら表示: レーザー + 世界線） */}
      {laserFutureIntersections.map(({ laser, pos }) => {
        const c = getThreeColor(laser.color);
        return (
          <group key={`laser-future-${laser.id}`} position={[pos.x, pos.y, pos.t]}>
            <mesh geometry={sharedGeometries.laserIntersectionDot} scale={[0.65, 0.65, 0.65]}>
              <meshBasicMaterial color={c} transparent opacity={0.15} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
      {futureLightConeIntersections.map(({ playerId, color: colorText, pos }) => {
        const c = getThreeColor(colorText);
        return (
          <group key={`future-${playerId}`} position={[pos.x, pos.y, pos.t]}>
            <mesh geometry={sharedGeometries.intersectionSphere} scale={[0.6, 0.6, 0.6]}>
              <meshBasicMaterial color={c} transparent opacity={0.15} depthWrite={false} />
            </mesh>
            <mesh geometry={sharedGeometries.intersectionRing} scale={[0.8, 0.8, 0.8]}>
              <meshBasicMaterial color={c} transparent opacity={0.12} depthWrite={false} />
            </mesh>
          </group>
        );
      })}

      {/* レーザー描画（バッチ） */}
      <LaserBatchRenderer displayLasers={displayLasers} />

      {/* レーザー方向マーカー（自機のみ、トリガー中） */}
      {isFiring && myPlayer && myId && (() => {
        // 自機の最新レーザーから方向取得
        let latestLaser: typeof lasers[0] | null = null;
        for (const l of lasers) {
          if (l.playerId !== myId) continue;
          if (!latestLaser || l.emissionPos.t > latestLaser.emissionPos.t) latestLaser = l;
        }
        if (!latestLaser) return null;
        const dir = latestLaser.direction;
        if (dir.x * dir.x + dir.y * dir.y < 0.000001) return null;
        const aimYaw = Math.atan2(dir.y, dir.x);
        const s2 = Math.SQRT1_2;
        const cy = Math.cos(aimYaw), sy = Math.sin(aimYaw);
        const pastDir = new THREE.Vector3(cy, sy, -1).normalize();
        const rotMatrix = new THREE.Matrix4().set(
          -sy,  -cy * s2,  cy * s2, 0,
           cy,  -sy * s2,  sy * s2, 0,
            0,        s2,       s2, 0,
            0,         0,        0, 1,
        );
        const quat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);
        const pos = transformEventForDisplay(myPlayer.phaseSpace.pos, observerPos, observerBoost);
        const c = getThreeColor(myPlayer.color);
        const spacing = 2.5;
        // 0s→1個, 0.5s→2個, 1s→3個（ループなし、トリガー押し始めから）
        const elapsed = Date.now() - firingStartRef.current;
        const visibleCount = Math.min(3, Math.floor(elapsed / 500) + 1);
        return [1, 2, 3].map((i) => {
          if (i > visibleCount) return null;
          const opacity = 0.9 - (i - 1) * 0.15;
          return (
            <mesh
              key={`aim-arrow-${i}`}
              position={[
                pos.x + pastDir.x * spacing * i,
                pos.y + pastDir.y * spacing * i,
                pos.t + pastDir.z * spacing * i,
              ]}
              quaternion={quat}
              geometry={sharedGeometries.laserArrow}
            >
              <meshBasicMaterial color={c} transparent opacity={opacity} side={THREE.DoubleSide} />
            </mesh>
          );
        });
      })()}

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
      {killNotification && observerPos && (() => {
        const dp = transformEventForDisplay(
          createVector4(killNotification.hitPos.t, killNotification.hitPos.x, killNotification.hitPos.y, killNotification.hitPos.z),
          observerPos, observerBoost,
        );
        const kc = getThreeColor(killNotification.color);
        return (
          <group position={[dp.x, dp.y, dp.t]}>
            <mesh geometry={sharedGeometries.killSphere}>
              <meshBasicMaterial color={kc} transparent opacity={0.6} />
            </mesh>
            <mesh geometry={sharedGeometries.killRing}>
              <meshBasicMaterial color={kc} transparent opacity={0.8} side={THREE.DoubleSide} />
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
