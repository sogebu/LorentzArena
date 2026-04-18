# SESSION.md — LorentzArena 2+1

## 現在のステータス

対戦可能。**`537a1f4` デプロイ済み** (build `2026/04/18 14:11:06 JST`)。本番 URL: https://sogebu.github.io/LorentzArena/

## 完了済みリファクタ

各項目の判断根拠は DESIGN.md の対応節を参照。

**2026-04-18 (Phase A — 13-item UX パッケージ前半)**:
- A1: タブ離席 stale input 解消 (useKeyboardInput / touchInput で visibilitychange/blur/pagehide reset、useGameLoop で dt > 0.2s skip ガード)。残留していた「タブ復帰後も加速継続」を根絶 — SESSION.md 既知課題「モバイル: 指離しても加速継続」も合わせて解消
- A2: Exhaust 視認性改善 (1.6→1.2 長 / 0.3→0.22 radius、radius を smoothed magnitude 連動) + flat 2D AccelerationArrow 新設 (ShapeGeometry で xy 平面上の矢印、任意視点で「矢印」として常に認識可能、DoubleSide、amber)。入力意図と反推力噴射を視覚分離 — ユーザー要望 #1 #2 #3 #4
- A3: 接続設定 auto-minimize を isTouchDevice gate、PC は常時展開 — ユーザー要望 #8
- A4: 光円錐色をプレイヤー色依存 → LIGHT_CONE_COLOR (hsl(200,35%,85%)) 固定 — ユーザー要望 #9
- plan file: `/Users/odakin/.claude/plans/refactored-sparking-quill.md` に Phase A/B/C 全 13 項目分の判断根拠・ファイル一覧・エッジケース保存 (damage model edge-case matrix 含む)

**2026-04-18 (Phase A 以前)**:
- migration 堅牢化 (owner respawn tick poll / isMigrating 固着 fix + derived 化 / snapshot pull retry / worldLine gap 500ms 凍結 / alone 時 solo 昇格 + roleVersion bump) — DESIGN.md § State 管理
- アリーナ半幅下限ガード `max(ρ, H)` + 過去光円錐交線 pastCone 独立 attribute 描画 — DESIGN.md §描画「アリーナ円柱」
- DESIGN.md §7 retroactive reorg (1627 → 1303 行、-19.9%) — plans/2026-04-18-design-reorg.md

**2026-04-17**:
- ghost 物理統合 + `computeSpawnCoordTime(players, excludeId)` で ghost thrust 自由化と respawn 対称化 — DESIGN.md §物理「スポーン座標時刻」
- アリーナ円柱 (world-frame 静止、半径 20 中心 (5,5)) + 観測者因果コーン切り出し (`observer.t ± ρ(θ)`) — DESIGN.md §描画「アリーナ円柱」
- worldLine 光円錐交差を二分探索で O(log N+K=16) 化、Vitest 導入 + linear reference と 11 本 regression test — DESIGN.md §描画「worldLine.history サイズ」
- Exhaust v0 (自機 C pattern、2 層 cone 青白プラズマ additive + EMA smoothing、他機対応は step 2-3 で D pattern 昇格) — DESIGN.md §描画「Exhaust」
- 時間的距離 opacity fade (Lorentzian `r²/(r²+Δt²)`, `r = TIME_FADE_SCALE = LCH = 20`)、per-vertex shader、全 D pattern material に `onBeforeCompile` inject — DESIGN.md §描画「時間的距離 opacity fade」
- 時空星屑 (案 17、N=20000 の 4D event world-frame 事前生成 + periodic boundary)、time fade shader が PointsMaterial 対応 — DESIGN.md §描画「時空星屑」
- Temporal GC (laser / frozen WL / debris が `5 × LCH` 以上過去で削除) + spawn effect `depthWrite={false}` 修正 — DESIGN.md §描画
- スマホ pitch 廃止 (ghost 物理統合後の thrust 衝突解消、pitch は PC 矢印キーのみ)

