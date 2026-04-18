/**
 * Cloudflare Worker: TURN credential proxy + leaderboard for LorentzArena.
 *
 * - POST /           → Generate short-lived Cloudflare TURN credentials
 * - GET /leaderboard → Fetch top scores from KV
 * - POST /leaderboard → Submit a score (only written if it makes top 50)
 */

interface Env {
  TURN_KEY_ID: string;
  TURN_API_TOKEN: string;
  LEADERBOARD: KVNamespace;
}

type LeaderboardEntry = {
  name: string;
  kills: number;
  date: string;
  duration: number;
  sessionId?: string;
};

const MAX_LEADERBOARD_ENTRIES = 50;
const KV_KEY = "top";

const ALLOWED_ORIGINS = ["https://sogebu.github.io"];

const isAllowedOrigin = (origin: string | null): string | null => {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  return null;
};

const corsHeaders = (origin: string): HeadersInit => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
});

const jsonResponse = (
  data: unknown,
  status: number,
  origin: string | null,
): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? corsHeaders(origin) : {}),
    },
  });

// --- TURN credential handler (unchanged) ---

const handleTurnCredentials = async (
  env: Env,
  origin: string | null,
): Promise<Response> => {
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
};

// --- Leaderboard handlers ---

const handleGetLeaderboard = async (
  env: Env,
  origin: string | null,
): Promise<Response> => {
  const entries =
    (await env.LEADERBOARD.get<LeaderboardEntry[]>(KV_KEY, "json")) ?? [];
  return jsonResponse(entries, 200, origin);
};

const isValidEntry = (e: unknown): e is LeaderboardEntry => {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    o.name.length >= 1 &&
    o.name.length <= 20 &&
    typeof o.kills === "number" &&
    Number.isInteger(o.kills) &&
    o.kills > 0 &&
    typeof o.date === "string" &&
    typeof o.duration === "number" &&
    o.duration > 0 &&
    (o.sessionId === undefined ||
      (typeof o.sessionId === "string" &&
        o.sessionId.length >= 1 &&
        o.sessionId.length <= 128))
  );
};

const handlePostLeaderboard = async (
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> => {
  let entry: unknown;
  try {
    entry = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }

  if (!isValidEntry(entry)) {
    return jsonResponse({ error: "Invalid entry" }, 400, origin);
  }

  // Read current leaderboard
  const entries =
    (await env.LEADERBOARD.get<LeaderboardEntry[]>(KV_KEY, "json")) ?? [];

  // Dedup: a repeat submit from the same play session replaces the previous one.
  // Otherwise (e.g. mobile pagehide + visibilitychange both firing) a single game
  // would generate multiple leaderboard rows.
  const filtered = entry.sessionId
    ? entries.filter((e) => e.sessionId !== entry.sessionId)
    : entries;
  const dedupRemoved = filtered.length !== entries.length;

  // Check if score qualifies for top N (measured against the dedup'd list).
  const qualifies =
    filtered.length < MAX_LEADERBOARD_ENTRIES ||
    entry.kills > filtered[filtered.length - 1].kills;

  if (!qualifies) {
    if (dedupRemoved) {
      // The new submit supersedes an old entry that did qualify — persist the
      // removal so the superseded entry doesn't linger on the board.
      await env.LEADERBOARD.put(KV_KEY, JSON.stringify(filtered));
    }
    return jsonResponse({ accepted: false }, 200, origin);
  }

  // Insert, sort, trim
  filtered.push(entry);
  filtered.sort((a, b) => b.kills - a.kills);
  const trimmed = filtered.slice(0, MAX_LEADERBOARD_ENTRIES);
  await env.LEADERBOARD.put(KV_KEY, JSON.stringify(trimmed));

  return jsonResponse({ accepted: true }, 200, origin);
};

// --- Main router ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = isAllowedOrigin(request.headers.get("Origin"));
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: origin ? corsHeaders(origin) : {},
      });
    }

    // Leaderboard routes
    if (path === "/leaderboard") {
      if (request.method === "GET") {
        return handleGetLeaderboard(env, origin);
      }
      if (request.method === "POST") {
        return handlePostLeaderboard(request, env, origin);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // TURN credentials (root POST — backward compatible)
    if (path === "/" && request.method === "POST") {
      return handleTurnCredentials(env, origin);
    }

    return new Response("Not found", { status: 404 });
  },
};
