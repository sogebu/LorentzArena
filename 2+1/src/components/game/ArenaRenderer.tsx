import { useMemo } from "react";
import * as THREE from "three";
import {
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_COLOR,
  ARENA_HEIGHT,
  ARENA_PAST_CONE_OPACITY,
  ARENA_PAST_CONE_SEGMENTS,
  ARENA_RADIAL_SEGMENTS,
  ARENA_RADIUS,
  ARENA_SURFACE_OPACITY,
  ARENA_VERTICAL_LINE_OPACITY,
} from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { getThreeColor, sharedGeometries } from "./threeCache";

// Arena: world-frame static cylinder (x - cx)² + (y - cy)² = R², 視覚ガイドのみ (物理判定なし)。
// D pattern: 円柱 geometry は world 座標で定義 + `displayMatrix` で per-vertex Lorentz 変換。
// 円柱の time span は geometry 自体は有限 (ARENA_HEIGHT) だが、mesh の translation t を
// observer.t に追従させることで常に観測者近傍の slice を描画する。world 静止の time-translation
// invariant な円柱の「観測者時間近傍の window」として機能。
// 過去光円錐交線 (PastConeLoop) は観測者固有だが色は円柱所有物なので ARENA_COLOR を使う
// (意味論的に交線 ∈ 円柱 であり、光円錐 wireframe の色と区別したいため)。
export const ArenaRenderer = () => {
  const { displayMatrix, observerPos } = useDisplayFrame();
  const arenaThreeColor = useMemo(() => getThreeColor(ARENA_COLOR), []);

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

  // 垂直線用 matrix: rotation 不要 (geometry を直接 +z = 時間方向で定義するため)
  const verticalLinesMatrix = useMemo(() => {
    const centerT = observerPos?.t ?? 0;
    const translate = new THREE.Matrix4().makeTranslation(
      ARENA_CENTER_X,
      ARENA_CENTER_Y,
      centerT,
    );
    return new THREE.Matrix4().multiplyMatrices(displayMatrix, translate);
  }, [displayMatrix, observerPos]);

  // 時間方向に伸びる垂直線 N 本 (N = ARENA_RADIAL_SEGMENTS) の LineSegments geometry。
  // 各 θ で 2 頂点 (下端 −H/2, 上端 +H/2) のペア。CylinderGeometry + wireframe と違い、
  // 三角形の対角線・上下 ring は一切出ない。per-vertex Lorentz で rest frame では
  // boost 方向に応じて時間軸が傾斜した直線群になる。
  const verticalLinesGeometry = useMemo(() => {
    const positions = new Float32Array(ARENA_RADIAL_SEGMENTS * 2 * 3);
    const half = ARENA_HEIGHT / 2;
    for (let i = 0; i < ARENA_RADIAL_SEGMENTS; i++) {
      const theta = (i / ARENA_RADIAL_SEGMENTS) * Math.PI * 2;
      const lx = ARENA_RADIUS * Math.cos(theta);
      const ly = ARENA_RADIUS * Math.sin(theta);
      const o0 = (i * 2 + 0) * 3;
      const o1 = (i * 2 + 1) * 3;
      positions[o0 + 0] = lx;
      positions[o0 + 1] = ly;
      positions[o0 + 2] = -half;
      positions[o1 + 0] = lx;
      positions[o1 + 1] = ly;
      positions[o1 + 2] = +half;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

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
      {/* 円柱本体: 半透明 surface (両面可視) */}
      <mesh
        geometry={sharedGeometries.arenaCylinder}
        matrix={cylinderMatrix}
        matrixAutoUpdate={false}
      >
        <meshBasicMaterial
          color={arenaThreeColor}
          transparent
          opacity={ARENA_SURFACE_OPACITY}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* 時間方向の垂直線 ARENA_RADIAL_SEGMENTS 本 (対角線や上下 ring は出さない) */}
      <lineSegments
        geometry={verticalLinesGeometry}
        matrix={verticalLinesMatrix}
        matrixAutoUpdate={false}
      >
        <lineBasicMaterial
          color={arenaThreeColor}
          transparent
          opacity={ARENA_VERTICAL_LINE_OPACITY}
          depthWrite={false}
        />
      </lineSegments>
      {/* 観測者の過去光円錐 × 円柱 交線 (色は円柱の所有物として ARENA_COLOR) */}
      {pastConeGeometry && (
        <lineLoop
          geometry={pastConeGeometry}
          matrix={displayMatrix}
          matrixAutoUpdate={false}
        >
          <lineBasicMaterial
            color={arenaThreeColor}
            transparent
            opacity={ARENA_PAST_CONE_OPACITY}
            depthWrite={false}
          />
        </lineLoop>
      )}
    </>
  );
};
