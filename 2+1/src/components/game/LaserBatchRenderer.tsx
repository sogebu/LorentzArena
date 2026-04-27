import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { observableImageCells, requiredImageCellRadius } from "../../physics";
import { LASER_WORLDLINE_OPACITY, LIGHT_CONE_HEIGHT } from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { buildLaserSegments, type LaserSegment } from "./laserSegmentSplit";
import { getThreeColor } from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";
import type { Laser } from "./types";

// **PBC universal cover**: vertex は raw world coords、 各 image cell `(2R+1)²` を独立な
// LineSegments mesh で複製描画 (= 同じ BufferGeometry を共有、 mesh.matrix で `displayMatrix
// × translate(2L*offset)` を per-image 設定)。 segment split (buildLaserSegments) は維持
// = 各 segment が cell 内に収まる前提で、 各 image でも cell 境界跨ぎ artifact が出ない。
// open_cylinder mode は instance count = 1 (= primary cell のみ) で従来挙動と等価。
export const LaserBatchRenderer = ({
  lasers,
}: {
  lasers: readonly Laser[];
}) => {
  const { displayMatrix, observerPos, torusHalfWidth } = useDisplayFrame();
  const geoRef = useRef<THREE.BufferGeometry | null>(null);
  const meshRefs = useRef<(THREE.LineSegments | null)[]>([]);

  useEffect(() => {
    return () => {
      geoRef.current?.dispose();
      geoRef.current = null;
    };
  }, []);

  // 観測者から見える image cells。 torus mode では `(2R+1)²` 個、 open_cylinder では primary
  // 1 個。 cells 配列の順序が mesh refs の index に対応。
  const cells = useMemo(() => {
    if (torusHalfWidth === undefined) return [{ kx: 0, ky: 0 }];
    const R = requiredImageCellRadius(torusHalfWidth, LIGHT_CONE_HEIGHT);
    return observableImageCells(R);
  }, [torusHalfWidth]);

  // segment 構造の再計算 gating: torus mode では observer cell 跨ぎでのみ image cell 判定
  // 結果が変わる。
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
    // 各 laser を image cell 跨ぎで segment 配列に展開 (= 1 segment が cell 内に収まる前提)。
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

  // 各 image cell mesh の matrix を `displayMatrix × translate(2L*(obsCell+offset))` で設定。
  // **observer follow**: observer cell index を加算して、 9 cells が観測者に追従。
  // 共有 BufferGeometry なので vertex 更新は不要、 matrix のみ per-image 更新。
  useEffect(() => {
    const L = torusHalfWidth ?? 0;
    for (let i = 0; i < cells.length; i++) {
      const m = meshRefs.current[i];
      if (!m) continue;
      const offset = new THREE.Matrix4().makeTranslation(
        2 * L * (obsCellX + cells[i].kx),
        2 * L * (obsCellY + cells[i].ky),
        0,
      );
      m.matrix.multiplyMatrices(displayMatrix, offset);
      m.matrixAutoUpdate = false;
    }
  }, [displayMatrix, cells, torusHalfWidth, obsCellX, obsCellY]);

  if (!geometry) return null;
  return (
    <>
      {cells.map((cell, i) => (
        <lineSegments
          key={`${cell.kx},${cell.ky}`}
          ref={(el) => {
            meshRefs.current[i] = el;
          }}
          geometry={geometry}
          frustumCulled={false}
        >
          {/* per-vertex 時間 fade: 各 image cell が独立 dt で fade (= 隣接 image は遠方
              dt 大で薄く描画される)。 */}
          <lineBasicMaterial
            vertexColors
            transparent
            opacity={LASER_WORLDLINE_OPACITY}
            onBeforeCompile={applyTimeFadeShader}
          />
        </lineSegments>
      ))}
    </>
  );
};
