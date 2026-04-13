import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  positionAlongStraightWorldLine,
} from "../../physics";
import {
  buildDisplayMatrix,
} from "./displayTransform";
import { getThreeColor } from "./threeCache";
import type { WorldLineRendererProps } from "./types";

/** TubeGeometry regeneration interval (in append count).
 * Higher = fewer geometry rebuilds but choppier world lines. */
export const TUBE_REGEN_INTERVAL = 8;

export const WorldLineRenderer = ({
  worldLine: wl,
  color,
  showHalfLine,
  observerPos,
  observerBoost,
}: WorldLineRendererProps) => {
  const tubeRef = useRef<THREE.Mesh>(null);
  const halfLineRef = useRef<THREE.Mesh>(null);
  const prevTubeGeoRef = useRef<THREE.TubeGeometry | null>(null);
  const prevHalfLineGeoRef = useRef<THREE.TubeGeometry | null>(null);

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
    const geo = new THREE.TubeGeometry(curve, segments, 0.02, 6, false);
    prevTubeGeoRef.current = geo;
    return geo;
  }, [geoVersion, wl]);

  const halfLineGeo = useMemo(() => {
    prevHalfLineGeoRef.current?.dispose();
    if (!showHalfLine || !wl.origin) {
      prevHalfLineGeoRef.current = null;
      return null;
    }
    const o = wl.origin;
    const len = 100;
    const start = positionAlongStraightWorldLine(o, len);
    const end = new THREE.Vector3(o.pos.x, o.pos.y, o.pos.t);
    const startVec = new THREE.Vector3(start.x, start.y, start.t);
    const curve = new THREE.LineCurve3(startVec, end);
    const geo = new THREE.TubeGeometry(curve, 2, 0.02, 6, false);
    prevHalfLineGeoRef.current = geo;
    return geo;
  }, [showHalfLine, wl.origin]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      prevTubeGeoRef.current?.dispose();
      prevHalfLineGeoRef.current?.dispose();
    };
  }, []);

  const displayMatrix = buildDisplayMatrix(observerPos, observerBoost);
  useFrame(() => {
    if (tubeRef.current) {
      tubeRef.current.matrix.copy(displayMatrix);
      tubeRef.current.matrixAutoUpdate = false;
    }
    if (halfLineRef.current) {
      halfLineRef.current.matrix.copy(displayMatrix);
      halfLineRef.current.matrixAutoUpdate = false;
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
          />
        </mesh>
      )}
      {halfLineGeo && (
        <mesh ref={halfLineRef} geometry={halfLineGeo}>
          <meshStandardMaterial
            color={threeColor}
            emissive={threeColor}
            emissiveIntensity={0.2}
            roughness={0.5}
            metalness={0.1}
            transparent
            opacity={0.5}
          />
        </mesh>
      )}
    </>
  );
};
