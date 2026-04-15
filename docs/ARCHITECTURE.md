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

The game uses a **beacon-relay model** (star topology for relay, target-authoritative for events). One peer holds the well-known "beacon" PeerJS ID and acts as the relay hub; all peers send owner-authored events (`phaseSpace`, `laser`, `kill`, `respawn`) which the beacon holder relays to others. Each peer runs hit detection only for the players *it* owns (self + lighthouse for the beacon holder), so authority is per-player rather than centralized.

### Beacon migration

When the beacon holder disconnects, the **oldest remaining client automatically takes over the beacon**. Detection uses a heartbeat mechanism (`ping` 1s interval, 2.5s timeout) rather than the slow WebRTC ICE timeout. Migration is narrow — only the beacon ownership and the lighthouse owner flag are handed over; per-player respawn timers etc. already live on each owner locally, so no state reconstruction is needed.

Design details: `2+1/DESIGN.md § Authority 解体 (完了リファクタ)`. Networking troubleshooting: `docs/NETWORKING.md`.

---

## UI layer

- Root app draws a 2D spacetime grid and objects on it.
- `2+1/` app renders a 3D spacetime scene:
  - X/Y are space
  - Z is used as **time** (t)

Keeping `t` as the vertical axis makes the “world line” literally a line in the scene.

The 2+1 renderer uses a **"D pattern"**: geometry is defined in *world coordinates* and the observer's Lorentz boost + translation is applied as the mesh's `matrix` (per-vertex on the GPU). React only deals with world coordinates; switching the observer frame, or extending to 3+1D later, is just a matrix swap. Decision rationale and alternatives: `2+1/DESIGN.md § D pattern 化 (完了リファクタ)`.

Volumetric point markers (player spheres, explosion particles, etc.) are an intentional exception — they stay in a translation-only placement to avoid being γ-stretched into ellipsoids.

