import Peer, { type DataConnection } from "peerjs";
import type { ConnectionStatus } from "../types";

export class PeerManager<T> {
  private peer: Peer;
  private conns = new Map<string, DataConnection>();
  private messageCallbacks: Map<string, (id: string, msg: T) => void> =
    new Map();
  private connectionChangeCallback?: (connections: ConnectionStatus[]) => void;
  private isHost = false;
  private hostId?: string;

  constructor(id: string) {
    this.peer = new Peer(id, { debug: 2 });
    this.peer.on("connection", (dc) => this.register(dc));
  }

  connect(remoteId: string) {
    const dc = this.peer.connect(remoteId, { label: "chat", reliable: true });
    this.register(dc);
  }

  private register(dc: DataConnection) {
    this.conns.set(dc.peer, dc);

    dc.on("open", () => {
      this.notifyConnectionChange();
    });

    dc.on("data", (msg: unknown) => {
      for (const cb of this.messageCallbacks.values()) {
        cb(dc.peer, msg as T);
      }
    });

    dc.on("close", () => {
      this.conns.delete(dc.peer);
      this.notifyConnectionChange();
    });
  }

  private notifyConnectionChange() {
    const connections = Array.from(this.conns.entries()).map(([id, conn]) => ({
      id,
      open: conn.open,
    }));
    this.connectionChangeCallback?.(connections);
  }

  send(msg: T) {
    for (const c of this.conns.values()) {
      if (c.open) {
        c.send(msg);
      }
    }
  }

  onMessage(id: string, cb: (id: string, msg: T) => void) {
    this.messageCallbacks.set(id, cb);
  }

  offMessage(id: string) {
    this.messageCallbacks.delete(id);
  }

  onConnectionChange(cb: (connections: ConnectionStatus[]) => void) {
    this.connectionChangeCallback = cb;
  }

  destroy() {
    this.peer.destroy();
  }

  id() {
    return this.peer.id;
  }

  getConnections(): ConnectionStatus[] {
    return Array.from(this.conns.entries()).map(([id, conn]) => ({
      id,
      open: conn.open,
    }));
  }

  setAsHost() {
    this.isHost = true;
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

  // 特定のピアにメッセージを送信
  sendTo(peerId: string, msg: T) {
    const conn = this.conns.get(peerId);
    if (conn && conn.open) {
      conn.send(msg);
    }
  }

  // 接続されているすべてのピアIDを取得
  getConnectedPeerIds(): string[] {
    return Array.from(this.conns.entries())
      .filter(([_, conn]) => conn.open)
      .map(([id, _]) => id);
  }
}
