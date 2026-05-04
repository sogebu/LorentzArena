# design/state-ui.md — LorentzArena 2+1 State 管理 + UI/入力

DESIGN.md から分離。zustand store、event log authoritative、selectors、UI overlay、モバイルタッチ入力。

## § State 管理

### Zustand 移行

**動機**: invincibility 実装で「ref 1 本追加 → 7 ファイル変更」の props drilling 税が顕在化。

**結果** (`src/stores/game-store.ts` に共有ゲーム状態を集約):

| 指標 | Before | After |
|---|---|---|
| GameLoopDeps props | 34 | 14 |
| MessageHandlerDeps props | 15 | 6 |
| SceneContentProps props | 12 | 5 |
| HUDProps props | 16 | 11 |
| RelativisticGame useState | 14 | 6 |
| RelativisticGame useRef | 22 | 3 |
| shadow refs (playersRef 等) | 3 | 0 |

**ストア設計** (Authority 解体 C 以降):

| カテゴリ | 項目 | 購読方式 |
|---|---|---|
| Reactive (selector 購読) | players, lasers, scores, spawns, frozenWorldLines, debrisRecords, killNotification, myDeathEvent, killLog, respawnLog | `useGameStore(s => s.X)` |
| Non-reactive (getState のみ) | processedLasers, pendingSpawnEvents, displayNames, lighthouseSpawnTime, lighthouseLastFireTime | `store.getState().X` |
| Local UI (RelativisticGame) | showInRestFrame, useOrthographic, deathFlash, isFiring, fps, energy | useState |
| Local ref (useGameLoop 内部) | causalFrozen, lighthouseLastFire, lastLaserTime, fpsRef, energyRef, ghostTau | useRef |

**撤去済み** (Authority 解体 C): `deadPlayers: Set`, `invincibleUntil: Map`, `pendingKillEvents[]`, `deathTimeMap: Map` — event log 由来の selector に置換。

**判断**:
- `killNotification` と `myDeathEvent` は HUD + SceneContent + gameLoop の 3 モジュールが参照 → store (reactive) に昇格
- `lighthouseSpawnTime` は handleRespawn + messageHandler が書き込む → store (non-reactive) に昇格
- `handleKill`/`handleRespawn` は store actions に吸収。`handleRespawnRef` 間接参照パターン解消
- `ghostTauRef` は useGameLoop 内部 ref に移動
- `getPlayerColor` は PeerProvider 由来のため store に入れず、必要な場所にパラメータで渡す

### リファクタリング現状評価

| ファイル | 行数 | 判断 | 理由 |
|---|---|---|---|
| `PeerProvider.tsx` | 1023 | defer | Phase 1 effect のコールバックネストは PeerJS ライフサイクルと密結合。分割しない理由は依然有効 |
| `RelativisticGame.tsx` | ~340 | — | Zustand 移行で 539→340 行に大幅削減。state/ref/callback の大半を store に移行済み |
| `useGameLoop.ts` | ~480 | defer | GameLoopDeps 34→14 props に縮小。内部 ref 化で依存が明確に |
| `SceneContent.tsx` | ~545 | — | store selectors + レーザー方向マーカー追加で微増。SceneContentProps 12→6 |
| `game-store.ts` | ~255 | — | handleKill/handleRespawn を store actions として集約 |

**再評価トリガー**: PeerProvider が 1100 行を超えたら分割を再検討。

### handleKill 二重キル防止ガード

`handleKill` 冒頭に `if (selectIsDead(state, victimId)) return` を追加。hit detection (`processHitDetection`) の `deadIds.has()` チェックと二重防御。

背景: ハイスコアに異常値 (6099 キル / 1:48) が報告されたため防御的に追加。現行コード (Zustand 移行後) は kill rate 0.1/s で正常と確認済み。異常値は Zustand 移行前後の過渡期のものと推定。

### Phase C1: energy pool 被弾共有 + post-hit i-frame + hit debris 統合

2026-04-18 実装。「hit 即死」→「hit で energy 減少、energy<0 で死」への damage model 転換。

