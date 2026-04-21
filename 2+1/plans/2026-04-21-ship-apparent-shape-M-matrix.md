# 2026-04-21: Ship apparent shape rendering pattern (M matrix proposal)

ship 3D model を「**観測者が瞬間に見る apparent shape**」(Penrose-Terrell 一次近似) として描画する
新パターンの設計検討。odakin の発案 (2026-04-21、深掘りせず conversation 中で記録のみ)。

**現状 (2026-04-21 夕)**: LH に部分実装済 ([`apparentShape.ts`](../src/components/game/apparentShape.ts))。
- **塔軸 (M_3)**: 本文書 §TL;DR の `M_3 = u` を採用 (displayMatrix 合成で display 上
  `L(uO)·L(−uA)·(0,0,1)` 方向、= A の 4-velocity を O 静止系で観た向き)。
- **底面 (M_1/M_2)**: 本文書の「tangent plane 内 shear」提案 (`M_i = ê_i − (n·ê_i)/(n·û)·û`) は**不採用**。代わりに並走 plan
  [`2026-04-21-ship-apparent-shape-pattern.md`](2026-04-21-ship-apparent-shape-pattern.md) §現採用 spec の **stylization 版** (display xy plane 水平楕円、k=√2) を採用。過去光円錐接平面 tilt を撤去した視認性優先の非物理的選択。

ship (OtherPlayerRenderer / SelfShipRenderer) への展開 + 本文書 §Open questions (B-1..B-3、
C-2、E-5) の最終決着は未着手。以下は当時の設計検討の記録 (そのまま保存)。

## TL;DR

model coord (a, b, c) — (a, b) が円柱断面、c が軸 — を、観測者表示系で **3×3 線形変換 M** を経由して
display 座標に置く:

- **M_3 (model 軸方向 (0,0,1))** → ship 4-velocity u (or unit û) に揃える → cylinder 軸 = worldline tangent
- **M_1, M_2 (model 半径方向)** → ship worldtube ∩ (観測者 past-cone tangent plane at P) の楕円上
  → 断面 = 観測者がカメラで見るシルエット (apparent shape)

これにより「速度 = 軸の傾き」「Penrose-Terrell apparent shape = 断面の楕円化」が **一つの線形変換**
で同時に可視化される。

## 既存パターンとの位置づけ

| pattern | 用法 | matrix 内容 |
|---|---|---|
| **D** (現行) | 世界線 / 光円錐等 | `buildMeshMatrix` = `Λ(u_obs)⁻¹` (Lorentz boost) を per-vertex |
| **C** (現行) | 自機 hull / 球 halo | display 並進 + camera yaw のみ (γ 楕円化回避) |
| **laser tangent rotation** (現行) | レーザー過去光円錐交差マーカー | `computeConeTangentWorldRotation`、`SceneContent.tsx:57-91`。三角形 1 枚を past-cone 接平面に貼る純粋 rotation |
| **apparent shape M** (本提案、新規) | ship 3D model | 軸を u に倒し、断面を tangent plane に倒す shear 含む 3×3 |

**laser marker は本提案の "axial 部分を持たない (= 平たい三角)" 縮退版**。共通演算は `n` 計算と
「ベクトルの tangent plane への射影」。M は軸方向だけ M_3 = û に差し替えた一般化。

## 物理モチベーション

観測者が瞬間に見る ship の形 = worldtube ∩ (観測者 past cone)。
worldtube は直管 (慣性運動) だが past cone は曲面。**event P 近傍で past cone ≈ tangent plane** と
近似すれば、apparent shape ≈ worldtube ∩ tangent plane、これが一次の Penrose-Terrell。

- ship が観測者から遠い & 小さい → 近似良
- ship が観測者の近く → 曲面性で近似破れる、画角的に大きく見える時に乖離

LorentzArena scale (ARENA_RADIUS ~10、ship radius ~0.5) では十分良い近似のはず。

## 数学的定式化

**Setup**:
- 観測者 (display): O = (0, 0, 0)、`t=0` が "now"
- 表示対象 event: P = (x_P, y_P, t_P) ∈ 観測者の過去光円錐 (t_P < 0、x_P² + y_P² = t_P²)
- ship 4-velocity (display 系): u = (u_x, u_y, u_t)、u_t > 0
- past-cone 法線 at P: **n = ∇F|_P = (x_P, y_P, −t_P)**, F(x,y,t) = x²+y²−t²
- Euclidean normalize: n / |n|
- model coord (a, b, c) ∈ R³

**接平面 ∩ 円柱 = 楕円**:

