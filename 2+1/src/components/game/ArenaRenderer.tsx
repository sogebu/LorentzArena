import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useGameStore } from "../../stores/game-store";
import {
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_COLOR,
  ARENA_FUTURE_CONE_OPACITY,
  ARENA_MIN_HALF_HEIGHT,
  ARENA_PAST_CONE_OPACITY,
  ARENA_RADIAL_SEGMENTS,
  ARENA_RADIUS,
  ARENA_SURFACE_OPACITY,
  ARENA_VERTICAL_LINE_OPACITY,
} from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { SquareArenaRenderer } from "./SquareArenaRenderer";
import { getThreeColor } from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";

// Arena: world-frame static cylinder (x − cx)² + (y − cy)² = R², 視覚ガイドのみ (物理判定なし)。
//
// **時間方向は「光円錐交線」と「下限半幅」の max で広げる**:
//   各 θ で円柱側面上の点から観測者への空間距離 ρ(θ) を計算し、円柱本体 (surface / 垂直線 /
//   上端 rim) は半幅 = max(ρ, ARENA_MIN_HALF_HEIGHT) で時間方向を広げる。
//     上端 = observer.t + max(ρ, H)、下端 = observer.t − max(ρ, H)。
//   ρ が小さい θ (観測者に近い円柱上の点) では固定半幅 H でガードし円柱が極端に狭く
//   ならないようにし、ρ が大きい (観測者が円柱から遠い) θ では光円錐 ∩ 円柱 の
//   交点まで伸ばす (= 従来動作の 2026-04-17 版を上書き)。
//
// **過去光円錐 × 円柱交線は独立描画 (下限 H なしで素の ρ)**:
//   `pos.t − ρ(θ)` をそのまま辿る LineLoop として、円柱本体 (max(ρ, H)) とは別の
//   position attribute で描画。ρ < H の θ では円柱下端 (= pos.t − H) より未来側 (= pos.t − ρ)
//   に入り、観測者に近い θ では pastCone が円柱内部に位置する。物理的意味は「今まさに光が
//   届いている円柱側面 (無限延長) 上の事象の集合」で、円柱本体の時間方向ガード (H 下限) と
//   独立に観測者光円錐に沿う。
//
// **頂点 layout**:
//   - clamped (共有): 各 θ に対して 2 vertex `[上 (i*2+0), 下 (i*2+1)]`, 計 N×2
//     surface / 垂直線 / 上端 rim (旧 futureCone) geometry が共有
//   - unclamped (独立): 各 θ に対して 1 vertex, 計 N
//     pastCone geometry 専用
//
// **in-place update**: 両 attribute とも useFrame で position を in-place 更新 +
// `needsUpdate=true`。allocation ゼロ、GC 圧なし。
//
// 各 mesh は `frustumCulled={false}` で bounding sphere 依存の culling を無効化 (本
// geometry は position が毎 frame 変わるので初期 boundingSphere が意味を持たない)。
export const ArenaRenderer = () => {
  const boundaryMode = useGameStore((s) => s.boundaryMode);
  if (boundaryMode === "torus") return <SquareArenaRenderer />;
  return <CylinderArenaRenderer />;
};