**damage model**: `HIT_DAMAGE = 0.5` を既存の thrust/fire 共有 energy pool (`ENERGY_MAX = 1.0`) から直接引く。フル energy から 2 発で死 (`-0.5 → 0 → -0.5 < 0`)。判定は strict `< 0` (ちょうど 0 は生存)。LH も同プールを持つ (`LIGHTHOUSE_ENERGY = 1.0`、回復ロジックなし) ので LH も 2 発で死亡固定。

**`POST_HIT_IFRAME_MS = 500ms` post-hit i-frame — no-hitLog 防衛**: `handleDamage` は最新 `hitLog` entry の wallTime + 500ms 以内なら **hitLog エントリ自体も追加せず** 早期 return。もし「hitLog は記録するが damage skip」という実装にすると、連続被弾のたびに最新 hitLog が更新されて i-frame window がスライドし**永続無敵**になる。hitLog を源泉に i-frame を derive している以上、i-frame 内被弾は完全無視 (damage + log 両方スキップ) が唯一の正解。selector `selectPostHitUntil(state, victimId)` は最新 hitLog wallTime + `POST_HIT_IFRAME_MS` を返す。

**`debrisRecords[]` 単一 array + `type: "explosion" | "hit"` タグ (option A)**: 非致命 hit でも煙を出すが、`DebrisRenderer` は既に type-agnostic (全 record を InstancedMesh で一括描画)、temporal GC も `deathPos.t + DEBRIS_MAX_LAMBDA` 一律、MAX_DEBRIS cap も共通。別 array (`hitDebrisRecords[]`) に分けると renderer / GC / snapshot 同梱計画のすべてで重複実装が必要で、**既存の型非依存アーキテクチャを壊さない**のが option A。

**hit デブリは常時生成 (lethal / non-lethal 両方) + 撃った人の色 (2026-04-18 odakin 第 2 次指定)**: `handleDamage` は lethal 判定前に hit デブリを 1 個 append (色 = `state.players.get(killerId)?.color ?? victim.color`)。非致命ならそこで終了、致命なら続けて `handleKill` に forward → `handleKill` が victim 色の explosion を重ねる (追加順 `hit → explosion`、MAX_DEBRIS cap 共通)。「かすった / 墜ちた」の視覚差は「explosion の有無」で出るのでレイヤー分離がそのまま意味になる。target-authoritative 経路の race 考察: peer は (a) 発射者側 message を hit → kill の順に受信 (DataChannel 順序保証) → 自分の handleDamage (hit debris) → forward handleKill (explosion)、続いて到着する kill message は `selectIsDead` guard で弾かれて二重 explosion を防ぐ。(b) 発射者自身: hit を echo せず local handleDamage → handleKill。どちらの経路でも最終 debris は `hit + explosion` の 2 層。

**target-authoritative 維持 (message schema 拡張)**: `hit` メッセージに `laserDir: Vector3` を追加 (physics §被弾デブリ 参照)。victim owner が検出 → broadcast → 各 peer が独立 `handleDamage` で hit debris 生成。self-hit skip は hit detection 側 (`laser.playerId !== victimId`) で実施済み、`handleDamage` は skip しない。

**test carve-out (`src/stores/handleDamage.test.ts`)**: 5 シナリオ:
1. non-lethal damage: energy 減少 + hitLog 追加 + kill しない
2. lethal damage: energy<0 で `handleKill` 連鎖 + killLog + frozenWorldLines
3. i-frame guard: 連射第 2 発目が damage 適用されない (energy / hitLog 両方不変)
4. LH 2 発で死: 初期 energy `HIT_DAMAGE * 1.5 = 0.75` で 2 発目に死 (`< 0` strict 判定で 1.0 から 2×0.5 は exactly 0 でまだ生存、1.5× なら 2 発目 -0.25 < 0 で死。LH 回復なしを間接確認)
5. 既死 / respawn invincibility guard: `selectIsDead` or `selectInvincibleUntil` 該当なら hitLog 追加もしない

**不採用候補 (damage 値の選定)**:
- `HIT_DAMAGE = 1.0` (1 発死): 従来の即死と変わらず Phase C1 の意味がない
- `HIT_DAMAGE = 0.33` (3 発死): 戦闘時間が長くなりすぎて「かすった」感覚が弱い、体感として 2 発が natural
- `HIT_DAMAGE = 0.5` (採用): 2 発死で「1 発は救い」「2 発目は絶望」のリズムが出る、energy pool 共有なので「燃料削って耐える」か「攻撃に使う」のトレードオフが自然発生