接平面方程式: `n · (X − P) = 0`。円柱 `X(θ, s) = P + s·û + r·(cosθ·ê1 + sinθ·ê2)` (ê1, ê2 ⊥ û in
display Euclidean) を s について解くと:

```
s(θ) = −r · (cosθ · (n·ê1) + sinθ · (n·ê2)) / (n·û)
```

楕円上の変位 (P 起点):

```
v(θ) = r · [cosθ·ê1 + sinθ·ê2  −  ((cosθ·n·ê1 + sinθ·n·ê2)/(n·û)) · û]
```

`n·û` が分母。亜光速で `n·u = x_P·u_x + y_P·u_y − t_P·u_t ≈ −t_P·γ > 0` なら安全。

**3×3 線形変換 M の列ベクトル**:

```
M_1 = ê1 − (n·ê1)/(n·û) · û       ← 接平面内
M_2 = ê2 − (n·ê2)/(n·û) · û       ← 接平面内
M_3 = û  (or u)                    ← 接平面から飛び出す軸 (= worldline tangent)
```

任意の model 点 (a, b, c) について **`display = P + M·(a, b, c)`**。
THREE.Matrix4 の上 3×3 block に M、translation 列に P を詰めれば mesh.matrix に直入れ可能。

## 既存 `computeConeTangentWorldRotation` との比較

[`SceneContent.tsx:57-91`](../src/components/game/SceneContent.tsx) は laser marker 用に既に類似計算を持つ:

```ts
// laser marker (純粋 rotation、laser direction を tangent plane に射影)
n = (Δx, Δy, −Δt) / |…|        // 過去光円錐の P での法線
u = (laserDir − (laserDir·n)·n).normalized()
v = n × u
M_laser = [u | v | n]   // M_3 = n (cone 法線)
```

これは「平たい三角形を past-cone に貼り付ける」用途。M_3 = n。

ship 提案では `M_3 = û` (worldline tangent) に差し替え + M_1, M_2 に shear 項
`(n·êi)/(n·û) · û` を加算。**コア演算 (n 計算 + tangent plane 射影パターン) は再利用できる**。

新 helper signature 案:

```ts
function computeShipApparentShapeMatrix(
  eventPos: { x: number; y: number; t: number },     // P (worldline ∩ observer past cone)
  obsPos: { x: number; y: number; t: number },       // O (observer event)
  uDisplay: { x: number; y: number; t: number },     // ship 4-velocity in display frame
  forwardDir: { x: number; y: number; t: number },   // ê1 source (model "前" の向き)
): THREE.Matrix4 | null
```

null 条件: `Math.abs(n·û) < 1e-9` (degenerate)、`ρ² < 1e-12` (event = observer 真上)。
fallback は呼び出し側で既存 C pattern。

## 確定すべき設計選択 (Open questions)

### B-1. cross-section の "perpendicular": Lorentzian (η-perp) か Euclidean か

ship worldtube の **正しい** 断面は **η-perp to u** (Minkowski 直交) の半径 R 円 (= rest-frame 円盤を
boost した像)。display 内で見ると Euclidean 楕円。

- η-perp 平面: `{w : −w_t · u_t + w_x · u_x + w_y · u_y = 0}` (signature +,+,−)
- Euclidean-perp 平面: `{w : w_x · u_x + w_y · u_y + w_t · u_t = 0}` (display 内ベクトル直交)

違いは t 成分の符号、v=0 で一致、高速度で乖離。

**推奨**: 視覚化前提 + ship 小 → **Euclidean-perp** で十分。ê1, ê2 を display Gram-Schmidt で取れて
コード単純。後で η-perp に変えるのは matrix 計算内部だけ、interface は不変。

### B-2. 軸方向スケール: M_3 = u (full) か û (unit) か

提案文字面は `M_3 = u` (full 4-velocity)。これだと:

- model 軸長 1 → display 軸長 |u|_disp = γ√(1+v²) > 1
- 高速 ship ほど時間方向に長く描かれる (proper time 1 単位 = u だけの worldline 変位)
- 意味は正しい (worldline 沿いの物差し可視化) が、視覚的に高速 ship が長くなりすぎる

代替: `M_3 = û` (unit、|û|=1)。display 軸長を v に依らず一定。worldline 沿いの "1 秒" の意味は失う。

**推奨**: 自機の現行 `SHIP_LIFT_Z` 等の長さ感を維持したいなら **û (unit)**。worldline 沿いの物差しを
可視化したいなら **u**。LorentzArena は HUD で速度表示してるので軸長で速度を示す必要薄い → **û 推奨**。

### B-3. ê1 (model "前" の決め方)

