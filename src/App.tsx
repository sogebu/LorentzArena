import "./App.css";
import { PeerProvider } from "./contexts/PeerProvider";
import Chat from "./components/Chat";
import Connect from "./components/Connect";
import Game from "./components/Game";

const App = () => {
  return (
    <PeerProvider>
      <Connect />
      <Game />
      <Chat />
    </PeerProvider>
  );
};

export default App;
