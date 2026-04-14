# DESIGN.md — LorentzArena 2+1

## 設計判断の記録

### Authority 解体アーキテクチャ（2026-04-14 設計、段階的実装中）

**状態**: Stage A〜H **全完了**。commits: A (`4f4bddd`) / B (`8b4932f`) / C (`01fed9d` `c076192` `6ba5174` `49c65bc`) / D (`d0d05f0` `1cc05f9` `b5579fe`) / E (`0491d52`) / F (`3153585` `70f9ac7`) / G (`5de2aed`) / H (本 commit)。詳細プランは `plans/2026-04-14-authority-dissolution.md`

**診断**: 現構造では `host` が (a) beacon 所有者、(b) relay hub、(c) hit detection 権威、(d) Lighthouse 駆動、(e) respawn スケジューラ、(f) peerList 発行者 を兼ねており、**host 切断時に全部を新 host に引き継ぐ必要がある**。マイグレーションが怪物化し、`useHostMigration.ts` で respawn timer 再構築、`hostMigration` メッセージで scores/deadPlayers/deathTimes を丸ごと転送、`lighthouseLastFireRef` の glitch、invincibility の欠落など、漏れやすい。また false positive（通信瞬断の誤検知）のコストが異常に高いため、heartbeat を保守的な 3s/8s に設定せざるを得ない。

**原理（確定済み）**:

0. **データ層と表現層を分離**: 全 peer が全プレイヤーの world line を常時共有（データ層）。相対論的な光円錐遅延は「いつ UI に表示するか」の表現層だけで効かせる。データを光円錐で絞る必要はない。**この原則を見失うと「各 peer は自分の光円錐内のデータしか持てない」と誤解し、設計が無駄に複雑化する**（今回の議論の中盤に実際に一度そうなった）
1. **各プレイヤー（人間 / Lighthouse）は 1 人の peer が owner**。Lighthouse の owner は beacon holder（兼任）
2. **Owner だけが自分のエンティティの event を発信する**: `phaseSpace` / `laser` / `kill`（= 自分が撃たれた自己宣言）/ `respawn`
3. **他 peer について宣言しない**。完全対称
4. **Hit detection は target のローカルだけ**（target-authoritative）。決定論要件なし。Math.sin/cos も自由
5. **Derived state**: score / deadPlayers / invincibility は kill/respawn event から導出。store に authoritative 値を持たない
6. **RNG 不要**: respawn 位置等は owner が local `Math.random` で決めて phaseSpace として broadcast
7. **Coord-time 同期は join 時 1 回だけ**（`syncTime` 廃止、snapshot に埋め込み）
8. **Beacon ≡ relay hub ≡ Lighthouse owner ≡ 新規入口**。star topology 維持、authority は持たない

**「相対論で物理的に美しい」根拠**: あなたの世界線を完全に観測できるのはあなただけ。死亡も同じく自己宣言。物理原理と一致。

**帰結としてマイグレーションで消えるもの**:

- `hostMigration` メッセージの重い payload（scores / deadPlayers / deathTimes / displayNames）
- `respawnTimeoutsRef` の再構築
- `lighthouseLastFireRef` の引き継ぎ課題
- `processedLasers` の重複防止
- 決定論性（固定ステップ格子 / seeded RNG）への全要求
- host/client 二重実装の hit detection

**消えるメッセージ** (実績): `score` (C-1 削除)、`syncTime` / `hostMigration` (H 削除)、`snapshot` 新設 (F-1)。plan で検討した `beaconChange` 通知は各 peer の local election で新 beacon holder を決められるため不要となり新設せず

**残る singular 役割**: beacon 所有（PeerJS ID 制約による物理的 singular）のみ

**Heartbeat の積極化が可能に**: Stage F 以降は false positive のコストが ≈ 0（state 引き継ぎなし、再選出だけ）。3s/8s → 1s/2.5s へ短縮予定

**この節で影響を受ける既存判断**（段階実装後に supersede、現時点では旧設計が生きている）:

- 「当たり判定: ホスト権威 + 世界系での交差計算」→ target-authoritative に
- 「ホストマイグレーション堅牢化」→ beacon-only の軽量化に縮退
- 「START でホスト決定 + クライアント syncTime 初期化」→ syncTime 廃止、OFFSET は snapshot に
- 「score メッセージの未使用」→ メッセージ型ごと削除

**並走 vs cut-over**: 各 Stage は独立 commit。Stage B（hit detection）のみ接触範囲が広いため着手直前に plan mode で具体 diff を提示。他 Stage は localhost multi-tab 検証 + commit で進行。

**mesh 化は直交タスク**。このリファクタの範囲外だが、完了後に独立に検討可能になる。

#### 実装段階で得た判断（Stage B–E）

**B: `kill` の body senderId 検証はしない判断**

Plan Stage B は「`targetId === senderId` を messageHandler で強制」と書いたが、**採用しなかった**。理由:

- body の `senderId` は送信者が自己申告する値。ピア X が `{senderId: Y, victimId: Y}` と書けば通る → **自分で書く値を自分で検証しても spoofing 防御にならない**
- 既存の `phaseSpace` / `laser` / `intro` も `_senderId (PeerJS-level) === msg.senderId` を検証しておらず、このリポはもともと「相互信頼の peer 群」を前提にしている。kill だけ body 検証を追加するのは中途半端
- 二重処理防止は handleKill の `deadPlayers.has(victimId) → return`（Stage C では `selectIsDead`）で既に担保済み
- body senderId 検証の実効は **bug catching のみ**（将来の改修で victimId / killerId の取り違えを runtime で検出）だが、wire bytes を増やす & 他メッセージと非対称になる costs に見合わない

結論: kill message は `{victimId, killerId, hitPos}` の 3 フィールドで、body senderId 自体を持たない。

**真の spoofing 防御は relay 層で `_senderId === msg.senderId` を一律**

悪意のある peer が他人を騙った発信 (`{senderId: Y, ...}` を自分 X が送る) を本当に防ぐには、**host (= relay hub) が DataConnection の直結 peer ID (`_senderId`) と body の `senderId` を照合**する必要がある。WebRTC DataConnection の peer ID は PeerJS が保証する identity なので、この層での検証は意味がある。

ただしこれを導入するなら:
- kill だけではなく **全 owner 発信メッセージ** (`phaseSpace` / `laser` / `intro` / `kill` / `respawn`) に一律適用すべき
- body senderId を持たないメッセージ (現 `kill` / `respawn`) には追加フィールドが必要になる
- relay fail 時の挙動 (ログ？ drop？) を決める必要

本リファクタ (Authority 解体) の目的は「host を authority から外す」ことで、信頼モデルの強化は直交タスク。仮に導入するなら別プランで全メッセージ一律 (kill だけ先行導入は中途半端になるので避ける)。

**C: derived state の 3 択検討と β 採択**

Stage C「deadPlayers / invincibility を event から導出」には設計の幅があり、3 案を検討:

- **α**: `lastKillTime: Map` / `lastRespawnTime: Map` で per-player latest を保持。event log は持たない
- **β**: `killLog[]` / `respawnLog[]` を source of truth、deadPlayers 等は selector 経由で毎回 derive、cache は store に持たない
- **γ**: log + cache 併存。log が authoritative だが deadPlayers 等も store に同時更新（API 互換）

**β を採択**。理由:
- plan 原理 5「authoritative 値を**持たない**」に構造的に忠実（γ は実質 cache が authoritative）
- Stage F の snapshot 配信が log dump で実現できる先行投資になる
- cache 撤去の変更面は ~10 箇所で実際には広くない
- log サイズが GC で小さく保たれるので per-frame O(log) derive のコストは無視可能

**C: `firedForUi` による pending events の log 統合**

`pendingKillEvents` は元々別配列だったが、`KillEventRecord.firedForUi: boolean` を持たせることで `killLog.filter(!firedForUi)` として derive に統合。冗長な二重保持を排除し、原理 0「データ層と表現層を分離」とも整合（データ層 = killLog、表現層 = `!firedForUi` のエントリが UI 反映待ち）。

**C: 「初回 spawn = 初回 respawn」として invincibility 起点を統一**

初期プレイヤー生成時、従来は `invincibleUntil.set(myId, now + INVINCIBILITY_DURATION)` で無敵開始時刻を直接書いていた。Stage C では respawnLog への entry 追加に統一。`selectInvincibleUntil` が latest respawn wallTime + INVINCIBILITY_DURATION を返すため、初回と 2 回目以降の spawn が同じ経路で扱われる。副作用として RelativisticGame / messageHandler の両方から invincibility の直接操作が消え、log への append に単純化。

**C: `gcLogs` の参照同一性トリック**

`gcLogs` は log の transform 結果を返すが、**長さが不変なら入力と同じ array 参照を返す**。useGameLoop は毎フレーム呼ぶため、変化なしの場合に `setState({killLog, respawnLog})` をトリガーしないことで Zustand の購読者再評価を抑制できる。削除のみの transform (filter / latest 抽出) なので「長さ不変 ⇔ 内容不変」が成立し、要素比較不要でこの判定が効く。

**C: GC ルール**

- killLog: `firedForUi === true` かつ対応 respawn が存在する kill → 削除
- killLog: 未 UI 反映 (firedForUi=false) または respawn 未発生は保持
- respawnLog: 各プレイヤーの latest 1 件のみ残す（invincibility 計算に必要十分、古いものは対応 kill とペアで消費済み）
- safety cap (`MAX_KILL_LOG=1000` / `MAX_RESPAWN_LOG=500`): 通常は GC が先に働くので届かないが、GC が何らかのバグで止まっても bounded に保つ保険

**D: respawn schedule が owner-unconditional になる原理**

`processHitDetection` が Stage B で owner 絞り込み済みなので、useGameLoop で hit が検出された時点で「その kill の target は必ず自分が owner」が成立する。したがって respawn schedule を `if (isHost)` で wrap する必要がなく、無条件で target 本人が timer を持つ。

**D: respawn メッセージの発信者変更**

従来 host 一元発信だった respawn を sendToNetwork 経由に切り替え、isRelayable / registerHostRelay に `respawn` を追加。client が自身の respawn を発信 → host 経由で他 client にリレーされる構造。messageHandler の respawn 受信ハンドラから host skip を撤去（host も他 peer の respawn を受信して handleRespawn を呼ぶ必要がある）。

**D-3: migration 時の LH init effect idempotent ガード**

RelativisticGame の初期化 `useEffect([myId, isHost])` は isHost 変化で再実行される。Stage D で client が新 host に昇格すると、この effect が走り `createLighthouse()` で LH を **新規作成して store に上書き**し、LH の位置・世界線・spawn grace が全てリセットされていた（ユーザーからの「LH 継続されない」報告で発見）。

修正: `store.players.get(lighthouseId)` で既存エントリを確認し、存在すれば owner だけ差し替え、位置・世界線は保持。spawn エフェクトや `lighthouseSpawnTime` reset も初回 boot のみ実行。

**E: `lighthouseLastFireTime` の event-sourced 設計**

Plan は「beacon migration 時、新 owner が直近 laser event の coord-time を lastFireTime に採用して continuity を保つ」と記述。これを明示的な migration ロジックではなく、**全 peer が LH laser を観測するたび Map を更新する** 方式で実現した。

- `store.lighthouseLastFireTime: Map<string, number>` を non-reactive state として追加
- messageHandler の `laser` 受信で `isLighthouse(msg.playerId)` なら wallTime を更新
- useGameLoop の LH AI は fire 時にも同 Map を更新
- 結果: どの peer が owner になっても常に最新の observed-fire-wallTime を Map から読むだけで continuity 保持。useHostMigration 側の特別処理不要

**E: `isLighthouse(id)` を authority 構造から切り離す**

Stage E 以降、`isLighthouse` は 3 つの metadata 役割のみを持つ:
1. 色決定 (LIGHTHOUSE_COLOR)
2. AI 分岐 (owner own player が LH なら processLighthouseAI を走らせる; 人間なら processPlayerPhysics)
3. invincibility 除外 (`selectInvincibleIds` で LH はスキップ)

authority や所有構造の判定には使わず、owner 判定は `player.ownerId === myId` に統一。

### リファクタリング現状評価（2026-04-13 更新）

| ファイル | 行数 | 判断 | 理由 |
|---|---|---|---|
| `PeerProvider.tsx` | 1023 | defer | Phase 1 effect のコールバックネストは PeerJS ライフサイクルと密結合。分割しない理由は依然有効 |
| `RelativisticGame.tsx` | ~340 | — | Zustand 移行で 539→340 行に大幅削減。state/ref/callback の大半を store に移行済み |
| `useGameLoop.ts` | ~480 | defer | GameLoopDeps 34→14 props に縮小。内部 ref 化で依存が明確に。行数は微減だがロジック密度は高い |
| `SceneContent.tsx` | ~545 | — | store selectors + レーザー方向マーカー追加で微増。SceneContentProps 12→6 |
| `game-store.ts` | ~255 | — | 新規。handleKill/handleRespawn を store actions として集約 |

**再評価トリガー**: PeerProvider が 1100 行を超えたら分割を再検討。

### Zustand 移行（2026-04-13 実施済み）

**動機**: invincibility 実装で「ref 1 本追加 → 7 ファイル変更」の props drilling 税が顕在化。

**結果**: `src/stores/game-store.ts` に共有ゲーム状態を集約。

| 指標 | Before | After |
|---|---|---|
| GameLoopDeps props | 34 | 14 |
| MessageHandlerDeps props | 15 | 6 |
| SceneContentProps props | 12 | 5 |
| HUDProps props | 16 | 11 |
| RelativisticGame useState | 14 | 6 |
| RelativisticGame useRef | 22 | 3 |
| shadow refs (playersRef 等) | 3 | 0 |

**ストア設計**:

| カテゴリ | 項目 | 購読方式 |
|---|---|---|
| Reactive（コンポーネントが selector で購読） | players, lasers, scores, spawns, frozenWorldLines, debrisRecords, killNotification, myDeathEvent | `useGameStore(s => s.X)` |
| Non-reactive（getState() のみ） | deadPlayers, invincibleUntil, processedLasers, deathTimeMap, pendingKillEvents, pendingSpawnEvents, displayNames, lighthouseSpawnTime | `store.getState().X` |
| Local UI（RelativisticGame） | showInRestFrame, useOrthographic, deathFlash, isFiring, fps, energy | useState |
| Local ref（useGameLoop 内部） | causalFrozen, lighthouseLastFire, lastLaserTime, fpsRef, energyRef, ghostTau | useRef |

**設計判断**:
- `killNotification` と `myDeathEvent` は当初 local 想定だったが、HUD + SceneContent + gameLoop の 3 モジュールが参照 → store (reactive) に昇格
- `lighthouseSpawnTime` は handleRespawn + messageHandler が書き込む → store (non-reactive) に昇格
- `handleKill`/`handleRespawn` は store actions に吸収。`handleRespawnRef` 間接参照パターン解消
- `ghostTauRef` は useGameLoop 内部 ref に移動。myDeathEvent の null⇔非null 遷移を prev-ref で検出して reset
- `getPlayerColor` は PeerProvider 由来のため store に入れず、必要な場所にパラメータで渡す

