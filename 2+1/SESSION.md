# SESSION.md — LorentzArena 2+1

## 現在のステータス

対戦可能。**`bc93fe2` デプロイ済み** (Authority 解体 Stage A〜H 全完了、build `2026/04/15 00:10:51 JST`)。
本番 URL: https://sogebu.github.io/LorentzArena/

### Authority 解体リファクタ: **完了**

- **プラン**: `plans/2026-04-14-authority-dissolution.md`（8 Stage、A→H 全完了）
- **設計原理 + 実装判断**: DESIGN.md「Authority 解体アーキテクチャ」節
- **進捗**: 全 Stage 完了
  - A: `ownerId` 型導入（`4f4bddd`）
  - B: target-authoritative hit detection（`8b4932f`）
  - C-1〜C-4: event log (`killLog` / `respawnLog`) を source of truth に、cache 撤去、GC 追加（`01fed9d` / `c076192` / `6ba5174` / `49c65bc`）
  - D-1〜D-3: respawn schedule を owner-local に移管、useHostMigration を LH handoff 専用に縮退、LH init の idempotent ガード（`d0d05f0` / `1cc05f9` / `b5579fe`）
  - E: LH AI を owner-based filter に、`lighthouseLastFireTime` を全 peer 観測で自動連続化（`0491d52`）
  - F-1: `snapshot` メッセージ新設、syncTime/hostMigration 送信撤去（`3153585`）
  - F-2: naming refactor (host→beaconHolder、`useHostMigration`→`useBeaconMigration`)（`70f9ac7`）
  - G: heartbeat 積極化 (ping 1s 間隔 / 2.5s timeout、visibility 復帰 grace)（`5de2aed`）
  - H: `syncTime` / `hostMigration` 型とハンドラ削除、docs 最終化
- **次アクション**: Stage F-1 後にユーザーから報告された「リスポーン時に世界線が繋がる」regression の調査 (下記「既知の課題」参照)。その後は対戦 deploy 準備 (ユーザー判断)
- **動機（達成済み）**: host 切断時の state 引き継ぎが怪物化していたのを target-authoritative 化 + event-sourced で解消。beacon migration は beacon ownership の付け替えのみに縮退
- **デプロイ方針**: 全 Stage 完了後にまとめて deploy。世界線 regression の決着後を予定

## 既知の課題

### defer 中

- DESIGN.md 残存する設計臭 #2-#4
- PeerProvider Phase 1 effect のコールバックネスト
- 色調をポップで明るく（方向性未定）

### パフォーマンス検討課題

- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング

### リスポーン時に世界線が繋がる（再発、2026-04-14 Stage F-1 後に報告）

- **現象**: プレイヤーがリスポーンすると、死亡前の世界線と死亡後の世界線が一本の連続した線として描画される（過去のライフの凍結世界線と新ライフの世界線が分離して描画されるべき）
- **過去に一度修正された類似問題**: `WorldLine.origin` の半直線延長の無効化（DESIGN.md「過去半直線延長を廃止」参照）でリスポーン側は固定されたはずだが再発

