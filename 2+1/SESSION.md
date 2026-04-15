# SESSION.md — LorentzArena 2+1

## 現在のステータス

対戦可能。**`302f7da` デプロイ済み** (build `2026/04/15 10:27:08 JST`)。本番 URL: https://sogebu.github.io/LorentzArena/

完了済みリファクタ (詳細は DESIGN.md):
- **Authority 解体 Stage A〜H** (2026-04-14〜15): target-authoritative 化 + event-sourced。plan: `plans/2026-04-14-authority-dissolution.md`
- **D pattern 化** (2026-04-15): scene の物理オブジェクトを world 座標 + 頂点単位 Lorentz に統一、3+1 拡張に親和。球は例外で C pattern 維持

## 直近の作業

### 2026-04-16: Spawn 座標時刻の統一 (実装中、未デプロイ)

初回/リスポーン/新 joiner スポーンで別ロジックだった座標時刻算出を単一ルール `computeSpawnCoordTime(players) = max(p.phaseSpace.pos.t)` (全プレイヤー対象) に統一。

**修正前の不具合**:
- `snapshot.hostTime` が `me.phaseSpace.pos.t` (beacon holder 本人の t) を使用 → beacon holder が γ で座標時間遅れ / ghosting 中等のとき新 joiner が過去にスポーン
- `getRespawnCoordTime` の全員死亡時フォールバックが `Date.now()/1000 - OFFSET` で peer ごとに OFFSET が違うため非 host で壊れる (latent)

**修正内容**:
- `respawnTime.ts`: 関数名 `getRespawnCoordTime` → `computeSpawnCoordTime`。isDead フィルタ撤去、OFFSET フォールバック撤去。LH が常に alive なので「全員死亡」時も LH.t を自然に拾える
- `snapshot.ts`: `buildSnapshot.hostTime` を `computeSpawnCoordTime(s.players)` に変更
- `constants.ts` / `CLAUDE.md` / `DESIGN.md`: stale コメントと表記を更新

**未実装 (別 commit 切り出し)**:
- snapshot に `frozenWorldLines` / `debrisRecords` 未同梱 → 新 joiner で死亡世界線が見えない (既知の課題「リスポーン時世界線連続」と同じ surface)
- host migration の LH 時刻 anchor (位置飛び問題) も同じ「spawn 時刻 anchor」族だが、今回の修正では触れず

### 2026-04-15 (昼): D pattern 化 + 球の例外 + pillar 過去光円錐 anchor (完了)

build `2026/04/15 10:27:08` (commit `302f7da`) でデプロイ済み。

- **D pattern (頂点単位 Lorentz) 化**: scene の物理オブジェクトを「world 座標 geometry + `mesh.matrix = displayMatrix × T(worldPos) × [rotation]`」に統一。`DisplayFrameContext` 新設、`buildMeshMatrix` helper。Phase 1 (点), 2 (ring), 4 (cone triangle), 煙 (debris), 5 (laser batch) を移行。Phase 3 (照準矢印) は 2+1 固有のため skip。詳細は DESIGN.md § D pattern 化
- **球は C pattern 維持**: volumetric 点マーカーに per-vertex Lorentz を掛けると γ 楕円化で「点」の意味が損なわれるため。`playerSphere`、`intersectionSphere`+core、`killSphere`、`explosionParticle` は `position={[dp.x, dp.y, dp.t]}` で並進のみ
- **Spawn pillar 過去光円錐 anchor**: world-frame 静止だと観測者時間前進で過去に流れるため、`anchorT = observer.t − |Δxy|` で null cone に貼り付け。形状アニメ撤廃、opacity のみフェード
- **Pillar 軸オリエンテーション latent bug 修正**: `CylinderGeometry` default +Y → `rotation={[π/2, 0, 0]}` で +Z (時間軸) に。従来コメントが「時間軸」と主張していたが実態は空間 Y。半径 0.04 → 0.5 (直径 1)
- **メタ原則追加**: M13 (時空 anchor 選択、意味論的), M14 (球/extended の hybrid policy), M15 (HMR stale の切り分け)

**関連 commit**: `a7a728c` (Phase 1+2+4)、`fc6d7e9` (Phase 煙+5)、`f155696` (自機 identity + pillar 0.5)、`302f7da` (球全般 C 化 + pillar past cone anchor)

### 2026-04-15 (午前): Lighthouse 調整 + 交差マーカー刷新 + opacity 定数化 (完了)

build `2026/04/15 08:44:09` (commit `0dad175`) でデプロイ済み。主な変更:

