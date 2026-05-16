# VPN-aware multi-tier transport fallback

**Date**: 2026-05-16
**Status**: 📋 **検討中** (= next session 着手予定)
**Motivation**: 2026-05-16 F1 deploy 直後、 共著者 (= 安田くん) 側 NordVPN 経由で「繋がっては切れ + 両者ホスト」 観察。 NordVPN P2P サーバ Japan-Tokyo #826 接続でも繋がらず、 user 側設定変更で改善余地小 → ゲーム側 multi-tier fallback で対処。
**Design 思想 doc**: [`design/network-recovery.md §軸 9`](../design/network-recovery.md)

---

## §1 問題の構造

### §1.1 観察された症状

- (1) **繋がっては切れ**: WebRTC DataConnection の `dc.close` が repeat fire
- (2) **両者ホスト**: signaling allocation race (= `la-{roomName}` beacon allocation が signaling timeout で release され、 reconnect 時に両者が claim)

(2) は (1) の二次症状。

### §1.2 真因

VPN が WebRTC connection を以下のいずれかで壊す:

- **symmetric NAT 化**: VPN が outbound port を毎接続変える → 相手側からの STUN binding が落ちる → P2P 直接接続不可
- **UDP block**: 一部 corporate VPN は UDP を全 block → TURN over TCP/TLS 必須
- **MITM inspection**: VPN endpoint で DTLS handshake を inspect → 失敗
- **IP 不整合**: VPN tunnel 経由の IP candidate と STUN reflexive candidate が混在 → ICE pair check が confuse

安田くん NordVPN は P2P サーバで NAT は WebRTC 向き設定だったが、 それでも繋がらない → ICE candidate gathering / pair selection の何らかが問題、 setting 変更で fix 困難と判断。

### §1.3 既存の経路 (= code 上 multi-tier 構造)

| Tier | 経路 | 状態 |
|---|---|---|
| **1** | WebRTC direct (= host + STUN srflx candidates) | 現状 default、 LAN / 開放 NAT で動く |
| **2** | WebRTC via TURN (= Cloudflare TURN relay) | 現状 default、 [`.env.production`](../.env.production) `VITE_TURN_CREDENTIAL_URL` 設定済 |
| **3** | **WS Relay** (= [`relay-server/server.mjs`](../relay-server/server.mjs) + [`relay-deploy/`](../relay-deploy/) Caddy + Docker) | **code 既存、 production 未 deploy** (= `VITE_WS_RELAY_URL` 未設定) |

[`src/config/peer.ts`](../src/config/peer.ts) で `"peerjs" | "wsrelay" | "auto"` mode 切替対応、 [`PeerProvider.tsx`](../src/contexts/PeerProvider.tsx) で実装。 ただし **起動時の選択のみで runtime fallback 未実装**。

---

## §2 修復案の比較

| 案 | 動作 | UX | 工数 | latency | TURN 障害耐性 | TURN credential expire 耐性 |
|---|---|---|---|---|---|---|
| **A 改: 全員 always-relay** | `VITE_WEBRTC_ICE_TRANSPORT_POLICY=relay` を `.env.production` hardcode | 透明、 user 何もしない | **数分** | 全員 +5-15ms (= 日本国内 Tokyo TURN endpoint) | ✗ (TURN 障害 = 全員ダウン) | ✗ (credential expire = mid-game drop) |
| **C 案: WebRTC 内 auto-fallback** | 起動時 `iceTransportPolicy: 'all'`、 N sec で 'open' 来なければ close + `'relay'` で reconnect | 透明 (= VPN user は N sec 待ち) | **1-2 時間** | direct user 0、 VPN user +5-15ms | ✗ (TURN 障害 = relay fallback も死ぬ) | △ (再 fallback 可能、 実装次第) |
| **Tier 3 enable + 多段 fallback** | C 案 + Tier 2 timeout → WS Relay 切替 | 透明 (= 多段の待ち時間あり) | **3-5 時間** (= server deploy + runtime logic) | direct 0、 TURN +5-15ms、 WS Relay +50-100ms | ✓ (TURN 障害 = WS Relay に flowing) | ✓ (= WS Relay 経由は credential 不要) |

### §2.1 段階的アプローチ

**段階 1 (= 次セッション着手)**: C 案を実装。 安田くん次回 play で verify。 多くの VPN ケースはこれで救えるはず。

**段階 2 (= C 案で救えなかった場合)**: WS Relay deploy + runtime fallback (= Tier 3 enable)。 段階 1 失敗が観察されたときのみ着手、 over-engineering 回避。

---

## §3 C 案の実装方針 (= 段階 1)

