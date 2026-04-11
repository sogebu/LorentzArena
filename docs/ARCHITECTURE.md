# Architecture overview

> This is a high-level overview for both apps. For detailed 2+1 architecture (modules, parameters, message types), see `2+1/CLAUDE.md`. For design decisions, see `2+1/DESIGN.md`.

LorentzArena is intentionally small, but there are a few “conceptual walls” worth documenting:

- **Physics** (special relativity)
- **Rendering / UI** (React + WebGL)
- **Networking** (PeerJS / WebRTC)

This document explains how those pieces talk to each other.

---

## Apps in this repo

- Root app: 1+1 spacetime diagram style renderer (x–t)
- `2+1/`: 2+1 spacetime diagram renderer (x–y–t) using `three.js` / `@react-three/fiber`

The physics and networking layers are intentionally similar across apps.

---

## Physics layer (`src/physics/...`)

The physics modules are written in a functional style (factory functions + plain objects), rather than classes.

Key concepts:

- **Vector3**: 3-velocity / spatial vectors
- **Vector4**: 4-position `(t, x, y, z)`
- **PhaseSpace**: a snapshot of the player state:
  - `pos`: 4-position in the world frame
  - `u`: spatial part of the 4-velocity (proper velocity) in the world frame. Note: this is *not* the 3-velocity `v`; they are related by `u = γv` where `γ = √(1 + |u|²)`
- **WorldLine**: an accumulated history of phase-space states (a discretized trajectory through spacetime)

The game loop updates your own phase space in *proper time* and appends it to your world line.

Then it uses a past light cone intersection to decide “what you can see” of other players.

---

## Networking layer (`src/services/`, `src/contexts/PeerProvider.tsx`)

- `PeerManager<T>` is a thin wrapper around PeerJS data connections.
- `WsRelayManager<T>` is a WebSocket relay fallback for restrictive networks.
- `PeerProvider` exposes the active network manager (PeerJS or WS Relay) to React components. The host validates messages with `isRelayable()` before relaying to other peers.

The game uses a **host-relay model** (star topology). One peer is the host; all others send messages to the host, which relays them. The host also runs hit detection, manages kill/respawn, and keeps authoritative scores.

### Host migration

When the host disconnects, the **oldest client automatically promotes to host**. Detection uses a heartbeat mechanism (3s `ping` interval, 8s timeout) rather than relying on the slow WebRTC ICE timeout (30s+). The new host:

1. Connects to remaining peers directly (PeerJS) or promotes itself on the relay server (WS Relay)
2. Broadcasts a `hostMigration` message with scores and dead player state
3. Reconstructs respawn timers from recorded death timestamps

Design details: `2+1/DESIGN.md`. Networking troubleshooting: `docs/NETWORKING.md`.

---

## UI layer

- Root app draws a 2D spacetime grid and objects on it.
- `2+1/` app renders a 3D spacetime scene:
  - X/Y are space
  - Z is used as **time** (t)

Keeping `t` as the vertical axis makes the “world line” literally a line in the scene.