**教訓: Zustand getState() の stale スナップショット**:
- `const store = getState()` はスナップショット。その後 `set()` が呼ばれると Zustand は `{ ...oldState, ...partial }` で新 state を作成する
- **Set/Map のインプレース変更** (`store.deadPlayers.add(x)`) は新旧 state が同一インスタンスを共有するので**安全**
- **配列の再代入** (`store.pendingKillEvents = filtered`) は old state のプロパティを変えるだけで、new state には反映**されない**（spread 時にコピー済みの古い参照が使われる）
- **ルール**: 配列フィールドの更新は必ず `useGameStore.setState({ field: newArray })` を使う。直接再代入は禁止
- gameLoop では `set()` を跨ぐ読み取りが多いため、causal events セクションのみ `setState()` を使い、他のセクションは各 `set()` 呼び出しが独立で stale にならないことを確認済み

### MAX_DELTA_TAU 撤廃（2026-04-14）

- **What**: `MAX_DELTA_TAU` (100ms → 500ms → 2s → 撤廃) でゲームループの dTau をキャップしていたが、完全に削除
- **Why**: タブ切り替え時の 1-6 秒スパイクで座標時間が削られ、ホストがクライアントより過去に落ちていた。`document.hidden` チェックがタブ復帰を既に処理しているためキャップは二重防御。物理的不安定性リスクは低い（静止時 `pos.t += dTau` のみ、加速中も摩擦が速度を制限）
- **教訓**: 座標時間の進行を壁時計から切り離すとプレイヤー間で累積的にずれる。座標時間は常に壁時計に忠実であるべき

### スポーンエフェクト色の遅延解決（2026-04-14）

- **What**: `PendingSpawnEvent` に `playerId` フィールドを追加。`firePendingSpawnEvents` が発火時に `players.get(playerId)?.color` で最新色を解決
- **Why**: syncTime 時点では joinRegistry 未受信のため `colorForPlayerId`（ハッシュフォールバック）が使われ、peerList 到着後に正しい色に更新されるが、既に作成済みのスポーンエフェクトは古い色のまま。発火時解決にすれば peerList 到着後の正しい色が使われる
- **副次修正**: syncTime プレイヤー作成でも `colorForPlayerId` → `getPlayerColor` に統一。Lighthouse の色は `LIGHTHOUSE_COLOR` 定数を messageHandler に適用（クライアントで別色になる問題を修正）

### gameLoop 後半セクションの stale state 修正（2026-04-14）

- **What**: useGameLoop の Lighthouse AI セクションと hit detection セクションが tick 冒頭の stale `store` スナップショットを使用していた → 各セクション冒頭で `useGameStore.getState()` を再取得
- **Why**: tick 前半の `setPlayers`/`setLasers`/`setState` で state が更新された後、Lighthouse AI が古い `store.players` を読むと因果律ジャンプが正しく発動しない。hit detection も古い位置で判定してしまう
- **パターン**: gameLoop は 1 tick 内で複数の `set()` を呼ぶため、tick を 3 フェーズに分割: (1) cleanup/camera/causal events (stale store OK), (2) ghost/physics (fresh re-read), (3) lighthouse/hit detection (fresh re-read)

### 世界線ジャンプの根本原因と修正（2026-04-13 夜）

- **What**: リスポーン後に世界線が前の位置に飛ぶ現象。過去 3 回の対症療法（stale ref 同期、shadow ref ラッパー、fresh getState 再取得）で治らなかった
- **根本原因**: 自分の phaseSpace メッセージがホスト経由でリレーされて戻ってくる。死亡前の phaseSpace がリスポーン後に到着 → `appendWorldLine`（インプレース変更）が新 WorldLine に古い位置を追加
- **修正**: messageHandler で `playerId === myId` の phaseSpace を無視（ゲームループが自分の位置を管理するため不要）。defense-in-depth として physics updater に WorldLine identity guard (`me.worldLine !== freshMe.worldLine` なら skip) も追加
- **教訓**: `appendWorldLine` がインプレース変更であることが根本の脆弱性。ネットワークリレーによる古いメッセージの到着タイミングと組み合わさって発現。対症療法（読み取り側の fresh 化）では根治できず、**書き込み元を断つ**必要があった

### レーザー方向マーカー（2026-04-13 夜）

- **What**: トリガー中に自機から過去光円錐方向（45° 下向き）に 3 つの三角形マーカーを表示。シーケンシャル方向指示器風（0s/0.5s/1s で順次出現）
- **Why**: レーザーが時空図上でどの方向に飛んでいるか分からないというフィードバック
- **設計**: 三角形は過去光円錐の 45° 斜面上に同一平面で配置。向き = `(cos(yaw), sin(yaw), -1)` を正規化。回転行列で ShapeGeometry を斜面に乗せる。`isFiring` prop を SceneContent に追加
- **配置の考え方**: 発射点から斜め 45° 下に向かって三角形が並ぶ。レーザーのラインは未来方向（上）に伸びるが、マーカーは過去光円錐方向（下）に出すことで「この方向に弾が飛んでいる」ことを示す

### A/D 横移動方向修正（2026-04-13 夜）

- **What**: A キーで右、D キーで左に移動していた。符号を反転して修正
- **Why**: `lateralAccel` の符号が逆。カメラ yaw に対して `yaw + π/2` 方向が lateral なので、A（左）が正、D（右）が負であるべき

### 初回スポーンの統一（2026-04-13 夜）

- **What**: 初回スポーンの過去半直線延長を廃止。全 `createWorldLine()` 呼び出しから origin パラメータを削除。初回スポーンにもリスポーンと同じエフェクトを `pendingSpawnEvents` 経由で追加（自機 + Lighthouse）
- **Why**: 初回スポーンで過去に世界線を無限延長し、過去光円錐交差マーカーを表示していたが、物理的に不自然。リスポーンと同じ扱いに統一
- **影響**: `WorldLine.origin` 常に null。半直線描画コード削除済み。`FrozenWorldLine.showHalfLine` フィールドも削除

### リスポーン後無敵（2026-04-13）

**※ Authority 解体 Stage C-3 で `respawnLog` 派生に再構成済み** (`6ba5174`): `invincibleUntil: Map` は store から撤去、`selectInvincibleIds(state, now)` が `respawnLog` の latest wallTime + `INVINCIBILITY_DURATION > now` で derive。各 peer が独立に latest respawn を観測するため host 権威は不要に。下記は 2026-04-13 当時の設計記録。

- **What**: リスポーン後 10 秒間（`INVINCIBILITY_DURATION`）レーザー被弾しない。初回スポーンも同様。視覚表現は opacity パルス（0.3–1.0、~2Hz）
- **Why**: リスポーン直後に即死するフラストレーション防止
- **設計判断**:
  - **ホスト権威で完結**: `invincibleUntilRef: Map<string, number>` を host の hit detection で参照。新ネットワークメッセージ不要 — 全クライアントが respawn メッセージ受信時に独立にタイマー開始（視覚用）
  - **Lighthouse 除外**: AI は無敵にしない（既存の `LIGHTHOUSE_SPAWN_GRACE` で射撃遅延を別途管理）
  - **ref で管理**: 壁時計ベースのタイマーを state に入れると毎 tick re-render になるため ref で管理。描画側は `Date.now()` ベースの sin 波で参照
- **props drilling 税**: 7 ファイル変更が必要だった → Zustand 移行計画の直接的な動機

### 世界スケール半減（2026-04-13）

**Phase 1** (日中): `SPAWN_RANGE` と `LASER_RANGE` を 20→10 光秒。連動パラメータも半減: `CAMERA_DISTANCE_ORTHOGRAPHIC` 100→50, `CAMERA_DISTANCE_PERSPECTIVE` 15→10, `LIGHT_CONE_HEIGHT` 40→20

**Phase 2** (夜): 残りの全ジオメトリ (threeCache.ts) を半減。HIT_RADIUS、チューブ幅、デブリ、スポーンエフェクト等

**教訓 1: ジオメトリの定数未連動**: `ConeGeometry(40, 40)` がハードコードで `LIGHT_CONE_HEIGHT` と同期していなかった。**定数化したらジオメトリ生成も必ず定数参照にする**

**教訓 2: 二重半減の罠**: threeCache のジオメトリ (例: `SphereGeometry(0.5)`) を半減した上に、それに掛かるスケール乗数 (例: `p.size * 0.75`) も半減すると、実効サイズが 1/4 になる。**ジオメトリ自体を半減したら、スケール乗数は元の値を維持する**。5 箇所で発生し修正: debris size/radius/marker, spawnRing ringRadius, future intersection scales, PLAYER_MARKER_SIZE_OTHER

**教訓 3: 視覚サイズは空間スケールと独立に調整**: プレイヤーマーカー、キルエフェクト、交差マーカー等は「画面上の視認性」が重要で、物理空間と厳密に比例させる必要はない。機械的半減の後に視覚チューニングのパスが必須

### 光円錐描画の再調整（2026-04-13）

- **What**: サーフェス opacity 0.1→0.08 + ワイヤーフレーム opacity 0.12 の 2 層構造に変更（未来/過去各 2 メッシュ、計 4 メッシュ）
- **Why**: サーフェスだけだと円錐に見えないと言われた。旧 DESIGN.md「光円錐の奥行き知覚」エントリの設計を引き継ぎつつ、全体を薄くして骨組みで形を出す方針
- **旧エントリとの差分**: 旧は「FrontSide サーフェス 0.2 + FrontSide ワイヤーフレーム 0.3」→ 今は「DoubleSide サーフェス 0.08 + ワイヤーフレーム 0.12」。DoubleSide に戻したのはスケール半減で光円錐が小さくなり、FrontSide だと見えにくくなったため

### FIRING 表示バグ修正（2026-04-13）

- **What**: エネルギー切れでも FIRING 表示が出ていた。`setIsFiring(wantsFire && energyRef.current >= 0)` → `>= ENERGY_PER_SHOT` に修正
- **Why**: `energyRef.current >= 0` は常に true（エネルギーは 0 以上）。条件が「撃ちたい AND エネルギーが 1 発分ある」であるべき

### コードベース一括整理（2026-04-13）

深い監査の結果、以下を一括実施:

1. **マジックナンバー `constants.ts` 集約**: gameLoop.ts / useGameLoop.ts / SceneContent.tsx / RelativisticGame.tsx に散在していた物理パラメータ（加速度 0.8, 摩擦 0.5, ヒステリシス 2.0）、カメラ定数、ゲームループ定数、描画定数を `constants.ts` に統合。値の変更が 1 箇所で済むように
2. **`sendToNetwork` ヘルパー**: useGameLoop.ts の「ホスト→broadcast / クライアント→sendToHost」パターンが 3 箇所重複 → ヘルパー関数で 1 箇所に
3. **Lighthouse setPlayers バッチ化**: ループ内の個別 `setPlayers`/`setLasers` 呼び出し → ループ外で 1 回のバッチ適用
4. **S-1〜S-5 stale バグ一括修正**: Lighthouse stale 除外、kill+stale 二重 respawn 防止、cleanup 漏れ、recovery 後即座再 stale、死亡中 stale 検知停止
5. **`purgeDisconnected` ヘルパー**: useStaleDetection.ts の 3 重コピペ cleanup ループを共通化
6. **`parseScores` ヘルパー**: messageHandler.ts のスコアバリデーション 3 重重複を共通化
7. **`causalEvents.ts` スコア蓄積最適化**: ループ内の `{ ...scores, [key]: val }` spread → 事前コピー + 直接代入
8. **SceneContent.tsx マジックナンバー定数化**: 光円錐高さ 40、カメラ距離 100/15、プレイヤーマーカーサイズ 0.42/0.2

defer 理由: PeerProvider.tsx の Phase 1 callback hell (L310-530) は PeerJS ライフサイクルと密結合しており、refactor リスクが利益を上回る。RelativisticGame.tsx の state/ref 30 個は分割しても引数爆発するため現状維持。残存臭 #2-#4 は引き続き defer（DESIGN.md 末尾の判断に変更なし）。

### game/ のファイル配置: flat vs subdirectory（2026-04-12）

- **What**: SceneContent 分割の renderers は `game/` 直下に flat 配置（`WorldLineRenderer.tsx` 等）、HUD 分割は `game/hud/` サブディレクトリ
- **Why**: Renderers は独立した描画モジュールで相互参照がなく、SceneContent.tsx からのみ import される。HUD サブコンポーネント（ControlPanel, Speedometer, Overlays, utils）は共有ユーティリティ（`utils.ts`）があり、テーマ的に密結合しているためサブディレクトリでグループ化。`game/` 直下のファイル数抑制（19→20 vs 19→23）も考慮
- **基準**: 共有ユーティリティがあるか、3ファイル以上の密結合グループか → サブディレクトリ。独立モジュールの列挙 → flat

### visibilitychange によるゲームループ停止（2026-04-12）

- **What**: `document.hidden` のとき、ゲームループ（`setInterval` 8ms）と PeerProvider の ping 送信をスキップ。`clearInterval` ではなくループ内チェック
- **Why**: ブラウザはバックグラウンドタブの `setInterval` を throttle する（Chrome: ~1s、Safari: もっと遅い）。throttle されたループが中途半端な頻度で走ると、(1) stale な phaseSpace を低頻度で送信し続ける (2) Lighthouse AI が極低速で動く (3) 座標時間の進行率が異常に低くなる等の不整合が生じる。完全に止めるのが正しい
- **チェック位置をループ内にした理由**: `clearInterval` + `visibilitychange` で再開するアプローチでは、ループ本体のクロージャを再構築する必要がある（useEffect の deps 問題）。ループ先頭の 1 行 `if (document.hidden) { lastTimeRef.current = Date.now(); return; }` で同等の効果を得られ、`lastTimeRef` 更新で復帰時のジャンプも防止
- **既存メカニズムとの連携**: ping 停止 → クライアントがハートビートタイムアウト → migration。phaseSpace 停止 → stale 検知。新しいプロトコル不要

### ~~syncTime のタイミング問題とその解決~~（2026-04-12 → 2026-04-13 廃止）

~~`requestPeerList` による syncTime 再送パターン。~~ PeerProvider を START 後にマウントする設計変更（「START でホスト決定」参照）で問題自体が消滅し、`requestPeerList` メッセージ型は完全に削除された

### ~~setPlayers ラッパーによる stale ref 根絶~~（2026-04-12 → 2026-04-13 Zustand 移行で廃止）

Zustand の `getState()` が同期的に最新値を返すため、shadow ref + ラッパーパターン自体が不要になった。`playersRef`/`lasersRef`/`scoresRef` の 3 つの shadow ref を全廃

### 灯台因果律ジャンプ（2026-04-12）

- **What**: 灯台（Lighthouse AI）が誰かの過去光円錐内に落ちたら、最も過去にいる生存プレイヤーの座標時間にジャンプ
- **Why**: 灯台は静止（γ=1, dt=dτ）だがプレイヤーが加速すると dt=γ·dτ で座標時間が速く進み、灯台が置いていかれる。従来は因果律ガード（フリーズ）から灯台を除外していたため因果律が破れていた。フリーズは灯台には不適切（プレイヤーに入力がないので永久にフリーズし続ける）。ジャンプなら灯台の世界線は時間方向に不連続になるが、因果律は保たれる
- **検出条件**: 任意のプレイヤー P について、灯台 L との差 `L.pos - P.pos` がミンコフスキー的に時間的（l < 0）かつ L.t < P.t → L は P の過去光円錐内
- **ジャンプ先**: 全生存プレイヤーの座標時間の最小値。最も遅れているプレイヤーに合わせることで、全員に対して因果律を回復

