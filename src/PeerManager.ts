import Peer, { type DataConnection } from "peerjs";

export type ConnectionStatus = {
  id: string;
  open: boolean;
};

export class PeerManager {
  private peer: Peer;
  private conns = new Map<string, DataConnection>();
  private messageCallback?: (id: string, txt: string) => void;
  private connectionChangeCallback?: (connections: ConnectionStatus[]) => void;

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

    dc.on("data", (txt: unknown) =>
      this.messageCallback?.(dc.peer, txt as string),
    );

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

  send(txt: string) {
    for (const c of this.conns.values()) {
      if (c.open) {
        c.send(txt);
      }
    }
  }

  onMessage(cb: (id: string, txt: string) => void) {
    this.messageCallback = cb;
  }

  onConnectionChange(cb: (connections: ConnectionStatus[]) => void) {
    this.connectionChangeCallback = cb;
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
}
