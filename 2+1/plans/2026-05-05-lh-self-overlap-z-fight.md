# Plan: 自機と LH の z-fight (= 重なり時 LH flicker) 根本治療

**起草**: 2026-05-05
**Trigger**: odakin 観察「画面で自分と灯台が重なった状態になると灯台がフリッカー」 (= depth-aware-cleanup `2e19da2` deploy 後の 5/5 verify session)。
**位置付け**: 直前 commit `2e19da2` で ALWAYS_ON_TOP pattern を撤去 → LH が depthTest=true に戻った結果、 自機と LH が geometric に overlap する位置で **z-fight が表面化**。 旧 ALWAYS_ON_TOP は副作用的に z-fight を回避していた (= depthTest=false で depth 比較 skip) が、 それは「絆創膏的副作用」 だった。

---

## §1 病理 (= 数値解析)

### 重なり geometry

constants.ts より:
- `SHIP_LIFT_Z = 0.16/2 + 0.55 = 0.63` (= 自機 hull 中心 z)
- `SHIP_HULL_HEIGHT = 0.16` (= 六角柱 hull の z 厚み)
- `LIGHTHOUSE_SINK = 0.16` (= LH 全体の z 下げ量)
- LH inner group `scale={0.5}` + `position={[0, 0, -LIGHTHOUSE_SINK * 0.5]}`

→ 自機 hull は z ∈ [0.55, 0.71]、 LH body は z ∈ [-0.08, 0.92] (scale 0.5 適用後)。 **重なり領域 z ∈ [0.55, 0.71]** が geometric に存在 (= player が LH の xy 上に座ると、 LH body 円筒の側面が self hull の高さと一致)。

### z-fight 発生メカニズム

three.js render pipeline:
1. **Opaque pass**: self hull (`<meshStandardMaterial>` no `transparent`) で depth buffer に d_hull 書き込み
2. **Transparent pass**: LH 全 mesh (= `transparent` + `depthWrite={false}`) を back-to-front sort で render、 depth-test against d_hull

LH body 円筒側面の z=0.6 の点と、 self hull の z=0.6 の点 (= 両者の overlap zone 中央) は **camera-space depth が float 精度内で同等**。 depthTest 関数 (default = `LessEqualDepth`) が ≤ で評価する時、 d_LH と d_hull の差が float 精度限界以下なら frame 毎に評価 flip → **LH 描画が ON/OFF の繰り返し** = user 観察「LH フリッカー」。

### 過去の絆創膏が隠していた理由

- `f15fce4` (= LH に depthTest=false 追加) は「laser worldline が depth 書いてた」 主因に対する fix だったが、 副作用で **LH が depth 比較を skip** → 自機との z-fight も発生不可能化していた
- `2e19da2` で「真因 (= laser depthWrite default true) を直して ALWAYS_ON_TOP 撤去」 → 結果として z-fight 副作用回避も失われた
- これは「絆創膏 4 段スタック」 の 4 段目が抑えていた症状の **第 5 の隠れ顔**

---

## §2 修正方針: polygonOffset

### なぜ polygonOffset か

z-fight の標準 3D rendering 解決技法。 material level で depth fragment に固定 bias を加える:
- `polygonOffsetFactor`: slope-dependent な bias (= 視線に対する surface 傾斜で増減)
- `polygonOffsetUnits`: 定数 bias (= depth buffer の最小単位を unit として加算)

**LH 全 mesh に正の polygonOffset を付ける** = LH の depth fragment が「ほんの少しだけ camera から遠い」 と扱われる → 自機 hull (= bias 無し) との比較で hull が常に勝つ → **deterministic**。

### 値の選択

`polygonOffsetFactor=1, polygonOffsetUnits=1` を 出発点に。 値が小さすぎると float 精度を超えず効果なし、 大きすぎると normal-depth z-test で 1 単位以上 ずれて他 entity (= debris / worldline) と LH の depth 順が乱れる。 1/1 は three.js docs / 標準的 use case (= mesh 表面に line overlay の z-fight 防止) でも常用値。

### Visual 影響

- 自機が LH 内部に入った時: LH 側面が self hull の silhouette 領域で消える (= self hull が「LH 越しに自分の姿を見せる」 形)
- self hull が LH の前にいる時 (= 通常 play、 自機が LH の手前): self hull は元から LH より camera 近 → LH が hull の後ろ → polygonOffset 関係なく depth 順で正しい
- self hull が LH の真後ろ: self hull が hidden (= 元から LH に隠れる)、 polygonOffset で LH が遠くに見えるが visual 影響小

