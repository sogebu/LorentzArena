import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_COLOR,
  ARENA_FUTURE_CONE_OPACITY,
  ARENA_PAST_CONE_OPACITY,
  ARENA_RADIAL_SEGMENTS,
  ARENA_RADIUS,
  ARENA_SURFACE_OPACITY,
  ARENA_VERTICAL_LINE_OPACITY,
} from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { getThreeColor } from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";

// Arena: world-frame static cylinder (x − cx)² + (y − cy)² = R², 視覚ガイドのみ (物理判定なし)。
//
// **時間方向は観測者の因果コーンに切り出される**:
//   各 θ で円柱側面上の点から観測者への空間距離 ρ(θ) を計算し、
//   下端 = observer.t − ρ(θ) (過去光円錐 ∩ 円柱)、
//   上端 = observer.t + ρ(θ) (未来光円錐 ∩ 円柱)。
//   観測者中心では均一な円、離れると双円錐で切り出された形に歪む。
//
// **shared position attribute**: surface / 垂直線 / 過去光円錐交線 / 未来光円錐交線の
// 4 geometry は同じ `N × 2` 頂点 (上 vertex と下 vertex のペア × N) を共有し、
// 各 geometry は index buffer だけが異なる (triangle strip / line pair / bottom ring /
// top ring)。これにより surface の上下辺と cone loop が**完全に同じ頂点を通る**ので
// 密度差による線ズレが発生しない。position attribute 1 つ分の GPU upload で 4 geometry
// すべてに反映されるので軽量。
//
// **in-place update**: BufferGeometry / position array は初回だけ作成、以後 `useFrame`
// で position を in-place 更新 + `needsUpdate=true`。allocation ゼロ、GC 圧なし。
//
// 各 mesh は `frustumCulled={false}` で bounding sphere 依存の culling を無効化 (本
// geometry は position が毎 frame 変わるので初期 boundingSphere が意味を持たない)。
export const ArenaRenderer = () => {
  const { displayMatrix, observerPos } = useDisplayFrame();

  // observerPos を ref に sync して useFrame callback 内から最新値を参照可能に。
  const observerPosRef = useRef(observerPos);
  observerPosRef.current = observerPos;

  const arenaThreeColor = useMemo(() => getThreeColor(ARENA_COLOR), []);

  // --- 共有 position attribute + 4 geometry (初回のみ作成) ---
  const arenaGeometries = useMemo(() => {
    const N = ARENA_RADIAL_SEGMENTS;
    // 頂点 layout: 各 θ_i に対して [上 vertex (i*2), 下 vertex (i*2+1)]
    const positions = new Float32Array(N * 2 * 3);
    const positionAttr = new THREE.BufferAttribute(positions, 3);

    // surface: triangle strip の (i, i+1) quad を 2 三角形に分解
    const surfaceIndices: number[] = [];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const topI = i * 2 + 0;
      const botI = i * 2 + 1;
      const topJ = j * 2 + 0;
      const botJ = j * 2 + 1;
      surfaceIndices.push(topI, botI, topJ);
      surfaceIndices.push(botI, botJ, topJ);
    }

    // 垂直線: 各 θ で (上, 下) の vertex pair (LineSegments は pairs を線として描く)
    const verticalIndices: number[] = [];
    for (let i = 0; i < N; i++) {
      verticalIndices.push(i * 2 + 0, i * 2 + 1);
    }

    // 過去光円錐交線 (下地平線): 下 vertex だけ順に辿る LineLoop
    const pastConeIndices: number[] = [];
    for (let i = 0; i < N; i++) pastConeIndices.push(i * 2 + 1);

    // 未来光円錐交線 (上地平線): 上 vertex だけ順に辿る LineLoop
    const futureConeIndices: number[] = [];
    for (let i = 0; i < N; i++) futureConeIndices.push(i * 2 + 0);

    const makeGeo = (indices: number[]): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", positionAttr);
      g.setIndex(indices);
      return g;
    };

    return {
      positions,
      positionAttr,
      surface: makeGeo(surfaceIndices),
      verticalLines: makeGeo(verticalIndices),
      pastCone: makeGeo(pastConeIndices),
      futureCone: makeGeo(futureConeIndices),
    };
  }, []);

  // --- Per-frame in-place update ---
  useFrame(() => {
    const pos = observerPosRef.current;
    if (!pos) return;
    const { positions, positionAttr } = arenaGeometries;
    const N = ARENA_RADIAL_SEGMENTS;
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const wx = ARENA_CENTER_X + ARENA_RADIUS * Math.cos(theta);
      const wy = ARENA_CENTER_Y + ARENA_RADIUS * Math.sin(theta);
      const dx = wx - pos.x;
      const dy = wy - pos.y;
      const rho = Math.sqrt(dx * dx + dy * dy);
      const topT = pos.t + rho;
      const botT = pos.t - rho;
      const o0 = (i * 2 + 0) * 3; // 上
      const o1 = (i * 2 + 1) * 3; // 下
      positions[o0 + 0] = wx;
      positions[o0 + 1] = wy;
      positions[o0 + 2] = topT;
      positions[o1 + 0] = wx;
      positions[o1 + 1] = wy;
      positions[o1 + 2] = botT;
    }
    // shared attribute なので 1 回の needsUpdate で 4 geometry すべてに反映
    positionAttr.needsUpdate = true;
  });

  // 4 material すべてに per-vertex 時間 fade shader を適用。surface / 垂直線 は
  // observer.t 近傍 (円柱中腹) が濃く、上下端 (光円錐交点) が薄くなる。cone loop 2 本は
  // そもそも観測者光円錐上に乗っているので |dt| = ρ(θ) ≤ LCH 程度、中心に近いほど濃い。
  return (
    <>
      <mesh
        geometry={arenaGeometries.surface}
        matrix={displayMatrix}
        matrixAutoUpdate={false}
        frustumCulled={false}
      >
        <meshBasicMaterial
          color={arenaThreeColor}
          transparent
          opacity={ARENA_SURFACE_OPACITY}
          side={THREE.DoubleSide}
          depthWrite={false}
          onBeforeCompile={applyTimeFadeShader}
        />
      </mesh>
      <lineSegments
        geometry={arenaGeometries.verticalLines}
        matrix={displayMatrix}
        matrixAutoUpdate={false}
        frustumCulled={false}
      >
        <lineBasicMaterial
          color={arenaThreeColor}
          transparent
          opacity={ARENA_VERTICAL_LINE_OPACITY}
          depthWrite={false}
          onBeforeCompile={applyTimeFadeShader}
        />
      </lineSegments>
      <lineLoop
        geometry={arenaGeometries.pastCone}
        matrix={displayMatrix}
        matrixAutoUpdate={false}
        frustumCulled={false}
      >
        <lineBasicMaterial
          color={arenaThreeColor}
          transparent
          opacity={ARENA_PAST_CONE_OPACITY}
          depthWrite={false}
          onBeforeCompile={applyTimeFadeShader}
        />
      </lineLoop>
      <lineLoop
        geometry={arenaGeometries.futureCone}
        matrix={displayMatrix}
        matrixAutoUpdate={false}
        frustumCulled={false}
      >
        <lineBasicMaterial
          color={arenaThreeColor}
          transparent
          opacity={ARENA_FUTURE_CONE_OPACITY}
          depthWrite={false}
          onBeforeCompile={applyTimeFadeShader}
        />
      </lineLoop>
    </>
  );
};
