import "./App.css";
import { PeerProvider } from "./contexts/PeerProvider";
import Chat from "./components/Chat";
import Connect from "./components/Connect";
import RelativisticGame from "./components/RelativisticGame";

const App = () => {
  return (
    <PeerProvider>
      <Connect />
      <RelativisticGame />
      <Chat />
    </PeerProvider>
  );
};

export default App;
