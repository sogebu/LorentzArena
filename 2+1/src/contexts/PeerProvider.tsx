import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  buildPeerOptionsFromEnv,
  getNetworkingEnvSummary,
  getNetworkTransportModeFromEnv,
  getWsRelayUrlFromEnv,
} from "../config/peer";
import { PeerManager, type PeerServerStatus } from "../services/PeerManager";
import { WsRelayManager, type WsRelayStatus } from "../services/WsRelayManager";
import type { ConnectionStatus, Message } from "../types";

type ActiveTransport = "peerjs" | "wsrelay";
type NetworkStatus = PeerServerStatus | WsRelayStatus;
type NetworkManager = PeerManager<Message> | WsRelayManager<Message>;

/**
 * Auto-connection phase for PeerJS mode.
 *
 * "trying-host": Attempting to register with the room ID as peer ID.
 *   - If successful → we are the host.
 *   - If "unavailable-id" error → someone else is host → move to "connecting-client".
 *
 * "connecting-client": Registered with a random ID, connecting to the room ID.
 *
 * "connected": Connected (as host or client).
 *
 * "manual": WS Relay mode or manual override — uses old manual flow.
 */
type ConnectionPhase = "trying-host" | "connecting-client" | "connected" | "manual";

interface PeerContextValue {
  peerManager: NetworkManager | null;
  connections: ConnectionStatus[];
  myId: string | null;
  peerStatus: NetworkStatus;
  networkingEnv: ReturnType<typeof getNetworkingEnvSummary>;
  activeTransport: ActiveTransport;
  availableTransports: ActiveTransport[];
  autoFallbackTriggered: boolean;
  connectionPhase: ConnectionPhase;
  roomName: string;
  setActiveTransport: (transport: ActiveTransport) => void;
}

export const PeerContext = createContext<PeerContextValue | null>(null);

interface PeerProviderProps {
  children: ReactNode;
  roomName: string;
}

/** Register standard host relay handlers on a PeerManager. */
const registerHostRelay = (pm: NetworkManager) => {
  pm.onMessage("host", (senderId, msg) => {
    if (!pm.getIsHost()) return;

    if (msg.type === "requestPeerList") {
      const peerIds = pm.getConnectedPeerIds();
      pm.sendTo(senderId, { type: "peerList", peers: peerIds });
      for (const peerId of peerIds) {
        if (peerId !== senderId) {
          pm.sendTo(peerId, { type: "peerList", peers: [...peerIds, senderId] });
        }
      }
      return;
    }

    if (msg.type === "phaseSpace" || msg.type === "laser") {
      pm.broadcast(msg, senderId);
    }
  });
};

