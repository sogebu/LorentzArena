# design/network.md — LorentzArena 2+1 ネットワーク + 通信セキュリティ

DESIGN.md から分離。WebRTC / PeerJS / ビーコン pattern / ICE / 通信検証など。

## § ネットワーク

### WebRTC (PeerJS) + WS Relay フォールバック

P2P 通信を基本とし、制限的なネットワーク環境では WebSocket Relay にフォールバック。レイテンシ最小化 (P2P) と到達性 (Relay) の両立。

### 自動接続: PeerJS の unavailable-id を発見メカニズム

ページを開くと自動でルーム ID (`la-{roomName}`) でホスト登録を試行。ID が既に使われていれば (unavailable-id エラー) クライアントとして接続。ID の手動共有が不要 (URL を開くだけ)。

注: `la-{roomName}` は Authority 解体前はゲーム PM の ID として使っていたが、現在はビーコン (発見専用) のみに使用 (下記「ビーコン専用化」参照)。

### ビーコン専用化: `la-{roomName}` をビーコン ID に固定

ホストが `la-{roomName}` をゲーム PM の PeerJS ID として使う設計を廃止。全ピア (ホスト含む) がランダム ID でゲーム接続し、`la-{roomName}` はビーコン (発見専用) のみに使用。

旧設計では、ホストの tab-hidden 復帰時に ID が `la-{roomName}` → ランダム ID に変わり、joinRegistry index が変化して色が変わっていた。ad-hoc パッチ (`previousId` in intro, joinRegistry 置換 hack) は複雑すぎたため revert し、根本解決として Phase 1 を 2 段階に分割:

1. `la-{roomName}` で一時 PM を作成 (ビーコンプローブ)。成功 → `beaconRef.current` に格納
2. `localIdRef.current` (ランダム ID) でゲーム PM を作成。open → `setAsHost()`, 標準ハンドラ登録
- ビーコンの redirect ハンドラはゲーム PM open 後に登録 (`hostId` 確定後)
- プローブ中に来たクライアントには `getConnectedPeerIds()` で遡って redirect 送信

構造的効果: 初期ホスト・マイグレーション後ホスト・tab-hidden 復帰ホストがすべて同じパターン (ランダム ID + ビーコン) に統一。Phase 2 の joinRegistry 色修正 hack は不要になり削除。

レースコンディション: ビーコンプローブ成功 → ゲーム PM open の間に別ピアが来ても、ビーコン PM が `la-{roomName}` を占有中なので競合しない。

ゲーム PM エラー時のビーコン解放: Phase 1 でビーコン取得後にゲーム PM が PeerServer エラーで失敗した場合、ビーコンだけが生き残って `la-{roomName}` を永続占有するバグを防ぐため、ゲーム PM の `onPeerStatusChange` error 分岐で `beaconRef.current.destroy()` を実行。

トレードオフ: クライアント接続レイテンシ ~100-200ms 追加 (常にビーコン経由 redirect)。ロビーの初回接続時のみ許容。

### ビーコンベースのホスト降格 (dual-host 解消)

peerOrderRef のずれで 2 ノードが同時にホスト化した場合、ビーコン PeerJS ID の一意性で解決する。ビーコン取得 3 回失敗したホストは別のホストが存在すると判断して降格:

1. `discoveryPm` でビーコンに接続
2. redirect で本物のホスト ID 取得
3. 自分のクライアントに `{ type: "redirect", hostId }` を broadcast
4. `clearHost()` + 本物のホストに接続
5. `setRoleVersion(v+1)` で全 effect 再評価

安全弁: discoveryPm がビーコンに 8 秒接続できない場合 (ビーコン保持者がクラッシュ済み)、降格を中止してビーコンリトライを再開。

### `roleVersion` による effect 再評価

`peerManager.setAsHost()` / `clearHost()` は PeerManager の内部フラグを変更するが React state 参照は変わらない。effect の deps が変わらないと cleanup + 再実行が起きず、(a) ビーコンが作成されない (b) heartbeat send/detect の切り替えが起きない (c) peerList broadcast が開始/停止しない。

`roleVersion` state を追加し、全ロール変更時 (ホスト昇格・ソロホスト化・降格) にインクリメント。`getIsHost()` をチェックする 4 つの effect の deps に含める。

`assumeHostRole()` ヘルパー: `clearHost + setAsHost + registerStandardHandlers + setRoleVersion` の 4 操作をバンドル。「`setAsHost()` には必ず `setRoleVersion` が伴う」という不変条件を構造的に保証。

教訓: `isMigrating` をビーコン effect の deps に入れてトリガー流用する方式は一度実装したが、ガードとトリガーの二重目的が混乱を招き即座にバグを再発させた。`roleVersion` のような単一目的のカウンターが正しい抽象化。

### ホストタブ hidden 時の PeerJS ID 解放

ホストのタブが 5 秒以上 hidden になったら PeerManager + ビーコンを destroy し、`la-{roomName}` PeerJS ID を解放。タブ復帰時は Phase 1 から再接続。

旧挙動: ホストのタブが hidden でも PeerJS シグナリング WebSocket は生きたまま。`la-{roomName}` が解放されず、新ホストのビーコン作成が永続的に失敗 → MAX_BEACON_RETRIES で誤った降格が発動していた。

