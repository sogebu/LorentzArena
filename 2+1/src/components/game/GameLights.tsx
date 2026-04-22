/**
 * ゲーム本体 (SceneContent) と ShipViewer で共有するライティング rig。
 * ここを弄れば両方に即反映 → cannon / hull の陰影チューニングを ShipViewer で
 * 試行錯誤し、そのままゲーム本体でも一致した見た目になる。
 *
 * 座標系: x = +前 / -後、y = +左 / -右、z = +上 (未来) / -下 (過去)。
 *
 * `positions` は **必須**。caller (SceneContent / ShipPreview) が「どの位置に光源を置くか」
 * を一意に決めて渡す:
 *   - SceneContent: 各 LH の past-cone 交差点 (生存 LH のみ)。観測者から死亡観測済み
 *     の LH は除外、全 LH 死亡なら `[]` (= 真の消灯)。
 *   - ShipPreview: 機体デザイン用の固定 stage 光源 (`SHIP_PREVIEW_LIGHT_POSITIONS`)。
 *
 * 暗黙 fallback (旧 `DEFAULT_POSITIONS` の `[-5,-5,-5]`) は撤去。「`undefined` 渡し =
 * 何もしない」と「`undefined` 渡し = stage default 光が出る」の API 二重意味性が
 * 「全 LH 死亡で消灯したいのに DEFAULT 光が出る」事故の原因だった。
 *
 * `decay={0}` で距離減衰を無効化。three.js r155+ の default (`decay=2`) は
 * physically-correct inverse-square で、距離 ~8.66 だと intensity 4 でも実効 ~0.05 に
 * なり真っ暗になるため。将来「遠い灯台ほど弱い」を表現する場合はここに decay > 0 を。
 */

export type LightPosition = readonly [number, number, number];

const LIGHT_INTENSITY = 4;

export interface GameLightsProps {
  positions: readonly LightPosition[];
}

export const GameLights = ({ positions }: GameLightsProps) => (
  <>
    {positions.map((pos, i) => (
      <pointLight
        // biome-ignore lint/suspicious/noArrayIndexKey: 固定順序リスト (灯台 ID 順 or stage 光源)
        key={i}
        position={pos as [number, number, number]}
        intensity={LIGHT_INTENSITY}
        decay={0}
      />
    ))}
  </>
);
