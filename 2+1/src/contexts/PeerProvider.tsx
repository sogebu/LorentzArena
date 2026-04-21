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
import { SNAPSHOT_BROADCAST_INTERVAL_MS } from "../components/game/constants";
import { buildSnapshot } from "../components/game/snapshot";
import { PeerManager, type PeerServerStatus } from "../services/PeerManager";
import { WsRelayManager, type WsRelayStatus } from "../services/WsRelayManager";
import type { ConnectionStatus, Message } from "../types";
import {
  appendToJoinRegistry,
  discoverBeaconHolder,
  isPingMessage,
  isRedirectMessage,
  type NetworkManager,
  performDemotion,
  registerHostRelay,
  registerPeerOrderListener,
  transferLighthouseOwnership,
} from "./peer-helpers";

type ActiveTransport = "peerjs" | "wsrelay";
type NetworkStatus = PeerServerStatus | WsRelayStatus;
// NetworkManager 型は peer-helpers で定義・re-export (component consumer も本 file
// 経由で使えるよう互換維持)。
export type { NetworkManager };

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
  getPlayerColor: (peerId: string) => string;
  joinRegistryVersion: number;
  setActiveTransport: (transport: ActiveTransport) => void;
}

export const PeerContext = createContext<PeerContextValue | null>(null);

interface PeerProviderProps {
  children: ReactNode;
  roomName: string;
}

