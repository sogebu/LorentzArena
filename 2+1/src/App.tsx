import { useState } from "react";
import "./App.css";
import Connect from "./components/Connect";
import Lobby from "./components/Lobby";
import RelativisticGame from "./components/RelativisticGame";
import { PeerProvider } from "./contexts/PeerProvider";

// URL ハッシュからルーム名を取得: #room=physics101 → "physics101", なし → "default"
const getRoomName = (): string => {
  const hash = window.location.hash;
  const match = hash.match(/^#room=(.+)$/);
  return match ? match[1] : "default";
};

const STORAGE_KEY_NAME = "la-playerName";

const App = () => {
  const roomName = getRoomName();
  const [gameStarted, setGameStarted] = useState(false);
  const [displayName, setDisplayName] = useState(
    () => {
      try { return localStorage.getItem(STORAGE_KEY_NAME) || ""; }
      catch { return ""; }
    },
  );

  const handleStart = () => {
    const trimmed = displayName.trim();
    if (!trimmed) return;
    try { localStorage.setItem(STORAGE_KEY_NAME, trimmed); }
    catch { /* ignore */ }
    setDisplayName(trimmed);
    setGameStarted(true);
  };

  return (
    <PeerProvider roomName={roomName}>
      {gameStarted ? (
        <>
          <Connect />
          <RelativisticGame displayName={displayName} />
        </>
      ) : (
        <Lobby
          displayName={displayName}
          setDisplayName={setDisplayName}
          onStart={handleStart}
        />
      )}
    </PeerProvider>
  );
};

export default App;
