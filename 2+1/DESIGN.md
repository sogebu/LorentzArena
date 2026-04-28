# DESIGN.md — LorentzArena 2+1

設計判断の記録。分類原則は `claude-config/docs/convention-design-principles.md` §6。未決定の探索・代替案比較は [`EXPLORING.md`](./EXPLORING.md) へ。


## 目次 / domain 別分割構成 (2026-04-18 Level-3 split)

DESIGN.md は domain ごとに分割。本ファイルは **index + アーキ overview + Defer 判断** のみ保持。各 domain の detail は対応する sub-file を参照:

- **メタ原則 (M1-M19 横断的教訓)** → [`design/meta-principles.md`](design/meta-principles.md)
- **完了リファクタ (Authority 解体 + D pattern 化)** → [`design/authority-d-pattern.md`](design/authority-d-pattern.md)
- **ネットワーク + 通信・セキュリティ** → [`design/network.md`](design/network.md)
- **物理** → [`design/physics.md`](design/physics.md)
- **描画 (D pattern 適用 / アリーナ / 星屑 / Exhaust / time fade / 世界線 tube / 色)** → [`design/rendering.md`](design/rendering.md)
- **State 管理 + UI/入力** → [`design/state-ui.md`](design/state-ui.md)

分類原則は `claude-config/docs/convention-design-principles.md` §6。未決定の探索は [`EXPLORING.md`](./EXPLORING.md)。

**配置意図** (§10.10 CLAUDE.md chain + §10.12 Migration level 3 化): DESIGN.md 本体 1371 行 → sub-files に分解して **session ごとに関係 domain 1-2 ファイルだけ read される** 構造に。本 DESIGN.md は overview + Defer のみで毎 session auto-load しても軽い。

## § アーキテクチャ overview

全体を貫く設計原理。個別判断の前提になる。

### 共変表現の徹底 (= 非共変量と γ の使用は最小化)

LorentzArena は相対論的 game。 内部表現には **共変な量 (= Lorentz 変換で正則に振る舞う量) を正本** として持ち、 **非共変量 (= 観測者依存値) を state に保存しない**。 計算式にも非共変量への変換 (= 「γ で割る」 「γ を掛ける」) を極力混入させない。

**4-velocity の正本**: 空間成分 `u_sp = (ux, uy, uz)` を `Vector3` で保持。 時間成分 `ut = γ` は **必要な時にのみ** `sqrt(1 + |u_sp|²)` で給与し、 state には保存しない (= 派生量を正本扱いしない)。 この convention は `phaseSpace.u: Vector3` (`physics/mechanics.ts`) で codebase 全体に適用済。

**避けるべき非共変量と変換**:
- 3-velocity `v = u_sp / γ` — UI 表示 (Speedometer) など本質的に必要な場面に限定
- 座標時間差 `dt = γ · dτ` — 内部計算は proper time `dτ` で書く
- coord-time direction (= `(1, dx, dy, 0)` 4-vector の空間成分 `dx, dy`) — proper-time direction `(ut, ux, uy, 0)` で書ければそちらを優先

**過去の事故例 (再発防止用)**:
- 2026-04-28 [`lighthouse.ts:computeInterceptDirection`](src/components/game/lighthouse.ts) で `phaseSpace.u` (= 既に γv) に更に γ を掛けて `γ²v` として 4-velocity 扱い → quadratic 係数破綻 → LH AI が高速 player に当たらない経年バグ。 docstring が「`(γ, γ·ux, γ·uy, 0)`」 と 3-velocity 前提で書かれていたが caller の実態は 4-velocity だった (= convention の暗黙化が事故の遠因)。 修正時に「`enemyU` は 4-velocity 空間成分」 と docstring 明示。

**コードレビュー時のチェック項目**:
- `gamma(u)` / `Math.sqrt(1 + ...)` で γ を計算してる場所: 4-vector 形成 (= `(γ, ux, uy, uz)` を作る) 以外で使ってないか
- `/ γ` `/ ut` `/ g` で割ってる場所: UI 表示か? 内部計算なら共変表現で書き直せないか
- `phaseSpace.u` を関数に渡す場所: 受け側 docstring と semantics が一致してるか (= 「γv」 か「v」 か)

