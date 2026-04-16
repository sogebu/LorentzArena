import { useMemo } from "react";
import * as THREE from "three";
import {
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_PAST_CONE_OPACITY,
  ARENA_PAST_CONE_SEGMENTS,
  ARENA_RADIUS,
  ARENA_SURFACE_OPACITY,
  ARENA_WIRE_OPACITY,
} from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { sharedGeometries } from "./threeCache";

// Arena: world-frame static cylinder (x - cx)² + (y - cy)² = R², 視覚ガイドのみ (物理判定なし)。
// D pattern: 円柱 geometry は world 座標で定義 + `displayMatrix` で per-vertex Lorentz 変換。
// 円柱の time span は geometry 自体は有限 (ARENA_HEIGHT) だが、mesh の translation t を
// observer.t に追従させることで常に観測者近傍の slice を描画する。world 静止の time-translation
// invariant な円柱の「観測者時間近傍の window」として機能。
// 過去光円錐交線 (PastConeLoop) は観測者固有: 各プレイヤーが自分の過去光円錐と円柱の交線
// を独立に描画する。
export const ArenaRenderer = () => {
  const { displayMatrix, observerPos } = useDisplayFrame();

  const cylinderMatrix = useMemo(() => {
    const centerT = observerPos?.t ?? 0;
    const translate = new THREE.Matrix4().makeTranslation(
      ARENA_CENTER_X,
      ARENA_CENTER_Y,
      centerT,
    );
    // CylinderGeometry default 軸 +Y → X 軸 π/2 rotation で +Z (= world t) に起こす
    const rotate = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const model = new THREE.Matrix4().multiplyMatrices(translate, rotate);
    return new THREE.Matrix4().multiplyMatrices(displayMatrix, model);
  }, [displayMatrix, observerPos]);

  // 過去光円錐 × 円柱の交線: world 座標で vertex 列を作り、matrix=displayMatrix で per-vertex Lorentz
  const pastConeGeometry = useMemo(() => {
    if (!observerPos) return null;
    const positions = new Float32Array(ARENA_PAST_CONE_SEGMENTS * 3);
    for (let i = 0; i < ARENA_PAST_CONE_SEGMENTS; i++) {
      const theta = (i / ARENA_PAST_CONE_SEGMENTS) * Math.PI * 2;
      const wx = ARENA_CENTER_X + ARENA_RADIUS * Math.cos(theta);
      const wy = ARENA_CENTER_Y + ARENA_RADIUS * Math.sin(theta);
      const dx = wx - observerPos.x;
      const dy = wy - observerPos.y;
      const rho = Math.sqrt(dx * dx + dy * dy);
      const wt = observerPos.t - rho;
      positions[i * 3 + 0] = wx;
      positions[i * 3 + 1] = wy;
      positions[i * 3 + 2] = wt;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [observerPos]);

  return (
    <>
      {/* 円柱本体: 半透明 surface + wireframe */}
      <mesh
        geometry={sharedGeometries.arenaCylinder}
        matrix={cylinderMatrix}
        matrixAutoUpdate={false}
      >
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={ARENA_SURFACE_OPACITY}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh
        geometry={sharedGeometries.arenaCylinder}
        matrix={cylinderMatrix}
        matrixAutoUpdate={false}
      >
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={ARENA_WIRE_OPACITY}
          wireframe
          depthWrite={false}
        />
      </mesh>
      {/* 観測者の過去光円錐 × 円柱 交線 */}
      {pastConeGeometry && (
        <lineLoop
          geometry={pastConeGeometry}
          matrix={displayMatrix}
          matrixAutoUpdate={false}
        >
          <lineBasicMaterial
            color="#ffffff"
            transparent
            opacity={ARENA_PAST_CONE_OPACITY}
            depthWrite={false}
          />
        </lineLoop>
      )}
    </>
  );
};
