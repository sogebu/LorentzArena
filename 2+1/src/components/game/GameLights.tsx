/**
 * ゲーム本体 (SceneContent) と ShipViewer で共有するライティング rig。
 * ここを弄れば両方に即反映 → cannon / hull の陰影チューニングを ShipViewer で
 * 試行錯誤し、そのままゲーム本体でも一致した見た目になる。
 *
 * 座標系: x = +前 / -後、y = +左 / -右、z = +上 (未来) / -下 (過去)。
 *
 * **光源は灯台**: ゲーム本体では各灯台の過去光円錐交差点 (= 観測者から見える灯台の
 * display 位置) を `positions` に渡して pointLight を置く。複数灯台なら複数灯。ShipViewer
 * / pre-game / 観測者未設定時は `positions` 省略で DEFAULT (`-5, -5, -5`) にフォールバック。
 *
 * `decay={0}` で距離減衰を無効化。three.js r155+ の default (`decay=2`) は
 * physically-correct inverse-square で、距離 ~8.66 だと intensity 4 でも実効 ~0.05 に
 * なり真っ暗になるため。将来「遠い灯台ほど弱い」を表現する場合はここに decay > 0 を。
 */

type LightPosition = readonly [number, number, number];

const DEFAULT_POSITIONS: readonly LightPosition[] = [[-5, -5, -5]];
const LIGHT_INTENSITY = 4;

export interface GameLightsProps {
  positions?: readonly LightPosition[];
}

export const GameLights = ({ positions = DEFAULT_POSITIONS }: GameLightsProps = {}) => (
  <>
    {positions.map((pos, i) => (
      <pointLight
        // biome-ignore lint/suspicious/noArrayIndexKey: 固定順序リスト (灯台 ID 順 or default)
        key={i}
        position={pos as [number, number, number]}
        intensity={LIGHT_INTENSITY}
        decay={0}
      />
    ))}
  </>
);
