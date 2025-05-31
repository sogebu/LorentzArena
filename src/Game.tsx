import { useEffect, useState } from "react";
import { usePeer } from "./PeerProvider";

type Player = {
  id: string;
  x: number;
  y: number;
};

export default function Game() {
  const { peerManager, myId } = usePeer();
  const [players, setPlayers] = useState<Player[]>([]);

  useEffect(() => {
    if (!peerManager) return;

    // 自分の位置を初期化
    setPlayers((prev) => {
      if (prev.some((p) => p.id === myId)) return prev;
      return [...prev, { id: myId, x: 0, y: 0 }];
    });

    // 位置情報の受信処理
    peerManager.onMessage("position", (id, msg) => {
      if (msg.type !== "position") return;
      setPlayers((prev) => {
        const others = prev.filter((p) => p.id !== id);
        return [...others, { id, x: msg.x, y: msg.y }];
      });
    });

    return () => {
      peerManager.offMessage("position");
    };
  }, [peerManager, myId]);

  // キーボード入力による移動処理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!peerManager) return;

      setPlayers((prev) => {
        const me = prev.find((p) => p.id === myId);
        if (!me) return prev;

        let newX = me.x;
        let newY = me.y;

        switch (e.key) {
          case "ArrowUp":
            newY -= 10;
            break;
          case "ArrowDown":
            newY += 10;
            break;
          case "ArrowLeft":
            newX -= 10;
            break;
          case "ArrowRight":
            newX += 10;
            break;
          default:
            return prev;
        }

        // 位置情報を送信
        peerManager.send({ type: "position", x: newX, y: newY });

        return prev.map((p) =>
          p.id === myId ? { ...p, x: newX, y: newY } : p,
        );
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [peerManager, myId]);

  return (
    <div
      style={{
        position: "relative",
        width: "800px",
        height: "600px",
        border: "1px solid black",
      }}
    >
      {players.map((player) => (
        <div
          key={player.id}
          style={{
            position: "absolute",
            left: player.x + 400,
            top: player.y + 300,
            width: "20px",
            height: "20px",
            backgroundColor: player.id === myId ? "blue" : "red",
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
    </div>
  );
}
