import type React from "react";
import { useRef } from "react";
import * as THREE from "three";
import {
  createVector4,
  type lorentzBoost,
  type Vector4,
} from "../../physics";
import { pastLightConeIntersectionDebris } from "./debris";
import { transformEventForDisplay } from "./displayTransform";
import {
  getDebrisMaterial,
  getThreeColor,
  sharedGeometries,
} from "./threeCache";
import type { SceneContentProps } from "./types";

// デブリ描画用の共有リソース（太いシリンダーで描画）
const debrisCylinderGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 4, 1);
const _debrisMatrix = new THREE.Matrix4();
const _debrisStart = new THREE.Vector3();
const _debrisEnd = new THREE.Vector3();
const _debrisMid = new THREE.Vector3();
const _debrisDir = new THREE.Vector3();
const _debrisUp = new THREE.Vector3(0, 1, 0);
const _debrisQuat = new THREE.Quaternion();
const _debrisScale = new THREE.Vector3();

// デブリ描画コンポーネント（InstancedMesh で太いシリンダー描画）
export const DebrisRenderer = ({
  debrisRecords,
  myPlayer,
  observerPos,
  observerBoost,
}: {
  debrisRecords: SceneContentProps["debrisRecords"];
  myPlayer: { phaseSpace: { pos: Vector4 }; color: string };
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
}) => {
  const instancedRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  // collect all debris segments + markers
  type DebrisSegment = {
    startX: number; startY: number; startT: number;
    endX: number; endY: number; endT: number;
    r: number; g: number; b: number;
    radius: number;
  };
  const segments: DebrisSegment[] = [];
  const markerElements: React.ReactNode[] = [];

  for (let di = 0; di < debrisRecords.length; di++) {
    const debris = debrisRecords[di];
    const deathEvent = createVector4(
      debris.deathPos.t,
      debris.deathPos.x,
      debris.deathPos.y,
      0,
    );
    const maxLambda = 2.5;
    const debrisColor = getThreeColor(debris.color);

    const startDisplay = transformEventForDisplay(
      deathEvent,
      observerPos,
      observerBoost,
    );

    for (let pi = 0; pi < debris.particles.length; pi++) {
      const p = debris.particles[pi];

      const endWorld = createVector4(
        debris.deathPos.t + maxLambda,
        debris.deathPos.x + p.dx * maxLambda,
        debris.deathPos.y + p.dy * maxLambda,
        0,
      );
      const endDisplay = transformEventForDisplay(
        endWorld,
        observerPos,
        observerBoost,
      );

      segments.push({
        startX: startDisplay.x, startY: startDisplay.y, startT: startDisplay.t,
        endX: endDisplay.x, endY: endDisplay.y, endT: endDisplay.t,
        r: debrisColor.r, g: debrisColor.g, b: debrisColor.b,
        radius: p.size * 0.1,
      });

      const intersection = pastLightConeIntersectionDebris(
        deathEvent,
        p.dx,
        p.dy,
        maxLambda,
        myPlayer.phaseSpace.pos,
      );
      if (intersection) {
        const displayPos = transformEventForDisplay(
          intersection,
          observerPos,
          observerBoost,
        );
        markerElements.push(
          <mesh
            key={`debris-${di}-${pi}`}
            position={[displayPos.x, displayPos.y, displayPos.t]}
            scale={[p.size * 0.75, p.size * 0.75, p.size * 0.75]}
            geometry={sharedGeometries.explosionParticle}
            material={getDebrisMaterial(debrisColor)}
          />,
        );
      }
    }
  }

  // update instanced mesh
  const mesh = instancedRef.current;
  if (mesh) {
    const colorAttr = new Float32Array(segments.length * 3);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      _debrisStart.set(seg.startX, seg.startY, seg.startT);
      _debrisEnd.set(seg.endX, seg.endY, seg.endT);
      _debrisMid.addVectors(_debrisStart, _debrisEnd).multiplyScalar(0.5);
      _debrisDir.subVectors(_debrisEnd, _debrisStart);
      const len = _debrisDir.length();
      if (len < 0.001) {
        _debrisScale.set(0, 0, 0);
        _debrisMatrix.compose(_debrisMid, _debrisQuat, _debrisScale);
      } else {
        _debrisDir.normalize();
        _debrisQuat.setFromUnitVectors(_debrisUp, _debrisDir);
        _debrisScale.set(seg.radius, len, seg.radius);
        _debrisMatrix.compose(_debrisMid, _debrisQuat, _debrisScale);
      }
      mesh.setMatrixAt(i, _debrisMatrix);
      colorAttr[i * 3] = seg.r;
      colorAttr[i * 3 + 1] = seg.g;
      colorAttr[i * 3 + 2] = seg.b;
    }
    mesh.count = segments.length;
    mesh.instanceMatrix.needsUpdate = true;
    // per-instance color
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colorAttr, 3);
    mesh.instanceColor.needsUpdate = true;
  }

  // max possible instances: MAX_DEBRIS * EXPLOSION_PARTICLE_COUNT
  const maxInstances = 20 * 30;

  return (
    <>
      <instancedMesh
        ref={instancedRef}
        args={[debrisCylinderGeo, undefined, maxInstances]}
        frustumCulled={false}
      >
        <meshBasicMaterial
          ref={materialRef}
          transparent
          opacity={0.10}
          depthWrite={false}
        />
      </instancedMesh>
      {markerElements}
    </>
  );
};
