# Plan: ALWAYS_ON_TOP pattern 撤去 — 「透明な抽象可視化は depth 書かない」 1 原則に倒す

**起草**: 2026-05-05
**Trigger**: odakin 「絆創膏の上に絆創膏、 みたいになってないか？ 深く根本的に治療してくれ」 (= 5/5 セッション)。
**位置付け**: ALWAYS_ON_TOP pattern (`46f8755` 導入 → `f15fce4` depthTest=false 拡張 → `9f711ca` trio module 化 → `e2608d1` BG/FG split) という 4 段の絆創膏スタックを根本治療で剥がす。

---

## §1 病理 (= 真因の絞り込み)

### 起源の症状
worldline / 光円錐 / **laser worldline** など transparent な「抽象的時空可視化」 系の描画が LH を遮る場面が `46f8755` 前後で観察。 → LH を「常に最前面」 に出すため:
- (1) `46f8755` LH renderOrder=10 bump
- (2) `f15fce4` LH meshes に depthTest=false 追加
- (3) `9f711ca` trio (renderOrder=10 + depthTest=false + depthWrite=false) を共通 module 化

### 5/5 観察された二次副作用
trio (= depthTest 完全 bypass) を持つ entity が複数になった結果:
- **「灯台と自分の表示順序を取り合っている」** (= odakin 観察): 自機 exhaust nozzle と LH 全 mesh が同 renderOrder=10 + depthTest=false → sort tiebreaker 不安定 → flicker。
- 過去の対処 `e2608d1` (= BG=10 / FG=11 layer 分離) は flicker は消すが、 **本来 depth で決まるべき LH ↔ self の前後関係が決定論的 layer 順で決まる**問題を残す (= LH が自機の前にいる時も exhaust が LH を覆う、 物理的に不自然)。

### 真因
**transparent な抽象可視化 material が `depthWrite` を default (= true) のまま放置していた** こと。 三重の trio (`renderOrder` + `depthTest=false` + `depthWrite=false`) は 「depth 書く offender がいる」 という前提で LH を全 depth から逃す方策だったが、 offender 側を直す方が pure。

audit の結果、 `depthWrite` 未設定 (= default true) で書いてた transparent material は:
- **`LaserBatchRenderer.tsx:136`** (`lineBasicMaterial`、 = 主犯仮説、 `f15fce4` commit message 「laser、 opaque scene element 等が depth 書く」 と推測されてた箇所)
- **`SceneContent.tsx:481`** (`meshBasicMaterial`、 自機中心 x-y 平面の参照リング)
- **`threeCache.ts:79` `getDebrisMaterial`** (debris マーカー sphere)
- **`threeCache.ts:97` `getHitDebrisMaterial`** (hit debris マーカー sphere)
- (Jellyfish dome / tentacles は別 design 意図 = 「触手は観測者越しに滲み出す」 で `depthWrite=false` を意図的に外している、 今 scope 外)

これら 4 箇所を `depthWrite={false}` に統一すれば、 LH を depth bypass する必要が消える → ALWAYS_ON_TOP pattern 全撤去可能。

---

## §2 修正方針

### Phase A: 抽象可視化 material の depthWrite 統一

規律: **transparent material は基本的に `depthWrite={false}`** (= 既存の規律で大半適用済、 audit で見つけた 4 箇所を統一)。

- `LaserBatchRenderer.tsx:136` lineBasicMaterial に `depthWrite={false}` 追加
- `SceneContent.tsx:481` 参照リング meshBasicMaterial に `depthWrite={false}` 追加
- `threeCache.ts:79` `getDebrisMaterial` の MeshBasicMaterial 構築に `depthWrite: false` 追加
- `threeCache.ts:97` `getHitDebrisMaterial` の MeshBasicMaterial 構築に `depthWrite: false` 追加

### Phase B: LH / Self / Rocket exhaust から ALWAYS_ON_TOP pattern を撤去

