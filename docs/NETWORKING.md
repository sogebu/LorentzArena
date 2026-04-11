# Networking notes (PeerJS / WebRTC)

This project uses **PeerJS** (WebRTC data channels) for multiplayer state sync.

That gives you low-latency peer-to-peer traffic *when it works*, but there’s a catch: some networks are actively hostile to P2P (schools and enterprise Wi‑Fi are classic).

---

## How the connection works

There are two layers:

1) **Signaling (PeerServer)**

- Used only to exchange WebRTC offers/answers and ICE candidates.
- PeerJS Cloud defaults to `0.peerjs.com:443`.

2) **Data path (WebRTC / ICE)**

- Actual gameplay messages are sent over a WebRTC data channel.
- WebRTC tries to connect peers directly using ICE candidates (host / srflx via STUN).
- If that fails, you need a relay: **TURN**.

PeerServer is *not* a relay. It does not proxy gameplay traffic.

---

## Why it often fails on school Wi‑Fi

Typical reasons:

- **Port 443 or WebSocket to PeerServer is blocked** (some networks do this).
- **Symmetric NAT** (direct peer connections can’t be established reliably without TURN).
- **UDP blocked** (WebRTC prefers UDP; if it’s blocked, you usually need TURN over TCP/TLS).
- **Client isolation / AP isolation** (devices on the same Wi‑Fi cannot talk to each other).

PeerJS itself calls out two common failure modes:

- symmetric NAT → you’ll need TURN
- cloud PeerServer port 443 blocked → run your own PeerServer

See PeerJS docs: https://peerjs.com/docs/

---

## Quick diagnosis checklist

1) Open browser DevTools console.

2) Set verbose logs:

- `.env.local` (create in the app directory, e.g. `2+1/.env.local`)

```bash
VITE_PEERJS_DEBUG=3
```

3) Look for signs:

- PeerServer not reachable:
  - errors mentioning network / websocket / socket closed
- WebRTC not establishing:
  - `iceConnectionState` ends in `failed` / `disconnected`

4) Use the official ICE “trickle test” to see what candidates you can gather:

- https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

If you get **no srflx candidates** or everything fails unless you use TURN/TLS, your network is restrictive.

---

## Fix options

Ordered by infrastructure cost (low → high): **A' → A → C → B**. The first thing to try for a school Wi‑Fi problem is **A'**.

### Option A' (best): use a free public TURN

The cheapest fix that does not require running anything: add one env var, rebuild, redeploy. No server, no domain, no account.

This uses [Open Relay Project (Metered.ca)](https://www.metered.ca/tools/openrelay/), a free public TURN service that exposes a `turns:` (TLS over 443) endpoint. Because TLS-on-443 is indistinguishable from HTTPS, this typically gets through DPI / UDP-blocked school networks.

```bash
# 2+1/.env.local
VITE_WEBRTC_ICE_SERVERS='[
  {"urls":["stun:stun.l.google.com:19302"]},
  {"urls":["stun:stun.cloudflare.com:3478"]},
  {"urls":["turn:openrelay.metered.ca:80"],"username":"openrelayproject","credential":"openrelayproject"},
  {"urls":["turns:openrelay.metered.ca:443?transport=tcp"],"username":"openrelayproject","credential":"openrelayproject"}
]'
```

Then build and deploy:

```bash
cd 2+1
pnpm run deploy
```

Bandwidth math: phase space ~100 B × 60 Hz × 4 players ≈ 24 KB/s. One hour ≈ 86 MB; the 50 GB/month free quota is effectively unbounded for this use case.

Caveats:

- It is a public service with **no SLA**. If it ever goes down, fall back to Option A (your own TURN) or Option C (your own WS relay).
- Credentials are public values; safe to commit.

### Option A: run your own TURN server

Use this if A' goes down or you want full control over bandwidth.

You can run your own TURN server using **coturn** and enable TURN over TCP/TLS (often on port 443). Same client config as A' with your own URL and credentials:

```bash
VITE_WEBRTC_ICE_SERVERS='[
  {"urls":["stun:stun.l.google.com:19302"]},
  {"urls":["turns:turn.example.com:443?transport=tcp"],"username":"USER","credential":"PASS"}
]'

# (optional) force relay-only
VITE_WEBRTC_ICE_TRANSPORT_POLICY=relay
```

Notes:

- TURN credentials are **secrets**. Don’t hardcode them in a public repo.
- For schools, TURN over TLS on 443 is frequently the only path that survives.

### Option B: run your own PeerServer (signaling)

If `0.peerjs.com` is blocked, run a PeerServer on a domain/port your network allows.

PeerJS Server (peerjs-server) supports a CLI:

```bash
npm install -g peer
peerjs --port 9000 --path /peerjs
```

Then configure the client:

```bash
VITE_PEERJS_HOST=your-peer-server.example.com
VITE_PEERJS_PORT=9000
VITE_PEERJS_PATH=/peerjs
VITE_PEERJS_SECURE=true
```

This fixes signaling reachability, but it does *not* replace TURN.

### Option C: switch to a client-server relay (WebSocket)

If you need “it works everywhere” and can accept server bandwidth costs, a WebSocket relay is often the simplest.

`2+1/` now includes a WS relay mode:

0) one-command local start (recommended):

```bash
cd 2+1
pnpm dev:wsrelay
```

1) install relay deps (first time only)

```bash
cd 2+1
pnpm relay:install
```

2) run relay server manually

```bash
cd 2+1
pnpm relay:dev
```

3) set client env

```bash
VITE_NETWORK_TRANSPORT=wsrelay
VITE_WS_RELAY_URL=ws://localhost:8787
```

4) start app and connect using host/client flow as usual

This avoids most NAT/P2P failures (at the cost of relay server bandwidth).

For university/enterprise networks, prefer public `wss://...:443` relay:

- deploy guide: `2+1/relay-deploy/README.md`
- client setting:

```bash
VITE_NETWORK_TRANSPORT=auto
VITE_WS_RELAY_URL=wss://relay.example.com
```

---

## Host migration

Automatic recovery when the host disconnects. Works with both PeerJS and WS Relay.

### Disconnect detection: heartbeat

The WebRTC DataConnection `close` event relies on ICE timeout (30s+, effectively infinite on localhost). Instead, the host sends a `ping` message every **3 seconds**. If a client receives no ping for **8 seconds**, it considers the host gone.

### Migration flow

1. **Detection**: client heartbeat timeout fires
2. **Election**: the first peer in the `peerList` (ordered by connection time, proactively broadcast by the host on connection changes) becomes the new host
3. **Reconnection**:
   - **PeerJS**: new host calls `connect()` to each remaining peer via PeerServer. The old host's `la-{roomName}` ID is NOT re-acquired (avoids PeerServer ID release lag)
   - **WS Relay**: new host sends `promote_host` to create a new room on the relay server; other clients `join_host`
4. **State transfer**: new host broadcasts `hostMigration` with scores + dead players (each with a `Date.now()` death timestamp)
5. **Respawn timer reconstruction**: remaining = `RESPAWN_DELAY - (now - deathTime)`, clamped to 0

### Limitations

- After migration, new joiners using `la-{roomName}` won't discover the new host (separate session). Acceptable for small groups.
- Hit detection pauses during migration (a few seconds). Physics continues locally.

---

## Practical advice

- If it works on a phone hotspot but not on school Wi‑Fi: it’s almost certainly the network.
- For a classroom demo, **start with Option A'** (public TURN env var). Zero infra, TLS/443, usually solves it.
- If A' bandwidth or reliability becomes a real concern, escalate to A (own TURN) or C (own WS relay). Both are still implemented in the repo.
