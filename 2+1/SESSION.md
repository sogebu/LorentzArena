# SESSION.md — LorentzArena 2+1

## 現在のステータス

対戦可能。**`1b9e743` デプロイ済み** (build `2026/04/21 08:20:46 JST`)。本番: https://sogebu.github.io/LorentzArena/

**Stage 1 + 1.5 + 2 + 3 完成**。Stage 3 で freeze(5s) + GC(15s) = 計 20s 無通信で removePlayer する stale GC が入り、3+ peer での disconnected peer resurrection (Bug X) が解消した。audit 中に Stage 3 GC を **単独では無効化する critical bug** を発見 → `applySnapshot` の lastUpdate refresh が全 entry を対象にしており、disconnected peer の snapshot refresh で stale 時計が永久リセットされていた。修正: 既存 entry の lastUpdate は phaseSpace のみが refresh、新規 add (=store.players に無かった id) だけ初期化。段階設計は `plans/2026-04-20-multiplayer-state-bugs.md`。

## 本日 (2026-04-20〜21) の主要 entry

`f93eb37` **PeerProvider 思想対称性 refactor** (未 deploy、本番は `1b9e743` のまま): Stage 1/1.5/2/3 + audit 足し算後のコード対称性を odakin 要請で review、2 つの DRY 違反を helper 化。(1) `transferLighthouseOwnership(newOwnerId)` を抽出 — `assumeHostRole` (駆動権取得) と `performDemotion` (放出) で同一だった LH.ownerId 更新 loop を集約、対称操作がコード対称で書ける。(2) `discoverBeaconHolder({...callbacks})` を抽出 — `demoteToClient` (beacon-acquire) と Stage 2 `runProbe` で structurally 同一だった「使い捨て probe PM lifecycle」を統合、内部 `done` flag で late callback の one-shot semantics を保証。旧外部 stale guard (`probePm !== pm` 3 箇所) を helper 内部に吸収。performDemotion doc に assumeHostRole との対称操作表 markdown を追加。pure refactor、動作変化無し、typecheck + 58/58 pass。

`8add53d` **dead code 削除 + Stage 3 audit round 3 記録**: Stage 3 実装直後に 15+ candidate を系統的に深掘り検証、新規 critical bug 無しを確認。軽微な trade-off (4+ peer 遅延 joiner で ghost 収束 ~40s、pre-Stage 3 の永久残留よりは大幅改善、完全解消には `recentlyRemovedRef` plumbing 必要で defer) のみ。副産物として pre-existing dead code 発見 (`useStaleDetection.cleanupDisconnected` + `purgeDisconnected` が外部呼び出し無し) → 削除 (-20 LOC)。詳細は plan §Stage 3 audit round 3。

`1b9e743` **Stage 3 stale player GC + snapshot.ts lastUpdate refresh 条件化** (症状 4 残存分 + Bug X resurrection 対策): freeze(5s) + GC(15s) = 計 20s 無通信で removePlayer。client は star topology で他 peer 切断を検知できず、Stage 1.5 local 保護と合わせて切断 peer が永久存続する (Bug X) を解消。audit で Stage 3 を **単独で無効化する critical bug** を発見し同時修正: `applySnapshot` §163 が毎回全 entry の lastUpdate を refresh → 他 peer 保持分の snapshot で disconnected peer の stale 時計が永久リセットされていた。修正: 新規追加 (`!store.players.has(sp.id)`) のみ lastUpdate を初期化、既存 entry は phaseSpace (強い生存信号) だけが refresh。useStaleDetection に `staleFrozenAtRef` + `STALE_GC_THRESHOLD=15000` 追加、`checkStale` を `() => string[]` 化、useGameLoop 側で `removePlayer` + `cleanupPeer` を実行。drift prune で外部 ad-hoc delete との desync を self-heal。58/58 pass。

`305d779` + `13ebd64` + `235900f` + `f8a4589` **Stage 2 host self-verification probe + audit 4 件 fix** (症状 1 = host split 対策): tab-hidden 復帰の ~1s 窓で PeerServer race により両 peer が BH と信じる split-brain を能動検出・自動解消する。使い捨て `probe-*` PeerManager で `la-{roomName}` に接続 → redirect で realHostId 取得 → myId と比較、split なら `performDemotion` 共通 helper で末端処理 (redirect broadcast → clearBeaconHolder → reconnect → **LH ownership 移譲** → roleVersion bump)。主 trigger = initial probe on mount + visibilitychange→visible、副 trigger = 30s setInterval、timeout 8s で false-positive demote 回避。設計詳細 + audit で発見した 4 bug (初回 probe 欠落 / stale callback race / self-demote guard / **LH 二重駆動 catastrophic pre-existing**) の post-mortem は `plans/2026-04-20-multiplayer-state-bugs.md §Stage 2 実装記録`。Vitest 58/58 pass。