3 案:

1. **観測者の camera-yaw 方向** を û に Gram-Schmidt 直交化
   - 自機: 自然 (camera 向きに ship 前、現行 yaw 制御整合)
   - 他機: 観測者 camera 向きに他機 ship が向く → camera 追跡する変な見え方
2. **各 ship 固有の "rest-frame forward"** (= velocity 方向 / 最後の thrust 方向 / 武器照準) を boost
   で display に持ってきて û に直交化
   - 自機: 武器照準 (firing 中) or 速度方向
   - 他機: その ship 固有 forward → 各 ship が「自分の進行方向を向く」(物理的に妥当)
3. **ship に "heading" attribute** を持たせて boost
   - 現状 phaseSpace に heading なし、新規 state + network message 追加要

**推奨**: 自機は (1) 現行整合、他機は (2) 速度方向。velocity ゼロ他機は「直前 thrust 方向」 fallback、
それも無ければ camera-relative 固定方向。**自機と他機で公式が違ってよい (観測者特権)**。

## Degeneracy & 特殊ケース

### C-1. 自機 in rest frame (showInRestFrame=true)
- P = O (apex) で tangent plane 退化、n undefined
- M 不可 → **既存 C pattern 維持** (rest-frame display、過去 cone shear なし)
- 連続性検証: 他機が観測者にどんどん近づくと M → 既存 C pattern に滑らかに近づくか? (理論上は
  n·u → 大、shear 項 → 小、になるはずだが要数値確認)

### C-2. 自機 in 世界系 (showInRestFrame=false)
- 観測者世界線 ≠ ship 世界線 → P 取れる、M well-defined
- ただし「自機を自機 past-cone tangent で描く」のは意味やや変 (自機は自分の "now" を描きたい場面が多い)
- **要決定**: 世界系表示で自機も M で描くか、自機だけ raw (worldline tangent でまっすぐ立てる) か

### C-3. n · û → 0
- 観測者から見て ship が極めて高速の radial outgoing で n と u がほぼ tangent plane に揃う
- 亜光速 (|v| < 1) なら理論上 0 にならないが、γ → ∞ で worst case 接近
- LorentzArena `MAX_VELOCITY` の確認要 (要 `constants.ts` 参照)、亜光速制限内なら数値余裕
- safeguard: `Math.abs(nDotU) < 1e-6 → return null` (= その frame 一時的に旧 pattern fallback)

### C-4. 観測者 past cone と ship 世界線が交わらない
- past cone がアリーナ範囲超える時刻の old/young な ship 状態 → P 無し
- 現行 `worldLineIntersections` が null 返すケースと同じ、既に handle されてる

## 内部整合性 (ship sub-parts)

ship は hull だけでなく cannon / nozzle / exhaust / arrow を含む。M を group root に適用すると
**全 sub-part が一律に M で歪む**。

### D-1. Cannon (hull 下に垂直に伸びる)
- model frame で hull 軸 (z) に垂直、−z 方向にぶら下がる
- M で歪むと cannon は (M·(0,0,−1) = −u 方向) に向く → **worldline 過去方向を指す**
- 物理的に正しい: 過去光円錐との交点 = "自機が過去に発射した光" の到来点。cannon が past 方向を
  指すのは「光が出てきた方向」を示す
- 現行 `SHIP_GUN_PITCH_DOWN_RAD` で cannon は forward+down (= 過去光円錐表面を指す既存設計) →
  **M を適用すると pitch_down の意味が自動で「正しい past cone 方向」になる**、現行手動チューニング
  が理論計算に置き換わる可能性 (うれしい副作用)

### D-2. Nozzle hardware (xy 平面の 4 隅、outward)
- model frame で (cosθ, sinθ, 0) outward → M で楕円上に変位
- 高速 ship では nozzle が「斜めに並ぶ」ように見える、これも apparent shape として正しい

### D-3. Exhaust (動的 length, outward)
- useFrame で位置 = `outward × offset` (model frame)
- M を group root に置けば exhaust 位置も自動 M 適用 ✓
- exhaust geometry の "形" (cone shape) も M で歪む → 細い円錐が斜め楕円錐に
- additive blending で発光してるので「形の歪み」目立ちにくい、許容範囲

### D-4. Lighting (meshStandardMaterial の normal)
- Three.js は model matrix の **inverse-transpose** で normal 変換 → 一般 M でも自動で正しく扱う
- ただし「光源が上から差してる」前提のシェーディングは ship 傾くと変わる (cannon 下面が光源側に来る等)
- **問題か?** — 現行も自機 yaw 回転で hull 回転してる、追加で M で傾くだけ、pre-existing tonality
  と大差ない見込み

