/**
 * Cloudflare Worker: TURN credential proxy for LorentzArena.
 *
 * Generates short-lived Cloudflare TURN credentials without exposing the API token.
 * The browser fetches credentials from this Worker before establishing WebRTC connections.
 */

interface Env {
  TURN_KEY_ID: string;
  TURN_API_TOKEN: string;
}

const ALLOWED_ORIGINS = [
  "https://sogebu.github.io",
];

const isAllowedOrigin = (origin: string | null): string | null => {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // Allow localhost for development
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  return null;
};

const corsHeaders = (origin: string): HeadersInit => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = isAllowedOrigin(request.headers.get("Origin"));

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: origin ? corsHeaders(origin) : {},
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) {
      return new Response("Server misconfigured", { status: 500 });
    }

    const resp = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TURN_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 86400 }),
      },
    );

    if (!resp.ok) {
      return new Response("Failed to generate credentials", {
        status: 502,
        headers: origin ? corsHeaders(origin) : {},
      });
    }

    const body = await resp.text();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...(origin ? corsHeaders(origin) : {}),
      },
    });
  },
};