- **検討した仮説と検証状況 (いずれも未確認)**:

  1. **F-1 snapshot 経路の欠落**（最有力）: `snapshot` / `applySnapshot` は worldLine を serialize/rehydrate するが `frozenWorldLines` は含めない。死亡中に snapshot が送信されると新 peer は「死ぬ直前までの history」を生きた現 `player.worldLine` として持ち、その後 respawn 側の appendWorldLine で繋がった世界線ができる可能性。観客 peer 限定で出るなら濃厚

  2. **メッセージ順序逆転**: respawn メッセージより先に post-respawn の phaseSpace が到着し、`if (existing?.isDead) return prev` で 1 発スキップ → その後 respawn で worldLine 置換、となるはずなので順序問題だけで繋がりは作らない…と思うが、WebRTC DataConnection の `reliable: true` でも handler 呼び出し順とステート更新のインタリーブで何か起きうるか要検証

  3. **applyKill が player.worldLine をクリアしない**: 現実装は `{...victim, isDead: true}` だけ。frozenWorldLines には別参照で copy 済み。applyRespawn で `createWorldLine(MAX_WORLDLINE_HISTORY)` (origin なし) を作って置換するので、理屈では繋がらないはず。参照共有の漏れ (history 配列を誰かが append で mutate している等) がないか要確認

  4. **描画層の合成**: WorldLineRenderer / LaserBatchRenderer がどのように frozen と current を合成描画しているか。TubeGeometry のセグメント結合で境界が見えていないだけの視覚的問題の可能性

  5. **host migration との連動** (ユーザー報告の観察): migration を跨いだタイミングでのみ / 特に強く発生する可能性。候補経路:
     - migration 時に RelativisticGame init effect が `isBeaconHolder` 変化で再実行される。Stage D-3 で LH は idempotent ガード済みだが、self player 側にも似た競合が残っているか要確認
     - useBeaconMigration の LH owner 書き換え時、`setPlayers` が LH entry を差し替える瞬間に in-flight の phaseSpace / respawn と race
     - migration 前後で死亡中だった player の respawn が旧 beacon holder 側で scheduled → 切断で失われる → 新 beacon holder 側での自動スケジュールがないため、世界線が宙ぶらりんになって合成境界がズレる

- **未調査**: 何 peer 構成で・誰が死んだ時・どの peer (本人 / killer / 第三者 / snapshot を受けた新 joiner) から見て発生するか。特に **host migration 直前直後** に集中して起きるかどうか (ユーザー観察の示唆)
- **対処**: Stage F-2/G/H では自動解消しない見込みのため、Stage F-2 以降の途中で独立タスクとして調査予定

### ホストマイグレーション時の位置飛び（Stage F で解消見込み）

- 灯台の位置が飛び、世界線が折れ線になる。旧ホストの位置も飛んでいた可能性
- 推定原因: 旧ホスト切断→新ホスト昇格の間にタイムギャップが生じ、新ホストが最後の phaseSpace から再開すると座標時間の不連続で世界線にジャンプ。Stage D-3 で LH の上書き問題は修正済みだが、migration 中の phaseSpace 発信途絶による不連続は残る

### 要テスト

- グローバルリーダーボード: sendBeacon 修正後、実際にスコアが KV に保存されるか確認
- モバイルハイスコア: iOS Safari でホーム画面に戻る → スコアが保存される

### 既知のリスク（低優先）

- localId PeerJS ID 衝突（tab-hidden 復帰時）
- PeerServer ネットワークエラーでスタック（WS Relay 未設定時）

## 次にやること（Authority 解体後）

- **チュートリアル（必須）** — 初見ユーザーが操作・ゲーム概念を理解できない
- 各プレイヤーに固有時刻表示
- スマホ UI 残課題（レスポンシブ HUD、オンボーディング）
- 用語の再考（`EXPLORING.md` 参照）
- 音楽の時間同期（将来計画、`EXPLORING.md` 参照）

## 過去の変更

- 2026-04-14: Authority 解体 Stage A〜E 実装 + handleKill 二重キル防止ガード + sendBeacon CORS 修正（`text/plain`）+ 制約ネットワーク検証（学校ネットで Cloudflare TURN）。ハイスコア異常値の調査は再現せず、Zustand 移行過渡期の蓄積と推定
- 2026-04-13 夜: Zustand store 移行（props drilling 解消、GameLoopDeps 34→14 等）、空間スケール再半減、二重半減バグ 5 箇所修正、初回スポーン統一、座標時間同期の MAX_DELTA_TAU 撤廃、スポーン色の遅延解決。詳細は DESIGN.md 該当節
- 2026-04-13 日中: START でホスト決定、ホストマイグレーション堅牢化、リスポーン無敵、世界スケール 20→10、光円錐ワイヤーフレーム
