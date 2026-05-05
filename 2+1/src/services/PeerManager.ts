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
  private readonly peerOptions?: PeerOptions;
  private peer: Peer;
  private conns = new Map<string, DataConnection>();

  private messageCallbacks: Map<string, (id: string, msg: T) => void> =
    new Map();
  private connectionChangeCallback?: (connections: ConnectionStatus[]) => void;

  private peerStatus: PeerServerStatus = { status: "connecting" };
  private peerStatusCallback?: (status: PeerServerStatus) => void;

  // Beacon holder / peer role flags (Stage F naming).
  // "beacon holder" = 旧 "host"。PeerJS ビーコン ID (la-{roomName}) の
  // 所有者で、relay hub として機能する。authority は既に分散済み
  // (Stage A〜E 完了)、ここでの role は「誰が relay を担当するか」のみ。
  private isBeaconHolder = false;
  private beaconHolderId?: string;

  constructor(id: string, options?: PeerOptions) {
    this.localId = id;
    this.peerOptions = options;

    // NOTE:
    // - `open` is emitted when the connection to the PeerServer (signaling) is established.
    // - Actual peer-to-peer data still goes through WebRTC ICE and may fail on restrictive networks.
    this.peer = this.createPeer();
  }

  /**
   * 新 Peer instance を作成 + 必要な listener を attach する private 経路。
   * `constructor` と `reconnect()` (= signaling 死亡時の再構築) の両方から呼ぶ。
   */
  private createPeer(): Peer {
    const peer = new Peer(this.localId, {
      ...(this.peerOptions ?? {}),
    });

    peer.on("open", (peerId) => {
      this.peerStatus = { status: "open", id: peerId };
      this.peerStatusCallback?.(this.peerStatus);
    });

    peer.on("disconnected", () => {
      this.peerStatus = { status: "disconnected" };
      this.peerStatusCallback?.(this.peerStatus);
    });

    peer.on("error", (err: unknown) => {
      // PeerJS throws PeerError with `.type`, but keep this defensive.
      const e = err as { type?: string; message?: string };
      this.peerStatus = {
        status: "error",
        type: e.type,
        message: e.message ?? String(err),
      };
      this.peerStatusCallback?.(this.peerStatus);

      // unavailable-id is expected in auto-connect flow (room discovery).
      // Only log actual errors (websocket blocked, ICE failed, etc.)
      if (e.type !== "unavailable-id") {
        // eslint-disable-next-line no-console
        console.error("[PeerManager] Peer error", err);
      }
    });

    peer.on("connection", (dc) => this.register(dc));
    return peer;
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
   * Signaling self-recovery (= Bug 11 候補 (d)、 思想 doc:
   * `design/network-recovery.md` 軸 2/3 H3): WebSocket 切断後の再接続経路。
   *
   * **動機**: PeerJS で WebSocket signaling が切れた後、 同 instance の
   * `peer.reconnect()` は既知挙動 (= `Cannot connect to new Peer after
   * disconnecting from server`) で失敗することが多い。 sleep-wake / network
   * outage で発生し、 user は「シグナリング: エラー」 表示のまま stuck する。
   *
   * **動作**:
   * 1. `peer.destroyed` なら新 Peer instance を生成 (= 既に詰んでる場合の唯一経路)
   * 2. `peer.disconnected` なら `peer.reconnect()` を試行 (= PeerJS 内部 retry)
   * 3. 既存 conns Map は保持 (= 既存 P2P connection は signaling 復帰しても継続可能、
   *    切れた peer は `dc.on('close')` で個別に削除される既存経路に任せる)
   *
   * **fallback**: 1-2 で復旧しない場合は `peer.destroy()` + 新 instance 作成
   * (= caller 側で peerStatus を watch して 5 sec 等の grace 後再呼出する想定、
   * 本 method 内では試行のみ)。
   *
   * **localId 維持**: 同 ID で再 join できれば既存 player state は保持 (host
   * 側で旧 ID の `peer-unavailable` cleanup 後に再 connect される)。 server
   * side で旧 ID が active 残留している場合は新 Peer creation で
   * `unavailable-id` error → 既存 Auto-fallback useEffect (PeerProvider) が
   * WS Relay へ切替する経路で吸収。
   */
  reconnect() {
    if (this.peer.destroyed) {
      // eslint-disable-next-line no-console
      console.log("[PeerManager] Peer destroyed — creating new instance");
      this.peer = this.createPeer();
      return;
    }
    if (this.peer.disconnected) {
      try {
        // eslint-disable-next-line no-console
        console.log("[PeerManager] Attempting peer.reconnect()");
        this.peer.reconnect();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[PeerManager] peer.reconnect() threw, destroying + recreating",
          err,
        );
        try {
          this.peer.destroy();
        } catch {
          // ignore
        }
        this.peer = this.createPeer();
      }
    }
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

  setAsBeaconHolder() {
    this.isBeaconHolder = true;
    this.beaconHolderId = this.localId;
  }

  getIsBeaconHolder(): boolean {
    return this.isBeaconHolder;
  }

  /** Reset beacon-holder role flags for migration. */
  clearBeaconHolder() {
    this.isBeaconHolder = false;
    this.beaconHolderId = undefined;
  }

  /** Close and remove a specific peer's connection (e.g., stale beacon holder after migration). */
  disconnectPeer(peerId: string) {
    const conn = this.conns.get(peerId);
    if (conn) {
      try {
        conn.close();
      } catch {
        // ignore
      }
      this.conns.delete(peerId);
      this.notifyConnectionChange();
    }
  }

  setBeaconHolderId(id: string) {
    this.beaconHolderId = id;
  }

  getBeaconHolderId(): string | undefined {
    return this.beaconHolderId;
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