### リスポーン座標時間の全員死亡フォールバック（2026-04-13）

- **What**: `getRespawnCoordTime()` を `game/respawnTime.ts` に抽出。生存者がいれば最大の座標時間、全員死亡なら `Date.now()/1000 - OFFSET`（壁時計対応の座標時間）にフォールバック
- **Why**: 従来は全員死亡時 `maxT = 0` にフォールバックし、ページロード直後の時刻にリスポーンしていた。3箇所（useGameLoop, useHostMigration, messageHandler）で同じロジックが重複していた
- **`createRespawnPosition`**: 座標時間 + ランダム空間位置の生成も同ファイルに抽出し、3箇所を1行呼び出しに統一

### ホストマイグレーション堅牢化（2026-04-13）

**※ Authority 解体 Stage D で大半が縮退済み** (`1cc05f9`): 人間の respawn timer は各 owner がローカル保持、useHostMigration の仕事は Lighthouse owner 書き換え + LH 死亡中の respawn 再 schedule のみ。hostMigration メッセージ自体の廃止と beacon ownership 化は Stage F で完了予定。`plans/2026-04-14-authority-dissolution.md` Stage F

エッジケース監査で発見した 6 件の問題を修正。ビーコン PeerJS ID の一意性を single source of truth として活用する設計。

#### 修正した問題

| # | 問題 | 修正 |
|---|---|---|
| 1 | 選出ホストが接続してこない → 永久ハング | 10s タイムアウト → `attemptBeaconFallback` |
| 2 | peerOrderRef ずれで間違ったホスト選出 | #1 のタイムアウトで自動緩和 |
| 3 | peerOrderRef 空 → ルーム分裂 | ソロホスト化の前にビーコン接続を試行 |
| 4 | ビーコン redirect 先がオフライン → ハング | 10s タイムアウト → ビーコン再接続、最大 3 回リトライ |
| 5 | ビーコン作成が `isMigrating` 完了まで遅延 | `isMigrating` をビーコン effect から完全除去。`roleVersion` でトリガー |
| 6 | dual-host 分裂（peerOrderRef ずれで 2 ノードが同時にホスト化） | ビーコン取得 3 回失敗 → 降格（下記） |

#### ビーコンベースのホスト降格

- **What**: ビーコン PeerJS ID (`la-{roomName}`) を取得できないホストは、別のホストが存在すると判断して降格
- **Why**: PeerJS ID は世界に1つ。ビーコン取得の成否がホストの正統性を決定するtiebreaker
- **フロー**: ビーコン取得 3 回失敗 → discoveryPm でビーコンに接続 → redirect で本物のホスト ID 取得 → 自分のクライアントに `{ type: "redirect", hostId }` を broadcast → `clearHost()` + 本物のホストに接続 → `setRoleVersion(v+1)` で全 effect 再評価
- **クライアント側**: `game_redirect` ハンドラ（heartbeat detection effect 内）が mid-game redirect を処理。旧ホスト切断 → 新ホストに接続 → heartbeat リセット
- **安全弁**: discoveryPm がビーコンに 8 秒接続できない場合（ビーコン保持者がクラッシュ済み）、降格を中止してビーコンリトライを再開

#### roleVersion による effect 再評価

- **What**: `roleVersion` state を追加。**全てのロール変更時**（ホスト昇格・ソロホスト化・降格）にインクリメントし、`getIsHost()` をチェックする 4 つの effect の deps に含める
- **Why**: `peerManager.setAsHost()` / `clearHost()` は PeerManager の内部フラグを変更するが React state 参照は変わらない。effect の deps が変わらないと cleanup + 再実行が起きず、(a) ビーコンが作成されない (b) heartbeat send/detect の切り替えが起きない (c) peerList broadcast が開始/停止しない
- **`assumeHostRole()`**: `clearHost + setAsHost + registerStandardHandlers + setRoleVersion` の4操作をバンドル。「`setAsHost()` には必ず `setRoleVersion` が伴う」という不変条件を構造的に保証。ホスト昇格・ソロホスト化の2箇所で使用
- **biome-ignore**: `roleVersion` は effect body 内で直接参照されないため biome が「不要な dep」と警告する。`biome-ignore lint/correctness/useExhaustiveDependencies` で抑制
- **教訓**: `isMigrating` をビーコン effect の deps に入れてトリガーに流用する方式は一度実装したが、ガードとトリガーの二重目的が混乱を招き即座にバグを再発させた。`roleVersion` のような単一目的のカウンターが正しい抽象化

#### cleanup 監査結果

heartbeat detection effect と beacon effect の全リソースを監査。3 件の cleanup 漏れを修正:
- `beacon_fallback` メッセージハンドラ: effect cleanup で `offMessage` されていなかった
- `beaconTimer`: `migrationTimerCleanupRef` に追跡されていなかった
- `discoveryTimeout` / `discoveryPm`: beacon effect cleanup で `clearTimeout` / `destroy` されていなかった

#### 既知の限界

- redirect リトライ最大 3 回で打ち切り（4 連続ホストクラッシュは非対応）
- 降格後のビーコン `roomPeerId` 接続が cleanup で切断されない（PeerJS の idle タイムアウトに委任）
- ~~ホスト ID 問題~~ → **解決済み** (2026-04-13): ホスト ID 根本修正で `la-{roomName}` をビーコン専用に変更。詳細は「ホスト ID 根本修正」セクション参照

### START でホスト決定 + クライアント syncTime 初期化（2026-04-13）

**※ Authority 解体 Stage F-1 / H で `syncTime` は廃止済み** (`3153585` / 本 commit): OFFSET は新規 join 時の `snapshot` メッセージに埋め込まれる。Stage H で型定義とハンドラも削除済み。

- **What**: PeerProvider を START 後にマウントし、最初に START を押した人がホストになる。クライアントは自己初期化せず、syncTime でホストの座標時間にスポーン
- **Why**: (1) ロビーで放置した人がホストになる問題。ページロード順ではなく START 順でホスト決定すべき (2) クライアントが自己初期化でローカル時刻（小さい値）のプレイヤーを作り、syncTime 到着前にホスト視点で「過去側」に出現する問題
- **実装**: App.tsx で `PeerProvider` を `gameStarted` 内に移動。Lobby は PeerProvider の外（`usePeer()` 除去）。RelativisticGame の init effect に `if (!isHost) return` を追加し、クライアントのプレイヤー作成は messageHandler の syncTime ハンドラが担当
- **トレードオフ**: START 押下後に ~300-500ms の接続レイテンシ（旧: ロビー裏で接続完了）。体感的には問題にならないレベル
- **クライアントの安全な空回り**: クライアントは syncTime 到着まで `players.get(myId) === undefined`。ゲームループ内の全参照は `?.` または `if (myPlayer)` でガードされており、phaseSpace のゴミデータは送信されない。ホスト未 START でも安全
- **ホストマイグレーション時の init effect 再発火**: クライアントがプレイヤー未作成のまま（ホスト未 START）ホストが切断 → `assumeHostRole()` → `isHost` が true に変化 → init effect の deps `[myId, isHost]` が変わり再実行 → `prev.has(myId)` は false → プレイヤー新規作成。新ホストは自分の時刻で始まり、他に誰もいないので相対的なずれもない

### ホスト ID 根本修正: `la-{roomName}` ビーコン専用化（2026-04-13）

- **What**: ホストが `la-{roomName}` をゲーム PM の PeerJS ID として使う設計を廃止。全ピア（ホスト含む）がランダム ID でゲーム接続し、`la-{roomName}` はビーコン（発見専用）のみに使用
- **Why**: 旧設計ではホストの tab-hidden 復帰時に ID が `la-{roomName}` → ランダム ID に変わり、joinRegistry index が変化して色が変わっていた。ad-hoc パッチ（`previousId` in intro, joinRegistry 置換 hack）は複雑すぎたため revert していた
- **実装**: Phase 1 を 2 段階に分割:
  1. `la-{roomName}` で一時 PM を作成（ビーコンプローブ）。成功 → `beaconRef.current` に格納
  2. `localIdRef.current`（ランダム ID）でゲーム PM を作成。open → `setAsHost()`, 標準ハンドラ登録
  - ビーコンの redirect ハンドラはゲーム PM open 後に登録（`hostId` 確定後）
  - プローブ中に来たクライアントには `getConnectedPeerIds()` で遡って redirect 送信
- **変更箇所**: `PeerProvider.tsx` のみ。Phase 1 書換え、Phase 2 の joinRegistry hack 削除、tab-hidden 復帰を `"trying-host"` に変更、ビーコン effect ガードを `beaconRef.current` チェックに変更
- **レースコンディション**: ビーコンプローブ成功 → ゲーム PM open の間に別ピアが来ても、ビーコン PM が `la-{roomName}` を占有中なので競合しない
- **構造的効果**: 初期ホスト・マイグレーション後ホスト・tab-hidden 復帰ホストがすべて同じパターン（ランダム ID + ビーコン）に統一。Phase 2 の joinRegistry 色修正 hack は不要になり削除
- **ゲーム PM エラー時のビーコン解放**: Phase 1 でビーコン取得後にゲーム PM が PeerServer エラーで失敗した場合、ビーコンだけが生き残って `la-{roomName}` を永続的に占有するバグを防ぐため、ゲーム PM の `onPeerStatusChange` error 分岐で `beaconRef.current.destroy()` を実行。`onPeerStatusChange` が上書き式（PeerManager は 1 コールバックのみ）なので、open と error の処理を同一コールバック内に統合
- **ビーコン所有権のライフサイクル**: Phase 1 が作ったビーコンはビーコン effect とは独立。ビーコン effect は `beaconRef.current` が既に存在する場合に早期 return し、cleanup function は登録されない（`undefined`）。Phase 1 ビーコンの破壊は tab-hidden ハンドラ（`beaconRef.current.destroy()`）のみが担当
- **トレードオフ — クライアント接続レイテンシ**: 旧設計では Phase 2 クライアントが `la-{roomName}` = ゲームホストに直接接続。新設計では常にビーコン経由 redirect を経由するため ~100-200ms の追加レイテンシ。ロビーの初回接続時のみの一回きりなので許容

### デブリの相対論的速度合成（2026-04-12）

- **What**: デブリ速度を被撃破機の固有速度空間で生成。ランダム kick を固有速度 (γv) に加算し、`ut = √(1+ux²+uy²)` で正規化してから 3速度 `v = u/γ` に変換
- **Why**: 従来はランダム方向のみで被撃破機の速度を無視していた。ローレンツブースト行列による変換（最初の実装）は正しいが重い。固有速度空間での加算はより自然で軽量: (1) 足し算なので直感的 (2) `|v| < 1` が正規化で自動保証 (3) 行列演算不要
- **パラメータ**: kick 幅 0〜0.8 (γv 単位)。高速移動中の撃破ではデブリが進行方向に偏る

### useGameLoop の依存管理設計（2026-04-12）

- **What**: useGameLoop hook の useEffect 依存を `[peerManager, myId]` のみにし、他の deps は全て closure で直接捕獲
- **Why**: 初回実装では deps オブジェクトを `[deps]` で依存に入れたが、オブジェクトリテラルは毎レンダリングで新規作成されるため毎回 cleanup → 再生成が走り、respawn タイマーがクリアされてリスポーン不能になった。depsRef パターンで迂回したが、これは新たなスパゲッティ。真の分析: 30+ フィールドのうち参照が変わりうるのは peerManager と myId のみ（ref は安定、React setState は安定、useCallback([]) は安定、handleKill/handleRespawn は myId 依存で連動）
- **教訓**: useEffect の依存配列は「何が変わりうるか」の安定性分析が必須。オブジェクトをまとめて渡すと分析が隠蔽される

### ゴースト reducer の React batch race（2026-04-12）

- **What**: リスポーン時に旧世界線と新世界線が繋がる
- **根本原因**: ゴースト中の `setPlayers((prev) => ({ ...me, phaseSpace: ghostPos }))` と `applyRespawn` の `setPlayers` が同じ React 18 batch で実行されると、ゴースト reducer の `...me` スプレッドが respawn で作った新 WorldLine を旧 WorldLine で上書きする
- **修正**: ゴースト reducer で `if (!me.isDead) return prev` を追加。respawn が先に走っていれば isDead は false → ゴースト更新スキップ
- **教訓**: 「setState reducer は純関数に保つ」の延長。**同じ state を更新する複数の setPlayers が同一バッチに入る場合、各 reducer は他の reducer が先に走った可能性を考慮すべき**。isDead フラグはここで「respawn 済みか」の判定に使える

### グローバルリーダーボード: Cloudflare KV 単一キー設計（2026-04-12）

- **What**: リーダーボード全エントリを KV の単一キー `"top"` に JSON 配列として格納。Worker 側でトップ 50 フィルタ（read → 比較 → 条件付き write）
- **Why**: KV は値サイズ 25 MB まで。50 エントリ × ~100 bytes ≈ 5 KB で十分収まる。単一キーなら read 1 回 + write 最大 1 回で完結。トップ 50 に入らないスコアは read only（無料枠 100K reads/日で十分）。write は条件付きなので無料枠 1K writes/日を大幅に節約
- **トレードオフ**: 同時書き込みの last-write-wins。物理デモゲームでは許容

### sendBeacon CORS: text/plain 選択（2026-04-14）

- **What**: `submitScore` の `sendBeacon` で送る Blob の Content-Type を `application/json` → `text/plain` に変更
- **Why**: `sendBeacon` は CORS preflight (OPTIONS) をサポートしない。`application/json` は CORS セーフリストに含まれないため preflight が必要 → ブラウザがリクエストを黙って捨てていた。`text/plain` はセーフリストなので preflight 不要。Worker 側の `request.json()` は Content-Type に依存せず body をパースするため Worker 変更不要
- **影響**: 上記 KV 設計(4/12)のデプロイ時から本修正(4/14)まで、グローバルリーダーボードは dead 機能だった（Worker + KV は正常、クライアントからの送信が到達していなかった）
- **教訓**: `sendBeacon` で使える Content-Type は `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain` のみ。JSON を送りたい場合は `text/plain` で包む

### handleKill 二重キル防止ガード（2026-04-14）

- **What**: `handleKill` 冒頭に `if (state.deadPlayers.has(victimId)) return` を追加
- **Why**: ハイスコアに異常値（6099 キル / 1:48）が報告された。デバッグ調査で現行コード（Zustand 移行後）は kill rate 0.1/s で正常と確認。異常値は Zustand 移行前後の過渡期のものと推定。防御的ガードとして追加。hit detection (`processHitDetection`) の `deadIds.has()` チェックと二重防御
- **調査方法**: `handleKill`, `firePendingKillEvents`, `processHitDetection` にデバッグカウンターを仕込み、ホスト・クライアント両方で kill rate を計測。3 秒間隔で `console.warn` 出力

