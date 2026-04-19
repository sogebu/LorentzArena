import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { pastLightConeIntersectionWorldLine } from "../../physics";
import { PLAYER_WORLDLINE_OPACITY } from "./constants";
import { buildDisplayMatrix } from "./displayTransform";
import { createInnerHideShader } from "./innerHideShader";
import { getThreeColor } from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";
import type { WorldLineRendererProps } from "./types";

/** TubeGeometry regeneration interval (in append count).
 * Higher = fewer geometry rebuilds but choppier world lines. */
export const TUBE_REGEN_INTERVAL = 8;

export const WorldLineRenderer = ({
  worldLine: wl,
  color,
  observerPos,
  observerBoost,
  tubeRadius = 0.03,
  tubeOpacity = PLAYER_WORLDLINE_OPACITY,
  innerHideRadius,
}: WorldLineRendererProps) => {
  const tubeRef = useRef<THREE.Mesh>(null);
  const prevTubeGeoRef = useRef<THREE.TubeGeometry | null>(null);

  // version を TUBE_REGEN_INTERVAL で量子化して再生成を間引く
  // wl オブジェクト自体が変わった時（リスポーン）も確実に再生成するため wl を依存に含める
  const geoVersion = Math.floor(wl.version / TUBE_REGEN_INTERVAL);
  // biome-ignore lint/correctness/useExhaustiveDependencies: geoVersion throttles rebuild; wl included for respawn identity change
  const tubeGeo = useMemo(() => {
    prevTubeGeoRef.current?.dispose();
    if (wl.history.length < 2) {
      prevTubeGeoRef.current = null;
      return null;
    }
    const points = wl.history.map(
      (ps) => new THREE.Vector3(ps.pos.x, ps.pos.y, ps.pos.t),
    );
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.5);
    const segments = Math.max(1, points.length * 2);
    const geo = new THREE.TubeGeometry(curve, segments, tubeRadius, 6, false);
    prevTubeGeoRef.current = geo;
    return geo;
  }, [geoVersion, wl]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      prevTubeGeoRef.current?.dispose();
    };
  }, []);

  const displayMatrix = buildDisplayMatrix(observerPos, observerBoost);
  // Inner hide center: 観測者の過去光円錐とこの世界線との交差点 (= 観測者がこの player を
  // 「今見ている」spacetime 点) に追従。これは gnomon マーカーが描かれる位置でもあり、
  // worldLine 最終 vertex (= player の現在位置) ではない (= 観測者からは光速遅延で過去に見える)。
  // useFrame で in-place 更新 → shader uniform が auto sync。
  const hideCenter = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (tubeRef.current) {
      tubeRef.current.matrix.copy(displayMatrix);
      tubeRef.current.matrixAutoUpdate = false;
    }
    if (innerHideRadius != null && observerPos) {
      const intersection = pastLightConeIntersectionWorldLine(wl, observerPos);
      if (intersection) {
        hideCenter.set(intersection.pos.x, intersection.pos.y, intersection.pos.t);
      }
    }
  });

  // 時間 fade は per-vertex shader (applyTimeFadeShader) で適用: tube の各 vertex が
  // 持つ world 座標を display frame に変換し、その z (= observer rest-frame での dt)
  // から Lorentzian fade を計算して alpha に乗算。生存世界線の tip は observer.t 近傍
  // で fade ≈ 1、tail や凍結世界線の古い部分は自然消失。
  // 加えて innerHideRadius が指定されていれば、観測者の past-cone とこの worldLine の
  // 交差点 (= player が「今見える」位置) を中心に world 距離 R 未満を hide。
  const onShader = useMemo(() => {
    if (innerHideRadius == null) return applyTimeFadeShader;
    const hide = createInnerHideShader(innerHideRadius, hideCenter);
    return (s: THREE.WebGLProgramParametersWithUniforms) => {
      applyTimeFadeShader(s);
      hide(s);
    };
  }, [innerHideRadius, hideCenter]);

  const threeColor = getThreeColor(color);
  return (
    <>
      {tubeGeo && (
        <mesh ref={tubeRef} geometry={tubeGeo}>
          <meshStandardMaterial
            color={threeColor}
            emissive={threeColor}
            emissiveIntensity={0.4}
            roughness={0.4}
            metalness={0.1}
            transparent
            opacity={tubeOpacity}
            onBeforeCompile={onShader}
          />
        </mesh>
      )}
    </>
  );
};
