/**
 * PeerJS / WebRTC configuration helper.
 *
 * English:
 *   - Reads Vite environment variables (VITE_*) and builds a PeerJS `PeerOptions`.
 *   - This makes it easy to switch PeerServer / TURN settings without code changes.
 *
 * 日本語:
 *   - Vite の環境変数（VITE_*）から PeerJS の `PeerOptions` を組み立てます。
 *   - PeerServer や TURN 設定をコードを触らず切り替えられるようにするためのヘルパーです。
 */

import type { PeerOptions } from "peerjs";

type StringMap = Record<string, string | boolean | undefined>;

const parseBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return undefined;
};

const parseNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
};

const parseJson = <T>(value: string | undefined): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

/**
 * Build PeerJS options from environment variables.
 *
 * Supported env vars:
 * - VITE_PEERJS_HOST
 * - VITE_PEERJS_PORT
 * - VITE_PEERJS_PATH
 * - VITE_PEERJS_SECURE
 * - VITE_PEERJS_DEBUG
 * - VITE_WEBRTC_ICE_SERVERS (JSON string; RTCIceServer[])
 * - VITE_WEBRTC_ICE_TRANSPORT_POLICY ("all" | "relay")
 */
export const buildPeerOptionsFromEnv = (
  env: StringMap = import.meta.env as unknown as StringMap,
): PeerOptions => {
  const options: PeerOptions = {};

  // Debug level: default to 2 on dev for better visibility.
  const defaultDebug = import.meta.env.DEV ? 2 : 0;
  options.debug =
    parseNumber(env.VITE_PEERJS_DEBUG as string | undefined) ?? defaultDebug;

  const host = env.VITE_PEERJS_HOST as string | undefined;
  const port = parseNumber(env.VITE_PEERJS_PORT as string | undefined);
  const path = env.VITE_PEERJS_PATH as string | undefined;
  const secure = parseBoolean(env.VITE_PEERJS_SECURE as string | undefined);

  if (host) options.host = host;
  if (port !== undefined) options.port = port;
  if (path) options.path = path;
  if (secure !== undefined) options.secure = secure;

  // WebRTC (RTCPeerConnection) config.
  // Only set this if we actually have values; otherwise keep PeerJS defaults.
  const iceServers = parseJson<RTCIceServer[]>(
    env.VITE_WEBRTC_ICE_SERVERS as string | undefined,
  );
  const iceTransportPolicy =
    (env.VITE_WEBRTC_ICE_TRANSPORT_POLICY as
      | RTCIceTransportPolicy
      | undefined) ?? undefined;

  const rtcConfig: RTCConfiguration = {};
  if (iceServers) rtcConfig.iceServers = iceServers;
  if (iceTransportPolicy) rtcConfig.iceTransportPolicy = iceTransportPolicy;

  if (Object.keys(rtcConfig).length > 0) {
    options.config = rtcConfig;
  }

  return options;
};

/**
 * A small, human-readable snapshot of relevant networking env variables.
 *
 * English: Useful for showing current networking configuration in the UI.
 * 日本語: UI で現在のネットワーク設定を表示したいとき用。
 */
export const getNetworkingEnvSummary = (
  env: StringMap = import.meta.env as unknown as StringMap,
) => {
  return {
    peerHost: (env.VITE_PEERJS_HOST as string | undefined) ?? "(default)",
    peerPort: (env.VITE_PEERJS_PORT as string | undefined) ?? "(default)",
    peerPath: (env.VITE_PEERJS_PATH as string | undefined) ?? "(default)",
    peerSecure: (env.VITE_PEERJS_SECURE as string | undefined) ?? "(auto)",
    iceServers: (env.VITE_WEBRTC_ICE_SERVERS as string | undefined)
      ? "(custom)"
      : "(default)",
    iceTransportPolicy:
      (env.VITE_WEBRTC_ICE_TRANSPORT_POLICY as string | undefined) ??
      "(default)",
  };
};