### score メッセージの未使用（2026-04-14 発見）

**※ Authority 解体 Stage C-1 で型ごと削除済み** (`01fed9d`): score は全 peer が `killLog` から独立に count する derived 値に正式化。scores フィールド自体は store に残り、`firePendingKillEvents` が過去光円錐到達時に加算する経路は維持。

- **What**: メッセージタイプ `score` は `message.ts` に型定義があり `messageHandler.ts` に受信ハンドラがあるが、**送信箇所が存在しない**（dead code）。スコアはホストから同期されず、各クライアントが `firePendingKillEvents` で独立に計算している
- **Why not fix now**: 現状はホスト・クライアント両方が同じ `pendingKillEvents` → `firePendingKillEvents` のパイプラインでスコアを算出しており、結果は収束する（各イベントが過去光円錐に入る時刻が異なるだけ）。`hostMigration` メッセージにはスコアが含まれるため、マイグレーション時に同期される。将来的にスコア不整合が問題になったら score 同期を実装する

### Stale プレイヤー処理の設計整理（2026-04-12 監査）

現状の stale 処理は複数のバグ修正で有機的に成長し、以下の問題を抱えている。次回リファクタリングで統一的に修正する。

#### 現在の構造

```
stale 検知（ゲームループ内、毎 tick）
├── 壁時計 5 秒更新なし → staleFrozenRef.add(id)  [切断・タブ停止]
└── 座標時間進行率 < 0.1 → staleFrozenRef.add(id) [タブ throttle]

stale 回復（messageHandler、phaseSpace 受信時）
└── staleFrozenRef.has(playerId) かつ isHost → respawn + delete

stale 除外
├── 因果律ガード: staleFrozenRef.has(id) → skip
├── 死亡中プレイヤー: isDead → stale 検知しない
└── visibilitychange: document.hidden → ゲームループ停止 → 検知も止まる
```

#### 修正済み（2026-04-13 一括解消）

| # | 問題 | 修正 |
|---|---|---|
| S-1 | Lighthouse が stale 検知から除外されていない | `checkStale` で `isLighthouse(id) → continue` 追加 |
| S-2 | Kill + stale の二重 respawn | `useGameLoop` の kill 処理で `staleFrozenRef.delete(victimId)` 追加 |
| S-3 | `lastCoordTimeRef` の cleanup 漏れ | `purgeDisconnected` ヘルパーで 3 ref 一括 cleanup |
| S-4 | stale recovery 時の `lastCoordTimeRef` 未リセット | `recoverStale` で `lastCoordTimeRef.delete(playerId)` 追加 |
| S-5 | 死亡中に stale 検知が止まる | `stale.checkStale` を isDead 分岐の外に移動 |

`useStaleDetection` hook に 3 重コピペだった cleanup ループを `purgeDisconnected` ヘルパーに統一。

### ロビー画面 + i18n + 表示名 + ハイスコア（2026-04-12）

#### ロビー画面: ~~PeerProvider の内側で gate~~ → START で PeerProvider マウント

- ~~旧設計 (2026-04-12): PeerProvider を常時マウントし、ロビー裏で接続完了~~
- **現設計 (2026-04-13)**: PeerProvider を `gameStarted` 内に移動。START を押した人がホスト。Lobby は PeerProvider の外（`usePeer()` 不使用）。接続レイテンシ ~300-500ms は体感的に問題なし。詳細は「START でホスト決定」参照

#### i18n: 自前 Context + TypeScript 辞書（ライブラリなし）

- **What**: `src/i18n/` に `I18nContext` + `translations/{ja,en}.ts`。`useI18n()` hook で `t(key)` 関数を取得。言語は localStorage `"la-lang"` に永続化、default `"ja"`
- **Why**: ~50 文字列で pluralization 不要。react-intl / i18next は過剰。0 依存で ~60 行
- **型安全**: `TranslationKey` 型を `ja.ts` から export し、`t()` の引数を compile-time チェック

#### 表示名: 専用 `intro` メッセージ型

- **What**: 接続時に `{ type: "intro", senderId, displayName }` を 1 回送信。ホストが全ピアにリレー。`hostMigration` に `displayNames?: Record<string, string>` を含めてマイグレーション時に引き継ぎ
- **Why**: phaseSpace に相乗りすると毎フレーム +20 bytes/peer の帯域消費。intro は 1 回きりなので帯域ゼロに近い。phaseSpace は物理データのみに保つ関心分離
- **Fallback**: intro 到着前は `player.displayName ?? id.slice(0, 6)` で表示

#### ハイスコア: localStorage のみ

- **What**: `src/services/highScores.ts` に純関数。localStorage key `"la-highscores"`、JSON 配列、最大 20 件、kills 降順。`beforeunload` でセッション終了時に保存（kills > 0 時のみ）
- **Why**: relay server は stateless message bus で DB なし。Cloudflare KV は物理デモには過剰。localStorage はデバイス単位だが、1 デバイス = 1 プレイヤーで実用上問題なし
- **セッション境界**: Start 押下 → タブ close/reload
- **pagehide 対応 (2026-04-13)**: モバイル Safari では `beforeunload` がバックグラウンド化時に発火しない。`pagehide` リスナーを追加し、`savedRef` フラグで同一アンロードシーケンスの二重保存を防止。`pageshow` で `persisted === true`（bfcache 復帰）なら `savedRef` をリセットし、追加プレイ分を次回 exit で保存可能に

### ホストタブ hidden 時の PeerJS ID 解放（2026-04-13）

- **What**: ホストのタブが 5 秒以上 hidden になったら PeerManager + ビーコンを destroy し、`la-{roomName}` PeerJS ID を解放。タブ復帰時は Phase 1 から再接続
- **Why**: ホストのタブが hidden でも PeerJS シグナリング WebSocket は生きたまま。`la-{roomName}` が解放されず、新ホストのビーコン作成が永続的に失敗 → MAX_BEACON_RETRIES で誤った降格が発動していた
- **`HOST_HIDDEN_GRACE = 5000`**: `HEARTBEAT_TIMEOUT = 8000` より短い必要がある（クライアントがマイグレーション発動する前に ID を解放するため）。5 秒未満の alt-tab はキャンセルされ無害
- **タブ復帰**: `wasDestroyedByHideRef` で「hidden 中に破壊されたか」を追跡。復帰時に `setConnectionPhase("trying-host")` → Phase 1 で `la-{roomName}` が空なら再ホスト化、ビーコンが持っていればクライアントとして参加
- **effect deps**: `[peerManager]` — PM が null になると effect 再実行、新しい listener が登録される。PM 破壊前の古い listener は cleanup で除去

### ホストマイグレーション（2026-04-11）

- **What**: ホスト切断時に最古参クライアントが自動昇格し、ゲームを継続する仕組み。PeerJS / WS Relay 両方で動作
- **Why**: ホストのブラウザクラッシュ/リロードでセッションが崩壊するのは物理デモとしてもゲームとしても脆い
- **Key decisions**:
  - **選出**: peerList の順序（= 接続順）で決定。全クライアントが同じリストを持つので合意は自動的に成立
  - **PeerJS ID 非再取得**: 旧ホストの `la-{roomName}` を再登録せず、新ホストは自分のランダム ID のまま他クライアントに直接接続。PeerServer の ID 解放タイムラグ問題を回避
  - **proactive peerList**: ホストが接続変化時に全クライアントへ peerList をブロードキャスト（既存 requestPeerList は誰も送っていなかった）。マイグレーション選出の前提
  - **状態引継ぎ**: `hostMigration` メッセージでスコア + dead players（deathTime 付き）を送信。syncTime は世界時刻をリセットするためマイグレーション中はスキップ
  - **respawn タイマー再構築**: `deathTimeMapRef` で kill 時の `Date.now()`（ローカル壁時計、世界系座標時刻ではない）を記録。新ホストが `remaining = RESPAWN_DELAY - (Date.now() - deathTime)` で残り時間を計算し `setTimeout` を再設定。0 以下なら即リスポーン
  - **WS Relay race 対策**: 非新ホストの `join_host` を 500ms 遅延し、新ホストの `promote_host` がルーム作成を完了するのを待つ
  - **relay server**: `host_closed` に surviving peers リストを同梱。`promote_host` ハンドラで新ルーム作成
- **ハートビート方式**: WebRTC DataConnection の close イベントは ICE タイムアウト依存で 30 秒以上（localhost では事実上無限）。ホストが 3 秒ごとに `ping` メッセージを送信し、クライアントが 8 秒間受信しなければホスト切断と判定。テストで即時検知を確認
- **stale 接続クリーンアップ**: マイグレーション時に `disconnectPeer(oldHostId)` で旧ホストの DataConnection を明示的に close + conns から除去。UI に旧ホストが残り続ける問題を解消
- ~~**制限**: マイグレーション後に新規ジョイナーが別セッションになる~~ → **解決済み**: ビーコン専用化（「ホスト ID 根本修正」参照）で新規ジョイナーは常にビーコン経由でリアルホストに接続

### レーザーエネルギー制（2026-04-11）

- **What**: レーザー発射にエネルギーを消費する仕組みを導入。30 発（≈3 秒連射）で枯渇、6 秒で 0→満タン回復
- **Why**: Space/ダブルタップ押しっぱなしの無限連射で画面がレーザーで埋まり、射撃に判断コストがなかった。エネルギー管理で射撃タイミングの戦略性を導入
- **Key decisions**:
  - 回復は撃っていないときのみ（`!firingNow`）。撃ちながら回復だと実質無限に撃てて意味がない
  - `energyRef`（ref）でゲームループ管理、`energy`（state）で HUD 表示。毎フレーム setState は MEDIUM 検討課題として許容
  - リスポーン時に満タンリセット
  - ネットワーク同期不要（各プレイヤーがローカルで管理）
- **バグ修正**: 初版では `firedThisFrame`（発射フレームのみ true）で回復を止めていたが、cooldown 100ms に対し 8ms ループで 12 フレーム中 11 フレームが回復→枯渇しない。`firingNow`（ボタン押下中）に修正

### 因果律スコア（2026-04-11）

- **What**: キルスコアの加算タイミングを「ホスト即時」→「各プレイヤーの過去光円錐に hitPos が入ったとき」に変更
- **Why**: 物理デモとしてスコアも因果律に従うべき。KILL テキストが出るのと同じタイミングでスコアが増えるのが自然
- **Key decisions**:
  - `pendingKillEventsRef` に全キルイベントを積む（以前は自分が当事者のときのみ）
  - スコアは各プレイヤーがローカルで加算。全員が同じイベントセットを受け取るので最終的に一致（加算は可換）
  - `score` ブロードキャストメッセージの送信を廃止。途中参加時は `syncTime` にスコアを含めて一括同期。型定義・受信ハンドラは後方互換で残存（旧バージョンクライアントが送る可能性を保持）

### モバイルタッチ入力: 全画面ジェスチャ + UI 要素ゼロ（2026-04-11）

- **What**: スマホ操作を `touchInput.ts` で実装。横スワイプ=heading、縦変位=thrust（連続値）、ダブルタップ=射撃。画面に描画する UI 要素はゼロ
- **Why**: 画面 100% を 3D ビューに使い、物理デモとしての没入感を最大化。ボタンやスティックを置くと画面が狭くなり、小さいスマホでは致命的
- **Alternatives considered**:
  1. 加速ボタン + yaw スティック + fire ボタン（3 要素）→ 画面を占有しすぎ
  2. 加速ボタン + スワイプ heading + 静止タッチ fire → 射撃しながら heading 回転ができない
  3. 加速レバー（連続値）+ スワイプ + タップ → レバー 1 つでも画面を占有。しかし縦スワイプで thrust を表現すれば不要
- **Key decisions**:
  - thrust は縦変位の連続値（タッチ開始点からの距離で推力が変わる）。ボタン（binary）だと中間速度巡航ができないが、連続値なら 0.3c と 0.9c を意図的に使い分けられる
  - 射撃はダブルタップ（2 回目を保持）。シングルタッチと自然に区別でき、保持+スワイプで射撃しながら heading+thrust の全操作を 1 本の指で同時実行可能
  - heading はフレーム間差分（`lastX` からの `dx`）で累積、thrust はタッチ開始点からの変位（`startY` からの `dy`）。heading は相対操作、thrust は絶対位置操作という非対称性が自然な操作感を生む
  - HUD のインタラクティブ要素（ボタン・チェックボックス等）はタッチ入力から除外（`isInteractiveElement` ガード）
- **Keyboard coexistence**: ゲームループで keyboard と touch の入力を加算。両方同時に使えるがタッチデバイスでキーボードを使うケースは稀なので問題なし
- **設計検討の詳細経緯**: [`EXPLORING.md`](./EXPLORING.md) の「スマホ UI の設計思考」および「2026-04-10 の設計議論と方針決定」参照

### myDeathEvent は ref 一本で持つ（2026-04-10）

- **What**: `myDeathEvent`（kill 時のゴーストカメラ用 DeathEvent）を `useState` ではなく `useRef` のみで管理。HUD には `myDeathEventRef.current` を直接渡す
- **Why**: state で持つとゲームループ useEffect の deps に入り、kill のたびに effect がクリーンアップ → respawn timeout が clearTimeout される → **ホストがリスポーンしない**致命バグ。ref なら effect を再実行しない
- **HUD の re-render 保証**: `handleKill` は `setPlayers(applyKill(...))` を必ず呼ぶので re-render が走る。その時点で `myDeathEventRef.current` は既にセット済み。`ghostTauRef` と同じパターン

### ICE servers: 静的 env → 動的 credential fetch（2026-04-10）

- **What**: `VITE_TURN_CREDENTIAL_URL` が設定されていれば、アプリ起動時に Cloudflare Worker から短命 TURN credential を fetch し、ICE servers に使う。未設定なら従来の `VITE_WEBRTC_ICE_SERVERS`（静的 JSON）にフォールバック。さらに未設定なら PeerJS デフォルト（STUN のみ）
- **Why**: 学校ネットワーク（Symmetric NAT + FQDN blacklist）で WebRTC P2P が不可。Open Relay (`openrelay.metered.ca`) は全ポート遮断されている（`network-notes/notes/a.md` 参照）。Cloudflare TURN (`turn.cloudflare.com`) は全ポート開通しており、Cloudflare インフラは構造的にブロック不能。短命 credential は Worker で発行し API token を隔離
- **Alternatives considered**: (1) Metered 商用 static credential → `metered.ca` ドメイン自体が部分ブロック済み、将来遮断リスク高 (2) 自前 coturn → インフラ運用コスト (3) WS Relay → 実装済みだが TURN のほうが WebRTC ネイティブで低オーバーヘッド
- **Priority**: dynamic (Worker fetch) > static (`VITE_WEBRTC_ICE_SERVERS`) > PeerJS defaults
- **Fetch failure**: 5s timeout、失敗時は TURN なしで続行（家ネットでは P2P 直結できるため）。学校ネットでは ICE 失敗 → 既存の auto fallback to WS Relay が効く

### setState reducer は純関数に保つ（StrictMode 安全）

