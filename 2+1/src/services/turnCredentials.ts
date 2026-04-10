/**
 * Fetch short-lived TURN credentials from a Cloudflare Worker proxy.
 *
 * The Worker calls the Cloudflare TURN credential API and returns
 * `{ iceServers: RTCIceServer[] }`. On failure, returns an empty array
 * so the app can still try P2P without TURN (works on home networks).
 */

const FETCH_TIMEOUT_MS = 5000;

export const fetchTurnCredentials = async (
  url: string,
): Promise<RTCIceServer[]> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return [];

    const data: { iceServers?: RTCIceServer[] } = await resp.json();
    return data.iceServers ?? [];
  } catch {
    return [];
  }
};
