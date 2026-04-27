import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { quatToYaw } from "../../physics";
import {
  HEADING_MARKER_LENGTH,
  HEADING_MARKER_OPACITY,
  LASER_PAST_CONE_MARKER_COLOR,
} from "./constants";
import { getThreeColor } from "./threeCache";
import type { RelativisticPlayer } from "./types";

// 補助線位置付け。前実装の 1px LineSegments (= silver) は背景に紛れて見えない現象が
// 出ていたため tube 化したが、太いと主張が強すぎる。
// 2026-04-27: 0.06 → 0.04 (3 倍長く伸ばした分、細くして存在感を据え置き)。
const HEADING_MARKER_RADIUS = 0.04;
const SQRT_HALF = Math.SQRT1_2;

/**
 * 自機の aim 方向を「過去光円錐の母線」(= heading 方向 + 過去 -t 方向) の
 * null geodesic として描画する。
 *
 * 設計:
 *   - **自機専用** (SceneContent で `isMe && !isDead` ブロック内でのみ呼ばれる)。
 *     observer = player なので observer rest frame での aim 表現は機体現在位置 = origin
 *     から direction 方向に伸ばすだけで完結する → 旧 D pattern (world coord vertex +
 *     displayMatrix の per-vertex Lorentz) は不要。
 *   - **標準 scene graph + cylinder mesh** で実装。Context Lost に強い (= LineSegments +
 *     手動 BufferAttribute は restore 経路が脆弱で「途中で消える」現象が出ていた)。
 *   - 過去光円錐に乗せる根拠: laser は機体から発射されて観測者の過去光円錐上を流れて
 *     いくため、aim 線も同じ null geodesic に貼る方が物理的に整合。
 */
export const HeadingMarkerRenderer = ({
  player,
  cameraYawRef,
}: {
  player: RelativisticPlayer;
  cameraYawRef?: React.RefObject<number>;
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const dirVec = useMemo(() => new THREE.Vector3(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const color = useMemo(
    () => getThreeColor(LASER_PAST_CONE_MARKER_COLOR),
    [],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const yaw = cameraYawRef
      ? cameraYawRef.current
      : quatToYaw(player.phaseSpace.heading);
    if (!Number.isFinite(yaw)) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    // 過去光円錐の母線 (null geodesic): heading 方向に cos(45°)、-z (過去) に sin(45°)。
    const dirX = Math.cos(yaw) * SQRT_HALF;
    const dirY = Math.sin(yaw) * SQRT_HALF;
    const dirZ = -SQRT_HALF;
    dirVec.set(dirX, dirY, dirZ);
    // cylinder default の y 軸を direction 方向に向ける。
    tmpQuat.setFromUnitVectors(yAxis, dirVec);
    mesh.quaternion.copy(tmpQuat);
    // cylinder 中央 = origin + direction * length/2。両端は origin と direction*length。
    const halfLen = HEADING_MARKER_LENGTH / 2;
    mesh.position.set(dirX * halfLen, dirY * halfLen, dirZ * halfLen);
  });

  return (
    // aim 線は UI 指示器 (「この方向を狙ってる」)。何にも occlude されず常時可視であるべき
    // なので depthTest=false + 大きな renderOrder で他 geometry の前に上乗せ描画。
    <mesh ref={meshRef} renderOrder={20}>
      <cylinderGeometry
        args={[
          HEADING_MARKER_RADIUS,
          HEADING_MARKER_RADIUS,
          HEADING_MARKER_LENGTH,
          8,
          1,
        ]}
      />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={HEADING_MARKER_OPACITY}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
};
