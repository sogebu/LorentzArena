# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LorentzArena is a multiplayer arena game that simulates special relativity effects. Players experience Lorentz contraction, time dilation, and Doppler shifts as they move at relativistic speeds. Built with React, TypeScript, and PeerJS for peer-to-peer networking.

## Commands

### Development
- `pnpm run dev` - Start Vite development server
- `pnpm run build` - Build TypeScript project and bundle with Vite
- `pnpm run preview` - Preview production build

### Code Quality
- `pnpm run lint` - Run Biome linter with auto-fix
- `pnpm run format` - Run Biome formatter with auto-fix

### Deployment
- `pnpm run deploy` - Build and deploy to GitHub Pages

### Analysis
- `pnpm run analyze` - Generate bundle size visualization

## Architecture

### Physics Engine (/src/physics/)
The physics module uses a function-based factory pattern instead of classes:
- `vector.ts` - 3D and 4D vector operations
- `matrix.ts` - Lorentz transformation matrices
- `mechanics.ts` - Core relativistic physics including phase space (8D: 4D position + 4D velocity), proper time calculations, and Lorentz boosts
- `worldLine.ts` - Object trajectories through spacetime

### Networking Architecture
Peer-to-peer communication using WebRTC via PeerJS:
- `PeerManager` (/src/services/PeerManager.ts) - Generic class managing WebRTC connections, message handling, and connection states
- `PeerProvider` (/src/contexts/PeerProvider.tsx) - React context providing peer connectivity to components
- Host/Client model where one player coordinates peer discovery
- Message types: position updates, phase space data, peer list management

### Game Components
- `RelativisticGame` (/src/components/RelativisticGame.tsx) - Main game arena handling:
  - Keyboard controls (arrow keys for movement)
  - Relativistic physics simulation
  - Grid rendering with Lorentz contraction effects
  - Doppler color shifting based on relative velocity
  - Past light cone calculations (players see where objects were, not where they are)
  - FPS counter for performance monitoring

### Build Configuration
- Vite configured with base path `/LorentzArena/` for GitHub Pages deployment
- TypeScript uses project references for app and node contexts
- Biome configured for double quotes and 2-space indentation
- React StrictMode enabled for development

### Key Patterns
- Factory pattern for physics modules (not class-based)
- Immutable phase space objects (readonly properties)
- Type-safe message passing between peers using union types
- Clear separation between physics engine, networking layer, and UI components