### Stale プレイヤー処理

**構造** (2026-05-04 二重管理解消後):
```
正本: staleFrozenAtRef: Map<peerId, frozenAt wallTime>  (= キー集合 = 「stale な peer」、 値 = 「いつ stale 化したか」)
mirror: useGameStore.staleFrozenIds: ReadonlySet<string>  (= buildSnapshot 用、 mutation 即 sync)

stale 検知 (ゲームループ内、毎 tick)
├── 壁時計 5 秒更新なし → staleFrozenAtRef.set(id, currentTime)  [切断・タブ停止]
└── 座標時間進行率 < 0.1 → staleFrozenAtRef.set(id, currentTime) [タブ throttle]

stale 回復 (messageHandler / RelativisticGame / useGameLoop の各経路、 全部 helper 経由)
└── stale.recoverStale(playerId) → staleFrozenAtRef.delete + lastCoordTimeRef.delete + syncStoreMirror

stale 除外
├── 因果律ガード: staleFrozenAtRef.has(id) → skip
├── 死亡中プレイヤー: isDead → stale 検知しない
└── visibilitychange: document.hidden → ゲームループ停止 → 検知も止まる
```

**S-1〜S-5 修正済み** (2026-04-13 一括解消):
- S-1: Lighthouse を stale 検知から除外 (`isLighthouse(id) → continue`)
- S-2: Kill + stale の二重 respawn を防ぐ (`recoverStale(victimId)`)
- S-3: `lastCoordTimeRef` の cleanup 漏れ → `cleanupPeer` ヘルパーで 3 ref 一括 cleanup
- S-4: stale recovery 時の `lastCoordTimeRef` 未リセット → `recoverStale` で整合 reset
- S-5: 死亡中に stale 検知が止まる → `stale.checkStale` を isDead 分岐の外に

**M25 application** (2026-05-04): 旧版は `staleFrozenRef: Set` + `staleFrozenAtRef: Map` の内部 dual + ref ↔ store mirror dual + ad-hoc delete 5 callsite 散在の三重二重管理。 mutation 即 sync + Map 単独化 + helper 経由統一で解消。 詳細 [`plans/2026-05-04-stalefrozen-decomposition.md`](../plans/2026-05-04-stalefrozen-decomposition.md)。

### myDeathEvent は ref で持つ

`myDeathEvent` (kill 時のゴーストカメラ用 DeathEvent) を `useState` ではなく `useRef` のみで管理していた時期あり。state で持つとゲームループ useEffect の deps に入り、kill のたびに effect がクリーンアップ → respawn timeout が clearTimeout される → ホストがリスポーンしない致命バグ。

現在は store の reactive state (3 モジュール参照のため)。`ghostTauRef` と同じパターンで HUD の re-render は `setPlayers(applyKill(...))` の副次効果として保証される。

### migration 堅牢化リファクタ (2026-04-18 完了、集約)

#### 動機

React component lifecycle に依存した scheduling (setTimeout)、外部 hook 経由の flag reset anti-pattern、stale beacon redirect での ghost host chase (alone edge case) の 3 系統を同時解消。

#### 改修内容

- **owner respawn を tick poll 駆動に**: 自機 + 自分 owner の LH の respawn を `killLog` 走査 + `kill.wallTime + RESPAWN_DELAY <= Date.now()` で毎 tick 判定。旧 setTimeout は useGameLoop の `[peerManager, myId]` deps 変化 (モバイル tab hidden で HOST_HIDDEN_GRACE 経過 → beacon holder destroy → peerManager 差し替え) cleanup で全 timer clear されて永続 DEAD 化する vulnerability 実機再現済み。solo 環境の LH も `setIsMigrating(true)` が heartbeat timeout 経路でしか呼ばれず同じ class で死ぬ path 存在 (コードレビュー発見)。state (log) が source of truth で component 再マウント・peerManager swap・HMR すべてに耐える。setTimeout は belt として残し callback に `selectIsDead` guard、冪等性 invariant (`handleRespawn` 直後に `selectIsDead = false`) を dev assert

