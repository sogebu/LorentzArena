import {
  createContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  buildPeerOptionsFromEnv,
  getNetworkingEnvSummary,
} from "../config/peer";
import { PeerManager, type PeerServerStatus } from "../services/PeerManager";
import type { ConnectionStatus, Message } from "../types";

interface PeerContextValue {
  peerManager: PeerManager<Message> | null;
  connections: ConnectionStatus[];
  myId: string | null;
  peerStatus: PeerServerStatus;
  networkingEnv: ReturnType<typeof getNetworkingEnvSummary>;
}

export const PeerContext = createContext<PeerContextValue | null>(null);

interface PeerProviderProps {
  children: ReactNode;
}

export const PeerProvider = ({ children }: PeerProviderProps) => {
  // PeerManager とそれに連動するステートを保持
  const [peerManager, setPeerManager] = useState<PeerManager<Message> | null>(
    null,
  );
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [peerStatus, setPeerStatus] = useState<PeerServerStatus>({
    status: "connecting",
  });

  const networkingEnv = useMemo(() => getNetworkingEnvSummary(), []);

  useEffect(() => {
    // マウント時に PeerManager を生成し、イベントハンドラを登録
    const randomId = Math.random().toString(36).substring(2, 11);
    const pm = new PeerManager<Message>(randomId, buildPeerOptionsFromEnv());

    // myIdを設定（ID は自前生成なので即表示できる）
    setMyId(randomId);

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
  }, []);

  return (
    <PeerContext.Provider
      value={{ peerManager, connections, myId, peerStatus, networkingEnv }}
    >
      {children}
    </PeerContext.Provider>
  );
};
