# design/rendering.md — LorentzArena 2+1 描画

DESIGN.md から分離。D pattern 適用詳細 / アリーナ円柱 / 時空星屑 / Exhaust / 時間的距離 fade / 世界線 tube / 色割り当てなど (最大 section)。

## § 描画

### WorldLine: Lorentz 行列による最適化 (2+1 限定)

TubeGeometry を世界系座標で生成し、表示系への変換はメッシュの Matrix4 として毎フレーム適用。geometry 再生成は `WorldLine.version` を `TUBE_REGEN_INTERVAL = 8` で量子化してスロットリング (8 append ごとに再生成)。

ローレンツ変換は線形変換なので、CatmullRom スプラインの制御点に適用した結果はスプライン全体に適用した結果と一致。行列更新 (16 値のコピー) は TubeGeometry 再生成より桁違いに軽い。5000 点 CatmullRom + TubeGeometry の計算コストを 1/8 に削減。

**制約: 2+1 次元でのみ成立**。時空 (t, x, y) の 3 成分が THREE.js の頂点 (x, y, z) にちょうど収まるため、4×4 ローレンツ行列を列並べ替えで 3×3 部分行列 (+ 平行移動) として表現できる。3+1 次元では t の格納先がないため同じ手法は使えない (カスタム頂点シェーダー必要)。

Tradeoff: 世界線の先端が最大 8 フレーム分遅れて描画される。ゲームプレイ上は視認不可能な差。

### 世界線の過去延長: 廃止済み

`WorldLine.origin` は常に null (「初回スポーン = リスポーン統一」参照)。半直線延長コードと `FrozenWorldLine.showHalfLine` は削除済み。

### R3F 宣言的マテリアル

`getMaterial` + モジュールレベル `materialCache` を廃止し、R3F の宣言的マテリアル (`<meshStandardMaterial color={...} />`) に置き換え。色の変更を自動反映し、ライフサイクルは React が管理。プレイヤー数分 (2-4 個) のマテリアルにキャッシュのパフォーマンス効果はほぼゼロ。

旧: マテリアルキャッシュのキーに色が含まれておらず、仮色 `hsl(0, 0%, 70%)` でキャッシュされたマテリアルが確定色に更新されないバグがあった。

### 光円錐描画: サーフェス + ワイヤーフレーム 2 層

DoubleSide サーフェス (`LIGHT_CONE_SURFACE_OPACITY`) + ワイヤーフレーム (`LIGHT_CONE_WIRE_OPACITY`) の 2 層構造で未来/過去光円錐を表示 (未来/過去各 2 メッシュ、計 4 メッシュ)。

旧実装 (FrontSide サーフェス 0.2 + FrontSide ワイヤーフレーム 0.3) から、DoubleSide に戻して全体を薄くし骨組みで形を出す方針に変更。世界スケール半減で光円錐が小さくなり、FrontSide だと見えにくくなったため。

不採用案: fog (カメラ距離ベースなので、手前と奥がカメラから等距離の場合に効果がない)、gridHelper (空間参照にはなるが奥行き区別には効かない)。

### 永続デブリ + maxLambda observer 非依存

死亡時のデブリをアニメーション (Date.now ベース) ではなく、死亡イベント + パーティクル方向の静的データとして永続保存。過去光円錐との交差を毎フレーム計算して描画。

アニメーション爆発は一定時間で消えるが、遠方観測者の過去光円錐に届く前に消えてしまう問題を解消。

デブリの過去光円錐交差計算で使う `maxLambda` は固定値 `5` (observer 非依存)。デブリ世界線は死亡イベントから無限の未来に伸びる直線で、過去光円錐との交差は純粋に幾何学的に決まる。`observer.t > intersection.t` の条件が既にカバーするため observer の時刻で切り詰める必要はない。

観測依存 (`observer.pos.t - death.t`) だとゴースト中に phaseSpace が止まるとマーカーも止まるバグがあった。

描画コスト: 30 パーティクル × デブリ数 × 毎フレーム二次方程式。MAX_DEBRIS = 20 で上限。

### 色割り当て: joinOrder × 黄金角 + ハッシュフォールバック

2 層構造:
1. **主**: `colorForJoinOrder(index)` — 接続順 × 黄金角 137.5° で hue を割り当て。2 人で 137.5° 離れることが **保証** される
2. **フォールバック**: `colorForPlayerId(id)` — ID の FNV-1a ハッシュ × 黄金角。peerList 未受信時に使用

PeerProvider が append-only `joinRegistryRef` を管理。peerList 受信時にホストの joinRegistry を丸ごと置換 (マージではない)。`getPlayerColor(id)` が joinRegistry にあれば joinOrder 色、なければハッシュ色を返す。

**色の分離性 (黄金角)**: 連続整数 n に対する `n * 137.5° mod 360°` は最も一様な列 (Vogel の螺旋)。ハッシュ出力のビット相関があっても色相が密集しにくい。

**saturation / lightness のビット切り出し**: `hash >>> 8`, `hash >>> 16` は hue に使うビットと独立。必ず符号なし `>>>` を使う (符号付き `>>` は最上位ビットが立つと負数を返し `80 + 負` で想定外の値になる)。

**呼び出し戦略**:
- init 時に一度だけ呼ぶ — `RelativisticPlayer.color: string` フィールドにキャッシュ
- 呼び出し箇所: `RelativisticGame.tsx` init (自分) と `messageHandler.ts` phaseSpace / snapshot ハンドラ (他プレイヤー)
- 派生物 (レーザー色、デブリ、凍結世界線) は作成時の `player.color` を継承

**joinRegistry 同期: マージ → 置換**: クライアントがホストの `peerList` メッセージから joinRegistry を受け取る際、丸ごと置換する。append-only マージは順序の整合を保証できない (タイミング依存) ため、ホストの joinRegistry を単一正本として扱う。マイグレーション後も B の joinRegistry は `[A, B, C]` (A の歴史を保持)、C は置換で `[A, B, C]` を受け取り自分が index 2 になる。

**スポーンエフェクト色の遅延解決**: `PendingSpawnEvent` に `playerId` フィールドを追加し、`firePendingSpawnEvents` が発火時に `players.get(playerId)?.color` で最新色を解決。snapshot 時点では joinRegistry 未受信のため古い色になる問題を修正。

**`getPlayerColor` を useEffect deps に入れない**: `useCallback([peerManager])` で peerManager 変更時に参照が変わる。これを deps に入れると接続変更のたびにゲームループが teardown → ゲーム凍結 (`2472464` で修正)。色は作成時に一度だけ読むので deps に不要。

**トレードオフ**: 「色相距離の最大化」を捨てた。2〜4 人なら統計的に十分分離。もし将来問題になれば `colorForPlayerId` 内部だけで色相テーブルの 12 色パレット化など純関数のまま改善できる。

### レーザー方向マーカー

トリガー中に自機から過去光円錐方向 (45° 下向き) に 3 つの三角形マーカーを表示 (0s/0.05s/0.1s で順次出現、spacing=1.2 で tip↔base 接合)。レーザーが時空図上でどの方向に飛んでいるかのフィードバック。

三角形は過去光円錐の 45° 斜面上に同一平面で配置。向き = `(cos(yaw), sin(yaw), -1)` を正規化。

### レーザー × 光円錐 交点マーカー: 接平面に貼り付く三角形

観測者の過去/未来光円錐とレーザーの交点に、レーザーの向きベクトルを tip とする三角形を **光円錐の接平面上に** 配置する。交点の情報「どの位置で、どっち向きに」を同時に伝達。

**代替検討**:
- 球 (旧): 位置のみ、向き情報なし — 却下
- xy 平面フラット (第一歩): 向きは分かるが、3D 中で「浮いた板」として見え、光円錐との関係が視覚的に切れる — 却下
- 接平面 (採用): 光円錐の 45° 斜面に同一平面で貼り付き、交点と光円錐の一体感が出る

**接平面の幾何**: world 座標で Δ = event − observer、ρ = |Δ_xy|。過去 (Δt<0) / 未来 (Δt>0) 共通で、光円錐 F = Δx² + Δy² − Δt² = 0 の勾配から外向き単位法線は `n = (Δx, Δy, -Δt) / (ρ√2)`。レーザー xy 方向 `ℓ = (ℓx, ℓy, 0)` を接平面へ射影 → `u = ℓ − (ℓ·n)·n` を正規化、`v = n × u` で右手系を閉じ、回転行列 [u|v|n] を生成。world-frame 導出なので観測者静止系/世界系表示どちらでも同一式で動き、D pattern (頂点単位 Lorentz) と整合。