**LH (= LighthouseRenderer.tsx)**:
- `import { ALWAYS_ON_TOP_BG_MESH_PROPS, ALWAYS_ON_TOP_MATERIAL_PROPS }` を削除
- 全 12 mesh から `{...ALWAYS_ON_TOP_BG_MESH_PROPS}` spread 撤去 (= renderOrder default に戻る)
- 全 12 material の `{...ALWAYS_ON_TOP_MATERIAL_PROPS}` を `depthWrite={false}` に置換 (= depthTest は default true に戻る)

**Self ship (= SelfShipRenderer.tsx)**:
- `import { ALWAYS_ON_TOP_FG_MESH_PROPS, ALWAYS_ON_TOP_MATERIAL_PROPS }` を削除
- 4 RCS nozzle exhaust 2 mesh から `{...ALWAYS_ON_TOP_FG_MESH_PROPS}` spread 撤去
- 2 material の `{...ALWAYS_ON_TOP_MATERIAL_PROPS}` を `depthWrite={false}` に置換
- Inline コメント sweep (= ALWAYS_ON_TOP pattern 言及を除去、 「transparent + depthWrite=false で depth 書かないが respect する」 という新原則に書き換え)

**Rocket ship (= RocketShipRenderer.tsx)**:
- 同様に import 削除 + spread 撤去 + material 置換

### Phase C: ALWAYS_ON_TOP module 削除

- `src/components/game/alwaysOnTopRender.ts` ファイル削除

### 期待される結果

新原則: **「opaque 物理 entity (= ship hull) は depth 書く / 自分が前なら覆う、 transparent 抽象可視化 (= laser / worldline / cone / debris / 参照リング) は depth 読むが書かない / 後ろのものを覆わない、 transparent 半物理 entity (= LH 塔 / 自機 exhaust) は depth 読むが書かない / 内部 sort は three.js back-to-front 任せ」**。

この 1 原則で:
- **LH ↔ Self ship hull**: depth で決まる。 self が前なら self が見える、 LH が前なら LH が見える ✓
- **LH ↔ self exhaust**: 両方 transparent + depthWrite=false、 depth-test で respect、 sort で blend
- **LH ↔ laser worldline**: laser が depthWrite=false になるので LH を遮らない ✓ (= 起源の症状解消)
- **LH ↔ worldline / cone / debris**: 既に depthWrite=false なので変化なし
- **renderOrder hack 不要**: 全 transparent が back-to-front sort で適切に blend
- **ALWAYS_ON_TOP module 不要**: pattern 自体が disappear、 「絆創膏」 撤去完了

### scope 外 (= follow-up)

- **JellyfishShipRenderer の dome / tentacles**: 旧 docstring 「触手は意図的に depth interaction 残す」 という design 意図がある。 今は触らない。 jellyfish 系で depth artifact が user 体感あれば別 task。
- **HeadingMarkerRenderer**: depthTest=false + depthWrite=false (= 旧 ALWAYS_ON_TOP 同等) を使用中。 「aim 線は常に visible」 という UI 意図で意図的に depth 全 bypass。 触らない。

---

## §3 影響範囲

### File 変更
- `src/components/game/LaserBatchRenderer.tsx`: 1 line (depthWrite={false} 追加)
- `src/components/game/SceneContent.tsx`: 1 line (depthWrite={false} 追加)
- `src/components/game/threeCache.ts`: 2 lines (depthWrite: false × 2 追加)
- `src/components/game/LighthouseRenderer.tsx`: 12 mesh + 12 material 編集 + import 修正
- `src/components/game/SelfShipRenderer.tsx`: 2 mesh + 2 material 編集 + import 修正 + コメント sweep
- `src/components/game/RocketShipRenderer.tsx`: 2 mesh + 2 material 編集 + import 修正
- `src/components/game/alwaysOnTopRender.ts`: **削除**

### Wire format 影響
- なし (= rendering only)

### Test 影響
- 既存 test pass のまま (= test は logic で render 内部に依存しない)

### 視覚 regression リスク

