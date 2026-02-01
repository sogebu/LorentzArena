# Architecture overview

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
  - `u`: 3-velocity in the world frame
- **WorldLine**: an accumulated history of phase-space states (a discretized trajectory through spacetime)

The game loop updates your own phase space in *proper time* and appends it to your world line.

Then it uses a past light cone intersection to decide “what you can see” of other players.

---

## Networking layer (`src/services/PeerManager.ts`, `src/contexts/PeerProvider.tsx`)

- `PeerManager<T>` is a thin wrapper around PeerJS data connections.
- `PeerProvider` exposes the PeerManager to React components.

The game sends small JSON messages (phase space updates, laser events, etc.) and updates local state when they arrive.

For networking caveats and how to make it work on restrictive networks, see:

- `docs/NETWORKING.md`

---

## UI layer

- Root app draws a 2D spacetime grid and objects on it.
- `2+1/` app renders a 3D spacetime scene:
  - X/Y are space
  - Z is used as **time** (t)

Keeping `t` as the vertical axis makes the “world line” literally a line in the scene.