### データ層と表現層の分離

全 peer が全プレイヤーの world line を常時共有する (データ層)。相対論的な光円錐遅延は「いつ UI に表示するか」の表現層だけで効かせる。データを光円錐で絞る必要はない。

**この原則を見失うと「各 peer は自分の光円錐内のデータしか持てない」と誤解し、設計が無駄に複雑化する** (Authority 解体の議論中盤に実際に一度そうなった)。

### 世界オブジェクト分離: 死亡 = プレイヤーから世界への遷移

死亡イベントで生まれるオブジェクト (凍結世界線、デブリ、ゴースト軌跡) は `RelativisticPlayer` から分離し、独立した state として管理 (`frozenWorldLines[]`, `debrisRecords[]`, `myDeathEvent`)。プレイヤーが持つのは「今生きてるライフの世界線」だけ。

設計原理: 世界に放たれた物理オブジェクト (レーザー、デブリ、凍結世界線) はプレイヤーとは独立に存在し続ける。

副次効果として切断プレイヤーの痕跡も残る。因果律の守護者バグの遠因 (紐付けによる座標時刻の不整合) も解消。

### 死亡時の描画哲学: 物理に任せる

死亡時の唯一の特別処理は「死んだ本人が自分のマーカーを見ない」のみ。世界線・デブリ・他プレイヤーのマーカー表示は通常通り。

凍結された世界線は他プレイヤーの過去光円錐と交点を持つ間は可視 (因果的に正しい「遅延された死亡」)。交点がなくなって初めて消える。リスポーン後も過去光円錐が新世界線に触れるまで不可視。デブリも同様。

以前の `if (player.isDead) return null` で死亡プレイヤーの全マーカーを全観測者から非表示にしていた実装はデブリ表示タイミングに波及していた。相対論的ゲームでは、描画判定に「特殊ケース」を増やすのではなく、過去光円錐交差という統一的メカニズムに任せるべき。

### 過去光円錐に基づく描画

プレイヤーは他オブジェクトの「現在位置」ではなく過去光円錐上の位置を見る。特殊相対論を正確に反映するゲームメカニクスの根幹。計算コストは増えるが、ゲームの存在意義そのもの。

### 物理エンジン: ファクトリパターン (クラス不使用)

イミュータブルな phase space オブジェクトとの相性がよく、テストしやすい。OOP 的な継承は物理演算には不要。

### game/ のファイル配置: flat vs subdirectory

基準: 共有ユーティリティがあるか、3 ファイル以上の密結合グループか → サブディレクトリ。独立モジュールの列挙 → flat。

- `game/` 直下 (flat): 独立した描画モジュールで相互参照がなく、SceneContent.tsx からのみ import される (WorldLineRenderer 等)
- `game/hud/` (subdir): 共有ユーティリティ (`utils.ts`) があり、テーマ的に密結合 (ControlPanel, Speedometer, Overlays, utils)

---

## § Defer 判断

### 残存する設計臭 (2026-04-06 監査 → 同日再評価で全件 defer)

色バグ掃除直後の 4 軸レビューで残存の匂い (単一情報源違反・派生可能 state・外部イベントの React 化・dual entry) を #1〜#4 として棚卸し、同日再評価で全件 defer 決定。後日: #1 は setPlayers ラッパーで実質解決 (`172b600`) / #3 は Authority 解体 Stage B/C/D / #4 は Stage F-1/H で自然消滅 / **#2 のみ現行 DEFER**。#1/#3/#4 の当時詳細分析は git log (このファイル 2026-04-15 以前) 参照、下記は現行 DEFER のみ。

#### 残存臭 #2: connections useEffect で外部イベントを React state 経由で diff している

