# Authority 解体プラン（2026-04-14 着手）

## ゴール

ホスト概念を解体し、「各プレイヤーが自分の世界線の唯一の権威」を徹底する。
マイグレーションが **beacon 所有権の付け替えだけ** になる構造に到達する。

## 原理（確定）

1. **各プレイヤー（人間 / Lighthouse）は 1 人の peer が owner**
   - 人間: 本人の peer
   - Lighthouse: beacon holder の peer（兼任）
2. **Owner だけが自分のエンティティの event を発信する**
   - `phaseSpace`（位置・速度）
   - `laser`（自分が撃った）
   - `kill`（**自分が撃たれた**、target-authoritative）
   - `respawn`（自分が復活した）
3. **他 peer について宣言しない**。完全対称
4. **Hit detection は target のローカル**。決定論要件なし。Math.sin/cos 自由
5. **Derived state**: score / deadPlayers / invincibility は event から導出、store に authoritative 値を持たない
6. **RNG 不要**: respawn 位置等は owner が local Math.random で決めて broadcast
7. **Coord-time の同期は join 時の 1 回だけ**（`syncTime` 廃止）
8. **Beacon ≡ relay hub ≡ Lighthouse owner ≡ 新規入口**（star topology は維持、authority は持たない）

## 実装段階

全段階を通じて、各段階終了時点で **ゲームはプレイ可能** を維持する。

### Stage A — 概念整備（振る舞い変更なし）

**目的**: `ownerId` を型に入れ、mental model を確立

- `RelativisticPlayer` に `ownerId: string` 追加
- 人間プレイヤー: `ownerId = peerId`
- Lighthouse: `ownerId = 現 beacon holder peerId`
- ヘルパー: `isOwnedByMe(player, myId)` の純関数
- どこでも使わないが、型として存在する状態でコミット

**検証**: コンパイル通過 + マルチタブで通常動作

### Stage B — Target-authoritative hit detection（要の変更）

**目的**: hit 判定を各 target のローカルに移し、ホストの hit detection を削除

手順:
1. `processHitDetection` を「**自分の owner な player 達に対する判定のみ**」に絞る純関数に書き換え
   - 人間プレイヤーは自分だけ判定
   - beacon holder は Lighthouse も判定（owner として）
2. Hit が検出されたら target が `kill` メッセージを broadcast
   - 現状の `kill` は host 発信だが、同じメッセージタイプを使い回し、発信者を target に変更
3. `messageHandler` の `kill` 受信処理: 従来は host 発信を前提にしていた skip ロジックを外す。誰からでも受理する
4. ホスト側の「他プレイヤーへの hit detection」を削除

**リスク**:
- target がオフライン → kill 発火しない。容認（オフライン player は game に参加していない）
- 発信元の peer 不正 → target が自分以外の kill を宣言する可能性。バリデーション: `targetId === senderId` を messageHandler で強制

**検証**: マルチタブで互いに撃ち合い、kill が両者に反映されること

### Stage C — Score / deadPlayers / invincibility を derived に

**目的**: store の authoritative 値を削除、event log から派生に

- `game-store.ts` から `scores` を外す、または kill event log を集計する selector に置き換え
- `deadPlayers` は kill event log ∖ respawn event log で計算
- `invincibleUntil` は respawn event 時刻 + `INVINCIBILITY_DURATION`
- `score` メッセージ削除
- `syncTime` は **この段階ではまだ残す**（join 時に必要）

**リスク**: event log のメモリ管理。古い kill/respawn event を捨てるタイミングを決める
- 方針: kill/respawn のペアが成立したものはスコア加算後に捨てる
- 未解決の kill（respawn 待ち）だけ残す

**検証**: スコアが正しくカウントされる、無敵時間が正しく効く

### Stage D — Respawn timer を owner local に

**目的**: respawn 管理を host 専用から owner 専用に

