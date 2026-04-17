import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  STARDUST_COLOR,
  STARDUST_COUNT,
  STARDUST_OPACITY,
  STARDUST_SIZE,
  STARDUST_SPATIAL_HALF_RANGE,
  STARDUST_TIME_HALF_RANGE,
} from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { getThreeColor } from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";

// Stardust (時空星屑、案 17 + timelike drift 実験、2026-04-17):
//
// N 個の spark を world frame で pre-generated、THREE.Points で D pattern 描画。
// 光行差と Lorentz 変換は per-vertex で自動適用。
//
// **Timelike drift 実験 (2026-04-17)**: 各 spark.t を毎フレーム観測者.t の増分と
// 同じ dt だけ進める → 観測者との相対 t = 一定。世界系で静止した観測者には spark が
// 止まって見え、運動すると spatial offset × γβ の光行差だけが現れる。各 spark の
// world line は (x, y) 固定で t 方向に伸びる timelike worldline = EXPLORING.md
// §案 16 (star aberration skybox) の pattern。案 17 (null event) との差は後述。
//
// **Periodic boundary (x, y のみ)**: 観測者が box 外 (半幅 STARDUST_SPATIAL_HALF_RANGE)
// に出ると、spark を反対側へ wrap-around。境界近傍は per-vertex 時間 fade で
// 既に透明なので wrap は視認されない。grid + hash procedural 生成方式 (観測者が
// cell を跨いだ瞬間に spark 群が全差し替えになり視覚ポッピング) は採用しない。
//
// **t 方向の扱い**: 初回 frame のみ wrap-around で [-halfT, halfT] → [obs.t ± halfT]
// へアラインし、以後は drift が同期を保つので wrap は発火しない (safety net として残す)。
//
// 案 16 との differentiation: 16 は「世界固定の天体」で空間位置が world-frame
// static、17 は「時空の event」。この drift 実装は「(x, y) 固定 + t 方向は同期して
// 進む」ので案 16 寄り。純粋な案 17 (t drift なし) では静止時も時間方向に spark が
// 流れ「時空を進んでいる体感」が出るが、静止観測者が「止まって見える」を優先する
// なら drift 版が適切。どちらに倒すかは体感で決定 (本実装は暫定 drift 版)。
export const StardustRenderer = () => {
  const { displayMatrix, observerPos } = useDisplayFrame();

  const observerPosRef = useRef(observerPos);
  observerPosRef.current = observerPos;

  // Drift tracking: previous observer.t for delta computation
  const prevObsTRef = useRef<number | null>(null);

  const color = useMemo(() => getThreeColor(STARDUST_COLOR), []);

  // 初回のみ spark 配置を生成。観測者位置を知らないまま (0,0,0) 原点 box に
  // 配置し、初回 useFrame の wrap-around で観測者近傍に自動 shift される。
  const { geometry, positions } = useMemo(() => {
    const N = STARDUST_COUNT;
    const arr = new Float32Array(N * 3);
    const hx = STARDUST_SPATIAL_HALF_RANGE;
    const hy = STARDUST_SPATIAL_HALF_RANGE;
    const ht = STARDUST_TIME_HALF_RANGE;
    for (let i = 0; i < N; i++) {
      arr[i * 3 + 0] = (Math.random() * 2 - 1) * hx;
      arr[i * 3 + 1] = (Math.random() * 2 - 1) * hy;
      arr[i * 3 + 2] = (Math.random() * 2 - 1) * ht;
    }
    const posAttr = new THREE.BufferAttribute(arr, 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", posAttr);
    return { geometry: geo, positions: posAttr };
  }, []);

  useFrame(() => {
    const pos = observerPosRef.current;
    if (!pos) return;
    const arr = positions.array as Float32Array;
    const N = STARDUST_COUNT;
    const hx = STARDUST_SPATIAL_HALF_RANGE;
    const hy = STARDUST_SPATIAL_HALF_RANGE;
    const ht = STARDUST_TIME_HALF_RANGE;
    const spanX = 2 * hx;
    const spanY = 2 * hy;
    const spanT = 2 * ht;

    // Timelike drift: spark.t を観測者.t の増分だけ進める。
    // 結果、spark.t - observer.t = 一定 → 静止観測者には止まって見える。
    const prevT = prevObsTRef.current;
    const driftDt = prevT === null ? 0 : pos.t - prevT;
    prevObsTRef.current = pos.t;

    let dirty = false;
    for (let i = 0; i < N; i++) {
      const bx = i * 3;
      const by = bx + 1;
      const bt = bx + 2;
      // x wrap-around (観測者空間移動への追従)
      const dx = arr[bx] - pos.x;
      if (dx > hx) {
        arr[bx] -= Math.ceil((dx - hx) / spanX) * spanX;
        dirty = true;
      } else if (dx < -hx) {
        arr[bx] += Math.ceil((-dx - hx) / spanX) * spanX;
        dirty = true;
      }
      // y wrap-around
      const dy = arr[by] - pos.y;
      if (dy > hy) {
        arr[by] -= Math.ceil((dy - hy) / spanY) * spanY;
        dirty = true;
      } else if (dy < -hy) {
        arr[by] += Math.ceil((-dy - hy) / spanY) * spanY;
        dirty = true;
      }
      // t: drift で観測者と同期 + 初回 frame のみ wrap で align (以降は drift が範囲維持)
      if (driftDt !== 0) {
        arr[bt] += driftDt;
        dirty = true;
      }
      const dt = arr[bt] - pos.t;
      if (dt > ht) {
        arr[bt] -= Math.ceil((dt - ht) / spanT) * spanT;
        dirty = true;
      } else if (dt < -ht) {
        arr[bt] += Math.ceil((-dt - ht) / spanT) * spanT;
        dirty = true;
      }
    }
    if (dirty) positions.needsUpdate = true;
  });

  return (
    <points
      geometry={geometry}
      matrix={displayMatrix}
      matrixAutoUpdate={false}
      frustumCulled={false}
      renderOrder={-1}
    >
      <pointsMaterial
        color={color}
        size={STARDUST_SIZE}
        sizeAttenuation
        transparent
        opacity={STARDUST_OPACITY}
        depthWrite={false}
        onBeforeCompile={applyTimeFadeShader}
      />
    </points>
  );
};
