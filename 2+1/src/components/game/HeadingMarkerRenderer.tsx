import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { quatToYaw } from "../../physics";
import {
  HEADING_MARKER_LENGTH,
  HEADING_MARKER_OPACITY,
  LASER_PAST_CONE_MARKER_COLOR,
} from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { useGameStore } from "../../stores/game-store";
import { getThreeColor } from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";
import type { RelativisticPlayer } from "./types";

/**
 * 未来光円錐の母線として heading 方向に null geodesic を描画する。
 * 機体姿勢に依存せず「向き」が時空に貼られた線で一目瞭然になる
 * (plans/2026-04-25-viewpoint-controls.md Stage 1)。
 *
 * 自機: cameraYawRef を直読 (re-render 遅延回避、SelfShipRenderer と同じ方式)。
 * 他機: phaseSpace.heading の quaternion から quatToYaw 経由。
 *
 * 描画は LaserBatchRenderer と同じ D pattern (頂点は world frame、
 * mesh.matrix に displayMatrix を適用 → GPU で per-vertex Lorentz)。
 */
export const HeadingMarkerRenderer = ({
  player,
  cameraYawRef,
}: {
  player: RelativisticPlayer;
  cameraYawRef?: React.RefObject<number>;
}) => {
  const { displayMatrix } = useDisplayFrame();
  const meshRef = useRef<THREE.LineSegments | null>(null);
  const geoRef = useRef<THREE.BufferGeometry | null>(null);
  // Shooter mode で heading 線を cannon 回転と同じ lerp で滑らかに追従させる。
  // Classic mode では heading 即時 (機体回転と同期) なので smoothing なし。
  const viewMode = useGameStore((s) => s.viewMode);
  const smoothedYawRef = useRef<number | null>(null);

  const geometry = useMemo(() => {
    geoRef.current?.dispose();
    const verts = new Float32Array(6); // 1 segment × 2 vertices × 3 floats
    const colors = new Float32Array(6);
    const c = getThreeColor(LASER_PAST_CONE_MARKER_COLOR);
    for (let i = 0; i < 2; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    const posAttr = new THREE.Float32BufferAttribute(verts, 3);
    posAttr.usage = THREE.DynamicDrawUsage;
    g.setAttribute("position", posAttr);
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geoRef.current = g;
    return g;
  }, []);

  useEffect(() => {
    return () => {
      geoRef.current?.dispose();
      geoRef.current = null;
    };
  }, []);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const targetYaw = cameraYawRef
      ? cameraYawRef.current
      : quatToYaw(player.phaseSpace.heading);
    let yaw: number;
    if (viewMode === "shooter") {
      // 初回は target そのまま、以降は SelfShipRenderer の cannon と同じ tau=80ms で追従。
      if (smoothedYawRef.current === null) {
        smoothedYawRef.current = targetYaw;
      } else {
        let diff = targetYaw - smoothedYawRef.current;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const tau = 0.08;
        const alpha = 1 - Math.exp(-Math.min(0.1, delta) / tau);
        smoothedYawRef.current += diff * alpha;
      }
      yaw = smoothedYawRef.current;
    } else {
      // Classic: 即時 (機体回転に同期)。smoothedYawRef はリセットして次回 shooter 切替時に
      // 急ジャンプしないようにする。
      smoothedYawRef.current = targetYaw;
      yaw = targetYaw;
    }
    const dx = Math.cos(yaw);
    const dy = Math.sin(yaw);
    const pos = player.phaseSpace.pos;
    const verts = geometry.attributes.position.array as Float32Array;
    verts[0] = pos.x;
    verts[1] = pos.y;
    verts[2] = pos.t;
    verts[3] = pos.x + dx * HEADING_MARKER_LENGTH;
    verts[4] = pos.y + dy * HEADING_MARKER_LENGTH;
    verts[5] = pos.t + HEADING_MARKER_LENGTH; // null geodesic: Δt = |Δx_spatial|
    geometry.attributes.position.needsUpdate = true;
    mesh.matrix.copy(displayMatrix);
    mesh.matrixAutoUpdate = false;
  });

  return (
    <lineSegments ref={meshRef} geometry={geometry}>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={HEADING_MARKER_OPACITY}
        onBeforeCompile={applyTimeFadeShader}
        depthWrite={false}
      />
    </lineSegments>
  );
};