| risk | 確度 | 緩和 |
|---|---|---|
| LH が self ship hull の後ろに自然と隠れる (= 旧仕様 ALWAYS_ON_TOP では強引に常に最前面化していた挙動から変わる) | 確実 (= **これが意図**) | 設計通り、 user の直感に整合 |
| LH 内部 mesh の back-to-front sort で稀に背面 mesh が前面 mesh より上に bleed | 低 | LH の 12 mesh は spatial に決定論的 + opacity が皆 0.95 程度で blend 自然 |
| laser depthWrite=false で laser 同士の overlap blend が変わる | 低 | laser は背景的描画、 重なり blend が transparent sort 任せに変わるが視覚 noise 不発 |
| 参照リング / debris marker の depthWrite=false で他 transparent との sort が変わる | 低 | 元々 transparent group なので大差なし |

---

## §4 検証

### 自動
- `pnpm run typecheck` clean (= alwaysOnTopRender.ts 削除に伴う import 切れがないか確認)
- `pnpm run lint` warning 32 件以下維持
- `pnpm run test` 247 全 pass

### 手動 (preview localhost)
- 起動 + 初回 render エラー無し
- Lobby + scene 描画動作 (= 静的 visual)

### 本番 deploy 後 (user 実機)
- LH と self ship が **depth で前後決まる** (= 自機が LH 手前: self 見える / 自機が LH 奥: LH 見える)
- LH flicker after hit が消失 (= 5/5 build 09:09:43 の BG/FG split で消えていれば継続)
- laser worldline が LH を遮らない (= depthWrite=false 効果)
- 自機 exhaust が laser に遮られない (= laser depthWrite=false 効果)

### 失敗判定
- LH が突如 self ship hull に隠れる場面で「LH が見えない、 ゲーム play に支障」 と user 判定 → ALWAYS_ON_TOP 復活 OR LH を opaque depth-write 化で「当たり判定 boundary」 化 (= 別設計議論)

---

## §5 メタ原則 link

### M26 application (絆創膏 vs 根本治療)

ALWAYS_ON_TOP pattern は典型的な「症状の上に絆創膏」 の 4 段重ね:
1. (`46f8755`) LH が遮られる症状 → LH renderOrder=10 で対処 (= 1 段目絆創膏)
2. (`f15fce4`) renderOrder だけだと flicker → depthTest=false 追加 (= 2 段目)
3. (`9f711ca`) trio が踏み外しやすい → module 化で固定 (= 3 段目、 但しこれは絆創膏ではなく M28 application)
4. (`e2608d1`) trio entity 同士で flicker → BG/FG layer 分離 (= 4 段目絆創膏)

真因 (= depth-write offender がいる) を直接治療すれば 1-4 全層が消える。 odakin 「絆創膏の上に絆創膏」 直感が完璧に正しかった事例として永続化。

### M27 application (多層 RCA: 症状の出る layer ≠ 真因の layer)

各層 fix は表層症状に対する対処、 真因は **「`depthWrite` のデフォルト値が書く側」 = laser 等の material が depth を不当に書いていた**。 5 layer chain 解消 (5/4 Bug 10) と類似構造で、 「観察された症状」 を 「真因 1 つ」 まで遡って治療した結果 4 層が崩れる。

### 学習として永続化したい点

**transparent material には ほぼ常に `depthWrite={false}` を明示的に書く** という規律を strict にする (= 既存 codebase の大半は適用済、 残 audit で見つけた 4 箇所を統一)。 今後 transparent material を新規追加する時、 lint rule で `transparent` + `depthWrite` 未明示を warning する仕組みは検討候補 (= follow-up)。

---

## §6 完了基準

- [ ] alwaysOnTopRender.ts 削除済
- [ ] LH / Self / Rocket から trio 撤去済
- [ ] 4 箇所の transparent material に `depthWrite={false}` 追加済
- [ ] typecheck / lint / test pass
- [ ] preview 起動 + 初回 render エラー無し
- [ ] commit + push + deploy
- [ ] SESSION update (= ledger #12 真因と修正アプローチ の格上げ)
- [ ] 本番 build 値報告
- [ ] user 実機 verify 待ち
