import type React from "react";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createVector4,
  observableImageCells,
  requiredImageCellRadius,
  type Vector4,
} from "../../physics";
import {
  DEBRIS_MAX_LAMBDA,
  DEBRIS_WORLDLINE_OPACITY,
  HIT_DEBRIS_MAX_LAMBDA,
  HIT_DEBRIS_WORLDLINE_OPACITY,
  LIGHT_CONE_HEIGHT,
} from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { pastLightConeIntersectionDebris } from "./debris";
import { transformEventForDisplay } from "./displayTransform";
import {
  getDebrisMaterial,
  getHitDebrisMaterial,
  getThreeColor,
  sharedGeometries,
} from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";
import type { DebrisRecord } from "./types";

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

// D pattern: InstancedMesh の matrix に displayMatrix を設定、
// 各 instance の matrix は world frame で cylinder 配置を計算。合成 matrix
// (displayMatrix × worldInstanceMatrix) で頂点単位 Lorentz。
export const DebrisRenderer = ({
  debrisRecords,
  myPlayer,
}: {
  debrisRecords: readonly DebrisRecord[];
  myPlayer: { phaseSpace: { pos: Vector4 }; color: string };
}) => {
  const { displayMatrix, observerPos, observerBoost, torusHalfWidth } =
    useDisplayFrame();
  const explosionMeshRef = useRef<THREE.InstancedMesh>(null);
  const hitMeshRef = useRef<THREE.InstancedMesh>(null);

  // **PBC universal cover**: 各 segment を `(2R+1)²` image cell に複製、 instance count を
  // 9 倍化。 各 instance matrix = compose(mid + 2L*offset, quat, scale) で各 image cell に
  // segment を配置。 mesh.matrix = displayMatrix で観測者 rest frame に投影。 timeFade は
  // 各 image 独立 dt で fade (= 隣接 image は遠方 dt 大で薄く描画 = echo 視覚化)。
  const cells = useMemo(() => {
    if (torusHalfWidth === undefined) return [{ kx: 0, ky: 0 }];
    const R = requiredImageCellRadius(torusHalfWidth, LIGHT_CONE_HEIGHT);
    return observableImageCells(R);
  }, [torusHalfWidth]);
  const L = torusHalfWidth ?? 0;

  // collect all debris segments (world frame) + intersection markers (world frame)
  type DebrisSegment = {
    sx: number;
    sy: number;
    st: number;
    ex: number;
    ey: number;
    et: number;
    r: number;
    g: number;
    b: number;
    radius: number;
  };
  // Phase C1: hit デブリは opacity 半分 (size は 2026-04-18 夜統一で explosion 同値)。
  // 同 InstancedMesh 内で per-instance opacity を出す手段が無いので
  // (MeshBasicMaterial の opacity は全体一様)、type ごとに 2 本の InstancedMesh に分割して
  // それぞれの material opacity で制御。追加 draw call 1 は無視範囲
  // (MAX_DEBRIS=20 × ~15-30 particle)。
  const explosionSegments: DebrisSegment[] = [];
  const hitSegments: DebrisSegment[] = [];
  const markerElements: React.ReactNode[] = [];

  for (let di = 0; di < debrisRecords.length; di++) {
    const debris = debrisRecords[di];
    const isHit = debris.type === "hit";
    const deathEvent = createVector4(
      debris.deathPos.t,
      debris.deathPos.x,
      debris.deathPos.y,
      0,
    );
    const maxLambda = isHit ? HIT_DEBRIS_MAX_LAMBDA : DEBRIS_MAX_LAMBDA;
    const debrisColor = getThreeColor(debris.color);
    const segsTarget = isHit ? hitSegments : explosionSegments;

    for (let pi = 0; pi < debris.particles.length; pi++) {
      const p = debris.particles[pi];

      segsTarget.push({
        sx: debris.deathPos.x,
        sy: debris.deathPos.y,
        st: debris.deathPos.t,
        ex: debris.deathPos.x + p.dx * maxLambda,
        ey: debris.deathPos.y + p.dy * maxLambda,
        et: debris.deathPos.t + maxLambda,
        r: debrisColor.r,
        g: debrisColor.g,
        b: debrisColor.b,
        radius: p.size * 0.2,
      });

      const intersection = pastLightConeIntersectionDebris(
        deathEvent,
        p.dx,
        p.dy,
        maxLambda,
        myPlayer.phaseSpace.pos,
      );
      if (intersection) {
        // marker は球なので Lorentz 変形を避け、display 並進のみ
        const dp = transformEventForDisplay(
          intersection,
          observerPos,
          observerBoost,
          torusHalfWidth,
        );
        markerElements.push(
          <mesh
            key={`debris-${di}-${pi}`}
            position={[dp.x, dp.y, dp.t]}
            scale={[p.size * 1.5, p.size * 1.5, p.size * 1.5]}
            geometry={sharedGeometries.explosionParticle}
            material={
              isHit
                ? getHitDebrisMaterial(debrisColor)
                : getDebrisMaterial(debrisColor)
            }
          />,
        );
      }
    }
  }

  // 各 segment × 各 image cell = `segs.length * cells.length` instances。 vertex は cylinder
  // local、 instance matrix で「mid + 2L*offset、 quat、 scale」 で配置。 mesh.matrix =
  // displayMatrix で observer rest frame に投影。
  const writeInstanced = (
    mesh: THREE.InstancedMesh | null,
    segs: DebrisSegment[],
  ) => {
    if (!mesh) return;
    mesh.matrix.copy(displayMatrix);
    mesh.matrixAutoUpdate = false;
    const totalInstances = segs.length * cells.length;
    const colorAttr = new Float32Array(totalInstances * 3);
    let idx = 0;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      _debrisStart.set(seg.sx, seg.sy, seg.st);
      _debrisEnd.set(seg.ex, seg.ey, seg.et);
      _debrisMid.addVectors(_debrisStart, _debrisEnd).multiplyScalar(0.5);
      _debrisDir.subVectors(_debrisEnd, _debrisStart);
      const len = _debrisDir.length();
      if (len < 0.001) {
        _debrisScale.set(0, 0, 0);
      } else {
        _debrisDir.normalize();
        _debrisQuat.setFromUnitVectors(_debrisUp, _debrisDir);
        _debrisScale.set(seg.radius, len, seg.radius);
      }
      const baseMidX = _debrisMid.x;
      const baseMidY = _debrisMid.y;
      const baseMidZ = _debrisMid.z;
      for (const cell of cells) {
        _debrisMid.set(
          baseMidX + 2 * L * cell.kx,
          baseMidY + 2 * L * cell.ky,
          baseMidZ,
        );
        _debrisMatrix.compose(_debrisMid, _debrisQuat, _debrisScale);
        mesh.setMatrixAt(idx, _debrisMatrix);
        colorAttr[idx * 3] = seg.r;
        colorAttr[idx * 3 + 1] = seg.g;
        colorAttr[idx * 3 + 2] = seg.b;
        idx++;
      }
    }
    mesh.count = totalInstances;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colorAttr, 3);
    mesh.instanceColor.needsUpdate = true;
  };
  writeInstanced(explosionMeshRef.current, explosionSegments);
  writeInstanced(hitMeshRef.current, hitSegments);

  // max possible instances: MAX_DEBRIS * EXPLOSION_PARTICLE_COUNT × cells.length
  // (= 9 image cells max for R=1)。 cap allocation で over-instance 防止。
  const maxInstances = 20 * 30 * cells.length;

  // 時間 fade は per-vertex shader で適用 (USE_INSTANCING 分岐あり)。各 instance の
  // world segment が display frame で自動 fade されるため、死亡時刻から離れた debris
  // は個別に薄くなる (v0 の「全 instance 一括」より自然)。
  return (
    <>
      <instancedMesh
        ref={explosionMeshRef}
        args={[debrisCylinderGeo, undefined, maxInstances]}
        frustumCulled={false}
      >
        <meshBasicMaterial
          transparent
          opacity={DEBRIS_WORLDLINE_OPACITY}
          depthWrite={false}
          onBeforeCompile={applyTimeFadeShader}
        />
      </instancedMesh>
      <instancedMesh
        ref={hitMeshRef}
        args={[debrisCylinderGeo, undefined, maxInstances]}
        frustumCulled={false}
      >
        <meshBasicMaterial
          transparent
          opacity={HIT_DEBRIS_WORLDLINE_OPACITY}
          depthWrite={false}
          onBeforeCompile={applyTimeFadeShader}
        />
      </instancedMesh>
      {markerElements}
    </>
  );
};
