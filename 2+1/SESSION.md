# SESSION.md — LorentzArena 2+1

## 現在のステータス

対戦可能。**`0028cef` デプロイ済み** (build `2026/04/18 17:31:38 JST`)。本番 URL: https://sogebu.github.io/LorentzArena/

2026-04-18 夕: **Phase C1 damage model** 着地。hit 即死 → energy pool 被弾共有 (`HIT_DAMAGE=0.5`、`energy<0` で死、2 発で死) + `POST_HIT_IFRAME_MS=500ms` post-hit i-frame (人間 + LH)、非致命 hit の被弾煙 (scatter 中心 = 時空 4 元ベクトル和 `k^μ_null + u^μ_victim` の空間成分)、`debrisRecords[]` 単一 array に `type: "explosion" | "hit"` タグで統合。詳細: design/physics.md §被弾デブリ、design/state-ui.md §Phase C1 damage。

2026-04-18 昼: Brave Shields が `navigator.sendBeacon` (Request Type=ping) を block してグローバル HS が silent drop される問題を修正 (`fetch({keepalive:true})` に切替)。Brave 実機で保存確認済。詳細: design/meta-principles.md M19。

## 完了済みリファクタ

**歴史記録**。詳細は `git log --since=<date>` / `DESIGN.md` を grep で必要時のみ調査。**個別 bullet の pointer は意図的に削除済** (session 冒頭の follow-read を抑制して autocompact 頻度を下げるため、2026-04-18 §10.7 byte budget rationale)。

**2026-04-18**:
- **Phase C1 Damage-based death**: hit 即死 → energy pool 被弾共有 (`HIT_DAMAGE=0.5`、`energy<0` で死) + `POST_HIT_IFRAME_MS=500ms` post-hit i-frame (人間 + LH、no-hitLog 実装で連続被弾 i-frame 延長封じ) + target-authoritative 維持 (`hit` メッセージに `laserDir` 追加)。非致命 hit の被弾煙 (個数 15、kick 0.3、色・size は爆発と同値)、scatter 中心 = spatial(`k^μ_null + u^μ_victim`)、`debrisRecords[]` 単一 array に `type: "explosion" | "hit"` タグで renderer 型非依存に統合。test `handleDamage.test.ts` 5 シナリオ。詳細: design/physics.md §被弾デブリ、design/state-ui.md §Phase C1
- Phase B (B1-B4): 光円錐の円柱境界延伸 + LH/星屑 色再設計 (teal/cyan + rose-pink) + モバイル初回チュートリアル (`TutorialOverlay.tsx`) + ハイスコア重複保存解消 (sessionId)
- Phase A (A1-A4): タブ離席 stale input 解消、Exhaust + AccelerationArrow 視認性改善、接続設定 mobile auto-minimize、光円錐色固定 (`LIGHT_CONE_COLOR`)
- Phase A 以前: migration 堅牢化 (owner respawn tick poll / isMigrating 固着 fix + derived 化 / snapshot pull retry / WL gap 500ms 凍結 / alone 時 solo 昇格 + roleVersion bump)、アリーナ半幅下限ガード `max(ρ, H)` + pastCone 独立 attribute、DESIGN.md §7 retroactive reorg (1627→1303)
- Phase A plan file (local): `~/.claude/plans/refactored-sparking-quill.md` (damage model 17 エッジケース matrix 含む)

**2026-04-17**: ghost 物理統合 + respawn 対称化 (`computeSpawnCoordTime` excludeId)、アリーナ円柱 (世界系静止、観測者因果コーン切り出し)、光円錐交差 O(log N+K) 化 + Vitest 導入、Exhaust v0 (C pattern)、時間的距離 opacity fade (per-vertex Lorentzian shader)、時空星屑 (N=20000 4D event + periodic boundary)、Temporal GC (5×LCH 過去で削除)、スマホ pitch 廃止

**2026-04-16**: Spawn 座標時刻統一、Thrust energy mechanic (fire と pool 共有、9s フル tank)

**2026-04-15**: D pattern 化 (world 座標 + 頂点単位 Lorentz、球は C pattern 例外)、spawn pillar 過去光円錐 anchor、Lighthouse 調整、レーザー×光円錐交点の接平面三角形、M13/M14/M15

**2026-04-14**: Authority 解体 Stage A〜H (target-authoritative + event-sourced、plan: `plans/2026-04-14-authority-dissolution.md`)

**2026-04-13**: Zustand 移行、座標時間同期 MAX_DELTA_TAU 撤廃、世界スケール 20→10、光円錐 wireframe

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

- モバイルハイスコア (iOS Safari ホーム画面復帰時保存)

### 既知のリスク (低)

- localId PeerJS ID 衝突 (tab-hidden 復帰時)、PeerServer ネットワークエラーでスタック (WS Relay 未設定時)

## 次にやること

### Phase C (別セッション)

- ~~**C1 Damage-based death (#7)**~~ → 2026-04-18 完了 (上記「完了済みリファクタ」参照)
- **C2 レーダー画面 (#11)** — 画面隅に top-down orthographic mini-view、過去光円錐上の event のみ 2D 散布図。既存 `pastConeIntersectionSegment` / `findLatestIndexAtOrBeforeTime` 流用、Canvas or 独立 Three.js scene、180×180 (PC) / 140×140 (mobile)、ControlPanel で toggle

### 既存の積み残し (Phase 非依存)

- **世界系時の time fade 統一** (architectural、任意) — `buildDisplayMatrix` が world frame で identity を返すため time fade shader の z が絶対 world t に。修正案: world frame でも `T(-observer)` を含める → rest/world で fade 挙動統一、全 D pattern 共通の pre-existing 問題。詳細: DESIGN.md §描画「時空星屑」world frame 段落
- **進行方向可視化 分岐 A: 他機 exhaust 対応 (step 2-3)** — phaseSpace に共変 α^μ 同梱 (発信者 `Λ(u_own)` boost、受信者 `Λ(u_obs)^{-1}` で戻す)、D pattern + Lorentz 収縮 + 光行差。作業: message schema 拡張 + validation + snapshot 同梱 + ExhaustCone を `playerList.map` に広げる。**AccelerationArrow** も同様に他機展開 (入力意図は発信者の rest-frame α だけでなく heading に紐づくので設計再考)
- **進行方向可視化 分岐 B/C (今後)** — B: sphere + heading-dart ハイブリッド (案 14、rest-frame 静止でも向きが読める)、C: star aberration skybox (案 16、案 17 と独立な天体背景)。上位メタ: default frame 選択 (rest-frame vs world-frame vs 段階学習)。詳細: EXPLORING.md §進行方向・向きの認知支援
- **フルチュートリアル (必須、Phase B3 とは別)** — 初見ユーザーが操作・ゲーム概念を理解できない。B3 は hint のみ、完全 onboarding 別セッション
- 各プレイヤーに固有時刻表示 / スマホ UI 残 (レスポンシブ HUD) / 用語の再考 (EXPLORING.md) / 音楽の時間同期 (将来、EXPLORING.md)
- **レーザー以外の世界線 × 未来光円錐の表示方法** — 現状 sphere 0.15 + ring 0.12 が薄い。opacity 上げ or 別形状 (gnomon 三角形 / pulse) に昇格検討。凍結 WL と debris は対象外
