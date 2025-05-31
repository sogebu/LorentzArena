import "./App.css";
import { PeerProvider } from "./PeerProvider";
import Chat from "./Chat";
import Connect from "./Connect";

const App = () => {
  return (
    <PeerProvider>
      <Connect />
      <Chat />
    </PeerProvider>
  );
};

export default App;
