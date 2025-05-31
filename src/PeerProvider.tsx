import { createContext, useContext, useState, type ReactNode } from "react";
import { PeerManager, type ConnectionStatus } from "./PeerManager";
import { useMount } from "react-use";

export type Message =
  | { type: "text"; text: string }
  | { type: "position"; x: number; y: number };

interface PeerContextValue {
  peerManager: PeerManager<Message> | null;
  connections: ConnectionStatus[];
  myId: string;
}

const PeerContext = createContext<PeerContextValue | null>(null);

// Context を利用するためのカスタムフック
export function usePeer() {
  const ctx = useContext(PeerContext);
  if (!ctx) {
    throw new Error("usePeer は PeerProvider の外側では呼び出せません");
  }
  return ctx;
}

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