- **assumeHostRole inline 集約**: `isMigrating` state + `completeMigration` + `useBeaconMigration` hook を全て削除。仕事再配分: (1)(2)(4) 旧 timer clear / 残時間計算 / setTimeout 再発行 → poll 化で不要、(3) LH ownership 書き換えは `assumeHostRole()` inline に移動 (host 昇格経路 `becomeSoloHost` / heartbeat timeout / beacon fallback は必ずここを通る invariant)、(5) flag reset → flag 自体消失。`setAsBeaconHolder + handler 登録 + LH ownership rewrite + roleVersion++` が同期実行。snapshot gate は `peerManager?.getIsBeaconHolder()` のみに単純化 (旧 `&& !isMigrating` は isMigrating stuck で後で beacon holder に戻っても snapshot 送れない functional bug を起こしていた。3 経路: dual-host 解決の demoteToClient 割込 / game_redirect 受信 / tab hide → 別 peer 先取)。`respawnTimeoutsRef` は `RelativisticGame` に useRef で直接保持

- **snapshot 二経路 (push + pull)**: 旧 push (host の connections diff → sendTo) は client が `onMessage("relativistic", ...)` 登録前に snapshot が届くと silently dropped する race があり、blank state で stuck。`useSnapshotRetry` を追加、client が `players.has(myId)` を観測し 2s false なら beacon holder に `snapshotRequest` 送信 (最大 3 回)、host の `messageHandler` が beacon holder なら sender に fresh snapshot を sendTo。push (低 latency) + pull (2s 遅延 fallback) の belt-and-suspenders。`snapshotRequest` は relay しない (host-direct only)

- **worldLine gap 検知 (`WORLDLINE_GAP_THRESHOLD_MS = 500`)**: `messageHandler.phaseSpace` で `lastCoordTimeRef.wallTime` 差が 500ms 超なら既存 worldLine (history > 0) を `frozenWorldLines` に push (kill→respawn と同じ凍結経路、`MAX_FROZEN_WORLDLINES = 20` cap 共有、`FrozenWorldLine = {worldLine, color}` に death metadata なしで型整合) + 新 WL を 1 点から開始。migration の ~2.5s relay gap 両端を `CatmullRomCurve3(centripetal)` が隣接 sample として Hermite 補間し `TubeGeometry` が直線橋を描画する「なめらかな嘘」を発生源ごと除去。閾値 500ms は ping interval (1000ms) の半分で、通常 relay (125Hz/8ms) からの safety margin + 単発 blip (100-200ms) は発火しない。Defensive 側 (`applySnapshot`): 既に `players.has(myId)` なら migration path 判定で自機 state は local 優先、他 peer は pos.t 比較で新しい方採用 (ICE restart / PeerJS 再接続で conn.id 付け替わる corner case の保険)

- **alone 判定 + `setRoleVersion` bump**: 2-tab test で全 peer 切断時に「client ロール + ゴースト 9 文字 ID 残留」で stuck した 3 経路共通の ghost host stuck を解消。
  1. `attemptBeaconFallback` redirect handler で `peerManager.connect(realHostId)` 後に `setRoleVersion((v) => v + 1)` 追加 (旧: bump 漏れで heartbeat effect の deps 不変 → `lastPingRef` / `migrationTriggeredRef` reset されず watchdog 眠ったまま、ghost host は ping を送らないので永久 stuck)
  2. heartbeat timeout の `!newHostId` 分岐で `getConnectedPeerIds().filter(!== oldHostId && !== roomPeerId)` が 0 なら `becomeSoloHost()` 直行 (旧: 無条件 `attemptBeaconFallback` で stale beacon redirect 経由で経路 1 に流入)
  3. `tryBeacon` の `MAX_BEACON_RETRIES` 到達時、`getConnectedPeerIds()` が空なら `demoteToClient` せず 10s backoff で retry (旧: stale beacon entry 未 cleanup で 3 連続 `unavailable-id` → ghost host への demote)

#### 関連原則 (in-place LESSON)

