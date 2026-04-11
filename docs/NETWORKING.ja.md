# 通信メモ（PeerJS / WebRTC）

このプロジェクトのマルチプレイ同期は **PeerJS（WebRTC のデータチャネル）** で実装しています。

うまくハマると低遅延で最高なんですが、学校・企業ネットワークみたいな「P2P に厳しいネットワーク」だと簡単に死にます。

---

## どういう仕組みで繋がっているか

接続には2つの層があります。

1) **シグナリング（PeerServer）**

- WebRTC のオファー/アンサー、ICE candidate を交換するだけ。
- PeerJS Cloud のデフォルトは `0.peerjs.com:443`。

2) **データ経路（WebRTC / ICE）**

- ゲームのメッセージ本体は WebRTC データチャネルで送ります。
- WebRTC は ICE candidate（host / STUN 経由の srflx など）を使って「直に」繋がる経路を探します。
- 直結に失敗したら **TURN リレー**が必要になります。

重要: PeerServer は中継サーバではありません（ゲームの通信はプロキシしません）。

---

## 制約の厳しいネットワークで死にがちな理由

ありがちな原因:

- **PeerServer への接続（443 / WebSocket）が塞がれている**
- **対称 NAT（symmetric NAT）**で直結が成立しない（TURN が必要）
- **UDP が塞がれている**（WebRTC は UDP 優先なので、TURN の TCP/TLS が必要になりがち）
- **クライアント分離（AP isolation / client isolation）**で同じネットワーク内でも端末同士が通信できない

PeerJS の公式ドキュメントでも代表例として以下が挙げられています:

- 対称 NAT → TURN が必要
- Cloud PeerServer の 443 がブロック → 自前 PeerServer を立てる

参照: https://peerjs.com/docs/

---

## ざっくり診断手順

1) ブラウザの DevTools（開発者ツール）を開いて Console を見る。

2) ログを増やす（アプリディレクトリに `.env.local` を作成、例: `2+1/.env.local`）

```bash
VITE_PEERJS_DEBUG=3
```

3) ありがちな兆候

- PeerServer に届いてない:
  - network / websocket / socket closed 系のエラー
- WebRTC が確立できてない:
  - `iceConnectionState` が `failed` / `disconnected` で終わる

4) ICE の候補が取れているか確認（公式 “trickle-ice”）

- https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

srflx が全然出ない / TURN 以外が全部失敗する、みたいならネットワークがかなり厳しいです。

---

## 対策

選択肢を「インフラ運用負荷の小さい順」に並べると **A' → A → C → B** になります。制約の厳しいネットワーク対策の最初の一手は **A'**。

### A'（最推奨）: Cloudflare TURN + credential Worker

Cloudflare の TURN サーバ (`turn.cloudflare.com`) を使う方法。Cloudflare Worker で短命 credential を発行し、アプリが起動時に自動取得する。**サーバ運用ゼロ、無料枠 1,000 GB/月**。

Cloudflare はインターネットインフラなので、組織のファイアウォールでブロックされる可能性が極めて低い（実際に制約の厳しい組織ネットワークで全ポート開通確認済み）。

**セットアップ**: `2+1/turn-worker/` にある Cloudflare Worker をデプロイし、`VITE_TURN_CREDENTIAL_URL` に Worker URL を設定。詳細は `turn-worker/wrangler.toml` と `2+1/CLAUDE.md` 参照。

```bash
# 2+1/.env.local (or .env.production)
VITE_TURN_CREDENTIAL_URL=https://lorentz-turn.<account>.workers.dev/
```

帯域感: phase space ~100 byte × 60Hz × 4 人 ≈ 24 KB/s。1 時間で 86 MB、月 1,000 GB の無料枠は実質使い切れない量。

> **旧 A'（Open Relay）について**: 以前はこの欄に Open Relay (`openrelay.metered.ca`) を推奨していたが、一部の組織ネットワークで `openrelay.metered.ca` が全ポート遮断されていることが判明。Cloudflare TURN に移行。

### A: 自前 TURN サーバを立てる

A' が落ちた・帯域を完全コントロールしたい場合の次の一手。

**coturn** などで TURN を立てて、TCP/TLS（できれば 443）を有効にします。クライアント設定は A' と同じ形式で URL と credentials だけ差し替え:

```bash
VITE_WEBRTC_ICE_SERVERS='[
  {"urls":["stun:stun.l.google.com:19302"]},
  {"urls":["turns:turn.example.com:443?transport=tcp"],"username":"USER","credential":"PASS"}
]'

# （任意）直結が塞がれているなら relay 固定
VITE_WEBRTC_ICE_TRANSPORT_POLICY=relay
```

注意:

- TURN の認証情報は **秘密**です。公開リポジトリに直書きしないでください。
- 制約の厳しいネットワーク対策なら、TURN/TLS + 443 が生き残りやすいです。

### B: 自前 PeerServer を立てる（シグナリング）

`0.peerjs.com` がフィルタで弾かれる場合、シグナリングだけ自前にすると改善することがあります。

peerjs-server は CLI が用意されています。

```bash
npm install -g peer
peerjs --port 9000 --path /peerjs
```

クライアント設定例:

```bash
VITE_PEERJS_HOST=your-peer-server.example.com
VITE_PEERJS_PORT=9000
VITE_PEERJS_PATH=/peerjs
VITE_PEERJS_SECURE=true
```

これは「シグナリングに届かない問題」を直せますが、TURN の代わりにはなりません。

### C: WebSocket 中継（クライアント・サーバ方式）に切り替える

「とにかくどこでも動いてほしい」なら、P2P を捨ててサーバ中継にするのが最強です。

`2+1/` には WS Relay モードを追加済みです。

0) 1コマンド起動（推奨）:

```bash
cd 2+1
pnpm dev:wsrelay
```

1) relay 依存をインストール（初回のみ）:

```bash
cd 2+1
pnpm relay:install
```

2) 手動で中継サーバ起動:

```bash
cd 2+1
pnpm relay:dev
```

3) クライアント env 設定:

```bash
VITE_NETWORK_TRANSPORT=wsrelay
VITE_WS_RELAY_URL=ws://localhost:8787
```

4) 通常のホスト/クライアント手順で接続

帯域コストは増えますが、NAT/Firewall 問題の多くが消えます。

大学/企業ネットワークでは `wss://...:443` 公開 relay を推奨:

- デプロイ手順: `2+1/relay-deploy/README.md`
- クライアント設定:

```bash
VITE_NETWORK_TRANSPORT=auto
VITE_WS_RELAY_URL=wss://relay.example.com
```

---

## ホストマイグレーション

ホスト中継型アーキテクチャの弱点「ホストが落ちるとセッション崩壊」を自動復旧する仕組み。PeerJS / WS Relay 両方で動作。

### 切断検知: ハートビート方式

WebRTC DataConnection の close イベントは ICE タイムアウト依存で **30 秒以上**（localhost では事実上無限）かかるため、専用のハートビートを使用:

- ホストが **3 秒間隔** で `ping` メッセージを全クライアントに送信
- クライアントは最終受信時刻を記録し、**8 秒間** ping が来なければホスト切断と判定

### マイグレーションフロー

1. **切断検知**: クライアントがハートビートタイムアウトを検知
2. **新ホスト選出**: ホストが接続変化時に proactive に配信していた `peerList`（接続順）の先頭 = 最古参クライアントが新ホスト
3. **再接続**:
   - **PeerJS**: 新ホストが残りクライアントに PeerServer 経由で直接 `connect()`。旧ホストの `la-{roomName}` ID は再取得しない（PeerServer の ID 解放タイムラグを回避）
   - **WS Relay**: 新ホストが `promote_host` で relay server にルーム作成 → 他クライアントが `join_host` で合流
4. **状態引継ぎ**: 新ホストが `hostMigration` メッセージでスコア + dead players（死亡時刻付き）をブロードキャスト
5. **respawn タイマー再構築**: `deathTimeMapRef` に記録された kill 時刻から残り時間を計算し `setTimeout` を再設定

### 制限

- マイグレーション後に新規プレイヤーが `la-{roomName}` で参加すると、新ホストのランダム ID を発見できず別セッションになる（小規模ゲームでは許容）
- マイグレーション中（数秒）はヒット検出が停止する（物理演算はローカルで継続）

---

## 現場感あるアドバイス

- 家（ホットスポット）だと動くのに組織ネットだと死ぬ → ほぼネットワークが原因です。
- 教室・会議室デモを通したい → **A'（Cloudflare TURN + Worker）が最短**。インフラ運用ゼロで TLS/443 経由になる。
- A' で帯域や信頼性が問題になったら A（自前 TURN）or C（自前 WS Relay）。実装済み資産は両方リポに残してある。
