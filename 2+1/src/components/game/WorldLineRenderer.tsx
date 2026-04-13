import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { buildDisplayMatrix } from "./displayTransform";
import { getThreeColor } from "./threeCache";
import type { WorldLineRendererProps } from "./types";

/** TubeGeometry regeneration interval (in append count).
 * Higher = fewer geometry rebuilds but choppier world lines. */
export const TUBE_REGEN_INTERVAL = 8;

export const WorldLineRenderer = ({
  worldLine: wl,
  color,
  observerPos,
  observerBoost,
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
    const geo = new THREE.TubeGeometry(curve, segments, 0.03, 6, false);
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
  useFrame(() => {
    if (tubeRef.current) {
      tubeRef.current.matrix.copy(displayMatrix);
      tubeRef.current.matrixAutoUpdate = false;
    }
  });

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
            opacity={0.65}
          />
        </mesh>
      )}
    </>
  );
};