**2026-04-16**: Spawn 座標時刻統一 (`computeSpawnCoordTime`)、Thrust energy mechanic (9s フル tank、fire と同一プール、FUEL 警告) — DESIGN.md §物理

**2026-04-15**: D pattern 化 (world 座標 + 頂点単位 Lorentz、球は C pattern 維持)、spawn pillar 過去光円錐 anchor、Lighthouse 調整、レーザー×光円錐交点の接平面三角形、M13/M14/M15 — DESIGN.md §描画「D pattern」

**2026-04-14**: Authority 解体 Stage A〜H (target-authoritative + event-sourced) — plans/2026-04-14-authority-dissolution.md

**2026-04-13**: Zustand store 移行、座標時間同期 MAX_DELTA_TAU 撤廃、世界スケール 20→10、光円錐 wireframe

## 既知の課題

### defer 中

- DESIGN.md 残存する設計臭 #2 (#1/#3/#4 は自然解消)
- PeerProvider Phase 1 effect のコールバックネスト
- 色調をポップで明るく (方向性未定)
- **アリーナ円柱の周期的境界条件 (トーラス化)**: un-defer トリガー = 壁閉じ込め物理希望 / トーラス体験向上検証 / ARENA_HEIGHT を LCH より広くしたくなった場合
- **snapshot に frozenWorldLines / debrisRecords 同梱**: un-defer = リスポーン世界線連続観測時
- **host migration の LH 時刻 anchor 見直し**: spawn 座標時刻統一と同じ族、現状定着待ち

### パフォーマンス残課題

- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング
- `MAX_WORLDLINE_HISTORY` 1000 → 5000 復帰 (二分探索化で余力あり、別 commit)

### リスポーン時に世界線が繋がる (2026-04-14 Stage F-1 後に再発報告)

現象: リスポーン後、死亡前 WL と新ライフが連続線描画。最有力仮説は F-1 snapshot 経路で `frozenWorldLines` 未 serialize → 死亡中 snapshot 受信 peer で 生きた WL に history 残存 → respawn 時 appendWorldLine で連結。他候補: 順序逆転・参照共有漏れ・描画層合成・host migration race。何 peer 構成 / どの peer 視点で出るかが未調査、migration 直前直後に集中する示唆あり

### ~~モバイル: 指離しても加速継続 (2026-04-17 報告)~~ → 2026-04-18 A1 で解消済

`touchInput.ts` に visibilitychange / blur / pagehide listener を追加し `touchRef / state.thrust` を強制 reset。経路そのもの (iOS Safari で handleTouchEnd/touchcancel が未発火) は未解明だが、タブ遷移 / app 復帰の各段階で確実に reset されるようにして実体として解消。

### 要テスト

- グローバルリーダーボード sendBeacon 保存確認
- モバイルハイスコア (iOS Safari ホーム画面復帰時保存)

### 既知のリスク (低)

- localId PeerJS ID 衝突 (tab-hidden 復帰時)、PeerServer ネットワークエラーでスタック (WS Relay 未設定時)

## 次にやること

### Phase B (13-item UX パッケージ中盤、別セッション)

全項目の判断根拠・ファイル一覧は plan file: `/Users/odakin/.claude/plans/refactored-sparking-quill.md`

