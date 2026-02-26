import type { ConnectionStatus } from "../types";

export type WsRelayStatus =
  | { status: "connecting" }
  | { status: "open"; id: string }
  | { status: "disconnected" }
  | { status: "error"; type?: string; message: string };

type RelayMessageIn<T> =
  | { type: "hello_ack"; id: string }
  | { type: "peers"; hostId: string; peers: string[] }
  | { type: "deliver"; from: string; msg: T }
  | { type: "host_closed"; hostId: string }
  | { type: "error"; message: string };

type RelayOptions = {
  url: string;
};

/**
 * WebSocket relay-based network manager.
 *
 * English:
 *   - Works on networks where WebRTC P2P is blocked.
 *   - Keeps the same API shape as PeerManager so game logic can stay unchanged.
 *
 * 日本語:
 *   - WebRTC の P2P が塞がれる環境向けの WebSocket 中継実装です。
 *   - PeerManager とほぼ同じ API を提供し、ゲームロジック側の変更を最小化します。
 */
export class WsRelayManager<T> {
  private readonly localId: string;
  private readonly url: string;
  private ws: WebSocket | null = null;
  private pendingPackets: string[] = [];

  private conns = new Map<string, ConnectionStatus>();
  private messageCallbacks: Map<string, (id: string, msg: T) => void> =
    new Map();
  private connectionChangeCallback?: (connections: ConnectionStatus[]) => void;

  private peerStatus: WsRelayStatus = { status: "connecting" };
  private peerStatusCallback?: (status: WsRelayStatus) => void;

  private isHost = false;
  private hostId?: string;

  constructor(id: string, options: RelayOptions) {
    this.localId = id;
    this.url = options.url;
    this.openSocket();
  }

  private openSocket() {
    this.ws = new WebSocket(this.url);

    this.ws.addEventListener("open", () => {
      this.peerStatus = { status: "open", id: this.localId };
      this.peerStatusCallback?.(this.peerStatus);
      this.ws?.send(JSON.stringify({ type: "hello", peerId: this.localId }));

      if (this.pendingPackets.length > 0) {
        for (const packet of this.pendingPackets) {
          this.ws?.send(packet);
        }
        this.pendingPackets = [];
      }
    });

    this.ws.addEventListener("close", () => {
      this.peerStatus = { status: "disconnected" };
      this.peerStatusCallback?.(this.peerStatus);
      this.conns.clear();
      this.notifyConnectionChange();
    });

    this.ws.addEventListener("error", () => {
      this.peerStatus = {
        status: "error",
        type: "ws_error",
        message: "WebSocket relay connection error",
      };
      this.peerStatusCallback?.(this.peerStatus);
    });

    this.ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(String(event.data)) as RelayMessageIn<T>;
        this.handleServerMessage(data);
      } catch {
        // ignore parse errors from malformed packets
      }
    });
  }

  private handleServerMessage(data: RelayMessageIn<T>) {
    switch (data.type) {
      case "hello_ack":
        return;
      case "peers": {
        const next = new Map<string, ConnectionStatus>();
        for (const peerId of data.peers) {
          if (peerId === this.localId) continue;
          next.set(peerId, { id: peerId, open: true });
        }
        this.hostId = data.hostId || this.hostId;
        this.conns = next;
        this.notifyConnectionChange();
        return;
      }
      case "deliver":
        for (const cb of this.messageCallbacks.values()) {
          cb(data.from, data.msg);
        }
        return;
      case "host_closed":
        this.conns.clear();
        this.notifyConnectionChange();
        if (!this.isHost) {
          this.hostId = undefined;
        }
        return;
      case "error":
        this.peerStatus = {
          status: "error",
          type: "relay_error",
          message: data.message,
        };
        this.peerStatusCallback?.(this.peerStatus);
        return;
      default:
        return;
    }
  }

  private sendRaw(payload: unknown) {
    const packet = JSON.stringify(payload);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingPackets.push(packet);
      return;
    }
    this.ws.send(packet);
  }

  private notifyConnectionChange() {
    this.connectionChangeCallback?.(this.getConnections());
  }

  onPeerStatusChange(cb: (status: WsRelayStatus) => void) {
    this.peerStatusCallback = cb;
    cb(this.peerStatus);
  }

  getPeerStatus(): WsRelayStatus {
    return this.peerStatus;
  }

  connect(remoteId: string) {
    this.hostId = remoteId;
    this.sendRaw({ type: "join_host", hostId: remoteId });
  }

  send(msg: T) {
    for (const c of this.conns.values()) {
      if (c.open) {
        this.sendTo(c.id, msg);
      }
    }
  }

  broadcast(msg: T, excludePeerId?: string) {
    for (const c of this.conns.values()) {
      if (excludePeerId && c.id === excludePeerId) continue;
      if (c.open) {
        this.sendTo(c.id, msg);
      }
    }
  }

  sendTo(peerId: string, msg: T) {
    this.sendRaw({
      type: "send_to",
      to: peerId,
      msg,
    });
  }

  onMessage(id: string, cb: (id: string, msg: T) => void) {
    this.messageCallbacks.set(id, cb);
  }

  offMessage(id: string) {
    this.messageCallbacks.delete(id);
  }

  onConnectionChange(cb: (connections: ConnectionStatus[]) => void) {
    this.connectionChangeCallback = cb;
    cb(this.getConnections());
  }

  destroy() {
    this.messageCallbacks.clear();
    this.pendingPackets = [];
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  id() {
    return this.localId;
  }

  getPeerOptions() {
    return {};
  }

  getConnections(): ConnectionStatus[] {
    return Array.from(this.conns.values());
  }

  setAsHost() {
    this.isHost = true;
    this.hostId = this.localId;
    this.sendRaw({ type: "set_host" });
  }

  getIsHost(): boolean {
    return this.isHost;
  }

  setHostId(hostId: string) {
    this.hostId = hostId;
  }

  getHostId(): string | undefined {
    return this.hostId;
  }

  getConnectedPeerIds(): string[] {
    return this.getConnections()
      .filter((c) => c.open)
      .map((c) => c.id);
  }
}
