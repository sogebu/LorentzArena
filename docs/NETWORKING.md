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

- `.env.local`

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

### Option A (recommended): add a TURN server

If you want this to work on restrictive networks, TURN is the pragmatic solution.

You can run your own TURN server using **coturn** and enable TURN over TCP/TLS (often on port 443).

Then set:

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

## Practical advice

- If it works on a phone hotspot but not on school Wi‑Fi: it’s almost certainly the network.
- If you need a classroom demo: deploy a TURN server with TLS/443 and configure clients via `.env.local`.
