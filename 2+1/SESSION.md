# SESSION.md — LorentzArena 2+1

## 現在のステータス

**`33be004` デプロイ済** (build `2026/04/22 19:33:27 JST`)。本番: https://sogebu.github.io/LorentzArena/

### 最近の進捗 (2026-04-22)

- **死亡 event 統一アルゴリズム** (`8c019e3` + `bbae2b7` + self-gate refactor `8098032`): (x_D, u_D, τ_0) で DeathMarker / DeadShipRenderer / LH を一元駆動、SceneContent の τ_0 routing を廃止し各 renderer が内部で null 返却。設計: [`plans/死亡イベント.md`](plans/死亡イベント.md) + [`design/meta-principles.md §M21`](design/meta-principles.md)
- **apparent-shape M pattern** (`f0e6627`): 底面 O 静止系時間軸に垂直 + 塔軸 `L(uO)·L(−uA)·z`、LH/ship 共用 generic helper
- **PhaseSpace 拡張 Phase A-1..A-4 + B-1..B-4**: `(pos, u, heading, alpha)` に拡張、past-cone 交点で heading slerp + alpha 線形補間
- **レーザー砲 v2** (`b7c75b4` + `5dc8952`): chin pod 一体型、barrel rear 0.15 食い込みで mount 浮き解消
- **Bundle 効率化** (`4928c98` + `af79e80`): drei 削除 + vendor 単一 chunk + lazy-load。初期 Lobby ロード 1,308 → 332 KB (-75%)。vendor 細分割の循環 import 事故は [`DESIGN.md §Build / Bundle 判断`](DESIGN.md) に記録
- **DEATH_TAU_MAX 5 → 3** + **laser cannon default 切替** (`fc40254` + `41f4741`): body fade 3 秒化、自機/他機/死亡 ship を cannonStyle="laser" 明示
- **機体見た目調整 (scale 3/4 + laser 色/材質 hull 統合 + hide 球 split)**: `SHIP_MODEL_SCALE = 0.75` を SelfShipRenderer 最外層 group に適用し物理値 (hit / laser 発射点) 不変のまま機体だけ 3/4 倍。laser pod/barrel を hull と同色・同 emissive + pod material を barrel (roughness 0.5 / metalness 0.72 / intensity 0.35) に揃えて「hull から生える」一体感を強化。Inner hide 球は中心を observer apex → hull 中心 (`pos.t + SHIP_LIFT_Z * SHIP_MODEL_SCALE`) に移し、future/past で radius 分離 (`SHIP_FUTURE_CONE_HIDE_RADIUS_COEFFICIENT = 5.0` / `SHIP_INNER_HIDE_RADIUS_COEFFICIENT = 3.0`)、世界線は独立 coefficient (`SHIP_WORLDLINE_HIDE_RADIUS_COEFFICIENT = 1.5`)
- **自機 heading カクカク解消**: Phase A で heading source が `cameraYawRef` 直読 → `player.phaseSpace.heading` (store 経由) に移った結果、zustand subscribe → React re-render 遅延 + game tick 60Hz vs rAF 120Hz の quantize でカクカク化。SelfShipRenderer に optional `cameraYawRef` prop を追加し、自機描画時のみ useFrame 内で ref 直読、他機/DeadShip 流用時は従来通り `phaseSpace.heading` を読む fallback。詳細 rationale: [`design/state-ui.md §自機 heading source`](design/state-ui.md)

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
- **灯台死亡描画の即時消失 (未解決)**: LH が死んだ瞬間、観測者の過去光円錐がまだ死亡 event に届いていないのに LH の描画が消える。SR 原則では人間プレイヤー (OtherShipRenderer の past-cone intersection ルール) と同じく「過去光円錐が死亡 event に到達するまで生存時姿で描画、到達後は DeadShipRenderer + DeathMarker」となるべき。統一アルゴリズム (`8c019e3` + `bbae2b7` + `8098032`) で DeadShipRenderer/DeathMarker/LH 一元駆動にしたはずだが、**LH 側の生存→死亡 gate で past-cone 判定が抜けている箇所が残存**している可能性。要調査: `LighthouseRenderer.tsx` と SceneContent で LH 生存中描画を打ち切るトリガー (多分 `isDead` 直読) が past-cone 到達前に発火している
- localId PeerJS ID 衝突 (tab-hidden 復帰時)、PeerServer ネットワークエラー stack
- モバイルハイスコア (iOS Safari ホーム画面復帰時保存)

