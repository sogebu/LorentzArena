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
  | { type: "host_closed"; hostId: string; peers: string[] }
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
  private hostClosedCallback?: (survivingPeers: string[]) => void;

  // Beacon holder / peer role flags (Stage F naming; 旧 isHost / hostId)。
  // Relay-server 側の wire protocol (`peers.hostId` / `host_closed.hostId` /
  // `join_host` / `set_host` / `promote_host`) は後方互換のため残す。
  private isBeaconHolder = false;
  private beaconHolderId?: string;

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
        this.beaconHolderId = data.hostId || this.beaconHolderId;
        this.conns = next;
        this.notifyConnectionChange();
        return;
      }
      case "deliver":
        for (const cb of this.messageCallbacks.values()) {
          cb(data.from, data.msg);
        }
        return;
      case "host_closed": {
        // Update peerOrderRef via callback BEFORE clearing connections,
        // so migration election has the peer list available.
        const survivingPeers = data.peers ?? [];
        this.hostClosedCallback?.(survivingPeers);
        // Clear connections — triggers migration detection in PeerProvider.
        this.conns.clear();
        if (!this.isBeaconHolder) {
          this.beaconHolderId = undefined;
        }
        this.notifyConnectionChange();
        return;
      }
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

  /**
   * Subscribe to host disconnection events.
   * Called when relay server reports the host has closed.
   * Includes the list of surviving peers for migration election.
   */
  onHostClosed(cb: (survivingPeers: string[]) => void) {
    this.hostClosedCallback = cb;
  }

  getPeerStatus(): WsRelayStatus {
    return this.peerStatus;
  }

  connect(remoteId: string) {
    this.beaconHolderId = remoteId;
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

  /**
   * Signaling self-recovery (= Bug 11 候補 (d) transport 対称版、 思想 doc:
   * `design/network-recovery.md` 軸 2 system topology 軸 + transport 対称性):
   * WebSocket 切断後の再接続経路。 PeerManager.reconnect() と同 API で union
   * `NetworkManager` 型から transport 抽象的に呼べる (= PeerProvider 側で
   * instanceof check 不要、 transport 対称性が architecture 的に確立される)。
   *
   * **動作**:
   * 1. WS が `OPEN` or `CONNECTING` 状態なら no-op (= 既に復旧中)
   * 2. それ以外 (= `CLOSED` / null) → 旧 ws を close してから `openSocket()` 再呼出
   * 3. 既存 `addEventListener("open"/"close"/"error"/"message")` 経路で peerStatus
   *    が "connecting" → "open" に遷移、 PeerProvider の subscribers が再 evaluate
   *
   * **conns 保持**: 既存 close listener が `conns.clear() + notifyConnectionChange()`
   * を呼ぶ設計、 reconnect 後は relay server から peers list を再 receive して conns
   * 再構築される (= existing flow を踏襲、 race なし)。
   *
   * **localId 維持**: 同 ID で再 register、 server side で旧 entry が active 残留
   * していても server は new connection でreplace する設計 (relay-server 仕様)。
   */
  reconnect() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log("[WsRelayManager] Attempting WebSocket reconnect");
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.openSocket();
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

  setAsBeaconHolder() {
    this.isBeaconHolder = true;
    this.beaconHolderId = this.localId;
    this.sendRaw({ type: "set_host" }); // relay server protocol: 旧名のまま
  }

  /**
   * Promote self to beacon holder during migration (after previous holder disconnected).
   * Uses a dedicated relay-server message that preserves the room membership.
   */
  promoteToBeaconHolder() {
    this.isBeaconHolder = true;
    this.beaconHolderId = this.localId;
    this.sendRaw({ type: "promote_host" }); // relay server protocol: 旧名のまま
  }

  getIsBeaconHolder(): boolean {
    return this.isBeaconHolder;
  }

  /** Reset beacon holder role flags for migration. */
  clearBeaconHolder() {
    this.isBeaconHolder = false;
    this.beaconHolderId = undefined;
  }

  setBeaconHolderId(id: string) {
    this.beaconHolderId = id;
  }

  getBeaconHolderId(): string | undefined {
    return this.beaconHolderId;
  }

  getConnectedPeerIds(): string[] {
    return this.getConnections()
      .filter((c) => c.open)
      .map((c) => c.id);
  }

  /** Parity with PeerManager: drop a peer from the local connection view.
   *  WS relay has no per-peer channel to close — server membership is untouched. */
  disconnectPeer(peerId: string) {
    if (this.conns.delete(peerId)) {
      this.notifyConnectionChange();
    }
  }
}
