import type { TranslationKey } from "./ja";

export const en: Record<TranslationKey, string> = {
  // HUD - title & controls
  "hud.title": "Relativistic Arena (2+1D Spacetime)",
  "hud.controls.forward": "W/S: Forward/Back  A/D: Strafe",
  "hud.controls.cameraH": "←/→: Camera yaw",
  "hud.controls.cameraV": "↑/↓: Camera pitch",
  "hud.controls.fire": "Space: Fire laser",
  "hud.controls.touch.heading": "Swipe ←→: Turn",
  "hud.controls.touch.thrust": "Swipe ↑: Forward ↓: Backward",
  "hud.controls.touch.fire": "Double-tap and hold to fire rapidly",
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
