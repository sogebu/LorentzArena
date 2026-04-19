# SESSION.md — LorentzArena 2+1

## 現在のステータス

対戦可能。**デプロイ済み** (build `2026/04/19 18:03:14 JST`)。本番 URL: https://sogebu.github.io/LorentzArena/

2026-04-19 昼 (視覚調整、4 値): odakin とのインタラクティブ tuning で opacity / flash 4 値を再チューン。**(a) `PLAYER_WORLDLINE_OPACITY`: 0.65 → 0.4** (人間世界線を控えめに、LH 0.4 と同値になり階層フラット化)、**(b) `ARENA_PAST_CONE_OPACITY`: 1.0 → 0.5** (アリーナ円柱 × 過去光円錐交線を半分に)、**(c) `LIGHT_CONE_WIRE_OPACITY`: 0.05 → 0.02** (自機光円錐 wireframe を更に淡く)、**(d) `STARDUST_FLASH_FUTURE_BOOST`: 0.5 → 0.75** (未来光円錐通過時の星屑 flash peak を 1.5→1.75 倍、past 1.5 の 1/3 → 1/2 に引き上げ)。localhost HMR で逐次確認 → odakin OK で deploy。視覚のみの変更、挙動・テスト影響なし。

2026-04-19 昼 (LH post-hit i-frame 共通化): **灯台にも 0.5s post-hit i-frame を適用**。`selectPostHitUntil` の `if (isLighthouse(victimId)) return 0` 短絡を撤廃 (game-store.ts:507)、人間 victim と同経路で `latest hit wallTime + POST_HIT_IFRAME_MS` を返すように。`LIGHTHOUSE_HIT_DAMAGE = 0.2` で 6 発死は不変、最短殺害時間が 5 × POST_HIT_IFRAME_MS = 2.5s に固定 (集中砲火即死の理不尽さ回避が動機、2026-04-18 夜 Phase C2 前哨で「無敵時間なし」だった設計判断を覆し)。`selectInvincibleUntil` (5s respawn 無敵) は依然 LH 短絡 (-Infinity) — そちらは LH に不要。同時整理: useGameLoop.ts:516 のコメント「11 発死、無敵時間なし」を「6 発死 (定数と整合)、post-hit i-frame は人間と共通」に修正、constants.ts の LIGHTHOUSE_HIT_DAMAGE / POST_HIT_IFRAME_MS JSDoc に共通化を反映。テスト 2 本追加 (39→41 件 all green): `selectPostHitUntil(LH)` が `latest+POST_HIT_IFRAME_MS` を返す / 第 2 発を即発火しても energy + hitLog 不変。typecheck clean。localhost 確認: odakin OK。

2026-04-19 朝 (host migration 対称性整備): 旧 host 離脱時の **split election + LH 沈黙** 報告 (odakin スマホ実機) を契機に migration 全経路を再点検し 5 点修正。**Bug 1 (split election)**: 旧 host の `peerList` broadcast は connection-change 駆動で稀、その間に client の `peerOrderRef` が drift → election 候補がずれて分裂 / 死 candidate 待機。修正: ping (1s 周期) に host 視点 `peerOrder` を相乗り、client が adopt → 全 client が ≤1s 精度で同一 election base。**Bug 3 (snapshot LH owner stale)**: assumeHostRole の `setPlayers` と snapshot 発行が 1-tick 競合した場合に新 joiner が古い (死んだ) host を LH owner と見る split を防御。修正: `buildSnapshot` で LH ownerId を caller (= 現 beacon holder) に常時 rewrite。**Bug 2 (LH 沈黙窓 — 非バグ確認)**: assumeHostRole の `setAsBeaconHolder` (imperative) と `setPlayers` (zustand sync) は同一 microtask、useGameLoop は `useGameStore.getState()` 直読みで次 RAF tick に整合 → transient なし。**Drift A〜C 解消** (= 同じ migration 経路の対称性 / 設計 cleanness 整備): A) LH ownerId rewrite が assumeHostRole と RelativisticGame init effect の二重実装 → init effect の dead code 削除し assumeHostRole 単独責任化。B) 新 host の最初の ping が自分 ID を含む peerOrder を broadcast する transient → assumeHostRole 内で `peerOrderRef.current = filter(id !== newHostId)` を eager 適用。C) 新 host が migration 経路で元 client (= 既存 peer) と再接続する際 prevConnectionIdsRef diff だけでは「真の new joiner」と区別できず snapshot を再送 → `store.players.has(conn.id)` チェックで弾く (受信側 applySnapshot 防御 merge で吸収されていたが設計コメント「既存 peer は受け取らない」と矛盾していた)。snapshot.test.ts に LH ownerId rewrite テスト 1 件追加 (38→39 件 all green)。multi-tab 実機検証は odakin に依頼。詳細: design/network.md §peerOrderRef の同期 + §`roleVersion` による effect 再評価 (assumeHostRole の 6 操作バンドル)。