- **What**: `setPlayers` / `setLasers` / `setDebrisRecords` / `setSpawns` 等の updater 関数（reducer）の内部では、**副作用（`peerManager.send`、`ref.mutation`、`Math.random`、`Date.now`、`generateExplosionParticles` 等）を一切呼ばない**。副作用や非決定的計算は reducer の外（setState 呼び出しの前または後）で行い、結果を closure 経由で reducer に渡す
- **Why**: React 18 StrictMode は dev モードで reducer を **2 回** 呼び出して副作用検知を行う。reducer 内で副作用を起こすと: (1) 副作用が 2 回実行される（ネット送信 2x、ログ 2x など）(2) `ref.delete()` のような破壊的操作が 1 回目の結果を壊し、2 回目が空状態を見て誤った分岐に落ちる。**色バグ「ホストが灰色のまま」はこのパターンの極端例**: `pendingColorsRef.delete()` を reducer 内で呼んでいたため、1 回目で pending 消費 → 2 回目で pending 空 → gray fallback が commit されていた
- **canonical pattern**:
  ```ts
  // BAD: reducer に副作用と非決定性
  setPlayers((prev) => {
    const next = new Map(prev);
    const color = Math.random() > 0.5 ? "red" : "blue"; // non-deterministic
    peerManager.send(msg);                              // side effect
    pendingRef.current.delete(key);                     // ref mutation
    next.set(id, { ...existing, color });
    return next;
  });

  // GOOD: すべて reducer の外で計算 → closure で束縛
  const color = Math.random() > 0.5 ? "red" : "blue";
  setPlayers((prev) => {
    const next = new Map(prev);
    next.set(id, { ...prev.get(id)!, color });
    return next;
  });
  peerManager.send(msg);
  pendingRef.current.delete(key);
  ```
- **Why (closure で束縛する理由)**: `let x; setPlayers(...x = foo()...); use(x);` のように reducer 内で変数を書いても、reducer は後の render phase まで実行されないため、setState 直後の `use(x)` は常に `undefined`。reducer の外で先に計算すれば `x` は setPlayers が呼ばれる時点で確定しており、両方の経路（reducer + 後続の副作用）から参照できる
- **適用箇所**（2026-04-06 監査で修正済み）:
  1. `messageHandler.ts` phaseSpace handler: `pendingColorsRef.delete` + `peerManager.send` を外出し（色バグ修正、後に大掃除で完全削除）
  2. `RelativisticGame.tsx` ゲームループ movement: 因果律チェック・物理積分・`peerManager.send(phaseSpace)` を reducer 外に。reducer は新状態の Map 生成のみ
  3. `RelativisticGame.tsx` init: `Math.random` / `Date.now` / `createWorldLine` を reducer 外で計算
  4. `RelativisticGame.tsx` `handleKill`: `generateExplosionParticles()` を reducer 外で呼び `closure` で渡す
  5. `RelativisticGame.tsx` `handleRespawn`: `Date.now()` を reducer 外で 1 回だけ取得
- **例外**: `setXxx(nextValue)` のように関数ではなく値を直接渡す場合は reducer がないので対象外。`applyKill(prev, victimId)`・`applyRespawn(prev, ...)` のような **純関数を reducer として使う**のは OK（純関数は 2 回呼ばれても同じ結果）
- **教訓**: React 18 の StrictMode は「純粋性契約違反」を検知するセンサー。dev で二重実行が発生したら、それは「本番で dispatch 戦略が変わったときに壊れる予兆」と考える。2 回呼ばれても結果が同じになる reducer を書くのは Future-Proof 戦略

### 物理エンジン: ファクトリパターン（クラス不使用）

- **What**: physics モジュールはクラスではなく関数ベースのファクトリパターンで実装
- **Why**: イミュータブルな phase space オブジェクトとの相性がよく、テストしやすい
- **Tradeoff**: OOP 的な継承が使えないが、物理演算には不要

### ネットワーク: WebRTC (PeerJS) + WS Relay フォールバック

- **What**: P2P 通信を基本とし、制限的なネットワーク環境では WebSocket Relay にフォールバック
- **Why**: レイテンシ最小化（P2P）と到達性（Relay）の両立
- **Tradeoff**: 2つの通信経路を保守する必要がある

### 自動接続: PeerJS の unavailable-id を発見メカニズムとして利用

- **What**: ページを開くと自動でルーム ID（`la-{roomName}`）でホスト登録を試行。ID が既に使われていれば（unavailable-id エラー）クライアントとして接続
- **Why**: ID の手動共有が不要になる。「URL を開くだけ」で参加可能
- **Tradeoff**: WS Relay モードでは使えない（PeerJS のシグナリングサーバーに依存）。ホスト切断時の自動復旧はホストマイグレーション（2026-04-11）で実装済み

### レンダリング: 過去光円錐に基づく描画

- **What**: プレイヤーは他オブジェクトの「現在位置」ではなく過去光円錐上の位置を見る
- **Why**: 特殊相対論を正確に反映するゲームメカニクスの根幹
- **Tradeoff**: 計算コストが増えるが、ゲームの存在意義そのもの

### 過去光円錐交差の統一ソルバー: `pastLightConeIntersectionSegment`（2026-04-12）

- **What**: レーザー・デブリ・世界線の過去光円錐交差計算で共通の二次方程式ソルバーを `physics/vector.ts` に抽出。`laserPhysics.ts` と `debris.ts` はこのソルバーに委譲
- **Why**: レーザー (`pastLightConeIntersectionLaser`) とデブリ (`pastLightConeIntersectionDebris`) が ~30 行の同一アルゴリズム（パラメータ lambda の二次方程式 `a*lambda^2 + b*lambda + c = 0` を解いて過去側の最新交点を返す）を重複実装していた。数学的に同一の問題: 時空区間 X(lambda) = start + lambda * delta (lambda in [0,1]) と観測者の過去光円錐の交差
- **配置**: `physics/vector.ts`。`lorentzDotVector4`, `isInPastLightCone` と同レベルのミンコフスキー幾何の基本操作
- **呼び出し元**: レーザー描画（`laserPhysics.ts` が start/end を構築して渡す）、デブリ描画（`debris.ts` が direction * maxLambda を delta として渡す）。世界線の描画は引き続き `worldLine.ts` 内の独自実装（セグメント列の走査 + binary search + 半直線延長があるため、単一セグメントソルバーへの単純委譲ではない）
- **Tradeoff**: なし。正味 -60 行、動作同一

### WorldLine 描画最適化: ローレンツ変換を THREE.js 行列で適用（2+1 限定）

- **What**: TubeGeometry を世界系座標で生成し、表示系への変換はメッシュの Matrix4 として毎フレーム適用。geometry 再生成は `WorldLine.version` を `TUBE_REGEN_INTERVAL=8` で量子化してスロットリング（8 append ごとに再生成）
- **Why**: ローレンツ変換は線形変換なので、CatmullRom スプラインの制御点に適用した結果はスプライン全体に適用した結果と一致。行列更新（16値のコピー）は TubeGeometry 再生成より桁違いに軽い。毎フレーム再生成を間引くことで、5000点 CatmullRom + TubeGeometry の計算コストを 1/8 に削減
- **Tradeoff**: 世界線の先端が最大 8 フレーム分遅れて描画される。ゲームプレイ上は視認不可能な差
- **制約: 2+1 次元でのみ成立**。時空 (t, x, y) の3成分が THREE.js の頂点 (x, y, z) にちょうど収まるため、4x4 ローレンツ行列を列並べ替えで 3x3 部分行列（+ 平行移動）として表現できる。3+1 次元では時空が4成分、THREE.js 頂点が3成分で、t の格納先がないため同じ手法は使えない。3+1 で同等の最適化をするにはカスタム頂点シェーダー（t を頂点属性として持たせ、GPU 側で変換）が必要

### 当たり判定: ホスト権威 + 世界系での交差計算

- **What**: ホストが毎フレーム全レーザー x 全プレイヤーの当たり判定を実行。レーザーの null geodesic とワールドラインの各セグメントで同時刻の空間距離を解析的に計算
- **Why**: ホスト権威でネットワーク遅延による不整合を防止。解析解（二次方程式）で離散化誤差を回避
- **Tradeoff**: ホストに計算負荷が集中。O(L x P x H) だが期限切れレーザーの早期除外で実用上問題なし
- **※ Authority 解体 Stage B で target-authoritative に移行済み** (`8b4932f`): 各 peer が自分 owner のプレイヤー (人間=自分、beacon holder=LH) に対してのみ判定。hit 検出した target 本人が `kill` を broadcast、host は relay hub。ホストへの計算集中は解消。

### 永続デブリ: アニメーション爆発から静的世界線データへ

- **What**: 死亡時のデブリをアニメーション（Date.now ベース）ではなく、死亡イベント + パーティクル方向の静的データとして永続保存。過去光円錐との交差を毎フレーム計算して描画
- **Why**: アニメーション爆発は一定時間で消えるが、遠方の観測者の過去光円錐に届く前に消えてしまう。永続データなら光が届くまで待てる
- **Tradeoff**: 描画コスト（30パーティクル x デブリ数 x 毎フレーム二次方程式）。MAX_DEBRIS = 20 で上限

### 世界系カメラ: プレイヤー追随（デバッグ用）

- **What**: 世界系カメラモードではプレイヤーの世界系座標 (x, y, t) にカメラが追随。カメラの向き（yaw）もプレイヤーと同じ
- **Why**: 静止系と世界系でカメラ挙動を統一（ローレンツブーストの有無だけが異なる）。デバッグ時に世界系での世界線の曲がり方を確認できる
- **変更履歴**: 当初は空間 (15,15) に固定していたが、加速方向が視認できず有用性が低かったためプレイヤー追随に変更
- **バグ疑惑 → 解決**: 世界系で世界線が加速方向に曲がって見えたのは、摩擦（`mu = 0.5`）が原因。カメラを回す操作中にも摩擦で減速が起き、世界線が曲がっていた。摩擦を切ると世界系での世界線は正しく直線的に見える。描画バグではなく物理の挙動が正しく反映されていた

### 因果律の守護者: 未来光円錐チェックによる操作凍結

- **What**: 毎フレーム、自分のイベントが他プレイヤーの未来光円錐の内側にあるか判定。内側なら `setPlayers` を `return prev` でスキップし、全操作（加速・レーザー・ネットワーク送信）を凍結する
- **Why**: A が B の未来光円錐より未来側にいるとき、A がレーザーを撃てると因果律に反する矛盾が生じる（B のレーザーが因果的に先に A を倒していた可能性がある）。B の未来光円錐が A の世界線の最未来端に追いつくまで A は待つ
- **判定**: `diff = B.pos - A.pos`, `lorentzDotVector4(diff, diff) < 0`（timelike）かつ `B.t < A.t` なら A は B の未来光円錐内
- **体験**: プレイヤーにはラグとして感じられる。高速ブーストで座標時刻が先に進むほど凍結されやすくなる — 物理的に自然なペナルティ
- **実装箇所**: `RelativisticGame.tsx` ゲームループ内、物理更新の直前

### 色割り当て: joinOrder × 黄金角（2026-04-11 改善）+ ハッシュフォールバック（2026-04-06）

#### What

2 層構造:
1. **主**: `colorForJoinOrder(index)` — 接続順 × 黄金角 137.5° で hue を割り当て。2 人で 137.5° 離れることが **保証** される
2. **フォールバック**: `colorForPlayerId(id)` — ID の FNV-1a ハッシュ × 黄金角。peerList 未受信時に使用

PeerProvider が append-only `joinRegistryRef` を管理。peerList 受信時に新規 ID を末尾追記（削除しない → index 安定）。`getPlayerColor(id)` が joinRegistry にあれば joinOrder 色、なければハッシュ色を返す。

index 0 = ホスト、1 = 最初のクライアント、2 = 次、...

#### Why

- **旧 stateful 方式（2026-04-06 に廃止）**: ホストが色を管理・配信 → StrictMode 二重実行、接続 race、HMR state 保持で 5 連バグ
- **ハッシュ方式（2026-04-06〜）**: 純関数で race 消滅。ただし 2 人で約 1/6 の確率で近い色になる
- **joinOrder 方式（2026-04-11〜）**: 連続整数 × 黄金角で色分離を保証。append-only 配列 1 本のみの軽量 state で、旧方式の副作用問題を踏まない

#### joinRegistry 更新の統一: `appendToJoinRegistry` ヘルパー（2026-04-12）

- **What**: PeerProvider 内の 3 箇所（`registerPeerOrderListener` / Phase 1 ホスト成功 / ホスト connection change effect）で重複していた joinRegistry append ロジックを `appendToJoinRegistry(joinRegistryRef, ids, hostFirst?)` ヘルパーに抽出
- **Why**: append-only の不変条件（`includes` チェック → `push`/`unshift`）が 3 箇所に分散していると、1 箇所だけ変更して不整合を起こすリスクがある。ホスト ID を先頭に入れるロジックの統一も兼ねる

#### joinRegistry 同期: マージ → 置換（2026-04-13）

- **What**: クライアントがホストの `peerList` メッセージから joinRegistry を受け取る際、`appendToJoinRegistry`（マージ）から丸ごと置換（replace）に変更。`peerList` メッセージに `joinRegistry` フィールドを追加
- **Why**: 各ピアは接続時に自分を joinRegistry に先に追加する。ホストは `[hostId, clientId]`、クライアントは `[clientId, hostId]` になる。`appendToJoinRegistry` の `hostFirst` unshift は「まだ入っていないなら先頭に入れる」だが、クライアントが自分を先に入れた後では clientId が index 0 に居座り、hostId が unshift で index 0 に来ても clientId は index 1 に移るだけ。**結果は正しくなるはずだが**、実際には peerList 受信前に自己登録が走るタイミングで一瞬 `colorForJoinOrder(0)` が適用され、peerList 受信後に replace で修正される前に描画される race があった。根本的に、**append-only マージは順序の整合を保証できない**（タイミング依存）ため、ホストの joinRegistry を単一正本として丸ごと置換する方式に変更
- **マイグレーション後のシナリオ**: 旧ホスト A が離脱、B が昇格、C が新規参加。B の joinRegistry は `[A, B, C]`（A の歴史を保持）。C は peerList 経由で `[A, B, C]` を丸ごと受け取り、自分は index 2。マージ方式では C が `[C]` → append `[C, B]` で A を知らず index がずれていた

#### 注意: getPlayerColor を useEffect deps に入れない

`getPlayerColor` は `useCallback([peerManager])` で peerManager 変更時に参照が変わる。これを `handleRespawn` → `handleKill` → ゲームループ effect の deps に入れると、接続変更のたびにゲームループが teardown → 再作成され **ゲーム凍結** を引き起こす（`2472464` で修正）。色は作成時に一度だけ読むので deps に不要。biome-ignore で除外。

**色の分離性（黄金角）**: ID の小さな差を色環上の大きな差に飛ばしたい。黄金角 137.5° は連続整数 n に対する `n * 137.5° mod 360°` の列が最も一様になる角度（Vogel の螺旋で使われる性質）で、ハッシュ出力のビット相関があっても色相が密集しにくい。2〜4 人程度なら統計的に十分分離する。

