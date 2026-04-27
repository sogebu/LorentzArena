import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { minImageDelta1D } from "../../physics";
import {
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_HALF_WIDTH,
  ARENA_MIN_HALF_HEIGHT,
  ARENA_SQUARE_COLOR,
  ARENA_SQUARE_EDGE_OPACITY,
  ARENA_SQUARE_RIM_OPACITY,
  ARENA_SQUARE_SURFACE_OPACITY,
} from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { getThreeColor } from "./threeCache";
import { applyTimeFadeShader } from "./timeFadeShader";

/**
 * Torus PBC mode 用の正方形アリーナ枠。 中心 `(CX, CY)`、 半幅 `L`、 4 corner で時間方向
 * `[obs.t - H, obs.t + H]` (H = ARENA_MIN_HALF_HEIGHT = LCH) に伸ばす。
 *
 * 各 corner は world coords (`[CX±L, CY±L]`) を **観測者中心 primary cell に最短画像で
 * 折り畳んだ値** として書き込む。 これで observer がどこにいても arena 枠が画面 (primary
 * cell) 内に映る。 observer が境界を跨いで隣接 cell に入ると arena image が「画面の反対端
 * から再出現」する Asteroids 挙動になる。
 *
 * 描画要素:
 *   - 4 縦エッジ (corner ごとに上下方向の line): 「アリーナの柱」
 *   - 上端 rim (4 corner を結ぶ正方形 LineLoop): 観測者の future cone と同階層
 *   - 下端 rim (同 past cone と同階層)
 *   - 4 つの surface quad (4 辺の側面、 透明な「壁」): 当面は無し (簡略化)
 *
 * 過去/未来光円錐 ∩ 正方形 の交線は当面描画しない (= 円柱版の `ARENA_PAST_CONE_OPACITY`
 * 相当を実装するなら 4 平面 × 円錐の交線計算が必要、 後続検討)。
 *
 * 詳細: plans/2026-04-27-pbc-torus.md
 */
export const SquareArenaRenderer = () => {
  const { displayMatrix, observerPos } = useDisplayFrame();

  const observerPosRef = useRef(observerPos);
  observerPosRef.current = observerPos;

  const color = useMemo(() => getThreeColor(ARENA_SQUARE_COLOR), []);

  // 4 corner の world 位置 (CX±L, CY±L)。 順番: BL → BR → TR → TL (左下→右下→右上→左上)。
  const cornerWorldXY = useMemo<readonly [number, number][]>(
    () => [
      [ARENA_CENTER_X - ARENA_HALF_WIDTH, ARENA_CENTER_Y - ARENA_HALF_WIDTH],
      [ARENA_CENTER_X + ARENA_HALF_WIDTH, ARENA_CENTER_Y - ARENA_HALF_WIDTH],
      [ARENA_CENTER_X + ARENA_HALF_WIDTH, ARENA_CENTER_Y + ARENA_HALF_WIDTH],
      [ARENA_CENTER_X - ARENA_HALF_WIDTH, ARENA_CENTER_Y + ARENA_HALF_WIDTH],
    ],
    [],
  );

  // BufferAttribute: 4 corner × 2 (上 / 下) = 8 vertex。 in-place 更新。
  const geos = useMemo(() => {
    const positions = new Float32Array(4 * 2 * 3);
    const attr = new THREE.BufferAttribute(positions, 3);

    // 4 縦エッジ: corner 毎に (上, 下) のペア (LineSegments で線)。
    const edgeIndices: number[] = [];
    for (let i = 0; i < 4; i++) {
      edgeIndices.push(i * 2 + 0, i * 2 + 1);
    }

    // 上端 rim: 上 vertex を 4 corner 順に辿る LineLoop (= 0, 2, 4, 6)。
    const topIndices: number[] = [0, 2, 4, 6];
    const botIndices: number[] = [1, 3, 5, 7];

    // 4 surface quad (側面): 各辺で 2 三角形 (BL→BR の辺、 BR→TR の辺、 ...)。 一旦省略。
    // surface index 配列: pair (i, j) = (0,1)→(2,3) 等で 4 辺、 各辺 2 三角形 = 8 三角形。
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

  useFrame(() => {
    const pos = observerPosRef.current;
    if (!pos) return;
    const { positions, attr } = geos;
    const H = ARENA_MIN_HALF_HEIGHT;
    const topT = pos.t + H;
    const botT = pos.t - H;
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = cornerWorldXY[i];
      // 観測者中心 primary cell に最短画像で折り畳み (= Asteroids 風 image cell 描画)
      const wx = pos.x + minImageDelta1D(cx - pos.x, ARENA_HALF_WIDTH);
      const wy = pos.y + minImageDelta1D(cy - pos.y, ARENA_HALF_WIDTH);
      const o0 = (i * 2 + 0) * 3;
      const o1 = (i * 2 + 1) * 3;
      positions[o0 + 0] = wx;
      positions[o0 + 1] = wy;
      positions[o0 + 2] = topT;
      positions[o1 + 0] = wx;
      positions[o1 + 1] = wy;
      positions[o1 + 2] = botT;
    }
    attr.needsUpdate = true;
  });

  return (
    <>
      <mesh
        geometry={geos.surface}
        matrix={displayMatrix}
        matrixAutoUpdate={false}
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
        geometry={geos.edges}
        matrix={displayMatrix}
        matrixAutoUpdate={false}
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
        geometry={geos.topRim}
        matrix={displayMatrix}
        matrixAutoUpdate={false}
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
        geometry={geos.botRim}
        matrix={displayMatrix}
        matrixAutoUpdate={false}
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
    </>
  );
};
