import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { getThreeColor } from "./threeCache";
import type { DisplayLaser } from "./types";

// レーザーバッチ描画コンポーネント（全レーザーを1つの BufferGeometry にまとめる）
export const LaserBatchRenderer = ({
  displayLasers,
}: { displayLasers: DisplayLaser[] }) => {
  const geoRef = useRef<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    return () => {
      geoRef.current?.dispose();
      geoRef.current = null;
    };
  }, []);

  const geometry = useMemo(() => {
    geoRef.current?.dispose();
    if (displayLasers.length === 0) {
      geoRef.current = null;
      return null;
    }
    const vertices = new Float32Array(displayLasers.length * 6);
    const colors = new Float32Array(displayLasers.length * 6);
    for (let i = 0; i < displayLasers.length; i++) {
      const l = displayLasers[i];
      const c = getThreeColor(l.color);
      const off = i * 6;
      vertices[off] = l.start.x;
      vertices[off + 1] = l.start.y;
      vertices[off + 2] = l.start.t;
      vertices[off + 3] = l.end.x;
      vertices[off + 4] = l.end.y;
      vertices[off + 5] = l.end.t;
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
  }, [displayLasers]);

  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.4} />
    </lineSegments>
  );
};
