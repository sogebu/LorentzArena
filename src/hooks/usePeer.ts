import { useContext } from "react";
import { PeerContext } from "../contexts/PeerProvider";

export function usePeer() {
  const ctx = useContext(PeerContext);
  if (!ctx) {
    throw new Error("usePeer は PeerProvider の外側では呼び出せません");
  }
  return ctx;
}