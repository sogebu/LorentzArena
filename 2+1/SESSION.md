# SESSION.md — LorentzArena 2+1

## 現在のステータス

**`a70f3aa` デプロイ済** (build `2026/04/22 23:14:13 JST`)。本番: https://sogebu.github.io/LorentzArena/

未デプロイ commit (= main の更新): `8b5dfbb` (camera 矢印分離 fix) + `d52868f` (Shooter mode の RocketShipRenderer)。Deploy 前の動作確認は localhost。

### 直近の文脈 (次セッションで意識すべき状態)

- **viewMode** = `'classic' | 'shooter'` を [`game-store.ts`](src/stores/game-store.ts) に追加、HUD ControlPanel で切替 + localStorage 永続化。default は **shooter**。
  - **classic** (= 旧来 SelfShipRenderer): camera が heading 追従、機体本体が回転、WASD は機体相対 thrust、矢印キーで heading 連続旋回
  - **shooter** (= RocketShipRenderer): camera と機体姿勢が独立。矢印キーで camera yaw offset、WASD は camera basis での screen-relative 入力で heading 即時設定 + thrust。機体 nose は heading に lerp 追従回転 (tau=80ms)
- **HeadingMarkerRenderer** = 自機の進行方向を未来光円錐の母線 (null geodesic) として時空に貼って描画 (silver、半透明)。Shooter では更に lerp 追従。
- **死亡 event 統一アルゴリズム** は (x_D, u_D, τ_0) ベース、DeathMarker / DeadShipRenderer / LH (2026-04-22 夜に LighthouseRenderer を `aliveIntersection == null` gate に純化) が一元駆動。設計: [`plans/死亡イベント.md`](plans/死亡イベント.md) + [`design/meta-principles.md §M21`](design/meta-principles.md)
- **PhaseSpace 拡張** は `(pos, u, heading, alpha)` で past-cone 交点で heading slerp + alpha 線形補間。Phase B-5 (他機 exhaust の pure thrust broadcast 用 wire field) 未着手 — `phaseSpace.alpha = thrust + friction` が thrust 単独信号ではない問題が残る
- **加速度表示** は 2026-04-22 夜にフレーム整合化: 噴射炎 = 被観測者 rest frame proper acc、加速度矢印 = 観測者 rest frame 4-vector の時空矢印 (`observerBoost · α_world`)
- **player 識別色** は laser cannon glow + dorsal pod stripe で hull navy の識別弱さを補強。default `dorsalStyle = "pod"`、`AntennaBeaconRenderer` (案 A) は ShipViewer dropdown でのみ切替可
- **LH 光源** は観測者視点で死亡観測済 (= `pastLightConeIntersectionWorldLine` null) なら消灯。`GameLights.positions` は必須 (暗黙 fallback `DEFAULT_POSITIONS` 撤去)
- **射撃 UI** (「射撃中」text / aim arrow 3 本 / inset glow) は `LASER_PAST_CONE_MARKER_COLOR` の silver に統一

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

- **Shooter mode 用 3 機目の機体 design**: 現状 2 機 (`SelfShipRenderer` 六角プリズム = classic / `RocketShipRenderer` ぽっちゃりロケット = shooter) を `viewMode` で dispatch する構造ができている。3 機目を追加したいが、procedural 三面図 (rocket バリエーション、jellyfish 案 A) はどれも「グッと来ない」と却下、CC0/CC-BY 3D 素材も「気持ち悪い / 重い (54.6k tris) / license 不明」で行き詰まり。**次セッションは odakin が Sketchfab / Poly Pizza を直接ブラウズして visual で選ぶか、別モチーフ (paper-craft / crystal / mushroom UFO / etc) に切り替え**。design 議論ログ: 2026-04-25 セッション末尾。component を増やすときは `RocketShipRenderer` をベースにコピー → JSX 差し替え (構造的に独立させる方針が確立済)。
- **視点・操作系の再設計** (実装済): camera/control mode を viewMode 単一に集約 (旧 plan の 2 軸 4 通りは shooter 一本に統合、classic は legacy mode として残置)。実装済 commit `d52868f` + `8b5dfbb`。default は shooter で localStorage 永続化、ControlPanel で切替。当初 plan: [`plans/2026-04-25-viewpoint-controls.md`](plans/2026-04-25-viewpoint-controls.md) (4 stage 計画 → 結果として stage 1-4 ほぼ統合実装、shooter 一本化で完了)。Heading 線も実装済。
- **Phase A/B で実装した worldline 向き・加速度の思想・コード対称性 audit**: `PhaseSpace = (pos, u, heading, alpha)` 拡張 + past-cone 交点補間 (A-4) + SelfShipRenderer heading source 切替 (B-2) 以降、bug が散見 (DeathMarker regression / 3D モデル消失 / etc)。**そろそろ思想に立ち返って対称性・クリーンさを深く追求するタイミング**。具体候補: (a) component 間の「fade / gate / routing」責務配置の統一 (M21 を広域適用、2026-04-22 夜の LighthouseRenderer τ_0 簡素化と GameLights API 二重意味性解消はこの方向の先行)、(b) Phase B-5 (他機 exhaust の pure thrust broadcast) の再設計、(c) Phase C-1 (wire format 厳格化、heading/alpha optional → required) と整合、(d) 世界線データと描画機構の「対応関係」を DESIGN.md に書き下し。plan 化検討: `plans/2026-04-22-symmetry-audit.md` など

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