- **Lighthouse**: 射撃間隔 1→2s、spawn grace 10→5s、無敵 10→5s、照準ジッタ (ガウス σ=0.3 rad, 3σ clamp)
- **レーザー × 光円錐 交点マーカー**: 球 → 光円錐の接平面に貼り付く golden gnomon 三角形。tip=laser.direction の接平面射影、重心=交点。過去/未来共通で `n=(x,y,-t)/(ρ√2)` で扱う。数学 + 代替案は DESIGN.md § 描画「レーザー × 光円錐 交点マーカー」
- **照準矢印 (トリガー中)**: 0s/0.05s/0.1s に短縮、spacing=1.2 で tip↔base 接合
- **Opacity 定数化**: `LIGHT_CONE_SURFACE_OPACITY` / `LIGHT_CONE_WIRE_OPACITY` (0.04 に減光) / `PLAYER_WORLDLINE_OPACITY` / `LIGHTHOUSE_WORLDLINE_OPACITY` / `LASER_WORLDLINE_OPACITY` を `constants.ts` に集約
- **ドキュメント整合性**: CLAUDE.md / DESIGN.md / README.md の古い値 (10秒無敵、必中 LH、0s/0.5s/1s 矢印、ハードコード opacity) を修正

**EXPLORING.md に追加**: 「進行方向・向きの認知支援」13 案。ユーザーが heading/velocity/thrust 方向の認知支援が欲しいと発言、option space を収集。SESSION.md TODO の「自機/敵機 heading 矢印」はこの枠組みの最小 1 案。

### 2026-04-15 (過去): DESIGN.md 再編 + claude-config §7 feedback (完了)

`plans/2026-04-15-design-reorg.md`。DESIGN.md を時系列→topic 別に再編、§ メタ原則新設、SUPERSEDED entry 整理。同知見を `claude-config/docs/convention-design-principles.md` §7 として feedback 済み。

## 既知の課題

### defer 中

- DESIGN.md 残存する設計臭 #2（#1 は実質解決、#3/#4 は Authority 解体で自然消滅）
- PeerProvider Phase 1 effect のコールバックネスト
- 色調をポップで明るく（方向性未定）

### パフォーマンス検討課題

- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング

### リスポーン時に世界線が繋がる（再発、2026-04-14 Stage F-1 後に報告）

- **現象**: リスポーン後、死亡前の世界線と新ライフの世界線が連続線として描画される (分離すべき)
- **最有力仮説**: F-1 snapshot 経路で `frozenWorldLines` が serialize されないため、死亡中 snapshot を受けた peer で生きた現 worldLine に「死ぬ直前までの history」が残り、respawn 時の appendWorldLine で繋がる
- **他候補**: メッセージ順序逆転、参照共有漏れ、描画層合成、host migration race (詳細分析は plans/ に必要時起票)
- **未調査**: 何 peer 構成で・どの peer 視点で出るか。host migration 直前直後に集中する示唆あり

### ホストマイグレーション時の位置飛び（Stage F-H 完了後に要確認）

- 灯台の位置が飛び、世界線が折れ線になる。旧ホストの位置も飛んでいた可能性
- 推定原因: 旧 beacon holder 切断→新昇格の間にタイムギャップが生じ、新 owner が最後の phaseSpace から再開すると座標時間の不連続で世界線にジャンプ。Stage D-3 で LH の上書き問題は修正済みだが、migration 中の phaseSpace 発信途絶による不連続は残る
- 現状: Stage F-H 完了後に再現テスト未実施。実機で要確認

### 要テスト

- グローバルリーダーボード: sendBeacon 修正後、実際にスコアが KV に保存されるか確認
- モバイルハイスコア: iOS Safari でホーム画面に戻る → スコアが保存される

### 既知のリスク（低優先）

- localId PeerJS ID 衝突（tab-hidden 復帰時）
- PeerServer ネットワークエラーでスタック（WS Relay 未設定時）

## 次にやること（Authority 解体後）

- **チュートリアル（必須）** — 初見ユーザーが操作・ゲーム概念を理解できない
- 各プレイヤーに固有時刻表示
- **自機および敵機のマーカーに向き（heading）を入れてどっち向いてるか分かりやすくする** — 現状は球なので進行方向が読めない。過去光円錐交点の三角形マーカー (`6aeeef0` / `4fa80fa`) と同じ思想で、プレイヤーマーカーにも heading 指示を付ける
- スマホ UI 残課題（レスポンシブ HUD、オンボーディング）
- 用語の再考（`EXPLORING.md` 参照）
- 音楽の時間同期（将来計画、`EXPLORING.md` 参照）

## 過去の変更

- 2026-04-14: Authority 解体 Stage A〜E 実装 + handleKill 二重キル防止ガード + sendBeacon CORS 修正（`text/plain`）+ 制約ネットワーク検証（学校ネットで Cloudflare TURN）。ハイスコア異常値の調査は再現せず、Zustand 移行過渡期の蓄積と推定
- 2026-04-13 夜: Zustand store 移行（props drilling 解消、GameLoopDeps 34→14 等）、空間スケール再半減、二重半減バグ 5 箇所修正、初回スポーン統一、座標時間同期の MAX_DELTA_TAU 撤廃、スポーン色の遅延解決。詳細は DESIGN.md 該当節
- 2026-04-13 日中: START でホスト決定、ホストマイグレーション堅牢化、リスポーン無敵、世界スケール 20→10、光円錐ワイヤーフレーム
