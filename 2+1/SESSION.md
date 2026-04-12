# SESSION.md — LorentzArena 2+1

## 現在のステータス

対戦可能。**`4741788` デプロイ済み** (2026-04-12 昼、build `2026/04/12 12:06:08 JST`)。
本番 URL: https://sogebu.github.io/LorentzArena/

## 直近の変更（2026-04-12）

### Lighthouse AI 固定砲台 (`ae2d6c3`〜`2af525a`)

接待用 NPC「Lighthouse」。固定位置から相対論的照準でレーザーを撃つ。

- players Map に `lighthouse-0` として通常プレイヤーとして存在（kill/respawn/migration がそのまま動く）
- 照準: `pastLightConeIntersectionWorldLine` で敵を観測 → 未来光円錐との交点を2次方程式で解析的に計算 → 方向にレーザー発射
- 慣性運動を続ける敵には必中。プレイヤーは加速すれば回避可能
- 発射間隔: 2秒。最も近いプレイヤーを優先
- ホストのみ AI ロジック実行、phaseSpace を broadcast してクライアントにも見える
- 因果律ガードから除外（NPC がプレイヤーを凍結しない）
- 接続クリーンアップから除外（NPC は実ピア接続を持たない）
- スコアボード/キル通知で「Lighthouse」と表示
- 定数: `game/constants.ts` に `LIGHTHOUSE_*`、ロジック: `game/lighthouse.ts`

### 色一貫性修正 (`3f8d735`〜`8fba787`)

ホスト/クライアント間で色がずれる問題を修正。

- **根本原因**: `joinRegistry` が peerList 到着前に空のままフォールバック色が固定される
- **修正**: `joinRegistryVersion` state カウンター（PeerProvider）。joinRegistry 変更時にインクリメント → useEffect で全プレイヤー色を再計算
- `getPlayerColor` からホスト特別扱い（index 0 ハードコード）を削除。全員 joinRegistry の index で色決定
- ホスト自身も joinRegistry に `unshift` で登録（マイグレーション後も元の色を維持）
- `phaseSpace` 受信時は `existing?.color ?? getPlayerColor(id)` でキャッシュ（毎フレーム再計算なし）

### stale プレイヤー処理 (`3f8d735`〜`6a72781`)

切断/フリーズしたプレイヤーの処理。

- `lastUpdateTimeRef`: phaseSpace 受信時にタイムスタンプ記録
- 5秒更新なし → `staleFrozenRef` に追加、因果律ガードからスキップ（ホストの永久凍結を防止）
- isDead にはしない（当たり判定は継続 — レーザーで撃てる）
- 復帰時: ホスト権威で maxT + ランダム位置にリスポーン + スポーンエフェクト（因果律遅延付き）
- クライアント側: `respawn` メッセージ受信時に `staleFrozenRef`/`lastUpdateTimeRef` をクリア
- migration maxT ループでも isDead を除外（既存の不整合修正）

### モバイル viewport 修正 (`3f8d735`)

- `100vh` → `100dvh`: モバイルブラウザのツールバーで右下情報が隠れる問題を修正

### FIRING 表示 (`3f8d735`)

- 射撃中に「FIRING」テキスト（レーザー色、10Hz 点滅）を画面中央やや上に表示
- グローエフェクトも同期点滅

### ビルド時刻 JST 表示 (`3f8d735`)

- UTC ISO → `2026/04/12 10:01:17 JST` 形式に変更

### 光円錐描画簡素化 (`2728293`)

- ワイヤーフレーム削除（4メッシュ→2メッシュ）、DoubleSide、opacity 0.1

### A/D 左右移動 (`6a72781`)

- W/S 前進/後退 + A/D 左右移動（WASD 全方向）
- 斜め移動の加速度を正規化（√2 倍にならない）

### ゴースト中のモバイル操作 (`5a0b4c3`〜`39ebcb3`)

- 死亡中は縦スワイプをカメラ pitch に使用（yaw と同じデルタ方式）
- 加速できないゴーストでは thrust が無意味なため

### リスポーン時カメラリセット (`1498f34`, `4741788`)

- リスポーン時に yaw=0, pitch=30° にリセット（PC/スマホ共通）

### デプロイ安全策 (`87c43e5`, `18b5a4d`)

- ルートの `pnpm run deploy` が `cd 2+1 && pnpm run deploy` に委譲（1+1 誤デプロイ防止）
- CLAUDE.md にデプロイ時 commit+push ルール追加

### 定数整理 (`816f262`)

- `MAX_WORLDLINE_HISTORY = 5000` を定数化。全 `createWorldLine` 呼び出しで使用

## 直近の変更（2026-04-11 夜）

### ホストマイグレーション (`f6ba5ec`〜`cae791b`)

ホスト切断時に最古参クライアントが自動昇格。PeerJS / WS Relay 両方対応。

