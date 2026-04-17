import { useMemo } from "react";
import * as THREE from "three";
import {
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_COLOR,
  ARENA_FUTURE_CONE_OPACITY,
  ARENA_PAST_CONE_OPACITY,
  ARENA_PAST_CONE_SEGMENTS,
  ARENA_RADIAL_SEGMENTS,
  ARENA_RADIUS,
  ARENA_SURFACE_OPACITY,
  ARENA_VERTICAL_LINE_OPACITY,
} from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { getThreeColor } from "./threeCache";

// Arena: world-frame static cylinder (x − cx)² + (y − cy)² = R², 視覚ガイドのみ (物理判定なし)。
//
// **時間方向は観測者の因果コーンに切り出される**:
//   - 各 θ で円柱側面上の点 (x(θ), y(θ)) から観測者 (x_o, y_o) への空間距離 ρ(θ)
//   - 下端 = observer.t − ρ(θ) (過去光円錐 ∩ 円柱)
//   - 上端 = observer.t + ρ(θ) (未来光円錐 ∩ 円柱)
//   - 観測者が中心にいれば ρ(θ) は θ 非依存 (= R) で上下端が均一な円
//   - 観測者がずれると近い θ は上下端が観測者 t に近く (ρ 小)、遠い θ は観測者過去/未来に
//     大きく伸びる形で、「観測者の双円錐で円柱を切り出した」幾何になる
//
// D pattern: 全 geometry は world 座標で vertex を持ち、matrix=displayMatrix で per-vertex
// Lorentz 変換。surface + 垂直線 + 過去光円錐交線 + 未来光円錐交線の 4 geometry はすべて
// observerPos 依存で毎 tick 再生成 (頂点数は合計 ~600 なのでコスト軽微)。
export const ArenaRenderer = () => {
  const { displayMatrix, observerPos } = useDisplayFrame();
  const arenaThreeColor = useMemo(() => getThreeColor(ARENA_COLOR), []);

  // 各 θ ごとに world 座標の (x, y) と、観測者からの空間距離 ρ(θ) を算出。
  // surface と 垂直線で共有 (同じ頂点トポロジー)。
  // top = observer.t + ρ (未来光円錐交点), bottom = observer.t − ρ (過去光円錐交点)
  type SideSamples = {
    N: number;
    xs: Float32Array;
    ys: Float32Array;
    topTs: Float32Array;
    botTs: Float32Array;
  };
  const sideSamples = useMemo<SideSamples | null>(() => {
    if (!observerPos) return null;
    const N = ARENA_RADIAL_SEGMENTS;
    const xs = new Float32Array(N);
    const ys = new Float32Array(N);
    const topTs = new Float32Array(N);
    const botTs = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const wx = ARENA_CENTER_X + ARENA_RADIUS * Math.cos(theta);
      const wy = ARENA_CENTER_Y + ARENA_RADIUS * Math.sin(theta);
      const dx = wx - observerPos.x;
      const dy = wy - observerPos.y;
      const rho = Math.sqrt(dx * dx + dy * dy);
      xs[i] = wx;
      ys[i] = wy;
      topTs[i] = observerPos.t + rho;
      botTs[i] = observerPos.t - rho;
    }
    return { N, xs, ys, topTs, botTs };
  }, [observerPos]);

  // surface: 各 θ で上下 2 頂点、隣接 θ とで quad (= 2 triangle) を張る triangle strip。
  const surfaceGeometry = useMemo(() => {
    if (!sideSamples) return null;
    const { N, xs, ys, topTs, botTs } = sideSamples;
    const positions = new Float32Array(N * 2 * 3);
    const indices: number[] = [];
    for (let i = 0; i < N; i++) {
      const o0 = (i * 2 + 0) * 3; // 上
      const o1 = (i * 2 + 1) * 3; // 下
      positions[o0 + 0] = xs[i];
      positions[o0 + 1] = ys[i];
      positions[o0 + 2] = topTs[i];
      positions[o1 + 0] = xs[i];
      positions[o1 + 1] = ys[i];
      positions[o1 + 2] = botTs[i];
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = i * 2 + 0; // 上 i
      const b = i * 2 + 1; // 下 i
      const c = j * 2 + 0; // 上 j
      const d = j * 2 + 1; // 下 j
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setIndex(indices);
    return g;
  }, [sideSamples]);

  // 時間方向の垂直線 N 本: 各 θ で (bottom, top) = (observer.t − ρ, observer.t + ρ)。
  // CylinderGeometry + wireframe と違い、三角形の対角線・上下 ring は出ない。
  const verticalLinesGeometry = useMemo(() => {
    if (!sideSamples) return null;
    const { N, xs, ys, topTs, botTs } = sideSamples;
    const positions = new Float32Array(N * 2 * 3);
    for (let i = 0; i < N; i++) {
      const o0 = (i * 2 + 0) * 3;
      const o1 = (i * 2 + 1) * 3;
      positions[o0 + 0] = xs[i];
      positions[o0 + 1] = ys[i];
      positions[o0 + 2] = botTs[i];
      positions[o1 + 0] = xs[i];
      positions[o1 + 1] = ys[i];
      positions[o1 + 2] = topTs[i];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [sideSamples]);

  // 過去光円錐 × 円柱 の交線 (closed curve)。sideSamples の bottom と一致するが、
  // PastConeLoop は独立の密度 (ARENA_PAST_CONE_SEGMENTS) でサンプリングして滑らかな曲線
  // にする (surface/線の N=ARENA_RADIAL_SEGMENTS は少なめ)。
  const pastConeGeometry = useMemo(() => {
    if (!observerPos) return null;
    const N = ARENA_PAST_CONE_SEGMENTS;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const wx = ARENA_CENTER_X + ARENA_RADIUS * Math.cos(theta);
      const wy = ARENA_CENTER_Y + ARENA_RADIUS * Math.sin(theta);
      const dx = wx - observerPos.x;
      const dy = wy - observerPos.y;
      const rho = Math.sqrt(dx * dx + dy * dy);
      positions[i * 3 + 0] = wx;
      positions[i * 3 + 1] = wy;
      positions[i * 3 + 2] = observerPos.t - rho;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [observerPos]);

  // 未来光円錐 × 円柱 の交線: pastCone と対称、t 成分の符号だけ反転。
  const futureConeGeometry = useMemo(() => {
    if (!observerPos) return null;
    const N = ARENA_PAST_CONE_SEGMENTS;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const wx = ARENA_CENTER_X + ARENA_RADIUS * Math.cos(theta);
      const wy = ARENA_CENTER_Y + ARENA_RADIUS * Math.sin(theta);
      const dx = wx - observerPos.x;
      const dy = wy - observerPos.y;
      const rho = Math.sqrt(dx * dx + dy * dy);
      positions[i * 3 + 0] = wx;
      positions[i * 3 + 1] = wy;
      positions[i * 3 + 2] = observerPos.t + rho;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [observerPos]);

  return (
    <>
      {/* 円柱側面 surface (双円錐で切り出された形、両面可視) */}
      {surfaceGeometry && (
        <mesh
          geometry={surfaceGeometry}
          matrix={displayMatrix}
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
      )}
      {/* 時間方向の垂直線 N 本 (上下端は観測者因果コーンで clipped) */}
      {verticalLinesGeometry && (
        <lineSegments
          geometry={verticalLinesGeometry}
          matrix={displayMatrix}
          matrixAutoUpdate={false}
        >
          <lineBasicMaterial
            color={arenaThreeColor}
            transparent
            opacity={ARENA_VERTICAL_LINE_OPACITY}
            depthWrite={false}
          />
        </lineSegments>
      )}
      {/* 過去光円錐 ∩ 円柱 (下地平線) */}
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
      {/* 未来光円錐 ∩ 円柱 (上地平線、過去光円錐より控えめの opacity) */}
      {futureConeGeometry && (
        <lineLoop
          geometry={futureConeGeometry}
          matrix={displayMatrix}
          matrixAutoUpdate={false}
        >
          <lineBasicMaterial
            color={arenaThreeColor}
            transparent
            opacity={ARENA_FUTURE_CONE_OPACITY}
            depthWrite={false}
          />
        </lineLoop>
      )}
    </>
  );
};
