# 2026-04-21: 2+1 次元 物体描画 (apparent shape pattern)

観測者 O が見る、被観測者 A (灯台 / 自機 / 他機) の 3D モデル描画 spec と実装メモ。
元ネタ論文: [Nakayama & Oda, "Relativity for games", PTEP 2017 (113J01)](../docs/references/Nakayama-Oda-2017-relativity-for-games-PTEP.pdf)
eq (136)–(137)。

並走する設計書として [`2026-04-21-ship-apparent-shape-M-matrix.md`](2026-04-21-ship-apparent-shape-M-matrix.md)
(ship 用 M matrix 提案、M_3 = u + tangent plane 投影 M_1/M_2) がある。現実装の塔軸
(M_3 系) はそちら準拠、底面 (M_1/M_2 系) は本文書 §現採用 spec の stylization を採用。

## TL;DR

**現実装** ([apparentShape.ts](../src/components/game/apparentShape.ts)、LH 適用済、ship 対応 generic):

- **底面 (m.z=0)**: display xy plane 上の flat 楕円 (x_∥^O 軸 `r√2`、x_⊥^O 軸 `r`)
- **塔軸 (m.z>0)**: display frame で `L(uO) · L(−uA) · (0, 0, 1)` (= A の 4-velocity を O 静止系で観た向き)
- **signature**: `buildApparentShapeMatrix(anchorPos, anchorU, observerPos, displayMatrix)` —
  LH は `phaseSpace.u` (= 0) を渡す、ship は非零 u でそのまま動く

**設計の位置づけ**: 底面は物理厳密 (v4 Nakayama-Oda) / その接平面近似 (v1) を**捨てて
stylization に振った** — O 静止系での視認性 (水平楕円) を優先、過去光円錐接平面の tilt を
撤去。塔軸は eq (137) の `L(−uA)` を踏襲。詳細 §現採用 spec (stylization)、物理 ideal の
参照点は §v4 物理 spec。歴代変遷は §歴代 spec 履歴。

---

## 現採用 spec (stylization)

### 底面 (m.z = 0)

display xy plane (= O の simultaneity slice) 上の 2×2 線形変換 `S` で楕円化:

```
S = I + (√2 − 1) · x_∥^O ⊗ x_∥^O^T

x_∥^O = (observerDisp.xy − anchorDisp.xy) / |…|
      = display spatial 上で anchor → observer の単位ベクトル
```

model (m.x, m.y, 0) → display 変位 `(S · m.xy, 0)` (時間成分は常に 0)。world 系への
back-solve:

```
M[:, 0]_world = displayMatrix^{-1} · (S.col0_display, 0, 0)_direction
M[:, 1]_world = displayMatrix^{-1} · (S.col1_display, 0, 0)_direction
```

translation は direction vector (w=0) に効かないので inverse 1 発で OK。

**k = √2 の物理的導出**: O 静止系で anchor 起点の過去光円錐頂点方向ベクトル
`(x_∥^O, 1)` の Euclidean 長 √2 を display xy plane に 45° 回転で寝かせ、長さ保存する
と x_∥^O 方向の成分が √2·r、x_⊥^O 方向は回転軸で不変のまま r。

### 塔軸 (m.z = 1 方向)

world 系での M 列:

```
M[:, 2]_world = L(−uA) · (0, 0, 1) = (uA.x, uA.y, γ(uA))  (in three.js (x, y, z=t))
```

displayMatrix = L(uO) と合成後、display での最終 z 列:

```
L(uO) · L(−uA) · (0, 0, 1)   (= A の 4-velocity を O 静止系で観た向き、M matrix doc §TL;DR の M_3 = u 項)
```

- LH (uA = 0): display で `L(uO) · (0, 0, 1)` — 観測者が動けば塔は観測者の motion 方向に傾く
- ship (uA ≠ 0): A の worldline tangent を O 静止系に boost した方向

### 合成 (呼出側から見える最終 matrix)

```
result = displayMatrix · tAnchor(world) · M
```

- `M`: 上記 3 列の 3×3 + identity w 行
- `tAnchor`: anchor world 位置への translation
- `displayMatrix`: `buildDisplayMatrix(observerPos, observerBoost)` (world → display)

### Degenerate

- `observerPos = null` → `buildMeshMatrix` (D pattern) に fallback
- display spatial で anchor と観測者の xy 一致 (x_∥^O 不定) → 同上 fallback

### 実装ファイル

- [`src/components/game/apparentShape.ts`](../src/components/game/apparentShape.ts) — helper 本体
- [`src/components/game/apparentShape.test.ts`](../src/components/game/apparentShape.test.ts) — Vitest (底面楕円方向、degenerate fallback、移動 A/O の塔軸)
- [`src/components/game/LighthouseRenderer.tsx`](../src/components/game/LighthouseRenderer.tsx) — LH 呼出側

---

## v4 物理 spec (参照、Nakayama-Oda eq 136/137)

物理整合の ideal。現実装 (stylization) は底面をここから逸脱しているが、将来 per-vertex
shader 実装で昇格する際の参照点。