- **B1 光円錐を円柱境界まで延伸 (#6)** — 各方位角 θ でアリーナ円柱との交点 `ρ(θ)` まで延伸。固定 `ConeGeometry` を廃棄し BufferGeometry で毎 frame in-place update (M17)。過去/未来光円錐とも適用、観測者がアリーナ外の場合は θ 範囲を限定 (判別式 < 0 で skip)。Vitest で ρ(θ) regression
- **B2 LH + 星屑色の再設計 (#10)** — 現状 LH `hsl(220,70%,75%)` と 星屑 `hsl(42,55%,80%)` がユーザー体感で識別困難。A 案: LH を teal/cyan (`hsl(190,65%,60%)`) + 星屑を rose-pink (`hsl(330,55%,80%)`)、B 案: 星屑をさらに高彩度 amber。開始時に A/B スクリーンショット比較後決定
- **B3 ダブルタップ+長押し hint + 3秒 mobile tutorial overlay (#5 部分)** — i18n のダブルタップ表記を "ダブルタップ → そのまま指を離さずホールドで連射" に修正、初回起動のみ 3秒半透明 overlay (localStorage flag `la-tutorial-shown` で gate、mobile のみ)。フルチュートリアルは別セッション
- **B4 ハイスコア重複バグ (#12)** — `turn-worker/src/index.ts:120-156` の `handlePostLeaderboard` に dedup なしで重複 entry 生成。修正: (a) server 側で同 name の 10秒以内 submit を idempotent 化、(b) client で `crypto.randomUUID()` sessionId 付与 localStorage 固定で (name, sessionId) replace、(c) `useHighScoreSaver.ts` に visibilitychange 追加 (pagehide と併用、iOS Safari 対策)

### Phase C (別セッション、C1 と C2 独立)

- **C1 Damage-based death (#7)** — hit=即死 → hit で energy -0.5 (ENERGY_MAX の半分)、energy<0 で死。C1 着手時に AskUserQuestion で 5 決定確認: (1) 既存 energy pool 共有 vs 独立 HP (推奨: 共有 (a))、(2) 他機 energy 同期 (推奨: しない (x)、被弾パルス cue のみ)、(3) LH も energy (推奨: (p) LH にも 1.0 プール、2発で死)、(4) 500ms post-hit i-frame (推奨: 導入)、(5) self-hit skip (推奨: `laser.playerId !== victimId`)。全エッジケース 17 件分析済 (plan file §C1 edge case matrix)
- **C2 レーダー画面 (#11)** — 画面隅に top-down orthographic mini-view、過去光円錐上の event のみ 2D 散布図。既存 `pastConeIntersectionSegment` / `findLatestIndexAtOrBeforeTime` 流用、Canvas or 独立 Three.js scene、180×180 (PC) / 140×140 (mobile)、ControlPanel で toggle

### 既存の積み残し (Phase 非依存)

- **世界系時の time fade 統一** (architectural、任意) — `buildDisplayMatrix` が world frame で identity を返すため time fade shader の z が絶対 world t に。修正案: world frame でも `T(-observer)` を含める → rest/world で fade 挙動統一、全 D pattern 共通の pre-existing 問題。詳細: DESIGN.md §描画「時空星屑」world frame 段落
- **進行方向可視化 分岐 A: 他機 exhaust 対応 (step 2-3)** — phaseSpace に共変 α^μ 同梱 (発信者 `Λ(u_own)` boost、受信者 `Λ(u_obs)^{-1}` で戻す)、D pattern + Lorentz 収縮 + 光行差。作業: message schema 拡張 + validation + snapshot 同梱 + ExhaustCone を `playerList.map` に広げる。**AccelerationArrow** も同様に他機展開 (入力意図は発信者の rest-frame α だけでなく heading に紐づくので設計再考)
- **進行方向可視化 分岐 B/C (今後)** — B: sphere + heading-dart ハイブリッド (案 14、rest-frame 静止でも向きが読める)、C: star aberration skybox (案 16、案 17 と独立な天体背景)。上位メタ: default frame 選択 (rest-frame vs world-frame vs 段階学習)。詳細: EXPLORING.md §進行方向・向きの認知支援
- **フルチュートリアル (必須、Phase B3 とは別)** — 初見ユーザーが操作・ゲーム概念を理解できない。B3 は hint のみ、完全 onboarding 別セッション
- 各プレイヤーに固有時刻表示 / スマホ UI 残 (レスポンシブ HUD) / 用語の再考 (EXPLORING.md) / 音楽の時間同期 (将来、EXPLORING.md)
- **レーザー以外の世界線 × 未来光円錐の表示方法** — 現状 sphere 0.15 + ring 0.12 が薄い。opacity 上げ or 別形状 (gnomon 三角形 / pulse) に昇格検討。凍結 WL と debris は対象外