**場所**: `RelativisticGame.tsx:227-266` (特に `:229` の `prevConnectionIdsRef` 宣言と `:236-244` の比較ループ)

**現状** (Authority 解体後、2026-04-19 で `store.players.has` 既存 peer ガード追加):
```ts
const prevConnectionIdsRef = useRef<Set<string>>(new Set());
useEffect(() => {
  if (peerManager?.getIsBeaconHolder()) {
    for (const conn of connections) {
      if (!conn.open) continue;
      if (prevConnectionIdsRef.current.has(conn.id)) continue;
      if (store.players.has(conn.id)) continue; // migration 経路で再接続した既存 peer を弾く
      peerManager.sendTo(conn.id, buildSnapshot(myId));
    }
  }
  prevConnectionIdsRef.current = new Set(connections.filter((c) => c.open).map((c) => c.id));
}, [connections, myId, peerManager]);
```

**なぜ smell か**: `dc.on('open')` の **その瞬間** に PeerManager は「これは新規接続だ」と分かっている。それをわざわざ `setConnections` で React state に昇格させ、再レンダーを起こし、前回の ref と diff を取って「新規」を復元している。情報の流れが「イベント → スナップショット → diff 検出」と遠回り。

**色との類似**: 色の `playerColor` ブロードキャスト (host → 新クライアントに対して既存プレイヤーの色を送り直す) と同じクラス。**外部の事象 (接続開始、色決定) を、同期機構 (React useEffect / ネットワークメッセージ) に載せて復元している**。

**解消方向**:
- PeerManager に `onNewPeerOpen(cb: (peerId: string) => void)` を足す
- `dc.on('open', () => { cb(dc.peer); notifyConnectionChange(); })` で即時コールバック
- RelativisticGame は useEffect ではなく一度だけ購読:
  ```ts
  useEffect(() => {
    if (!peerManager) return;
    return peerManager.onNewPeerOpen((peerId) => {
      if (peerManager.getIsBeaconHolder()) {
        // snapshot 送信
      }
    });
  }, [peerManager, myId]);
  ```
- `prevConnectionIdsRef` を削除
- 注意: `connections` state は UI (接続インジケータ) で使っているので削除せず、diffing ロジックだけ消す

**優先度**: 高 (コード量削減・バグ温床除去)、難易度: 中 (PeerManager + PeerProvider + RelativisticGame の 3 ファイル変更)

