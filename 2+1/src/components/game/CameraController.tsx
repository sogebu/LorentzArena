import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";

/**
 * 単一 Canvas 内で camera type を動的切替するための controller。
 *
 * **Why this exists** (= Bug 13 真因治療): 旧実装は `<Canvas orthographic>` /
 * `<Canvas camera={{ fov, position }}>` / `<Canvas key="plc3d">` の 3 系統を React
 * conditional で切替えていた。 user 観察 (5/6 朝、 sogebu Brave on Mac) で「正射影
 * toggle で chronic context loss」 が判明、 isolation 試行 #1〜#4 で trigger は
 * **Canvas 自体の remount** (= toggle で `<Canvas key="...">` が unmount → 新 mount
 * → user GPU で fresh WebGL context 生成が即失敗 → auto-remount → repeat の chronic
 * loop) と確定。 isolation #4 (`4142d17`) で Canvas 1 個に統合したら chronic loss が
 * 完全消失、 真因 confirmed。
 *
 * **設計**:
 * - `<Canvas>` は app lifetime 中 1 個固定 (= remount しない、 user GPU 安定)
 * - 本 controller が `useThree().set({ camera })` で camera instance を動的差し替え
 * - mode 切替 (= 正射影 ↔ 透視 / spacetime ↔ PLC 3D) は camera 再生成のみで Canvas
 *   は無傷
 * - SceneContent useFrame は既存通り `useThree().camera` で current camera を取得
 *   して position/lookAt 更新、 camera type は意識しない
 *
 * **Camera 構成**:
 * | mode | type | params |
 * |---|---|---|
 * | spacetime persp (`useOrthographic=false, plc3d=false`) | PerspectiveCamera | fov 75, near 0.1, far 2000 |
 * | spacetime ortho (`useOrthographic=true, plc3d=false`) | OrthographicCamera | zoom 30, near -500, far 500 |
 * | PLC 3D (`plc3d=true`) | PerspectiveCamera | fov 60, near 0.1, far 1000 |
 *
 * camera position / lookAt / up vector は本 controller では設定せず、 SceneContent
 * useFrame に任せる (= 既存ロジック流用)。 mode 切替時に camera が一瞬 origin に
 * 居るが、 即 useFrame で正しい位置に上書きされる (= 1 frame の visual flicker は
 * 許容、 user verify で問題なければ良し)。
 */
export interface CameraControllerProps {
  useOrthographic: boolean;
  plcSlice: boolean;
  plcMode: "2d" | "3d";
}

export const CameraController = ({
  useOrthographic,
  plcSlice,
  plcMode,
}: CameraControllerProps) => {
  const set = useThree((s) => s.set);
  const size = useThree((s) => s.size);

  useEffect(() => {
    let camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
    if (plcSlice && plcMode === "2d") {
      // PLC 2D: 真上俯瞰 orthographic (= top-down map view)。 同じ flatten 済 ship model
      // を真上から見るので 3D model 上面が clearly 読める。 zoom は spacetime ortho より
      // 控えめ (= 15) で arena 範囲が画面に収まる。 size 由来の left/right/top/bottom は
      // SceneContent useFrame で position/lookAt 設定後に再 sync (= 既存 spacetime ortho
      // と同 pattern)。
      const cam = new THREE.OrthographicCamera(
        -size.width / 2,
        size.width / 2,
        size.height / 2,
        -size.height / 2,
        -500,
        500,
      );
      cam.zoom = 15;
      cam.position.set(0, 0, 50);
      cam.up.set(0, 1, 0); // top-down: world +y が canvas up = screen up
      cam.updateProjectionMatrix();
      camera = cam;
    } else if (plcSlice) {
      // PLC 3D: 斜め俯瞰 perspective (= 既存挙動、 PLC_SLICE_PITCH=π/8 で深度感を残す)。
      const cam = new THREE.PerspectiveCamera(60, size.width / size.height, 0.1, 1000);
      cam.position.set(0, -12, 20);
      cam.up.set(0, 0, 1);
      camera = cam;
    } else if (useOrthographic) {
      // OrthographicCamera は left/right/top/bottom (= camera-space 平面) で初期化。
      // canvas size から full-screen ortho を作り、 zoom=30 でゲーム視覚スケールに揃える。
      const cam = new THREE.OrthographicCamera(
        -size.width / 2,
        size.width / 2,
        size.height / 2,
        -size.height / 2,
        -500,
        500,
      );
      cam.zoom = 30;
      cam.position.set(0, 0, 50);
      cam.up.set(0, 1, 0);
      cam.updateProjectionMatrix();
      camera = cam;
    } else {
      const cam = new THREE.PerspectiveCamera(75, size.width / size.height, 0.1, 2000);
      cam.position.set(0, 0, 0);
      cam.up.set(0, 1, 0);
      camera = cam;
    }
    set({ camera });
  }, [useOrthographic, plcSlice, plcMode, size.width, size.height, set]);

  return null;
};
