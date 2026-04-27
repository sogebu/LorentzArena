import { useFrame } from "@react-three/fiber";
import { Fragment, useMemo, useRef } from "react";
import * as THREE from "three";
import { useTorusHalfWidth } from "../../hooks/useTorusHalfWidth";
import { observableImageCells, requiredImageCellRadius } from "../../physics";
import {
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_HALF_WIDTH,
  ARENA_MIN_HALF_HEIGHT,
  ARENA_SQUARE_COLOR,
  ARENA_SQUARE_EDGE_OPACITY,
  ARENA_SQUARE_RIM_OPACITY,
  ARENA_SQUARE_SURFACE_OPACITY,
  LIGHT_CONE_HEIGHT,
} from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { getThreeColor } from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";

/**
 * Torus PBC mode 用の正方形アリーナ枠。 中心 `(CX, CY)`、 半幅 `L`、 4 corner で時間方向
 * `[obs.t - H, obs.t + H]` (H = ARENA_MIN_HALF_HEIGHT = LCH) に伸ばす。
 *
 * **PBC universal cover**: 各 corner は **raw world coords** (= fold せず固定)、 4 geometry
 * (surface / edges / topRim / botRim) を `(2R+1)²` image cell ごとに mesh.matrix で
 * `displayMatrix × translate(2L*offset)` で配置。 これで observer がどこにいても arena が
 * 各 image cell に独立描画され、 「観測者が境界中央で 4 corner が片側 flip して縮退する」
 * (= 半開区間 mod 由来の visual artifact) が原理的に発生しない。
 *
 * 描画要素 (× 9 image cells、 R=1):
 *   - 4 縦エッジ (corner ごとに上下方向の line): 「アリーナの柱」
 *   - 上端 rim (4 corner を結ぶ正方形 LineLoop): 観測者の future cone と同階層
 *   - 下端 rim (同 past cone と同階層)
 *   - 4 つの surface quad (4 辺の側面、 透明な「壁」)
 *
 * 詳細: plans/2026-04-27-pbc-torus.md (universal cover refactor)
 */