`c9503a4` + `76ba182` **Stage 1.5 peer 貢献 snapshot + audit fix**: 全 peer が 5s 周期で snapshot 送信、BH が union-merge して enriched snapshot を再配信。高頻度 (phaseSpace=star) / 低頻度 (snapshot=peer 貢献) で通信形態を分ける。`getIsBeaconHolder()` guard 1 行撤去で実現。BH 帯域 O(N) 維持、BH missed event を他 peer 観測から自動救済。深掘り audit で発見した critical bug (client 送信時の `buildSnapshot` が LH.ownerId を自分に rewrite → BH merge で LH 所有権汚染 → BH の LH AI 沈黙) を `76ba182` で fix (`isBeaconHolder` 引数追加)。58/58 pass。

`55401f4` **Stage 1 bug audit fix**: snapshot 適用で local-only player (local store にあるが snapshot に含まれない entry) が setState で捨てられる race bug を修正。`nextPlayers` に local-only entry を移植するだけで復旧。test 1 件追加、56/56 pass。

`4ef4fca` **Stage 1 周期 snapshot broadcast**: beacon holder が 5 秒ごとに全 peer へ `buildSnapshot` を送信、受信側は `applySnapshot` の isMigrationPath 分岐で **log union-merge + isDead 再導出 + scores 保持** 適用。missed respawn で isDead 貼り付きでも次 snapshot で自動救済。4 files +285/-16、Vitest 55/55。

`c49ce40` **hidden 復帰 clock drift → ballistic catchup**: `useGameLoop.ts:134` で `document.hidden` 中 `lastTimeRef` を fresh に保っていたのを止め、復帰時 first tick の大 dTau を `ballisticCatchupPhaseSpace` (thrust=0、friction のみ、STEP=0.1s sub-step) で吸収。worldLine は `freeze + 1 点 reset` で clean 切断、catchup 後の phaseSpace を network 通知。scope 外: LH AI catchup (host hidden 中 LH pause 受け入れ) / ghost 経路 (特殊)。test 5 件新規、51/51 pass。

`0066399` **症状 5 → grace period 付き peer removal**: 切断 peer 削除を `PEER_REMOVAL_GRACE_MS = 3000ms` の `setTimeout` に、再接続で `clearTimeout` キャンセル。`useStaleDetection.cleanupPeer(id)` helper 追加 (stale refs 一括 purge)、unmount cleanup 追加。副次効果として上記 hidden drift を可視化、`c49ce40` で独立解消。

`e9171c4` **症状 3 再発 → intro unicast 再送**: `RelativisticGame.tsx` で connection watcher (`prevConnectionIdsRef` diff) で新規接続 peer に unicast intro 再送、A→B/B→A 接続順序非依存に。beacon holder の broadcast forward (`registerHostRelay`) と組合せで全員が全員の displayName を保持。

`2be56b4` **症状 3 (displayName) 初版**: displayNames reactive state 昇格、ControlPanel で 4 段 fallback (players → displayNames → killLog.victimName → id.slice)、applySnapshot は local/remote merge。

`8ce595f` **症状 2 (respawn 消失)**: LH / 他機 dead branch の spawnT を `worldLine.history[0]?.pos.t` から `respawnTime.ts §getLatestSpawnT` 経由に。gap-reset (WORLDLINE_GAP_THRESHOLD_MS 超過) で `worldLine` が fresh 置換されても spawnT が jump up しない。

## 完了済みリファクタ (歴史記録、詳細は `git log` / `design/*.md` / plans/)

**2026-04-20 朝〜夕**: 自機 SelfShipRenderer (deadpan SF、D 系 asymmetric belly-turret) + ShipViewer `#viewer`、死亡 past-cone 共通化 (`pastConeDisplay` / `DeathMarker` / `OtherPlayerRenderer`)、Inner-hide shader (observer past-cone 交点 center)、Ghost 燃料制約撤去、cannon/機体 redesign + `GameLights` 共通化、Stardust ortho 対応、世界系 time fade 統一 (`buildDisplayMatrix` world frame に時間並進)、HUD/Lobby 微調整、マルチプレイバグ A/B/5 + hidden drift 解消

**2026-04-18〜19**: Phase C1 (damage-based death / energy pool / post-hit i-frame) / Phase C2 (Radar / 灯台 3D 塔モデル / 6 発死) / host migration 対称性 5 点 / opacity 再チューン / LH post-hit i-frame 共通化 / build infra (typecheck 分離 + pre-existing 13 errors 解消) / spawn/respawn 経路統合 / i18n JA / Brave Shields 対応

**2026-04-17**: ghost 物理統合、アリーナ円柱、光円錐交差 O(log N+K) + Vitest、Exhaust v0、Lorentzian time fade、時空星屑 N=40000、Temporal GC、スマホ pitch 廃止

