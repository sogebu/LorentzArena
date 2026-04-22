import Connect from "./Connect";
import RelativisticGame from "./RelativisticGame";
import { PeerProvider } from "../contexts/PeerProvider";

type Props = { roomName: string; displayName: string };

/**
 * ゲーム本体 (PeerProvider + Connect + RelativisticGame) を 1 つの lazy chunk に
 * 束ねるためだけの wrapper。App.tsx で `lazy(() => import("./GameSession"))` され、
 * three.js / R3F / peerjs 等の重い dep を Lobby 表示中は読み込まない。
 */
const GameSession = ({ roomName, displayName }: Props) => (
  <PeerProvider roomName={roomName}>
    <Connect />
    <RelativisticGame displayName={displayName} />
  </PeerProvider>
);

export default GameSession;
