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
 * "trying-host": Attempting to claim the beacon ID (la-{roomName}).
 *   - If successful → we are the first peer. Create beacon + game PM with random ID → host.
 *   - If "unavailable-id" → someone else holds the beacon → move to "connecting-client".
 *
 * "connecting-client": Registered with a random ID, connecting to the beacon for redirect.
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
  isHost: boolean;
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

/** Type guard: is this a valid redirect message with a hostId? */
const isRedirectMessage = (
  msg: unknown,
): msg is { type: "redirect"; hostId: string } =>
  msg != null &&
  typeof msg === "object" &&
  (msg as { type?: string }).type === "redirect" &&
  typeof (msg as { hostId?: string }).hostId === "string";

/** Type guard: is this a ping (heartbeat) message? */
const isPingMessage = (msg: unknown): msg is { type: "ping" } =>
  msg != null &&
  typeof msg === "object" &&
  (msg as { type?: string }).type === "ping";

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
        // If host sent its full joinRegistry, seed ours from it (preserves history of departed peers)
        const hostRegistry = (msg as { joinRegistry?: string[] }).joinRegistry;
        if (Array.isArray(hostRegistry) && hostRegistry.length > 0) {
          if (appendToJoinRegistry(joinRegistryRef, hostRegistry, hostRegistry[0])) {
            onRegistryChange();
          }
        } else if (appendToJoinRegistry(joinRegistryRef, peers, pm.getHostId() ?? undefined)) {
          onRegistryChange();
        }
        // Always ensure our own ID is in the registry
        const myId = pm.id();
        if (myId && appendToJoinRegistry(joinRegistryRef, [myId])) {
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

    if (
      (msg.type === "phaseSpace" || msg.type === "laser" || msg.type === "intro") &&
      isRelayable(msg)
    ) {
      pm.broadcast(msg, senderId);
    }
  });
};

