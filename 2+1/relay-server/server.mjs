import { WebSocketServer } from "ws";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const wss = new WebSocketServer({ port });

/**
 * clientId -> socketState
 * socketState: { ws, peerId, roomHostId? }
 */
const clientsById = new Map();
const clientsBySocket = new Map();
const rooms = new Map(); // hostId -> Set<peerId>

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
  for (const peerId of members) {
    if (peerId === hostId) continue;
    const client = getClientById(peerId);
    if (!client) continue;
    client.roomHostId = undefined;
    sendJson(client.ws, { type: "host_closed", hostId });
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

wss.on("connection", (ws) => {
  const state = {
    ws,
    peerId: undefined,
    roomHostId: undefined,
  };
  clientsBySocket.set(ws, state);

  ws.on("message", (raw) => {
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

console.log(`[ws-relay] listening on ws://0.0.0.0:${port}`);
