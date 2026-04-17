import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
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
//   各 θ で円柱側面上の点から観測者への空間距離 ρ(θ) を計算し、
//   下端 = observer.t − ρ(θ) (過去光円錐 ∩ 円柱)、
//   上端 = observer.t + ρ(θ) (未来光円錐 ∩ 円柱)。
//   観測者中心では均一な円、離れると双円錐で切り出された形に歪む。
//
// **in-place update パターン**: BufferGeometry は初回だけ作成し、以後毎フレーム
// `useFrame` で position attribute を in-place 更新 + `needsUpdate=true` で GPU
// に差分 upload する。observer 位置が毎 tick 変わっても BufferGeometry /
// Float32Array の allocation は発生しない (GC 圧・GPU buffer leak を回避)。
// 旧実装 (毎 tick useMemo で BufferGeometry 新規作成) から切り替えた FPS 対策。
export const ArenaRenderer = () => {
  const { displayMatrix, observerPos } = useDisplayFrame();

  // observerPos を ref に sync して useFrame callback 内から最新値を参照可能に。
  const observerPosRef = useRef(observerPos);
  observerPosRef.current = observerPos;

  const arenaThreeColor = useMemo(() => getThreeColor(ARENA_COLOR), []);

  // --- Geometry 初期化 (マウント時 1 回のみ) ---
  // positions は 0 埋め、indices は静的 (観測者非依存)。
  // positions は useFrame で in-place 更新される。

  const surfaceGeometry = useMemo(() => {
    const N = ARENA_RADIAL_SEGMENTS;
    const positions = new Float32Array(N * 2 * 3); // 上下 2 vertex per θ
    const indices: number[] = [];
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
  }, []);

  const verticalLinesGeometry = useMemo(() => {
    const N = ARENA_RADIAL_SEGMENTS;
    const positions = new Float32Array(N * 2 * 3); // 2 vertex per θ (下→上)
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

  const pastConeGeometry = useMemo(() => {
    const N = ARENA_PAST_CONE_SEGMENTS;
    const positions = new Float32Array(N * 3); // 1 vertex per θ (closed loop)
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

  const futureConeGeometry = useMemo(() => {
    const N = ARENA_PAST_CONE_SEGMENTS;
    const positions = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

  // --- Per-frame in-place update ---
  useFrame(() => {
    const pos = observerPosRef.current;
    if (!pos) return;

    const N = ARENA_RADIAL_SEGMENTS;
    const sPosAttr = surfaceGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const vPosAttr = verticalLinesGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const sArr = sPosAttr.array as Float32Array;
    const vArr = vPosAttr.array as Float32Array;

    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const wx = ARENA_CENTER_X + ARENA_RADIUS * Math.cos(theta);
      const wy = ARENA_CENTER_Y + ARENA_RADIUS * Math.sin(theta);
      const dx = wx - pos.x;
      const dy = wy - pos.y;
      const rho = Math.sqrt(dx * dx + dy * dy);
      const topT = pos.t + rho;
      const botT = pos.t - rho;

      const o0 = (i * 2 + 0) * 3;
      const o1 = (i * 2 + 1) * 3;
      // surface: 上 vertex
      sArr[o0 + 0] = wx;
      sArr[o0 + 1] = wy;
      sArr[o0 + 2] = topT;
      // surface: 下 vertex
      sArr[o1 + 0] = wx;
      sArr[o1 + 1] = wy;
      sArr[o1 + 2] = botT;
      // vertical line: 下 → 上 の 2 頂点ペア
      vArr[o0 + 0] = wx;
      vArr[o0 + 1] = wy;
      vArr[o0 + 2] = botT;
      vArr[o1 + 0] = wx;
      vArr[o1 + 1] = wy;
      vArr[o1 + 2] = topT;
    }
    sPosAttr.needsUpdate = true;
    vPosAttr.needsUpdate = true;

    // Past / Future cone loops (密度は別定数で指定、surface の N と独立に滑らか)
    const Nc = ARENA_PAST_CONE_SEGMENTS;
    const pPosAttr = pastConeGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const fPosAttr = futureConeGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const pArr = pPosAttr.array as Float32Array;
    const fArr = fPosAttr.array as Float32Array;
    for (let i = 0; i < Nc; i++) {
      const theta = (i / Nc) * Math.PI * 2;
      const wx = ARENA_CENTER_X + ARENA_RADIUS * Math.cos(theta);
      const wy = ARENA_CENTER_Y + ARENA_RADIUS * Math.sin(theta);
      const dx = wx - pos.x;
      const dy = wy - pos.y;
      const rho = Math.sqrt(dx * dx + dy * dy);
      const idx = i * 3;
      pArr[idx + 0] = wx;
      pArr[idx + 1] = wy;
      pArr[idx + 2] = pos.t - rho;
      fArr[idx + 0] = wx;
      fArr[idx + 1] = wy;
      fArr[idx + 2] = pos.t + rho;
    }
    pPosAttr.needsUpdate = true;
    fPosAttr.needsUpdate = true;
  });

  return (
    <>
      {/* 円柱側面 surface (双円錐で切り出された形、両面可視) */}
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
      {/* 時間方向の垂直線 N 本 (上下端は観測者因果コーンで clipped) */}
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
      {/* 過去光円錐 ∩ 円柱 (下地平線) */}
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
      {/* 未来光円錐 ∩ 円柱 (上地平線、過去光円錐より控えめの opacity) */}
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
    </>
  );
};
