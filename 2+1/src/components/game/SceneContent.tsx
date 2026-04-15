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
import { selectInvincibleUntil, useGameStore } from "../../stores/game-store";
import { DebrisRenderer } from "./DebrisRenderer";
import { LaserBatchRenderer } from "./LaserBatchRenderer";
import { isLighthouse } from "./lighthouse";
import { SpawnRenderer } from "./SpawnRenderer";
import { WorldLineRenderer } from "./WorldLineRenderer";
import {
  CAMERA_DISTANCE_ORTHOGRAPHIC,
  CAMERA_DISTANCE_PERSPECTIVE,
  LIGHT_CONE_HEIGHT,
  LIGHT_CONE_SURFACE_OPACITY,
  LIGHT_CONE_WIRE_OPACITY,
  LIGHTHOUSE_WORLDLINE_OPACITY,
  PLAYER_MARKER_SIZE_OTHER,
  PLAYER_MARKER_SIZE_SELF,
} from "./constants";
import {
  transformEventForDisplay,
} from "./displayTransform";
import { computeRingMatrix, DisplayFrameProvider } from "./DisplayFrameContext";
import { futureLightConeIntersectionLaser, pastLightConeIntersectionLaser } from "./laserPhysics";
import {
  getThreeColor,
  sharedGeometries,
} from "./threeCache";
import type {
  DisplayLaser,
  Laser,
} from "./types";

/**
 * 交点 `pos` (観測者 = 原点) における光円錐接平面に、レーザー方向を tip とする三角形を
 * 寝かせるための回転 quaternion を返す。三角形ジオメトリは local xy 平面、tip=+x、法線=+z。
 * 過去/未来どちらの光円錐も 外向き法線 n = (x, y, -t)/(ρ√2) の 1 本で扱える。
 */
const computeConeTangentQuaternion = (
  pos: { x: number; y: number; t: number },
  laserDir: { x: number; y: number; z: number },
  out: THREE.Quaternion,
  scratch: THREE.Matrix4,
): boolean => {
  const rho2 = pos.x * pos.x + pos.y * pos.y;
  if (rho2 < 1e-12) return false;
  const denom = Math.sqrt(rho2 + pos.t * pos.t); // ρ√2 on the cone
  if (denom < 1e-12) return false;
  const nx = pos.x / denom;
  const ny = pos.y / denom;
  const nt = -pos.t / denom;
  // Project laser direction onto the tangent plane (laser has no t-component)
  const ldotN = laserDir.x * nx + laserDir.y * ny;
  let ux = laserDir.x - ldotN * nx;
  let uy = laserDir.y - ldotN * ny;
  let ut = -ldotN * nt;
  const ulen = Math.sqrt(ux * ux + uy * uy + ut * ut);
  if (ulen < 1e-9) return false;
  ux /= ulen; uy /= ulen; ut /= ulen;
  // v = n × u
  const vx = ny * ut - nt * uy;
  const vy = nt * ux - nx * ut;
  const vt = nx * uy - ny * ux;
  // Local (x, y, z) → world (u, v, n). Three.js maps local z ↔ world t.
  scratch.set(
    ux, vx, nx, 0,
    uy, vy, ny, 0,
    ut, vt, nt, 0,
    0, 0, 0, 1,
  );
  out.setFromRotationMatrix(scratch);
  return true;
};

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
  const observerU = useMemo(
    () =>
      myPlayer
        ? { x: myPlayer.phaseSpace.u.x, y: myPlayer.phaseSpace.u.y }
        : null,
    [myPlayer],
  );
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

  const ringMatrix = useMemo(
    () => computeRingMatrix(observerBoost),
    [observerBoost],
  );

  return (
    <DisplayFrameProvider
      observerU={observerU}
      observerBoost={observerBoost}
      ringMatrix={ringMatrix}
    >
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
          {...(isLighthouse(player.id) ? { tubeRadius: 0.06, tubeOpacity: LIGHTHOUSE_WORLDLINE_OPACITY } : {})}
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
        const invUntil = selectInvincibleUntil(useGameStore.getState(), player.id);
        const isInvincible = Date.now() < invUntil;
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
                  opacity={LIGHT_CONE_SURFACE_OPACITY}
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
                  opacity={LIGHT_CONE_WIRE_OPACITY}
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
                  opacity={LIGHT_CONE_SURFACE_OPACITY}
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
                  opacity={LIGHT_CONE_WIRE_OPACITY}
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
            <mesh
              geometry={sharedGeometries.intersectionRing}
              matrix={ringMatrix}
              matrixAutoUpdate={false}
            >
              <meshBasicMaterial color={c} transparent opacity={0.9} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}

      {/* レーザー過去光円錐交差マーカー（円錐接平面に貼り付いた三角形、tip=laser.direction の接平面射影） */}
      {laserIntersections.map(({ laser, pos }) => {
        const c = getThreeColor(laser.color);
        const quat = new THREE.Quaternion();
        const m = new THREE.Matrix4();
        const ok = computeConeTangentQuaternion(pos, laser.direction, quat, m);
        if (!ok) return null;
        return (
          <group
            key={`laser-intersection-${laser.id}`}
            position={[pos.x, pos.y, pos.t]}
            quaternion={quat}
          >
            <mesh geometry={sharedGeometries.laserIntersectionTriangle}>
              <meshBasicMaterial color={c} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}

      {/* 未来光円錐交差マーカー（接平面に貼り付いた三角形、うっすら表示） */}
      {laserFutureIntersections.map(({ laser, pos }) => {
        const c = getThreeColor(laser.color);
        const quat = new THREE.Quaternion();
        const m = new THREE.Matrix4();
        const ok = computeConeTangentQuaternion(pos, laser.direction, quat, m);
        if (!ok) return null;
        return (
          <group
            key={`laser-future-${laser.id}`}
            position={[pos.x, pos.y, pos.t]}
            quaternion={quat}
          >
            <mesh geometry={sharedGeometries.laserIntersectionTriangle} scale={[0.65, 0.65, 0.65]}>
              <meshBasicMaterial color={c} transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} />
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
            <group scale={[0.8, 0.8, 0.8]}>
              <mesh
                geometry={sharedGeometries.intersectionRing}
                matrix={ringMatrix}
                matrixAutoUpdate={false}
              >
                <meshBasicMaterial color={c} transparent opacity={0.12} depthWrite={false} />
              </mesh>
            </group>
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
        const spacing = 1.2; // 矢印の全長 (tip 0.75 + base 0.45) と一致させ tip↔base を接合
        // 0s→1個, 0.05s→2個, 0.1s→3個（ループなし、トリガー押し始めから）
        const elapsed = Date.now() - firingStartRef.current;
        const visibleCount = Math.min(3, Math.floor(elapsed / 50) + 1);
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
            <mesh
              geometry={sharedGeometries.killRing}
              matrix={ringMatrix}
              matrixAutoUpdate={false}
            >
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
    </DisplayFrameProvider>
  );
};