- ハートビート方式: 3 秒 ping + 8 秒タイムアウトで即時検知（ICE タイムアウト 30 秒+を回避）
- peerList 順序で決定論的選出、`hostMigration` メッセージで状態引継ぎ
- PeerJS: 旧ホスト ID 非再取得、新ホストがランダム ID のまま直接接続
- relay server: `promote_host` ハンドラ + `host_closed` に peers リスト + ID 長制限
- テスト済み: 3 タブテストで昇格・接続・UI 更新を確認
- 設計判断: DESIGN.md「ホストマイグレーション」

### 色割り当て改善 (`3ce73d7`, `2472464`)

joinOrder × 黄金角で色分離を保証（2 人で 137.5° 離れる）。

- `colorForJoinOrder(index)` 純関数 + append-only `joinRegistryRef`
- `getPlayerColor(id)`: PeerProvider から提供、フォールバックはハッシュ色
- 旧 `colorForPlayerId(id)` はフォールバック専用に残存
- **注意**: `getPlayerColor` を useCallback/useEffect の deps に入れるとゲームループ freeze を引き起こす（`2472464` で修正）。biome-ignore で除外

### リスポーン時刻修正 (`428c592`, `752631c`)

- `(minT + maxT) / 2` → 生存プレイヤーの `maxT` に変更
- ゴースト（死亡中の慣性運動）を除外（未来側スポーン防止）
- 設計判断: DESIGN.md「リスポーン座標時刻」

### クライアント初期スポーン修正 (`56b8a75`)

- クライアントのプレイヤー初期化を syncTime 受信後に変更（ホスト専用 init effect）
- syncTime ハンドラがホストの世界座標時刻でプレイヤーを直接作成

### エネルギーゲージ色 (`428c592`)

- 固定オレンジ → プレイヤーのレーザー色（`<20%` 時は赤）

### ドキュメント (`b91ba54`, `cae791b`)

- ARCHITECTURE.md / NETWORKING.md / NETWORKING.ja.md にホストマイグレーション章追加
- EXPLORING.md: マイグレーション節を DESIGN.md に promote、過去光円錐交差点の遠近法を追加

## 直近の変更（2026-04-11 昼、`202da6b` まで）

モバイルタッチ入力・エネルギー制・因果律スコア・射撃グロウ・HUD 改善・パフォーマンス修正。詳細は `git log 202da6b` 参照。

## 直近の変更（2026-04-10）

### `6574a02` Spawn effect causal delay + SPAWN_RANGE tuning

- `SPAWN_RANGE` 30 → 20（射程 `LASER_RANGE=20` と一致させる）
- スポーンエフェクトに因果律遅延を導入: 他プレイヤーのリスポーンは `pendingSpawnEventsRef` に積み、過去光円錐到達時に発火。自分のリスポーンは即時
- `isInPastLightCone(event, observer)` を `physics/vector.ts` に追加。kill/spawn 両方の過去光円錐判定を統一
- 教訓: ゲームループ内で `setSpawns` をイベント毎に個別呼び出しするとクラッシュ。バッチ化必須（DESIGN.md に記録済み）

### `451a964` Simplify myDeathEvent to ref-only

- state + ref 二重管理を ref 一本に統合。`ghostTauRef` と同じパターン

### `5b6d3c7` Fix host not respawning after being killed

- **バグ**: ホストが kill されると `setMyDeathEvent` → ゲームループ effect 再実行 → `clearTimeout` で respawn タイマー消失 → ホストがリスポーンしない
- **修正**: `myDeathEvent` を ref 経由で読み、useEffect の deps から除去

### `c884d98` Add Cloudflare TURN credential proxy for restrictive network support

- Cloudflare TURN (`turn.cloudflare.com`) + Worker (`turn-worker/`) で短命 credential 発行
- `VITE_TURN_CREDENTIAL_URL` で動的 ICE servers。優先順位: dynamic > static > defaults
- Worker URL: `https://lorentz-turn.odakin.workers.dev/`（`.env.production` に設定済み）
- 旧 A'（Open Relay）は一部組織ネットで全ポート遮断のため廃止
- **学校ネットでの検証はまだ**（家からのデプロイ完了、学校で接続テスト待ち）

## 直近の変更（2026-04-06）

### `1dd9349` Restore 2D HTML KILL overlay, fired at past-light-cone causality

- 初期 (`916ac81`) の 2D HTML KILL テキストオーバーレイを復活。画面中央から 1.5s かけて `translate(-50%, -50%)` → `(-50%, -60%)` で浮き上がる挙動
- 発火タイミングのロジック（`pendingKillEventsRef` の因果律遅延: キラーの過去光円錐が hitPos に到達した瞬間）は既に存在していたので、表示側の HTML オーバーレイだけ追加
- SceneContent の 3D 球体＋リングも併存（時空点マーカーと画面固定テキストの両方が出る）

### `d469078` 4-axis review: remove side effects from setState reducers