2026-04-18 深夜 (Phase C2 Radar): **左下レーダー**着地 (`game/hud/Radar.tsx`、Canvas 2D、180×180 PC / 140×140 mobile)。**観測者静止系・真上 orthographic** で heading-up (yaw 方向が上)。描画対象: 他機 / 灯台 / 凍結世界線 / レーザーの **過去光円錐交点** (= 今見えている時空点)、`pastLightConeIntersectionWorldLine` + `pastLightConeIntersectionLaser` を流用。World 4-event → 観測者静止系 Δr は `lorentzBoost(obsU)` + `multiplyVector4Matrix4` で変換、レーザーの進行方向は photon 4-momentum `(1, d̂)` を boost して光行差込みに (rest-frame で止まって見えるレーザーも直感的)。arena 円周は rest-frame で歪むため過去光円錐 ∩ `r_world=ARENA_RADIUS` を 64 点サンプリング描画 (薄く)。自機は中心、三角形は threeCache と同じ **黄金 gnomon** (脚:底辺=φ:1、頂角 36°) を screen px で再現、**重心を過去光円錐交点に一致**。ズーム `ARENA_RADIUS * 0.7`、背景 opaque、`zIndex: 9999` で 3D シーン上に完全上書き。**Radar は常時 ON** (切る意味が無いのでトグル削除)。**ControlPanel トグル整理**: 残り 2 個 (静止系/世界系、透視投影/正射影) を `display: grid` + `gridTemplateColumns: subgrid` で列揃え (CJK 幅問題を構造的回避)、ON 側を常に右配置、トラック muted green tint (`rgba(102,255,102,0.35)`)。設計詳細: design/rendering.md §Radar。

2026-04-18 夜 (視覚調整): **レーザー × 光円錐マーカー scale** 過去 `2 → 3` / 未来 `2 → 1.5` (過去を目立たせ、未来は控えめに)。**星屑 `STARDUST_COUNT 20000 → 40000`** (密度倍化)。**灯台を高さ ~10% (0.16) 下に沈めた** (`LIGHTHOUSE_SINK` 定数、inner group で視覚シフトのみ、past-cone 判定は anchorPos そのままで非干渉)。**`hud.dead` 撃沈 → 被撃墜** (船見立てから相対論的飛翔体見立てへ、灯台側 "撃破" との被動形対比、旧軍電文用法の "被〜" 系採用)。

2026-04-18 夜 (typecheck 13 errors 解消): Authority 解体期ドリフトで pre-existing だった型不整合を全消去 (13 → 0)。変更: (a) `PeerProvider.tsx` の `NetworkManager = PeerManager<Message> | WsRelayManager<Message>` を **export** し共有型化、(b) `useSnapshotRetry` / `useGameLoop` の local inline shape (旧 `getIsHost`/`getHostId` や `sendTo(msg: unknown)` 由来の非互換) を `NetworkManager | null` + `sendToNetwork(msg: Message)` に統一、(c) `WsRelayManager` に parity 用 `disconnectPeer` (local conns map delete + notify、server 側 membership 不変) を追加、(d) `PeerProvider` の `useRef<Timer>()` 引数なしを `useRef<Timer | undefined>(undefined)` に、beacon holder effect に `if (!myId) return` 追加、(e) `RelativisticGame.tsx` の `peerManager?.getIsBeaconHolder()` narrow 破綻を optional chaining 内直 guard 化。**挙動変化なし** (型のみ、test 38/38、build 通過、WS Relay の disconnectPeer 経路は peerjs transport 下でのみ到達)。defer 中の un-defer トリガー「typecheck を CI/build に再統合したい」の地ならし完了。