**三角形形状: Acute golden gnomon (頂角 36°、脚:底辺 = φ:1)**

細長い方向指示としては縦:底辺 ≈ 3 前後が視認性に優れる。当初縦:底辺=3.75 / φ:1 分割等を試して最終的に golden gnomon 形 (縦≈1.84·底辺) を採用。これは古典的な「形状としての黄金比」(脚と底辺の比) で、placement としての golden section ではない (**命名時はどちらの黄金比か区別すること**)。

**交点の扱い**: 三角形の重心 ((tip + 2·back)/3) が交点に一致するよう配置 (tip=2h/3, back=−h/3)。球時代の「中心 = 交点」の直感を保存。

**DoubleSide material**: 接平面は斜めなので上下どちらから覗かれても見えるようにする。過去側は不透明 (`1.0`)、未来側は薄表示 (`FUTURE_CONE_LASER_TRIANGLE_OPACITY = 0.2`) で「既に観測済み」と「これから観測する」の視覚階層を維持。

**サイズ階層 (2026-04-18 夜)**: `laserIntersectionTriangle` (底辺 0.12 / 高さ 0.184) を mesh scale で分離 — **過去 scale 3 / 未来 scale 1.5**。過去は「事件として確定」を視覚的に強調、未来は存在主張を控えめに。opacity 階層 (1.0 vs 0.2) と size 階層 (3 vs 1.5) の 2 軸で過去/未来の視覚差を明確化。当初は過去/未来とも scale 2、opacity のみで階層を作っていたが、未来マーカーが埋もれ気味なのと、過去マーカーが小さくて要確認情報として機能しづらいのが課題で、過去は大きく + 未来は小さく + opacity も控えめにの 2 軸分離に移行。

**実装**: `computeConeTangentWorldRotation` ヘルパー (SceneContent.tsx) が world-frame 回転行列を返し、`buildMeshMatrix(event, displayMatrix) × rotation` で mesh matrix に合成。過去/未来両方の render loop で共通利用。

### 光円錐 / 世界線 / レーザー の opacity を定数化

`constants.ts` に 5 定数を集約:

| 定数 | 値 | 旧リテラル箇所数 |
|---|---|---|
| `LIGHT_CONE_SURFACE_OPACITY` | 0.1 | 2 (過去/未来サーフェス) |
| `LIGHT_CONE_WIRE_OPACITY` | 0.05 | 2 (過去/未来ワイヤー) |
| `PLAYER_WORLDLINE_OPACITY` | 0.65 | 1 (WorldLineRenderer default) |
| `LIGHTHOUSE_WORLDLINE_OPACITY` | 0.4 | 1 (SceneContent LH override) |
| `LASER_WORLDLINE_OPACITY` | 0.2 | 1 (LaserBatchRenderer)。初期 0.3、2026-04-17 夜に 0.2 へ控えめ化 |

**基準 (§7.4 運用)**: 「代替検討 / tradeoff 議論のある判断」のみ定数化。光円錐 surface/wire は 4 箇所重複 + 意味のペア、worldline 3 定数は「人間 vs 灯台」「実体 vs 仮想」の視覚階層を名前で expressive にする。対して単発の局所値 (未来交差 0.15 / 0.12、キル通知 0.6 / 0.8、プレイヤー自他 1.0 / 0.5 等) は in-place のまま: 三項内の対比が読めるので定数名にするより直接数値の方が分かりやすい場合がある。

**トレードオフ**: surface と wire を別定数にしたのは、将来「ワイヤーだけ濃くしたい / 薄くしたい」の可能性のため (実際 0.12→0.08→0.04→0.05 と独立に調整、surface は 0.08→0.1)。同値でも分離維持。

### Spawn エフェクト: pillar は過去光円錐 anchor、ring は世界系同時面

**Pillar (時間軸の光柱)**:

World-frame で spawn event から未来方向に固定配置すると、観測者が時間前進する分 display 上で過去側に流れてしまう (観測者基準では「沈んでいく」)。観測者の rest frame で見た目静止させるには、観測者の null cone に anchor するのが物理的に正しい: `anchorT = observer.t − |Δxy|` (spawn xy 上の過去光円錐交差)。

- ρ=0 (= spawn 瞬間に自分が spawn 地点): anchorT = observer.t = spawn.t、pillar が display 中央に
- 観測者が spawn 地点から離れる: ρ 増加、anchorT が遅れる → 光伝播遅延として正しい「光がまだ届いていない」表示

**代替検討**:
- World-frame 固定: 「スポーン事象は世界系で確定した事件」と主張できるが、観測者視点で過去に流れて見える → 却下
- 観測者 rest frame 同時面 anchor (`anchorT = observer.t`): 物理的に光速越え (spacelike separation の点にすら「今ここ」で物体を置く) — spawn 事象の位置なのに光より速く見えてしまい逆に不自然 → 却下
- 過去光円錐 anchor (採用): 「観測者が今まさに見ている時点」で pillar を描画、光速伝播の時間遅延と整合

**pillar 形状は世界系で固定、opacity のみフェード**: 高さ 3 を固定、scale アニメーションは撤廃 (従来の高さ縮退は「流れる」印象を与えた)。`opacity * 0.6` で時間経過と共にフェード。

**軸オリエンテーション修正 (2026-04-15 latent bug)**: `sharedGeometries.spawnPillar` の `CylinderGeometry` は default 軸が local +Y。元コードは rotation なしで `scale=[1, pillarHeight, 1]` をかけていたため pillar は **空間 Y 方向** に伸びていた (コメントでは「時間軸方向」と主張していたが実態と矛盾していた latent bug)。`rotation={[Math.PI/2, 0, 0]}` を追加して local +Y を world +Z (時間軸) に起こした。

**太さ修正**: 半径 0.04 (直径 0.08) では実視不可能なほど細い。0.5 (直径 1) へ。放射 segment 6→12。

**Ring (世界系同時面)**: pillar と違い ring は 5 本が spawn event からわずかに未来側 (ringT = spawn.pos.t + 0.25·i) に配置された world-frame 静止オブジェクト。D pattern で描画することで世界系同時面に自動で乗り、観測者が運動していれば Lorentz 傾斜も反映される。pillar のような anchor 不要 (観測者が時間前進しても ring は world 座標で静止、display 上では過去に流れていくが、5 本の時間方向スタックが「時間軸に広がる波紋」として読めるので違和感ない)。

### 灯台 3D 塔モデル (`LighthouseRenderer`、Phase C2 前哨 2026-04-18 夜)

灯台 (Lighthouse) をプロシージャル 3D 塔ジオメトリで描画、event 位置 (静止 LH の world 座標) を足元 (z=0) として world +Z (= +t) 方向に構成:

```
z ∈ [0, 1.00]    body (taper、底 r=0.40 / 頂 r=0.30)
z = 0.20, 0.70   body 2 本のダーク帯
z = 1.00         balcony torus (xy 水平)
z ∈ [1.00, 1.30] lantern room (半透明 open cylinder)
z = 1.15         lamp emissive sphere
z ∈ [1.30, 1.52] roof cone
z ∈ [1.52, 1.62] spire
```

世界系で静止、観測者 rest frame に切り替えると per-vertex Lorentz で塔が傾く/縮む (静止 LH でも観測者加速で視覚的に歪んで見える = 特殊相対論的効果の可視化)。camera.up = (0, 0, 1) なので display 上では塔がまっすぐ上に立つ。

**描画 matrix は apparent shape pattern (stylization 版)** (2026-04-21、[`plans/2026-04-21-ship-apparent-shape-pattern.md`](../plans/2026-04-21-ship-apparent-shape-pattern.md) §現採用 spec): 底面を O 静止系の xy plane 上に flat な楕円 (x_∥^O 軸 r√2、x_⊥^O 軸 r) に置き、塔軸は world 系で `L(−uA)·(0,0,1)` 方向 (= display 合成後に `L(uO)·L(−uA)·(0,0,1)` = A の 4-velocity を O 静止系で観た向き)。底面の k=√2 は「O 静止系で anchor 起点の過去光円錐頂点方向ベクトルを xy に寝かせて長さ保存」の物理的導出。過去光円錐厳密 (v4 = Nakayama-Oda eq 136/137) / その接平面近似 (v1) を敢えて捨てて視認性優先にした非物理的選択 (詳細と歴代 spec 表は pattern.md 参照)。pure helper: [`src/components/game/apparentShape.ts`](../src/components/game/apparentShape.ts)、ship signature は対応済 (generic uA 引数)。

