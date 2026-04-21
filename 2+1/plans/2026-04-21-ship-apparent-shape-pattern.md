# 2026-04-21: 2+1 次元 物体描画 (apparent shape pattern)

観測者 O が見る、被観測者 A (灯台 / 自機 / 他機) の 3D モデル描画を物理整合に行うための
spec と実装メモ。元ネタ論文: [Nakayama & Oda, "Relativity for games", PTEP 2017 (113J01)](../docs/references/Nakayama-Oda-2017-relativity-for-games-PTEP.pdf)
eq (136)–(137)。

## TL;DR

**物理 spec** (eq 136/137 ベース、v4):
- A の世界線 ∩ O の過去光円錐を anchor `xA`
- model 頂点の xy 部分は **A 中心静止系で O の過去光円錐面上に置く** (各頂点ごとに `XV_t = XO_t − |XV.spatial − XO.spatial|`)
- model 頂点の z 部分 (2+1 では物理的意味は持たない toy 軸) は L(-uA) で線形に世界系へ boost

**実装**: v1 (接平面近似) を [`src/components/game/apparentShape.ts`](../src/components/game/apparentShape.ts) に pure helper として実装、`mesh.matrix` 1 発で済ませる。v4 厳密との誤差は `O(r²/ρ)` (r = 物体半径、ρ = 観測者-anchor 距離) で、LorentzArena 典型値 (r ≲ 0.5, ρ ≳ 2) では **視覚的に無視可能** (< 1% の time 次元シフト)。

**現適用範囲**: 灯台のみ (`LighthouseRenderer`)。ship 適用・回転行列 R / 4-加速度 state 整備は後回し。

---

## 物理 spec (v4)

0. 世界線に **向き (heading)** と **共変加速度ベクトル** を持たせる (灯台では不要、ship で導入)。
1. 観測者 O の世界系での位置を `xO = (xO_x, xO_y, xO_t)`。
2. 世界系で、A (被観測者中心) の世界線と O の過去光円錐との交点を `xA = (xA_x, xA_y, xA_t)`、そこでの 4-velocity 空間成分を `uA = (uA_x, uA_y)`。世界系 x と A 中心静止系 X の関係:

   ```
   X =  L(uA) (x − xA)
   x = xA + L(−uA) X
   ```

3. A 中心静止系での O の位置: `XO = L(uA) (xO − xA)`。
4. A model 系での頂点 V の空間座標を `vertex = (vertex_x, vertex_y)`。
5. V の A 中心静止系空間位置は `XV.spatial = R · vertex` (R は model 内部回転; 灯台では I、ship では heading に応じて)。V の時間座標は eq (136) の精神で:

   ```
   XV_t = XO_t − |XV.spatial − XO.spatial|
   ```

   (= V が発した光が O に到達する時刻を XO_t に揃える条件 = V を O の過去光円錐上に置く)
6. この頂点座標 XV を世界系へ戻す (eq (137) と同等):

   ```
   xV = xA + L(−uA) XV
   ```

### z 方向 (2+1 model の toy 軸) の扱い

LorentzArena の model は THREE.js 慣例で `(x, y, z)` の 3 軸を持つが、2+1 では x, y のみが物理的空間方向で、z はオモチャ。そこで model 頂点 `(x, y, z)` を以下に分解:

```
xi       = (x, y, 0)    物理的空間成分
temporal = (0, 0, z)    時間方向っぽいお気持ち軸
```

- `xi` は上述 spec (step 1–6) に従い `xV(xi)` を算出
- `temporal` は A 静止系の時間っぽい軸なので `L(−uA) · temporal` で世界系へ線形に伸ばす

最終:
```
world_pos = xV(xi) + L(−uA) · temporal
O 静止系 = L(uO) (world_pos − xO)     (= 既存 displayMatrix)
```

静止 A (uA = 0) では `L(−uA) = I` なので temporal は z_world にそのまま載る (灯台が塔として "未来へ向かって" 立つ描画)。

---

## 実装: v1 (接平面近似)

### v1 ≈ v4 equivalence

v4 の `XV_t = XO_t − |XV.spatial − XO.spatial|` を A 中心静止系で XV.spatial = 0 (= anchor) 回りに Taylor 展開し、`xO` と `xA` が世界光円錐条件 (`XO_t = |XO.spatial| = ρ_A`) を満たすことを使うと:

```
v4.XV_t = (XO.spatial · XV.spatial) / ρ_A  −  (x² + y²)/(2ρ_A)  +  O(r³/ρ²)
v1.XV_t = (XO.spatial · XV.spatial) / ρ_A                                          ← 接平面のみ取る
```

誤差は **r² / (2ρ)**。LorentzArena 典型値での評価:

| シナリオ | r | ρ | 誤差 | 塔高 1.62 比 |
|---|---|---|---|---|
| LH 中距離 | 0.3 | 5 | 0.009 | 0.6% |
| LH 遠距離 | 0.3 | 10 | 0.0045 | 0.3% |
| LH 至近 | 0.3 | 2 | 0.022 | 1.4% |
| LH 超至近 | 0.3 | 0.5 | 0.09 | 5.6% |
| ship 典型 | 0.5 | 5-10 | 0.012-0.025 | — |

ρ < 1 (観測者が灯台の足元) 以外、**視覚的にほぼ認識不可**。LorentzArena のアリーナ半径 ~10 で観測者が物体に 1 単位以下に密着するシチュは稀。**v1 で実装、v4 への昇格は (a) 至近描画の厳密性が欲しくなったら、または (b) ship apparent shape の歪みが気になったら、に defer**。

### v1 の具体形 (静止 A = 灯台限定)

静止 A (uA = 0) + 回転 R = I で、model 頂点 `(x, y, z)` を以下で world に写す:

```
world_pos.x = xA.x + x
world_pos.y = xA.y + y
world_pos.t = xA.t + (x · x_∥.x + y · x_∥.y) + z
  where x_∥ = (xO − xA).spatial / |...|    = anchor から観測者に向かう単位ベクトル
```

これは `mesh.matrix` 1 発で表せるので per-vertex 計算不要。ship 拡張時は x_∥ を A 静止系で取り直し (aberration 補正)、z 列に `L(−uA)` を掛ける。

### 実装ファイル

- [`src/components/game/apparentShape.ts`](../src/components/game/apparentShape.ts) — `buildApparentShapeMatrix(anchorPos, observerPos, displayMatrix)` pure helper
- [`src/components/game/apparentShape.test.ts`](../src/components/game/apparentShape.test.ts) — Vitest (接平面 tilt 方向、degenerate fallback、v4 との誤差上限)
- [`src/components/game/LighthouseRenderer.tsx`](../src/components/game/LighthouseRenderer.tsx) — LH 呼出側

### Degenerate ケース

- `observerPos = null` (観測者未設定) → `buildMeshMatrix` (既存 D pattern) に fallback
- `ρ = |observer.spatial − anchor.spatial| → 0` (観測者が anchor の真上 / 真下、x_∥ 未定義) → 同上 fallback

---

## 歴代 spec の履歴 (参考)

spec は odakin ↔ Claude のやり取りで以下の通り進化した。最終採用は **v4 の v1 近似**:

| 版 | 方針 | 採用? |
|---|---|---|
| v1 | 接平面近似 (この文書) | **採用 (実装)** |
| v2 | 混成 spec: x_∥ を boost、x_⊥ は非 boost。partial 非 Lorentz | 不採用 (step 5 の x_⊥ 非 boost が 2+1 一般運動で破綻) |
| v3 | 純 Lorentz (`displayMatrix · T · L(−u_P) · R_q`)。rest frame の断面をそのまま O-rest に boost。過去光円錐 placement なし | 一時採用 → 破棄 (物理 apparent shape としては P-rest 断面より past-cone 厳密のほうが正直) |
| v4 | 過去光円錐厳密 (per-vertex `XV_t = XO_t − |Δspatial|`) | **物理 spec として採用、実装は v1 近似** |

---

## Future work

- **ship 対応**: `buildApparentShapeMatrix` を `uShip` / `uObs` 対応に拡張。x_∥ を A 静止系で取り直し + z 列に `L(−uA)` を掛ける。
- **回転行列 R**: step 0 の heading state を `phaseSpace` に追加 (2+1 では yaw 1 スカラー) → `R_q` を M に合成。
- **共変加速度**: step 0 の加速度ベクトル state を追加。M では未使用、2 次補正 / `AccelerationArrow` の D pattern 整合に備える。
- **v4 厳密化**: per-vertex shader か CPU 計算で `XV_t = XO_t − |Δspatial|` を実装。必要性が出たら (至近描画 or 大サイズ物体)。