const CylinderArenaRenderer = () => {
  const { displayMatrix, observerPos } = useDisplayFrame();

  // observerPos を ref に sync して useFrame callback 内から最新値を参照可能に。
  const observerPosRef = useRef(observerPos);
  observerPosRef.current = observerPos;

  const arenaThreeColor = useMemo(() => getThreeColor(ARENA_COLOR), []);

  // --- position attribute × 2 + 4 geometry (初回のみ作成) ---
  const arenaGeometries = useMemo(() => {
    const N = ARENA_RADIAL_SEGMENTS;

    // clamped: surface / 垂直線 / 上端 rim が共有する N×2 vertex attribute
    const clampedPositions = new Float32Array(N * 2 * 3);
    const clampedAttr = new THREE.BufferAttribute(clampedPositions, 3);

    // unclamped: pastCone 専用の N vertex attribute
    const pastConePositions = new Float32Array(N * 3);
    const pastConeAttr = new THREE.BufferAttribute(pastConePositions, 3);

    // surface: triangle strip の (i, i+1) quad を 2 三角形に分解 (clamped)
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

    // 垂直線: 各 θ で (上, 下) の vertex pair (LineSegments は pairs を線として描く, clamped)
    const verticalIndices: number[] = [];
    for (let i = 0; i < N; i++) {
      verticalIndices.push(i * 2 + 0, i * 2 + 1);
    }

    // 上端 rim (旧 futureCone): 上 vertex だけ順に辿る LineLoop (clamped)
    const futureConeIndices: number[] = [];
    for (let i = 0; i < N; i++) futureConeIndices.push(i * 2 + 0);

    // 過去光円錐交線: pastCone 専用 attribute を全 vertex 順に辿る LineLoop
    const pastConeIndices: number[] = [];
    for (let i = 0; i < N; i++) pastConeIndices.push(i);

    const makeGeoClamped = (indices: number[]): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", clampedAttr);
      g.setIndex(indices);
      return g;
    };
    const makeGeoPastCone = (indices: number[]): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", pastConeAttr);
      g.setIndex(indices);
      return g;
    };

    return {
      clampedPositions,
      clampedAttr,
      pastConePositions,
      pastConeAttr,
      surface: makeGeoClamped(surfaceIndices),
      verticalLines: makeGeoClamped(verticalIndices),
      futureCone: makeGeoClamped(futureConeIndices),
      pastCone: makeGeoPastCone(pastConeIndices),
    };
  }, []);

  // --- Per-frame in-place update ---
  useFrame(() => {
    const pos = observerPosRef.current;
    if (!pos) return;
    const { clampedPositions, clampedAttr, pastConePositions, pastConeAttr } =
      arenaGeometries;
    const N = ARENA_RADIAL_SEGMENTS;
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const wx = ARENA_CENTER_X + ARENA_RADIUS * Math.cos(theta);
      const wy = ARENA_CENTER_Y + ARENA_RADIUS * Math.sin(theta);
      const dx = wx - pos.x;
      const dy = wy - pos.y;
      const rho = Math.sqrt(dx * dx + dy * dy);
      const halfExpanded = rho > ARENA_MIN_HALF_HEIGHT ? rho : ARENA_MIN_HALF_HEIGHT;
      const topT = pos.t + halfExpanded;
      const botT = pos.t - halfExpanded;
      const o0 = (i * 2 + 0) * 3; // 上 (expanded)
      const o1 = (i * 2 + 1) * 3; // 下 (expanded)
      clampedPositions[o0 + 0] = wx;
      clampedPositions[o0 + 1] = wy;
      clampedPositions[o0 + 2] = topT;
      clampedPositions[o1 + 0] = wx;
      clampedPositions[o1 + 1] = wy;
      clampedPositions[o1 + 2] = botT;
      // pastCone: H 下限なし、`pos.t - ρ(θ)` をそのまま書き込む
      const p = i * 3;
      pastConePositions[p + 0] = wx;
      pastConePositions[p + 1] = wy;
      pastConePositions[p + 2] = pos.t - rho;
    }
    clampedAttr.needsUpdate = true;
    pastConeAttr.needsUpdate = true;
  });

  // 4 material すべてに per-vertex 時間 fade shader を適用。
  // - surface / 垂直線 / 上端 rim: 半幅 max(ρ, H) で円柱は常に ±H 以上、遠い θ (ρ 大) で
  //   光円錐まで広がる。ρ が大きい θ は time fade (Lorentzian, r=LCH) で自然に薄くなる
  // - pastCone: |dt| = ρ で ρ が大きい θ は fade で自然に薄くなる
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
