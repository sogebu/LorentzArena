/**
 * 「常に最前面に描画する transparent overlay」 pattern。
 *
 * 機体・LH 等の game-world 重要 entity を、 worldline / 光円錐 / debris 等の背景描画
 * より常に前面に出すための render setting trio:
 * - `renderOrder = 10`: default (= 0) より遅い draw order、 worldline / cone より後
 * - `depthTest = false`: depth buffer の値に関わらず常に描画 (= depth-writing element
 *   が前にあっても遮られない)
 * - `depthWrite = false`: 後続描画 (= 同 layer の他 mesh) に depth buffer 干渉を残さない
 *
 * = 「transparent UI overlay として常に最前面、 depth buffer は完全に介在させない」 が
 * 設計意図。 三要素は trio で揃えないと動作不定 (= 例: renderOrder だけ bump して
 * depthTest 抜けると、 直前の depth-writing element に遮られて部分 frame で消える
 * flicker が起こる、 2026-05-04 LH flicker 事例)。
 *
 * 適用先:
 * - SelfShipRenderer (= 自機 hull / 砲塔)
 * - RocketShipRenderer (= shooter 機体形状の hull / cannon)
 * - LighthouseRenderer (= LH 塔本体 / past-cone marker / future marker)
 * - OtherShipRenderer は SelfShipRenderer を delegate するため自動継承
 *
 * Usage:
 *   <mesh {...ALWAYS_ON_TOP_MESH_PROPS} {...其他 mesh props}>
 *     <meshStandardMaterial transparent {...ALWAYS_ON_TOP_MATERIAL_PROPS} opacity={...} />
 *   </mesh>
 *
 * 適用しない例: JellyfishShipRenderer (= 触手 + dome の半透明複合、 別 pattern。 触手は
 * 観測者越しに滲み出す視覚で意図的に depth interaction を残す)、 worldline / 光円錐 /
 * debris (= 背景レイヤー、 default renderOrder=0 で機体より下)。
 */
export const ALWAYS_ON_TOP_RENDER_ORDER = 10;

/** Mesh-level prop spread (= `renderOrder`)。 */
export const ALWAYS_ON_TOP_MESH_PROPS = {
  renderOrder: ALWAYS_ON_TOP_RENDER_ORDER,
} as const;

/** Material-level prop spread (= `depthTest` / `depthWrite`)。 */
export const ALWAYS_ON_TOP_MATERIAL_PROPS = {
  depthTest: false,
  depthWrite: false,
} as const;