**現状判断 (2026-04-06 再評価)**: **defer**。
- 実コード読み直しで、変更範囲が監査時見積より広いことを確認: PeerManager だけでなく `WsRelayManager.ts` にも同じ callback API を足す必要がある
- diffing は動いている。現時点で実害ゼロ
- 節約される行は 20 行前後、得られるのは「ライフサイクルイベント型の API」という美学
- **un-defer トリガー**: (a) 接続ライフサイクルに絡む実バグ観測、(b) snapshot / sync ハンドシェイクを別設計に差し替える機会、(c) PeerProvider に `reconnecting` 等の phase 概念が必要な機能を足すとき (#4 と合流)

---

### 再評価の教訓 (2026-04-06、4 件を全件 defer に決めた日)

監査時の優先順 (#2 → #1 → #4 → #3) はコード内在的な美学の並びで、「なぜ今これをやるのか」に耐えなかった。

- **色バグとの「アナロジー」を疑う**: 色バグは「guard なしで distributed race していた」(本番実害 5 パッチ)、4 件は「guard ありで動いているが見た目が冗長」。同じクラスではない
- **ROI で並べ直す**: 4 件すべて実害ゼロ・preemptive fix トリガーなし・コスト非ゼロ。物理デモの価値 (時空図を触って体験) を 1 mm も前進させない
- **「束ねる論法」の破綻**: #2 と #4 を「接続ライフサイクル refactor で束ねれば節約」と考えたが、「どのみちやる」前提に依存した節約論で、やる価値自体を疑うと節約効果 0 × 2 = 0

**再 un-defer の共通チェック**:

- [ ] 具体的な bug 観測 or 具体的な機能トリガーがあるか? (「なんとなく気になる」ではない)
- [ ] 現時点で物理デモとして価値のあるタスク (チュートリアル・固有時刻表示・スマホ UI 等) がこれより優先されないか?
- [ ] 修正による regression リスク (特に race / timing 系) は受容可能か?
- [ ] lint + tsc + preview 2 タブテストで検証可能な単位で 1 コミットに収まるか?


## § Build / Bundle 判断

### 単一 vendor chunk を維持する (2026-04-22 規約化)

**決定**: `vite.config.ts` の `manualChunks` は `node_modules` 全体を単一 `vendor` chunk に束ねる。細分割しない。

```ts
manualChunks: (id) => (id.includes("node_modules") ? "vendor" : undefined),
```

**Why — 2026-04-22 の真っ白 regression**:

`4928c98` で vendor を `three` / `react` (react + react-dom + react-reconciler + scheduler) / `peer` / `fiber` (@react-three/fiber) に 4 分割したところ、**react chunk と fiber chunk が ESM レベルで循環 import** になり、ブラウザの module loader が TDZ (Temporal Dead Zone) error を throw して本番サイトが真っ白になった。

根本原因: `@react-three/fiber` は `react-reconciler` の関数を import し、`react-reconciler` は `@react-three/fiber` の内部 helper を import する (React renderer ↔ reconciler の architectural bond)。単一 bundle では隠れていたこの循環が、chunk 境界を引いた瞬間に chunk 間循環 import として顕在化する。

**検出失敗の理由**:

- `pnpm run build` ✓ / `typecheck` ✓ / `test 116/116` ✓ / `pnpm preview` ✓ / chunk HTTP 200 ✓ すべて通った
- `pnpm preview` は dist/ 静的配信で TDZ error を throw することはあるが、Claude Preview (MCP) の `document.hidden=true` 問題と混同しやすく、error を見逃した
- 本番 URL を実ブラウザで踏んで console error を見るまで regression が確認できない性質の事故

**Trade-off**:

- Lose: 巨大 vendor (1.2 MB) chunk の内部キャッシュ granularity。例えば three.js だけ update した時も vendor 全体が invalidate
- Keep: vendor と app (20 KB) の分離 — app コード変更の deploy で vendor cache は hit する (= 実害はほぼない。three.js 等は version bump で同時に他も更新されがち)
- 副産物: chunk hash 1 個増えるだけなので HTTP/2 では DL オーバーヘッドほぼ無し

**vendor 細分割を再考する条件**:

- three.js を単独で頻繁に bump する運用に変わった場合 (現状ほぼなし)
- vendor 1.2 MB の初期 DL がモバイル UX で実測ボトルネック化した場合
- 再実施時は `grep -rn "react-reconciler\|scheduler" node_modules/@react-three/` 等で相互参照を事前確認してから chunk 境界を引く

**関連**: `src/App.tsx` / `src/components/Lobby.tsx` の `lazy(() => import(...))` による route / subtree 単位の code-split は **維持**。これは chunk 間循環を生まない。ShipViewer (#viewer) / GameSession (PeerProvider + RelativisticGame) / ShipPreview (Lobby 背景 3D) を lazy 化することで、Lobby 初期描画 bundle から ~100 KB 程度を defer できる (main chunk 20 KB + vendor 1,178 KB で合計 1,198 KB / 337 KB gzip)。

**incident 詳細 narrative**: `odakin-prefs/staging-incidents.md §2026-04-22 Vite manualChunks 細分割で循環 import`。

### 関連: AVG quarantine 事件 (2026-04-19)

`@react-three/drei` bundle が AVG antivirus に誤検知される事件 (`design/rendering.md §AVG 誤検知事件` 参照) を機に drei 依存は完全撤去済 (`4928c98` で package.json からも除去)。OrbitControls は `three/examples/jsm/controls/OrbitControls.js` から直 import。**単機能のために重い meta-package を入れない**という教訓は bundle 管理全般に適用。

### build と typecheck を分離 (既存決定)

`package.json` で `build = vite build` と `typecheck = tsc -b` を別 script に分離。deploy pipeline (`build → gh-pages`) は tsc を blocking step に含めず、type error があっても build 通過させて deploy できる。明示的に `pnpm run typecheck` を走らせる運用。

**Why**: 型 error の「報告」と「deploy 阻止」を分離。deploy は「UI が壊れていない」ことを最速で確認する用途、type error は視覚に現れないので別軸で監視。CI で並列実行できる。

## PBC torus: Universal cover image observer past-cone pattern (2026-04-28)

PBC topology の描画と event 発火を統一する core abstraction。 当初は「単一最短画像で
primary cell に fold」 する ad hoc な pattern (= GPU shader fold / CPU mid shift / `eventImage`
中心 fold 等) で個別実装していたが、 半開区間 mod boundary flip / echo 不発 / image 位置の
非対称等の問題が次々顕在化したため、 2026-04-28 に **universal cover image observer past-cone
pattern** に統一した。 詳細実装ログ: `plans/2026-04-27-pbc-torus.md`。

> **2026-04-28 後半 update**: causalEvents (= spawn ring / kill UI) は観測者跨ぎ越し問題が
> 顕在化したため **observer-centered minimum image folding pattern** (= `displayPos(event,
> observer, L)` で event を観測者中心の primary cell に折り畳んでから 9 image cells loop) に
> 書き換えた。 観測者は universal cover 上常に primary cell 内に居る扱い → 跨ぎ越し問題が
> 原理的に消える。 ship / worldLine / debris / laser renderer は依然旧 pattern (= obsCell 入り
> dx) のまま動作中、 視覚的不整合が出るかは実機確認後 Phase 2 として議論予定 (SESSION.md
> 「Phase 2 議論」 項目参照)。

### Core abstraction (= 全 phase で唯一の rule)

PBC では同じ event/object が universal cover に無限の image として複製される (`(kx, ky) ∈ Z²`
で `2L * (kx, ky)` 並進した copy)。 観測者本人 (= primary obs) の過去光円錐は spatial 球面で
全方位、 各 image cell の copy は raw spatial 距離 (≤ R*2L) で観測者の過去光円錐に到達する
(= echo として時間差で観測される)。

これを描画と event 発火の両方で **同じ pattern** で扱う:

```
imageObserver = obs - 2L * (obsCell + cell.offset)   // 観測者を image cell 反対方向に shift
isInPastLightCone(raw event.pos, imageObserver)      // raw 距離 (= torusHalfWidth 渡さない)
imagePos = event.pos + 2L * (obsCell + cell.offset)  // observer 中心 cell 位置で表示
```

なぜ「image observer の shift」 か: 「raw event.pos と image observer」 の spatial 距離は
「image event.pos (= raw + offset) と raw observer」 の spatial 距離と等価。 後者で考える方が
直感的だが、 worldLine は raw vertex の集合なので「`pastLightConeIntersectionWorldLine` の
observer 引数だけ shift する」 形にすると **worldLine.ts 側を一切変更せず**、 既存 binary
search ロジックがそのまま動く (= ライブラリの purity を保つ)。

### 物理計算 vs 描画の意味的整合 (= 2 つの異なる距離概念)

PBC 化された距離計算は **2 つの異なる目的**で使い分ける:

- **物理計算 (hit / 攻防判定)** = 最短画像距離 (= `pastLightConeIntersectionWorldLine` に
  `torusHalfWidth` を渡す)。 「最も近い image でゲームメカニクス的に判定」 する。 PBC で
  「敵を隣に 1 周回り込む方向から撃つ」 等の strategic depth 維持
- **描画 / event 発火 (echo display)** = raw 距離 (= image observer shift)。 観測者本人の
  過去光円錐に乗る image を独立判定、 echo として複数 image を表示

ゲームメカニクス上「最短画像で 1 つだけ判定」 する物理と、 visual で「universal cover の
無限 image を見せる」 描画を **混同しない**。 これが ad hoc を脱却した核心。

### 実装位置 (= 全 phase で対称扱い)

| Phase | 実装位置 | 役割 |
|---|---|---|
| 描画: 灯台 hull | `LighthouseRenderer` の cells.map loop | 灯台が観測者の過去光円錐 echo |
| 描画: 他機 hull | `OtherShipRenderer` の cells.map loop | SelfShipRenderer 流用 |
| 描画: 自機 hull | `SceneContent` の self ship section の cells.map loop | 自機 echo (= worldLine ~2L 以上必要) |
| 発火: kill | `causalEvents.ts:firePendingKillEvents` | 各 image 独立判定、 visual effect は primary のみ、 score も primary のみ |
| 発火: spawn | `causalEvents.ts:firePendingSpawnEvents` | 各 image 独立に spawn ring 出る (= echo 複数回) |
| 描画: worldLine | `WorldLineRenderer` InstancedMesh × `(2R+1)²` | mesh.matrix で `2L*(obsCell+cell)` translate |
| 描画: laser | `LaserBatchRenderer` `<lineSegments>` × `(2R+1)²` | 同上 |
| 描画: debris cylinder | `DebrisRenderer` の instance count × `cells.length` | mid に `2L*(obsCell+cell)` 加算 |
| 描画: arena 枠 | `SquareArenaRenderer` の mesh × `cells.length` | 同上 |

worldLine / laser / debris / arena の「mesh.matrix translate」 は image observer pattern と
**等価**: 物体 vertex を `+2L*offset` 並進してから observer rest frame に boost = 観測者を
`-2L*offset` shift してから raw 距離計算するのと同じ。 ship hull 系は per-instance position
計算 (= image observer past-cone intersection) で synthetic player を作って ship renderer に
渡す形。

### ad hoc 化を脱却した経緯 (= 過去事例として記録)

最初は「単一最短画像で primary cell に fold」 する pattern で実装。 GPU shader fold
(`torusFoldShader`) や CPU mid shift (`DebrisRenderer.mid`) などで個別対応。 以下の問題が
次々顕在化:

1. **半開区間 mod boundary flip**: 観測者から見て primary cell `[obs±L)` の右端 `+L` が
   左端 `-L` に flip する mod の半開区間挙動 → 「右で worldLine 非表示 / 左で表示」 の
   asymmetric artifact
2. **echo が出ない**: 1 周回って戻ってきた敵の spawn event が「最短画像で 1 度しか発火しない」
   ため、 同じ event が時間差で複数 image 観測されない
3. **image position が物理的に間違い**: 各 image cell の object を「primary image の
   intersection を image cell に copy」 で配置すると、 「観測者の image (= 隣セルの自分の
   copy) の過去光円錐」 上に置かれる (≠ 観測者本人の過去光円錐)
4. **observer cell index 中心ではなく event cell index 中心の image を判定**: causalEvents で
   `eventImage(ev.pos, cell, L)` (= event 中心固定) を使うと観測者から遠い image しか判定
   されず、 観測者周辺の image が trigger されない

これらすべて「単一最短画像 fold」 の限界 = universal cover image observer past-cone pattern に
統一すれば **原理的に発生しない**。

### Authority 解体パターンとの構造的相似

過去の Stage A〜H Authority 解体 (`plans/2026-04-14-authority-dissolution.md`) と同じ refactor
構造:

- **Before**: 散発的な individual fix (= ad hoc fold / shift / event-centric image) が積層
- **After**: 1 つの core abstraction (= image observer pattern) で全 phase を統一表現

過去事例として、 「個別 fix が積み上がった結果 visual artifact が次々顕在化した」 → 「一気に
core abstraction で refactor」 という pattern は LorentzArena で **再現性のある成功 pattern**。
似たような ad hoc 化が累積し始めたら早めに「universal な統一概念は何か」 を問う。