**過去光円錐 anchor**: 塔の底 (z=0) は `anchorT = min(observer.t − |Δxy|, wp.t)` に配置 (spawn pillar と同じ pattern、§Spawn エフェクト)。これにより:

- 生存中で past cone が spawn event に届いていない期間: 非表示 (リスポーン直後の光伝播遅延)
- 生存中で past cone が spawn 以降を覆う: past-cone 交点に anchor、観測者基準で display 中央に立つ (rest frame 静止)
- 死亡中で past cone が death event に届いていない: past cone anchor 維持、alpha=1 (観測者にはまだ生きて見える遅延)
- 死亡中で past cone が death event 以降を覆う: wp.t 固定 anchor + 過去に沈む `alpha = 1 − (pastConeT − wp.t)/DEBRIS_MAX_LAMBDA` のリニアフェード (debris と同期で時空に溶ける)

**現在世界時刻位置の球マーカー (C pattern)**: 塔の past-cone visibility とは独立に、生存中は `transformEventForDisplay(wp)` 位置に球を表示。リスポーン直後 past cone 未到達で塔が未表示でも「現在世界時刻では灯台はここ」が即時伝わる。

**`LIGHTHOUSE_SINK = 0.16` (2026-04-18 夜)**: 塔全体高さ (~1.62) の約 10% を event 位置より下に沈める。anchorPos (past-cone 判定) はそのまま、inner group の `position={[0, 0, -LIGHTHOUSE_SINK]}` で視覚シフトのみ適用。狙い: 塔基部が event 位置 (= 観測者の過去光円錐との交点) と一致すると浮いて見える問題を解消 ー 少し埋めて「地面に定着した建造物」感を出す。sink は past-cone 判定には非干渉 (anchor は塔基部 z=0 のまま) なので物理的タイミングへの影響はゼロ、純粋に視覚マージン。

**hit 判定パラメータ**: `LIGHTHOUSE_HIT_RADIUS = 0.40` (塔底面 r=0.40 と同値)、`LIGHTHOUSE_HIT_DAMAGE = 0.2` (6 発で死、1.0 → ... → 0 → -0.2 で strict `< 0`)、無敵時間なし → **2026-04-19 で人間と共通の `POST_HIT_IFRAME_MS = 500ms` を適用** (集中砲火即死回避、最短殺害時間 5×500ms = 2.5s に固定。`selectPostHitUntil` の `if (isLighthouse(victimId)) return 0` 短絡を撤廃)。`selectInvincibleUntil` (5s respawn 無敵) のみ LH 短絡 (-Infinity) を維持。energy 回復なし。

### 死亡 past-cone エフェクト共通化 (`pastConeDisplay.ts` + `DeathMarker.tsx`、2026-04-20)

灯台で確立した「過去光円錐 anchor + 沈む alpha fade + 死亡マーカー (球 + 輪)」を、人間プレイヤー (自機 / 他機) にも展開。共通ロジックを 2 ファイルに抽出。

**`pastConeDisplay.ts` の `computePastConeDisplayState(playerPos, spawnT, isDead, observerPos)`**:

pure 関数。past-cone surface anchor + 死亡 fade を計算し `{anchorPos, visible, alpha, deathMarkerAlpha}` を返す。LH / 他機 / 自機 共通。**呼出側 (LighthouseRenderer / OtherPlayerRenderer / SelfShipRenderer の dead branch) は同 utility を使うことで past-cone 振舞いの一貫性が保証される**。

**`DeathMarker.tsx` (sphere + ring): 沈む球 + 沈まない輪**

最も非自明な設計判断。最終形は **「球は world event 位置で沈む、輪は過去光円錐 surface anchor で沈まない」**。

- **Sphere**: `transformEventForDisplay(deathEventPos, observer)` で配置 → 観測者が時間前進すると display.t が −Δt 進み、視覚的に「過去に沈む」。「死は spacetime 上の 1 event であり、その event 自体は時間と共に観測者から遠ざかる」という直感に一致。
- **Ring**: 過去光円錐 surface 上にアンカー (`anchorT = observer.t − ρ`) → 観測者が静止しているなら display 位置は変わらず「沈まない」。観測者が動けば光行差で位置がずれる。「死亡は今まさに観測者に届きつつある光現象 (= past cone が掠める瞬間) として印象づける」。

設計の試行錯誤 (要約):
1. 初版: 両方 world-event 固定 (球と輪両方沈む)
2. 「輪は沈まない」フィードバック → 輪だけ past-cone surface anchor に
3. 「観測者の now 平面 (HUD-like) では?」を一度試して却下 (空間方向にも依存しない方が自然)
4. 「過去の spacetime 点に固定」→ 結局沈むので却下
5. 最終: **「輪 = 過去光円錐上に固定、球 = world event で沈む」(odakin 確定)**

両方とも `DEBRIS_MAX_LAMBDA` で fade 1→0 を同期させ、debris と同タイミングで時空に溶ける。

**SceneContent routing**:

- LH: `LighthouseRenderer` が `computePastConeDisplayState` + `<DeathMarker>` を内蔵
- 他機 (生存/死亡 共通): `OtherPlayerRenderer` が同経路
- 自機 (生存): `SelfShipRenderer`
- 自機 (死亡): **`SelfShipRenderer` をスキップして `OtherPlayerRenderer` (with `deathEventOverride={myDeathEvent.pos}`) を出す**。
  - 理由: 自機の `player.phaseSpace.pos` は ghost 物理で更新され続ける (= ghost.pos に追従) ので、死亡 event の実位置と乖離する。`myDeathEvent.pos` を override で渡すことで「観測者の過去光円錐に届く death event」が実 death event のままになる。

旧 SceneContent の `killNotification` 内 3D sphere+ring (killer===me の時だけ 1500ms 表示) は撤去、各 player renderer 側で全死亡に対し統一表示。`store.killNotification` は HUD text 通知 (`Overlays`) のみで残置。

### 自機 SelfShipRenderer (deadpan SF / 4 diagonal RCS / belly-mounted cannon、2026-04-19)

odakin との対話的設計で **自機を sphere → 六角プリズム + 4 隅 RCS nozzle + 底面 bracket + 懸架砲** に刷新 (`SelfShipRenderer.tsx`)。

**設計哲学: deadpan SF**

「ジョークは大真面目にシリアスな顔をしてやるから可笑しい」。ゲーム仕様 (8 方向 thrust + 過去光円錐との交点で見えるレーザー = 観測者から見ると下 45° 前方に進む) を **literal に反映した形状** で笑いを取る。象徴主義 (黄色三角 / cockpit dome) は不採用、形状そのものに語らせる。

**Hull**: 六角プリズム (CylinderGeometry segments=6)、+x に vertex (尖端) + X 方向 scale 1.4× で elongate → 前後に細長い「nose 付き」シルエット。**形そのものが前方を示す** (黄色三角や cockpit dome は不採用)。`SHIP_FORWARD_MARK_*` 撤去。

**4 RCS Nozzle (de Laval ベル、π/4・3π/4・5π/4・7π/4)**:

物理的に正しい RCS 噴射の分解。`intensity_i = max(0, -localThrust · outward_i)` で、

- WASD 単押し (例: W = +x 加速) → 隣接する **2 ノズルが各 1/√2 (≈ 0.707)** で噴射 (5π/4 + 3π/4 が反対方向)
- W+A (= 北西、対角加速) → 単一ノズル (5π/4) が 1.0 で噴射

→ 「角度の合成則」が見た目に反映される (相対論的速度合成じゃないが、向きの幾何は古典そのもの)。ノズル形状は de Laval ベル (top=EXIT 太い / bottom=THROAT 細い)、外面 FrontSide / 内面 BackSide で 2 pass 描画 (内壁 dark)、tapered mount pylon で hull edge に接合。

**砲 (belly-mounted、+π/4 down-forward)**:

ゲーム仕様: レーザーは 2+1 では 45° 上向きに照射、観測者の過去光円錐との交点で時間発展を見るため、観測者から見ると **下 45° 前方に進む**。これを literal に「下 45° 向きの腹部砲」として実装。

