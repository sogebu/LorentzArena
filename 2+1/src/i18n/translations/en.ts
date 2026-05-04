import type { TranslationKey } from "./ja";

export const en: Record<TranslationKey, string> = {
  // HUD - title & controls
  "hud.title": "Relativistic Arena (2+1D Spacetime)",
  "hud.controls.forward": "WASD: Move (body-relative)",
  "hud.controls.cameraH": "←/→: Turn (heading)",
  "hud.controls.cameraV": "↑/↓: Camera pitch",
  "hud.controls.fire": "Space: Fire laser",
  "hud.controls.touch.heading": "Swipe ←→: Turn",
  "hud.controls.touch.thrust": "Swipe ↑: Forward ↓: Backward",
  "hud.controls.touch.fire": "Double-tap and hold to fire rapidly",
  // WebGL context loss overlay
  "webglLost.title": "Rendering (WebGL) paused",
  "webglLost.body":
    "The browser reclaimed GPU resources. Physics still runs internally but the screen appears frozen. Click \"Reload\" to recover.",
  "webglLost.reloadButton": "Reload",
  // Tutorial overlay (mobile only, shown once per browser)
  "tutorial.title": "Controls",
  "tutorial.swipeHorizontal": "Horizontal swipe: Turn",
  "tutorial.swipeVertical": "Vertical swipe: Forward / Back",
  "tutorial.fire": "Double-tap + hold: Rapid fire",
  "tutorial.dismissHint": "Tap anywhere to dismiss",
  // HUD - toggles
  "hud.restFrame": "Rest frame",
  "hud.worldFrame": "World frame",
  "hud.orthographic": "Orthographic",
  "hud.perspective": "Perspective",
  // View mode (plans/2026-04-25-viewpoint-controls.md)
  // classic: legacy (chase camera, ship body rotates, body-relative thrust)
  // shooter: twin-stick (fixed camera, ship hull stationary, cannon points to input dir)
  "hud.viewMode.classic": "Classic",
  "hud.viewMode.shooter": "Shooter",
  "hud.viewMode.jellyfish": "Jellyfish",
  "hud.viewMode.label": "Hull",
  // Distance unit (internal c=1 natural unit = light-second).
  "hud.distanceUnit": "ls",
  "hud.center": "Center",
  // controlScheme (orthogonal axis to viewMode, see game-store.ts §ControlScheme)
  "hud.controlScheme.label": "Controls",
  "hud.controlScheme.legacy_classic": "Legacy Classic",
  "hud.controlScheme.legacy_shooter": "Legacy Shooter",
  "hud.controlScheme.modern": "Modern",
  // PLC slice mode (PR #2): spacetime ↔ PLC slice (= past light cone spatial slice on x-y plane)
  "hud.spacetime": "Spacetime",
  "hud.plcSlice": "PLC Slice",
  // HUD - stats
  "hud.speed": "Speed",
  "hud.gamma": "Gamma",
  "hud.properTime": "Proper time",
  "hud.position": "Position",
  "hud.energy": "ENERGY",
  "hud.fuelEmpty": "OUT OF FUEL",
  // HUD - scoreboard
  "hud.kills": "Kills",
  "hud.you": "You",
  "hud.lighthouse": "Lighthouse",
  // HUD - overlays (in-game state text)
  "hud.firing": "FIRING",
  "hud.kill": "KILL",
  "hud.dead": "DEAD",
  "hud.causalFreeze.title": "Causal Freeze",
  "hud.causalFreeze.sub": "In another ship's future light cone",
  "hud.causalityJump.title": "Causality Jump",
  "hud.causalityJump.sub": "Out of another ship's past light cone",
  "hud.build": "build",
  // Connect panel
  "connect.title": "Connection",
  "connect.minimize": "Minimize",
  "connect.expand": "Expand",
  "connect.signaling.ok": "Signaling: Connected",
  "connect.signaling.connecting": "Signaling: Connecting...",
  "connect.signaling.disconnected": "Signaling: Disconnected",
  "connect.signaling.error": "Signaling: Error",
  "connect.signaling.unknown": "Signaling: Unknown",
  "connect.transport": "Transport",
  "connect.yourId": "Your ID",
  "connect.generating": "Generating...",
  "connect.phase.tryingHost": " connecting... (trying host)",
  "connect.phase.connectingClient": " connecting... (client)",
  "connect.phase.host": "Host",
  "connect.phase.client": "Client",
  "connect.phase.manual": "Manual connection mode",
  "connect.room": "Room",
  "connect.networkHelp":
    "WebRTC may be blocked on school/corporate networks, preventing connection.",
  "connect.peers": "Connected peers",
  "connect.peerOpen": "open",
  "connect.peerClosed": "connecting/failed",
  "connect.networkSettings": "Network settings (env)",
  // Lobby
  "lobby.title": "Lorentz Arena",
  "lobby.subtitle": "Relativistic Multiplayer Arena",
  "lobby.nameLabel": "Player name",
  "lobby.namePlaceholder": "Enter your name",
  "lobby.start": "START",
  "lobby.highScores": "High Scores",
  "lobby.noScores": "No records yet",
  "lobby.kills": "Kills",
  "lobby.duration": "Time",
  "lobby.globalLeaderboard": "Global Leaderboard",
  "lobby.loading": "Loading...",
};