- **不安定な component lifecycle に依存する scheduling は code smell**: setTimeout/setInterval が useEffect cleanup で殺されて永久未発火になる class のバグは state-derived polling に置換する (「myDeathEvent は ref で持つ」旧節も同 class、あちらは deps から外せたが今回は peerManager swap が kill と独立なので poll 化が必須)
- **一方向 trip state flag (false → true) は、reset 経路を漏れなくカバーする責務を明文化**: reset 箇所が内部早期 return しうる hook に居座ると漏れる。そもそも flag を state にせず role transition の 1 関数に閉じ込める方がロバスト (`assumeHostRole` inline 化)
- **transition 直後の副作用は transition 関数内部で同期実行**: flag で外部 hook に通知する設計は責務の所在が曖昧、reset 経路漏れや race を招く
- **silently-failing 初期化路 → source-of-truth observable の retry 経路をセットで**: `players.has(myId)` が初期化済み signal。push 単独は onMessage 登録前の silent drop で永久 blank
- **視覚連続性が幾何補間で暗黙に保証される描画 (CatmullRom / TubeGeometry / sweep) は、data source 側で明示的に不連続性を導入しないと補間器がなめらかな嘘を生成**。gap 検知 → `frozenWorldLines` 切り出しが不連続性マーカー
- **migration 経路で client 遷移させる副作用を置く時、新 host への ping 監視再起動 (`setRoleVersion` bump) をセットで入れる**: `clearBeaconHolder + setBeaconHolderId + connect` の 3 つだけでは React state が動かず watchdog が眠ったまま。`demoteToClient` / `game_redirect` 経路は元々 bump 済みで安全
- **alone (他 peer なし) は solo host の必要条件**: beacon fallback / demoteToClient は real host が別にいる前提。alone 判定 (`getConnectedPeerIds()` 空) が取れた時点で分岐断ち切らないと PeerJS server の stale entry TTL 切れまで ghost host を追うループに

---

## § UI / 入力

### visibilitychange によるゲームループ停止

`document.hidden` のとき、ゲームループ (`setInterval` 8ms) と PeerProvider の ping 送信をスキップ (`clearInterval` ではなくループ内チェック)。

理由: ブラウザはバックグラウンドタブの `setInterval` を throttle する (Chrome: ~1s、Safari: もっと遅い)。throttle されたループが中途半端な頻度で走ると: (1) stale な phaseSpace を低頻度で送信し続ける (2) Lighthouse AI が極低速で動く (3) 座標時間の進行率が異常に低くなる等の不整合が生じる。完全に止めるのが正しい。

チェック位置をループ内にした理由: `clearInterval` + `visibilitychange` で再開するアプローチでは、ループ本体のクロージャを再構築する必要がある (useEffect の deps 問題)。ループ先頭の 1 行 `if (document.hidden) { lastTimeRef.current = Date.now(); return; }` で同等の効果を得られ、`lastTimeRef` 更新で復帰時のジャンプも防止。

既存メカニズムとの連携: ping 停止 → クライアントがハートビートタイムアウト → migration。phaseSpace 停止 → stale 検知。新プロトコル不要。

### モバイルタッチ入力: 全画面ジェスチャ + UI 要素ゼロ

スマホ操作を `touchInput.ts` で実装。横スワイプ=heading、縦変位=thrust (連続値)、ダブルタップ=射撃。画面に描画する UI 要素はゼロ。

画面 100% を 3D ビューに使い、物理デモとしての没入感を最大化。

**採用根拠**:
- thrust はボタン (binary) ではなく縦変位の連続値 — 中間速度巡航ができる
- 射撃はダブルタップ (2 回目を保持) — シングルタッチと自然に区別でき、保持+スワイプで射撃しながら heading+thrust の全操作を 1 本の指で同時実行可能
- heading はフレーム間差分 (相対操作)、thrust はタッチ開始点からの変位 (絶対位置操作) — 非対称性が自然な操作感

HUD のインタラクティブ要素 (ボタン・チェックボックス等) はタッチ入力から除外 (`isInteractiveElement` ガード)。

Keyboard coexistence: ゲームループで keyboard と touch の入力を加算。両方同時に使えるがタッチデバイスでキーボードを使うケースは稀なので問題なし。

