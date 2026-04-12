import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildPeerOptionsFromEnv,
  getNetworkingEnvSummary,
  getNetworkTransportModeFromEnv,
  getTurnCredentialUrlFromEnv,
  getWsRelayUrlFromEnv,
} from "../config/peer";
import { fetchTurnCredentials } from "../services/turnCredentials";
import {
  colorForJoinOrder,
  colorForPlayerId,
} from "../components/game/colors";
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
type ConnectionPhase =
  | "trying-host"
  | "connecting-client"
  | "connected"
  | "manual";

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
  isMigrating: boolean;
  getPlayerColor: (peerId: string) => string;
  joinRegistryVersion: number;
  setActiveTransport: (transport: ActiveTransport) => void;
  completeMigration: () => void;
}

export const PeerContext = createContext<PeerContextValue | null>(null);

interface PeerProviderProps {
  children: ReactNode;
  roomName: string;
}

/**
 * Append peer IDs to joinRegistry (append-only, no duplicates).
 * Returns true if the registry changed.
 */
const appendToJoinRegistry = (
  joinRegistryRef: { current: string[] },
  ids: string[],
  hostFirst?: string,
): boolean => {
  let changed = false;
  if (hostFirst && !joinRegistryRef.current.includes(hostFirst)) {
    joinRegistryRef.current.unshift(hostFirst);
    changed = true;
  }
  for (const id of ids) {
    if (!joinRegistryRef.current.includes(id)) {
      joinRegistryRef.current.push(id);
      changed = true;
    }
  }
  return changed;
};

/** Basic validation before relaying messages to all peers. */
const isRelayable = (msg: Message): boolean => {
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string")
    return false;
  if (msg.type === "phaseSpace") {
    return (
      typeof msg.senderId === "string" &&
      msg.position != null &&
      msg.velocity != null
    );
  }
  if (msg.type === "laser") {
    return (
      typeof msg.id === "string" &&
      typeof msg.playerId === "string" &&
      msg.emissionPos != null &&
      msg.direction != null
    );
  }
  if (msg.type === "intro") {
    return (
      typeof msg.senderId === "string" &&
      msg.senderId.length > 0 &&
      typeof msg.displayName === "string" &&
      msg.displayName.length > 0 &&
      msg.displayName.length <= 20
    );
  }
  return false;
};

/**
 * Register a listener that updates the peer order from peerList messages.
 * Used by clients to know who else is in the room (for migration election).
 */
const registerPeerOrderListener = (
  pm: NetworkManager,
  peerOrderRef: { current: string[] },
  joinRegistryRef: { current: string[] },
  onRegistryChange: () => void,
) => {
  pm.onMessage("peerOrder", (_senderId, msg) => {
    if (
      msg &&
      typeof msg === "object" &&
      (msg as { type?: string }).type === "peerList"
    ) {
      const peers = (msg as { peers?: string[] }).peers;
      if (Array.isArray(peers)) {
        peerOrderRef.current = peers;
        if (appendToJoinRegistry(joinRegistryRef, peers, pm.getHostId() ?? undefined)) {
          onRegistryChange();
        }
      }
    }
  });
};

