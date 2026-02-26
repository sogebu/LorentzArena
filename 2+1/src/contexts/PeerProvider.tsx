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

interface PeerContextValue {
  peerManager: NetworkManager | null;
  connections: ConnectionStatus[];
  myId: string | null;
  peerStatus: NetworkStatus;
  networkingEnv: ReturnType<typeof getNetworkingEnvSummary>;
  activeTransport: ActiveTransport;
  availableTransports: ActiveTransport[];
  autoFallbackTriggered: boolean;
  setActiveTransport: (transport: ActiveTransport) => void;
}

export const PeerContext = createContext<PeerContextValue | null>(null);

interface PeerProviderProps {
  children: ReactNode;
}

export const PeerProvider = ({ children }: PeerProviderProps) => {
  // PeerManager とそれに連動するステートを保持
  const [peerManager, setPeerManager] = useState<NetworkManager | null>(null);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [peerStatus, setPeerStatus] = useState<NetworkStatus>({
    status: "connecting",
  });

  const networkingEnvBase = useMemo(() => getNetworkingEnvSummary(), []);
  const preferredTransportMode = useMemo(() => getNetworkTransportModeFromEnv(), []);
  const wsRelayUrl = useMemo(() => getWsRelayUrlFromEnv(), []);
  const localIdRef = useRef(Math.random().toString(36).substring(2, 11));

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

  useEffect(() => {
    //  transport 変更時に manager を再生成
    const localId = localIdRef.current;

    let pm: NetworkManager | null = null;

    if (activeTransport === "wsrelay") {
      if (!wsRelayUrl) {
        setPeerManager(null);
        setConnections([]);
        setMyId(localId);
        setPeerStatus({
          status: "error",
          type: "config_error",
          message:
            "VITE_WS_RELAY_URL is not set. Configure relay URL or use PeerJS mode.",
        });
        return;
      }
      pm = new WsRelayManager<Message>(localId, { url: wsRelayUrl });
    } else {
      pm = new PeerManager<Message>(localId, buildPeerOptionsFromEnv());
    }

    // myIdを設定（ID は自前生成なので即表示できる）
    setMyId(localId);

    pm.onPeerStatusChange((status) => {
      setPeerStatus(status);
    });

    pm.onConnectionChange((conns) => {
      setConnections(conns);
    });

    // ホスト用のメッセージハンドラ（2+1 は基本的にホスト中継型）
    pm.onMessage("host", (senderId, msg) => {
      if (!pm.getIsHost()) return;

      if (msg.type === "requestPeerList") {
        // 互換のため残しているが、2+1 は基本はホスト中継で動く。
        const peerIds = pm.getConnectedPeerIds();
        pm.sendTo(senderId, { type: "peerList", peers: peerIds });

        for (const peerId of peerIds) {
          if (peerId !== senderId) {
            pm.sendTo(peerId, {
              type: "peerList",
              peers: [...peerIds, senderId],
            });
          }
        }
        return;
      }

      // phaseSpace / laser は「送信者以外へ」ホストが中継する。
      if (msg.type === "phaseSpace" || msg.type === "laser") {
        pm.broadcast(msg, senderId);
      }
    });

    setPeerManager(pm);

    return () => {
      pm.destroy();
    };
  }, [activeTransport, wsRelayUrl]);

  useEffect(() => {
    if (preferredTransportMode !== "auto") return;
    if (!wsRelayUrl) return;
    if (activeTransport !== "peerjs") return;
    if (peerStatus.status !== "error") return;
    if (
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
        setActiveTransport,
      }}
    >
      {children}
    </PeerContext.Provider>
  );
};
