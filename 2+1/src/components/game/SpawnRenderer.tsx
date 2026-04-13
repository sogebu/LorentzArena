import { useMemo } from "react";
import * as THREE from "three";
import {
  createVector4,
  type lorentzBoost,
  type Vector4,
} from "../../physics";
import { SPAWN_EFFECT_DURATION } from "./constants";
import { transformEventForDisplay } from "./displayTransform";
import { getThreeColor, sharedGeometries } from "./threeCache";
import type { SpawnEffect } from "./types";

// スポーンエフェクト描画コンポーネント
export const SpawnRenderer = ({
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
        const ringT = spawn.pos.t + i * 0.25;

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
        const pillarHeight = 3 * (1 - progress * 0.5);
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