// --- Network timing constants ---
// Stage G: heartbeat 積極化 (旧 3s/8s → 1s/2.5s)。Authority 解体後は
// false positive のコストがほぼゼロ (state 引き継ぎなし、再選出だけ) のため
// 誤検知寄りに振って切断検知を高速化。
const HEARTBEAT_INTERVAL = 1000; // Host sends ping every 1s
const HEARTBEAT_TIMEOUT = 2500; // Client triggers migration after 2.5s without ping
const BEACON_TIMEOUT = 8000; // Beacon fallback: give up and become solo host
const ELECTED_HOST_TIMEOUT = 10000; // Wait for elected host before beacon fallback
const REDIRECT_TIMEOUT = 10000; // Wait for redirected host before retrying beacon
const MAX_REDIRECT_ATTEMPTS = 3; // Max beacon redirect retries for new clients
const MAX_BEACON_RETRIES = 3; // Beacon acquisition failures before demotion
const HOST_HIDDEN_GRACE = 1500; // Destroy beacon holder's PeerManager after this long hidden (must be < HEARTBEAT_TIMEOUT)
// Stage 2 (2026-04-21): Host self-verification probe timings.
// BACKUP_MS = 30s: 主トリガーは visibilitychange → visible。probe 1 回 ~500ms-2s の
// STUN/ICE 負荷があり、症状 1 は visibility 復帰の ~1s race で発生するため、それ以外
// の経路 (network blip 等) 用の汎用 backup は低頻度で十分。
// TIMEOUT_MS = 8s: beacon 不到達時に「assume OK」で打ち切り。短すぎると transient
// 障害で false-positive demote → 逆 split を誘発。8s は既存 BEACON_TIMEOUT と同値。
const HOST_SELF_VERIFY_BACKUP_MS = 30000;
const HOST_SELF_VERIFY_TIMEOUT_MS = 8000;

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
            gpm.setAsBeaconHolder();
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
        pm.setBeaconHolderId(roomPeerId);
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
      pm.setBeaconHolderId(hostId);
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
        pm.setBeaconHolderId(roomPeerId);
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
    if (!peerManager.getIsBeaconHolder()) return;
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
  const tabHiddenTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const wasDestroyedByHideRef = useRef(false);
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (peerManager?.getIsBeaconHolder()) {
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
        // Stage G: client-side heartbeat grace on tab return.
        // 背景タブでは setInterval が 1Hz にスロットルされ、HEARTBEAT_TIMEOUT
        // (2.5s) を簡単に超えるため lastPingRef を reset して false positive
        // migration を避ける。次の ping が本当に来るか確かめてから判定。
        lastPingRef.current = Date.now();
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
    if (!peerManager.getIsBeaconHolder()) return;

    // Include peerOrder on ping so clients keep their election view fresh
    // (≤1s stale) without waiting for the rarer connections-change broadcast.
    const sendPing = () => {
      peerManager.send({ type: "ping", peerOrder: peerOrderRef.current });
    };
    const timer = setInterval(() => {
      // Don't send pings when tab is hidden. Clients will detect heartbeat
      // timeout and trigger host migration automatically.
      if (document.hidden) return;
      sendPing();
    }, HEARTBEAT_INTERVAL);
    // Send first ping immediately
    sendPing();

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
    if (peerManager.getIsBeaconHolder()) return;

    // Listen for ping messages to update lastPingRef
    lastPingRef.current = Date.now();
    migrationTriggeredRef.current = false;

    peerManager.onMessage("heartbeat", (_senderId, msg) => {
      if (!isPingMessage(msg)) return;
      lastPingRef.current = Date.now();
      // Adopt host's latest peerOrder so all clients run the next migration
      // election on an identical list. Matches the existing peerList handler:
      // peers array = host's non-self connected peers (self IS included here
      // from the host's view), so candidates[0] === peerManager.id() still
      // elects the oldest client correctly.
      if (Array.isArray(msg.peerOrder)) {
        peerOrderRef.current = [...msg.peerOrder];
      }
    });

    // Handle redirect from host during gameplay (dual-host demotion).
    // When our host demotes, it sends redirect to all clients.
    peerManager.onMessage("game_redirect", (_senderId, msg) => {
      if (isRedirectMessage(msg)) {
        const newHostId = msg.hostId;
        // eslint-disable-next-line no-console
        console.log("[PeerProvider] Host redirected us to:", newHostId);
        migrationTriggeredRef.current = true;

        const oldHostId = peerManager.getBeaconHolderId();
        if (oldHostId) peerManager.disconnectPeer(oldHostId);

        peerManager.clearBeaconHolder();
        peerManager.setBeaconHolderId(newHostId);
        peerManager.connect(newHostId);
        lastPingRef.current = Date.now(); // reset heartbeat for new host
        migrationTriggeredRef.current = false;
      }
    });

    // Assume the host role: clear old state, set as host, register handlers,
    // rewrite Lighthouse ownership to self, normalize peerOrderRef (drop self),
    // and notify React via roleVersion so role-dependent effects re-evaluate.
    // This is the SINGLE source of truth for LH ownership takeover — the
    // RelativisticGame init effect intentionally does not duplicate it. The
    // synchronous setPlayers here closes the LH-silent window: the next RAF
    // tick of useGameLoop sees lh.ownerId === myId immediately.
    const assumeHostRole = () => {
      peerManager.clearBeaconHolder();
      peerManager.setAsBeaconHolder();
      registerStandardHandlers(peerManager);
      const newHostId = peerManager.id();
      if (newHostId) {
        // Host's peerOrder is canonically the non-self peers, but we may have
        // inherited a list including self from the previous host's last ping.
        // Filter eagerly so the first ping we send out has correct shape (the
        // connections useEffect will replace it on next React tick anyway).
        peerOrderRef.current = peerOrderRef.current.filter(
          (id) => id !== newHostId,
        );
        transferLighthouseOwnership(newHostId);
      }
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
      peerManager.clearBeaconHolder();
      peerManager.setBeaconHolderId(roomPeerId);
      peerManager.connect(roomPeerId);

      // Listen for redirect from beacon
      peerManager.onMessage("beacon_fallback", (_senderId, msg) => {
        if (isRedirectMessage(msg)) {
          const realHostId = msg.hostId;
          // eslint-disable-next-line no-console
          console.log("[PeerProvider] Beacon fallback → real host:", realHostId);
          clearTimeout(beaconTimer);
          peerManager.disconnectPeer(roomPeerId);
          peerManager.setBeaconHolderId(realHostId);
          peerManager.connect(realHostId);
          peerManager.offMessage("beacon_fallback");
          // Re-run heartbeat effect so the timer and migrationTriggeredRef
          // reset for the new host. Without this the watchdog stays dead and
          // a stale redirect leaves us stuck as client with a ghost peer.
          setRoleVersion((v) => v + 1);
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
      const oldHostId = peerManager.getBeaconHolderId();
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
        // If we have no open peer connections besides the dead host/beacon,
        // we're alone — no elected peer to wait for and beacon fallback would
        // only chase stale redirects. Go solo directly. Otherwise the beacon
        // is still our best shot at discovering a real host outside
        // peerOrderRef.
        const openConns = peerManager
          .getConnectedPeerIds()
          .filter((id) => id !== oldHostId && id !== roomPeerId);
        if (openConns.length === 0) {
          // eslint-disable-next-line no-console
          console.log(
            "[PeerProvider] No candidates and no other peers — becoming solo host",
          );
          becomeSoloHost();
          return;
        }
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
          (peerManager as WsRelayManager<Message>).promoteToBeaconHolder();
        }
      } else {
        // I am NOT the new host — wait for new host to connect
        // eslint-disable-next-line no-console
        console.log("[PeerProvider] Waiting for new host:", newHostId);
        peerManager.clearBeaconHolder();
        peerManager.setBeaconHolderId(newHostId);

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

  // Stage 1.5 (2026-04-21): Peer-contributive periodic snapshot (pseudo-mesh semantics).
  //
  // 思想: 頻度で通信形態の semantics を分ける。
  //   - phaseSpace / kill / respawn (高頻度 ~125Hz / sparse events): owner-authoritative で
  //     star 経由 (BH relay)。order/latency sensitive。
  //   - snapshot (低頻度 0.2Hz): 全 peer が貢献する reconciliation channel。各 peer が
  //     自分の局所観測から snapshot を送信、BH が union-merge して enriched snapshot を
  //     全 peer に再配信 (*) → missed event が「別 peer の観測にはあった」場合に自動救済。
  //
  // (*) client A のときは send() の宛先 = conns = {BH} のみ。BH は受信を applySnapshot で
  //     merge (既存 isMigrationPath 分岐)。次の BH の 5s tick で merge 済 state から build
  //     した snapshot を全 client に送信。client は BH の enriched snapshot を merge。
  //     伝播最大 10s (A が BH の fire 直後に送ったケース)、平均 5s。
  //
  // Stage 1 (BH 独り舞台) からの変更: `getIsBeaconHolder()` guard を撤去。全 peer が送信。
  //
  // 対称性: A の局所観測 (例: A が目撃した kill) が BH に missed されていても A → BH で
  // 流入、BH の merged snapshot 経由で C にも到達。BH 単独視点依存が解消。
  // 効率性: BH 帯域は O(N) 維持 (受信 +N-1/5s、送信は従来通り N-1/5s)。mesh 化の O(N²)
  // にはならない。client 側帯域: 送信 +1/5s (無視できる)。
  // 堅牢性: BH が kill/respawn を取り逃した state を各 peer の snapshot から自動復元。
  // 真の BH downtime resilience (BH 停止中の reconciliation 継続) は full mesh が必要で
  // defer。現スケール (2-4 peer) では BH tab-hidden 時の HOST_HIDDEN_GRACE + migration で
  // 実用充分。
  //
  // Trigger set: 従来 (a) dropped respawn → ghost stuck (B'), (b) dropped intro, (c) missed
  // kill → score drift, (d) migration race に加え、(e) BH 視点で観測されていない event の
  // 他 peer からの回復 を獲得。
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: roleVersion forces re-eval on role change
  useEffect(() => {
    if (!peerManager) return;
    if (!myId) return;
    if (connectionPhase !== "connected") return;
    // Stage 1.5: BH-only guard を撤去。client も含め全 peer が snapshot を送信する。
    // BH: conns = 全 client → enriched snapshot を全員に配信
    // client: conns = {BH} → 自分の局所観測を BH に寄せて merge してもらう

    const timer = setInterval(() => {
      // 他 peer 0 人なら送信する意味無し (自分に送信されない実装だが無駄な buildSnapshot
      // 呼び出しを避ける)。la-{roomName} beacon peer のみの場合 (実質 solo) も skip。
      const connected = peerManager.getConnectedPeerIds();
      const realPeers = connected.filter((id) => id !== roomPeerId);
      if (realPeers.length === 0) return;
      // isBeaconHolder を明示的に渡す: BH だけが LH ownerId を自分に rewrite する権利を持つ。
      // client が BH の権限を主張するフェイクを送ると BH 側 merge で LH 所有権が汚染される
      // (BH の LH AI が沈黙する catastrophic bug)。tick ごとに imperative flag を見る。
      const isBH = peerManager.getIsBeaconHolder();
      peerManager.send(buildSnapshot(myId, isBH));
    }, SNAPSHOT_BROADCAST_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [peerManager, myId, connectionPhase, roomPeerId, roleVersion]);

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
    if (!peerManager.getIsBeaconHolder()) return;
    if (!myId) return;
    if (beaconRef.current) return; // Beacon already held (from Phase 1 or previous run)
    if (connectionPhase !== "connected") return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;
    let beaconFailCount = 0;
    let cancelDiscovery: (() => void) | null = null;
    const actualHostId = myId;

    // When beacon acquisition fails repeatedly, another host exists.
    // Demote self: discover real host via beacon, redirect own clients, reconnect.
    const demoteToClient = () => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.log(
        "[PeerProvider] Beacon contention detected — demoting to client",
      );
      cancelDiscovery = discoverBeaconHolder({
        roomPeerId,
        options: buildPeerOptionsFromEnv(dynamicIceServers),
        timeoutMs: 8000,
        onResult: (realHostId) => {
          cancelDiscovery = null;
          if (cancelled) return;
          // eslint-disable-next-line no-console
          console.log(
            "[PeerProvider] Demotion: real host is",
            realHostId,
            "— redirecting clients",
          );
          performDemotion(peerManager, realHostId, () =>
            setRoleVersion((v) => v + 1),
          );
        },
        onInconclusive: () => {
          cancelDiscovery = null;
          if (cancelled) return;
          // Beacon unreachable (may have crashed) — stay as host
          // eslint-disable-next-line no-console
          console.log(
            "[PeerProvider] Beacon unreachable during demotion — staying as host",
          );
          beaconFailCount = 0;
          retryTimer = setTimeout(tryBeacon, 3000);
        },
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
              // If no peers are connected, the beacon is likely stale from a
              // dead previous host rather than contended with a live one.
              // Demoting to client would only connect us to a ghost. Stay
              // solo and keep retrying with a longer backoff until the
              // beacon is released or a real peer appears.
              const openPeers = peerManager.getConnectedPeerIds();
              if (openPeers.length === 0) {
                // eslint-disable-next-line no-console
                console.log(
                  "[PeerProvider] Beacon unavailable but no peers connected — staying as solo host, long backoff retry",
                );
                beaconFailCount = 0;
                retryTimer = setTimeout(tryBeacon, 10000);
              } else {
                // A live host actually holds the beacon — demote self
                demoteToClient();
              }
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
      cancelDiscovery?.();
      cancelDiscovery = null;
    };
  }, [activeTransport, peerManager, myId, roomPeerId, connectionPhase, dynamicIceServers, roleVersion]);

  // Stage 2 (2026-04-21): Host self-verification probe (症状 1 = host split 対策).
  //
  // 真因: beacon 獲得は set-and-forget。tab-hidden 復帰の ~1s 窓で PeerServer が旧
  // BH を release → 新 BH が `la-{roomName}` claim → 旧 BH が tab 復帰で Phase 1 から
  // 再取得成功 (PeerServer race で 2 者が claim) → 両者が自分を BH と認識 → split。
  // 既存 `demoteToClient` は beacon claim 失敗時にしか発火せず、claim 成功後の split は
  // 検出されない (passive)。Stage 2 は能動的に「現時点で誰が真の BH か」を別経路で verify。
  //
  // 動作: `discoverBeaconHolder` helper で la-{roomName} に probe 接続、beacon から
  // の redirect を受信。
  //   - redirect.hostId === myId → legit BH (自分自身の beacon が応答)
  //   - redirect.hostId !== myId → split 確定 → performDemotion で末端処理
  //   - timeout (8s) → verification 不可、assume OK で打ち切り (transient 障害で false-
  //     positive demote すると逆 split 誘発するため conservative)
  //
  // Trigger 設計:
  //   - 主 (visibility → visible): 症状 1 の race が起きる唯一のタイミング = tab-hidden
  //     復帰。visibility をトリガーにすれば split 発生から数秒で検出。
  //   - 副 (30s interval): network blip 等 visibility に乗らない経路の安全網。
  //   - 初期 (effect mount): tab 復帰→Phase 1 再起動→effect mount の順序で visibility
  //     event を取り逃すため、mount 直後に 1 回走らせる。
  //
  // Edge cases (plan §Stage 2 設計 `Edge case`):
  //   (1) probe が自分自身の beacon に接続: redirect.hostId === myId で OK 判定
  //   (2) probe 中に role 変化: cancelled flag + cancelProbe で in-flight probe 中断
  //   (3) probe 中に tab hidden: HOST_HIDDEN_GRACE で peerManager destroy → cleanup
  //   (4) WS Relay mode: beacon pattern 不使用、effect 全体 skip
  //   (5) solo host: probe は走るが self-redirect で OK 判定 (1 client 追加時 split
  //       耐性を持つため対称的)
  //   (6) PeerServer 不到達: timeout → assume OK で続行 (false-positive 回避)
  //   (7) 同時 2 probe: `if (cancelProbe) return;` で dedup (in-flight フラグ兼用)
  //   (8) probe PM の late callback による他 probe 誤爆: `discoverBeaconHolder` 内部の
  //       `done` flag で one-shot 保証
  //
  // test 戦略: WebRTC 接続絡みで unit test 困難 → odakin 実機検証。
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: roleVersion forces re-eval on role change
  useEffect(() => {
    if (activeTransport !== "peerjs") return;
    if (!peerManager) return;
    if (!myId) return;
    if (connectionPhase !== "connected") return;
    if (!peerManager.getIsBeaconHolder()) return;

    let cancelled = false;
    let cancelProbe: (() => void) | null = null;

    const runProbe = () => {
      if (cancelled) return;
      if (document.hidden) return; // hidden 中 probe は無駄
      if (cancelProbe) return; // 並行 probe 防止
      if (!peerManager.getIsBeaconHolder()) return; // role 変化時 skip

      cancelProbe = discoverBeaconHolder({
        roomPeerId,
        options: buildPeerOptionsFromEnv(dynamicIceServers),
        timeoutMs: HOST_SELF_VERIFY_TIMEOUT_MS,
        probeIdPrefix: "probe-",
        onResult: (realHostId) => {
          cancelProbe = null;
          if (cancelled) return;
          if (!peerManager.getIsBeaconHolder()) return; // mid-probe で role 変化
          if (realHostId === myId) return; // legit BH — verified

          // eslint-disable-next-line no-console
          console.log(
            "[PeerProvider] Host split detected — real BH:",
            realHostId,
            "— demoting self",
          );
          performDemotion(peerManager, realHostId, () =>
            setRoleVersion((v) => v + 1),
          );
        },
        onInconclusive: () => {
          cancelProbe = null;
          // eslint-disable-next-line no-console
          console.log("[PeerProvider] Self-verify probe inconclusive — assume OK");
        },
      });
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) runProbe();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const backupTimer = setInterval(runProbe, HOST_SELF_VERIFY_BACKUP_MS);

    // Initial probe on effect mount (主 bug fix): tab-hidden 復帰の本命シナリオで、
    // HOST_HIDDEN_GRACE が peerManager destroy → Stage 2 effect cleanup (listener 撤去)
    // → visibilitychange(visible) が listener 不在時に発火 → Phase 1 が新 peerManager を
    // setState → ここで effect mount、という順序のため **復帰時の visibility event を
    // 取り逃している**。mount 時点で一回 probe を走らせれば、Phase 1 が race に勝って
    // split を作り出した状況を即検出できる。既存 visibility trigger は 2 回目以降の
    // hide/show で活きる。backup timer は network blip 等 visibility に乗らない経路用。
    runProbe();

    return () => {
      cancelled = true;
      clearInterval(backupTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      cancelProbe?.();
      cancelProbe = null;
    };
  }, [
    activeTransport,
    peerManager,
    myId,
    roomPeerId,
    connectionPhase,
    dynamicIceServers,
    roleVersion,
  ]);

  // Derived from peerManager.getIsBeaconHolder(), recomputed when roleVersion changes.
  // Exposed in context so consumers can react to role changes without accessing
  // the mutable peerManager method directly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: roleVersion tracks role changes
  const isHost = useMemo(() => peerManager?.getIsBeaconHolder() ?? false, [peerManager, roleVersion]);

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
        getPlayerColor,
        joinRegistryVersion,
        setActiveTransport,
      }}
    >
      {children}
    </PeerContext.Provider>
  );
};
