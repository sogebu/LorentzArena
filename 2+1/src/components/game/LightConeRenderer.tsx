import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_RADIAL_SEGMENTS,
  ARENA_RADIUS,
  LIGHT_CONE_COLOR,
  LIGHT_CONE_HEIGHT,
  LIGHT_CONE_SURFACE_OPACITY,
  LIGHT_CONE_WIRE_OPACITY,
} from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { getThreeColor } from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";

/**
 * 観測者 `(ox, oy)` から角度 θ へのレイが、円柱 `(x−cx)² + (y−cy)² = R²` の側面に最初に
 * 到達するまでの距離 ρ(θ) を返す。到達しない (ray が円柱を外す / ray が円柱から遠ざかる)
 * 場合は null。
 *
 * 幾何:
 *   ray 上の点 = `(ox + ρ cosθ, oy + ρ sinθ)` が `(x − cx)² + (y − cy)² = R²` を満たす。
 *   `dx = ox − cx`, `dy = oy − cy` と置くと:
 *     ρ² + 2aρ + (dx² + dy² − R²) = 0,  a = dx cosθ + dy sinθ
 *   判別式 = R² − q²,  q = dx sinθ − dy cosθ (ray line と中心との符号付き垂直距離)
 *   解: ρ = −a ± √(R² − q²)
 *
 * - 観測者が円柱内部 (dx² + dy² < R²): 正根は `−a + √(R² − q²)` ただ一つ。
 * - 観測者が円柱外部で ray が円柱を貫く: 2 正根 → 小さい方を取る (near hit)。
 * - 観測者が円柱外部で ray が円柱を外す / 離れる: 判別式 < 0 または両根 ≤ 0 → null。
 *
 * pure 関数 (Vitest 可)、allocation ゼロ。
 */
export const cylinderHitDistance = (
  ox: number,
  oy: number,
  theta: number,
  cx: number,
  cy: number,
  R: number,
): number | null => {
  const dx = ox - cx;
  const dy = oy - cy;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const a = dx * cosT + dy * sinT;
  const q = dx * sinT - dy * cosT;
  const disc = R * R - q * q;
  if (disc < 0) return null; // ray misses cylinder entirely
  const sqrtD = Math.sqrt(disc);
  const rho1 = -a - sqrtD;
  const rho2 = -a + sqrtD;
  // Smallest positive hit; null if both non-positive (観測者外部で逆向き).
  if (rho1 > 0) return rho1;
  if (rho2 > 0) return rho2;
  return null;
};

/**
 * 自機光円錐 (未来 + 過去)。ConeGeometry の固定半径 LIGHT_CONE_HEIGHT を辞め、各方位 θ_i
 * ごとにレイが円柱側面に到達する距離 ρ(θ_i) まで延伸する。ρ が定義できない方向は
 * LIGHT_CONE_HEIGHT にフォールバック。
 *
 * **vertex layout** (geometry ごと N+1 = ARENA_RADIAL_SEGMENTS + 1 vertex):
 *   - idx 0 = apex (= 観測者 event)
 *   - idx 1..N = rim, θ_i = 2π·i/N
 *   future rim: `(ox + ρ_i cosθ, oy + ρ_i sinθ, observer.t + ρ_i)`
 *   past rim:   `(ox + ρ_i cosθ, oy + ρ_i sinθ, observer.t − ρ_i)`
 *
 * **index layout**: apex-fan triangles `(0, 1+i, 1+((i+1)%N))`。surface / wire で共有。
 * wireframe は `MeshBasicMaterial.wireframe = true` で三角形の辺を線描画。
 *
 * **D pattern**: vertex を world 座標で書き、`mesh.matrix = displayMatrix` を固定 (ArenaRenderer
 * と同じ手筋)。per-vertex 時間 fade shader は `modelMatrix × vertex` で display.z を取るので、
 * apex (z=0) が濃く rim (z=±ρ) が自然に薄くなる。
 *
 * **per-frame 更新**: useFrame で apex + rim 位置を in-place 書き込み + `needsUpdate = true`。
 * allocation ゼロ、GC 圧なし (M17)。position 毎 frame 可変のため `frustumCulled={false}`。
 */