→ 通常 play の 99% の view では polygonOffset は無効果、 重なり時のみ deterministic 化。

### なぜ他の選択肢を取らないか

- **(β) LH 全 mesh を opaque 化**: opacity 0.95 → 1.0 で見た目変化、 死亡 fade 時に dynamic transparent flag 切替 必要 → 実装複雑
- **(γ) LH を z 方向に lift して self hull と分離**: LH 基底位置が変わる、 「地面に立つ塔」 から「浮遊する塔」 に visual 変化
- **(δ) collision detection で self ↔ LH 重なりを禁止**: gameplay 変更、 player の自由移動制限、 別議論

polygonOffset は visual 不変で z-fight だけ消える surgical 解。

---

## §3 実装

### Phase 1: LH 全 12 mesh material に polygonOffset を追加

[`LighthouseRenderer.tsx`](../src/components/game/LighthouseRenderer.tsx) の各 material に:
```tsx
polygonOffset
polygonOffsetFactor={1}
polygonOffsetUnits={1}
```
を追加。 適用範囲:
- body / bodyBand × 2 / balcony / lantern / lamp / roof / spire (= 8 structural mesh)
- past-cone marker main / glow / future marker main / glow (= 4 marker)
合計 12 mesh material。

`depthWrite={false}` 既存設定はそのまま維持 (= 透明 sibling との depth 干渉防止)。

### Phase 2: 検証

- typecheck pass / lint pass / test pass
- preview 起動 + console error 無し
- 本番 deploy
- user 実機 verify (= 半日後復帰時、 「LH に近接 + overlap で flicker しない」 を確認)

---

## §4 リスクと緩和

| Risk | 確度 | 緩和 |
|---|---|---|
| polygonOffset 値 1/1 が小さすぎて float 精度 borderline で z-fight 残存 | 中 | 値を 2/2 に bump / または値選択を constants 化して tuning しやすく |
| polygonOffset 値が大きすぎて debris / worldline / 他 entity との depth 順が乱れる | 低 | 1/1 は標準値、 他 entity の depth は LH との z 差が十分大きい |
| WebGL 実装差異で polygonOffset の挙動が browser 間でブレる | 低 | three.js が WebGL state 統一管理、 主要 browser で動作実績あり |
| 自機が LH 内に入った時の visual が「不自然」 と user 評価 | 低 | polygonOffset は重なり時のみ self hull が見える挙動 (= 直感的)、 ALWAYS_ON_TOP 時の「LH が常に上」 より物理的 |

---

## §5 メタ原則 link

### M26 application
ALWAYS_ON_TOP pattern 撤去 (`2e19da2`) は「絆創膏 4 段スタック」 を 1 文で剥がしたが、 **絆創膏が抑えていた症状 (= z-fight) が新規顕在化**。 これは「絆創膏を剥がす時、 そこに何があったかを understand してから剥がす」 規律の重要性。 今回は polygonOffset で再対処、 これは絆創膏ではなく **z-fight に対する標準 surgical 治療**。 区別:
- 絆創膏 (= 病気を隠す): ALWAYS_ON_TOP の depthTest=false (= 物理的に間違った depth 関係を強制)
- 治療 (= 病気を治す): polygonOffset (= 数値精度の限界点で deterministic 化、 物理的 depth 関係を維持)

### M27 application
「症状の出る layer ≠ 真因の layer」 の 5 layer chain と類似:
- Layer 1 (rendering 表層): LH flicker
- Layer 2 (rendering 中層): z-fight
- Layer 3 (geometry): self ship と LH が同 z 範囲で overlap
- Layer 4 (gameplay): collision detection 無し → self が LH 内部に侵入可
- Layer 5 (game design): LH を「侵入可」 とする design choice

今 plan は Layer 2 を polygonOffset で fix。 Layer 3-5 は preserve (= 設計意図)。

---

## §6 完了基準

- [ ] LH 12 mesh material に polygonOffset 追加済
- [ ] typecheck / lint / test pass
- [ ] preview 起動 + console error 無し
- [ ] commit + push + deploy
- [ ] SESSION ledger 更新 (= 「z-fight 根本治療」 として新 entry、 user 実機 verify 待ち)
- [ ] user 実機 verify 完了 (= LH と self 重なり時に flicker しない)