**saturation / lightness のビット切り出し**: `hash >>> 8`, `hash >>> 16` は hue に使うビットと独立なので、hue が近い 2 人でも saturation・lightness が異なる可能性が上がり、視覚的分離が補強される。注意: 符号付き `>>` は hash の最上位ビットが立つと負数を返し、`負数 % n` も負で戻るため `80 + 負` で想定外の値になる。必ず符号なし `>>>` を使う（2026-04-06 の緊急修正はまさにここだった）。

#### How（呼び出し戦略）

- **init 時に一度だけ呼ぶ** — `RelativisticPlayer.color: string` フィールドにキャッシュ。描画ループで毎フレーム文字列生成しないため
- **呼び出し箇所**: `RelativisticGame.tsx` init useEffect（自分のプレイヤー作成時）と `messageHandler.ts` phaseSpace ハンドラ（他プレイヤー作成時）の 2 箇所のみ
- **派生物**: レーザー色は `getLaserColor(player.color)`（HSL を少し明るくする変換）、デブリ・凍結世界線は作成時の `player.color` を継承。派生物を持つ瞬間に一度だけ計算されるので、後から player.color が変わっても古い派生物は影響を受けない（そもそも ID は不変なので player.color も不変）

#### 削除したもの（大掃除で消えたコードと概念）

| 項目 | 役割 | なぜ不要になったか |
|---|---|---|
| `playerColor` メッセージ型 | ホスト → 全員への色配信 | 全員が純関数で同じ色を計算できるので配信不要 |
| `pendingColorsRef` | playerColor が phaseSpace より先に届いた場合のバッファ | playerColor メッセージ自体が消滅 |
| `connections` useEffect の color broadcast | 新クライアント接続時に既存プレイヤーの色を送る処理 | 同上 |
| ゲームループの「自分の色が gray なら修正」ブロック | init タイミングで isHost が未確定だった場合のリカバリ | そもそも gray placeholder を使わないので不要 |
| `messageHandler` の色割り当てロジック（pickDistinctColor + 副作用 broadcast） | 新プレイヤー検出時のホスト側色決定 | 同上 |
| gray placeholder `hsl(0, 0%, 70%)` | 「まだ色が決まっていない」sentinel | 決定的なので「未決定状態」が存在しない |
| `pickDistinctColor(id, existingPlayers)` | 他プレイヤーと色相距離を最大化 | 純関数化のため最大距離要件を捨てた |

**正味削減**: 約 87 行、4 ファイル。

#### トレードオフ

「色相距離の最大化」を捨てた。黄金角 + ID ハッシュは統計的に十分分離するが、確率的には「たまたま似た色の 2 人」が起こり得る。実運用でプレイヤー数が 2〜4 人なら気にならない。もし将来問題になれば、`colorForPlayerId` の内部だけで色相テーブルの 12 色パレット化など純関数のまま改善できる（外部 API は変わらない）。

#### 経緯（歴史資料）

この箇所は過去に 5 回のパッチを繰り返した。以下は掃除前の履歴で、同じ根の別症状が継承的に増殖していく典型例として残す。

1. **`a1ddfdf`** — `pickDistinctColor(id, existingPlayers)` で「既存色から最大距離を選ぶ」stateful 設計を導入（**原罪**）。この瞬間、色は「ID の関数」ではなく「ID と既存プレイヤー集合の関数」になり、「どの時点の既存プレイヤー集合か」という問題が生まれた
2. **`ef8b61e`** — `playerColor` メッセージが `phaseSpace` より先に届くと捨てられる問題 → `pendingColorsRef` で緩衝
3. **`2db183f`** — クライアントが独立に色を選ぶと race → ホスト集中管理に集約
4. **`b6ee80e`** — マテリアルキャッシュ key に色が含まれておらず仮色 `hsl(0, 0%, 70%)` のままキャッシュが固着 → key に色を含める（後に R3F 宣言的マテリアルに置換）
5. **`9d10e03`** — 新クライアント接続時に既存プレイヤーの色を送っていなかった → `connections` useEffect で一括送信
6. **2026-04-06 緊急パッチ** — `pendingColorsRef.delete()` と `peerManager.send()` を `setPlayers` reducer 内で呼んでいたため、React 18 StrictMode の reducer 二重実行で「1 回目で pending 消費・delete → 2 回目で pending 空 → gray fallback にコミット」となり「ホストが灰色のまま」症状を発生。color 決定と副作用を reducer 外に出して応急処置
7. **2026-04-06 大掃除（このエントリ）** — 原罪（`a1ddfdf` の「最大距離」要件）を捨てて stateful 設計そのものを削除。5 回のパッチは全て同じ根（stateful 色割り当て）の別症状だったので、根を抜いたら枝葉もまとめて消えた

#### 教訓（メタ設計）

- **「X を Y の純粋な関数として計算できないか？」を最初に問う。** 色 = f(ID) で書けるなら、一切の同期・ブロードキャスト・バッファ・race は発生しない。state 同期を設計する前に、純関数で済む可能性を必ず検討する
- **要件を 1 つ緩和すれば設計全体が単純化することがある。** 「色相距離最大化」を絶対視したために、同期経路を全て通す必要が生じた。要件を「統計的に十分分離すればよい」に緩和したら、全経路が消えた。要件の強度は設計複雑度に非線形に効く
- **同じ箇所のパッチが 3 回を超えたら、根の設計を疑う。** 5 回のパッチは全て枝葉で、根は最初のコミットにあった。パッチが増えるほど既存コードに適合させる制約が強まり、根本治療の機会が遠のく
- **State は常にコスト。** React state・ref・ネットワークメッセージ・キャッシュのどれも、「読み書きのタイミング」という隠れた次元を持つ。計算で代替できるなら、state を増やすより計算する方がほぼ常に安い

### 世界線管理: lives[] 統合 → 廃止（世界オブジェクト分離に移行）

- **What**: ~~`lives: WorldLine[]` に統合~~ → プレイヤーは `worldLine` 1本のみ、過去のライフは `frozenWorldLines[]`（独立 state）に
- **経緯**: 当初は `lives[]` で全ライフを管理していたが、デブリ・ゴーストと共にプレイヤーに紐づけている設計が因果律バグの遠因に。世界オブジェクト分離により廃止
- **現在の操作**: kill → worldLine を frozenWorldLines に移動 + isDead=true。respawn → 新 worldLine を作成

### 世界線の過去延長: origin + 半直線

- **What**: WorldLine に `origin` フィールド（スポーン時の初期 PhaseSpace）を追加。`pastLightConeIntersectionWorldLine` で history を走査して交差が見つからなかった場合、origin から過去方向に等速直線運動の半直線との交差を解析的に計算
- **Why**: スポーン直後の短い世界線でも、過去光円錐との交差が必ず見つかるようにする。初期位置で静止（または初期速度で等速直線運動）していたと仮定すれば物理的に正しい
- **描画**: `WorldLine.origin !== null` のもののみ半直線を描画。リスポーン後の worldLine には origin をつけない（前の命と繋がって見えるのを防止）
- **制約**: history trimming で origin と history[0] の間にギャップが生じうる。origin → history[0] のセグメントでも交差を探す

### 因果的 trimming

- **What**: `appendWorldLine` で `maxHistorySize` を超えたとき、最古の点が全他プレイヤーの過去光円錐の内側にある場合のみ削除。そうでなければ保持
- **Why**: 過去光円錐の交差計算で必要な点を早期に消さないため。プレイヤーの過去光円錐がまだ到達していない世界線上の点は将来の交差計算に必要
- **判定**: `diff = otherPos - oldest.pos`、`diff.t > 0 && lorentzDot(diff, diff) < 0` なら oldest は otherPos の過去光円錐の内側 → 削除 OK。それ以外は保持
- **安全弁**: `maxHistorySize * 2` を超えたら因果的判定を無視して強制削除（メモリ保護）
- **コスト**: O(P) per frame、P = 2-4。無視できる

### マテリアル管理: R3F 宣言的マテリアル

- **What**: `getMaterial` + モジュールレベルの `materialCache` を廃止し、R3F の宣言的マテリアル（`<meshStandardMaterial color={...} />`）に置き換え
- **Why**: マテリアルキャッシュのキーに色が含まれておらず、仮色 `hsl(0, 0%, 70%)` でキャッシュされたマテリアルが確定色に更新されないバグがあった。R3F の宣言的マテリアルなら色の変更を自動反映し、ライフサイクルも React が管理する
- **Tradeoff**: なし。プレイヤー数分（2-4個）のマテリアルにキャッシュのパフォーマンス効果はほぼゼロ

### Kill/Respawn: 世界線凍結 + isDead フラグ一元管理

- **What**: kill 時に空 WorldLine 作成 → 世界線凍結（`isDead` フラグ）に変更。死亡中はゴースト（不可視等速直線運動）。respawn で完全独立の新 WorldLine を追加（半直線延長なし）。`applyKill`/`applyRespawn` 純粋関数で状態更新をホスト/クライアント共通化
- **Why**: 旧実装の問題:
  1. 空 WorldLine 作成 → 遅延 phaseSpace 混入で世界線が繋がるバグ
  2. `deadUntilRef`（タイマー）と `isDead`（フラグ）の二重管理
  3. ホストと messageHandler で kill/respawn ロジックが重複・不一致
  4. 他プレイヤーから見て kill 即座にマーカー消失（相対論的に不正確）
- **新モデル**: kill → 凍結世界線が他プレイヤーの過去光円錐と交点を持つ間は可視（因果的に正しい「遅延された死亡」）。交点がなくなって初めて消える。リスポーン後も過去光円錐が新世界線に触れるまで不可視
- **Tradeoff**: `deadPlayersRef`（ホスト専用、同一フレーム二重キル防止）は残す（React の状態更新が非同期のため）

### 死亡時の描画哲学: 物理に任せる

- **What**: 死亡時の唯一の特別処理は「死んだ本人が自分のマーカーを見ない」のみ。世界線・デブリ・他プレイヤーのマーカー表示は通常通り
- **Why**: 死亡したプレイヤーの世界線は「それ以上追加されない」だけで、凍結された世界線は引き続き描画される。他プレイヤーからの可視性は過去光円錐交差で自然に決まる。デブリも同様で、過去光円錐と交差すればマーカーが出る、しなければ出ない。特別な条件分岐は不要
- **以前の問題**: `if (player.isDead) return null` で死亡プレイヤーの全マーカーを全観測者から非表示にしていたため、デブリの表示タイミングにも影響。`maxLambda < 0.5` の閾値も不要な待ち時間を生んでいた
- **教訓**: 相対論的ゲームでは、描画判定に「特殊ケース」を増やすのではなく、過去光円錐交差という統一的メカニズムに任せるべき

### 光円錐の奥行き知覚: FrontSide サーフェス

- **What**: 光円錐を DoubleSide ワイヤーフレームから FrontSide 半透明サーフェス（opacity 0.2）+ FrontSide ワイヤーフレーム（opacity 0.3）に変更
- **Why**: ワイヤーフレームの手前の辺と奥の辺が区別できない（Necker cube 的奥行き曖昧性）。FrontSide にすることでカメラに向いた面だけ描画され、手前/奥が自然に区別できる
- **不採用案**: fog（カメラ距離ベースなので、光円錐の手前と奥がカメラから等距離の場合に効果がない）、gridHelper（空間参照にはなるが手前/奥の区別には効かない）
- **Tradeoff**: メッシュ数が2倍（サーフェス+ワイヤーフレーム）だが、光円錐は自分のみ描画なので影響は小さい

### メッセージバリデーション

- **What**: `messageHandler.ts` で全メッセージタイプに `isFiniteNumber`/`isValidVector4`/`isValidVector3`/`isValidColor`/`isValidString` のランタイム検証を追加。全文字列フィールド（senderId, id, playerId, victimId, killerId）を型検証。laser range は `0 < range <= 100`（LASER_RANGE=20 の 5 倍をマージン）。score は全エントリの key/value を検証。ホストリレー（PeerProvider）でも `isRelayable()` で構造を検証してからブロードキャスト
- **Why**: `msg: any` で受け取ったネットワークメッセージの NaN/Infinity 注入防止、laser の color フィールドなど CSS 文字列で CSS インジェクション防止、文字列フィールドの型安全性確保、不正メッセージのリレー防止
- **注**: `playerColor` メッセージ型は 2026-04-06 に廃止。色は全ピアで `colorForPlayerId(id)` が決定的に算出するのでネットワーク経由で来ない（CSS インジェクション経路の一つが消えた）
- **Tradeoff**: 微小なオーバーヘッド。zod 等のスキーマライブラリは導入せず手書きで軽量に

### 因果律の守護者: 死亡プレイヤー除外

- **What**: 因果律チェック（他プレイヤーの未来光円錐内なら操作凍結）から `isDead` プレイヤーを除外
- **Why**: 死亡中のプレイヤーは phaseSpace をネットワーク送信しないため、座標が死亡時点で凍結される。生存プレイヤーの世界時が進むと、凍結された座標との lorentzDot が timelike（< 0）になり、因果律チェックに引っかかって観測者の時間進行が停止する。結果、デブリマーカーの maxLambda が固定され「出現後に動かない」バグとなっていた
- **修正**: `if (player.isDead) continue;` を因果律チェックのループに追加。死亡プレイヤーはゲーム世界から離脱しているので因果律の対象外
- **教訓**: 因果律の守護者は「ゲームに参加しているプレイヤー」に対してのみ有効。phaseSpace が更新されないオブジェクト（死亡、切断等）を含めると偽陽性で時間停止が起きる

### 世界オブジェクト分離: 死亡 = プレイヤーから世界への遷移

- **What**: 死亡イベントで生まれるオブジェクト（凍結世界線、デブリ、ゴースト軌跡）を `RelativisticPlayer` から分離し、独立した state として管理。`lives[]` と `debrisRecords[]` を廃止。プレイヤーは `worldLine` 1本のみ保持
- **Why**: レーザーは既に独立 state だったが、デブリと凍結世界線だけプレイヤーに紐づいていた。これらは発生した瞬間にプレイヤーと無関係な世界オブジェクトになる。紐づけが因果律の守護者バグの遠因となり、切断したプレイヤーの痕跡が消えるなどの副作用もあった
- **設計原理**: 世界に放たれた物理オブジェクト（レーザー、デブリ、凍結世界線）はプレイヤーとは独立に存在し続ける。プレイヤーが持つのは「今生きてるライフの世界線」だけ
- **ゴースト**: 死亡中の「プレイヤー」はカメラ + リスポーンタイマー。DeathEvent（pos + 4-velocity）から等速直線運動を決定論的に計算
- **Tradeoff**: state が増える（`frozenWorldLines[]`, `debrisRecords[]`, `myDeathEvent`）が、データフローが明確になり各 state の責務が単一に

### デブリ maxLambda: observer 非依存化

- **What**: デブリの過去光円錐交差計算で使う `maxLambda` を `observer.pos.t - death.t`（observer 依存）から固定値 `5` に変更
- **Why**: デブリ世界線は世界オブジェクトであり、死亡イベントから無限の未来に伸びる直線。過去光円錐との交差は純粋に幾何学的に決まる。`observer.t > intersection.t` の条件が既にカバーしているため、observer の時刻で世界線を切り詰める必要はない。observer 依存だとゴースト中に phaseSpace が止まるとマーカーも止まるバグを生んでいた
- **教訓**: 世界オブジェクトの計算に observer 固有の値を混入させない。過去光円錐交差の条件は幾何学に任せる

