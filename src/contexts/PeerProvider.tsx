import { createContext, useState, useEffect, type ReactNode } from "react";
import { PeerManager } from "../services/PeerManager";
import type { ConnectionStatus, Message } from "../types";

interface PeerContextValue {
  peerManager: PeerManager<Message> | null;
  connections: ConnectionStatus[];
  myId: string | null;
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

  useEffect(() => {
    // マウント時に PeerManager を生成し、イベントハンドラを登録
    const randomId = `user-${Math.random().toString(36).substring(2, 11)}`;
    const pm = new PeerManager<Message>(randomId);

    // myIdを設定
    setMyId(randomId);

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
        // ピアリストを受信したら、他のピアに接続
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
    setMyId(pm.id());

    return () => {
      // クリーンアップ（必要に応じて）
      pm.destroy();
    };
  }, []);

  return (
    <PeerContext.Provider value={{ peerManager, connections, myId }}>
      {children}
    </PeerContext.Provider>
  );
};
