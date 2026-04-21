# 2026-04-22: Laser cannon design (gun と parallel)

## 背景

2026-04-22 の session で、gun (古典大砲、SHIP_GUN_*) とは別のエネルギー兵器 (レーザー砲、SHIP_LASER_*) を parallel に design する決定。gun は「これはこれで銃として固定」保存、レーザー砲は別名で 0 から作成。

**制約**:
1. 砲は **45° 下前方** 固定 (SHIP_GUN_PITCH_DOWN_RAD = π/4、gun と共用)。
2. **座標原点 (world origin = 観測者過去光円錐頂点) が砲軸上** — 砲から発射される laser beam と origin が整合。SHIP_LIFT_Z の調整で担保。
3. それ以外は形・色自由。

## cannonStyle prop architecture

ゲーム本体は既存挙動保持のため `cannonStyle` prop を `SelfShipRenderer` に追加:

```tsx
<SelfShipRenderer cannonStyle={'gun' | 'laser'} ... />  // default 'gun'
```

- 'gun': 既存 JSX (bracket + cannon group + barrel/tip/breech/ring/muzzle) そのまま。
- 'laser': `<LaserCannonRenderer />` 単独 render。

`ShipPreview` → `ShipViewer` に prop 通し、`ShipViewer` 側で `<select>` UI による live 切替 (default は iterate 用に 'laser')。

ゲーム本体 (`SceneContent`) は prop 未指定 → default 'gun' で既存挙動。将来 laser に移行する場合は `SceneContent` の `SelfShipRenderer` 呼出しで prop 追加 + gameplay バランス調整が必要。

## 設計 iterate history

### v0 (2026-04-22 朝): Simple cyan cannon

初版。sci-fi のキーワードを並べた single-pass design。

- Rear energy core: emissive sphere (R=0.065, 一部突出 0.04)
- Main casing: slender cylinder (R=0.04, L=2.0)
- Cooling rings × 2: torus (outer 0.06, tube 0.012) on casing
- Focus cone: tapered (base 0.06 → tip 0.04, L=0.2)
- Emitter disc: flat cyan plate (R=0.035, thickness 0.018) + halo
- Bracket: gun と共用 (tapered cone 0.05→0.02, H=0.55)

**評価**: ありかもしれないが もっと「laser 砲」にしたい → 他所様参考にせよ、と odakin 指示。

### v1 (2026-04-22 昼): sci-fi references refine

**参考文献** (web search 調査、詳細は SESSION.md 2026-04-22 エントリ):
- **Spartan Laser** (Halo): 保護シュラウド、smart-linked 光学、bulky profile、赤ビーム
- **Turbolaser** (Star Wars): 長 barrel (10m)、turret mount、**prismatic crystal**、plasma 磁気ボトル式
- **Lascannon** (Warhammer 40K): 超太 barrel、紫/白ビーム、独立 power pack
- **AN/SEQ-3 LaWS** (実在): 複数並列 emitter + beam combiner、巨大 capacitor、extensive cooling
- **Atomic Rockets**: 光学系 (lens/mirror/crystal)、可変 focus (Zoom Lens/Deformable Mirror)、冷却が最重要

**共通視覚トロープ**: (1) 後方 chunky capacitor / power pack、(2) radial cooling fins、(3) 内部 prismatic crystal segment、(4) lens stack / nested concentric rings、(5) bright characteristic color、(6) recessed emitter aperture。

**v1 parts** (後→前):
1. Chunky capacitor (R=0.09, L=0.5) — Spartan Laser 電源 pack 風
2. Capacitor bands × 3 (R=0.095, L=0.04 each) — 充電 indicator、cyan emissive
3. Tapered coupling (R 0.085 → 0.04, L=0.1) — 動力伝達 collar
4. Main casing (R=0.04, L=1.4) — 光学筒
5. Radial cooling fins × 4 (box、axial L=0.5, radial 0.04 張り出し) — LaWS 風 heatsink
6. Inner crystal segment (R=0.045, L=0.08) — prismatic crystal、cyan emissive
7. Focus lens stack × 3 (torus、outer 0.06 → 0.042 narrowing、emissive 0.6 → 1.4) — camera lens 絞り
8. Recessed emitter disc (R=0.03, L=0.018) — 発射孔

