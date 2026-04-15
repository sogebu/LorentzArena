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
  const { displayMatrix, observerPos } = useDisplayFrame();
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
        // pillar は観測者の過去光円錐上 (= 観測者が「今まさに見ている」時点) に
        // 配置。観測者の simultaneity 面ではなく null cone に anchor することで、
        // 物理的に正しく「観測者が時間前進しても display 上で静止」に見える。
        // anchorT = observer.t - |Δxy| (spawn xy 上の過去光円錐交差)。
        const pillarHeight = 3;
        let anchorT = spawn.pos.t;
        if (observerPos) {
          const dx = spawn.pos.x - observerPos.x;
          const dy = spawn.pos.y - observerPos.y;
          const rho = Math.sqrt(dx * dx + dy * dy);
          anchorT = observerPos.t - rho;
        }
        const worldPos = {
          x: spawn.pos.x,
          y: spawn.pos.y,
          t: anchorT, // center = 過去光円錐交差 → spawn 瞬間 (ρ=0) で display 中央
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