// --- Network timing constants ---
const HEARTBEAT_INTERVAL = 3000; // Host sends ping every 3s
const HEARTBEAT_TIMEOUT = 8000; // Client triggers migration after 8s without ping
const BEACON_TIMEOUT = 8000; // Beacon fallback: give up and become solo host
const ELECTED_HOST_TIMEOUT = 10000; // Wait for elected host before beacon fallback
const REDIRECT_TIMEOUT = 10000; // Wait for redirected host before retrying beacon
const MAX_REDIRECT_ATTEMPTS = 3; // Max beacon redirect retries for new clients
const MAX_BEACON_RETRIES = 3; // Beacon acquisition failures before demotion
const HOST_HIDDEN_GRACE = 5000; // Destroy host PeerManager after this long hidden (must be < HEARTBEAT_TIMEOUT)

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

  // Incremented on all host/client role changes (migration, solo host, demotion).
  // Added to deps of effects that check getIsHost() to force re-evaluation.
  const [roleVersion, setRoleVersion] = useState(0);

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

  // Register both standard message handlers on a peer manager.
  // Called at 5 points: host init, client init, WS relay init, migration (new host), migration (solo fallback).
  const registerStandardHandlers = useCallback(
    (pm: NetworkManager) => {
      registerHostRelay(pm);
      registerPeerOrderListener(pm, peerOrderRef, joinRegistryRef, () =>
        setJoinRegistryVersion((v) => v + 1),
      );
    },
    [],
  );

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
    registerStandardHandlers(pm);
    setPeerManager(pm);

    return () => {
      pm.destroy();
    };
  }, [activeTransport, wsRelayUrl, registerStandardHandlers]);

  // Beacon ref: shared between Phase 1 (initial host) and beacon effect (migrated host).
  const beaconRef = useRef<PeerManager<Message> | null>(null);

  // PeerJS: Phase 1 — ビーコンプローブ + ゲーム PM 作成
  // la-{roomName} はビーコン（発見専用）としてのみ使用。
  // ホストもクライアントも全員ランダム ID でゲーム接続する。
  useEffect(() => {
    if (activeTransport !== "peerjs") return;
    if (connectionPhase !== "trying-host") return;
    if (!credentialsFetched) return;

    let ownedBeacon = true;
    let ownedGame = true;
    let gamePm: PeerManager<Message> | null = null;
    const localId = localIdRef.current;

    // Step 1: ビーコン ID (la-{roomName}) の取得を試みる
    const beaconPm = new PeerManager<Message>(
      roomPeerId,
      buildPeerOptionsFromEnv(dynamicIceServers),
    );

    beaconPm.onPeerStatusChange((status) => {
      if (status.status === "open") {
        // ビーコン取得成功 → このルームの最初のピア（ホスト）
        ownedBeacon = false; // beaconRef に移譲
        beaconRef.current = beaconPm;

        // Step 2: ランダム ID でゲーム用 PM を作成
        gamePm = new PeerManager<Message>(
          localId,
          buildPeerOptionsFromEnv(dynamicIceServers),
        );

        const gpm = gamePm; // local binding for closure (gamePm is non-null here)
        gpm.onPeerStatusChange((gameStatus) => {
          setPeerStatus(gameStatus);
          if (gameStatus.status === "open") {
            ownedGame = false; // setPeerManager に移譲
            gpm.setAsHost();
            setMyId(localId);
            appendToJoinRegistry(joinRegistryRef, [], localId);
            registerStandardHandlers(gpm);
            setPeerManager(gpm);
            setConnectionPhase("connected");

            // ビーコンに redirect ハンドラを登録（ゲーム PM の ID が確定してから）
            beaconPm.onConnectionChange((conns) => {
              for (const conn of conns) {
                if (conn.open) {
                  beaconPm.sendTo(conn.id, {
                    type: "redirect",
                    hostId: localId,
                  } as Message);
                }
              }
            });
            // プローブ中に接続してきたクライアントにも redirect を送信
            for (const peerId of beaconPm.getConnectedPeerIds()) {
              beaconPm.sendTo(peerId, {
                type: "redirect",
                hostId: localId,
              } as Message);
            }
          } else if (gameStatus.status === "error") {
            // ゲーム PM 失敗 → ビーコンも解放して他ピアがホストになれるようにする
            if (beaconRef.current) {
              beaconRef.current.destroy();
              beaconRef.current = null;
            }
          }
        });

        gamePm.onConnectionChange((conns) => setConnections(conns));
      } else if (
        status.status === "error" &&
        status.type === "unavailable-id"
      ) {
        // 既にビーコンが存在 → クライアントモードへ
        ownedBeacon = false;
        beaconPm.destroy();
        setConnectionPhase("connecting-client");
      } else if (status.status === "error") {
        // その他のエラー（ネットワーク障害等）→ UI に表示
        setPeerStatus(status);
      }
    });

    return () => {
      if (ownedBeacon) beaconPm.destroy();
      if (ownedGame && gamePm) gamePm.destroy();
    };
  }, [
    activeTransport,
    connectionPhase,
    roomPeerId,
    credentialsFetched,
    dynamicIceServers,
    registerStandardHandlers,
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
        // シグナリング接続OK → ビーコン (la-{roomName}) に接続して redirect を待つ
        owned = false;
        pm.setHostId(roomPeerId);
        pm.connect(roomPeerId);
        setMyId(localId);
        if (appendToJoinRegistry(joinRegistryRef, [localId])) {
          setJoinRegistryVersion((v) => v + 1);
        }
        registerStandardHandlers(pm);
        setPeerManager(pm);
        setConnectionPhase("connected");
      }
    });

    // Handle redirect from beacon.
    // la-{roomName} is always a beacon (discovery-only). The first message
    // will be { type: "redirect", hostId: "actual-host-random-id" }.
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;
    let redirectAttempts = 0;

    const followRedirect = (hostId: string) => {
      pm.disconnectPeer(roomPeerId);
      pm.setHostId(hostId);
      pm.connect(hostId);
      pm.offMessage("redirect_handler");

      redirectTimer = setTimeout(() => {
        const conns = pm.getConnectedPeerIds();
        if (conns.includes(hostId)) return; // connected — ok
        redirectAttempts++;
        if (redirectAttempts >= MAX_REDIRECT_ATTEMPTS) {
          // eslint-disable-next-line no-console
          console.log("[PeerProvider] Max redirect retries reached — giving up");
          return;
        }
        // eslint-disable-next-line no-console
        console.log("[PeerProvider] Redirect target", hostId, "unreachable — retrying beacon (attempt", redirectAttempts, ")");
        pm.disconnectPeer(hostId);
        pm.setHostId(roomPeerId);
        pm.connect(roomPeerId);
        pm.onMessage("redirect_handler", (_s, m) => {
          if (isRedirectMessage(m)) {
            followRedirect(m.hostId);
          }
        });
      }, REDIRECT_TIMEOUT);
    };

    pm.onMessage("redirect_handler", (_senderId, msg) => {
      if (isRedirectMessage(msg)) {
        // eslint-disable-next-line no-console
        console.log("[PeerProvider] Redirect from beacon → real host:", msg.hostId);
        followRedirect(msg.hostId);
      }
    });

    pm.onConnectionChange((conns) => setConnections(conns));

    return () => {
      clearTimeout(redirectTimer);
      if (owned) pm.destroy();
      pm.offMessage("redirect_handler");
    };
  }, [
    activeTransport,
    connectionPhase,
    roomPeerId,
    credentialsFetched,
    dynamicIceServers,
    registerStandardHandlers,
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: roleVersion forces re-eval on role change
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
      peerManager.send({ type: "peerList", peers: openPeers, joinRegistry: joinRegistryRef.current });
    }
  }, [connections, peerManager, connectionPhase, roleVersion]);

  // Host: release PeerJS IDs when tab is hidden for >5s.
  // This allows another peer to claim the beacon at la-{roomName}.
  // On tab return, reconnect via Phase 1 (beacon probe). Since Phase 1 uses
  // random IDs for game PM, the host's identity and color are preserved.
  const tabHiddenTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const wasDestroyedByHideRef = useRef(false);
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (peerManager?.getIsHost()) {
          tabHiddenTimerRef.current = setTimeout(() => {
            tabHiddenTimerRef.current = undefined;
            wasDestroyedByHideRef.current = true;
            if (beaconRef.current) {
              beaconRef.current.destroy();
              beaconRef.current = null;
            }
            peerManager.destroy();
            setPeerManager(null);
          }, HOST_HIDDEN_GRACE);
        }
      } else {
        if (tabHiddenTimerRef.current != null) {
          // Returned within grace period → cancel
          clearTimeout(tabHiddenTimerRef.current);
          tabHiddenTimerRef.current = undefined;
        } else if (wasDestroyedByHideRef.current) {
          // PeerManager was destroyed while hidden → reconnect via Phase 1.
          // Phase 1 probes the beacon ID; game PM uses the same random localId.
          wasDestroyedByHideRef.current = false;
          setConnectionPhase("trying-host");
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearTimeout(tabHiddenTimerRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [peerManager]);

  // Host heartbeat: send ping every 3 seconds so clients can detect
  // host disconnection quickly (WebRTC ICE timeout is 30+ seconds).
  // biome-ignore lint/correctness/useExhaustiveDependencies: roleVersion forces re-eval on role change
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
  }, [peerManager, connectionPhase, roleVersion]);

  // Client: detect host disconnect via heartbeat timeout.
  // When no ping is received for HEARTBEAT_TIMEOUT ms, trigger migration.
  const lastPingRef = useRef<number>(0);
  const migrationTriggeredRef = useRef(false);
  const migrationTimerCleanupRef = useRef<(() => void) | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: roleVersion forces re-eval on role change
  useEffect(() => {
    if (!peerManager) return;
    if (connectionPhase !== "connected") return;
    if (peerManager.getIsHost()) return;

    // Listen for ping messages to update lastPingRef
    lastPingRef.current = Date.now();
    migrationTriggeredRef.current = false;

    peerManager.onMessage("heartbeat", (_senderId, msg) => {
      if (isPingMessage(msg)) lastPingRef.current = Date.now();
    });

    // Handle redirect from host during gameplay (dual-host demotion).
    // When our host demotes, it sends redirect to all clients.
    peerManager.onMessage("game_redirect", (_senderId, msg) => {
      if (isRedirectMessage(msg)) {
        const newHostId = msg.hostId;
        // eslint-disable-next-line no-console
        console.log("[PeerProvider] Host redirected us to:", newHostId);
        migrationTriggeredRef.current = true;

        const oldHostId = peerManager.getHostId();
        if (oldHostId) peerManager.disconnectPeer(oldHostId);

        peerManager.clearHost();
        peerManager.setHostId(newHostId);
        peerManager.connect(newHostId);
        lastPingRef.current = Date.now(); // reset heartbeat for new host
        migrationTriggeredRef.current = false;
      }
    });

    // Assume the host role: clear old state, set as host, register handlers,
    // and notify React via roleVersion so role-dependent effects re-evaluate.
    // This bundles the invariant: setAsHost() must always be paired with setRoleVersion().
    const assumeHostRole = () => {
      peerManager.clearHost();
      peerManager.setAsHost();
      registerStandardHandlers(peerManager);
      setRoleVersion((v) => v + 1);
    };

    const becomeSoloHost = () => {
      // eslint-disable-next-line no-console
      console.log("[PeerProvider] Becoming solo host (no peers reachable)");
      assumeHostRole();
    };

    // Helper: try to discover the real host via beacon redirect.
    // Falls back to becomeSoloHost if beacon is unreachable.
    const attemptBeaconFallback = () => {
      if (activeTransport !== "peerjs") {
        becomeSoloHost();
        return;
      }
      // eslint-disable-next-line no-console
      console.log("[PeerProvider] Attempting beacon fallback via", roomPeerId);
      peerManager.clearHost();
      peerManager.setHostId(roomPeerId);
      peerManager.connect(roomPeerId);

      // Listen for redirect from beacon
      peerManager.onMessage("beacon_fallback", (_senderId, msg) => {
        if (isRedirectMessage(msg)) {
          const realHostId = msg.hostId;
          // eslint-disable-next-line no-console
          console.log("[PeerProvider] Beacon fallback → real host:", realHostId);
          clearTimeout(beaconTimer);
          peerManager.disconnectPeer(roomPeerId);
          peerManager.setHostId(realHostId);
          peerManager.connect(realHostId);
          peerManager.offMessage("beacon_fallback");
        }
      });

      // If beacon doesn't respond in time, become solo host
      const beaconTimer = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.log("[PeerProvider] Beacon fallback timeout — becoming solo host");
        peerManager.offMessage("beacon_fallback");
        peerManager.disconnectPeer(roomPeerId);
        becomeSoloHost();
      }, BEACON_TIMEOUT);

      // Track for cleanup
      const prevCleanup = migrationTimerCleanupRef.current;
      migrationTimerCleanupRef.current = () => {
        prevCleanup?.();
        clearTimeout(beaconTimer);
      };
    };

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
        // No candidates — try beacon before falling back to solo host
        attemptBeaconFallback();
        return;
      }

      if (newHostId === peerManager.id()) {
        // I am the new host
        // eslint-disable-next-line no-console
        console.log(
          "[PeerProvider] I am the new host. Connecting to peers...",
        );
        assumeHostRole();

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

        // Timeout: if elected host never connects, fall back to beacon discovery
        const electedHostTimer = setTimeout(() => {
          // Check if we got a connection from the elected host
          const conns = peerManager.getConnectedPeerIds();
          if (conns.includes(newHostId)) return; // connected — no action
          // eslint-disable-next-line no-console
          console.log("[PeerProvider] Elected host", newHostId, "did not connect — beacon fallback");
          peerManager.disconnectPeer(newHostId);
          attemptBeaconFallback();
        }, ELECTED_HOST_TIMEOUT);

        // Clean up timer if the effect is re-run
        migrationTimerCleanupRef.current = () => clearTimeout(electedHostTimer);
      }
    }, 1000); // Check every second

    return () => {
      clearInterval(timer);
      peerManager.offMessage("heartbeat");
      peerManager.offMessage("game_redirect");
      peerManager.offMessage("beacon_fallback");
      migrationTimerCleanupRef.current?.();
      migrationTimerCleanupRef.current = null;
    };
  }, [peerManager, connectionPhase, activeTransport, roomPeerId, roleVersion]);

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

  // Beacon: acquire/re-acquire la-{roomName} as a discovery-only peer.
  // New clients connecting to the beacon are redirected to the actual host.
  // Skipped if Phase 1 already created the beacon (beaconRef.current != null).
  // biome-ignore lint/correctness/useExhaustiveDependencies: roleVersion forces re-eval on role change
  useEffect(() => {
    if (activeTransport !== "peerjs") return;
    if (!peerManager) return;
    if (!peerManager.getIsHost()) return;
    if (beaconRef.current) return; // Beacon already held (from Phase 1 or previous run)
    if (connectionPhase !== "connected") return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;
    let beaconFailCount = 0;
    let currentDiscoveryPm: PeerManager<Message> | null = null;
    let currentDiscoveryTimeout: ReturnType<typeof setTimeout> | undefined;
    const actualHostId = myId;

    // When beacon acquisition fails repeatedly, another host exists.
    // Demote self: discover real host via beacon, redirect own clients, reconnect.
    const demoteToClient = () => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.log("[PeerProvider] Beacon contention detected — demoting to client");

      // Connect to beacon as client to discover the real host
      const opts = buildPeerOptionsFromEnv(dynamicIceServers);
      const discoveryPm = new PeerManager<Message>(
        Math.random().toString(36).substring(2, 11),
        opts,
      );
      currentDiscoveryPm = discoveryPm;

      currentDiscoveryTimeout = setTimeout(() => {
        // Beacon unreachable (may have crashed) — stay as host
        // eslint-disable-next-line no-console
        console.log("[PeerProvider] Beacon unreachable during demotion — staying as host");
        discoveryPm.destroy();
        currentDiscoveryPm = null;
        // Resume beacon retry
        beaconFailCount = 0;
        if (!cancelled) retryTimer = setTimeout(tryBeacon, 3000);
      }, 8000);

      discoveryPm.onPeerStatusChange((status) => {
        if (cancelled) {
          clearTimeout(currentDiscoveryTimeout);
          discoveryPm.destroy();
          currentDiscoveryPm = null;
          return;
        }
        if (status.status === "open") {
          discoveryPm.connect(roomPeerId);
        }
      });

      discoveryPm.onMessage("demotion_redirect", (_senderId, msg) => {
        if (isRedirectMessage(msg)) {
          clearTimeout(currentDiscoveryTimeout);
          const realHostId = msg.hostId;
          // eslint-disable-next-line no-console
          console.log("[PeerProvider] Demotion: real host is", realHostId, "— redirecting clients");
          discoveryPm.destroy();
          currentDiscoveryPm = null;

          if (cancelled) return;

          // Redirect all our clients to the real host
          peerManager.broadcast({
            type: "redirect",
            hostId: realHostId,
          } as Message);

          // Demote self and reconnect as client
          peerManager.clearHost();
          peerManager.setHostId(realHostId);
          peerManager.connect(realHostId);
          // Trigger effect re-evaluation (heartbeat, beacon, peerList)
          setRoleVersion((v) => v + 1);
        }
      });
    };

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
          beaconFailCount = 0;
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
          beaconFailCount++;
          if (!cancelled) {
            if (beaconFailCount >= MAX_BEACON_RETRIES) {
              // Another host holds the beacon — demote self
              demoteToClient();
            } else {
              retryTimer = setTimeout(tryBeacon, 3000);
            }
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
      clearTimeout(currentDiscoveryTimeout);
      if (currentDiscoveryPm) {
        currentDiscoveryPm.destroy();
        currentDiscoveryPm = null;
      }
    };
  }, [activeTransport, peerManager, myId, roomPeerId, connectionPhase, dynamicIceServers, roleVersion]);

  // Derived from peerManager.getIsHost(), recomputed when roleVersion changes.
  // Exposed in context so consumers can react to role changes without accessing
  // the mutable peerManager method directly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: roleVersion tracks role changes
  const isHost = useMemo(() => peerManager?.getIsHost() ?? false, [peerManager, roleVersion]);

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
        isHost,
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
