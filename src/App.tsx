import "./App.css";
import { PeerProvider } from "./PeerProvider";
import Chat from "./Chat";
import Connect from "./Connect";
import Game from "./Game";

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