export const LightConeRenderer = ({
  observerPos,
}: {
  observerPos: { x: number; y: number; t: number };
}) => {
  const { displayMatrix } = useDisplayFrame();
  const observerPosRef = useRef(observerPos);
  observerPosRef.current = observerPos;

  const color = useMemo(() => getThreeColor(LIGHT_CONE_COLOR), []);

  // --- 4 geometry (future/past × surface/wire)、2 BufferAttribute を共有 ---
  const geo = useMemo(() => {
    const N = ARENA_RADIAL_SEGMENTS;
    const vertexCount = N + 1; // apex + N rim
    const futurePositions = new Float32Array(vertexCount * 3);
    const pastPositions = new Float32Array(vertexCount * 3);
    const futureAttr = new THREE.BufferAttribute(futurePositions, 3);
    const pastAttr = new THREE.BufferAttribute(pastPositions, 3);

    // apex-fan triangles: (apex=0, rim_i=1+i, rim_{i+1}=1+((i+1)%N))
    const triIndices: number[] = [];
    for (let i = 0; i < N; i++) {
      triIndices.push(0, 1 + i, 1 + ((i + 1) % N));
    }

    const makeGeo = (attr: THREE.BufferAttribute): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", attr);
      g.setIndex(triIndices);
      return g;
    };

    return {
      futurePositions,
      futureAttr,
      pastPositions,
      pastAttr,
      futureSurface: makeGeo(futureAttr),
      futureWire: makeGeo(futureAttr),
      pastSurface: makeGeo(pastAttr),
      pastWire: makeGeo(pastAttr),
    };
  }, []);

  useFrame(() => {
    const pos = observerPosRef.current;
    if (!pos) return;
    const { futurePositions, futureAttr, pastPositions, pastAttr } = geo;
    const N = ARENA_RADIAL_SEGMENTS;

    // Apex (idx 0): 両 cone とも観測者 event。
    futurePositions[0] = pos.x;
    futurePositions[1] = pos.y;
    futurePositions[2] = pos.t;
    pastPositions[0] = pos.x;
    pastPositions[1] = pos.y;
    pastPositions[2] = pos.t;

    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const hit = cylinderHitDistance(
        pos.x,
        pos.y,
        theta,
        ARENA_CENTER_X,
        ARENA_CENTER_Y,
        ARENA_RADIUS,
      );
      const rho = hit ?? LIGHT_CONE_HEIGHT;
      const rx = pos.x + rho * Math.cos(theta);
      const ry = pos.y + rho * Math.sin(theta);
      const o = (1 + i) * 3;
      // future rim (z = observer.t + ρ)
      futurePositions[o + 0] = rx;
      futurePositions[o + 1] = ry;
      futurePositions[o + 2] = pos.t + rho;
      // past rim (z = observer.t − ρ)
      pastPositions[o + 0] = rx;
      pastPositions[o + 1] = ry;
      pastPositions[o + 2] = pos.t - rho;
    }

    futureAttr.needsUpdate = true;
    pastAttr.needsUpdate = true;
  });

  return (
    <>
      {/* Future surface + wire */}
      <mesh
        geometry={geo.futureSurface}
        matrix={displayMatrix}
        matrixAutoUpdate={false}
        frustumCulled={false}
      >
        <meshBasicMaterial
          color={color}
          transparent
          opacity={LIGHT_CONE_SURFACE_OPACITY}
          side={THREE.DoubleSide}
          depthWrite={false}
          onBeforeCompile={applyTimeFadeShader}
        />
      </mesh>
      <mesh
        geometry={geo.futureWire}
        matrix={displayMatrix}
        matrixAutoUpdate={false}
        frustumCulled={false}
      >
        <meshBasicMaterial
          color={color}
          transparent
          opacity={LIGHT_CONE_WIRE_OPACITY}
          wireframe
          depthWrite={false}
          onBeforeCompile={applyTimeFadeShader}
        />
      </mesh>
      {/* Past surface + wire */}
      <mesh
        geometry={geo.pastSurface}
        matrix={displayMatrix}
        matrixAutoUpdate={false}
        frustumCulled={false}
      >
        <meshBasicMaterial
          color={color}
          transparent
          opacity={LIGHT_CONE_SURFACE_OPACITY}
          side={THREE.DoubleSide}
          depthWrite={false}
          onBeforeCompile={applyTimeFadeShader}
        />
      </mesh>
      <mesh
        geometry={geo.pastWire}
        matrix={displayMatrix}
        matrixAutoUpdate={false}
        frustumCulled={false}
      >
        <meshBasicMaterial
          color={color}
          transparent
          opacity={LIGHT_CONE_WIRE_OPACITY}
          wireframe
          depthWrite={false}
          onBeforeCompile={applyTimeFadeShader}
        />
      </mesh>
    </>
  );
};