### リスポーン座標時刻: 全プレイヤー最大値（maxT）

- **What**: リスポーン位置の座標時刻 t を、**生存プレイヤー**（`isDead === false`）の `phaseSpace.pos.t` の最大値に設定
- **Why**: 最先端の生存プレイヤーと同時刻にリスポーンすることで、即座に相互作用可能。因果律の守護者に引っかかることもない
- **ゴースト除外の根拠**: 死亡中のゴーストは慣性運動で座標時刻が進み続けるため、生存プレイヤーより未来にいる可能性がある。ゴーストの座標時刻を maxT に含めると「生きている相手より未来にリスポーン」してしまう。ゴーストはどうせすぐリスポーンするので、リスポーン時刻の基準にすべきでない
- **History**: ホスト時刻 → maxT（全プレイヤー）→ `(minT + maxT) / 2`（`36abf67`）→ maxT（生存のみ）に再変更。midpoint は 1v1 で約 5 秒過去にリスポーンするため体感上ラグに見えた
- **Tradeoff**: リスポーン地点の座標時刻が「世界系でのゲーム経過時間」より未来にジャンプしうるが、全プレイヤーの相対関係としては整合的

### キル通知の因果律遅延

- **What**: キル通知（KILL テキスト、death flash）を即時表示から、キルイベントの時空点が観測者の過去光円錐に入った時点での表示に変更
- **Why**: 相対論的に、事象は光が届くまで観測できない。デブリや凍結世界線のマーカーは既に過去光円錐交差で可視性を制御していたが、UI 通知だけ即時だったのは一貫性に欠ける
- **実装**: `pendingKillEventsRef` に kill イベントを蓄積し、ゲームループ毎に `isInPastLightCone(hitPos, myPos)` で過去光円錐到達を判定。到達時に death flash / kill notification を発火
- **自分が死んだ場合**: 自分はキルイベントの時空点にいるので lorentzDot = 0 → 即座に条件成立、事実上即時
- **Tradeoff**: 遠距離キルほど通知が遅延する。ゲームプレイ上は「光速の遅れ」として自然

### スポーンエフェクトの因果律遅延

- **What**: 他プレイヤーのリスポーンエフェクト（リング + 光柱）を、キル通知と同様に過去光円錐到達時に発火するよう変更。自分のリスポーンは即時
- **Why**: キル通知・デブリ・凍結世界線のマーカーは全て過去光円錐交差で可視性を制御していたが、スポーンエフェクトだけ即時だったのは一貫性に欠ける
- **実装**: `pendingSpawnEventsRef` にリスポーンイベントを蓄積し、ゲームループ毎に `isInPastLightCone(spawnPos, myPos)` で判定。fired イベントをバッチ化して **1フレーム1回の `setSpawns` 呼び出し** で追加
- **Tradeoff**: 遠距離リスポーンほどエフェクトが遅延する。物理的に正しい
- **教訓**: ゲームループ（setInterval 8ms）内で `setSpawns` をイベント毎に個別呼び出しするとクラッシュする。fired を配列にまとめて 1 回の `setSpawns((prev) => [...prev, ...fired])` でバッチ化する必要がある

### `isInPastLightCone`: 過去光円錐判定の関数抽出

- **What**: `isInPastLightCone(event, observer)` を `physics/vector.ts` に追加。kill 通知とスポーンエフェクトの両方で使用
- **Why**: 同じ物理判定（`lorentzDot(diff, diff) <= 0 && observer.t > event.t`）が kill と spawn で重複していた。条件を変更する際（例: 許容誤差追加）に 2 箇所変更になるのは物理コードとして不適切
- **配置**: `physics/vector.ts`。理由: `lorentzDotVector4` と同レベルのミンコフスキー幾何の基本操作。`pastLightConeIntersection*` 群（軌跡との交差計算）とは抽象レベルが異なる
- **スコープ外**: 因果律の守護者（`RelativisticGame.tsx` L557）は未来光円錐判定（strict `< 0`、方向逆）で別の操作。`isInPastLightCone` に統合しない

### `pastLightConeIntersectionPhaseSpace` 削除（2026-04-12）

- **What**: `mechanics.ts` の `pastLightConeIntersectionPhaseSpace` を削除。常に末尾要素を返すだけの placeholder で、どこからも呼ばれていなかった
- **Why**: `physics/index.ts` が re-export しており、実際の交差計算 (`worldLine.ts` の `pastLightConeIntersectionWorldLine`) と混同するリスクがあった。名前が似ているが挙動が全く異なる関数が公開 API に並ぶのは危険

### 時間積分: Semi-implicit Euler

- **What**: `evolvePhaseSpace` で位置更新に加速 **後** の新しい速度 `newU` を使用（semi-implicit / symplectic Euler）
- **Why**: 標準の explicit Euler（旧速度で位置更新）よりエネルギー保存性が良く、相対論的運動での数値安定性が高い。特に摩擦を含む系で振動を抑制する
- **Tradeoff**: なし（同じ計算コストで精度向上）

### ゴースト 4-velocity: Vector3 → Vector4 変換

- **What**: DeathEvent の `u` フィールドに `phaseSpace.u`（Vector3）を直接保存していたのを `getVelocity4(phaseSpace.u)` で Vector4 に変換して保存
- **Why**: ゴースト移動で `de.u.t * tau` を計算するが、Vector3 には `.t` がなく `undefined * tau = NaN` になっていた。`getVelocity4` は γ = √(1 + u²) を計算して `(γ, u_x, u_y, u_z)` の 4-velocity を返す
- **教訓**: 型定義（`u: Vector4`）と実際の値（`phaseSpace.u: Vector3`）の不一致を TypeScript の構造的型付けが見逃す。Vector3 ⊂ Vector4 ではないが、代入時にエラーにならない

### ホスト権威メッセージの二重処理防止

**※ Authority 解体 Stage B/C/D で全経路が刷新され、この節は historical な記録** (`8b4932f` / `01fed9d` / `d0d05f0`):

- `kill`: Stage B で target 発信に。host skip 撤去。誰でも受理、二重処理防止は `selectIsDead` ガード
- `respawn`: Stage D で owner 発信に。host skip 撤去。誰でも受理
- `score`: Stage C-1 で型ごと削除 (各 peer が `killLog` から独立に count)

下記は 2026-04-13 当時の実装:

- **What**: messageHandler で kill/respawn/score メッセージ受信時、`peerManager.getIsHost()` なら return（スキップ）
- **Why**: ホストはゲームループで kill 検出 → applyKill → ブロードキャスト。PeerManager.send は自分に送信しないが、安全策としてスキップ。従来は UI 副作用（setDeathFlash, setKillNotification の setTimeout）が二重発火していた
- **Tradeoff**: なし

### 残存する設計臭（2026-04-06 監査 → 2026-04-06 再評価で全件 defer）

色バグの掃除と 4 軸レビューの後、同類の匂い（単一情報源の違反・派生可能な state・外部イベントの React 化・二重エントリポイント）が残っている箇所を棚卸ししたもの。**監査時点では #2 → #1 → #4 → #3 の順で掃除する計画だったが、同日夕方に再評価して全 4 件を defer に決定した**（理由は本セクション末尾の「再評価後の判断（2026-04-06）」を参照）。

各エントリの技術分析は将来 un-defer する際の下敷きとして原文のまま残す。各エントリ末尾に「**現状判断**」ブロックを追加し、defer 理由と un-defer トリガーを明記した。

#### 残存臭 #1: `deadPlayersRef` / `processedLasersRef` は async state の sync mirror

- **場所**: `RelativisticGame.tsx:79-80`（ref 宣言）、`:623-636`（当たり判定で参照）、`:655-680`（更新）
- **現状**: `RelativisticPlayer.isDead: boolean` が `players` Map の各プレイヤーに既に存在するのに、別途 `deadPlayersRef: Set<string>` を持って同じ情報を manual に同期している。同じく `processedLasersRef: Set<string>` は「このティックで既にヒット判定を処理したレーザー」を追跡。
  ```ts
  // ホストが kill 検出（game loop 内）
  deadPlayersRef.current.add(victimId);           // sync で即時反映
  handleKill(victimId, killerId, hitPos);         // setPlayers で isDead=true（async）
  // ↑ 同じティックの後続の当たり判定が deadPlayersRef を見て skip する必要あり
  ```
  ```ts
  // 次のティック以降の当たり判定
  if (deadPlayersRef.current.has(playerId)) continue;
  // ↑ 理屈上は player.isDead を見れば済むはずだが、setPlayers の反映タイミングに依存するので ref 経由
  ```
- **根本原因**: **React の `setState` は async、game loop は sync** というインピーダンスミスマッチ。`setPlayers(handleKill)` の結果が `playersRef.current` に commit されるのは次の render 後なので、同一ティック内で「さっき殺したプレイヤー」を skip するには sync な mirror が要る。`processedLasersRef` も同じ理由（1 ティック内で既ヒット判定したレーザーを他プレイヤーとの交差から外す）。
- **色との類似**: 色は「ID から算出できる純関数データ」を state + pending + メッセージ型で 3 重管理していた。これは「React state の真実 (`isDead`)」を ref で mirror している。**同じ情報が 2 箇所に書かれ、手で同期を維持する必要がある**。色ほど race は致命的にならないが、同期忘れバグの温床。
- **解消方向**:
  - 現状でも `killedThisFrame: Set<string>` というローカル変数が per-tick dedup を担当しているので、1 ティック内は `killedThisFrame` に任せる
  - 2 ティック目以降は `playersRef.current.get(id)?.isDead` で判定できるはず（`setPlayers` は次 render までに commit される想定）
  - 検証: 120Hz のゲームループ内で setPlayers の commit が次ティックまでに確実に反映されるか。R3F / React の async batching の挙動を確認する必要がある
  - もし反映が不確実なら、**`playersRef.current` を sync で更新する専用の setState ラッパー**を作る（setPlayers 直後に `playersRef.current = nextValue` を代入、ただし reducer 内ではなく呼び出し側で実施）
- **優先度**: 高（mirror 同期忘れバグは潜在的に高リスク）、難易度: 中
- **検証手順**: `deadPlayersRef` を削除して、その場に `playersRef.current.get(id)?.isDead` + `killedThisFrame` の組み合わせに置き換えてみる。2 人プレイで速射テスト（同一ティックで複数ヒット）を走らせて regression がないか確認。
- **解決 (2026-04-12)**: `setPlayers` ラッパーで `playersRef.current` を updater 内で即座に同期する方式を実装 (`172b600`)。`useEffect` による遅延同期を廃止。これにより `deadPlayersRef` mirror は不要になった（`playersRef.current.get(id)?.isDead` が常に最新値を返す）。ただし `deadPlayersRef` 自体の削除は未実施（動いているので低優先度）。

#### 残存臭 #2: connections useEffect で外部イベントを React state 経由で diff している

- **場所**: `RelativisticGame.tsx:227-266`（特に `:229` の `prevConnectionIdsRef` 宣言と `:236-244` の比較ループ）
- **現状**:
  ```ts
  const prevConnectionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (peerManager?.getIsHost()) {
      for (const conn of connections) {
        if (conn.open && !prevConnectionIdsRef.current.has(conn.id)) {
          peerManager.sendTo(conn.id, { type: "syncTime", ... });
        }
      }
    }
    prevConnectionIdsRef.current = new Set(connections.filter((c) => c.open).map((c) => c.id));
    ...
  }, [connections, myId, peerManager]);
  ```
- **なぜ smell か**: `dc.on('open')` の **その瞬間** に PeerManager は「これは新規接続だ」と分かっている。それをわざわざ `setConnections` で React state に昇格させ、再レンダーを起こし、前回の ref と diff を取って「新規」を復元している。情報の流れが「イベント → スナップショット → diff 検出」と遠回りしている。
- **色との類似**: 色の `playerColor` ブロードキャスト（host → 新クライアントに対して既存プレイヤーの色を送り直す）と同じクラス。**外部の事象（接続開始、色決定）を、同期機構（React useEffect / ネットワークメッセージ）に載せて復元している**。色は純関数で送信自体を不要にした。connections は PeerManager のコールバック API で直接扱えば diffing が不要になる。
- **解消方向**:
  - PeerManager に `onNewPeerOpen(cb: (peerId: string) => void)` を足す
  - `dc.on('open', () => { cb(dc.peer); notifyConnectionChange(); })` で即時コールバック
  - RelativisticGame は useEffect ではなく一度だけ購読:
    ```ts
    useEffect(() => {
      if (!peerManager) return;
      return peerManager.onNewPeerOpen((peerId) => {
        if (peerManager.getIsHost()) {
          const me = playersRef.current.get(myId);
          if (me) {
            peerManager.sendTo(peerId, { type: "syncTime", hostTime: me.phaseSpace.pos.t });
          }
        }
      });
    }, [peerManager, myId]);
    ```
  - `prevConnectionIdsRef` を削除
  - 注意: `connections` state は UI（接続インジケータ）で使っているので削除せず、diffing ロジックだけ消す
- **優先度**: 高（コード量削減・バグ温床除去）、難易度: 中（PeerManager + PeerProvider + RelativisticGame の 3 ファイル変更）
- **現状判断 (2026-04-06 再評価)**: **defer**。
  - 実コード読み直しで、変更範囲が監査時見積より広いことを確認: PeerManager だけでなく `WsRelayManager.ts` にも同じ callback API を足す必要がある（2 transport の同期維持コスト）
  - diffing は動いている。現時点で実害ゼロ。StrictMode 下の dev 環境で syncTime が 2 回飛ぶ理論上の可能性はあるが prod は StrictMode off で無関係
  - 節約される行は 20 行前後、得られるのは「ライフサイクルイベント型の API」という美学。物理デモアプリの価値には寄与しない
  - preemptive fix の具体トリガーなし。syncTime を別ハンドシェイクに差し替えるとき、どのみちこの領域を触るのでそのとき同時掃除で十分
  - **un-defer トリガー**: (a) 接続ライフサイクルに絡む実バグ観測、(b) syncTime / sync ハンドシェイクを別設計に差し替える機会、(c) PeerProvider に `reconnecting` 等の phase 概念が必要な機能を足すとき（#4 と合流する）

#### 残存臭 #3: kill 処理の dual entry point（ホスト権威メッセージ）

**※ Authority 解体 Stage B/C/D で解消済み** (`8b4932f` / `01fed9d` / `d0d05f0`): target-authoritative 化で「host だけ game loop で直接呼び、他は messageHandler」という dual entry は消え、全 peer が `sendToNetwork(kill)` + `handleKill` を自分の game loop で呼ぶ単一経路に。host skip guard も撤去。self-loopback pattern を導入する代わりに、発信責任を owner 本人に一元化することで自然解消。respawn も同様 (Stage D)、score は型ごと削除 (Stage C-1)。下記は 2026-04-06 当時の分析記録。

