export type Message =
  | { type: "position"; x: number; y: number }
  | {
      type: "phaseSpace";
      senderId: string;
      position: { t: number; x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
    }
  | {
      type: "peerList";
      peers: string[]; // ホストが管理する全ピアのID
    }
  | {
      type: "requestPeerList"; // 新規接続者がホストにピアリストを要求
    }
  | {
      type: "laser";
      id: string;
      playerId: string;
      emissionPos: { t: number; x: number; y: number; z: number };
      direction: { x: number; y: number; z: number };
      range: number;
      color: string;
    };
