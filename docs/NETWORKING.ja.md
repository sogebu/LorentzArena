# 通信メモ（PeerJS / WebRTC）

このプロジェクトのマルチプレイ同期は **PeerJS（WebRTC のデータチャネル）** で実装しています。

うまくハマると低遅延で最高なんですが、学校・企業 Wi‑Fi みたいな「P2P に厳しいネットワーク」だと簡単に死にます。

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

## 学校の Wi‑Fi で死にがちな理由

ありがちな原因:

- **PeerServer への接続（443 / WebSocket）が塞がれている**
- **対称 NAT（symmetric NAT）**で直結が成立しない（TURN が必要）
- **UDP が塞がれている**（WebRTC は UDP 優先なので、TURN の TCP/TLS が必要になりがち）
- **クライアント分離（AP isolation）**で同じ Wi‑Fi 内でも端末同士が通信できない

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

選択肢を「インフラ運用負荷の小さい順」に並べると **A' → A → C → B** になります。学校 Wi-Fi 対策の最初の一手は **A'**。

### A'（最推奨・最小コスト）: 公開無料 TURN を使う

クライアントの env に **1 行追加してビルドし直すだけ** で済む方法。サーバ運用ゼロ、クレカ・ドメイン・アカウント不要。

[Open Relay Project (Metered.ca)](https://www.metered.ca/tools/openrelay/) が公開している無料 TURN を使います。`turns:` (TLS over 443) エンドポイントが使えるので、UDP 完全遮断や DPI のある学校でも HTTPS と区別できず通る確率が高い。

```bash
# 2+1/.env.local
VITE_WEBRTC_ICE_SERVERS='[
  {"urls":["stun:stun.l.google.com:19302"]},
  {"urls":["stun:stun.cloudflare.com:3478"]},
  {"urls":["turn:openrelay.metered.ca:80"],"username":"openrelayproject","credential":"openrelayproject"},
  {"urls":["turns:openrelay.metered.ca:443?transport=tcp"],"username":"openrelayproject","credential":"openrelayproject"}
]'
```

ビルドして本番デプロイ:

```bash
cd 2+1
pnpm run deploy
```

帯域感: phase space ~100 byte × 60Hz × 4 人 ≈ 24 KB/s。1 時間で 86 MB、月 50GB の無料枠は実質使い切れない量。

注意点:

- 公開 TURN なので **SLA なし**。商用クリティカルには使えない。落ちたら A（自前 TURN）か C（自前 WS Relay）に切り替える。
- クレデンシャルは公開値なので秘匿不要。リポに直書き OK。

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
- 学校 Wi‑Fi 対策なら、TURN/TLS + 443 が生き残りやすいです。

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

## 現場感あるアドバイス

- 家（ホットスポット）だと動くのに学校だと死ぬ → ほぼネットワークが原因です。
- 教室デモを通したい → **A'（公開 TURN を env に追加）が最短**。インフラ運用ゼロで TLS/443 経由になる。
- A' で帯域や信頼性が問題になったら A（自前 TURN）or C（自前 WS Relay）。実装済み資産は両方リポに残してある。
