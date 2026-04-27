import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { LASER_WORLDLINE_OPACITY } from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { buildLaserSegments, type LaserSegment } from "./laserSegmentSplit";
import { getThreeColor } from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";
import { createTorusFoldShader } from "./torusFoldShader";
import type { Laser } from "./types";

// D pattern: world frame の端点で BufferGeometry を構築し、lineSegments の matrix に
// displayMatrix を適用して GPU で頂点単位 Lorentz。 torus mode では vertex は raw world
// 連続値、 fold は GPU shader で per-vertex に行う (createTorusFoldShader)。 emission ↔ tip
// が異なる image cell の laser は CPU で 2 segment に分割 (buildLaserSegments) して shader
// fold が画面横切る現象を防ぐ。 詳細: plans/2026-04-27-pbc-torus.md §「レーザー軌跡」
export const LaserBatchRenderer = ({
  lasers,
}: {
  lasers: readonly Laser[];
}) => {
  const { displayMatrix, observerPos, torusHalfWidth } = useDisplayFrame();
  const geoRef = useRef<THREE.BufferGeometry | null>(null);
  const meshRef = useRef<THREE.LineSegments | null>(null);

  useEffect(() => {
    return () => {
      geoRef.current?.dispose();
      geoRef.current = null;
    };
  }, []);

  // segment 構造の再計算 gating: torus mode では observer cell 跨ぎでのみ image cell 判定
  // 結果が変わる (cell 内 obs 動きでは結果不変)。 cell index で gate。
  const obsCellX =
    torusHalfWidth !== undefined && observerPos
      ? Math.floor((observerPos.x + torusHalfWidth) / (2 * torusHalfWidth))
      : 0;
  const obsCellY =
    torusHalfWidth !== undefined && observerPos
      ? Math.floor((observerPos.y + torusHalfWidth) / (2 * torusHalfWidth))
      : 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: observerPos は obsCellX/Y 経由で gate
  const geometry = useMemo(() => {
    geoRef.current?.dispose();
    if (lasers.length === 0) {
      geoRef.current = null;
      return null;
    }
    // 各 laser を image cell 跨ぎで segment 配列に展開
    const allSegs: { seg: LaserSegment; color: THREE.Color }[] = [];
    for (const l of lasers) {
      const tip = {
        x: l.emissionPos.x + l.direction.x * l.range,
        y: l.emissionPos.y + l.direction.y * l.range,
        t: l.emissionPos.t + l.range,
      };
      const segs = buildLaserSegments(
        l.emissionPos,
        tip,
        observerPos,
        torusHalfWidth,
      );
      const color = getThreeColor(l.color);
      for (const seg of segs) allSegs.push({ seg, color });
    }
    if (allSegs.length === 0) {
      geoRef.current = null;
      return null;
    }
    const vertices = new Float32Array(allSegs.length * 6);
    const colors = new Float32Array(allSegs.length * 6);
    for (let i = 0; i < allSegs.length; i++) {
      const { seg, color } = allSegs[i];
      const off = i * 6;
      vertices[off] = seg.sx;
      vertices[off + 1] = seg.sy;
      vertices[off + 2] = seg.st;
      vertices[off + 3] = seg.ex;
      vertices[off + 4] = seg.ey;
      vertices[off + 5] = seg.et;
      colors[off] = color.r;
      colors[off + 1] = color.g;
      colors[off + 2] = color.b;
      colors[off + 3] = color.r;
      colors[off + 4] = color.g;
      colors[off + 5] = color.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geoRef.current = geo;
    return geo;
  }, [lasers, torusHalfWidth, obsCellX, obsCellY]);

  // displayMatrix を mesh.matrix に適用 (頂点単位 Lorentz)
  useEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    m.matrix.copy(displayMatrix);
    m.matrixAutoUpdate = false;
  }, [displayMatrix]);

  // torus fold shader 用の観測者連続位置 ref。 useFrame で in-place 更新 → uObserverPos
  // uniform が auto sync。
  const obsShaderPos = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (observerPos) obsShaderPos.set(observerPos.x, observerPos.y, 0);
  });

  // Shader 注入順 = `fold → timeFade`。 fold が transformed.xy を観測者 primary cell に
  // 折り、 timeFade は fold 後 modelMatrix * transformed の z (= dt) で Lorentzian fade。
  // (z 不変なので fold は timeFade に影響しない)
  const onShader = useMemo(() => {
    if (torusHalfWidth === undefined) return applyTimeFadeShader;
    const fold = createTorusFoldShader(torusHalfWidth, obsShaderPos);
    return (s: THREE.WebGLProgramParametersWithUniforms) => {
      fold(s);
      applyTimeFadeShader(s);
    };
  }, [torusHalfWidth, obsShaderPos]);

  if (!geometry) return null;
  return (
    <lineSegments ref={meshRef} geometry={geometry}>
      {/* per-vertex 時間 fade: 各 laser の emission 端 (observer.t 近傍) は濃く、
          range 先の先端 (emissionPos.t + range) は薄くなる。batch の 1 material で
          全 laser が自動的に個別 fade。 */}
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={LASER_WORLDLINE_OPACITY}
        onBeforeCompile={onShader}
      />
    </lineSegments>
  );
};