export const SquareArenaRenderer = () => {
  const { displayMatrix, observerPos } = useDisplayFrame();
  const torusHalfWidth = useTorusHalfWidth();

  const observerPosRef = useRef(observerPos);
  observerPosRef.current = observerPos;

  const color = useMemo(() => getThreeColor(ARENA_SQUARE_COLOR), []);

  // 観測者から見える image cells。 open_cylinder mode は primary 1 個 (= 従来挙動)。
  const cells = useMemo(() => {
    if (torusHalfWidth === undefined) return [{ kx: 0, ky: 0 }];
    const R = requiredImageCellRadius(torusHalfWidth, LIGHT_CONE_HEIGHT);
    return observableImageCells(R);
  }, [torusHalfWidth]);

  // 4 corner の world 位置 (CX±L, CY±L)。 raw 固定 (= fold せず)、 各 image cell の mesh
  // matrix で 2L*offset 並進。 順番: BL → BR → TR → TL (左下→右下→右上→左上)。
  const cornerWorldXY = useMemo<readonly [number, number][]>(
    () => [
      [ARENA_CENTER_X - ARENA_HALF_WIDTH, ARENA_CENTER_Y - ARENA_HALF_WIDTH],
      [ARENA_CENTER_X + ARENA_HALF_WIDTH, ARENA_CENTER_Y - ARENA_HALF_WIDTH],
      [ARENA_CENTER_X + ARENA_HALF_WIDTH, ARENA_CENTER_Y + ARENA_HALF_WIDTH],
      [ARENA_CENTER_X - ARENA_HALF_WIDTH, ARENA_CENTER_Y + ARENA_HALF_WIDTH],
    ],
    [],
  );

  // BufferAttribute: 4 corner × 2 (上 / 下) = 8 vertex。 in-place 更新 (= top z / bot z は
  // obs.t に追従)。 全 image cell で共有 (= geometry 1 個、 mesh は cells.length × 4 個)。
  const geos = useMemo(() => {
    const positions = new Float32Array(4 * 2 * 3);
    const attr = new THREE.BufferAttribute(positions, 3);

    // 4 縦エッジ: corner 毎に (上, 下) のペア (LineSegments)
    const edgeIndices: number[] = [];
    for (let i = 0; i < 4; i++) {
      edgeIndices.push(i * 2 + 0, i * 2 + 1);
    }

    // 上端 / 下端 rim: 4 corner を順に辿る LineLoop
    const topIndices: number[] = [0, 2, 4, 6];
    const botIndices: number[] = [1, 3, 5, 7];

    // 4 surface quad (側面): 各辺で 2 三角形
    const surfaceIndices: number[] = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const topI = i * 2 + 0;
      const botI = i * 2 + 1;
      const topJ = j * 2 + 0;
      const botJ = j * 2 + 1;
      surfaceIndices.push(topI, botI, topJ);
      surfaceIndices.push(botI, botJ, topJ);
    }

    const make = (indices: number[]): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", attr);
      g.setIndex(indices);
      return g;
    };

    return {
      positions,
      attr,
      surface: make(surfaceIndices),
      edges: make(edgeIndices),
      topRim: make(topIndices),
      botRim: make(botIndices),
    };
  }, []);

  // 各 image cell × 4 geometry = `cells.length * 4` mesh。 mesh refs を 2D で管理。
  type MeshRefArray = (
    | THREE.Mesh
    | THREE.LineSegments
    | THREE.LineLoop
    | null
  )[];
  const surfaceRefs = useRef<MeshRefArray>([]);
  const edgeRefs = useRef<MeshRefArray>([]);
  const topRimRefs = useRef<MeshRefArray>([]);
  const botRimRefs = useRef<MeshRefArray>([]);

  // Reusable matrix (allocation free).
  const _meshMatrix = useMemo(() => new THREE.Matrix4(), []);
  const _offsetMatrix = useMemo(() => new THREE.Matrix4(), []);

  useFrame(() => {
    const pos = observerPosRef.current;
    if (!pos) return;

    // Corner positions (raw world coords) を更新。 top z = obs.t + H、 bot z = obs.t - H。
    const { positions, attr } = geos;
    const H = ARENA_MIN_HALF_HEIGHT;
    const topT = pos.t + H;
    const botT = pos.t - H;
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = cornerWorldXY[i];
      const o0 = (i * 2 + 0) * 3;
      const o1 = (i * 2 + 1) * 3;
      positions[o0 + 0] = cx;
      positions[o0 + 1] = cy;
      positions[o0 + 2] = topT;
      positions[o1 + 0] = cx;
      positions[o1 + 1] = cy;
      positions[o1 + 2] = botT;
    }
    attr.needsUpdate = true;

    // 各 image cell の mesh.matrix を `displayMatrix × translate(2L*offset)` で設定。
    const L = torusHalfWidth ?? 0;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      _offsetMatrix.makeTranslation(2 * L * cell.kx, 2 * L * cell.ky, 0);
      _meshMatrix.multiplyMatrices(displayMatrix, _offsetMatrix);
      const refs = [
        surfaceRefs.current[i],
        edgeRefs.current[i],
        topRimRefs.current[i],
        botRimRefs.current[i],
      ];
      for (const m of refs) {
        if (!m) continue;
        m.matrix.copy(_meshMatrix);
        m.matrixAutoUpdate = false;
      }
    }
  });

  return (
    <>
      {cells.map((cell, i) => (
        <Fragment key={`${cell.kx},${cell.ky}`}>
          <mesh
            ref={(el) => {
              surfaceRefs.current[i] = el;
            }}
            geometry={geos.surface}
            frustumCulled={false}
          >
            <meshBasicMaterial
              color={color}
              transparent
              opacity={ARENA_SQUARE_SURFACE_OPACITY}
              side={THREE.DoubleSide}
              depthWrite={false}
              onBeforeCompile={applyTimeFadeShader}
            />
          </mesh>
          <lineSegments
            ref={(el) => {
              edgeRefs.current[i] = el;
            }}
            geometry={geos.edges}
            frustumCulled={false}
          >
            <lineBasicMaterial
              color={color}
              transparent
              opacity={ARENA_SQUARE_EDGE_OPACITY}
              depthWrite={false}
              onBeforeCompile={applyTimeFadeShader}
            />
          </lineSegments>
          <lineLoop
            ref={(el) => {
              topRimRefs.current[i] = el;
            }}
            geometry={geos.topRim}
            frustumCulled={false}
          >
            <lineBasicMaterial
              color={color}
              transparent
              opacity={ARENA_SQUARE_RIM_OPACITY}
              depthWrite={false}
              onBeforeCompile={applyTimeFadeShader}
            />
          </lineLoop>
          <lineLoop
            ref={(el) => {
              botRimRefs.current[i] = el;
            }}
            geometry={geos.botRim}
            frustumCulled={false}
          >
            <lineBasicMaterial
              color={color}
              transparent
              opacity={ARENA_SQUARE_RIM_OPACITY}
              depthWrite={false}
              onBeforeCompile={applyTimeFadeShader}
            />
          </lineLoop>
        </Fragment>
      ))}
    </>
  );
};
