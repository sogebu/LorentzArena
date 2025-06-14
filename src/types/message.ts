export type Message =
  | { type: "position"; x: number; y: number }
  | {
      type: "phaseSpace";
      position: { x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
      coordinateTime: number;
    }
  | {
      type: "peerList";
      peers: string[]; // ホストが管理する全ピアのID
    }
  | {
      type: "requestPeerList"; // 新規接続者がホストにピアリストを要求
    };