## 次にやること

### 優先 (次回最初に検討)

- **Phase A/B で実装した worldline 向き・加速度の思想・コード対称性 audit**: `PhaseSpace = (pos, u, heading, alpha)` 拡張 + past-cone 交点補間 (A-4) + SelfShipRenderer heading source 切替 (B-2) 以降、bug が散見 (DeathMarker regression / 3D モデル消失 / etc)。**そろそろ思想に立ち返って対称性・クリーンさを深く追求するタイミング**。具体候補: (a) component 間の「fade / gate / routing」責務配置の統一 (M21 を広域適用)、(b) Phase B-5 (他機 exhaust の pure thrust broadcast) の再設計、(c) Phase C-1 (wire format 厳格化、heading/alpha optional → required) と整合、(d) 世界線データと描画機構の「対応関係」を DESIGN.md に書き下し。plan 化検討: `plans/2026-04-22-symmetry-audit.md` など
- **プレイヤー色を ship model のパーツに合成**: hull 固定 navy で識別弱い。機体本体 (hull + nozzle + pod + barrel) の色が全て H=200〜220 の navy 帯に統一 (laser cannon 側も今回 hull 同値化したため system-wide に 12 色が狭いレンジに収束)、cyan 発光 3 点のみがアクセント → player 識別は形状依存。accent stripe / fin / pod or barrel の emissive 等、パーツのどれかに player color を焼き込む material variant を追加する方向。SelfShipRenderer に color prop 追加、OtherShipRenderer + DeadShipRenderer で流用。Phase B-5 と独立、先行可能

### 既存 (優先順未決定)

- **燃料枯渇をもっと目立たせる**: 現状は Speedometer の energy bar 以外に枯渇通知が無く、ゲーム中「撃てない」理由が分かりにくい。枯渇時の画面フラッシュ / HUD pulse / 効果音 / バー自体の色 flash 等を検討。既存の `handleKill` / `setDeathFlash` のような瞬発的視覚エフェクトの patern を流用可能
- **グローバル leaderboard から "odakin" エントリ削除** (2026-04-22 TODO 化): 本番 `https://lorentz-turn.odakin.workers.dev/leaderboard` の 50 件中 24 件が odakin (他は Lighthouse AI 22 + 他 4 名)。Worker に DELETE endpoint が無いため Cloudflare KV を直接書き換える必要。filter 済 JSON の生成までは確認済み。手順: `cd 2+1/turn-worker && npx wrangler login` (ブラウザ OAuth) → `curl -s .../leaderboard | jq '[.[] | select(.name != "odakin")]' > /tmp/after.json` → `npx wrangler kv key put --namespace-id=2f4ffaba9ba44e4384700893780e801a --remote top --path=/tmp/after.json`。TURN 用 API token (Worker secret) は KV write scope 外なので `wrangler login` 必須
- **DeathMarker regression 他機側の実機確認**: 自機側は 2026-04-22 検証で再現せず closed ([`plans/2026-04-22-self-death-marker.md`](plans/2026-04-22-self-death-marker.md) §post-mortem)、他機側が同じく出なければ「最終検証」項目は閉じる。再発時は同 plan の再仕込み手順で診断。
- **Phase B-5 (他機 exhaust) 再設計**: `phaseSpace.alpha = thrust + friction` が thrust 単独信号でない → pure thrust 用 wire field 新設が必要 ([`plans/2026-04-21-phaseSpace-heading-accel.md`](plans/2026-04-21-phaseSpace-heading-accel.md))
- **Phase C-1 (wire format 厳格化)**: 混在期間確認後、受信 optional → required、shim 削除
- **本番実戦観察**: 死亡 routing refactor + fade 3s + laser default がすべて deployed。multi-tab 実戦テストで regression / UX 確認
- **進行方向可視化 分岐 B/C**: sphere + heading-dart (案 14) / star aberration skybox (案 16)、default frame 選択 ([`EXPLORING.md §進行方向・向きの認知支援`](EXPLORING.md))
- **フルチュートリアル** (必須、初見 UX)
- 各プレイヤー固有時刻表示 / スマホ UI 残 / 用語再考 / 音楽の時間同期
- **レーザー以外の世界線 × 未来光円錐の表示**: 現 sphere 0.15 + ring 0.12 薄い
- **DeathMarker ring を (x_D0, u_D) 静止系で描画** (Stage 2): 現 C pattern 並進のみ → u_D 方向に contracted な楕円 (relativistic apparent shape)
