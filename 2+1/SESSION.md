# SESSION.md — LorentzArena 2+1

## 現在のステータス

**`e6c17cc` デプロイ済** (build `2026/04/27 15:15:46 JST`)。本番: https://sogebu.github.io/LorentzArena/

未デプロイ commit (= main の更新): 2026-04-27 後半で **PBC torus アリーナ** 導入 (boundaryMode 切替軸 + 正方形枠 SquareArenaRenderer + 距離計算 5 箇所の最短画像化 + WorldLineRenderer の observer 中心 wrap)。 デフォルト = `torus` (= 周期的境界条件)、 円柱は `#boundary=open_cylinder` でオプション保持。 **実機 multi-tab 実戦テストは未完了**。 また worldLine の wrap 跨ぎ瞬間の line break (= 「世界線が画面横切らない」) と DebrisRenderer の wrap は **中間版で未実装**、 後続作業として残っている。

### 直近の文脈 (次セッションで意識すべき状態)

#### PBC torus アリーナ (2026-04-27 後半) — 中間版

第 3 軸の `boundaryMode: "torus" | "open_cylinder"` を controlScheme / viewMode と直交軸として追加。 デフォルト torus = PBC、 切替は URL hash `#boundary=open_cylinder`。 LS 永続化、 UI dropdown は撤去。

**設計の核** (詳細: `plans/2026-04-27-pbc-torus.md`):
- `phaseSpace.pos` / `worldLine` 各点は **unwrapped 連続値** を source of truth に維持。 wrap は描画と距離計算に閉じ込める
- 距離計算: `pastLightConeIntersectionWorldLine` / `findLaserHitPosition` / `processHitDetection` / `processLighthouseAI` / `checkCausalFreeze` / `computeInterceptDirection` / `Radar` で観測者を worldLine 最新点と同 image cell に shift してから連続値計算 (worldLine.ts は無変更)
- 描画: `transformEventForDisplay` に optional `torusHalfWidth` 引数で観測者中心の primary cell `[obs±L]²` に最短画像で折り畳む (= Asteroids 風 visual wrapping)
- WorldLineRenderer の TubeGeometry vertex も観測者の cell index で wrap (cell 内動きは displayMatrix で吸収、 cell 変化時のみ再生成)
- ArenaRenderer は boundaryMode で `SquareArenaRenderer` (4 corner 縦エッジ + 上下 rim) と `CylinderArenaRenderer` (旧) に dispatch

**主要ヘルパ** ([`physics/torus.ts`](src/physics/torus.ts)):
- `minImageDelta1D(d, L)` / `minImageDelta4(a, b, L)`: 最短画像 delta
- `imageCell(p, obs, L)`: floor based の cell index (境界跨ぎでの flicker 安定)
- `displayPos(p, obs, L)`: observer 中心 primary cell に折り畳み
- `isWrapCrossing(p0, p1, obs, L)`: 隣接 worldLine 点の wrap 跨ぎ判定 (raw Δ defensive + cell 比較 primary、 OR 結合で漏れなし)
- `subVector4Torus(a, b, halfW?)`: optional torus 化された subVector4
- `shiftObserverToReferenceImage(obs, ref, halfW?)`: 観測者を reference と同 cell に shift (worldLine.ts 不変で PBC 対応する核 helper)
- 単体テスト 26 ケース pass ([`physics/torus.test.ts`](src/physics/torus.test.ts))

**未実装の後続作業 (= 中間版の制約)**:
- **worldLine 描画の wrap 跨ぎ line break**: 1 本の TubeGeometry を複数 segment に分割して、 観測者の image cell が変わる隣接 vertex 間で線分を切る。 現状はジャンプ点で TubeGeometry が斜めに横切る描画 (= 「世界線が画面横切らない」要件未達)
- **DebrisRenderer の observer 中心 wrap**: debris segment vertex を observer 中心 primary cell に折り畳み。 寿命短いので影響限定的だが完成度のため要対応
- **レーザー軌跡の primary cell 境界クリッピング**: 計画書 (b) 案、 Liang-Barsky 風で emission → tip を 2 segment に分割
- **過去光円錐 ∩ 正方形枠 の交線描画**: 円柱版の `ARENA_PAST_CONE_OPACITY` 相当、 4 平面 × 円錐の交線計算が要

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

### 優先 (次セッション最初に検討)

#### PBC torus 中間版の完成 ← ★ いま 2f7f9ce push 済の続き

`plans/2026-04-27-pbc-torus.md` の §「実装ステータス (2026-04-27)」を最初に読む。 中間版で動作する `boundary=torus` (= default) の **未実装の後続作業** が以下:

1. **worldLine 描画の wrap 跨ぎ line break** (= 「世界線が画面横切らない」要件未達、 odakin の core requirement):
   - 現状 [`WorldLineRenderer.tsx`](src/components/game/WorldLineRenderer.tsx) は TubeGeometry 1 本に全 vertex を込めて、 wrap 跨ぎ瞬間の隣接 vertex で斜めに横切る描画
   - 対応案: `physics/torus.ts:isWrapCrossing` で wrap 跨ぎ点を検出 → worldLine.history を「複数 segment 配列」に分割 → 各 segment に独立な TubeGeometry を生成 → 複数 `<mesh>` で render
   - cell 内の通常 1 segment、 wrap 跨ぎ瞬間に segment が増える (~1 個/秒程度)
   - 課題: TubeGeometry 複数生成のコスト、 inner hide shader uniform の per-segment 共有、 timeFade shader 同様
   - 設計議論は `plans/2026-04-27-pbc-torus.md` §「(3) 「世界線が画面を横切らない」」と Appendix A
2. **DebrisRenderer の observer 中心 wrap**:
   - 現状 [`DebrisRenderer.tsx`](src/components/game/DebrisRenderer.tsx) の各 segment vertex (sx, sy, st) → (ex, ey, et) は world coords のまま。 observer が境界跨いで遠ざかると debris が画面外に置き去り
   - 対応: writeInstanced で各 segment の (sx, sy) / (ex, ey) を観測者中心 minImage で folding。 `markerElements` の transformEventForDisplay は既に torus 化済 (Phase 3 で対応済)
   - 寿命短い (DEBRIS_MAX_LAMBDA ~1-2s) ので影響は limited だが、 死亡瞬間に境界近くで爆発した場合 visual 違和感あり
3. **レーザー軌跡の primary cell 境界クリッピング**:
   - 現状 [`LaserRenderer`](src/components/game/) (or 同等) の laser 直線描画は 1 segment、 emission → tip の直線で境界跨ぐと画面横切り
   - 対応案 (b): emission と tip を観測者中心 wrap、 |displayΔ| > L で 2 segment に分割。 Liang-Barsky 風 (= 直線 ∩ box の clipping)
   - 実装 ~30-50 行 / レーザー軌跡 renderer を確認して着手
4. **過去光円錐 ∩ 正方形枠 の交線描画**:
   - 円柱版 [`ArenaRenderer`](src/components/game/ArenaRenderer.tsx) の `ARENA_PAST_CONE_OPACITY` LineLoop 相当を、 [`SquareArenaRenderer`](src/components/game/SquareArenaRenderer.tsx) でも実装。 4 平面 × 円錐の交線計算が必要
   - 優先度低 (= 描画 nice-to-have、 ゲームプレイには影響しない)

#### PBC 中間版が完成したら → 実機 multi-tab + deploy

- **実機 multi-tab 実戦テスト**: torus default で host + client 2 tab、 境界跨ぎでの攻防成立 / レーダー / 死亡 routing を確認
- **deploy** (`pnpm run deploy` + main push)

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
