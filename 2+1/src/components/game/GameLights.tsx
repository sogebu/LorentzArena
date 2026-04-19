/**
 * ゲーム本体 (SceneContent) と ShipViewer で共有するライティング rig。
 * ここを弄れば両方に即反映 → cannon / hull の陰影チューニングを ShipViewer で
 * 試行錯誤し、そのままゲーム本体でも一致した見た目になる。
 *
 * 座標系: x = +前 / -後、y = +左 / -右、z = +上 (未来) / -下 (過去)。
 *
 * 現在の構成: 一灯のみ。右後下 `(-5, -5, -5)` から intensity 2 の pointLight。
 * **`decay={0}` で距離減衰を無効化** (three.js r155+ の default `decay=2` は
 * physically-correct inverse-square、船が原点で光源が距離 ~8.66 にあると intensity 2
 * でも実効 ~0.027 にしかならず真っ暗になるため)。ambient なし、dramatic side-lit。
 */
export const GameLights = () => (
  <>
    <pointLight position={[-5, -5, -5]} intensity={4} decay={0} />
  </>
);
