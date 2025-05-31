import { createContext, useContext, useState, type ReactNode } from "react";
import { PeerManager, type ConnectionStatus } from "./PeerManager";
import { useMount } from "react-use";

export type Message = { type: "text"; text: string };

// まず Context の型定義
interface PeerContextValue<Message> {
  peerManager: PeerManager<Message> | null;
  connections: ConnectionStatus[];
  myId: string;
}

// Context を生成（ジェネリクスを使う場合は少し工夫が必要ですが、今回は Message を string に固定例を示します）
const PeerContext = createContext<PeerContextValue<{
  type: "text";
  text: string;
}> | null>(null);

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