2026-04-18 夜 (UX 統一): **hit デブリ size + kick を爆発と同値に**。`HIT_DEBRIS_KICK: 0.3 → 0.8`、`generateHitParticles` size: `0.1+r*0.2 → 0.2+r*0.4` (= explosion)。設計コンセプトを「爆発の半分」→「広さ・粒は爆発と同じ、個数 + opacity だけ半分にして density 控えめ」に再定義。5 軸 (count / opacity / size / kick / max_lambda) のうち size + kick + max_lambda が explosion 同値、半分残は count (15 vs 30) と opacity (0.05/0.35 vs 0.1/0.7) のみ。**Lobby に build 表示** 追加 (`__BUILD_TIME__`、右下 11px / opacity 0.4、ControlPanel と同 pattern)。詳細: design/physics.md §被弾デブリ。

2026-04-18 夜 (build infra): **tsconfig 復元 + build/typecheck 分離**。`0a6ef36` の root 遺物削除時に `2+1/tsconfig.json` の `references` が消えた `../tsconfig.*.json` を指したまま残り、`files: []` と合わさって `tsc -b` が silent no-op になっていた。`2+1/tsconfig.{app,node}.json` を新設し references を `./` に修正、`build` を `vite build` 単独に / `typecheck = tsc -b` を別 script に分離。これにより Authority 解体期から残っていた `peerManager` / `NetworkManager` / `PeerManager` 周辺の **pre-existing 13 errors** が露呈 (deploy には影響なし、`pnpm typecheck` 実行時のみ可視)。詳細: root DESIGN.md §build と typecheck の分離。

2026-04-18 夜 (refactor): **spawn/respawn 経路統合** (`handleSpawn` action 新設、旧 `handleRespawn` + `applyRespawn` + RelativisticGame init/snapshot self-not-in-snapshot の 4 経路を一本化)。動機: 「LH 初回 spawn ring が出ない」バグ仮説 — respawn 経路は ring が出るので、unify すれば壊れた init 経路が working respawn 経路に collapse される。**実機確認済 (odakin "バッチリ")**。変更点: (a) self-spawn も `pendingSpawnEvents` 経由 (旧 immediate `spawns` 廃止、ρ=0 で next-tick 発火、視覚差は感知不能)、(b) 既存 player は color/displayName/ownerId 保持、新規は options で受け取る、(c) StrictMode dedup は呼び出し側 `players.has()` guard に移譲、(d) LH migration 経路は spawn 撃たないため別 branch で setPlayers 直更新を維持。`applyRespawn` 削除、`killRespawn.ts` は `applyKill` のみ残す。

2026-04-18 夜 (Phase C2 前哨): **灯台を 3D 塔モデル化** (`LighthouseRenderer`、procedural body/balcony/lantern/lamp/roof/spire) + **過去光円錐マーカーを完全置換** (alive LH + frozen LH の両方を SceneContent worldLineIntersections から除外、`FrozenWorldLine` に `playerId` 追加)。死亡時挙動: past cone が death event に届くまで past cone anchor 維持 → 届いた瞬間から debris と同期で過去に沈み、`deathT + DEBRIS_MAX_LAMBDA` で消失。リスポーンも spawn event が past cone に入るまで非表示。専用パラメータ: `LIGHTHOUSE_HIT_RADIUS = 0.40` (塔底面と同値)、`LIGHTHOUSE_HIT_DAMAGE = 0.2` (6 発死)、無敵時間なし (`selectPostHitUntil` が LH では常に 0)、energy 回復元から無し。`HIT_DEBRIS_MAX_LAMBDA: 1.2 → 2.5` (爆発デブリと同値)。

2026-04-18 夜: **i18n JA を全表示日本語化** (開始/自機/灯台/撃破/撃沈/射撃中/ビルド/ルーム) + **WS Relay 未配備 UI クリーンアップ** (本番 `VITE_WS_RELAY_URL` 未設定のため利用不可だった transport selector / 「WS Relay に切り替えてください」help 文言 / autoFallback 通知を非表示化、コード本体は将来 deploy 用に残置)。設計改善: `LIGHTHOUSE_DISPLAY_NAME` 定数を `lighthouse.ts` に追加し data 層 / render 層を分離、`KillNotification3D` に `victimId` 追加して `Overlays.tsx` を `isLighthouse(id)` 判定に統一 (旧: 文字列マジック `=== "Lighthouse"`)。Connect.tsx の「ルーム "..."」ハードコード解消 (EN モードでも JP が出ていた両言語破綻)。