- 各 owner が自分の player の死亡を認識したら、`RESPAWN_DELAY` 後にローカル timer で自分を respawn
- `respawn` メッセージは owner 発信（= 現状と同じ発信者タイミングだが、概念的に「owner だから発信する」に）
- `useHostMigration` の respawn 再構築ロジックは **削除**（owner local なので、owner が持ち続けているなら継続、owner が消えたなら player ごと消える）
- Lighthouse の respawn: beacon holder が継続して担当（beacon migration 時は新 holder に引き継ぎ）

**Beacon migration と Lighthouse**:
- 新 beacon holder は、Lighthouse の `deathTime`（全員が kill event で知っている）から残り時間を計算し、自分のローカル timer を張る
- これは「event log から状態を再導出」の自然な帰結

**検証**: 人間プレイヤー respawn、Lighthouse respawn、beacon migration 中の Lighthouse respawn

### Stage E — Lighthouse as player

**目的**: NPC 二級市民を廃止、通常プレイヤーと同等の扱いに

- Lighthouse owner（beacon holder）が Lighthouse の phaseSpace を自分の物理フレームで計算
- 他プレイヤーと区別なく broadcast
- `lighthouseLastFireRef` は owner のローカル ref として維持（broadcast 不要）
- beacon migration 時、新 owner は直近 laser event の coord-time を `lastFireTime` に採用して continuity を保つ
- `isLighthouse(id)` 判定は **metadata** として残す（UI 色分け、ターゲット除外等）が、**authority 構造から切り離す**

**検証**: Lighthouse が動き、撃ち、撃たれる。beacon migration 中も継続

### Stage F — Beacon ≠ Authority の PeerProvider 再構築

**目的**: `role: "host" | "client"` を `role: "beaconHolder" | "peer"` に改名 + 意味変更

- `hostMigration` メッセージを `snapshot` に改名（新規 join 用のみ）
- `beaconChange` メッセージ新設（「俺が beacon になった」）
- 既存プレイヤーは beacon migration で何も受け取らない（state は自前で持っている）
- 新規 join は beacon holder から snapshot 一式を受け取る: 全プレイヤーの world line + joinRegistry + scores + deadPlayers + deathTimes + Lighthouse state + 現在 coord-time
- `syncTime` メッセージ削除 → 新規 join は snapshot に埋め込まれた `currentCoordTime` で OFFSET を計算

**useHostMigration**:
- respawn 再構築ロジックは Stage D で削除済み
- 残るのは beacon ownership の handoff のみ
- `useBeaconMigration` に改名（または PeerProvider に吸収）

**検証**: beacon holder 切断時、他プレイヤーはフリーズせず続行。新規 join は snapshot を受け取ってスポーン

### Stage G — Heartbeat 積極化

**目的**: beacon 切断検知を高速化

- Ping 間隔: 3s → 1s
- Timeout: 8s → 2.5s
- オプション: phaseSpace-based implicit heartbeat（`phaseSpace` が来ていれば alive とみなす）

**前提**: Stage F 以降なら false positive のコストがゼロに近い（state 引き継ぎがないので再選出だけ）

**注意点**:
- **Browser tab throttling**: バックグラウンドタブは `setInterval` 最小 1s スロットル。`document.hidden` 復帰直後の grace 期間（例: 5s）を入れて誤検知吸収
- **JS event loop stall**: GC・タブ復帰直後で 500ms〜1s の stall は普通。3s で「2 連続 miss = 死亡」のような hysteresis を入れる手もあるが、「誤検知してもコスト 0」前提ならシンプルな閾値で十分
- **Mobile network handover**: 1〜3s の瞬断あり。マイグレ後の再接続もタブ間で許容

**検証**: 切断検知が高速化、誤検知でもプレイが止まらない、タブ切り替えで誤マイグレが起きない

### Stage H — 後片付け

- 死んだコードの削除（`isHost` 変数の残骸、redundant な import、使われなくなった定数）
- CLAUDE.md / DESIGN.md の更新
- SESSION.md で一連の作業完了を記録
- 不要な message 型の型定義削除（`score`, `syncTime`, `hostMigration`）

