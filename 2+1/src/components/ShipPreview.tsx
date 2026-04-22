import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  createVector3,
  createVector4,
  quatIdentity,
  type Quaternion,
  type Vector3,
  type Vector4,
  yawToQuat,
} from "../physics";
import { GameLights } from "./game/GameLights";
import { SelfShipRenderer } from "./game/SelfShipRenderer";

/**
 * 機体のみを Canvas に描画する共有プレビュー。ShipViewer (#viewer モード、UI つき) と
 * Lobby (待機画面の背景、UI なし) の両方で使う。thrust は常に静止・観測者 boost なし・
 * 機体は `SelfShipRenderer` stub で原点に固定。
 *
 * Pointer events は `pointerEvents: "none"` でオフ (Lobby 上の input / button を塞がない
 * ため)。OrbitControls の autoRotate はカメラ側なのでマウス入力不要で機能する。
 */

interface OrbitProps {
  autoRotate: boolean;
  interactive: boolean;
  target: [number, number, number];
}

/**
 * SelfShipRenderer は player.phaseSpace.heading を読むので、preview では yawRef を
 * heading に per-frame 反映する必要がある。Canvas 内で useFrame を使う必要があるため
 * 小さな helper component として分離。SelfShipRenderer より前に JSX 配置して先に
 * 登録されるようにすれば、同一 frame 内で heading 更新 → ship render の順になる。
 */
interface HeadingUpdaterProps {
  yawRef: React.RefObject<number>;
  stubPlayer: {
    phaseSpace: { pos: Vector4; u: Vector3; heading: Quaternion };
  };
}
const HeadingUpdater = ({ yawRef, stubPlayer }: HeadingUpdaterProps) => {
  useFrame(() => {
    stubPlayer.phaseSpace = {
      ...stubPlayer.phaseSpace,
      heading: yawToQuat(yawRef.current ?? 0),
    };
  });
  return null;
};

const Orbit = ({ autoRotate, interactive, target }: OrbitProps) => {
  const { camera, gl } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(target[0], target[1], target[2]);
    controls.minDistance = 1.5;
    controls.maxDistance = 20;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.2;
    controls.enabled = interactive; // ポインター入力受け付けの可否
    let raf = 0;
    const tick = () => {
      controls.update();
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      controls.dispose();
    };
  }, [camera, gl, autoRotate, interactive, target]);
  return null;
};

export interface ShipPreviewProps {
  /** `true` なら auto-rotate、`false` で停止。default `true`。 */
  autoRotate?: boolean;
  /** grid / axes helper。design iterate 用、default `false`。 */
  showGrid?: boolean;
  /** 背景色。default `"#0a0a0f"` (Lobby 基調と合わせ)。 */
  bgColor?: string;
  /** `true` で OrbitControls のマウス操作を有効化。default `false` (背景用途)。 */
  interactive?: boolean;
  /** カメラ位置。遠くに置くほど船が小さく見える。default `[4, -4, 3]` (ShipViewer iterate)。
   *  Lobby 背景では `[8, -8, 6]` 等にすると装飾感。 */
  cameraPosition?: [number, number, number];
  /** OrbitControls が注視する原点。default `[0, 0, 0]` (船を canvas 中央)。
   *  `[0, 0, -2]` 等に負の z を渡すとカメラが下を見る → 船が canvas 上部にレンダされる。 */
  cameraTarget?: [number, number, number];
  /** 外部から thrust / yaw を駆動する ref (ShipViewer の thrust ボタン等)。省略可、
   *  省略時は静止 + yaw 0 で固定。 */
  thrustAccelRef?: React.MutableRefObject<Vector3>;
  cameraYawRef?: React.MutableRefObject<number>;
  /** 懸架砲デザイン。'gun' (既存、古典大砲) / 'laser' (2026-04-22 新規、エネルギー兵器)。 */
  cannonStyle?: "gun" | "laser";
  /** 上面構造物デザイン。'pod' (案 B、扁平 ellipsoid + stripe) / 'antenna' (案 A、棒 + 球) / 'none'。 */
  dorsalStyle?: "pod" | "antenna" | "none";
  /** Player 識別色 (hsl)。laser cannon の crystal / emitter / lens emissive を焼き込む。
   *  未指定 (undefined) は従来の cyan glow。 */
  playerColor?: string;
  /** spacetime 加速度矢印用の 4-加速度 (world frame)。未指定時は矢印非表示。
   *  preview では u=0 前提なので (0, thrust.x, thrust.y, 0) を渡せば spatial 矢印として表示。 */
  alpha4?: Vector4;
}

export const ShipPreview = ({
  autoRotate = true,
  showGrid = false,
  bgColor = "#0a0a0f",
  interactive = false,
  cameraPosition = [4, -4, 3],
  cameraTarget = [0, 0, 0],
  thrustAccelRef,
  cameraYawRef,
  cannonStyle = "gun",
  dorsalStyle = "pod",
  playerColor,
  alpha4,
}: ShipPreviewProps = {}) => {
  const defaultThrustRef = useRef<Vector3>(createVector3(0, 0, 0));
  const defaultYawRef = useRef<number>(0);
  const thrustRef = thrustAccelRef ?? defaultThrustRef;
  const yawRef = cameraYawRef ?? defaultYawRef;

  // stub player: phaseSpace は mutable (SelfShipRenderer が要求する readonly Quaternion
  // を満たすため phaseSpace を毎 frame 置換)。HeadingUpdater (下、Canvas 内) が yawRef
  // 基準で heading を更新する。
  const stubPlayer = useRef<{
    id: string;
    phaseSpace: { pos: Vector4; u: Vector3; heading: Quaternion };
    color: string;
  }>({
    id: "preview",
    phaseSpace: {
      pos: createVector4(0, 0, 0, 0),
      u: createVector3(0, 0, 0),
      heading: quatIdentity(),
    },
    color: "#ffffff",
  }).current;
  // stubPlayer は singleton ref、再 mount しない限り固定。playerColor 変更は毎 render で適用。
  stubPlayer.color = playerColor ?? "#ffffff";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: bgColor,
        pointerEvents: interactive ? "auto" : "none",
      }}
    >
      <Canvas camera={{ position: cameraPosition, up: [0, 0, 1], fov: 45 }}>
        <GameLights />

        {showGrid && (
          <gridHelper
            args={[10, 20, "#3a3a4a", "#1a1a26"]}
            rotation={[Math.PI / 2, 0, 0]}
          />
        )}
        {showGrid && <axesHelper args={[2.5]} />}

        <HeadingUpdater yawRef={yawRef} stubPlayer={stubPlayer} />

        <SelfShipRenderer
          player={stubPlayer}
          thrustAccelRef={thrustRef}
          observerPos={stubPlayer.phaseSpace.pos}
          observerBoost={null}
          cannonStyle={cannonStyle}
          dorsalStyle={dorsalStyle}
          alpha4={alpha4}
        />

        <Orbit autoRotate={autoRotate} interactive={interactive} target={cameraTarget} />
      </Canvas>
    </div>
  );
};
