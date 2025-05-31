import Peer, { type DataConnection } from "peerjs";

export class PeerManager {
  private peer: Peer;
  private conns = new Map<string, DataConnection>();
  private onMessage?: (id: string, txt: string) => void;

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
    dc.on("data", (txt: unknown) => this.onMessage?.(dc.peer, txt as string));
    dc.on("close", () => this.conns.delete(dc.peer));
  }

  send(txt: string) {
    for (const c of this.conns.values()) {
      if (c.open) {
        c.send(txt);
      }
    }
  }

  on(cb: (id: string, txt: string) => void) {
    this.onMessage = cb;
  }

  id() {
    return this.peer.id;
  }
}