色リファクタ後の監査で検出した 5 件の「reducer 内副作用」を修正（色バグと同じアンチパターン）:
- **A**: ゲームループの movement `setPlayers` reducer 内 `peerManager.send(phaseSpace)` → reducer 外へ
- **B**: `handleKill` の `setDebrisRecords` reducer 内 `generateExplosionParticles()`（`Math.random`）→ reducer 外へ
- **C**: init `setPlayers` reducer 内 `Math.random` / `Date.now` / `createWorldLine` → reducer 外へ
- **D**: `handleRespawn` の `setSpawns` reducer 内 `Date.now()` → reducer 外へ
- **E**: `HUD.tsx` スコア表示の `?? "white"` fallback → `?? colorForPlayerId(id)`
- 詳細: DESIGN.md「setState reducer は純関数に保つ」セクション

### `9151f8a` Replace stateful color sync with pure colorForPlayerId(id)

stateful `pickDistinctColor` を純関数 `colorForPlayerId(id)` に置き換え。
- **削除**: `playerColor` メッセージ型 / `pendingColorsRef` / ホスト集中色割り当て / `connections` useEffect の color broadcast / ゲームループの gray fallback / gray placeholder
- **追加**: `colorForPlayerId(id)` — FNV-1a ハッシュ + 黄金角 137.5° で hue、符号なしシフト `>>> 8`/`>>> 16` で saturation/lightness
- 全ピアが同じ関数を呼ぶので race・StrictMode 二重実行問題・接続再構築問題が丸ごと消える
- 正味 -87 行、6 ファイル
- 過去 5 回のパッチ（`a1ddfdf`→`ef8b61e`→`2db183f`→`b6ee80e`→`9d10e03`→2026-04-06 緊急修正）はすべて同じ根 (stateful 設計) の別症状
- 詳細: DESIGN.md「色割り当て: 決定的純関数」

## 直近の変更（2026-04-05、コミット `0b2c808`）

4軸レビューで 16 件修正。詳細は `git show 0b2c808` 参照。

## 既知の課題

- `pastLightConeIntersectionWorldLine` の PhaseSpace 補間 TODO (`worldLine.ts:294`)
- Caddyfile にセキュリティヘッダー (X-Frame-Options, CSP) 未設定
- Docker Compose にリソース制限 (memory/CPU limits) 未設定

### パフォーマンス検討課題（2026-04-11 監査、MEDIUM 以下）

CRITICAL/HIGH は `5288bac` で修正済み（TubeGeometry dispose、レーザー GC+バッチ描画、Spawn/Kill ジオメトリ共有化）。以下は構造的変更が大きく、FPS 低下が顕在化したら着手:

- **worldLine.ts の配列コピー**: `appendWorldLine` が毎フレーム `[...wl.history, phaseSpace]` で最大 5000 要素をコピー。immutable list や ring buffer で O(1) 化可能。un-defer トリガー: プレイヤー数増加で GC pause が顕在化
- **ゲームループの setState 頻度**: 8ms interval で `setPlayers`/`setLasers`/`setSpawns`/`setIsFiring`/`setEnergy` が毎フレーム発火、React 再レンダーを駆動。Zustand 等の外部ストアに移行すれば re-render を制御可能。un-defer トリガー: プレイヤー数増加でレンダリングがボトルネック化
- **useMemo の毎フレーム再計算**: `displayLasers`/`worldLineIntersections`/`laserIntersections` が `observerPos`（毎フレーム変化）に依存し、全要素を再計算。空間インデックスや距離カリングで計算量削減可能。un-defer トリガー: レーザー数やプレイヤー数が増えて CPU 使用率が問題化
- **インラインマテリアル**: 光円錐・スポーンエフェクト・キル通知の `<meshBasicMaterial>` が JSX でインライン生成。R3F が内部で再利用するため実害は小さいが、明示的にキャッシュすれば確実
- **RespawnCountdown の setInterval**: 100ms 間隔で `setRemaining` → HUD 再レンダー。500ms で十分

## 次にやること

- **制約ネットワーク検証待ち**: Cloudflare TURN (`c884d98`) をデプロイ済み。次に学校ネットワーク内で https://sogebu.github.io/LorentzArena/ を 2 タブ開いて接続テスト。成功すれば本件クローズ。失敗すれば C（WS Relay 公開デプロイ、`relay-deploy/` 実装済み）に escalate
- マルチプレイヤーテスト（バリデーション・パフォーマンス確認）
- 各プレイヤーに固有時刻を表示（時間の遅れの実感用）
- 3+1 次元への拡張検討
- **スマホ UI 残課題**: レスポンシブ HUD（モバイルで接続パネルが重なる）、オンボーディング（初見ユーザーが操作方法を発見できるか）
- **用語の再考**: 戦闘/死亡系語彙 (KILL / DEAD / deathFlash / handleKill / isDead 等) を物理記述寄りに置換するか検討。候補 A (INTERCEPT) / B (CONTACT) / C (無言化) を整理済み。**詳細は [`EXPLORING.md`](./EXPLORING.md) の「用語の再考」セクション参照**
- ~~**残存する設計臭の掃除**~~ → **2026-04-06 全件 defer 決定**。詳細は DESIGN.md「残存する設計臭」→「再評価後の判断（2026-04-06）」参照