- Hull 底面から垂直 bracket (細い radius 0.04、高さ 0.55) で懸架
- **bracket は breech 中点に attach** (`SHIP_CANNON_REAR_EXTENSION = SHIP_GUN_BREECH_LENGTH / 2`) → 砲尾懸架感
- 構成: breech + 主砲身 (長) + 3 補強リング + TIP (短) + muzzle brake
- **`SHIP_LIFT_Z = HULL_H/2 + BRACKET_H = 0.63` で全体を持ち上げ → cannon 軸が world origin (= 過去光円錐交点 = レーザー発射点) を通過、fire 時レーザーと cannon が完全整合**
- barrel は最終調整で 0.05/2.5 → **0.035/2.3** (細身の対物ライフル風) に着地、ring 位置 (`BARREL_LENGTH * i/(N+1)` 比例) は barrel 短縮で origin 寄りに → 第 1 ring が breech に接触

**色 palette (3 層)**: hue 210 vs 220 の subtle 差で hull と hardware を分離

| 層 | HSL | 用途 |
|---|---|---|
| Navy | hsl(210, 30%, 28%) | hull + cannon 全体、主体 |
| Steel-blue | hsl(220, 25%, 38%) | bracket + pylon + nozzle 外面、取り付け hardware |
| Dark mid | hsl(220, 30%, 26%) | nozzle 内壁、接合陰 |

cannon 全体を navy にしたのは「兵器を hardware として独立させない」設計判断 (船体と砲が同色 = 一体化した道具感)。barrel だけ steel-blue にする案は「砲が浮く」で却下、ring だけ steel-blue も同様。

**廃棄した方向**:

- Direction H (観測ドローン / 望遠鏡、telescope-on-deck): 「ダサい」「形わからん」フィードバックで pre-H 状態に git restore して belly-turret (Direction D) に分岐し着地
- AccelerationArrow / ExhaustCone は SelfShipRenderer 内 4 nozzle 個別 EMA smoothing で再構成 (旧コード SceneContent.tsx から削除、git history で復元可)

**ShipViewer (`#viewer` hash route、`src/components/ShipViewer.tsx`)**:

ゲーム外で 360° preview する独立 scene。OrbitControls (drei ではなく three の jsm から直 import、後述 AVG 回避)、thrust 9 方向ボタン、auto-rotate / grid / BG 切替。PeerProvider / GameStore / 光円錐 一切起動せず → 形状デザインを高速イテレートできる。`App.tsx` で `window.location.hash === '#viewer'` 判定して `<ShipViewer />` を返す分岐。

**AVG 誤検知事件 (2026-04-19)**: `@react-three/drei` bundle が AVG antivirus に `JS:Prontexi-Z [Trj]` と誤検知され、Vite optimize 直後に bundle が quarantine 削除されて真っ白事故。**ShipViewer の OrbitControls を `three/examples/jsm/controls/OrbitControls.js` から直 import に切替** (drei 依存完全撤去) で回避。教訓: 単機能 (OrbitControls だけ) のために重い meta-package を入れない、native API で代替できるなら優先。

### Inner-hide shader (LightCone × cannon の被り解消、2026-04-20)

**動機**: 自機の belly-mounted cannon (origin を貫く軸) と、自機自身の **過去光円錐 / 自機の世界線 tube** が origin 近傍で完全に重なる → cannon が past-cone surface に埋もれて見えない。同様に「他プレイヤーが自機の過去光円錐と交わる時、相手の cannon 周りに自機の past-cone wireframe が乗ってきて視覚汚染する」。

**解決: per-vertex shader で「指定 world 位置から半径 R 以内の vertex を alpha=0」にする**

`innerHideShader.ts` の `createInnerHideShader(radius, centerWorld: THREE.Vector3)`:

- shader injection (`onBeforeCompile`) で vertex shader に `varying vDistToHideCenter` + uniform `uInnerHideCenter` (vec3) を注入
- vertex stage で `length(transformed - uInnerHideCenter)` を計算 (= world 距離)
- fragment stage で `if (vDistToHideCenter < uInnerHideRadius) discard` ではなく `gl_FragColor.a = 0` (transparent material と整合、depth 書きしない設計を維持)
- **`centerWorld: Vector3` を受け取り uniform に直 bind** → useFrame で in-place `set(x,y,z)` するだけで auto sync (allocation ゼロ、毎 frame 更新可)
- `applyTimeFadeShader` と並列に `onBeforeCompile` chain 可 (varying / uniform 名衝突なし、両方適用すれば time fade × inner hide の積)

**hide center の選び方 (semantic)**:

| 対象 mesh | hide center | 理由 |
|---|---|---|
| 自機の自分の過去光円錐 (`LightConeRenderer`) | `observer.pos` (= 自機 event) | 光円錐の apex そのもの |
| 自機の自分の worldline tube | past-cone intersection (= worldline tip) | 自機の現在位置 (= apex でもある) |
| **他プレイヤー / LH の worldline tube** | `pastLightConeIntersectionWorldLine(wl, observerPos)` | **観測者が「今見ている」spacetime 点** (gnomon マーカーが描かれる位置)。**最終 vertex (= 相手の現在 world 位置) ではない** ← 一度ここを間違えて odakin に訂正された |

「観測者から相手はどこに見えるか」 = 過去光円錐との交差点。worldline の最終 vertex は相手の現在 world 位置で、観測者には光速遅延で **過去の位置** に見えるため、最終 vertex を hide center にすると「見えている相手の周りに hide が効かず、未来の相手の周りに hide が効く」というズレ事故になる。

**半径**: hull radius と連動した形式で

```
SHIP_INNER_HIDE_RADIUS = SHIP_HULL_RADIUS × SHIP_INNER_HIDE_RADIUS_COEFFICIENT
                       = 0.32 × 9 = 2.88
LH_INNER_HIDE_RADIUS   = SHIP_HULL_RADIUS × LH_INNER_HIDE_RADIUS_COEFFICIENT
                       = 0.32 × 2.5 = 0.8
```

LH は塔モデルが小さい + 砲身がないので小さめ。係数は 3 → 4 → 5 → 6 → 7 → 8 → 9 とインタラクティブ tuning で着地。当初 `SHIP_INNER_HIDE_RADIUS = 8.5` リテラルで試して「おおきすぎやろ。自機の大きさぐらいじゃないの。自機の適当な半径の適当な係数倍、とかして連動するようにしたら」フィードバック → hull 連動式に切替。

**SceneContent routing**: 全 worldline (生存中: 自機 / 他機 / LH、凍結) に `innerHideRadius` prop を渡す。LH は `LH_INNER_HIDE_RADIUS`、それ以外は `SHIP_INNER_HIDE_RADIUS`。`LightConeRenderer` (= self past cone) は常に `SHIP_INNER_HIDE_RADIUS` 適用。

### worldLine.history サイズ: 5000 → 1000 (FPS 対策、2026-04-17)

**現象**: 固有時間 ~170s の長時間プレイで FPS が 10 まで低下。位置 (円柱内外) にかかわらず、時間経過だけで単調悪化。

**切り分け**: 半透明 surface overdraw・光円錐 overdraw・WorldLine TubeGeometry 再生成を順に無効化して FPS 測定したが、いずれも主因ではなかった (Tube を完全無効化しても放置で FPS 114 → 7)。`MAX_WORLDLINE_HISTORY` を 5000 → 100 に下げると時間経過での劣化が停止 → **`worldLine.history` に対する O(N) 処理** が主因と確定。

**O(N) の発生元**:

- `SceneContent.tsx` の `worldLineIntersections` / `laserIntersections` / `futureLightConeIntersections` useMemo: 毎フレーム全 player × 全 frozen × 全 laser の history を `pastLightConeIntersectionWorldLine` / `futureLightConeIntersectionWorldLine` で走査
- `gameLoop.ts` の `findLaserHitPosition`: 同様に history を舐める

これらが history 長 N に比例。N=5000 では固有時間蓄積で GC + JS execution が 16ms 予算を食い潰す。

**短期対策 (採用)**: `MAX_WORLDLINE_HISTORY = 1000`。視覚的には世界線が過去側で切れる点が手前に来る (= 短い tube) が、実プレイ感はほぼ変わらず。FPS は 120 以上を維持。

**中期対策 (実装完了、2026-04-17 午後)**: `physics/worldLine.ts` の交差系 API を**二分探索**で O(log N) 化。