**pitch 制御は touch から除外 (2026-04-17)**: 初期は「死亡中のみ縦スワイプを camera pitch に回す」分岐が `processCamera` にあった (生存時の縦スワイプ = thrust と棲み分け)。だが ghost 物理統合 (2026-04-17) で死亡中も thrust 入力で ghost が動くようになり、**縦スワイプ = thrust と pitch rotation が衝突**。ユーザーから「死亡中もスワイプで移動できるべき、回転に切り替わるのは違和感」の報告。

修正: `processCamera` の死亡時 pitch 分岐を削除、`useGameLoop` で `pitchDelta` を毎 tick リセット (蓄積防止)。**縦スワイプは生死問わず thrust に固定**、pitch rotation は PC 矢印キーのみに集約。スマホで pitch 観賞したいニーズが出たら 2 本指縦スワイプ等の別ジェスチャで将来拡張。

設計検討の詳細経緯: [`EXPLORING.md`](./EXPLORING.md) の「スマホ UI の設計思考」および「2026-04-10 の設計議論と方針決定」参照。

### レーザーエネルギー制

`ENERGY_MAX = 1.0`、`ENERGY_PER_SHOT ≈ 0.033` (1/30)、`ENERGY_RECOVERY_RATE ≈ 0.167/s` (1/6)。30 発 (≈3 秒連射) で枯渇、6 秒で 0→満タン。

- 回復は撃っていないときのみ (`!firingNow`)
- `energyRef` (ref) でゲームループ管理、`energy` (state) で HUD 表示
- リスポーン時に満タンリセット
- ネットワーク同期不要 (各プレイヤーがローカルで管理)

旧バグ: 初版では `firedThisFrame` (発射フレームのみ true) で回復を止めていたが、cooldown 100ms に対し 8ms ループで 12 フレーム中 11 フレームが回復 → 枯渇しない。`firingNow` (ボタン押下中) に修正。

### ロビー画面 + i18n + 表示名 + ハイスコア

**ロビー**: START を押した人がホスト。PeerProvider を `gameStarted` 内に移動。Lobby は PeerProvider の外 (`usePeer()` 不使用)。接続レイテンシ ~300-500ms は体感的に問題なし。

**i18n** (`src/i18n/`): 自前 Context + TypeScript 辞書 (ライブラリなし)。`useI18n()` hook で `t(key)`。言語は localStorage `"la-lang"` に永続化、default `"ja"`。~50 文字列で pluralization 不要、react-intl / i18next は過剰、0 依存で ~60 行。`TranslationKey` 型を `ja.ts` から export し compile-time チェック。

**表示名**: 専用 `intro` メッセージ型 (`{ senderId, displayName }`)。接続時に 1 回送信、beacon holder が relay。phaseSpace に相乗りすると毎フレーム +20 bytes/peer の帯域消費、intro は 1 回きりで帯域ゼロに近い。Fallback は `player.displayName ?? id.slice(0, 6)`。

**ローカルハイスコア** (`src/services/highScores.ts`): 純関数。localStorage key `"la-highscores"`、JSON 配列、最大 20 件、kills 降順。セッション境界は Start 押下 → タブ close/reload。

**pagehide 対応**: モバイル Safari では `beforeunload` がバックグラウンド化時に発火しない。`pagehide` リスナーを追加し、`savedRef` フラグで同一アンロードシーケンスの二重保存を防止。`pageshow` で `persisted === true` (bfcache 復帰) なら `savedRef` をリセット。

### 因果律スコア

キルスコアの加算タイミングは「各プレイヤーの過去光円錐に hitPos が入ったとき」。`killLog` の entry が全 peer で独立に観測され、`firePendingKillEvents` が過去光円錐到達を判定してスコアを加算。全員が同じイベントセットを受け取るので最終的に一致 (加算は可換)。

KILL テキストが出るのと同じタイミングでスコアが増えるのが自然。物理デモとしてスコアも因果律に従うべき。

### Ghost (自機死亡中) の燃料制約撤去 + Speedometer 非表示 (2026-04-20)

**動機**: 死亡中のゴースト自機 (= 観測カメラ + 物理体) は、死後の宇宙を自由に観測したいだけで、燃料 (energy) を意識する必要がない。respawn 時にどうせ満タンリセットされるので減算する意味もない。