### §3.1 既存 PeerProvider の transport switching

[`PeerProvider.tsx`](../src/contexts/PeerProvider.tsx) に既存の transport mode (= peerjs / wsrelay) 切替機構があるが、 起動時の選択のみで runtime 切替不在。

### §3.2 PeerJS の iceTransportPolicy 制御

PeerJS の `peer.connect(remoteId, { config: { iceServers, iceTransportPolicy } })` で per-connection 制御可能。 transport policy は `'all'` (= direct + TURN) / `'relay'` (= TURN only) の 2 値。

### §3.3 fallback state machine

```
[初期]
  ↓ peer.connect with iceTransportPolicy='all'
[Tier 1+2 試行中]
  ├─ N sec 以内に 'open' → [Tier 1+2 確立] → 通常 play
  ├─ N sec 経過 'open' 来ない → close + peer.connect with iceTransportPolicy='relay'
  └─ error event → 同上 fallback
[Tier 2 only 試行中]
  ├─ M sec 以内に 'open' → [Tier 2 確立] → 通常 play (= +5-15ms latency)
  └─ M sec 経過 'open' 来ない → 'unable to connect' 通知
```

### §3.4 timeout 値の選択

- **N (= Tier 1+2 試行 timeout)**: 5-10 sec (= WebRTC ICE candidate gathering + pair check の典型上限)
- **M (= Tier 2 only 試行 timeout)**: 5-10 sec (= 同上、 relay 経由でも候補数少ないので変化なし)

合計最大待ち時間: ~20 sec。 UX 上 spinner 表示で待ちを明示。

### §3.5 関連 file 修正候補

- [`PeerProvider.tsx`](../src/contexts/PeerProvider.tsx) — transport switching ロジック拡張、 useEffect / state machine 追加
- [`src/config/peer.ts`](../src/config/peer.ts) — timeout 定数追加
- [`.env.production`](../.env.production) — 変更なし (= `VITE_WEBRTC_ICE_TRANSPORT_POLICY` は default の 'all' 維持、 runtime で切替)
- 新規 test (= optional): peer manager の transport switching を unit test

### §3.6 UI 側

「Reconnecting via relay...」 等の spinner / message 表示 (= 既存 connection status overlay があるなら統合)。

---

## §4 Tier 3 enable の実装方針 (= 段階 2、 必要時)

### §4.1 WS Relay server deploy

- 既存 [`relay-server/`](../relay-server/) を Docker image として build
- Fly.io / Render / Cloudflare Workers / 自宅 server などに deploy
- TLS 証明書 (= [`relay-deploy/Caddyfile`](../relay-deploy/Caddyfile) で Let's Encrypt 自動取得設定済)
- domain 取得 (= 既存ドメインの subdomain で OK)

### §4.2 環境設定

```bash
# .env.production
VITE_WS_RELAY_URL=wss://relay.example.com/
```

### §4.3 runtime fallback logic

PeerProvider で:
1. Tier 1+2 (= WebRTC) を C 案で試行
2. Tier 2 only も失敗 → WS Relay (`transport=wsrelay`) で再接続

[`src/config/peer.ts`](../src/config/peer.ts) の transport mode が既に切替可能なので、 PeerProvider 側で setActiveTransportState('wsrelay') を呼ぶだけ。

---

## §5 verify path

### §5.1 段階 1 (= C 案) 後

- odakin 自宅環境 (= 直接接続可) で latency 変化なし confirm
- 安田くん次回 play 時、 VPN ON 状態で接続成功 confirm
- 接続時間が ~5-15 sec (= Tier 1+2 timeout) 後に確立する観察

### §5.2 段階 2 (= Tier 3 enable) 後

- Tier 2 故意失敗 (= `.env.local` で 不正な TURN URL) → Tier 3 自動切替 confirm
- corporate VPN / 強い firewall 環境での test (= 可能なら)

---

## §6 関連

- 設計思想 doc: [`design/network-recovery.md §軸 9`](../design/network-recovery.md)
- SESSION 記録: [`SESSION.md `「5/16 多 commit batch」](../SESSION.md) +「次セッション持ち越し §5」
- F1 plan (= 同 session deploy、 異なる問題): commit [`996ac44`](https://github.com/sogebu/LorentzArena/commit/996ac44) + design/network-recovery.md §軸 8
- 共著者側 NordVPN 接続情報 (= 5/16 screenshot 共有): P2P server Japan-Tokyo、 NAT は WebRTC 向き設定。 詳細 (= server# / IP / upstream ISP) は本 public repo 除外で個人層 / network-notes リポ参照