/** Register standard host relay handlers on a PeerManager. */
const registerHostRelay = (pm: NetworkManager) => {
  pm.onMessage("host", (senderId, msg) => {
    if (!pm.getIsHost()) return;

    if (msg.type === "requestPeerList") {
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

    if (
      (msg.type === "phaseSpace" || msg.type === "laser" || msg.type === "intro") &&
      isRelayable(msg)
    ) {
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
  const [connectionPhase, setConnectionPhase] =
    useState<ConnectionPhase>("trying-host");

  const networkingEnvBase = useMemo(() => getNetworkingEnvSummary(), []);
  const preferredTransportMode = useMemo(
    () => getNetworkTransportModeFromEnv(),
    [],
  );
  const wsRelayUrl = useMemo(() => getWsRelayUrlFromEnv(), []);
  const turnCredentialUrl = useMemo(() => getTurnCredentialUrlFromEnv(), []);
  const localIdRef = useRef(Math.random().toString(36).substring(2, 11));

  // Dynamic TURN credentials fetched from Cloudflare Worker.
  const [dynamicIceServers, setDynamicIceServers] = useState<
    RTCIceServer[] | null
  >(null);
  const [credentialsFetched, setCredentialsFetched] = useState(
    !turnCredentialUrl,
  );

  const roomPeerId = `la-${roomName}`;

  const availableTransports = useMemo<ActiveTransport[]>(
    () => (wsRelayUrl ? ["peerjs", "wsrelay"] : ["peerjs"]),
    [wsRelayUrl],
  );

  const [activeTransport, setActiveTransportState] = useState<ActiveTransport>(
    () => {
      if (preferredTransportMode === "wsrelay" && wsRelayUrl) {
        return "wsrelay";
      }
      return "peerjs";
    },
  );
  const [autoFallbackTriggered, setAutoFallbackTriggered] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);

  // Ordered list of peer IDs (excluding host) for migration election.
  // Updated by the host on connection changes and by clients on peerList receipt.
  const peerOrderRef = useRef<string[]>([]);

  // Append-only registry of all peers that ever connected, in join order.
  // Used for deterministic color assignment via golden angle.
  // Never shrinks — disconnected peers keep their index for color stability.
  const joinRegistryRef = useRef<string[]>([]);
  // Version counter: incremented when joinRegistry changes, triggers color recalculation
  const [joinRegistryVersion, setJoinRegistryVersion] = useState(0);

  const completeMigration = useCallback(() => {
    setIsMigrating(false);
  }, []);

  // Deterministic color from join order (golden angle separation).
  // All players (including host) are in joinRegistry. Index determines color.
  // Fallback to hash-based color if peer not yet in registry.
  const getPlayerColor = useCallback(
    (peerId: string): string => {
      const idx = joinRegistryRef.current.indexOf(peerId);
      if (idx >= 0) return colorForJoinOrder(idx);
      return colorForPlayerId(peerId); // fallback
    },
    [],
  );

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

  // Fetch dynamic TURN credentials from Cloudflare Worker (once on mount).
  useEffect(() => {
    if (!turnCredentialUrl) return;
    let cancelled = false;
    fetchTurnCredentials(turnCredentialUrl).then((servers) => {
      if (cancelled) return;
      if (servers.length > 0) setDynamicIceServers(servers);
      setCredentialsFetched(true);
    });
    return () => {
      cancelled = true;
    };
  }, [turnCredentialUrl]);

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
    registerPeerOrderListener(pm, peerOrderRef, joinRegistryRef, () => setJoinRegistryVersion((v) => v + 1));
    setPeerManager(pm);

    return () => {
      pm.destroy();
    };
  }, [activeTransport, wsRelayUrl]);

  // PeerJS: Phase 1 — ルーム ID でホスト試行
  useEffect(() => {
    if (activeTransport !== "peerjs") return;
    if (connectionPhase !== "trying-host") return;
    if (!credentialsFetched) return;

    let owned = true; // このエフェクトが pm の所有権を持っているか

    const pm = new PeerManager<Message>(
      roomPeerId,
      buildPeerOptionsFromEnv(dynamicIceServers),
    );

    pm.onPeerStatusChange((status) => {
      setPeerStatus(status);
      if (status.status === "open") {
        // ルーム ID の登録に成功 → ホストになる
        owned = false; // 所有権を setPeerManager に移譲
        pm.setAsHost();
        setMyId(roomPeerId);
        // ホスト自身を joinRegistry の先頭に登録
        appendToJoinRegistry(joinRegistryRef, [], roomPeerId);
        registerHostRelay(pm);
        registerPeerOrderListener(pm, peerOrderRef, joinRegistryRef, () => setJoinRegistryVersion((v) => v + 1));
        setPeerManager(pm);
        setConnectionPhase("connected");
      } else if (
        status.status === "error" &&
        status.type === "unavailable-id"
      ) {
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
  }, [
    activeTransport,
    connectionPhase,
    roomPeerId,
    credentialsFetched,
    dynamicIceServers,
  ]);

  // PeerJS: Phase 2 — ランダム ID でクライアント接続
  useEffect(() => {
    if (activeTransport !== "peerjs") return;
    if (connectionPhase !== "connecting-client") return;
    if (!credentialsFetched) return;

    let owned = true;

    const localId = localIdRef.current;
    const pm = new PeerManager<Message>(
      localId,
      buildPeerOptionsFromEnv(dynamicIceServers),
    );

    pm.onPeerStatusChange((status) => {
      setPeerStatus(status);
      if (status.status === "open") {
        // シグナリング接続OK → ルーム ID のホストに接続
        owned = false;
        pm.setHostId(roomPeerId);
        pm.connect(roomPeerId);
        setMyId(localId);
        registerHostRelay(pm);
        registerPeerOrderListener(pm, peerOrderRef, joinRegistryRef, () => setJoinRegistryVersion((v) => v + 1));
        setPeerManager(pm);
        setConnectionPhase("connected");
      }
    });

    // Handle redirect from beacon (post-migration host discovery).
    // If the room ID is held by a beacon (not the game host), the first
    // message will be { type: "redirect", hostId: "actual-host-id" }.
    pm.onMessage("redirect_handler", (_senderId, msg) => {
      if (
        msg &&
        typeof msg === "object" &&
        (msg as { type?: string }).type === "redirect" &&
        typeof (msg as { hostId?: string }).hostId === "string"
      ) {
        const realHostId = (msg as { hostId: string }).hostId;
        // eslint-disable-next-line no-console
        console.log("[PeerProvider] Redirect from beacon → real host:", realHostId);
        pm.disconnectPeer(roomPeerId);
        pm.setHostId(realHostId);
        pm.connect(realHostId);
        pm.offMessage("redirect_handler");
      }
    });

    pm.onConnectionChange((conns) => setConnections(conns));

    return () => {
      if (owned) pm.destroy();
      pm.offMessage("redirect_handler");
    };
  }, [
    activeTransport,
    connectionPhase,
    roomPeerId,
    credentialsFetched,
    dynamicIceServers,
  ]);

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

  // Host: proactively broadcast peerList when connections change.
  // Also update peerOrderRef on the host side.
  useEffect(() => {
    if (!peerManager) return;
    if (!peerManager.getIsHost()) return;
    if (connectionPhase !== "connected") return;
    const openPeers = connections.filter((c) => c.open).map((c) => c.id);
    peerOrderRef.current = openPeers;
    // Ensure host and all open peers are in joinRegistry (append-only)
    if (appendToJoinRegistry(joinRegistryRef, openPeers, peerManager.id() ?? undefined)) {
      setJoinRegistryVersion((v) => v + 1);
    }
    if (openPeers.length > 0) {
      peerManager.send({ type: "peerList", peers: openPeers });
    }
  }, [connections, peerManager, connectionPhase]);

  // Host heartbeat: send ping every 3 seconds so clients can detect
  // host disconnection quickly (WebRTC ICE timeout is 30+ seconds).
  const HEARTBEAT_INTERVAL = 3000;
  const HEARTBEAT_TIMEOUT = 8000;
  useEffect(() => {
    if (!peerManager) return;
    if (connectionPhase !== "connected") return;
    if (!peerManager.getIsHost()) return;

    const timer = setInterval(() => {
      // Don't send pings when tab is hidden. Clients will detect heartbeat
      // timeout and trigger host migration automatically.
      if (document.hidden) return;
      peerManager.send({ type: "ping" });
    }, HEARTBEAT_INTERVAL);
    // Send first ping immediately
    peerManager.send({ type: "ping" });

    return () => clearInterval(timer);
  }, [peerManager, connectionPhase]);

  // Client: detect host disconnect via heartbeat timeout.
  // When no ping is received for HEARTBEAT_TIMEOUT ms, trigger migration.
  const lastPingRef = useRef<number>(0);
  const migrationTriggeredRef = useRef(false);
  useEffect(() => {
    if (!peerManager) return;
    if (connectionPhase !== "connected") return;
    if (peerManager.getIsHost()) return;

    // Listen for ping messages to update lastPingRef
    lastPingRef.current = Date.now();
    migrationTriggeredRef.current = false;

    peerManager.onMessage("heartbeat", (_senderId, msg) => {
      if (
        msg &&
        typeof msg === "object" &&
        (msg as { type?: string }).type === "ping"
      ) {
        lastPingRef.current = Date.now();
      }
    });

    const timer = setInterval(() => {
      if (migrationTriggeredRef.current) return;
      const elapsed = Date.now() - lastPingRef.current;
      if (elapsed < HEARTBEAT_TIMEOUT) return;

      // Host heartbeat timeout — trigger migration
      migrationTriggeredRef.current = true;
      clearInterval(timer);

      // Clean up stale connection to old host
      const oldHostId = peerManager.getHostId();
      if (oldHostId && "disconnectPeer" in peerManager) {
        (peerManager as PeerManager<Message>).disconnectPeer(oldHostId);
      }

      const candidates = peerOrderRef.current.filter(
        (id) => id !== oldHostId,
      );

      // eslint-disable-next-line no-console
      console.log(
        "[PeerProvider] Host heartbeat timeout. Candidates:",
        candidates,
        "My ID:",
        peerManager.id(),
      );

      const newHostId = candidates[0]; // first in join order = oldest client

      if (!newHostId) {
        // Solo player — become host for future joiners
        peerManager.clearHost();
        peerManager.setAsHost();
        registerHostRelay(peerManager);
        registerPeerOrderListener(peerManager, peerOrderRef, joinRegistryRef, () => setJoinRegistryVersion((v) => v + 1));
        return;
      }

      if (newHostId === peerManager.id()) {
        // I am the new host
        // eslint-disable-next-line no-console
        console.log(
          "[PeerProvider] I am the new host. Connecting to peers...",
        );
        peerManager.clearHost();
        peerManager.setAsHost();
        registerHostRelay(peerManager);
        registerPeerOrderListener(peerManager, peerOrderRef, joinRegistryRef, () => setJoinRegistryVersion((v) => v + 1));

        if (activeTransport === "peerjs") {
          // Connect to all remaining peers (still registered on PeerServer)
          for (const peerId of candidates) {
            if (peerId !== peerManager.id()) {
              peerManager.connect(peerId);
            }
          }
        } else if (activeTransport === "wsrelay") {
          (peerManager as WsRelayManager<Message>).promoteToHost();
        }

        setIsMigrating(true);
      } else {
        // I am NOT the new host — wait for new host to connect
        // eslint-disable-next-line no-console
        console.log("[PeerProvider] Waiting for new host:", newHostId);
        peerManager.clearHost();
        peerManager.setHostId(newHostId);

        if (activeTransport === "wsrelay") {
          setTimeout(() => {
            (peerManager as WsRelayManager<Message>).connect(newHostId);
          }, 500);
        }
        // PeerJS: new host will connect to us via peer.on("connection")
      }
    }, 1000); // Check every second

    return () => {
      clearInterval(timer);
      peerManager.offMessage("heartbeat");
    };
  }, [peerManager, connectionPhase, activeTransport]);

  // WS Relay: register host_closed handler for migration peer list
  useEffect(() => {
    if (activeTransport !== "wsrelay") return;
    if (!peerManager) return;
    if (!(peerManager instanceof WsRelayManager)) return;

    peerManager.onHostClosed((survivingPeers) => {
      // Update peerOrderRef with the surviving peers from server
      peerOrderRef.current = survivingPeers;
    });
  }, [activeTransport, peerManager]);

  // Beacon: after migration, re-acquire la-{roomName} as a discovery-only peer.
  // New clients connecting to the beacon are redirected to the actual host.
  const beaconRef = useRef<PeerManager<Message> | null>(null);
  useEffect(() => {
    if (activeTransport !== "peerjs") return;
    if (isMigrating) return;
    if (!peerManager) return;
    if (!peerManager.getIsHost()) return;
    if (myId === roomPeerId) return; // Initial host already has room ID
    if (connectionPhase !== "connected") return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;
    const actualHostId = myId;

    const tryBeacon = () => {
      if (cancelled) return;
      const opts = buildPeerOptionsFromEnv(dynamicIceServers);
      const beacon = new PeerManager<Message>(roomPeerId, opts);

      beacon.onPeerStatusChange((status) => {
        if (cancelled) {
          beacon.destroy();
          return;
        }
        if (status.status === "open") {
          // eslint-disable-next-line no-console
          console.log("[PeerProvider] Beacon acquired:", roomPeerId, "→ redirecting to", actualHostId);
          beaconRef.current = beacon;

          // When a new client connects, send redirect
          beacon.onConnectionChange((conns) => {
            for (const conn of conns) {
              if (conn.open) {
                beacon.sendTo(conn.id, {
                  type: "redirect",
                  hostId: actualHostId,
                });
              }
            }
          });
        } else if (status.status === "error" && status.type === "unavailable-id") {
          beacon.destroy();
          if (!cancelled) {
            retryTimer = setTimeout(tryBeacon, 3000);
          }
        }
      });
    };

    tryBeacon();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      if (beaconRef.current) {
        beaconRef.current.destroy();
        beaconRef.current = null;
      }
    };
  }, [activeTransport, isMigrating, peerManager, myId, roomPeerId, connectionPhase, dynamicIceServers]);

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
        isMigrating,
        getPlayerColor,
        joinRegistryVersion,
        setActiveTransport,
        completeMigration,
      }}
    >
      {children}
    </PeerContext.Provider>
  );
};
