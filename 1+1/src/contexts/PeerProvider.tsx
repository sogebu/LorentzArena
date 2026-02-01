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

    // ホスト用のメッセージハンドラ
    pm.onMessage("host", (senderId, msg) => {
      if (pm.getIsHost()) {
        if (msg.type === "requestPeerList") {
          // ホストはピアリストを送信
          const peerIds = pm.getConnectedPeerIds();
          pm.sendTo(senderId, { type: "peerList", peers: peerIds });

          // 他のピアに新規接続者を通知
          for (const peerId of peerIds) {
            if (peerId !== senderId) {
              pm.sendTo(peerId, {
                type: "peerList",
                peers: [...peerIds, senderId],
              });
            }
          }
        }
      }
    });

    // クライアント用のメッセージハンドラ
    pm.onMessage("client", (_, msg) => {
      if (!pm.getIsHost() && msg.type === "peerList") {
        // ピアリストを受信したら、他のピアに接続（メッシュ化）
        const hostId = pm.getHostId();
        for (const peerId of msg.peers) {
          if (
            peerId !== pm.id() &&
            peerId !== hostId &&
            !pm.getConnections().some((c) => c.id === peerId)
          ) {
            pm.connect(peerId);
          }
        }
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