**変更**:

1. **`useGameLoop.ts` ghost branch**: `processPlayerPhysics(ghostMe, ..., availableEnergy = Number.POSITIVE_INFINITY)` でフル加速常時許可。`energy -= thrustEnergyConsumed` 減算撤去。
2. **`Speedometer.tsx` HUD**: energy bar を `{!player.isDead && (...)}` で wrap、ghost 中は非表示 (バー描画自体スキップ)。

**設計判断**:
- ghost は「観測者の視点としての自由」を提供する状態 → 物理制約を緩めるのは自然 (重力ゼロ・無限燃料・無敵 = 観測者特権)
- HUD バーを残しても永続フル表示で何も意味しないので noise → 消す方が情報密度高い
- speed 表示 (β など) は ghost でも意味あるので残す (どれだけ加速できているかは依然知りたい)

**境界**: respawn 瞬間に energy バーが復活、bar 描画ロジックは `isDead` 判定 1 箇所だけで分岐するので追加 state 不要。Phase C1 の post-hit i-frame / kill 5s 無敵などとは独立。

### 自機 heading source: `cameraYawRef` 直読 fallback (2026-04-22)

**背景**: Phase A-1〜B-2 で自機 heading source を `cameraYawRef` 直読 → `player.phaseSpace.heading` (store 経由) に切替した結果、120Hz ディスプレイ環境で自機回転が 2 frame 量子化されてカクカクする事象が発生。

**原因の分解**:

- Game loop は `setInterval(gameLoop, GAME_LOOP_INTERVAL)` = **60Hz tick** で store を更新
- SelfShipRenderer の `useFrame` は rAF = **display refresh rate (60/120Hz)**
- 120Hz rAF に対して store 更新 60Hz → **2 rAF frame ごとに 1 回しか heading が更新されない** → 同じ yaw が 2 frame 連続で読まれる量子化ジッター
- さらに zustand subscribe → React re-render の遅延が 1 rAF 分上乗せされるケースがある

Phase A 以前 (= `cameraYawRef` 直読) では、ref は subscribe 経路を通らず `useFrame` 内で毎 rAF 即時読めていた。store 更新頻度自体は同じ 60Hz でも「最新値を取り逃す」タイミングが存在しない分、体感ジッターが軽かった。

**対処**: SelfShipRenderer に optional prop `cameraYawRef?: React.RefObject<number>` を追加し、**渡されていれば `useFrame` 内で `cameraYawRef.current` を直読**、渡されていなければ従来通り `quatToYaw(player.phaseSpace.heading)` を使う。SceneContent の自機 path のみ `cameraYawRef` を渡し、OtherShipRenderer / DeadShipRenderer (SelfShipRenderer 流用先) は prop 省略 → 他機は引き続き past-cone 交点補間された `phaseSpace.heading` を読む。

**なぜ A 案 (ref 直読 fallback) を選んだか** (対話ログ凝縮):

| 案 | 更新頻度 | 読取りパス | 備考 |
|---|---|---|---|
| A (ref 直読) | 60Hz (game tick) | ref.current | Phase A 以前と同等、最小変更 |
| B (store 即時) | 60Hz (game tick) | store | subscribe 経由の遅延だけ消える、ref 同頻度 |
| C (rAF 駆動) | 60/120Hz (rAF) | store or ref | game loop 全体の影響大 |
| D (`getState()` 直読) | 60Hz (game tick) | store via `getState()` | B の簡易版、subscribe skip |

A と B は **tick 60Hz 由来の量子化**に対しては同じだが、B/D は store subscribe に起因する re-render 遅延分だけ追加ジッターが残る可能性があった。Phase A 以前に戻せる最小修正 = A。他機は store subscribe が本質 (自機と heading の source が違う) なので fallback path で従来通り。

**境界**: 自機の heading は引き続き game tick 内で store `phaseSpace.heading` にも書き込まれている (useGameLoop が毎 tick `yawToQuat(cameraYawRef.current)` を setPhaseSpace)。これは snapshot / wire 送信 / 世界線 history append のため。render path のみが ref 直読に戻ったというのが正確な差分。

---

