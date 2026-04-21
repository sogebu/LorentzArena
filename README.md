# Lorentz Arena

*[Japanese version](README.ja.md)*

A multiplayer arena where **special relativity is the gameplay mechanic**.

## Why this exists

Special relativity is usually taught through static diagrams and algebra. This project turns a handful of relativistic concepts — proper time, light cones, simultaneity, causality — into something you *play* rather than derive. You move at relativistic speeds, your shots travel along lightlike worldlines, and the marker you see isn't where the other player *is*: it's where light from them reached you. Dodging means acting before the photons arrive; aiming means predicting where the target will be when light (then laser) catches up.

If you've drawn Minkowski diagrams on paper and wondered what it *feels like* to be inside one, this is that.

## A concrete moment

You see another player's marker at position (10, 0). You fire. Your laser travels along a lightlike worldline; it only connects if the target stays on a predictable course. The game renders a faint future-light-cone intersection marker on the target's side — a hint of where the laser is headed. They accelerate perpendicular, a small kick, and the shot misses. You know this later: a bright past-light-cone intersection triangle on your side is what actually arrives. Meanwhile, entering the target's future light cone freezes your controls, because acting on their "current" position would require superluminal information about them.

## Live demo

<https://sogebu.github.io/LorentzArena/>

Open the URL in multiple tabs, or share with friends. The URL is the room — no ID to enter. Use `#room=name` in the URL for separate rooms.

## Quick start

```bash
cd 2+1 && pnpm install && pnpm dev
```

Full development guide: [2+1/CLAUDE.md](2+1/CLAUDE.md).

## What's where

- **[2+1/](2+1/)** — the main game (actively developed). 2+1D spacetime (x, y, t), `three.js` + `@react-three/fiber`
- **[1+1/](1+1/)** — legacy 1+1D prototype (x, t). No longer maintained
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — 30,000ft narrative of the codebase
- **[docs/NETWORKING.md](docs/NETWORKING.md)** — P2P vs WS relay, TURN setup, restrictive-network troubleshooting
- **[2+1/DESIGN.md](2+1/DESIGN.md)** — design decisions with rationale
- **[2+1/README.md](2+1/README.md)** — controls, derivations, parameter reference
- **[docs/references/](docs/references/)** — physics paper this project is based on (self-authored, CC BY 4.0)

## Core concepts

- **Past light cone rendering** — each object is drawn where its worldline intersects the observer's past light cone, solved analytically as a quadratic per segment
- **Causality guard** — controls freeze while you're inside another player's future light cone; acting on that position would violate light-speed causality
- **Target-authoritative kills** — each player decides whether they were hit. Removes host authority over "did the shot land" and its desync failure modes
- **Rest frame toggle** — the whole scene gets a Lorentz boost so you always see yourself at rest

Mathematical derivations in [2+1/README.md](2+1/README.md#relativistic-algorithms). Design rationale in [2+1/DESIGN.md](2+1/DESIGN.md).

## License

MIT
