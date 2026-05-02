import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useTorusHalfWidth } from "../../hooks/useTorusHalfWidth";
import {
  isWrapCrossing,
  observableImageCells,
  pastLightConeIntersectionWorldLine,
  requiredImageCellRadius,
  type Vector4,
} from "../../physics";
import {
  LIGHT_CONE_HEIGHT,
  PLAYER_WORLDLINE_OPACITY,
  SHIP_WORLDLINE_HIDE_UPPER_SHRINK,
} from "./constants";
import { buildDisplayMatrix } from "./displayTransform";
import { createInnerHideShader } from "./innerHideShader";
import { getThreeColor } from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";
import type { WorldLineRendererProps } from "./types";

/** TubeGeometry regeneration interval (in append count).
 * Higher = fewer geometry rebuilds but choppier world lines. */
export const TUBE_REGEN_INTERVAL = 8;

/**
 * worldLine.history を「観測者から見て画面を横切らない segment 配列」に分割する。
 *
 * 隣接 vertex で {@link isWrapCrossing} (= raw |Δ|>L 異常検知 OR observer-centered cell
 * 跨ぎ正常検出) が true な箇所で line break。 各 segment は length >= 2 でないと
 * TubeGeometry を作れないので、 1 vertex の孤立 segment は捨てる。
 *
 * `torusHalfWidth === undefined` (= open_cylinder mode) または `observerPos === null`
 * なら history 全体を 1 segment として返す (= 既存挙動)。
 */
export const buildWorldLineSegments = <
  T extends { pos: { x: number; y: number } },
