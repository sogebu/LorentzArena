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

2) ログを増やす（`.env.local`）

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

### A（推奨）: TURN サーバを追加する

制限が強い環境で「確実に動かす」なら TURN が現実解です。

**coturn** などで TURN を立てて、TCP/TLS（できれば 443）を有効にします。

クライアント側はこんな感じで設定します。

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

帯域コストは増えますが、NAT/Firewall 問題の多くが消えます。

---

## 現場感あるアドバイス

- 家（ホットスポット）だと動くのに学校だと死ぬ → ほぼネットワークが原因です。
- 教室デモを通したい → TURN（TLS/443）を用意して、`.env.local` で切り替えるのが最短です。