**2026-04-13〜16**: Zustand 移行、MAX_DELTA_TAU 撤廃、D pattern 化、Spawn 座標時刻統一、Thrust energy、Authority 解体 Stage A〜H、光円錐 wireframe

## 既知の課題

### マルチプレイ state バグ 5 点

| # | 症状 | 状態 |
|---|---|---|
| 1 | host split (両 peer が自分を host と認識) | **修正済 `305d779`** (Stage 2 自動解消) |
| 2 | 他 player respawn 消失 | **修正済 `8ce595f`** |
| 3 | 撃破数リストに peer ID prefix | **修正済 `2be56b4` + `e9171c4`** |
| 4 | ghost 張り付き (missed respawn → isDead 貼り付き) | **修正済** (Stage 1 `4ef4fca` + 1.5 `c9503a4` 自動救済 + Stage 3 `1b9e743` stale GC で残存パスも解消) |
| 5 | migration & タブ復帰で相手消失 | **修正済 `0066399`** |

共通根因: **transient event delivery 失敗 = state 恒久 divergence**。reconciliation 機構が構造的に欠けていた。Stage 1 で周期 snapshot broadcast を追加 → 次 snapshot で自動再同期。Stage 2/3 (host self-verification + stale GC) は plan に段階設計。案 C (playerName primary key) は Stage 1-3 後も残存する UX 課題のみなので defer。

### defer 中

- DESIGN.md 残存する設計臭 #2
- PeerProvider Phase 1 effect のコールバックネスト
- アリーナ円柱の周期的境界条件 (トーラス化) — un-defer: 壁閉じ込め希望 / ARENA_HEIGHT > LCH
- snapshot に `frozenWorldLines` / `debrisRecords` 同梱 — un-defer: リスポーン世界線連続観測時
- host migration の LH 時刻 anchor 見直し
- 色調をポップで明るく (方向性未定)
- スマホ横画面 (fullscreen 表示) 対応 — landscape orientation 前提で HUD / touch UI / viewport を再配置。fullscreen API でアドレスバー / ホームインジケータ退避、safe-area-inset で notch 回避。現状は縦画面前提で横にすると HUD が潰れる

### パフォーマンス

- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング
- `MAX_WORLDLINE_HISTORY` 1000 → 5000 復帰 (二分探索化で余力あり)

### 低優先リスク / 未検証

- **リスポーン時に世界線が繋がる** (2026-04-14 Stage F-1 後再発): 最有力は F-1 snapshot で `frozenWorldLines` 未 serialize → respawn 時 `appendWorldLine` で連結。何 peer 視点で出るか未調査
- localId PeerJS ID 衝突 (tab-hidden 復帰時)、PeerServer ネットワークエラー stack (WS Relay 未設定時)
- モバイルハイスコア (iOS Safari ホーム画面復帰時保存)

## 次にやること

- **本番実戦観察**: Stage 1+1.5+2+3 + audit 5 bug fix deploy 済。症状 1 (host split) / 症状 4 (ghost stuck) / LH 二重駆動 / Bug X resurrection の自動解消を本番 console log / UI で確認。`[PeerProvider] Host split detected` が出たら Stage 2 が、切断 peer が 20s で UI から消えたら Stage 3 が効いている印
- **3+ peer 実機テスト**: Stage 3 の主 target は 3+ peer での切断 peer resurrection。2-peer 対戦では差が出ないので 3+ peer で実戦観察が理想
- **マルチプレイ state バグ 5 点 全解消**: symptom table の 1-5 全て修正済 marker 付き。次の state 系課題が出るまで本件は closed
- **`PeerProvider.tsx` を `peer-helpers.ts` に分割** (1,379 LOC → 1,079 LOC 予定): top-level helpers (type guards / registerHostRelay / registerPeerOrderListener / transferLighthouseOwnership / performDemotion / discoverBeaconHolder / appendToJoinRegistry) + 定数群は既に self-contained で抽出リスク低。pure refactor、動作変化無し予定
- **進行方向可視化 分岐 A**: 他機 exhaust (phaseSpace に共変 α^μ 同梱、`Λ(u_own)` boost / `Λ(u_obs)^{-1}` 戻し)、AccelerationArrow 他機展開 (要設計再考)
- **進行方向可視化 分岐 B/C**: sphere + heading-dart (案 14) / star aberration skybox (案 16)、default frame 選択。詳細: `EXPLORING.md §進行方向・向きの認知支援`
- **フルチュートリアル** (必須、初見 UX、B3 とは別)
- 各プレイヤー固有時刻表示 / スマホ UI 残 / 用語再考 / 音楽の時間同期
- **レーザー以外の世界線 × 未来光円錐の表示**: 現 sphere 0.15 + ring 0.12 薄い、opacity 上げ or gnomon/pulse 昇格