**Mount**: 最初は gun の細い bracket 流用。odakin 「取ってつけた感」指摘で段階的に改修:
- v1.1 (試行): 重心位置 (COM ≈ x=0.075 inner group) に bracket 接点をシフト。変化小。
- v1.2 (試行): wing-style pylon (fore-aft elongated oval fin) + collar + root fairing の 3 部構成。**v1 cannon の capacitor が pylon に埋もれる問題**で却下 (capacitor の -x 伸長が pylon の hull-下方向と衝突)。

**v1 却下理由**: 砲が pylon に埋もれて一体感無し。「支柱の中に砲が刺さってる」悪趣味。

### v2 (2026-04-22 夕、現在): chin pod 一体型

**アプローチ根本変更**: 別途 bracket/pylon を置くのを止め、hull 底面に半埋没した整流 pod から cannon が「生える」統合型。Y-wing chin turret の発想。

**Cannon** (capacitor 撤廃、slender barrel のみ):
- Barrel (R=0.045, L=1.5) — 主砲身
- Crystal bulge (R=0.055, L=0.1) — barrel 55% 位置、cyan 発光
- Lens stack × 3 (torus、outer 0.068 → 0.046 narrowing、emissive 0.6 → 1.5) — 焦点絞り
- Emitter disc (R=0.032, L=0.016) — bright cyan 発射孔

**Mount = Chin pod**:
- Sphere base R=1 を scale [0.3, 0.13, 0.275] で ellipsoid 化 (fore-aft 0.6 × lateral 0.26 × vertical 0.55)
- 位置: `(POD_X_OFFSET=0.05, 0, -HULL_H/2 - POD_VERTICAL/2 = -0.355)`
- 上半分は hull 内部に埋没 (z > -HULL_H/2 を隠す)、下半分が visible blister
- **pod 下極** (z = -0.63) が cannon mount 一致点、world origin に着地 (SHIP_LIFT_Z = 0.63 共用)
- 色: hull より僅か darker (HSL 210, 28%, 22%)

**cannon mount x-offset**: v1 の COM shift 実験 (MOUNT_X_OFFSET=0.075) は v2 では 0 に。pod 下極から barrel 後端が直接生える見せ方が自然。

### 色 palette (v2)

| 部位 | color | emissive | intensity |
|---|---|---|---|
| Chin pod | hsl(210, 28%, 22%) | hsl(210, 30%, 28%) | 0.3 |
| Barrel | hsl(200, 22%, 20%) | hsl(200, 25%, 28%) | 0.35 |
| Lens rings | hsl(200, 18%, 42%) | hsl(185, 80%, 55%) | 0.6 → 1.5 (前方で up) |
| Crystal | hsl(185, 100%, 70%) | hsl(185, 100%, 65%) | 2.3 (× 1.0 scale) |
| Emitter | 同上 | 同上 | 2.3 × 1.4 = 3.22、toneMapped=false |

cyan 系で統一、emissive part (crystal + emitter) は toneMapped=false でブルーム感 up。

## 残課題 (次セッション以降)

1. **commit + deploy**: v2 の視覚確認 OK なら commit、game 側への integration 判断 (gun/laser default 切替 or 選択 UI)。
2. **apparent shape compliance**: 現在 cannon parts は C pattern (display 並進のみ)。ship 本体と同じ apparent shape matrix (`buildApparentShapeMatrix`) を適用すべきか検討。観測者が高速で動く場合 cannon が楕円化する効果が追加される。
3. **Multi-player color differentiation**: SHIP_LASER_* constants は player-color 非対応。plans の「自機・他機 ship にプレイヤー色を埋め込む」と合わせて設計。lens emissive を player color にする等。
4. **LighthouseRenderer の砲化?**: LH は gun/laser 問わず現在 tower モデル。将来的に LH も laser cannon デザインを踏襲するか、tower 固定か方針検討。

## 関連 commit / ファイル

- `2+1/src/components/game/LaserCannonRenderer.tsx` (新規、v2)
- `2+1/src/components/game/constants.ts` の `SHIP_LASER_*` section
- `2+1/src/components/game/SelfShipRenderer.tsx` (cannonStyle 条件分岐)
- `2+1/src/components/ShipPreview.tsx` (cannonStyle prop)
- `2+1/src/components/ShipViewer.tsx` (Cannon toggle UI)

**未 commit**: 2026-04-22 session 終了時点で上記すべて uncommitted。次 session で OK なら 1 commit にまとめて deploy。
