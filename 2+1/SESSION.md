# SESSION.md — LorentzArena 2+1

## 現在のステータス

**`a70f3aa` デプロイ済** (build `2026/04/22 23:14:13 JST`)。本番: https://sogebu.github.io/LorentzArena/

未デプロイ commit 多数 (= main の更新): 2026-04-25 セッションで viewMode 3-way 化 + 操作系刷新 + jellyfish hull 追加 + LightCone one-sided + 多数の bug 修正。**実機 multi-tab 実戦テストは未完了**、deploy 前にもう一度実機テスト推奨。中途半端な状態でセッション終了。

### 直近の文脈 (次セッションで意識すべき状態)

#### 操作系 — 全 viewMode 共通の「ASDW 並進 + 矢印 aim + camera 固定」に統一
- **WASD**: camera basis (= world basis、camera 固定) の screen-relative thrust。heading 不変
- **矢印 ←/→**: heading (= aim = 砲身方向) 連続旋回 (`CAMERA_YAW_SPEED = 2.5 rad/s`)
- **矢印 ↑/↓**: camera pitch
- **camera yaw**: 常に 0 (world basis)、回転しない
- 詳細: [`gameLoop.ts:106-130`](src/components/game/gameLoop.ts), [`useGameLoop.ts:260-275`](src/hooks/useGameLoop.ts), [`SceneContent.tsx:201-203`](src/components/game/SceneContent.tsx)

#### viewMode 3-way (機体形状のみの違い、操作系は共通)
- [`game-store.ts:61`](src/stores/game-store.ts): `ViewMode = "classic" | "shooter" | "jellyfish"`
- [`ControlPanel.tsx:172-194`](src/components/game/hud/ControlPanel.tsx): 3-way `<select>` dropdown (旧 ToggleSwitch を撤去)
- **classic** ([`SelfShipRenderer`](src/components/game/SelfShipRenderer.tsx)): 六角プリズム + 4 RCS。本体 group は world basis 固定、`cannonYawGroupRef` で砲塔 (laser cannon) のみ heading 追従
- **shooter** ([`RocketShipRenderer`](src/components/game/RocketShipRenderer.tsx)): ロケット teardrop body。砲が無いので本体ごと heading 追従 (lerp tau=80ms)
- **jellyfish** ([`JellyfishShipRenderer`](src/components/game/JellyfishShipRenderer.tsx)) **新規**: 半透明 dome + Verlet rope 触手 14 質点 + 武装触手 (= 砲) のみ heading 方向。ジャパクリップ「クラゲ」を motif にした procedural 派生 (出典: [`docs/references/README.md`](../docs/references/README.md))
  - 触手は重力 (1.5)・慣性反作用 (5x)・turbulence kick (各質点に tangent 垂直方向の sin 噪声) で物理的にたなびく
  - 武装触手 = 外殻半球 + 内核 emitter (player 色 emissive 3.0 + halo 加算合成)
  - 射撃 (= Space 押下中) で武装触手末端を rope local frame `(cos45·L, 0, -sin45·L)` に kinematic 強制 → 砲身として 45° 下に展開、laser 過去光円錐方向と整合
  - `firingRef` を `SceneContent` 経由で渡す ([`SceneContent.tsx:128-135, :413-426`](src/components/game/SceneContent.tsx))

#### HeadingMarkerRenderer — 過去光円錐に変更 + 実装刷新
- 「laser は観測者の過去光円錐上を流れる」物理整合のため未来光円錐 → **過去光円錐の母線** (= -t 方向) に
- 旧 `LineSegments + 手動 BufferAttribute` (D pattern) は **WebGL Context Lost** からの restore 経路が脆弱で「途中で消える」現象が出ていた
- → `mesh + cylinder geometry` (radius 0.06) + 標準 scene graph、`depthTest=false + renderOrder=20` で常時可視
- 自機専用 (= observer = self) なので observer rest frame で「origin から direction*L」を直接配置 → D pattern 不要
- NaN guard 入りで `console.warn` フォールバック

#### LightConeRenderer — one-sided 表示
- 4 mesh (future surface/wire + past surface/wire) を異なる side 設定: future=`BackSide`、past=`FrontSide`(default)
- 同じ CCW winding でも future (apex 下→rim 上) と past (apex 上→rim 下) で normal の向きが反転するため別設定が必要
- 効果: 未来側 (上) から見下ろすと future cone は内面 cull で消え past cone は外面で見える / 過去側 (下) から見上げると逆 / 側方視点 (通常プレイ) では両方見える

