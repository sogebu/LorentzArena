import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useTorusHalfWidth } from "../../hooks/useTorusHalfWidth";
import {
  isWrapCrossing,
  pastLightConeIntersectionWorldLine,
  type Vector4,
} from "../../physics";
import {
  PLAYER_WORLDLINE_OPACITY,
  SHIP_WORLDLINE_HIDE_UPPER_SHRINK,
} from "./constants";
import { buildDisplayMatrix } from "./displayTransform";
import { createInnerHideShader } from "./innerHideShader";
import { getThreeColor } from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";
import { createTorusFoldShader } from "./torusFoldShader";
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
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const prevTubeGeosRef = useRef<THREE.TubeGeometry[]>([]);

  const torusHalfWidth = useTorusHalfWidth();
  // version を TUBE_REGEN_INTERVAL で量子化して再生成を間引く
  // wl オブジェクト自体が変わった時（リスポーン）も確実に再生成するため wl を依存に含める
  const geoVersion = Math.floor(wl.version / TUBE_REGEN_INTERVAL);
  // torus mode: TubeGeometry vertex は **raw unwrapped 連続値** のまま、 fold は GPU
  // (vertex shader、 createTorusFoldShader) で per-vertex に行う。 segment 分割は CPU
  // (`buildWorldLineSegments` の `isWrapCrossing` 判定) で、 obs 観測者 cell index でのみ
  // 構造変化するので useMemo は obsCellX/Y で gate (cell 内 obs 動きでは segment 不変、
  // shader が連続的に fold を吸収)。
  const obsCellX =
    torusHalfWidth !== undefined && observerPos
      ? Math.floor((observerPos.x + torusHalfWidth) / (2 * torusHalfWidth))
      : 0;
  const obsCellY =
    torusHalfWidth !== undefined && observerPos
      ? Math.floor((observerPos.y + torusHalfWidth) / (2 * torusHalfWidth))
      : 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: geoVersion throttles rebuild; wl included for respawn identity change; observerPos resolved through obsCellX/Y
  const tubeGeos = useMemo(() => {
    for (const g of prevTubeGeosRef.current) g.dispose();
    prevTubeGeosRef.current = [];
    if (wl.history.length < 2) return [];

    // segment 分割: 観測者から見た cell 跨ぎ点で line break。 各 segment 内では history
    // vertex はすべて同じ image cell (obs 中心) なので、 補間も含めて shader fold で
    // 連続的に primary cell `[obs±L]²` に折られる。 詳細: plans/2026-04-27-pbc-torus.md §「(3)」
    const segments = buildWorldLineSegments(
      wl.history,
      observerPos,
      torusHalfWidth,
    );

    const geos: THREE.TubeGeometry[] = [];
    for (const seg of segments) {
      // raw world coords をそのまま vertex に。 fold は GPU shader で実行。
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
  }, [geoVersion, wl, torusHalfWidth, obsCellX, obsCellY]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      for (const g of prevTubeGeosRef.current) g.dispose();
      prevTubeGeosRef.current = [];
    };
  }, []);

  const displayMatrix = buildDisplayMatrix(observerPos, observerBoost);
  // Inner hide center: 観測者の過去光円錐とこの世界線との交差点 (= 観測者がこの player を
  // 「今見ている」spacetime 点) に追従。これは gnomon マーカーが描かれる位置でもあり、
  // worldLine 最終 vertex (= player の現在位置) ではない (= 観測者からは光速遅延で過去に見える)。
  // useFrame で in-place 更新 → shader uniform が auto sync。
  const hideCenter = useMemo(() => new THREE.Vector3(), []);
  // torus fold shader 用の観測者連続位置 ref。 useFrame で in-place 更新 → uObserverPos
  // uniform が auto sync (= hideCenter と同じパターン)。
  const obsShaderPos = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (let i = 0; i < tubeGeos.length; i++) {
      const mesh = meshRefs.current[i];
      if (mesh) {
        mesh.matrix.copy(displayMatrix);
        mesh.matrixAutoUpdate = false;
      }
    }
    if (observerPos) {
      obsShaderPos.set(observerPos.x, observerPos.y, 0);
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

  // Shader 注入順 = `fold → timeFade → innerHide`。 fold が transformed.xy を観測者中心
  // primary cell `[obs±L]²` に折り、 後段は fold 後の transformed を引き継ぐ。
  //   - timeFade: `modelMatrix * transformed` の z (= dt) のみ使う。 fold は (x,y) のみで
  //     z 不変 → vTimeFade 無影響
  //   - innerHide: `transformed - uInnerHideCenter` の world 距離。 fold 後 vertex が
  //     hide center と同 image cell なら近距離 (hide)、 異なれば遠距離 (描画) → 物理的に
  //     妥当 (過去映像の隣接 image vertex は hide しない)
  const onShader = useMemo(() => {
    const layers: ((s: THREE.WebGLProgramParametersWithUniforms) => void)[] =
      [];
    if (torusHalfWidth !== undefined) {
      layers.push(createTorusFoldShader(torusHalfWidth, obsShaderPos));
    }
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
  }, [innerHideRadius, hideCenter, torusHalfWidth, obsShaderPos]);

  const threeColor = getThreeColor(color);
  return (
    <>
      {tubeGeos.map((geo, i) => (
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: segment 配列は worldLine 時系列順、 順序入替なし
          key={i}
          ref={(el) => {
            meshRefs.current[i] = el;
          }}
          geometry={geo}
        >
          {/* 2026-04-22: PBR (MeshStandardMaterial + roughness/metalness/emissive) →
              unlit (MeshBasicMaterial) に切替。ライティング起因の specular highlight で
              「ツヤツヤ」な実体感が出ていたのを、視点に寄らず均一な translucent flat で
              「半透明の幽霊」的外観に。depthWrite=false で前後関係による自己遮蔽を抑制。 */}
          <meshBasicMaterial
            color={threeColor}
            transparent
            opacity={tubeOpacity}
            depthWrite={false}
            onBeforeCompile={onShader}
          />
        </mesh>
      ))}
    </>
  );
};