0. 世界線に向き (heading) と共変加速度ベクトルを持たせる (灯台では不要、ship で導入)。
1. 観測者 O の世界系位置 `xO = (xO_x, xO_y, xO_t)`。
2. A (被観測者中心) の世界線 ∩ O の過去光円錐を anchor `xA = (xA_x, xA_y, xA_t)`、
   そこでの 4-velocity 空間成分 `uA = (uA_x, uA_y)`。世界系 x と A 中心静止系 X:

   ```
   X = L(uA) (x − xA)
   x = xA + L(−uA) X
   ```

3. A 中心静止系での O の位置: `XO = L(uA) (xO − xA)`。
4. A model 系で頂点 V の空間座標 `vertex = (vertex_x, vertex_y)`。
5. V の A 静止系空間位置 `XV.spatial = R · vertex` (R は model 内部回転; 灯台では I)。
   V の時間座標は eq (136):

   ```
   XV_t = XO_t − |XV.spatial − XO.spatial|
   ```

   (= V が発した光が O に到達する時刻を XO_t に揃える = V を O の過去光円錐上に置く)
6. 世界系へ戻す (eq 137):

   ```
   xV = xA + L(−uA) XV
   ```

### z 方向 (2+1 model の toy 軸)

LorentzArena の model は THREE.js 慣例で `(x, y, z)` の 3 軸を持つが、2+1 では x, y
のみが物理空間方向で、z はオモチャ。v4 原案では model 頂点 `(x, y, z)` を分解:

```
xi       = (x, y, 0)    物理的空間成分 (step 1–6 に従う)
temporal = (0, 0, z)    A 静止系の時間っぽい軸
```

最終世界位置 = `xV(xi) + L(−uA) · temporal`。静止 A (uA = 0) では `L(−uA) = I` なので
temporal は z_world にそのまま載る。

この z 処理 (`L(−uA) · (0, 0, 1)`) は**現実装の塔軸列と一致**、v4 → stylization の差分は
底面 (xi の処理) のみに現れる。

### v1 接平面近似 (v4 の Taylor 展開、参考)

v4 を `XV.spatial = 0` (anchor) 回りで Taylor 展開し線形項のみ:

```
v4.XV_t = (XO.spatial · XV.spatial) / ρ_A  −  (x² + y²)/(2ρ_A)  +  O(r³/ρ²)
v1.XV_t = (XO.spatial · XV.spatial) / ρ_A    ← 接平面のみ
```

誤差 `r² / (2ρ)` は LorentzArena 典型値で視覚的に無視可能:

| シナリオ | r | ρ | 誤差 | 塔高 1.62 比 |
|---|---|---|---|---|
| LH 中距離 | 0.3 | 5 | 0.009 | 0.6% |
| LH 遠距離 | 0.3 | 10 | 0.0045 | 0.3% |
| LH 至近 | 0.3 | 2 | 0.022 | 1.4% |
| LH 超至近 | 0.3 | 0.5 | 0.09 | 5.6% |
| ship 典型 | 0.5 | 5–10 | 0.012–0.025 | — |

v1 は mesh.matrix 1 発で表現可能。2026-04-21 夕方までは v1 実装、以降 stylization に
置換された (§歴代 spec 履歴)。

---

## 歴代 spec 履歴

| 版 | 方針 | 状態 |
|---|---|---|
| v1 | v4 の Taylor 線形近似 (底面は過去光円錐接平面の tilt) | 2026-04-21 夕方までは実装、以降 stylization に置換 |
| v2 | 混成 spec: x_∥ を boost、x_⊥ は非 boost (partial 非 Lorentz) | 不採用 (x_⊥ 非 boost が 2+1 一般運動で破綻) |
| v3 | 純 Lorentz (`displayMatrix · T · L(−u_P) · R_q`)、P-rest 断面を O-rest へ boost、過去光円錐 placement 無し | 一時採用 → 破棄 (物理 apparent shape としては past-cone 厳密の方が正直) |
| v4 | 過去光円錐厳密 (per-vertex `XV_t = XO_t − |Δspatial|`) | **物理 spec 参照** (per-vertex 実装は defer) |
| **stylization (現)** | 底面 O-rest 水平楕円 (k=√2) + 塔軸 `L(uO)·L(−uA)·(0,0,1)` | **実装採用** |

---

## Future work

- **ship renderer に展開**: `OtherPlayerRenderer` / `SelfShipRenderer` を D pattern →
  `buildApparentShapeMatrix` 呼出に切替。signature は ship 対応済。段階導入は M-matrix
  doc §E-5 (他機 only から) 参考。
- **回転行列 R**: step 0 の heading state を `phaseSpace` に追加 (2+1 では yaw 1 スカラー)
  → 底面 stretch の前段に `R_q` を合成。
- **共変加速度**: step 0 の加速度ベクトル state 追加。現 M には未使用、2 次補正 /
  `AccelerationArrow` の D pattern 整合に備える。
- **v4 per-vertex 厳密化**: shader or CPU で `XV_t = XO_t − |Δspatial|` を実装。
  現 stylization で十分見えていれば不要、至近描画や大サイズ物体で歪みが気になったら。
- **stylization の妥当性確認**: 物理 ideal (v4) との視覚差を本番で観察、必要なら k を
  調整 (ρ 依存化も選択肢)。
