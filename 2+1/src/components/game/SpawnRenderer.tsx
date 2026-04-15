import { useMemo } from "react";
import * as THREE from "three";
import { SPAWN_EFFECT_DURATION } from "./constants";
import { buildMeshMatrix, useDisplayFrame } from "./DisplayFrameContext";
import { getThreeColor, sharedGeometries } from "./threeCache";
import type { SpawnEffect } from "./types";

// スポーンエフェクト描画コンポーネント (D pattern: world frame geometry + displayMatrix 合成)
export const SpawnRenderer = ({
  spawn,
}: {
  spawn: SpawnEffect;
}) => {
  const { displayMatrix } = useDisplayFrame();
  const elapsed = Date.now() - spawn.startTime;
  const progress = Math.min(elapsed / SPAWN_EFFECT_DURATION, 1);
  const opacity = 1 - progress;

  const color = useMemo(() => getThreeColor(spawn.color), [spawn.color]);

  if (opacity <= 0) return null;

  // 5本のリングが時間軸に沿って配置、収縮アニメーション
  const ringCount = 5;
  return (
    <>
      {Array.from({ length: ringCount }, (_, i) => {
        const ringProgress = (progress * 3 + i / ringCount) % 1;
        const ringRadius = (1 - ringProgress) * 4;
        const ringOpacity = opacity * (1 - ringProgress) * 0.8;
        const ringT = spawn.pos.t + i * 0.25;

        if (ringRadius < 0.1 || ringOpacity < 0.01) return null;

        const worldPos = { x: spawn.pos.x, y: spawn.pos.y, t: ringT };
        return (
          <group
            key={`ring-${spawn.id}-${i}`}
            matrix={buildMeshMatrix(worldPos, displayMatrix)}
            matrixAutoUpdate={false}
          >
            <mesh
              geometry={sharedGeometries.spawnRing}
              scale={[ringRadius, ringRadius, 1]}
            >
              <meshBasicMaterial
                color={color}
                transparent
                opacity={ringOpacity}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        );
      })}
      {/* 中心の光柱（時間軸方向） */}
      {(() => {
        const pillarHeight = 3 * (1 - progress * 0.5);
        // pillar の世界中心は spawn 位置から時間方向に pillarHeight/2 オフセット
        const worldPos = {
          x: spawn.pos.x,
          y: spawn.pos.y,
          t: spawn.pos.t + pillarHeight / 2,
        };
        return (
          <group
            matrix={buildMeshMatrix(worldPos, displayMatrix)}
            matrixAutoUpdate={false}
          >
            {/* CylinderGeometry default 軸は +Y。π/2 rotation で +Z (= world t) に起こす */}
            <mesh
              rotation={[Math.PI / 2, 0, 0]}
              scale={[1, pillarHeight, 1]}
              geometry={sharedGeometries.spawnPillar}
            >
              <meshBasicMaterial
                color={color}
                transparent
                opacity={opacity * 0.6}
              />
            </mesh>
          </group>
        );
      })()}
    </>
  );
};
