import Peer, { type DataConnection, type PeerOptions } from "peerjs";
import type { ConnectionStatus } from "../types";

/**
 * A tiny wrapper around PeerJS data connections.
 *
 * English:
 *   - PeerJS gives us WebRTC DataChannels + signaling via a PeerServer.
 *   - This class keeps track of connections, fans out messages, and exposes
 *     simple callbacks for React.
 *
 * 日本語:
 *   - PeerJS を使って WebRTC のデータチャネル + PeerServer によるシグナリングを行います。
 *   - このクラスは接続管理とメッセージ配送を薄くラップし、React から扱いやすくします。
 */

export type PeerServerStatus =
  | { status: "connecting" }
  | { status: "open"; id: string }
  | { status: "disconnected" }
  | { status: "error"; type?: string; message: string };

export class PeerManager<T> {
  private readonly localId: string;
  private peer: Peer;
  private conns = new Map<string, DataConnection>();

  private messageCallbacks: Map<string, (id: string, msg: T) => void> =
    new Map();
  private connectionChangeCallback?: (connections: ConnectionStatus[]) => void;

  private peerStatus: PeerServerStatus = { status: "connecting" };
  private peerStatusCallback?: (status: PeerServerStatus) => void;

  // Host/client role flags (used by the game logic)
  private isHost = false;
  private hostId?: string;

  constructor(id: string, options?: PeerOptions) {
    this.localId = id;

    // NOTE:
    // - `open` is emitted when the connection to the PeerServer (signaling) is established.
    // - Actual peer-to-peer data still goes through WebRTC ICE and may fail on restrictive networks.
    this.peer = new Peer(id, {
      ...(options ?? {}),
    });

    this.peer.on("open", (peerId) => {
      this.peerStatus = { status: "open", id: peerId };
      this.peerStatusCallback?.(this.peerStatus);
    });

    this.peer.on("disconnected", () => {
      this.peerStatus = { status: "disconnected" };
      this.peerStatusCallback?.(this.peerStatus);
    });

    this.peer.on("error", (err: unknown) => {
      // PeerJS throws PeerError with `.type`, but keep this defensive.
      const e = err as { type?: string; message?: string };
      this.peerStatus = {
        status: "error",
        type: e.type,
        message: e.message ?? String(err),
      };
      this.peerStatusCallback?.(this.peerStatus);

      // Console log is useful when running in school/corporate networks.
      // (e.g. websocket blocked, ICE failed, etc.)
      // eslint-disable-next-line no-console
      console.error("[PeerManager] Peer error", err);
    });

    this.peer.on("connection", (dc) => this.register(dc));
  }

  /**
   * Subscribe to PeerServer (signaling) status changes.
   *
   * English: This helps show "connected / error" in the UI.
   * 日本語: UI で「シグナリング接続中/失敗」を表示するためのイベントです。
   */
  onPeerStatusChange(cb: (status: PeerServerStatus) => void) {
    this.peerStatusCallback = cb;
    cb(this.peerStatus);
  }

  getPeerStatus(): PeerServerStatus {
    return this.peerStatus;
  }

  /**
   * Connect to a remote peer.
   *
   * Note: this only starts the process. The connection may still fail depending on ICE.
   */
  connect(remoteId: string) {
    const dc = this.peer.connect(remoteId, { label: "game", reliable: true });
    this.register(dc);
  }

  private register(dc: DataConnection) {
    this.conns.set(dc.peer, dc);

    // Reflect "pending" state immediately (open=false) so UI doesn't look frozen.
    this.notifyConnectionChange();

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

    dc.on("error", (err: unknown) => {
      // Keep UI in sync even if ICE fails before "open".
      // eslint-disable-next-line no-console
      console.error("[PeerManager] DataConnection error", dc.peer, err);
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

  /**
   * Send to all connected peers.
   *
   * English: Use for broadcast-style game state updates.
   * 日本語: 全員に送る（ブロードキャスト）用途。
   */
  send(msg: T) {
    for (const c of this.conns.values()) {
      if (c.open) {
        c.send(msg);
      }
    }
  }

  /**
   * Send to all peers except `excludePeerId`.
   *
   * English: handy when the host relays a client's message to everyone else.
   * 日本語: ホストが「送信者以外に転送」したい時に便利。
   */
  broadcast(msg: T, excludePeerId?: string) {
    for (const [id, c] of this.conns.entries()) {
      if (excludePeerId && id === excludePeerId) continue;
      if (c.open) {
        c.send(msg);
      }
    }
  }

  /**
   * Send to a specific peer.
   */
  sendTo(peerId: string, msg: T) {
    const conn = this.conns.get(peerId);
    if (conn?.open) {
      conn.send(msg);
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

  /**
   * The brokering ID of this peer.
   *
   * English: We always generate and pass an ID, so we can return it immediately.
   * 日本語: ID は自前生成しているので、PeerServer の接続前でも返せます。
   */
  id() {
    return this.localId;
  }

  getPeerOptions(): PeerOptions {
    return this.peer.options;
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

  /**
   * Get IDs of currently open (connected) peers.
   */
  getConnectedPeerIds(): string[] {
    return Array.from(this.conns.entries())
      .filter(([_, conn]) => conn.open)
      .map(([id, _]) => id);
  }
}