## 実装方針

### E-1. M を group root に置くか、各 mesh に置くか
- **group root**: 1 matrix で全 sub-part に伝播、簡潔
- 各 mesh: matrix を子で上書きすると親 M をスキップできるが、SelfShipRenderer は階層 group 構造
  なので root 集中が自然

→ **group root に置く**。`ref.current.matrix.copy(M); ref.current.matrixAutoUpdate = false;` で既存
useFrame の `position.set / rotation.set` を置換。

### E-2. observerPos / observerU が変わるたび M を再計算
- useFrame で毎フレーム M 再構築。allocation 避けたい場合は per-mesh cached `THREE.Matrix4` を keep
- 現行 `buildMeshMatrix` パターンと一貫

### E-3. helper の独立性
- 既存 `computeConeTangentWorldRotation` (laser, M_3 = n) と新 `computeShipApparentShapeMatrix`
  (ship, M_3 = û) は **別 helper**
- 共通化できるのは `n` 計算と「ベクトル v を tangent plane に射影 = v − (v·n)·n」のパターン
- 数行内なので無理に共通化せず、コメントで対応関係を相互参照

### E-4. 自機 / 他機の対応
- 自機 in rest frame: M = identity (degenerate、C pattern 維持)
- 自機 in 世界系: 設計判断 C-2 次第
- 他機 (両表示モード): M で描く

→ `computeShipApparentShapeMatrix(...)` が null 返したら呼び出し側で既存 C pattern に fallback、
で統一。

### E-5. 段階導入 (推奨)

1. **PoC**: helper 関数を pure module で実装、Vitest で:
   - rest frame で v=0 → M ≈ identity (連続性)
   - 高速 ship で楕円化が期待通り
   - degenerate ケース null 返す
2. **他機 only に適用**: `OtherPlayerRenderer` を D pattern + M に切替、自機は現行 C pattern のまま
3. **本番観察**: 「他機が斜めに見える」現象を odakin が確認、UX 違和感のヒアリング
4. **必要なら自機 in 世界系も M 化** (C-2 判断)
5. **チュートリアル追記**: 「他機の傾き = 速度、楕円化 = 光速の有限性」

## 教育的 / UX 観点

LorentzArena は「相対論を見せる」ゲーム。提案 M は **2 つの効果を同時に視覚化**:

1. **軸の傾き** = 速度 (worldline 方向に hull が傾く)
2. **断面の楕円化** = apparent shape (past-cone tangent slice)

強力な可視化だが、初見プレイヤーには「ship が変な形」と映る危険。チュートリアル説明負担増。

代替: M_3 = û にすれば軸長は変わらず、傾きと断面歪みだけ → 控えめな効果。
あるいは v < 0.3 では M ≈ identity に近づく自然な smooth degeneracy なので最初は気付かれず、高速で
初めて顕れる progressive 性は ある。

→ **段階的導入を推奨** (E-5)。他機 only から開始。

## Open questions まとめ (再開時にここから)

| # | 設計選択 | 推奨 |
|---|---|---|
| B-1 | cross-section: Euclidean-perp vs η-perp | Euclidean-perp |
| B-2 | M_3 = u vs û | û (unit) |
| B-3 | ê1 source | 自機 = camera yaw、他機 = velocity 方向 + thrust 方向 fallback |
| C-2 | 自機 in 世界系: M で描くか raw か | **未決定** |
| E-5 | 適用範囲: 全機 一気 vs 他機 only から段階 | 段階導入 (他機 only から) |
| 補足 | 他機 u_display: `Λ(u_obs) · u_world` か `u_world` か (世界系/rest frame 対応) | 表示モードに応じて自動切替、明示テスト要 |

これらに答えた上で、helper signature と M 計算式を確定 → PoC (Vitest) → 他機 only PoC、が最短経路。

## 参照

- 現行 laser marker helper: [`SceneContent.tsx:57-91`](../src/components/game/SceneContent.tsx) の
  `computeConeTangentWorldRotation`
- 現行 SelfShipRenderer (置換対象): [`SelfShipRenderer.tsx`](../src/components/game/SelfShipRenderer.tsx)
- D pattern helper: [`DisplayFrameContext.tsx`](../src/components/game/DisplayFrameContext.tsx) の
  `buildMeshMatrix`
- 過去光円錐 anchor (静止 event 用): [`pastConeDisplay.ts`](../src/components/game/pastConeDisplay.ts)
- worldline intersection (動 event 用): SceneContent の `worldLineIntersections`