## 変更が多いファイル（予想）

- `src/contexts/PeerProvider.tsx` — 最大
- `src/hooks/useGameLoop.ts` — 大
- `src/hooks/useHostMigration.ts` — 大半削除
- `src/components/game/gameLoop.ts` — 中（hit detection 絞り込み）
- `src/components/game/messageHandler.ts` — 中（kill/respawn の発信者ルール変更）
- `src/types/message.ts` — メッセージ型の削除・改名
- `src/stores/game-store.ts` — scores / invincibility 削除、event log 追加
- `src/hooks/useHighScoreSaver.ts` — 軽微（最終スコアの derive source 変更）
- `CLAUDE.md` / `DESIGN.md` — 文書更新

## テスト戦略

各段階で:

1. **Localhost multi-tab**: `#room=test` で 2-3 タブを同時起動、互いに撃ち合う
2. **人為的切断**: Stage F 以降は 1 タブ閉じて残りが継続するか確認
3. **Lighthouse 動作**: AI の射撃・被弾・respawn
4. **ネットワーク遅延注入** (optional): Chrome DevTools の network throttling
5. **ビルド成功**: `pnpm run build` でエラーゼロ、`pnpm run lint` クリーン

Deploy は Stage H 完了後にまとめて。段階中は localhost で検証。

## リスクと緩和

| リスク | 段階 | 緩和 |
|---|---|---|
| target オフライン時 kill 消失 | B | 容認（オフライン = 不在）|
| kill event 詐称 | B | `targetId === senderId` バリデーション |
| event log のメモリ肥大 | C | respawn 済み kill は捨てる |
| Lighthouse AI handoff の glitch | E | 短時間の挙動ズレ容認 |
| OFFSET 計算の片道遅延誤差 | F | 光円錐遅延に埋没、容認 |
| 既存セッションとの compat 断絶 | 全般 | セッションまとめて reload（運用合意）|

## ロールバック単位

各 Stage は独立 commit（stage ごとに 1〜3 commits を想定）。問題があれば stage 単位で revert 可能。

## 未決事項

- **drift safeguard**: event log の hash 交換による divergence 検知は v1 では不要、長時間プレイで問題出たら後付け
  - 壁時計 drift の数値感: 水晶発振器 ±50 ppm → 1 時間で約 0.18s、1 日で約 4.3s。ゲームセッションが分〜時間オーダーなら無害。長時間プレイ（数時間〜）で気になり始める閾値
- **mesh 化**: 直交タスク、このプランの範囲外

## 維持する挙動（念のため明記）

- **スコア表示は過去光円錐到達時に反映**（現状の `firePendingKillEvents` の挙動を維持）。Stage C の derived 化でも、発火タイミングはそのまま

## 完了後の次ステップ（範囲外）

- **Heartbeat の phaseSpace-based 化**: phaseSpace の到着自体を implicit liveness とし、ping は fallback に降格。アクティブプレイ中の検知を ~500ms に
- **Mesh topology 移行**（独立タスク）: 現 star を維持するが、本プラン完了後なら独立に着手可能
  - メリット: (a) レイテンシ半減（A→B 1 ホップ。相対論ゲームは phaseSpace の鮮度が UX に直結する）(b) hub 切断中のダウンタイム消失（エッジが生き残る）(c) hub の上り帯域ボトルネック解消（人数増加時に効く）(d) beacon 所有者切断時も既存ゲームに影響ゼロに
  - コスト: (a) 接続数 N(N-1)/2（N=8 で 28）(b) ICE/TURN 交渉のペアごと実行 (c) TURN 混在時のエッジごとの取り扱い
  - 判断: 現スケール〜4 人程度では star で十分。大会・観戦モード等で人数を増やすときに検討
- **Lighthouse 以外の NPC 追加**（bomb、pulsar 等）: 「NPC = player + AI 入力」の枠組みが Stage E で確立するため、追加は機械的に可能
