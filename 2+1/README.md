# Lorentz Arena 2+1

[English](#english) | [日本語](#日本語)

## English

This folder contains the **2+1 spacetime** version (x, y, t) rendered with `three.js` via `@react-three/fiber`.

Quick start:

```bash
pnpm install
pnpm dev
```

Networking notes:
- Multiplayer uses PeerJS/WebRTC.
- Some networks (school/enterprise) block P2P. See `../docs/NETWORKING.md`.

## 日本語

このフォルダは **2+1 次元（x, y, t）** 版です。`three.js`（@react-three/fiber）で描画します。

起動手順:

```bash
pnpm install
pnpm dev
```

通信について:
- PeerJS/WebRTC を使っています。
- 学校・企業 Wi‑Fi だと P2P が塞がれて動かないことがあります。`../docs/NETWORKING.ja.md` を参照してください。
