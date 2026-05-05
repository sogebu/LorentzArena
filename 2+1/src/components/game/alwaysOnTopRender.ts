/**
 * 「常に最前面に描画する transparent overlay」 pattern (= 2 layer 構造)。
 *
 * 機体 exhaust / LH 等の game-world 重要 entity を、 worldline / 光円錐 / debris 等の
 * 背景描画より常に前面に出すための render setting trio:
 * - `renderOrder` >= 10: default (= 0) より遅い draw order、 worldline / cone より後
 * - `depthTest = false`: depth buffer の値に関わらず常に描画 (= depth-writing element
 *   が前にあっても遮られない)
 * - `depthWrite = false`: 後続描画 (= 同 layer の他 mesh) に depth buffer 干渉を残さない
 *
 * = 「transparent UI overlay として常に最前面、 depth buffer は完全に介在させない」 が
 * 設計意図。 三要素は trio で揃えないと動作不定 (= 例: renderOrder だけ bump して
 * depthTest 抜けると、 直前の depth-writing element に遮られて部分 frame で消える
 * flicker が起こる、 2026-05-04 LH flicker 事例)。
 *
 * ## 2 layer (BG / FG) 構造の動機
 *
 * 旧設計 (~ 2026-05-04) は 1 layer (renderOrder=10) のみで、 self ship exhaust と LH 全
 * mesh が同 renderOrder + depthTest=false で重なる場面 (= 自機が LH に近接 + 推進中) で:
 * - 両 entity が同 layer の transparent group に入る
 * - sort tiebreaker (= back-to-front + material id 等) が float 精度で frame 間揺らぐ
 * - どちらが後に描画されるかが flip → 後描画側が visible 勝ち → **「順序を取り合って
 *   いる」 flicker** (= 2026-05-05 odakin 観察)
 *
 * 修正: 2 layer 構造で renderOrder を分離し、 layer 間の描画順を決定論的に固定する。
 * 同 layer 内 entity の overlap は依然 sort 任せだが、 通常 visible noise を生まない
 * (= LH の internal mesh 間は spatial に決定論的、 self exhaust 4 nozzle は同色同
 * material で flicker 視認不可)。
 *
 * ### Layer 定義
 * - **BG (renderOrder=10)**: 世界に固定された structure (= LH 塔本体 + past/future markers)
 * - **FG (renderOrder=11)**: player avatar feedback (= self / rocket ship の exhaust nozzle)
 *
 * FG が BG より上 = 自機の exhaust が LH に重なった時に exhaust が visible 維持。
 * (game-design rationale: avatar の視認性 > world structure の視認性、 exhaust は小さい
 * ので LH を大きく覆わない)。
 *
 * ## 適用先 (= 実コードと一致、 doc drift fix 済 2026-05-05)
 *
 * - **BG layer**: LighthouseRenderer (= LH 塔本体 / past-cone marker / future marker、 12 mesh)
 * - **FG layer**:
 *   - SelfShipRenderer (= 4 RCS nozzle exhaust 2 cone)
 *   - RocketShipRenderer (= rear exhaust 2 cone)
 *   - OtherShipRenderer は SelfShipRenderer を delegate するため自動継承
 *
 * **Self ship hull / 砲塔 / 装甲 は trio を持たない** (= 通常 opaque depth 描画、
 * renderOrder=0)。 旧 doc 「自機 hull / 砲塔」 と書いていたのは drift で、 実装は
 * historic 含めて exhaust nozzle のみ。 self hull は LH (transparent renderOrder=10) に
 * 必ず覆われる挙動だが flicker は不発 (= LH は決定論的に always-on-top、 同位置の self
 * hull は安定的に LH の下に隠れる)。
 *
 * ## Usage
 *
 * ```tsx
 * // World structure (= LH):
 * <mesh {...ALWAYS_ON_TOP_BG_MESH_PROPS} {...其他 mesh props}>
 *   <meshStandardMaterial transparent {...ALWAYS_ON_TOP_MATERIAL_PROPS} opacity={...} />
 * </mesh>
 *
 * // Player avatar (= self / rocket exhaust):
 * <mesh {...ALWAYS_ON_TOP_FG_MESH_PROPS} {...其他 mesh props}>
 *   <meshBasicMaterial transparent {...ALWAYS_ON_TOP_MATERIAL_PROPS} opacity={...} />
 * </mesh>
 * ```
 *
 * ## 適用しない例
 *
 * JellyfishShipRenderer (= 触手 + dome の半透明複合、 別 pattern。 触手は観測者越しに
 * 滲み出す視覚で意図的に depth interaction を残す)、 worldline / 光円錐 / debris (=
 * 背景レイヤー、 default renderOrder=0 で機体より下)。
 *
 * ## 拡張時の判断
 *
 * 新しい always-on-top entity を足す時、 「世界 structure / avatar / その他」 のどの
 * semantic に該当するかで BG / FG layer を選ぶ。 同 layer 内の overlap が問題になれば
 * layer 追加 (= renderOrder=12 等) を検討、 その場合は本 docstring に layer 定義 +
 * 動機を追記。
 */
export const ALWAYS_ON_TOP_RENDER_ORDER_BG = 10;
export const ALWAYS_ON_TOP_RENDER_ORDER_FG = 11;

/** Mesh-level prop spread for BG layer (= 世界 structure、 LH)。 */
export const ALWAYS_ON_TOP_BG_MESH_PROPS = {
  renderOrder: ALWAYS_ON_TOP_RENDER_ORDER_BG,
} as const;

/** Mesh-level prop spread for FG layer (= player avatar feedback、 self / rocket exhaust)。 */
export const ALWAYS_ON_TOP_FG_MESH_PROPS = {
  renderOrder: ALWAYS_ON_TOP_RENDER_ORDER_FG,
} as const;

/**
 * Material-level prop spread (= `depthTest` / `depthWrite`、 BG / FG 両 layer で共有)。
 * Layer 分離は renderOrder のみで実現、 material 側は両者同一。
 */
export const ALWAYS_ON_TOP_MATERIAL_PROPS = {
  depthTest: false,
  depthWrite: false,
} as const;
