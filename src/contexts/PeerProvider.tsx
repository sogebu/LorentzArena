import { createContext, useState, type ReactNode } from "react";
import { PeerManager } from "../services/PeerManager";
import type { ConnectionStatus, Message } from "../types";
import { useMount } from "react-use";

interface PeerContextValue {
  peerManager: PeerManager<Message> | null;
  connections: ConnectionStatus[];
  myId: string;
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
  const [myId, setMyId] = useState<string>("");

  useMount(() => {
    // マウント時に PeerManager を生成し、イベントハンドラを登録
    const randomId = `user-${Math.random().toString(36).substring(2, 11)}`;
    const pm = new PeerManager<Message>(randomId);

    pm.onConnectionChange((conns) => {
      setConnections(conns);
    });

    setPeerManager(pm);
    setMyId(pm.id());

    return () => {
      // クリーンアップ（必要に応じて）
      pm.destroy();
    };
  });

  return (
    <PeerContext.Provider value={{ peerManager, connections, myId }}>
      {children}
    </PeerContext.Provider>
  );
};
