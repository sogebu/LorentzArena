import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { LASER_WORLDLINE_OPACITY } from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { getThreeColor } from "./threeCache";
import type { Laser } from "./types";

// D pattern: world frame の端点で BufferGeometry を構築し、lineSegments の matrix に
// displayMatrix を適用して GPU で頂点単位 Lorentz。observer 変化時に geometry 再生成
// せず matrix のみ更新できる副産物あり (ただし lasers.length 変化で再生成する現状)。
export const LaserBatchRenderer = ({
  lasers,
}: { lasers: readonly Laser[] }) => {
  const { displayMatrix } = useDisplayFrame();
  const geoRef = useRef<THREE.BufferGeometry | null>(null);
  const meshRef = useRef<THREE.LineSegments | null>(null);

  useEffect(() => {
    return () => {
      geoRef.current?.dispose();
      geoRef.current = null;
    };
  }, []);

  const geometry = useMemo(() => {
    geoRef.current?.dispose();
    if (lasers.length === 0) {
      geoRef.current = null;
      return null;
    }
    const vertices = new Float32Array(lasers.length * 6);
    const colors = new Float32Array(lasers.length * 6);
    for (let i = 0; i < lasers.length; i++) {
      const l = lasers[i];
      const c = getThreeColor(l.color);
      const off = i * 6;
      // world frame 端点 (three.js coord: x, y, z=t)
      vertices[off] = l.emissionPos.x;
      vertices[off + 1] = l.emissionPos.y;
      vertices[off + 2] = l.emissionPos.t;
      vertices[off + 3] = l.emissionPos.x + l.direction.x * l.range;
      vertices[off + 4] = l.emissionPos.y + l.direction.y * l.range;
      vertices[off + 5] = l.emissionPos.t + l.range;
      colors[off] = c.r;
      colors[off + 1] = c.g;
      colors[off + 2] = c.b;
      colors[off + 3] = c.r;
      colors[off + 4] = c.g;
      colors[off + 5] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geoRef.current = geo;
    return geo;
  }, [lasers]);

  // displayMatrix を mesh.matrix に適用 (頂点単位 Lorentz)
  useEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    m.matrix.copy(displayMatrix);
    m.matrixAutoUpdate = false;
  }, [displayMatrix]);

  if (!geometry) return null;
  return (
    <lineSegments ref={meshRef} geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={LASER_WORLDLINE_OPACITY} />
    </lineSegments>
  );
};