#### 物理関連の修正
- **`phaseSpace.alpha` を thrust only に上書き** ([`gameLoop.ts:171-184`](src/components/game/gameLoop.ts)): 旧仕様 `thrust + friction` だと静止漂流時に矢印反転して不自然 → friction を抜いた thrust 4-加速度を world frame に boost し直して上書き。**alpha は表示専用 (噴射炎 / 加速度矢印 / 他者 broadcast)**、物理進行 (位置 / 4-velocity 更新) には不使用
- **SelfShipRenderer 噴射方向 fix** ([`SelfShipRenderer.tsx:230-247`](src/components/game/SelfShipRenderer.tsx)): 旧 classic では本体回転していたので thrust に yaw 変換が必要だったが、新仕様で本体 world basis 固定 → nozzle outward は world cardinal で固定 → yaw 変換不要、直接 dot product

#### Bug 修正集 (今セッションで surfaceした regression)
- **WASD で砲が向こう向きになる** → `newYaw: effectiveYaw` を `newYaw: yaw` に変更 ([`gameLoop.ts:188-194`](src/components/game/gameLoop.ts))
- **レーダーが回る** → HUD に渡す ref を `headingYawRef` から `cameraYawRef` (= 0 固定) に ([`RelativisticGame.tsx:313`](src/components/RelativisticGame.tsx))
- **aim 線が途中で消える** → cylinder mesh 化で context lost に強い実装に変更 (上記 HeadingMarker 節)

#### 既存の継続項目
- **死亡 event 統一アルゴリズム** は (x_D, u_D, τ_0) ベース、DeathMarker / DeadShipRenderer / LH が一元駆動 (詳細: [`plans/死亡イベント.md`](plans/死亡イベント.md) + [`design/meta-principles.md §M21`](design/meta-principles.md))
- **加速度表示** はフレーム整合化済: 噴射炎 = 被観測者 rest frame proper acc、加速度矢印 = 観測者 rest frame 4-vector の時空矢印
- **LH 光源** は観測者視点で死亡観測済なら消灯
- **射撃 UI** (「射撃中」text / aim arrow 3 本 / inset glow) は silver 統一

## 既知の課題

### マルチプレイ state バグ 5 点 (全修正済 → 再発監視のみ)

5 症状すべて解決済。根因 = transient event delivery 失敗 → state 恒久 divergence、対処 = 周期 snapshot + host self-verify + stale GC。詳細 + 各 commit は [`plans/2026-04-20-multiplayer-state-bugs.md`](plans/2026-04-20-multiplayer-state-bugs.md)

### defer 中

- DESIGN.md 残存する設計臭 #2
- PeerProvider Phase 1 effect のコールバックネスト
- アリーナ円柱の周期的境界条件 (トーラス化) — un-defer: 壁閉じ込め希望 / `ARENA_HEIGHT > LCH`
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

### 優先 (次回最初に検討)

- **実機 multi-tab 実戦テスト** (中途半端で終わった): 今セッションの大量変更 (操作系刷新 / 3 viewMode hull dispatch / jellyfish 物理触手 / past-cone heading marker / LightCone one-sided / alpha thrust-only / 噴射方向 fix / WASD newYaw fix / Radar 固定 fix) が deploy 前に **multi-tab 実戦テスト 未完了**。最低でも host + client 2 tab で 3 viewMode 切替・thrust 入力・射撃・死亡/respawn・レーザー軌跡を全て確認。新たな regression があれば session 中の修正を見直す
- **Shooter (rocket) mode の本体姿勢を classic / jellyfish と統一**: 現状 RocketShipRenderer のみ「本体ごと heading 追従」(= 砲が無いので本体で aim 表示)。新操作系の理屈では「本体 world basis 固定 + 砲塔 heading」が一貫する。Rocket に砲塔相当を追加するか、視点系を別モード化するか要検討
- **Phase A/B で実装した worldline 向き・加速度の思想・コード対称性 audit**: 今セッションで `phaseSpace.alpha = thrust only` 化 ([`gameLoop.ts`](src/components/game/gameLoop.ts) で上書き) は thrust 単独信号の役割を満たすが、Phase B-5 で別途 wire field 新設するか alpha のままで運用するか方針確認。**そろそろ思想に立ち返って対称性・クリーンさを深く追求するタイミング**。具体候補: (a) component 間の「fade / gate / routing」責務配置の統一 (M21 を広域適用)、(b) Phase B-5 (他機 exhaust の pure thrust broadcast) の再設計、(c) Phase C-1 (wire format 厳格化、heading/alpha optional → required) と整合、(d) 世界線データと描画機構の「対応関係」を DESIGN.md に書き下し

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
