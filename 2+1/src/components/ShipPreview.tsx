import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createVector3, createVector4, type Vector3 } from "../physics";
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
}: ShipPreviewProps = {}) => {
  const defaultThrustRef = useRef<Vector3>(createVector3(0, 0, 0));
  const defaultYawRef = useRef<number>(0);
  const thrustRef = thrustAccelRef ?? defaultThrustRef;
  const yawRef = cameraYawRef ?? defaultYawRef;

  const stubPlayer = useRef({
    id: "preview",
    phaseSpace: {
      pos: createVector4(0, 0, 0, 0),
      u: createVector3(0, 0, 0),
    },
    color: "#ffffff",
  }).current;

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

        <SelfShipRenderer
          player={stubPlayer}
          thrustAccelRef={thrustRef}
          cameraYawRef={yawRef}
          observerPos={stubPlayer.phaseSpace.pos}
          observerBoost={null}
        />

        <Orbit autoRotate={autoRotate} interactive={interactive} target={cameraTarget} />
      </Canvas>
    </div>
  );
};