2026-04-18 夕: **Phase C1 damage model** 着地。hit 即死 → energy pool 被弾共有 (`HIT_DAMAGE=0.5`、`energy<0` で死、2 発で死) + `POST_HIT_IFRAME_MS=500ms` post-hit i-frame (人間 + LH)、hit デブリ (scatter 中心 = 時空 4 元ベクトル和 `k^μ_null + u^μ_victim` の空間成分、**撃った人の色**)、lethal 時は hit (撃った人色) + explosion (死んだ人色) の **2 層**、`debrisRecords[]` 単一 array に `type: "explosion" | "hit"` タグで統合。詳細: design/physics.md §被弾デブリ、design/state-ui.md §Phase C1 damage。

2026-04-18 昼: Brave Shields が `navigator.sendBeacon` (Request Type=ping) を block してグローバル HS が silent drop される問題を修正 (`fetch({keepalive:true})` に切替)。Brave 実機で保存確認済。詳細: design/meta-principles.md M19。

## 完了済みリファクタ

**歴史記録**。詳細は `git log --since=<date>` / `DESIGN.md` を grep で必要時のみ調査。**個別 bullet の pointer は意図的に削除済** (session 冒頭の follow-read を抑制して autocompact 頻度を下げるため、2026-04-18 §10.7 byte budget rationale)。

**2026-04-18**:
- **Phase C1 Damage-based death**: hit 即死 → energy pool 被弾共有 (`HIT_DAMAGE=0.5`、`energy<0` で死) + `POST_HIT_IFRAME_MS=500ms` post-hit i-frame (人間 + LH、no-hitLog 実装で連続被弾 i-frame 延長封じ) + target-authoritative 維持 (`hit` メッセージに `laserDir` 追加)。非致命 hit の被弾煙: scatter 中心 = spatial(`k^μ_null + u^μ_victim`)、色 = killer。Phase C1 着地時のサイズ調整は何度かの試行錯誤を経て最終的に「個数・opacity 半分、size・kick・max_lambda 同値」に着地 (上記 2026-04-18 夜 UX 統一エントリ参照)。`debrisRecords[]` 単一 array に `type: "explosion" | "hit"` タグで renderer 型非依存に統合。test `handleDamage.test.ts` 5 シナリオ。詳細: design/physics.md §被弾デブリ、design/state-ui.md §Phase C1
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
- ~~**typecheck pre-existing 13 errors** (2026-04-18 夜 build infra で露呈)~~ → 2026-04-18 夜 解消済 (上記「現在のステータス」参照)

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
- ~~**C2 レーダー画面 (#11)**~~ → 2026-04-18 深夜 完了 (上記「現在のステータス」参照)

### 既存の積み残し (Phase 非依存)

- **世界系時の time fade 統一** (architectural、任意) — `buildDisplayMatrix` が world frame で identity を返すため time fade shader の z が絶対 world t に。修正案: world frame でも `T(-observer)` を含める → rest/world で fade 挙動統一、全 D pattern 共通の pre-existing 問題。詳細: DESIGN.md §描画「時空星屑」world frame 段落
- **進行方向可視化 分岐 A: 他機 exhaust 対応 (step 2-3)** — phaseSpace に共変 α^μ 同梱 (発信者 `Λ(u_own)` boost、受信者 `Λ(u_obs)^{-1}` で戻す)、D pattern + Lorentz 収縮 + 光行差。作業: message schema 拡張 + validation + snapshot 同梱 + ExhaustCone を `playerList.map` に広げる。**AccelerationArrow** も同様に他機展開 (入力意図は発信者の rest-frame α だけでなく heading に紐づくので設計再考)
- **進行方向可視化 分岐 B/C (今後)** — B: sphere + heading-dart ハイブリッド (案 14、rest-frame 静止でも向きが読める)、C: star aberration skybox (案 16、案 17 と独立な天体背景)。上位メタ: default frame 選択 (rest-frame vs world-frame vs 段階学習)。詳細: EXPLORING.md §進行方向・向きの認知支援
- **フルチュートリアル (必須、Phase B3 とは別)** — 初見ユーザーが操作・ゲーム概念を理解できない。B3 は hint のみ、完全 onboarding 別セッション
- 各プレイヤーに固有時刻表示 / スマホ UI 残 (レスポンシブ HUD) / 用語の再考 (EXPLORING.md) / 音楽の時間同期 (将来、EXPLORING.md)
- **レーザー以外の世界線 × 未来光円錐の表示方法** — 現状 sphere 0.15 + ring 0.12 が薄い。opacity 上げ or 別形状 (gnomon 三角形 / pulse) に昇格検討。凍結 WL と debris は対象外