### 実装 (二分探索 + ±K 近傍)

- `pastLightConeIntersectionWorldLine`: signed cone distance `g(i) = (observer.t − history[i].t) − ρ_i` の符号反転境界を binary search (history は pos.t 単調増加なので有効)、その index から ±K=16 近傍だけ線形走査して **non-monotonic g にも tolerant**。
- `futureLightConeIntersectionWorldLine`: 対称的に `f(i) = history[i].t − observer.t − ρ_i` の `f ≥ 0` となる最小 i を binary search、±K 近傍スキャン。
- `findLaserHitPosition`: laser の時刻範囲 `[emissionPos.t, emissionPos.t + range]` に対応する segment index を `findLatestIndexAtOrBeforeTime` で両端 binary search して絞り込み走査。`history span > laser range` のとき効く (MAX 5000 に戻す際に有効化)。

複雑度: N=1000 で O(N) → O(log N + K) ≈ 26 ops。34 呼び出し/tick として 34 × 26 = 884 ops ≈ 0.1 % CPU (従来 4 % 前後から大幅減)。`MAX_WORLDLINE_HISTORY` を 5000 に戻しても同じ次元で収まる (別 commit で defer)。

### Vitest 導入とテスト駆動

2026-04-17 午前に一度二分探索化を試みたが、HMR で「全描画消失」が起きて B 案のバグに見えて revert した。後に HMR Provider 再マウントの副作用と判明 (M15 事例)。**再挑戦時は linear scan reference 実装との regression test を先に書く** と判断し、Vitest 導入 + 旧 linear 版を `*Linear` として export 維持 + random stress 含む 11 件の regression test を先に green 化、それから呼び出し元 (SceneContent / gameLoop / LH AI) を binary 版に切り替えた (詳細: 2+1/CLAUDE.md §テスト)。

**教訓**: 物理コア (pure 関数だが 100 行超のロジック) を触るときは旧実装を reference として残し、新実装と同じ出力を返す regression test を書いてから呼び出し元を切り替える。bug 混入時も即 revert できる。

**ボツ候補**: MAX<100 (世界線が点化)、Tube incremental update (交差側が主因)、ring buffer in-place (append コストは軽微で根本ではない)、incremental boundary cache (理論 O(1) amortized だが cache invalidate 複雑化、実行差 100 μs/tick 程度で体感不可)。

### Temporal GC: laser / frozen worldline / debris の時間閾値削除 (2026-04-17 夜)

**動機**: 長時間プレイで laser (MAX 1000)・frozen WL (MAX 20)・debris (MAX 20) が上限近くまで溜まると `SceneContent.tsx` useMemo の per-frame 全走査 + per-object instance 更新コストが積み上がる。二分探索で history 走査 O(log N) 化済だが object 数 N_obj 自体を削ってもう一段下げる。time fade ≈ 0.04 で実質不可視 (@ Δt=5×LCH) の object は視認価値ゼロ。

**判定**: `cutoff = earliestPlayerT(= LH 含む全 player の pos.t 最小) − LIGHT_CONE_HEIGHT × GC_PAST_LCH_MULTIPLIER` (= -100 @ default)。各 object の「最未来点」が cutoff 未満で削除:

| object | 最未来点 |
|---|---|
| laser | `emissionPos.t + range` |
| frozen worldline | `history[last].pos.t` |
| debris | `deathPos.t + DEBRIS_MAX_LAMBDA` (= +2.5) |

`useGameLoop.ts` tick 末尾で逐次 filter、通常 cap が先に効く状況では無作業。**定数**: `GC_PAST_LCH_MULTIPLIER = 5` (5×LCH = fade≈0.038 の安全域、下げると撃ったばかりの laser が消える)、`DEBRIS_MAX_LAMBDA = 2.5` (renderer と GC 判定で共有)。

**安全性**: 新 joiner (低 t で参入) がいれば cutoff は自動後退で有効 object が削られない。LH が遠未来 t でも自機が低 t にいれば自機視点で削られない。

### Spawn effect の `depthWrite={false}` (2026-04-17 夜)

**症状/原因**: 自機初回スポーン時 spawn pillar/ring が fade out 最終フレーム付近で「四角い穴」。`SpawnRenderer` の meshBasicMaterial が `transparent=true` で `depthWrite` 未明示 (default true) → opacity 低下中も pillar fragment が depth buffer に書き込まれ、後続透明物 (光円錐 surface) が depth test で reject される。**修正**: pillar/ring に `depthWrite={false}` (arena/光円錐/stardust/exhaust と統一)。透明物ソートは three.js カメラ距離で自動処理。

### アリーナ円柱: world-frame 静止円柱 + 過去光円錐交線ハイライト

**動機**: Thrust energy (§物理) により drifter は燃料で封じられ物理的 drift 制御は不要だが、戦闘領域を空間的に可視化するガイドが欲しいとの要望で un-defer。実装は視覚ガイドのみで物理判定なし (壁で跳ね返す・外に出たら死亡等は検討せず)。§物理「Thrust energy」の `R_HORIZON` 仮置き 30 と異なり、画面内で見える `ARENA_RADIUS = 20` (= LASER_RANGE × 2) を採用。

