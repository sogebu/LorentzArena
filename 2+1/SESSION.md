# SESSION.md — LorentzArena 2+1

## 現在のステータス

**`e6c17cc` デプロイ済** (build `2026/04/27 15:15:46 JST`)。本番: https://sogebu.github.io/LorentzArena/

未デプロイ commit (= main の更新): 2026-04-27 後半〜2026-04-28 早朝で **PBC torus アリーナ完成版**。 デフォルト = `torus` (= 周期的境界条件)、 円柱は `#boundary=open_cylinder` でオプション保持。 **「世界線が画面を横切らない」 core requirement 達成 + 光円錐境界クリップ解除 + 1 周回って戻ってきた敵 event の過去光円錐到達発火 fix** すべて完了。 **実機 multi-tab 実戦テストは継続中** (odakin が境界跨ぎ視覚確認済、 「光円錐切れる」 と「リスポーンエフェクト不発」 の 2 bug を実機検出 → 即時 fix push 済)。

主要 commit:
- [`9d14b16`](https://github.com/sogebu/LorentzArena/commit/9d14b16): worldLine line break (GPU shader fold + segment break)
- [`f209d32`](https://github.com/sogebu/LorentzArena/commit/f209d32): Debris / Laser fold
- [`89eb814`](https://github.com/sogebu/LorentzArena/commit/89eb814): Step 2 Appendix B + 過去光円錐 ∩ 正方形 を Step 2 統合判断
- [`86ae2cf`](https://github.com/sogebu/LorentzArena/commit/86ae2cf): 光円錐 cylinder clip 解除 (= torus mode で arena 境界に押しつぶされない)
- [`d203503`](https://github.com/sogebu/LorentzArena/commit/d203503): 1 周回って戻ってきた敵 event の過去光円錐到達発火 (kill / spawn UI)

### 直近の文脈 (次セッションで意識すべき状態)

#### PBC torus アリーナ (2026-04-27) — 完成版

第 3 軸の `boundaryMode: "torus" | "open_cylinder"` を controlScheme / viewMode と直交軸として追加。 デフォルト torus = PBC、 切替は URL hash `#boundary=open_cylinder`。 LS 永続化、 UI dropdown は撤去。

**設計の核** (詳細: `plans/2026-04-27-pbc-torus.md`):
- `phaseSpace.pos` / `worldLine` 各点は **unwrapped 連続値** を source of truth に維持。 wrap は描画と距離計算に閉じ込める
- 距離計算: `pastLightConeIntersectionWorldLine` / `findLaserHitPosition` / `processHitDetection` / `processLighthouseAI` / `checkCausalFreeze` / `computeInterceptDirection` / `Radar` で観測者を worldLine 最新点と同 image cell に shift してから連続値計算 (worldLine.ts は無変更)
- 描画: `transformEventForDisplay` に optional `torusHalfWidth` 引数で観測者中心の primary cell `[obs±L]²` に最短画像で折り畳む (= Asteroids 風 visual wrapping)
- worldLine / laser の line geometry は **GPU shader (`createTorusFoldShader`) で per-vertex fold** + **CPU で wrap 跨ぎ点を segment に分割**。 vertex 値は raw unwrapped 連続値、 fold は GLSL `mod` で `[obs±L]²` 内に投影
- DebrisRenderer は cylinder instance translation (= mid) を `minImageDelta1D` で primary cell に shift (= cylinder 軸そのものは world coords 保持、 mid 移動だけで instance 全体が対応 image cell に表示)
- ArenaRenderer は boundaryMode で `SquareArenaRenderer` (4 corner 縦エッジ + 上下 rim) と `CylinderArenaRenderer` (旧) に dispatch

**主要ヘルパ** ([`physics/torus.ts`](src/physics/torus.ts)):
- `minImageDelta1D(d, L)` / `minImageDelta4(a, b, L)`: 最短画像 delta
- `imageCell(p, obs, L)`: floor based の cell index (境界跨ぎでの flicker 安定)
- `displayPos(p, obs, L)`: observer 中心 primary cell に折り畳み
- `isWrapCrossing(p0, p1, obs, L)`: 隣接 worldLine 点の wrap 跨ぎ判定 (raw Δ defensive + cell 比較 primary、 OR 結合で漏れなし)
- `subVector4Torus(a, b, halfW?)`: optional torus 化された subVector4
- `shiftObserverToReferenceImage(obs, ref, halfW?)`: 観測者を reference と同 cell に shift (worldLine.ts 不変で PBC 対応する核 helper)
- 単体テスト 26 ケース pass ([`physics/torus.test.ts`](src/physics/torus.test.ts))

**Renderer 別 segment 分割 helper**:
- [`buildWorldLineSegments`](src/components/game/WorldLineRenderer.tsx): worldLine.history を `isWrapCrossing` で分割。 各 segment 独立 TubeGeometry。 9 unit tests
- [`buildLaserSegments`](src/components/game/laserSegmentSplit.ts): emission ↔ tip が異なる image cell の laser を Liang-Barsky 風境界クリッピングで 2 segment に分割。 9 unit tests
- DebrisRenderer は cylinder length が短い (~1-2s) ので mid shift のみ。 完全 segment 分割は Step 2 (3x3) で吸収予定

**LightConeRenderer の torus 対応** ([`86ae2cf`](https://github.com/sogebu/LorentzArena/commit/86ae2cf)):
- 円柱 arena 時代の `cylinderHitDistance` clipping は `boundaryMode === "open_cylinder"` でのみ適用、 torus mode では `ρ = LIGHT_CONE_HEIGHT` 全方位一定
- LCH = ARENA_HALF_WIDTH = 20 で球面 rim はちょうど primary cell `[obs±L]²` に内接 (4 辺中点で接、 4 corner からは `√2·L` ≈ 28.3 外)、 1 cell 内に自然収まる
- 「世界が PBC で繰り返す」 = 光円錐は壁で押しつぶされない、 spatial 全方位に extended

**Causal event 関連の torus 対応** ([`d203503`](https://github.com/sogebu/LorentzArena/commit/d203503)):
- [`isInPastLightCone`](src/physics/vector.ts) に optional `torusHalfWidth` 引数追加、 指定時は (x, y) を最短画像で計算
- [`firePendingKillEvents`](src/components/game/causalEvents.ts) / [`firePendingSpawnEvents`](src/components/game/causalEvents.ts) に同引数を伝搬、 useGameLoop の callsite で `boundaryMode === "torus"` の場合 ARENA_HALF_WIDTH を渡す
- これで「1 周回って戻ってきた敵」 (= primary cell の反対側に再出現) の死亡 / 復活 event も最短画像で過去光円錐到達判定 → kill notification / death flash / spawn ring が trigger される
- 7 unit tests (基本 3 + torus 化 4)

**Shader fold** ([`torusFoldShader.ts`](src/components/game/torusFoldShader.ts)):
- vertex shader の `#include <begin_vertex>` 直後に注入、 transformed.xy を `obs.xy + mod(transformed.xy - obs.xy + L, 2L) - L` で primary cell 内に折る
- `uObserverPos` Vector3 ref を `useFrame` で in-place 更新 (= `hideCenter` と同じパターン)
- 既存 `applyTimeFadeShader` / `createInnerHideShader` と並列共存 (注入順 fold → timeFade → innerHide、 z 不変 / world 距離変わらないので互換)
- 4 unit tests (uniform 設定 / inject 文字列 / inject 位置順序 / key 欠落時の skip+warn)

**未実装の後続作業**:
- **過去光円錐 ∩ 正方形枠 の交線描画** (低優先、 描画装飾): 円柱版の `ARENA_PAST_CONE_OPACITY` 相当、 4 平面 × 円錐の交線計算が要
- **Step 2 (3x3 image cell 描画)** (新規アイディア): 観測者中心に世界が `3x3` マス重複表示 = Asteroids 風 visual wrapping。 PBC topology の視覚化として本質的に正しい。 InstancedMesh + offset attribute で全 D pattern renderer に展開、 timeFade に spatial fade 追加で「無限平行世界が遠方で自然 fade out」 を実装。 別 plan 化予定 (`plans/2026-04-XX-pbc-torus-tile-N.md`)。 詳細議論: `plans/2026-04-27-pbc-torus.md` Appendix B

**実機 multi-tab 実戦テスト** (= 中間版完遂 → odakin 確認待ち):
- 自機を境界 (各軸 ±20) に向けて動かして、 worldLine が画面横切らずに line break で切れて反対端から再開する
- 量子化境界での vertex jump 無し (= shader 連続 fold)
- 境界跨ぎでもレーザーが反対側に届く (visual + hit 判定)
- 死亡 / debris の周辺で cylinder が境界付近でも mid 中心に表示
- 結果 OK なら deploy

#### 操作系・機体形状の axis 設計 (2026-04-27 前半 再編)

操作系 (`controlScheme`) と機体形状 (`viewMode`) を直交軸として独立に持つ。コードは各軸 3 種すべて保持、UI dropdown は両方撤去 (隠しオプション)、デフォルトは `legacy_classic` × `classic`。

| 軸 | 値 | デフォルト | UI |
|---|---|---|---|
| `controlScheme` | `legacy_classic` / `legacy_shooter` / `modern` | `legacy_classic` | 撤去 |
| `viewMode` | `classic` / `shooter` / `jellyfish` | `classic` | 撤去 |

**切替手段**: URL hash override `#controls=modern` / `#ship=jellyfish` (`&` 区切りで併用可、`#room=test&controls=modern&ship=jellyfish`)。一度 hash で切替えると LS (`la-control-scheme` / `la-view-mode`) に persist、次回 hash 無しでも維持。デフォルト復元は LS 削除 + reload。詳細は `2+1/CLAUDE.md §URL hash override`。

#### 操作系それぞれの挙動

**`legacy_classic` (default、71e5788^ 時点の旧 classic 復元)**:
- WASD = 機体相対 thrust (前後左右、yaw 基底に投影)
- 矢印 ←/→ = `headingYawRef` 連続旋回 + camera 同期 (cameraYawRef = headingYawRef)
- 矢印 ↑/↓ = camera pitch
- 機体本体 group が heading で回転、cannonYawGroup は 0 (本体に固定)、噴射方向は world thrust を local frame に inverse rotate
- aim 線 (HeadingMarkerRenderer) **非表示** — 本体 hull が heading 方向を示すため冗長

**`legacy_shooter` (旧 twin-stick、71e5788^ 時点の旧 shooter 復元)**:
- WASD = camera basis での進みたい方向 → heading 即時スナップ + thrust
- 矢印 ←/→ = `cameraYawRef` 旋回 (camera が機体周りを回る、heading は WASD で別途決定)
- 機体本体は heading で回転 (twin-stick 風)
- aim 線 表示 (opacity 0.22)

**`modern` (71e5788 で導入した新統一操作系)**:
- WASD = world basis (cameraYaw=0 前提) thrust、heading 不変
- 矢印 ←/→ = `headingYawRef` 旋回 (砲身/aim のみ)、camera は固定
- 機体本体は world basis 固定 + 砲塔のみ heading 追従、噴射方向は world thrust そのまま
- aim 線 表示 (opacity 0.22)
- 詳細: [`gameLoop.ts:processPlayerPhysics`](src/components/game/gameLoop.ts), [`useGameLoop.ts:260-285`](src/hooks/useGameLoop.ts), [`SceneContent.tsx:189-204`](src/components/game/SceneContent.tsx), [`SelfShipRenderer.tsx`](src/components/game/SelfShipRenderer.tsx) の controlScheme 分岐

#### 機体形状 dispatch (SceneContent)
- **classic** ([`SelfShipRenderer`](src/components/game/SelfShipRenderer.tsx)): 六角プリズム + 4 RCS。controlScheme で本体 group rotation を切替 (legacy 系で本体 heading 回転 + 噴射 yaw 変換、modern で本体固定 + 砲塔のみ)
- **shooter** ([`RocketShipRenderer`](src/components/game/RocketShipRenderer.tsx)): ロケット teardrop body。砲が無いので本体ごと heading 追従 (lerp tau=80ms)
- **jellyfish** ([`JellyfishShipRenderer`](src/components/game/JellyfishShipRenderer.tsx)): 半透明 dome + Verlet rope 触手 14 質点 + 武装触手 (= 砲) のみ heading 方向。ジャパクリップ「クラゲ」を motif にした procedural 派生

#### HeadingMarkerRenderer — 過去光円錐 + cylinder mesh
- 「laser は観測者の過去光円錐上を流れる」物理整合のため過去光円錐の母線 (= -t 方向) を null geodesic として描画
- `mesh + cylinder geometry` + 標準 scene graph (旧 LineSegments の context lost 脆弱性回避)、`depthTest=false + renderOrder=20` で常時可視
- 自機専用 (= observer = self、observer rest frame で origin から direction*L)
- 寸法 (2026-04-27 odakin 調整): LENGTH `15.0`、RADIUS `0.04`、OPACITY `0.22` で aim ガイドとして主張控えめに
- **legacy_classic では非表示** (本体が heading を示すため冗長)、modern / legacy_shooter で表示

#### LightConeRenderer — one-sided 表示
- 4 mesh (future surface/wire + past surface/wire) を future=`BackSide` / past=`FrontSide`(default) に
- 効果: 未来側から見下ろすと future cone は cull、過去側から見上げると逆、側方視点では両方見える

#### 物理関連の維持事項
- **`phaseSpace.alpha` は thrust only** ([`gameLoop.ts:204-217`](src/components/game/gameLoop.ts)): friction を抜いた thrust 4-加速度を world frame に boost し直して上書き。alpha は表示専用 (噴射炎 / 加速度矢印 / 他者 broadcast)、物理進行には不使用
- **死亡 event 統一アルゴリズム** は (x_D, u_D, τ_0) ベース、DeathMarker / DeadShipRenderer / LH が一元駆動 (詳細: [`plans/死亡イベント.md`](plans/死亡イベント.md) + [`design/meta-principles.md §M21`](design/meta-principles.md))
- **加速度表示** はフレーム整合化済 (噴射炎 = 被観測者 rest frame proper acc、加速度矢印 = 観測者 rest frame 4-vector の時空矢印)
- **LH 光源** は観測者視点で死亡観測済なら消灯
- **射撃 UI** は silver 統一

## 既知の課題

### マルチプレイ state バグ 5 点 (全修正済 → 再発監視のみ)

5 症状すべて解決済。根因 = transient event delivery 失敗 → state 恒久 divergence、対処 = 周期 snapshot + host self-verify + stale GC。詳細 + 各 commit は [`plans/2026-04-20-multiplayer-state-bugs.md`](plans/2026-04-20-multiplayer-state-bugs.md)

### defer 中

- DESIGN.md 残存する設計臭 #2
- PeerProvider Phase 1 effect のコールバックネスト
- snapshot に `frozenWorldLines` / `debrisRecords` 同梱 — un-defer: リスポーン世界線連続観測時
- host migration の LH 時刻 anchor 見直し
- 色調をポップで明るく (方向性未定)
- スマホ横画面 (fullscreen 表示) 対応 — landscape 前提で HUD / touch UI / viewport 再配置

### パフォーマンス

- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング
- `MAX_WORLDLINE_HISTORY` 1000 → 5000 復帰 (二分探索化で余力あり)

### 低優先リスク / 未検証

- **リスポーン時に世界線が繋がる** (2026-04-14 Stage F-1 後再発): F-1 snapshot で `frozenWorldLines` 未 serialize → respawn 時 `appendWorldLine` で連結が有力
- localId PeerJS ID 衝突 (tab-hidden 復帰時)、PeerServer ネットワークエラー stack
- モバイルハイスコア (iOS Safari ホーム画面復帰時保存)

## 次にやること

### 優先 (次セッション最初に検討)

#### PBC torus 完成版 → 実機 multi-tab + deploy

中間版完遂済 (worldLine line break + Debris fold + Laser segment split、 すべて GPU shader fold + CPU segment split の組合せ)。 残るのは **実機 multi-tab 検証 + deploy** のみ。

- **実機 multi-tab 実戦テスト**: torus default で host + client 2 tab、 境界跨ぎでの worldLine が画面横切らずに line break で切れる / レーザーが反対側に届く / 死亡 routing / 攻防成立を目視確認
- **deploy** (`pnpm run deploy` + main push)
- 詳細: `plans/2026-04-27-pbc-torus.md` §「実装ステータス」 §「実機テスト未実施」

#### Step 2: 3x3 image cell 描画 (= Asteroids 風 visual wrapping)

odakin 提案の「観測者中心に世界が無限に繰り返す」 (= 3x3 マス重複表示) を独立 plan で詳細化。

- 設計議論: `plans/2026-04-27-pbc-torus.md` Appendix B (今後追記)
- 別 plan 化予定: `plans/2026-04-XX-pbc-torus-tile-N.md`
- 実装階層: InstancedMesh + offset attribute で各 D pattern renderer に展開、 timeFade に spatial fade 追加で「無限」 を遠方で自然 fade out、 innerHide の primary-only dispatch
- 中間版完成 + 実機テスト OK + deploy 後に着手 (= visual 評価が要るので odakin の判断必要)

#### 過去光円錐 ∩ 正方形枠 の交線描画 (低優先、 Step 2 で吸収予定)

円柱版 [`ArenaRenderer`](src/components/game/ArenaRenderer.tsx) の `ARENA_PAST_CONE_OPACITY` LineLoop 相当を、 [`SquareArenaRenderer`](src/components/game/SquareArenaRenderer.tsx) でも実装。 4 平面 × 円錐の交線計算が必要。 ゲームプレイには影響しない描画装飾。

**単独実装は defer**: 既存 SquareArenaRenderer の corner wrap が半開区間 `[obs±L)` を使っているため、 obs が arena 中央で境界 ±L 上にいるとき 4 corner が片側に flip して縮退する (= PBC として +L と -L は同じ点で数学的には正しいが visual に「arena が左半分にだけ存在」 する違和感)。 同じ問題が過去光円錐 sample にも伝播。 Step 2 (3x3) で arena を 9 image cell 複製描画すれば自然解消するので、 個別 fix より枠組み変更で一括解決の方が clean。 詳細: `plans/2026-04-27-pbc-torus.md` §「後続作業」

### 既存 (優先順未決定)

- **Phase A/B で実装した worldline 向き・加速度の思想・コード対称性 audit**: `phaseSpace.alpha = thrust only` 化 ([`gameLoop.ts`](src/components/game/gameLoop.ts) で上書き) は thrust 単独信号の役割を満たすが、Phase B-5 で別途 wire field 新設するか alpha のままで運用するか方針確認。具体候補: (a) component 間の「fade / gate / routing」責務配置の統一 (M21 を広域適用)、(b) Phase B-5 (他機 exhaust の pure thrust broadcast) の再設計、(c) Phase C-1 (wire format 厳格化、heading/alpha optional → required)、(d) 世界線データと描画機構の「対応関係」を DESIGN.md に書き下し

### 既存 (優先順未決定)

- **DeathMarker regression 他機側の実機確認**: 自機側は 2026-04-22 検証で再現せず closed ([`plans/2026-04-22-self-death-marker.md`](plans/2026-04-22-self-death-marker.md) §post-mortem)、他機側が同じく出なければ「最終検証」項目は閉じる。再発時は同 plan の再仕込み手順で診断。
- **Phase B-5 (他機 exhaust) 再設計**: `phaseSpace.alpha = thrust + friction` が thrust 単独信号でない → pure thrust 用 wire field 新設が必要 ([`plans/2026-04-21-phaseSpace-heading-accel.md`](plans/2026-04-21-phaseSpace-heading-accel.md))
- **Phase C-1 (wire format 厳格化)**: 混在期間確認後、受信 optional → required、shim 削除
- **本番実戦観察**: 2026-04-22 夜の 10 commit (LH past-cone 即時消失 fix / 加速度 Lorentz 整合化 / dorsal pod / 世界線 ghost / 燃料枯渇 UX / debris 世界線 dim / laser cannon glow player 色 / silver UI 統一 / 世界線 hide 上方向伸長 / LH 死亡消灯) がすべて deployed。multi-tab 実戦テストで regression / UX 確認
- **進行方向可視化 分岐 B/C**: sphere + heading-dart (案 14) / star aberration skybox (案 16)、default frame 選択 ([`EXPLORING.md §進行方向・向きの認知支援`](EXPLORING.md))
- **操作系検討**: 現状 WASD + マウス yaw + 射撃トリガーの組み合わせを見直し。キーリマップ / ゲームパッド / スマホタッチの統一感・直感性を洗い直す (具体スコープは未定、アイデア出しから)
- **レーザー砲を短く**: 現状の `SHIP_LASER_BARREL_LENGTH = 1.5` が機体比で長め (dorsal pod を hull 上面に置いた後のバランスも再確認)。barrel / lens stack / emitter の寸法統合で再デザイン
- **機体色をプレイヤー色から導く**: 現状は hull navy 固定 + dorsal pod stripe / laser cannon glow に player 色を焼く方式で識別性を補強している。hull 本体の色自体を player 色から導出する方式 (tint / blend / hue shift 等) を検討して、dorsal/cannon への依存を下げられないか再設計アイデア出し
- **エンジンノズル形状の物理整合確認**: de Laval 型 (exit 広 / throat 狭) で噴射炎が「広がり続ける」ように見えるが、実ロケットでは exhaust が背圧 / mach 整合で収束する。現状の ExhaustCone 描画 (広がる cone) が物理として自然か再検討。under-expanded / over-expanded の違いも含めて spec 化の余地
- **フルチュートリアル** (必須、初見 UX)
- 各プレイヤー固有時刻表示 / スマホ UI 残 / 用語再考 / 音楽の時間同期
- **レーザー以外の世界線 × 未来光円錐の表示**: 現 sphere 0.15 + ring 0.12 薄い
- **DeathMarker ring を (x_D0, u_D) 静止系で描画** (Stage 2): 現 C pattern 並進のみ → u_D 方向に contracted な楕円 (relativistic apparent shape)