`HOST_HIDDEN_GRACE = 5000` は `HEARTBEAT_TIMEOUT = 8000` より短い必要がある (クライアントがマイグレーション発動する前に ID を解放するため)。5 秒未満の alt-tab はキャンセルされ無害。

### ICE servers: 静的 env → 動的 credential fetch

`VITE_TURN_CREDENTIAL_URL` が設定されていれば、アプリ起動時に Cloudflare Worker から短命 TURN credential を fetch し、ICE servers に使う。未設定なら `VITE_WEBRTC_ICE_SERVERS` (静的 JSON)、さらに未設定なら PeerJS デフォルト (STUN のみ)。

学校ネットワーク (Symmetric NAT + FQDN blacklist) で WebRTC P2P が不可な環境のため。Open Relay (`openrelay.metered.ca`) は全ポート遮断、Cloudflare TURN (`turn.cloudflare.com`) は全ポート開通しており Cloudflare インフラは構造的にブロック不能。短命 credential は Worker で発行し API token を隔離。

Priority: dynamic (Worker fetch) > static (`VITE_WEBRTC_ICE_SERVERS`) > PeerJS defaults。Fetch 失敗は 5s timeout、失敗時は TURN なしで続行。学校ネットでは ICE 失敗 → 既存の auto fallback to WS Relay が効く。

### OFFSET 設計

`OFFSET = Date.now()/1000` (ページロード時刻)。全クライアントで値が異なるため snapshot メッセージで `hostTime` を送信して join 時に 1 回だけ補正。固定値 (`1735689600`) を試みたが Float32 精度の罠に落ちた (→ メタ原則 M10)。

---


## § 通信・セキュリティ

### メッセージバリデーション

`messageHandler.ts` で全メッセージタイプに `isFiniteNumber` / `isValidVector4` / `isValidVector3` / `isValidColor` / `isValidString` のランタイム検証を実施。laser range は `0 < range <= 100` (LASER_RANGE=10 の 10 倍をマージン)。

**意図**: `msg: any` で受け取ったネットワークメッセージの NaN/Infinity 注入防止、laser の color フィールドなど CSS 文字列で CSS インジェクション防止、文字列フィールドの型安全性確保、不正メッセージのリレー防止。

ホストリレー (PeerProvider) でも `isRelayable()` で構造を検証してからブロードキャスト。

**不採用**: body の sender 検証。body の `senderId` は送信者が自己申告する値で spoofing 防御にならない (→ § Authority 解体 B 参照)。

注: `playerColor` メッセージ型は 2026-04-06 に廃止済み (色は決定的算出)。

zod 等のスキーマライブラリは導入せず手書きで軽量に。

### グローバルリーダーボード: Cloudflare KV 単一キー設計

リーダーボード全エントリを KV の単一キー `"top"` に JSON 配列として格納。Worker 側でトップ 50 フィルタ (read → 比較 → 条件付き write)。

KV は値サイズ 25 MB まで。50 エントリ × ~100 bytes ≈ 5 KB で十分収まる。単一キーなら read 1 回 + write 最大 1 回。トップ 50 に入らないスコアは read only (無料枠 100K reads/日で十分)。write は条件付きなので無料枠 1K writes/日を大幅に節約。

トレードオフ: 同時書き込みの last-write-wins。物理デモゲームでは許容。

Worker ソースは `turn-worker/src/index.ts` (TURN credential proxy と同居)。クライアント側 URL は `.env.production` の `VITE_LEADERBOARD_URL`。

### グローバル送信: fetch keepalive (not sendBeacon)

`submitScore` は `fetch({ keepalive: true })` で送る。`pagehide` / `beforeunload` / `visibilitychange` (hidden) の各イベントで発火。

過去経緯:
- 初期 (〜2026-04-14): `sendBeacon` + `Blob("text/plain")` 構成 (→ 旧メタ原則 M9: sendBeacon は CORS preflight 不可、`application/json` だとブラウザが黙って捨てる)
- 2026-04-18: Brave Shields が `sendBeacon` の Request Type=ping を cross-origin tracker として block することが判明。production で HS が local には保存されるのに global には到達しない症状で発覚。`fetch({ keepalive: true })` は ping type ではなく fetch type として分類されるため content blocker を通過する (→ メタ原則 M19)

### Relay サーバーセキュリティ

| パラメータ | 値 | 説明 |
|---|---|---|
| `MAX_MESSAGE_SIZE` | 16 KB | メッセージサイズ上限 |
| `RATE_LIMIT_MAX_MSGS` | 60 msg/s | クライアントごとのレート制限 |
| `MAX_CONNECTIONS` | 100 | 同時接続上限 |
| `HEARTBEAT_INTERVAL_MS` | 30s | WebSocket ping (サーバー→クライアント) |
| `HEARTBEAT_TIMEOUT_MS` | 10s | WebSocket pong タイムアウト |

注: 上記は relay server の WebSocket レベル heartbeat。ゲームクライアントの beacon holder 切断検知は別 (`PeerProvider` の `ping`、Stage G 以降 1s / 2.5s)。

---

