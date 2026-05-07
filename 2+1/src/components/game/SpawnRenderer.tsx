import { useMemo } from "react";
import * as THREE from "three";
import { SPAWN_EFFECT_DURATION } from "./constants";
import { buildMeshMatrix, useDisplayFrame } from "./DisplayFrameContext";
import { transformEventForDisplay } from "./displayTransform";
import { getThreeColor, sharedGeometries } from "./threeCache";
import type { SpawnEffect } from "./types";

// スポーンエフェクト描画コンポーネント。
//   - 時空 mode (= flattenT=false): D pattern で 5 本のリングを時間軸 (= +z=+t) に積層 + 中心
//     光柱で 4D 構造を表現
//   - PLC slice mode (= flattenT=true): 時間軸が描画次元から落ちているので、 5 リングを **z=0
//     平面上の ripple effect** (= 同 xy で異 radius) に折り畳み、 光柱は skip。 各リングの
//     `ringProgress` (= 既存 staggered 進行) で radius / opacity が異なるので 「波紋」 として
//     2D 平面上に同様の動感が出る。
export const SpawnRenderer = ({
  spawn,
}: {
  spawn: SpawnEffect;
}) => {
  const { displayMatrix, observerPos, observerBoost, flattenT } =
    useDisplayFrame();
  const elapsed = Date.now() - spawn.startTime;
  const progress = Math.min(elapsed / SPAWN_EFFECT_DURATION, 1);
  const opacity = 1 - progress;

  const color = useMemo(() => getThreeColor(spawn.color), [spawn.color]);

  if (opacity <= 0) return null;

  // 5本のリングが時間軸に沿って配置、収縮アニメーション
  const ringCount = 5;

  // PLC mode: spawn xy を rest-frame xy に投影して z=0 平面に固定。
  if (flattenT) {
    const dp = transformEventForDisplay(
      { t: spawn.pos.t, x: spawn.pos.x, y: spawn.pos.y, z: 0 },
      observerPos,
      observerBoost,
    );
    return (
      <group position={[dp.x, dp.y, 0]}>
        {Array.from({ length: ringCount }, (_, i) => {
          const ringProgress = (progress * 3 + i / ringCount) % 1;
          const ringRadius = (1 - ringProgress) * 4;
          const ringOpacity = opacity * (1 - ringProgress) * 0.8;
          if (ringRadius < 0.1 || ringOpacity < 0.01) return null;
          return (
            <mesh
              key={`ring-${spawn.id}-${i}`}
              geometry={sharedGeometries.spawnRing}
              scale={[ringRadius, ringRadius, 1]}
            >
              <meshBasicMaterial
                color={color}
                transparent
                opacity={ringOpacity}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
          );
        })}
        {/* PLC では時間軸方向の pillar は意味を持たないので skip。 ring の波紋だけで spawn 演出。 */}
      </group>
    );
  }

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
                depthWrite={false}
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
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })()}
    </>
  );
};
