import "./App.css";
import Connect from "./components/Connect";
import RelativisticGame from "./components/RelativisticGame";
import { PeerProvider } from "./contexts/PeerProvider";

// URL ハッシュからルーム名を取得: #room=physics101 → "physics101", なし → "default"
const getRoomName = (): string => {
  const hash = window.location.hash;
  const match = hash.match(/^#room=(.+)$/);
  return match ? match[1] : "default";
};

const App = () => {
  const roomName = getRoomName();
  return (
    <PeerProvider roomName={roomName}>
      <Connect />
      <RelativisticGame />
    </PeerProvider>
  );
};

export default App;
