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
import { applyStardustShader } from "./stardustShader";
import { getThreeColor } from "./threeCache";

// Stardust (時空星屑、案 17、2026-04-17):
//
// N 個の 4D event (spark) を world frame で pre-generated、THREE.Points で D pattern
// 描画。各 spark は「時空の 1 event」で位置 (x, y, t) 固定。光行差と Lorentz 変換は
// per-vertex で自動適用。
//
// **静止観測者から見た挙動**: observer.t が進むと各 spark の display z = t_spark -
// t_obs が減少 → spark が observer の過去方向 (display 下方向) へ一様に流れる。
// 「時空 event を通過している」体感が出る。timelike drift 版 (t を観測者と同期して
// 静止時止める) と比較し、本版は静止時も流入があり「動いている感」が強い。
//
// **Periodic boundary (recycling)**: 観測者が box 外 (半幅 STARDUST_*_HALF_RANGE)
// に出ると、spark を反対側へ wrap-around。境界近傍は per-vertex 時間 fade で
// 既に透明なので wrap は視認されない。grid + hash procedural 生成方式 (観測者が
// cell を跨いだ瞬間に spark 群が全差し替えになり視覚ポッピング) は採用しない。
export const StardustRenderer = () => {
  const { displayMatrix, observerPos } = useDisplayFrame();

  const observerPosRef = useRef(observerPos);
  observerPosRef.current = observerPos;

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
      // t wrap-around (観測者.t 進行への追従。本版は drift なし = spark は world 固定で
      // observer.t が進むと display z 方向に流れる = 「時空 event の通過」体感)
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
        onBeforeCompile={applyStardustShader}
      />
    </points>
  );
};
