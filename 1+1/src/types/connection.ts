/**
 * Connection status shown in the UI.
 *
 * English: `open` becomes true when the WebRTC DataChannel is established.
 * 日本語: `open` が true になると WebRTC データチャネルが確立した状態です。
 */
export type ConnectionStatus = {
  id: string;
  open: boolean;
};
