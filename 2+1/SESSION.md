# SESSION.md — LorentzArena 2+1

## 現在のステータス

**`e6c17cc` デプロイ済** (build `2026/04/27 15:15:46 JST`)。本番: https://sogebu.github.io/LorentzArena/

未デプロイ: 2026-04-27〜28 で **PBC torus アリーナ universal cover refactor 完遂** (= 中間版 ad hoc fold → 全 phase で image observer past-cone pattern に統一)。 思想は [`DESIGN.md` §「PBC torus...」](DESIGN.md)、 実装ログは `plans/2026-04-27-pbc-torus.md`。

主要 milestone commit (= universal cover refactor の節目、 詳細は git log):
- [`42868ad`](https://github.com/sogebu/LorentzArena/commit/42868ad): Phase A causal events 統一 (echo 発火)
- [`be5f944`](https://github.com/sogebu/LorentzArena/commit/be5f944): Phase B WorldLine + Laser image 分散
- [`8ac5e78`](https://github.com/sogebu/LorentzArena/commit/8ac5e78) / [`0898f06`](https://github.com/sogebu/LorentzArena/commit/0898f06): Phase C Debris / SquareArena image 分散
- [`dc5ec54`](https://github.com/sogebu/LorentzArena/commit/dc5ec54): **Image observer past-cone pattern 採用** (= primary intersection を 9 cells に copy する ad hoc → 各 image 独立に observer 本人の過去光円錐上で計算)
- [`d41f0d9`](https://github.com/sogebu/LorentzArena/commit/d41f0d9): **全 phase 対称化** (causal events も image observer pattern、 ad hoc 完全脱却)

維持された旧 commit: [`86ae2cf`](https://github.com/sogebu/LorentzArena/commit/86ae2cf) (光円錐 cylinder clip 解除、 torus mode 独自で universal cover とは独立)。

**実機 multi-tab 実戦テストは継続中** (= odakin の visual 確認待ち、 OK なら deploy)。

### 直近の文脈 (次セッションで意識すべき状態)

#### PBC torus アリーナ — universal cover refactor 完遂 (2026-04-28)

第 3 軸 `boundaryMode: "torus" | "open_cylinder"` (URL hash `#boundary=...` で切替、 default torus)。 LCH = ARENA_HALF_WIDTH = 20、 R = 1 → 9 image cells。

**思想と全 phase の実装 mapping は [`DESIGN.md` §「PBC torus: Universal cover image observer past-cone pattern」](DESIGN.md) に固定**。 5 行式 + 物理計算 vs 描画の意味的整合 + ad hoc 化脱却の経緯を記録。 helper は [`physics/torus.ts`](src/physics/torus.ts) (36 unit tests pass)。 LightConeRenderer のみ単一描画 (= LCH=L で球面 rim 内接、 隣接 image 重ならない)。 詳細実装ログ: [`plans/2026-04-27-pbc-torus.md`](plans/2026-04-27-pbc-torus.md)。

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

#### Universal cover refactor の残部 (Phase D 残り)

`DESIGN.md §「PBC torus: Universal cover image observer past-cone pattern」` の core abstraction に従って、 残った D pattern renderer を image observer pattern で対応:

- **DeathMarker** の 9 image 化 (= 死亡 sphere + ring を各 image cell ごとに表示)
- **HeadingMarkerRenderer** の 9 image 化 (= 自機 aim 線を各 image cell に複製。 ただし aim 線は自機固有方向情報なので primary のみが妥当という判断もあり、 visual 評価必要)
- **AntennaBeaconRenderer** (= dorsalStyle="antenna" 時の上面 antenna ビーコン) の 9 image 化
- **レーザー emission marker** (= 過去光円錐到達 marker、 LaserBatchRenderer とは別) の 9 image 化
- 全 callsite で `pastLightConeIntersectionWorldLine` の `imageObserver = obs - 2L*(obsCell + cell)` pattern を適用

これらは「補助 marker」 で影響軽微 (= 通常時は出ない or 小さい)、 visual judgment 必要なので odakin の確認後着手推奨。

#### timeFade に spatial fade 追加 (任意)

現在 `fade = r²/(r²+dt²)` (dt only) で隣接 image の vertex は dt 同じ → 同強度描画。 「無限平行世界」 が遠方で自然 fade out するには `fade = r²/(r²+dt²+s²)` で spatial 距離 s を加える必要。 ただし既存 timeFade 仕様変更で「等時刻面強調」 visual も変わるので別判断。 詳細: `plans/2026-04-27-pbc-torus.md` Appendix B §(a)

#### innerHide の dispatch 設計

現状: 隣接 image cell の自機 vertex は hide center から world 距離 ~2L で hide されない (= 9 hull が並ぶ visual)。 odakin の好みで:
- **(b-1)** hide center を 9 image array で全部 hide (= 各 image hull が hide される)
- **(b-2)** 自機 hull は primary のみ描画 (= 自機 echo を非表示)
- **(b-3)** 何もしない (= 9 hull 並ぶの許容、 「無限平行世界」 として自然)

詳細: `plans/2026-04-27-pbc-torus.md` Appendix B §(b)

#### 実機 multi-tab 実戦テスト + deploy

universal cover refactor 完遂後、 odakin の visual 評価が OK なら deploy:
- 自機を境界 (各軸 ±20) 付近に動かして、 自機本体が周囲 8 image cells に echo 表示される (worldLine 履歴 ≥ 2L 必要、 実用的には高速移動でないと echo 届かない)
- 「右で非表示 / 左で表示」 等の半開区間 flip artifact が消えてる
- 1 周回ってきた敵の spawn / kill event が echo として複数 image で trigger される
- 灯台 / 他機 hull / arena 枠 / worldLine / laser / debris すべて 9 image
- arena 色 magenta が光円錐 cyan と区別できる
- `pnpm run deploy` + main push

#### 過去光円錐 ∩ 正方形枠 の交線描画 (低優先)

円柱版 ArenaRenderer の `ARENA_PAST_CONE_OPACITY` LineLoop 相当を SquareArenaRenderer でも実装。 4 平面 × 円錐の交線計算。 各 image cell で独立 (= universal cover refactor 後は corner flip 問題消えてるので individual 実装可能になった)。 ゲームプレイ非影響、 描画装飾の completion。

#### 他セルの他機 spawn ring 不発 疑い (= 要実機確認)

odakin 観察 (2026-04-28 朝): 「他セルの他機にスポーンエフェクトが出てなくない？気のせいかな」。 firePendingSpawnEvents は image observer pattern で 9 image 全部に対応してるはずだが、 他機 (= 人間 or 灯台) の echo spawn ring が visual に出てない可能性。 確認手順:
- 他 player の死亡 → 復活 event を観察
- 自機本体の spawn echo は出る? 出るなら他機固有問題
- pendingSpawnEvent の playerId / pos が正しく登録されてるか snapshot で確認
- 他機 spawn の場合 handleSpawn が他 peer の player に対して trigger される経路を辿る
- 可能性: 他機の `spawnPos` が「自機からあまりにも遠い world coords」 で、 image observer pattern の R=1 では届かない? でも primary image (= cell (0,0)) には必ず届くはずなので、 問題が起きるとすれば echo image (= cell (±1, 0) etc) のみ
- 実機で再現確認 + console log で `firedSpawns` を確認

#### 因果律ガードの設計 (= 深く考える必要あり)

odakin 提起 (2026-04-28 朝): 「因果律ガードはどう実装するのがいいか深く考えねば」。 何を guard するか:
- (推測 1) PBC で観測者の「未来の自分の image」 が過去光円錐に入ってしまうケース? → physically この case はあり得ない (= 観測者の世界線は未来時刻に進む、 過去光円錐は過去のみ)
- (推測 2) hit detection が PBC の image cell 間で「光速超過 spatial 距離」 を許容するケース? → 最短画像距離で物理計算するので光速以下が保証されてるはずだが、 image cell 跨ぎでの worldLine vertex の dt 整合に何か漏れがあるかも
- (推測 3) network 受信 phaseSpace と worldLine の causal 整合 (= 受信側で前回 phaseSpace から ballistic 補間する際に、 PBC で「短経路」 と「実際は 1 周してきた」 の判別)
- (推測 4) その他

odakin 自身 「深く考えねば」 段階。 設計議論を別 plan or DESIGN section で整理してから着手。 universal cover image observer pattern の core abstraction との関係性も検討。

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