export const PeerProvider = ({ children, roomName }: PeerProviderProps) => {
  const [peerManager, setPeerManager] = useState<NetworkManager | null>(null);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [peerStatus, setPeerStatus] = useState<NetworkStatus>({
    status: "connecting",
  });
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>("trying-host");

  const networkingEnvBase = useMemo(() => getNetworkingEnvSummary(), []);
  const preferredTransportMode = useMemo(() => getNetworkTransportModeFromEnv(), []);
  const wsRelayUrl = useMemo(() => getWsRelayUrlFromEnv(), []);
  const localIdRef = useRef(Math.random().toString(36).substring(2, 11));

  const roomPeerId = `la-${roomName}`;

  const availableTransports = useMemo<ActiveTransport[]>(
    () => (wsRelayUrl ? ["peerjs", "wsrelay"] : ["peerjs"]),
    [wsRelayUrl],
  );

  const [activeTransport, setActiveTransportState] =
    useState<ActiveTransport>(() => {
      if (preferredTransportMode === "wsrelay" && wsRelayUrl) {
        return "wsrelay";
      }
      return "peerjs";
    });
  const [autoFallbackTriggered, setAutoFallbackTriggered] = useState(false);

  const setActiveTransport = useCallback(
    (transport: ActiveTransport) => {
      if (transport === "wsrelay" && !wsRelayUrl) return;
      setAutoFallbackTriggered(false);
      setActiveTransportState(transport);
      setConnectionPhase("manual");
    },
    [wsRelayUrl],
  );

  const networkingEnv = useMemo(
    () => ({
      ...networkingEnvBase,
      activeTransport,
    }),
    [networkingEnvBase, activeTransport],
  );

  // WS Relay: manual mode (現状維持)
  useEffect(() => {
    if (activeTransport !== "wsrelay") return;

    const localId = localIdRef.current;

    if (!wsRelayUrl) {
      setPeerManager(null);
      setConnections([]);
      setMyId(localId);
      setPeerStatus({
        status: "error",
        type: "config_error",
        message: "VITE_WS_RELAY_URL is not set.",
      });
      return;
    }

    setConnectionPhase("manual");
    const pm = new WsRelayManager<Message>(localId, { url: wsRelayUrl });
    setMyId(localId);

    pm.onPeerStatusChange((status) => setPeerStatus(status));
    pm.onConnectionChange((conns) => setConnections(conns));
    registerHostRelay(pm);
    setPeerManager(pm);

    return () => { pm.destroy(); };
  }, [activeTransport, wsRelayUrl]);

  // PeerJS: Phase 1 — ルーム ID でホスト試行
  useEffect(() => {
    if (activeTransport !== "peerjs") return;
    if (connectionPhase !== "trying-host") return;

    let owned = true; // このエフェクトが pm の所有権を持っているか

    const pm = new PeerManager<Message>(roomPeerId, buildPeerOptionsFromEnv());

    pm.onPeerStatusChange((status) => {
      setPeerStatus(status);
      if (status.status === "open") {
        // ルーム ID の登録に成功 → ホストになる
        owned = false; // 所有権を setPeerManager に移譲
        pm.setAsHost();
        setMyId(roomPeerId);
        registerHostRelay(pm);
        setPeerManager(pm);
        setConnectionPhase("connected");
      } else if (status.status === "error" && status.type === "unavailable-id") {
        // 既にホストがいる → クライアントモードへ
        owned = false;
        pm.destroy();
        setConnectionPhase("connecting-client");
      }
    });

    pm.onConnectionChange((conns) => setConnections(conns));

    return () => {
      if (owned) pm.destroy();
    };
  }, [activeTransport, connectionPhase, roomPeerId]);

  // PeerJS: Phase 2 — ランダム ID でクライアント接続
  useEffect(() => {
    if (activeTransport !== "peerjs") return;
    if (connectionPhase !== "connecting-client") return;

    let owned = true;

    const localId = localIdRef.current;
    const pm = new PeerManager<Message>(localId, buildPeerOptionsFromEnv());

    pm.onPeerStatusChange((status) => {
      setPeerStatus(status);
      if (status.status === "open") {
        // シグナリング接続OK → ルーム ID のホストに接続
        owned = false;
        pm.setHostId(roomPeerId);
        pm.connect(roomPeerId);
        setMyId(localId);
        registerHostRelay(pm);
        setPeerManager(pm);
        setConnectionPhase("connected");
      }
    });

    pm.onConnectionChange((conns) => setConnections(conns));

    return () => {
      if (owned) pm.destroy();
    };
  }, [activeTransport, connectionPhase, roomPeerId]);

  // Auto-fallback: PeerJS → WS Relay
  useEffect(() => {
    if (preferredTransportMode !== "auto") return;
    if (!wsRelayUrl) return;
    if (activeTransport !== "peerjs") return;
    if (peerStatus.status !== "error") return;
    if (
      peerStatus.type === "unavailable-id" ||
      peerStatus.type === "ws_error" ||
      peerStatus.type === "relay_error" ||
      peerStatus.type === "config_error"
    ) {
      return;
    }
    setAutoFallbackTriggered(true);
    setActiveTransportState("wsrelay");
  }, [preferredTransportMode, wsRelayUrl, activeTransport, peerStatus]);

  return (
    <PeerContext.Provider
      value={{
        peerManager,
        connections,
        myId,
        peerStatus,
        networkingEnv,
        activeTransport,
        availableTransports,
        autoFallbackTriggered,
        connectionPhase,
        roomName,
        setActiveTransport,
      }}
    >
      {children}
    </PeerContext.Provider>
  );
};
