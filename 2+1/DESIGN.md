# DESIGN.md — LorentzArena 2+1

## 設計判断の記録

### visibilitychange によるゲームループ停止（2026-04-12）

- **What**: `document.hidden` のとき、ゲームループ（`setInterval` 8ms）と PeerProvider の ping 送信をスキップ。`clearInterval` ではなくループ内チェック
- **Why**: ブラウザはバックグラウンドタブの `setInterval` を throttle する（Chrome: ~1s、Safari: もっと遅い）。throttle されたループが中途半端な頻度で走ると、(1) stale な phaseSpace を低頻度で送信し続ける (2) Lighthouse AI が極低速で動く (3) 座標時間の進行率が異常に低くなる等の不整合が生じる。完全に止めるのが正しい
- **チェック位置をループ内にした理由**: `clearInterval` + `visibilitychange` で再開するアプローチでは、ループ本体のクロージャを再構築する必要がある（useEffect の deps 問題）。ループ先頭の 1 行 `if (document.hidden) { lastTimeRef.current = Date.now(); return; }` で同等の効果を得られ、`lastTimeRef` 更新で復帰時のジャンプも防止
- **既存メカニズムとの連携**: ping 停止 → クライアントがハートビートタイムアウト → migration。phaseSpace 停止 → stale 検知。新しいプロトコル不要

### syncTime のタイミング問題とその解決（2026-04-12）

- **What**: ロビー導入で PeerProvider と RelativisticGame が別のライフサイクルになった結果、クライアントの syncTime が失われる問題が発生
- **根本原因**: PeerProvider はロビー中に接続する → ホストが即座に syncTime を送信 → しかしクライアントの RelativisticGame（messageHandler を登録する）はまだ mount されていない → syncTime は誰にも処理されず消失
- **修正**: クライアントの RelativisticGame mount 時に `requestPeerList` を送信。ホスト側の messageHandler が `requestPeerList` を受信したら `sendTo` で syncTime を返す（ブロードキャストではなく、要求元だけに unicast）
- **教訓**: PeerProvider（常時 mount）と RelativisticGame（条件付き mount）の間でメッセージが失われるパターン。新しいメッセージ型を追加する際は、両方の mount 状態を考慮すること

### ゴースト reducer の React batch race（2026-04-12）

- **What**: リスポーン時に旧世界線と新世界線が繋がる
- **根本原因**: ゴースト中の `setPlayers((prev) => ({ ...me, phaseSpace: ghostPos }))` と `applyRespawn` の `setPlayers` が同じ React 18 batch で実行されると、ゴースト reducer の `...me` スプレッドが respawn で作った新 WorldLine を旧 WorldLine で上書きする
- **修正**: ゴースト reducer で `if (!me.isDead) return prev` を追加。respawn が先に走っていれば isDead は false → ゴースト更新スキップ
- **教訓**: 「setState reducer は純関数に保つ」の延長。**同じ state を更新する複数の setPlayers が同一バッチに入る場合、各 reducer は他の reducer が先に走った可能性を考慮すべき**。isDead フラグはここで「respawn 済みか」の判定に使える

### グローバルリーダーボード: Cloudflare KV 単一キー設計（2026-04-12）

- **What**: リーダーボード全エントリを KV の単一キー `"top"` に JSON 配列として格納。Worker 側でトップ 50 フィルタ（read → 比較 → 条件付き write）
- **Why**: KV は値サイズ 25 MB まで。50 エントリ × ~100 bytes ≈ 5 KB で十分収まる。単一キーなら read 1 回 + write 最大 1 回で完結。トップ 50 に入らないスコアは read only（無料枠 100K reads/日で十分）。write は条件付きなので無料枠 1K writes/日を大幅に節約
- **トレードオフ**: 同時書き込みの last-write-wins。物理デモゲームでは許容

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

#### 修正すべき問題（リファクタリング時に対応）