- **場所**: `RelativisticGame.tsx:678` 付近（ホストのゲームループが直接 `handleKill`）+ `messageHandler.ts:184-193`（クライアントが kill メッセージを受けて `handleKill`）+ `messageHandler.ts:185`「ホスト skip」guard
- **現状**:
  ```ts
  // ホスト側: game loop
  peerManager.send({ type: "kill", victimId, killerId, hitPos });
  handleKill(victimId, killerId, hitPos);  // 直接呼ぶ
  ```
  ```ts
  // messageHandler
  } else if (msg.type === "kill") {
    if (peerManager.getIsHost()) return;  // ← dual entry 回避の guard（smell の本体）
    ...
    handleKill(msg.victimId, msg.killerId, msg.hitPos);
  }
  ```
  respawn / score も同じ構造で host guard が入っている。DESIGN.md「ホスト権威メッセージの二重処理防止」セクションで正当化されている。
- **なぜ smell か**: 同じ状態変更関数 `handleKill` に **2 本の入り口**（ゲームループ直呼び + メッセージ受信）があり、ホストだけ「自分のメッセージを自分で受け取ったら skip」という分岐を書く必要が生じている。**guard の存在自体が dual entry を認めた証**。どちらかの経路で副作用を追加し忘れると挙動が分岐する。
- **色との類似**: **極めて高い**。色も init useEffect で直接 pickDistinctColor + messageHandler の phaseSpace で pickDistinctColor の 2 経路があり、掃除前はどちらかを先に実行するかで state が揺れていた。dual entry は「同じことを 2 箇所に書かされる」パターンで、将来の拡張（新しい UI 副作用・ログ・undo など）のたびに両方更新が必要になる。
- **解消方向**: **self-loopback パターン**
  - PeerManager に `sendWithLoopback(msg: T)` を追加:
    ```ts
    sendWithLoopback(msg: T) {
      this.send(msg);  // 他ピアへ
      for (const cb of this.messageCallbacks.values()) {
        cb(this.localId, msg);  // 自分自身にも dispatch
      }
    }
    ```
  - ホストのゲームループは `handleKill` を直接呼ばず、`peerManager.sendWithLoopback({type:"kill",...})` に統一
  - messageHandler から「host skip」guard を削除（全員が同じ経路で処理）
  - respawn / score も同じパターンで統一
- **懸念**: 現状の messageHandler は msg を validate してから処理する。self-loopback で自分の送信したメッセージも validate を通る（冗長だが害なし）。ただしゲームループ内のタイミングと messageHandler のタイミングがずれるので、副作用の順序（setDeathFlash のタイミングなど）が微妙に変わる可能性。要検証
- **優先度**: 中（害は出ていないが、将来の拡張時に dual entry で bug が出やすい）、難易度: **高**（ゲームロジックの制御フロー全体を再配線、respawn / score の 3 経路同時変更、タイミング回帰テスト必須）
- **現状判断 (2026-04-06 再評価)**: **defer（4 件の中で最も強く defer）**。
  - DESIGN.md 自身の記述「害は出ていない、将来の拡張時リスク」を直視する。**具体バグも具体拡張計画もない状態で「大手術 + タイミング回帰テスト必須」を払うのは YAGNI 違反**
  - host skip guard は明示的に書かれ、「ホスト権威メッセージの二重処理防止」セクションで正当化されている。dual entry は認知されて封じ込められている設計であって、隠れたバグ源ではない
  - self-loopback パターンへの置換は理論的に美しいが、kill / respawn / score の 3 経路同時変更 + タイミング依存（`setDeathFlash` 等の副作用順序）の regression リスクが高く、色バグより deeper な race を作り込む可能性すらある
  - **un-defer トリガー**: (a) dual entry 起因の実バグが観測されたとき、(b) 新しい権威メッセージ種別（例: 新しい kill-like イベント）を足す機会に、それを self-loopback で実装しつつ既存 3 経路も合流させるとき、(c) kill/respawn/score のいずれかを別理由で大改修するとき

#### 残存臭 #4: `timeSyncedRef` が接続ライフサイクルを React に漏らしている

- **場所**: `RelativisticGame.tsx:78`（ref 宣言）、`:583`（ゲームループで gate）、`messageHandler.ts:118`（syncTime 受信でフラグ立て）
- **現状**:
  ```ts
  const timeSyncedRef = useRef<boolean>(false);
  // messageHandler.ts
  } else if (msg.type === "syncTime") {
    ...
    timeSyncedRef.current = true;
  }
  // RelativisticGame.tsx game loop
  if (isHost || timeSyncedRef.current) {
    peerManager.send(phaseSpace);  // クライアントは syncTime 受信まで送信しない
  }
  ```
- **なぜ smell か**: 「クライアントのクロックはホストの `syncTime` で初期化されるまでズレている、その前に phaseSpace を送ってはいけない」という接続ライフサイクルの状態が、ゲームロジック層のフラグとして露出している。本来これは PeerProvider の接続フェーズ（`trying-host` / `connecting-client` / `connected`）の延長で管理すべき情報（`connected-but-not-synced` / `connected-and-synced`）。
- **色との類似**: 中程度。色ほどの race ではないが、「本来は下層（ネットワーク/接続管理）の責務を上層（ゲームロジック）に漏らしている」という層の違反。
- **解消方向**:
  - PeerProvider の `connectionPhase` に `"syncing"` と `"synced"` を追加（host は即 `synced`、client は syncTime 受信で `synced` に遷移）
  - ゲームループは `peerStatus === "synced"` を usePeer フック経由で取得し gate に使う
  - `timeSyncedRef` と messageHandler のフラグ立て処理を削除
- **優先度**: 低（実害少、1 ファイル程度の変更）、難易度: 低
- **現状判断 (2026-04-06 再評価)**: **defer**。
  - 4 件の中で技術的には最も低リスク・低コストだが、それでも今やる正味価値は薄い
  - 現状の `timeSyncedRef` は set 1 箇所 / read 1 箇所の計 2 行副作用。汚いが動いている。bug source ではない
  - PeerProvider に phase 概念を足すと逆に行数は増える可能性が高く、純行数 benefit はほぼなし。得られるのは「接続ライフサイクルはゲーム層ではなく接続層」という層の原則の体現のみ
  - phase 概念が真価を発揮するのは「syncing 中の UI 表示」「再接続時の再同期フロー」などを実装するときで、現在これらの機能は予定にない → **機能トリガー先行で phase 概念を導入するほうが健全**
  - **un-defer トリガー**: (a) `timeSyncedRef` が原因でクライアントが永遠に gate されるような実バグ、(b) 「同期中…」UI を表示したい機能要求、(c) 再接続・再同期を扱う機能追加（#2 と合流して unified connection-phase refactor として実施）

---

#### 再評価後の判断（2026-04-06）

監査当日の夕方、「そもそもこれをやるべきか」を深く考え直した結果、**4 件すべてを現状 defer** に決定した。監査時の優先順（#2 → #1 → #4 → #3）はコード内在的な見た目の美学に基づく並びで、**「なぜ今これをやるのか」というプロダクト側からの問いに耐えなかった**。以下が再評価の全記録。

##### 色バグとの「アナロジー」を疑う

監査は色バグの掃除直後に行われ、「同類の匂い」という枠で 4 件を並べた。しかし実際には色バグと 4 件は **質が違う**:

| | 色バグ | #1 mirror | #2 diffing | #3 dual entry | #4 timeSyncedRef |
|---|---|---|---|---|---|
| 本番で観測された実害 | **あり（5 パッチ）** | なし | なし | なし | なし |
| 分散・race 要素 | **ネットワーク越し** | ローカル | ネットワーク側だが副作用はローカル | ローカル | ローカル |
| 現状の guard の有無 | なし | `killedThisFrame` で intra-tick カバー済 | `prevConnectionIdsRef` が機能 | host skip guard が明示 | 動いている |

**色バグは「guard がないまま distributed race していた」** のに対し、4 件はすべて **「guard があって正しく動いているが見た目が冗長 / 層が不整合」**。同じクラスではない。「次は同じ根から別症状が出る」という予測は根拠が弱い。

##### ROI で並べ直す

4 件はいずれも **実害ゼロ・preemptive fix のトリガーなし・コスト非ゼロ** という共通構造を持つ:

| smell | 得られるもの | コスト | 現バグ | 将来トリガー |
|---|---|---|---|---|
| #1 mirror | ~~見た目の冗長さ解消~~ **解決済み** (`172b600`): setPlayers ラッパーで sync 更新実装。deadPlayersRef 削除は低優先度で残存 | — | — | — |
| #2 diffing | 〜20 行削減、API の美学 | PeerManager + WsRelayManager 2 transport 同期、3 ファイル配線変更 | なし | なし（syncTime 差し替え時に同時対応で十分） |
| #3 dual entry | guard 削除、制御フロー統一 | kill/respawn/score 3 経路同時変更、タイミング回帰リスク高 | なし（DESIGN.md 自身が明記） | なし |
| #4 timeSyncedRef | 層の原則の体現、2 行の副作用消去 | 純行数はむしろ増える可能性 | なし | なし（phase 概念を必要とする機能要求発生時に同時対応で十分） |

**物理デモアプリ（`2+1/`）の価値は「相対論の時空図を触って体験できる」こと**。4 件のどれも、この価値を 1 mm も前進させない。一方「次にやること」には 固有時刻表示（物理デモの本質）、3+1 拡張（新機能）、スマホ UI（新規ユーザー到達範囲）、戦闘系語彙の再考（社会的文脈）という **ユーザー観測可能なタスク** が並ぶ。機会費用の観点で、cleanup は負ける。

##### 「束ねる論法」の破綻

監査時に #2 と #4 を「接続ライフサイクル refactor として束ねれば同じファイルに 2 回触らずに済む」と考えたが、これは **「どのみちやる」前提に依存した節約論**で、やる価値自体を疑うと節約効果も 0 × 2 = 0 になる。束ねるメリットは「やる」を選んだ後の実装戦略であって、「やる」の根拠にはならない。

##### defer の意味

defer は「放棄」ではなく「**un-defer トリガーが発生するまで touch しない**」という明示的判断。各エントリに un-defer トリガーを列挙した。これにより:

1. **現状は他の高価値タスクに集中できる**（固有時刻表示・スマホ UI・用語再考 など）
2. **un-defer トリガーが発生したら、分析は原文のまま残っているので即着手できる**（監査時の labor は無駄にならない）
3. **「気になるけど放置している」という心理的コストから解放される**（決定済みとして記録）

##### 再 un-defer の条件（全件共通）

どれか 1 件でも un-defer する際は以下のチェックを通すこと:

- [ ] 具体的な bug 観測 or 具体的な機能トリガーがあるか？（「なんとなく気になる」ではない）
- [ ] 現時点で物理デモとして価値のあるタスク（固有時刻表示・3+1 拡張・スマホ UI・用語再考 等）がこれより優先されないか？
- [ ] 修正による regression リスク（特に race / timing 系）は受容可能か？
- [ ] lint + tsc + preview 2 タブテストで検証可能な単位で 1 コミットに収まるか？

**ログ**: 2026-04-06 監査 → 同日 SESSION.md に「次にやること」として列挙 → 同日夕方 "6 だな" トリガーで再評価 → 全件 defer 決定。本セクション末尾に判断経緯を残すことで、将来「なぜ 2026-04-06 時点で掃除を選ばなかったか」を再現可能にした。

---

### カスタム hook の返り値安定性（2026-04-12）

`useStaleDetection()` が毎レンダーで新しいオブジェクト `{ staleFrozenRef, checkStale, ... }` を返していた。このオブジェクトがゲームループ effect の依存配列に入っていたため、**毎レンダーで effect が再実行** → クリーンアップでリスポーンタイマーが全クリア → リスポーン不能。

- **教訓**: カスタム hook が返すオブジェクトは `useMemo` で安定化すること。中身が全て `useRef` でも、ラッパーオブジェクトが毎回新規作成されると依存配列が変化する
- **修正**: `return useMemo(() => ({ ... }), [])` で hook の返り値を安定化
- **関連パターン**: `as Message` キャストで Message union 型の穴が隠れていた問題（`redirect` 型未定義）。型安全の穴は `as` キャストではなく、union 型にバリアントを追加して解消すべき

### ビーコン Peer パターン（2026-04-12）

マイグレーション後、新ホスト（ランダム ID）に新クライアントが接続できない問題。`la-{roomName}` ID は旧ホストが保持していたため、PeerServer 解放後に新クライアントが取得して自分がホストになってしまう。

**検討した 3 アプローチ:**

| アプローチ | メリット | デメリット |
|---|---|---|
| A: 新ホストが `la-{roomName}` で PM 再作成 | シンプル | 既存接続が切れる→連鎖マイグレーション |
| B: ビーコン Peer（発見専用） | 既存接続に影響なし | 2つの PM 管理 |
| C: 全員ネットワーク再構築 | クリーンリスタート | 全員に中断、新メッセージ必要 |

- **決定**: B（ビーコン）。既存のゲーム通信に一切触れない。新クライアントだけがリダイレクト（数百ms）を経験
- **Why**: A はマルチプレイヤーで連鎖マイグレーションが起きる。C は全員に中断が入り UX が悪い。B は自己完結した useEffect で管理可能

### OFFSET 設計: 固定値の失敗と教訓（2026-04-12）

`OFFSET = Date.now()/1000`（ページロード時刻）だと全クライアントで値が異なり、syncTime で同期が必要。syncTime 依存を断つために `OFFSET = 1735689600`（固定値）を試みた。

- **失敗**: pos.t ≈ 4000 万秒。THREE.js は内部で Float32 を使用し、精度が ±4 程度に劣化。ワールドライン座標が全てスナップして描画が崩壊
- **教訓**: 時空座標は小さい値（0 近辺）に保つ必要がある。Float64 で計算しても THREE.js の頂点バッファ / シェーダーユニフォームが Float32 なので、表示座標系で精度が死ぬ
- **最終設計**: `OFFSET = Date.now()/1000` に戻し、クライアント自己初期化 + syncTime 時刻補正のハイブリッド。クライアントは START 直後にプレイ開始でき、syncTime 到着時に一回だけ時刻座標を補正

### クライアント自己初期化（2026-04-12）

旧設計: init effect は `if (!isHost) return;` でクライアントをブロック。syncTime 到着まで黒画面。

- **問題**: ホスト未 START 時にクライアントが START すると永遠に待機。ホストが START 前に落ちると永久ハング
- **新設計**: init effect をホスト・クライアント共通化。全員が START 直後に自己初期化。syncTime は時刻補正（スコア同期含む）として機能し、ゲート（gate）ではない
- **`timeSyncedRef` 削除**: 3軸レビューで dead code と判定。`true` 初期化で読む場所がなくなったため完全削除

---

**注記 (2026-04-07)**: ここにあった「用語の再考」セクションは pure exploration（候補 A/B/C、未決定）のため `EXPLORING.md` に migrate した。詳細は `2+1/EXPLORING.md` の「用語の再考」セクション参照。元々 2026-04-06 に `### 用語の再考` という独立ヘッダーで追加されたが、同日 `88ed267` で「残存する設計臭」セクション追加時にヘッダーが誤って置換され、orphan bullets として残っていた状態を 2026-04-07 の 4 軸レビューで検出・修正。
