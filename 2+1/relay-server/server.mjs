import { WebSocketServer } from "ws";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);

// --- Security limits ---
const MAX_MESSAGE_SIZE = 16 * 1024; // 16 KB per message
const MAX_CONNECTIONS = 100; // total concurrent connections
const RATE_LIMIT_WINDOW_MS = 1000; // 1 second window
const RATE_LIMIT_MAX_MSGS = 60; // max messages per window
const HEARTBEAT_INTERVAL_MS = 30_000; // 30s ping interval
const HEARTBEAT_TIMEOUT_MS = 10_000; // 10s pong timeout

const wss = new WebSocketServer({ port, maxPayload: MAX_MESSAGE_SIZE });

/**
 * clientId -> socketState
 * socketState: { ws, peerId, roomHostId?, rateCounter, rateWindowStart, alive }
 */
const clientsById = new Map();
const clientsBySocket = new Map();
const rooms = new Map(); // hostId -> Set<peerId>

// --- Heartbeat ---
const heartbeatInterval = setInterval(() => {
  for (const [ws, state] of clientsBySocket) {
    if (!state.alive) {
      ws.terminate();
      continue;
    }
    state.alive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

const sendJson = (ws, payload) => {
  if (ws.readyState !== 1) return; // 1 = OPEN
  ws.send(JSON.stringify(payload));
};

const getClientById = (peerId) => clientsById.get(peerId);

const removeFromRoom = (peerId, roomHostId) => {
  if (!roomHostId) return;
  const members = rooms.get(roomHostId);
  if (!members) return;
  members.delete(peerId);
  if (members.size === 0) {
    rooms.delete(roomHostId);
  }
};

const broadcastPeers = (hostId) => {
  const members = rooms.get(hostId);
  if (!members) return;
  const peers = Array.from(members);
  for (const peerId of peers) {
    const client = getClientById(peerId);
    if (!client) continue;
    sendJson(client.ws, {
      type: "peers",
      hostId,
      peers,
    });
  }
};

const closeHostRoom = (hostId) => {
  const members = rooms.get(hostId);
  if (!members) return;
  // Collect surviving peers for migration election
  const survivingPeers = Array.from(members).filter((id) => id !== hostId);
  for (const peerId of survivingPeers) {
    const client = getClientById(peerId);
    if (!client) continue;
    client.roomHostId = undefined;
    sendJson(client.ws, { type: "host_closed", hostId, peers: survivingPeers });
  }
  rooms.delete(hostId);
};

const ensureIdentified = (state) => {
  if (!state.peerId) {
    sendJson(state.ws, {
      type: "error",
      message: "peerId is not set; send hello first",
    });
    return false;
  }
  return true;
};

const parse = (raw) => {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
};

/** Returns true if the client exceeds rate limit. */
const isRateLimited = (state) => {
  const now = Date.now();
  if (now - state.rateWindowStart > RATE_LIMIT_WINDOW_MS) {
    state.rateWindowStart = now;
    state.rateCounter = 0;
  }
  state.rateCounter++;
  return state.rateCounter > RATE_LIMIT_MAX_MSGS;
};

wss.on("connection", (ws) => {
  // Connection limit
  if (clientsBySocket.size >= MAX_CONNECTIONS) {
    ws.close(1013, "server full");
    return;
  }

  const state = {
    ws,
    peerId: undefined,
    roomHostId: undefined,
    rateCounter: 0,
    rateWindowStart: Date.now(),
    alive: true,
  };
  clientsBySocket.set(ws, state);

  ws.on("pong", () => {
    state.alive = true;
  });

  ws.on("message", (raw) => {
    // Rate limiting
    if (isRateLimited(state)) {
      sendJson(ws, { type: "error", message: "rate limited" });
      return;
    }

    const msg = parse(raw);
    if (!msg || typeof msg.type !== "string") {
      sendJson(ws, { type: "error", message: "invalid payload" });
      return;
    }

    switch (msg.type) {
      case "hello": {
        const peerId = String(msg.peerId ?? "");
        if (!peerId) {
          sendJson(ws, { type: "error", message: "peerId is required" });
          return;
        }
        if (clientsById.has(peerId)) {
          sendJson(ws, {
            type: "error",
            message: `peerId '${peerId}' is already connected`,
          });
          return;
        }
        state.peerId = peerId;
        clientsById.set(peerId, state);
        sendJson(ws, { type: "hello_ack", id: peerId });
        return;
      }

      case "set_host": {
        if (!ensureIdentified(state)) return;
        const hostId = state.peerId;
        if (!rooms.has(hostId)) {
          rooms.set(hostId, new Set());
        }
        removeFromRoom(state.peerId, state.roomHostId);
        state.roomHostId = hostId;
        rooms.get(hostId).add(hostId);
        broadcastPeers(hostId);
        return;
      }

      case "join_host": {
        if (!ensureIdentified(state)) return;
        const hostId = String(msg.hostId ?? "");
        if (!hostId) {
          sendJson(ws, { type: "error", message: "hostId is required" });
          return;
        }
        if (!rooms.has(hostId)) {
          sendJson(ws, {
            type: "error",
            message: `host '${hostId}' not found`,
          });
          return;
        }
        removeFromRoom(state.peerId, state.roomHostId);
        state.roomHostId = hostId;
        rooms.get(hostId).add(state.peerId);
        broadcastPeers(hostId);
        return;
      }

      case "promote_host": {
        if (!ensureIdentified(state)) return;
        const newHostId = state.peerId;
        // Create a new room with this peer as host
        if (!rooms.has(newHostId)) {
          rooms.set(newHostId, new Set());
        }
        rooms.get(newHostId).add(newHostId);
        state.roomHostId = newHostId;
        // Allow other peers to join via join_host with the new host ID
        broadcastPeers(newHostId);
        return;
      }

      case "send_to": {
        if (!ensureIdentified(state)) return;
        const to = String(msg.to ?? "");
        if (!to) {
          sendJson(ws, { type: "error", message: "to is required" });
          return;
        }
        if (!state.roomHostId) {
          sendJson(ws, { type: "error", message: "not in a room" });
          return;
        }
        const room = rooms.get(state.roomHostId);
        if (!room || !room.has(to)) {
          sendJson(ws, {
            type: "error",
            message: `target '${to}' is not in room '${state.roomHostId}'`,
          });
          return;
        }
        const target = getClientById(to);
        if (!target) {
          sendJson(ws, {
            type: "error",
            message: `target '${to}' is offline`,
          });
          return;
        }
        sendJson(target.ws, {
          type: "deliver",
          from: state.peerId,
          msg: msg.msg,
        });
        return;
      }

      default:
        sendJson(ws, { type: "error", message: `unknown message type: ${msg.type}` });
    }
  });

  ws.on("close", () => {
    const peerId = state.peerId;
    const roomHostId = state.roomHostId;

    if (peerId) {
      clientsById.delete(peerId);
    }
    clientsBySocket.delete(ws);

    if (!peerId) return;

    if (roomHostId === peerId) {
      closeHostRoom(peerId);
      return;
    }

    removeFromRoom(peerId, roomHostId);
    if (roomHostId) {
      broadcastPeers(roomHostId);
    }
  });
});

// Graceful shutdown
const shutdown = () => {
  clearInterval(heartbeatInterval);
  wss.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`[ws-relay] listening on ws://0.0.0.0:${port} (max ${MAX_CONNECTIONS} clients, ${MAX_MESSAGE_SIZE} bytes/msg, ${RATE_LIMIT_MAX_MSGS} msgs/s)`);
