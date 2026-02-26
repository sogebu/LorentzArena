/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PEERJS_HOST?: string;
  readonly VITE_PEERJS_PORT?: string;
  readonly VITE_PEERJS_PATH?: string;
  readonly VITE_PEERJS_SECURE?: string;
  readonly VITE_PEERJS_DEBUG?: string;
  readonly VITE_WEBRTC_ICE_SERVERS?: string;
  readonly VITE_WEBRTC_ICE_TRANSPORT_POLICY?: string;
  readonly VITE_NETWORK_TRANSPORT?: "peerjs" | "wsrelay" | "auto";
  readonly VITE_WS_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