>(
  history: readonly T[],
  observerPos: Vector4 | null,
  torusHalfWidth: number | undefined,
): T[][] => {
  if (history.length < 2) return [];
  if (torusHalfWidth === undefined || !observerPos) {
    return [history.slice()];
  }
  const segments: T[][] = [];
  let current: T[] = [history[0]];
  for (let i = 1; i < history.length; i++) {
    if (
      isWrapCrossing(
        history[i - 1].pos,
        history[i].pos,
        observerPos,
        torusHalfWidth,
      )
    ) {
      if (current.length >= 2) segments.push(current);
      current = [history[i]];
    } else {
      current.push(history[i]);
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments;
};

export const WorldLineRenderer = ({
  worldLine: wl,
  color,
  observerPos,
  observerBoost,
  tubeRadius = 0.06,
  tubeOpacity = PLAYER_WORLDLINE_OPACITY,
  innerHideRadius,
}: WorldLineRendererProps) => {
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const prevTubeGeosRef = useRef<THREE.TubeGeometry[]>([]);

  const torusHalfWidth = useTorusHalfWidth();

  // **PBC universal cover**: 観測者から見える image cell `(2R+1)²` (R=⌈LCH/(2L)⌉) を
  // InstancedMesh で複製描画。 各 instance に `2L * (kx, ky)` の translation matrix を
  // 設定、 vertex は raw world coords のまま (= shader fold 不要)。 mesh.matrix =
  // displayMatrix で観測者 rest frame に boost+並進、 各 image cell が独立 dt で timeFade
  // → 「右で flip」 等の単一 image fold artifact が原理的に発生しない。
  // open_cylinder mode は instance count = 1 (= primary cell のみ) で従来挙動と等価。
  const cells = useMemo(() => {
    if (torusHalfWidth === undefined) return [{ kx: 0, ky: 0 }];
    const R = requiredImageCellRadius(torusHalfWidth, LIGHT_CONE_HEIGHT);
    return observableImageCells(R);
  }, [torusHalfWidth]);
  const instanceCount = cells.length;

  // 共有 instance matrix は useFrame で観測者 cell index を加算して計算 (= observer follow)。
  // cells (relative offset) は torusHalfWidth 変化時のみ再計算、 matrix 自体は per-frame
  // 観測者 cell に追従。
  const _instanceMatrix = useMemo(() => new THREE.Matrix4(), []);

  // **wl 参照は ref 経由で保持** (= 2026-05-02 perf 根本対策):
  // useMemo deps に wl を含めると「wl オブジェクトは appendWorldLine で毎 tick 新参照になる」
  // ため `geoVersion` の `Math.floor(version/8)` 量子化 throttle が事実上死に、 毎 tick で
  // 高コストな TubeGeometry rebuild (= ~24000 vertex 構築 + GPU upload + 旧 geometry dispose)
  // が走っていた。 これが 5 分プレイで setInterval Violation を 16+ 累積 → main thread 飽和
  // → rAF starve → 全世界凍結 + 星屑停止 → 最終的に GPU 資源枯渇で WebGL Context Lost、
  // という連鎖の根本原因だった。 ref で latest wl を保持し useMemo は `geoVersion` の量子化
  // step (= 8 tick = ~130ms) でのみ rebuild する設計に正規化。
  const wlRef = useRef(wl);
  wlRef.current = wl;
  const geoVersion = Math.floor(wl.version / TUBE_REGEN_INTERVAL);
  // 観測者 cell index で gating: segment 構造は obs cell 跨ぎでのみ変わる (= cell 内 obs
  // 動きでは isWrapCrossing 結果不変)。 cell 内 obs 動きは mesh.matrix (= displayMatrix)
  // が連続吸収 (= 各 instance は固定 offset、 fold 動作が不要なので「flip」 artifact なし)。
  const obsCellX =
    torusHalfWidth !== undefined && observerPos
      ? Math.floor((observerPos.x + torusHalfWidth) / (2 * torusHalfWidth))
      : 0;
  const obsCellY =
    torusHalfWidth !== undefined && observerPos
      ? Math.floor((observerPos.y + torusHalfWidth) / (2 * torusHalfWidth))
      : 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: geoVersion throttles rebuild; wl 参照は wlRef 経由で memo 内部から最新値を読む (= deps に wl を含めると毎 tick rebuild で throttle が死ぬ); observerPos resolved through obsCellX/Y
  const tubeGeos = useMemo(() => {
    const wl = wlRef.current; // memo 実行時点の最新 wl
    for (const g of prevTubeGeosRef.current) g.dispose();
    prevTubeGeosRef.current = [];
    if (wl.history.length < 2) return [];

    const segments = buildWorldLineSegments(
      wl.history,
      observerPos,
      torusHalfWidth,
    );

    const geos: THREE.TubeGeometry[] = [];
    for (const seg of segments) {
      // raw world coords をそのまま vertex に。 instance offset で各 image に複製、
      // mesh.matrix で観測者 rest frame に投影。
      const points = seg.map(
        (ps) => new THREE.Vector3(ps.pos.x, ps.pos.y, ps.pos.t),
      );
      const curve = new THREE.CatmullRomCurve3(
        points,
        false,
        "centripetal",
        0.5,
      );
      const tubularSegments = Math.max(1, points.length * 2);
      const geo = new THREE.TubeGeometry(
        curve,
        tubularSegments,
        tubeRadius,
        6,
        false,
      );
      geos.push(geo);
    }
    prevTubeGeosRef.current = geos;
    return geos;
  }, [geoVersion, torusHalfWidth, obsCellX, obsCellY]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      for (const g of prevTubeGeosRef.current) g.dispose();
      prevTubeGeosRef.current = [];
    };
  }, []);

  const displayMatrix = buildDisplayMatrix(observerPos, observerBoost);
  // Inner hide center: 観測者の過去光円錐とこの世界線との交差点 (= 観測者がこの player を
  // 「今見ている」spacetime 点) に追従。 raw world coords。 隣接 image cell の vertex は
  // hide center から world 距離 ~2L で hide されない (= 自機の echo image が描画される)。
  const hideCenter = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    // **observer follow**: 9 cells の world position を observer cell index 中心に毎フレーム
    // 計算。 observer 移動で cell 跨ぎするたびに 9 cells も追従する (= 起動時固定ではなく
    // observer 中心)。
    const L = torusHalfWidth ?? 0;
    const obsCellXNow =
      torusHalfWidth !== undefined && observerPos
        ? Math.floor((observerPos.x + L) / (2 * L))
        : 0;
    const obsCellYNow =
      torusHalfWidth !== undefined && observerPos
        ? Math.floor((observerPos.y + L) / (2 * L))
        : 0;
    for (let i = 0; i < tubeGeos.length; i++) {
      const mesh = meshRefs.current[i];
      if (!mesh) continue;
      mesh.matrix.copy(displayMatrix);
      mesh.matrixAutoUpdate = false;
      for (let j = 0; j < instanceCount; j++) {
        const cell = cells[j];
        _instanceMatrix.makeTranslation(
          2 * L * (obsCellXNow + cell.kx),
          2 * L * (obsCellYNow + cell.ky),
          0,
        );
        mesh.setMatrixAt(j, _instanceMatrix);
      }
      mesh.count = instanceCount;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (innerHideRadius != null && observerPos) {
      const intersection = pastLightConeIntersectionWorldLine(
        wl,
        observerPos,
        torusHalfWidth,
      );
      if (intersection) {
        hideCenter.set(
          intersection.pos.x,
          intersection.pos.y,
          intersection.pos.t,
        );
      }
    }
  });

  // Shader 注入順 = `timeFade → innerHide`。 fold は **不要** (= instance offset で各
  // image cell に複製済み、 vertex は raw + instance translation で正しい world position)。
  //   - timeFade: `modelMatrix * (instanceMatrix * transformed)` の z (= dt) で fade。
  //     各 instance 独立 dt → 隣接 image (= 遠い) は dt 大で薄く描画
  //   - innerHide: `instanceMatrix * transformed` (= world coords + offset) と
  //     uInnerHideCenter (raw world) の距離。 primary instance は近距離 → hide、 隣接
  //     instance は ~2L 離れて hide されない → echo image 描画
  const onShader = useMemo(() => {
    const layers: ((s: THREE.WebGLProgramParametersWithUniforms) => void)[] =
      [];
    layers.push(applyTimeFadeShader);
    if (innerHideRadius != null) {
      layers.push(
        createInnerHideShader(
          innerHideRadius,
          hideCenter,
          SHIP_WORLDLINE_HIDE_UPPER_SHRINK,
        ),
      );
    }
    return (s: THREE.WebGLProgramParametersWithUniforms) => {
      for (const layer of layers) layer(s);
    };
  }, [innerHideRadius, hideCenter]);

  const threeColor = getThreeColor(color);
  return (
    <>
      {tubeGeos.map((geo, i) => (
        <instancedMesh
          // biome-ignore lint/suspicious/noArrayIndexKey: segment 配列は worldLine 時系列順、 順序入替なし
          key={i}
          ref={(el) => {
            meshRefs.current[i] = el;
          }}
          args={[geo, undefined, instanceCount]}
          frustumCulled={false}
        >
          {/* 2026-04-22: PBR → unlit (MeshBasicMaterial)。 視点に寄らず均一な translucent
              flat で「半透明の幽霊」 的外観、 depthWrite=false で前後関係による自己遮蔽を抑制。 */}
          <meshBasicMaterial
            color={threeColor}
            transparent
            opacity={tubeOpacity}
            depthWrite={false}
            onBeforeCompile={onShader}
          />
        </instancedMesh>
      ))}
    </>
  );
};
