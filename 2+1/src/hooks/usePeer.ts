import { useContext } from "react";
import { PeerContext } from "../contexts/PeerProvider";

/**
 * React hook to access the networking context.
 *
 * English: Throws if used outside <PeerProvider>.
 * 日本語: <PeerProvider> の外で呼ぶと例外になります。
 */
export const usePeer = () => {
  const context = useContext(PeerContext);
  if (!context) {
    throw new Error("usePeer must be used within a PeerProvider");
  }
  return context;
};