**幾何**: (x − cx)² + (y − cy)² = R² の円柱、中心 (cx, cy) = spawn 一様分布の中心 (SPAWN_RANGE/2, SPAWN_RANGE/2)。spawn 範囲を [−R, R]² に対称化する選択肢もあったが、対称化は別 commit 扱い (spawn 実装変更を伴うため）。

**時間方向: 観測者因果コーンで切り出される (2026-04-17 改)**: 円柱側面の各 θ について、観測者 `(x_o, y_o, t_o)` からの空間距離 `ρ(θ) = √((x(θ) − x_o)² + (y(θ) − y_o)²)` を計算し、その θ の時間方向を **下端 `t_o − ρ(θ)` (過去光円錐との交点) から上端 `t_o + ρ(θ)` (未来光円錐との交点) まで**に設定する。

- 観測者が円柱中心にいると全 θ で `ρ = R = ARENA_RADIUS` となり、上下端は均一 (= 従来の ±H/2 に相当)
- 観測者が中心からずれると、近い θ は `ρ` 小で上下端が観測者 t に近く (狭く)、遠い θ は `ρ` 大で観測者の過去・未来に大きく伸びる。結果、円柱は**観測者の双円錐で切り出された形**になる
- 上下端が観測者因果コーンに密着するため、「観測者が見えない外の円柱」を描画する無駄がなくなり、過去に試行した `ARENA_HEIGHT = 400` 設計で発生していた**観測者が円柱外から眺めた時の overdraw 問題 (画面全体を覆う半透明 surface が fill-rate bound を招いて FPS 10 まで低下、位置 (67, 52) で実測) が自動的に解消**される

D pattern は維持: 全 geometry は world 座標で vertex を持ち、`matrix=displayMatrix` で per-vertex Lorentz 変換。rest frame では光行差で円 → 楕円に歪む。

**2026-04-18 改: 半幅下限ガード + 過去光円錐交線の独立描画**: 観測者が円柱に近い θ (= ρ が小さい θ) では交線のみで切ると円柱が時間方向に極端に狭くなり、視覚的に円柱の存在感が失われる。これを避けるため円柱本体 (surface / 垂直線 / 上端 rim) の時間方向半幅を `half(θ) = max(ρ(θ), ARENA_MIN_HALF_HEIGHT)` に変更 (= 2026-04-17 の「交線で切る」を「下限 H で底上げ」に一般化、ユーザー指示「max(最大値, 交線)」)。`ARENA_MIN_HALF_HEIGHT = LIGHT_CONE_HEIGHT = 20` (= 旧 `ARENA_HEIGHT = LIGHT_CONE_HEIGHT × 2` の半幅相当、観測者が円柱中心にいる基本ケース全 θ で ρ = R = LCH で ±LCH 描画)。ρ が大きい遠い θ では従来通り光円錐交点 (`pos.t ± ρ`) まで伸び、観測者から遠い円柱部分は大きく、近い部分は最低でも ±H に底上げされる。time fade が Lorentzian r=LCH で |dt| ≤ LCH なら fade ≥ 0.5、`±2×LCH` で fade ≈ 0.2 なので、遠い θ で t が大きく離れても自然に薄くなる。

ガード適用後は円柱上端 rim (旧 `futureCone`) の意味が ρ < H の θ で「未来光円錐交線」ではなくなる (単なる固定半幅 H の上端 rim)。そのため **過去光円錐 × 円柱交線 (`pastCone`) は下限ガードから独立させた別 position attribute で描画**: 全 θ で `pos.t − ρ(θ)` をそのまま辿る LineLoop。ρ < H の θ では円柱下端 (= `pos.t − H`) より未来側に入り、観測者に近い θ では pastCone が円柱内部に位置するが、物理的意味 (観測者の過去光円錐と円柱側面無限延長の交線 = 今まさに光が届いている円柱上の事象の集合) は円柱の人工的な下限ガードと独立に成立するので自然な描画。未来側に対称な「未来光円錐 × 円柱交線」は独立描画しない (物理的情報量が過去側と非対称、ユーザー判断 2026-04-18: 「独立に書くのは過去光円錐交線だけ、他はぜんぶ薄くてよい」)。`ARENA_FUTURE_CONE_OPACITY = 0.3` は上端 rim の意味 (ρ > H の θ で未来光円錐交線 / ρ < H の θ で単なる rim) の中間的重要度を反映、pastCone (1.0) の明確な物理的意味より控えめ。

**position attribute × 2 + 4 geometry は in-place update** (M17 の一般則を適用):
- **clamped 共有 attribute** (`Float32Array` 長 N×2×3): surface / 垂直線 / 上端 rim (旧 futureCone) が共有。各 θ に対して `[上 vertex (i*2+0), 下 vertex (i*2+1)]`、t 座標は `pos.t ± max(ρ, ARENA_MIN_HALF_HEIGHT)`
- **unclamped pastCone 専用 attribute** (`Float32Array` 長 N×3): pastCone 専用。各 θ に対して 1 vertex、t = `pos.t − ρ(θ)` (下限ガードなし)

各 geometry は `setIndex` だけが異なる: surface (triangle strip 2×N)、垂直線 (LineSegments pair ×N)、上端 rim (LineLoop 上 vertex)、pastCone (LineLoop 独立 attribute)。初回 1 回だけ allocation、以後 `useFrame` で 2 attribute の positions を **in-place 更新 + `needsUpdate = true`**。GPU upload は 2 回/frame (共有 clamped + 独立 pastCone)。

**2026-04-17 版からの差分の要点**: 「頂点完全共有で線ズレ解消」の効能は surface ↔ 垂直線 ↔ 上端 rim 間では維持されるが、pastCone だけは独立 attribute になる。ただし pastCone は下限ガードと物理的意味がズレる (ρ < H で下端と pastCone の t が離れる) ので、元々「surface 下辺と完全一致」を保つ理由が消える。独立化でコストは N×3 float の追加 allocation (軽微) と GPU upload 1 回/frame 増。

**frustumCulled=false**: in-place update では BufferGeometry の `boundingSphere` が初回 positions (0 埋め) のまま再計算されず、three.js の frustum culling が「画面外判定」で描画スキップし Arena が見えなくなる (本番で実測)。観測者中心で必ず画面内にあるので culling 無効化で回避。M17 の trap 1 事例。

**採用しなかった代替**: 固定 `ARENA_HEIGHT` + observer.t 中心 window (overdraw 問題で 2026-04-17 放棄) / 線だけ因果コーンで clip、surface ±H/2 固定 (線と surface のズレ) / CylinderGeometry scale 動的変更 (θ 方向の非対称性表現不可) / 毎 tick 新 BufferGeometry 再生成 (M17 アンチパターン)。**2026-04-18 下限ガード案**: pastCone も下限ガード側に含めて attribute 共有 (物理意味が ρ<H で破綻、futureCone と対称「下端 rim」格下げで却下) / pastCone を ρ≥H のみ (LineSegments + mask で複雑化、下限 H は視覚的都合で物理定義は全 θ) / 未来側も独立 futureCone 線 (過去/未来の情報量非対称、ユーザー判断で pastCone のみ独立)。

**anchor 思想の対比**: spawn pillar は「点 + null cone anchor」、アリーナは「時間方向に延びた空間構造 + observer.t 中心 window + 交線ハイライト」。M13 の 2 つ目の適用例、時間的に拡張された幾何には「window + 今の周縁」の 2 層が要る。

**透明度・色 (暫定)**: surface 0.1 / 垂直線 0.05 / PastCone 1.0 / FutureCone 0.3 (過去/未来の情報量差)、surface は `THREE.DoubleSide` (光円錐と同扱い)。色 `ARENA_COLOR = "hsl(180,40%,70%)"` シアン全同色、プレイヤー・LH の色相帯回避、パステル化時再検討。**交線を自機プレイヤー色にする案は不採用** (交線は円柱の所有物で光円錐のものではない)。**垂直線 LineSegments** (wireframe は側面 quad 2 三角形の対角線 + 上下 ring で乱れる): 時間方向 sweep の直線 = 空間固定点の timelike worldline 集合が概念的に正しい。**surface 削除案を検討して却下**: 線だけでは存在感喪失、交線方式移行で overdraw 問題自体が根本解決し surface 維持可に。

**物理判定なし**: 代替 (壁反射 / 即死 / トーラス化) は defer、SESSION.md にトーラス化 todo 保持、un-defer トリガーは壁閉じ込め要望 or トーラス体験向上希望。

### Exhaust (推進ジェット): rest-frame 固定 + 2 層 cone + 共変 α への paving

**動機**: EXPLORING.md §進行方向・向きの認知支援 の育成パス Step 1。入力→結果の直接 feedback、ユーザー期待「進行方向が分かる」の初手。

**物理モデル (3 ステップ想定、v0 は step 1 のみ)**: (1) 加速度を rest frame で与える (keys+yaw から `(ax,ay,0)`) / (2) world frame に boost して broadcast (phaseSpace に共変 α^μ 同梱、未実装) / (3) 観測者 rest frame に戻して描画 (`Λ(u_obs)^{-1}`、未実装)。

**C pattern 採用 (rest-frame 固定)**: v0 は自機のみで step 2-3 不要、cone は自機球と同じ group で `transformEventForDisplay` 経由の display 座標並進のみ。自機視点は dp=(0,0,0) で原点から反推力方向、world view は world pos 起点で Lorentz 収縮なし (step 2-3 実装時に D pattern 昇格)。**D pattern 初版試行は却下**: rest frame 3-vector を world 3-vector として誤扱い、rest-frame view で自機 boost が cone 向きを歪めた。EXPLORING.md「visual-only → 物理放出に上位化」推奨が正解、step 2-3 未実装で D pattern は Λ(u_own) 挿入が必要で他機対応時にまとめて入れる。

**見た目**: 2 層 cone + `AdditiveBlending` + `toneMapped=false` で青白プラズマ発光。外 `EXHAUST_OUTER_COLOR = hsl(210,85%,60%)` (明青) / 内 (`INNER_CORE_SCALE = 0.45`) `EXHAUST_INNER_COLOR = hsl(210,70%,92%)` (冷白)。**プレイヤー色依存は廃止 (2026-04-17)**: 初版は外側 cone にプレイヤー色で identification を担保したが「炎っぽくない」「青系透明度高めが欲しい」で青プラズマ統一。識別は sphere / worldline で既済、exhaust は噴射感のみ (設計過剰整理、opacity 0.7→0.45 で透明感 + additive で光る印象)。1 層 MeshStandard emissive は「色付き三角錐」で噴射感ゼロで却下 → MeshBasic + additive 2 層化 → 色統一 + opacity 下げ、の 2 段階で現在の姿。

**EMA smoothing**: PC binary 入力 (`|a|=0 or PLAYER_ACCELERATION`) の点滅を描画層で EMA (attack 60ms / release 180ms) に、方向は smoothing せず (入力対応が崩れる)。モバイルは連続値で attack で即時 + release で余韻。**energy 連携**: `thrustAcceleration` が `processPlayerPhysics` で energy scaling 適用済 → 枯渇で 0 ベクトル → `EXHAUST_VISIBILITY_THRESHOLD` 未満で自動非表示、特別分岐不要。

**パラメータ**: 2+1/CLAUDE.md §ゲームパラメータ 参照 (`EXHAUST_*` 一式 + SceneContent 内の `INNER_CORE_SCALE = 0.45`)。

**将来拡張**: (a) 他機対応 (step 2-3): phaseSpace に `alpha: Vector4` 追加、発信者 `Λ(u_own)` boost、受信側 `Λ(u_obs)^{-1}` で戻す → D pattern + 共変 α 昇格で Lorentz 収縮・光行差自然。世界線 sample に α^μ 同梱で位置・4-velocity と frame 統一 (1st jet bundle 視点)。(b) 内側コアの色グラデーション (Planck 放射 metaphor)。

### 加速度矢印 (AccelerationArrow、2026-04-18)

**動機**: Exhaust は「反推力」として船体の後方に噴射される → 前進中はカメラと反対側に出て球体で occluded、後退中は手前に出るが方向の識別は難しい。「今どちらに加速しようとしているか」 = 入力意図を**船体の前方 (加速度方向)** に出す必要がある。ユーザー要望 #1 (前進/後退の区別) / #4 (加速度ベクトル矢印)。

**形状: flat 2D ShapeGeometry (xy 平面) に決定**

検討した代替:

1. **3D cone (ConeGeometry)** — 初版。加速度方向と視線方向が揃うと「cone の底面を正面から見る」状態になり、単なる円盤 (blob) に見えて矢印性を失う (実機確認済)。2+1 のカメラは船体上空から斜め見下ろしが基本だが、自機の加速度は必ず xy 平面内にあるため、カメラの見込み方向が加速度にパラレルな瞬間が頻発。**却下**。
2. **3D arrow (shaft + arrowhead 立体)** — cone よりはマシだが同じ視線整列問題あり、geometry / vertex count も無駄。
3. **flat 2D arrow in xy 平面 (採用)** — `THREE.Shape` で shaft + head を 1 枚の平面 path として定義、`ShapeGeometry` にする。xy 平面上に「寝かせて」描画、任意視点 (斜め見下ろし) で常に arrow shape が見える。`side: THREE.DoubleSide` で真上から見ても裏面も可視。

加速度は 2+1 では常に xy 平面内にあるため、矢印も xy 平面に埋め込むのが物理的に自然 (3+1 への拡張時は別解が必要)。

**geometry**: [`threeCache.ts`](src/components/game/threeCache.ts) `sharedGeometries.accelerationArrowFlat`。単位 shape は `y ∈ [-0.5, 1.0]` の矢印:

- tip: `(0, 1)`
- head 左右下: `(±0.35, 0.55)` — 頭の幅 0.7
- shaft 左右上: `(±0.14, 0.55)` — 軸の幅 0.28
- tail 左右下: `(±0.14, -0.5)`

`mesh.scale.set(ARROW_BASE_WIDTH * smoothed, ARROW_BASE_LENGTH * smoothed, 1)` で幅/長さを独立スケール → `ARROW_BASE_WIDTH = 0.95` で実幅は `0.7 × 0.95 ≈ 0.66`、`ARROW_BASE_LENGTH = 2.4` で実長は `1.5 × 2.4 = 3.6` (magnitude=1 時)。

**C pattern (Exhaust と同じ採用理由)**: v0 は自機のみ。mesh は display 座標で player から直接生成 (`transformEventForDisplay(player.phaseSpace.pos, observerPos, observerBoost)` で自機 dp を得る)。他機表示 (D pattern 昇格) は exhaust と同じく phaseSpace に共変 α^μ 同梱が前提、未実装。

**配置**: 矢印 tail (geometry `y = -0.5` 相当) を sphere 表面から `ARROW_BASE_OFFSET = 0.9` 先に配置。`centerOffset = ARROW_BASE_OFFSET + 0.5 × totalLength` → mesh center を加速度方向に offset。Quaternion `setFromUnitVectors((0,1,0), (dirX, dirY, 0))` で +y を加速度方向に回転。

**ARROW_BASE_OFFSET の設計判断**: 当初は `EXHAUST_OFFSET = 0.3` と共通 (矢印 = exhaust の反対方向なので根元同士で球を挟む非対称) だったが、前進時に「噴射炎の反対に同じような炎」と誤認する報告 → `ARROW_BASE_OFFSET` を別定数にして 0.9 まで離した。exhaust は物理現象として球体に近接、矢印は UI 要素として球体から一歩離れる、という役割分離を見た目で強調。

**色**: `ARROW_COLOR = hsl(45, 85%, 70%)` amber。exhaust 青白 (`hsl(210, 85%, 60%)`) と補色関係で、重なっても識別可能。プレイヤー色とも干渉しにくい hue。

**material**: `MeshBasicMaterial` + `transparent` + `depthWrite: false` (後続 additive と同様の描画順不感化) + `toneMapped: false` (色を指定通り出す) + `side: THREE.DoubleSide`。**非 additive** を意図的選択: 矢印は「指示」であり「発光」ではない、濃度の乗算ではなく色そのものを見せたい。

**EMA smoothing**: Exhaust と**同じ関数** (attack 60ms / release 180ms) を**別 ref** で独立保持 (`smoothedMagRef`)。共有 ref にしても挙動は同じだが、2 コンポーネントが同じ useFrame 内で順序依存を持たないよう分離 (どちらが先に tick しても独立に収束)。

**visibility threshold**: `smoothed < EXHAUST_VISIBILITY_THRESHOLD (0.01)` で非表示。Exhaust と同閾値で「input が有意に入っていない」状態を共有判定。energy 枯渇で `thrustAccelRef` が 0 ベクトルになれば矢印も自動で消える (特別分岐不要)。

**役割分離のまとめ**:

| 要素 | 役割 | 方向 | 視覚言語 |
|---|---|---|---|
| Exhaust cone | 反推力プラズマ噴射 (物理現象) | 船体の後方 = 加速度の反対 | 青白 additive、球に密着 |
| AccelerationArrow | 加速度方向の指示 (UI 意図) | 船体の前方 = 加速度と同じ | Amber flat、球から離れる |

**除外したケース**:
- 他機の矢印表示: heading ≠ 加速度方向 (pitch/yaw 入力次第で任意に独立)、phaseSpace の共変 α 同期と heading-from-controls の両方が要る → 設計が exhaust よりも複雑、Phase A のスコープ外 (SESSION.md §次にやること「進行方向可視化 分岐 A」に合流予定)
- 3D 化 (pitch で上下に振れる立体矢印): 2+1 では pitch はカメラのみで物理には影響しないため不要

**参考 commit**: 2026-04-18 (Phase A2)。パラメータ調整履歴 (length 0.8→1.6→1.2, arrow 1.2→2.4→ "きもーち小さく" 保留) は git log を参照。

### 時間的距離 opacity fade (Lorentzian、2026-04-17)

**動機**: 凍結世界線・デブリは event 時刻が固定されているので、観測者の世界系時刻 `t_obs` が進むにつれて相対的に「過去へ遠ざかる」。現状は opacity 一定なので、遠い過去の event も常に同じ濃さで描画され、観測者の「今」の情報密度が相対的に薄まる + 昔の凍結世界線が画面に残り続けて視覚的ノイズ化。

**式 (Lorentzian / Cauchy 形、時間距離の 2 乗反比例)**:

```
fade = r² / (r² + Δt²)、r = TIME_FADE_SCALE = LIGHT_CONE_HEIGHT = 20
opacity = baseOpacity × fade
```

- `Δt = 0` で fade = 1 (発散せず smooth)
- `Δt = LCH` (= 20 = r) で fade = 0.5 (半透明、光円錐の端でちょうど half visibility)
- `Δt = 2×LCH` (= 40 = 2r) で fade = **0.2**
- `Δt = 3×LCH` (= 60 = 3r) で fade = 0.1
- `Δt = 4×LCH` で fade = 0.06 (実用上視認不能)
- `Δt → ∞` で 漸近的に `r²/Δt²` (純粋な 1/Δt² 挙動)

物理の逆 2 乗法則 (重力・光の強度) と同型。

**却下した代替式**: 放物線 `max(0, 1 − (Δt/R)²)` (2 乗「反比例」ではない、R ハード境界で近傍薄 + 遠方急、物理 metaphor 不成立) / hard-clamped `min(1, (r/Δt)²)` (Δt≤r でフラット → 段差) / 線形 (物理類推なし) / Gaussian `exp(−Δt²/r²)` (反比例ではない)。

**対象オブジェクト (per-vertex v1 shader、2026-04-17 導入)**:

| object | vertex t の範囲 | 挙動 |
|---|---|---|
| 生存/凍結世界線 tube (`WorldLineRenderer`) | history range | tip/death time 濃く、古い側薄い |
| デブリ (`DebrisRenderer` InstancedMesh) | death ~ + maxLambda | `USE_INSTANCING` 分岐で per-instance fade |
| 自己光円錐 4 mesh | apex=observer.t、base=±LCH | apex 濃く、base 薄く |
| アリーナ円柱 4 mesh | 上下端 ±max(ρ(θ),H), pastCone: −ρ(θ) | observer.t 近傍濃く、ρ 大端点薄く |
| レーザー batch (LineSegments) | emission.t ~ emission.t+range | emission 濃く、range 先端薄く |

**対象外**: プレイヤー球・交差点マーカー球・exhaust cone (C pattern で display 座標直配置で fade≈1)、spawn/kill (短命)、laser × 光円錐交点三角形 (display z≈0)。

**実装**: `timeFadeShader.ts` の `applyTimeFadeShader(shader)` を material の `onBeforeCompile` に渡す。vertex で `modelMatrix × transformed` (InstancedMesh は `instanceMatrix` 経由) の z から `vTimeFade = r²/(r²+z²)` 計算、fragment で最終 include 後に `gl_FragColor.a *= vTimeFade`。CPU side helper 不要。**Fragment inject key fallback**: Mesh*/Line* は `dithering_fragment`、PointsMaterial (three r181) は `premultiplied_alpha_fragment`、`FRAGMENT_APPLY_KEYS` を優先順で試す (three shader source 変更時に key 追加)。

**定数**: `TIME_FADE_SCALE = LIGHT_CONE_HEIGHT = 20` (自動連動)。**r の選択経緯**: per-mesh v0 で `r = LCH` → ハード境界志向で LCH/2 → per-vertex v1 化で vertex 単位で急峻に感じる → `r = LCH` に戻す (現状、光円錐端で 0.5、±2×LCH で 0.2、±3×LCH で 0.1 の緩やか減衰)。

**時空星屑 (案 17) との相乗効果**: star event を world frame で 4D 一様分布させたとき、観測者時刻から遠い spark も自動で薄くなる → pop-in 抑止 + 観測者周辺の dynamic window 生成 (下記「時空星屑」)。

### 時空星屑 (Stardust、案 17、2026-04-17)

世界座標で (x, y, t) 一様分布した N 個の 4D event を `THREE.Points` で D pattern 描画、観測者周辺に「時空の質感」を付与する背景要素。光行差・Lorentz 変換は per-vertex 自動、時間 fade shader で境界消失、交差計算なしで軽量。

**Periodic boundary (recycling)**: 観測者が box 外 (半幅 `STARDUST_*_HALF_RANGE`) に出ると spark を反対側に wrap-around、境界近傍は time fade で既に透明 (fade<0.1 @ ±3×LCH) で視認されない。静止でも観測者.t が進むため時間方向に常時流入、空間運動時は + 方向追加流入 = 「4D 時空を進んでいる」体感。

**Haiku 版 (revert 済) 欠陥**: grid+hash procedural (cell 跨ぎでポッピング) + `useMemo([observerPos])` で毎 frame BufferGeometry 再生成 + 存在しない store key 参照 + shader 未適用 + useFrame race の 5 欠陥で revert、固定 N + wrap-around + 宣言的 `<points>` + `useDisplayFrame()` + shader 適用で修正。

**定数** (`STARDUST_*`、2+1/CLAUDE.md §ゲームパラメータ で最新値、以下は設計根拠):
- `COUNT`: 段階増量 1500→4000→6000→...→20000→40000 (2026-04-18 夜、size 0.06→0.04 で細かく + 密度上げで前方流入感維持)
- `SPATIAL_HALF_RANGE = 60`: boost で display z にミックスされても大半 window 内
- `TIME_HALF_RANGE = TIME_FADE_SCALE × 3`: fade≈0.1 の境界で自然消失、LCH 自動追従
- `COLOR = hsl(42,55%,80%)` 暖色 amber: 初期 15% 彩度は LH 淡青 (`hsl(220,70%,75%)`) と視覚混同、彩度上げで明確分離
- `OPACITY = 0.5`: time fade 乗算の base、0.9 では前景干渉で 0.5 で背景馴染み

**描画** (`StardustRenderer.tsx`): `<points matrix={displayMatrix} matrixAutoUpdate={false} frustumCulled={false} renderOrder={-1}>` + `<pointsMaterial onBeforeCompile={applyTimeFadeShader}>`。初回 BufferAttribute、useFrame で wrap-around 検査 (N × 3 軸比較、recycling で `needsUpdate = true`)。

**timelike drift 撤回** (2026-04-17 夜): spark.t を観測者.t と同じ dt 進める案 (案 16 star aberration 寄り、「世界系静止観測者に spark 停止」) を `2b6815b` で試したが体感で流入版 (null event) の方が「時空通過感」で β 理念 (物理を通して体験) に沿うため `b15694d` で削除。

**world frame fade** (2026-04-20 解消): 旧: `buildDisplayMatrix` が world frame で identity を返し shader z = 絶対 world t → 観測者.t 進行で全 D pattern 要素が薄くなる (stardust 固有でなく arena / worldlines / debris / lasers 共通)。新: world frame 分岐で `T(0, 0, -observer.t)` を返す (空間 xy は world のまま、カメラ側で追随)。`transformEventForDisplay` も同様に時間のみ並進で揃え、mesh matrix と球位置の整合性維持。これにより shader vertex z = Δt となり rest frame と fade 挙動一致。空間並進まで入れる案 (rest 対称の `event - observer`) は camera rig 変更が必要になるため見送り、最小差分で fade 問題のみ解決。詳細: `src/components/game/displayTransform.ts` docstring。

### 世界系カメラ: プレイヤー追随

世界系カメラモードではプレイヤーの世界系座標 (x, y, t) にカメラが追随。カメラ向き (yaw) もプレイヤーと同じ。静止系と世界系でカメラ挙動を統一 (ローレンツブーストの有無だけが異なる)。

当初は空間 (15,15) に固定していたが、加速方向が視認できず有用性が低かったためプレイヤー追随に変更。

「世界系で世界線が加速方向に曲がって見える」問題は描画バグではなく、摩擦 (`mu = 0.5`) による減速が物理的に正しく反映されていた。

### Radar (2026-04-18 Phase C2)

`game/hud/Radar.tsx`、左下の Canvas 2D mini-map。採用した非自明な選択:

**rest-frame 強制** (main view の `showInRestFrame` トグルに非連動): 「止まって敵を見る」ミニマップは観測者中心で解釈する道具。world frame にすると自機が動いて見え、radar としての即時性が失われる。main view の toggle 状態に関わらず radar は常に観測者静止系で描画。World 4-event → rest-frame Δr は `lorentzBoost(obsU)` + `multiplyVector4Matrix4`、レーザー進行方向は photon 4-momentum `(1, d̂)` を boost (光行差込み)。

**Canvas 2D vs 第二 R3F Canvas**: 候補比較で 2D 採用。R3F Canvas 案は別 scene / 別 camera / WebGL 円形 clip / キャッシュ分離とコスト高、対する 2D は物理関数 (`pastLightConeIntersection*` + `lorentzBoost`) をそのまま composable に使え、radar 固有要件 (heading-up 回転、px サイズの三角形、opaque bg、zIndex) を直接制御可能。

**arena 円周の歪み許容**: rest-frame では world 原点は観測者時刻で動いて見え、`r_world = ARENA_RADIUS` の locus は Lorentz 収縮 + 過去光円錐のため一般に楕円歪曲。正円で描くと嘘になるため過去光円錐 ∩ arena boundary を θ 64 点サンプリング。ごく薄く (opacity 0.1) で参照用。

**レーザー三角形: 黄金 gnomon + 重心配置**: `threeCache.laserIntersectionTriangle` と同じ比率 (脚:底辺 = φ:1、頂角 36°、高さ = 半底辺 · √(4φ+3)) を screen px で再現。**tip ではなく重心を過去光円錐交点に一致** させる (tip=+2h/3、base=−h/3)。3D 版との整合 + 「マーカーが指す点 = 重心」の視覚法則。

**常時 ON + トグル削除**: 初期はトグル付きで実装したが「切る意味が無い」判断で削除。ControlPanel の残り 2 トグル (静止系/世界系、透視投影/正射影) は `display: grid` + `gridTemplateColumns: subgrid` で列揃え (CJK 幅で `ch` や `minWidth` が効かない問題を構造的に回避)。

---

