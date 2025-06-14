import "./App.css";
import { PeerProvider } from "./contexts/PeerProvider";
import Connect from "./components/Connect";
import RelativisticGame from "./components/RelativisticGame";

const App = () => {
  return (
    <PeerProvider>
      <Connect />
      <RelativisticGame />
    </PeerProvider>
  );
};

export default App;