| # | 問題 | 重要度 | 修正方針 |
|---|---|---|---|
| S-1 | **Lighthouse が stale 検知から除外されていない**。クライアント側でホストが遅延すると Lighthouse が stale 凍結され、回復しない（クライアントは `!isHost` で stale recovery をスキップ） | Medium | stale 検知ループで `isLighthouse(id)` → continue（因果律ガードと同様） |
| S-2 | **Kill + stale の重複**: stale プレイヤーがレーザーに当たると kill → respawn → 次の phaseSpace で stale recovery → 二重 respawn | Low | `handleKill` で `staleFrozenRef.delete(victimId)` を追加 |
| S-3 | **`lastCoordTimeRef` の cleanup 漏れ**: 切断時に `lastUpdateTimeRef` と `staleFrozenRef` は削除されるが `lastCoordTimeRef` はされない（メモリリーク、機能的には無害） | Trivial | cleanup に `lastCoordTimeRef.current.delete(id)` 追加 |
| S-4 | **stale recovery 時に `lastCoordTimeRef` 未リセット**: recovery 直後に rate チェックが旧値を参照して即座に再 stale になる可能性 | Low | stale recovery で `lastCoordTimeRef.current.set(playerId, { wallTime: Date.now(), posT: position.t })` |
| S-5 | **死亡中は他プレイヤーの stale 検知が止まる**: isDead ブランチでは stale 検知ループが走らない（最大 10+5 秒の遅延） | Low | stale 検知を isDead 分岐の外に移動 |

#### 設計方針（リファクタリング時）

- `staleFrozenRef` の add/delete を一箇所に集約する custom hook `useStaleDetection` を作る
- stale 検知・回復・cleanup の 3 操作を統一的に管理
- Lighthouse 除外は検知ループで明示的に `isLighthouse` チェック
- kill 時の stale クリアも hook 内で処理

### ロビー画面 + i18n + 表示名 + ハイスコア（2026-04-12）

#### ロビー画面: PeerProvider の内側で gate

- **What**: App.tsx に `gameStarted` state を追加。PeerProvider は即座に mount（接続開始）し、ロビー画面を表示。Start 押下で RelativisticGame を mount
- **Why**: PeerJS 接続に数秒かかる。ロビー表示中にバックグラウンドで接続を確立すれば、Start 後の待ち時間ゼロ
- **Alternative rejected**: PeerProvider の外側で gate → Start 後に接続開始で数秒待ち

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
- **制限**: マイグレーション後に新規ジョイナーが `la-{roomName}` で入ると別セッションになる（新ホストを発見できない）。小規模ゲームでは許容

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
- **現状判断 (2026-04-06 再評価)**: **defer**。
  - コード再読で `RelativisticGame.tsx:221-223` の `playersRef.current = players` は **useEffect 内**であることを確認した。つまり ref 同期は React コミット後に起きるので、`setPlayers(applyKill)` 直後の次ティックまでに commit が流れる保証は React scheduler 次第で、負荷時には stale になりうる
  - 加えて `killedThisFrame` は既存（`:621`）で intra-tick dedup はカバー済み、cross-tick は実害なしで動いている
  - mirror は「症状」ではなく impedance mismatch への **対処**。消すと新しい cross-tick race を生むリスクがある。直すなら setPlayers ラッパーで呼び出し側 sync 更新という大きい改修が必要で、DESIGN.md「setState reducer は純関数に保つ」の原則と両立させるのに手間がかかる
  - 現時点で実害ゼロ、真の fix は非自明、コスト非ゼロ → defer
  - **un-defer トリガー**: 実際に「kill したはずのプレイヤーが次ティックで生きている」類の race バグが観測されたとき、または setPlayers 周辺を大改修する別動機が発生したとき

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
| #1 mirror | 見た目の冗長さ解消 | 真の fix は setPlayers ラッパー設計。消すだけだと cross-tick race を新たに生むリスク | なし | なし |
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
