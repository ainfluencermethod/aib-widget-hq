// AIB Support Widget — Supabase Edge Function (v2: DB-backed brands)
// GET  /support-widget?client=<slug>  -> serves the embeddable widget.js (config injected)
// POST /support-widget                -> chat endpoint { client, session, page, messages[] }
//
// Brand configs live in public.widget_clients. New brand = new row, no redeploy.
// Auth model: public widget. Protection = brand allowlist + Origin allowlist
// + per-IP rate limit. Requires secret: ANTHROPIC_API_KEY.

import { WIDGET_JS } from "./widget-src.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface BrandRow {
  slug: string;
  name: string;
  model: string;
  max_tokens: number;
  allowed_origins: string[];
  widget: Record<string, unknown>;
  system_prompt: string;
}

// ---- brand config cache (per isolate) ----
const brandCache = new Map<string, { row: BrandRow | null; ts: number }>();
const BRAND_TTL_MS = 60 * 1000;

async function getBrand(slug: string): Promise<BrandRow | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) return null;
  const hit = brandCache.get(slug);
  if (hit && Date.now() - hit.ts < BRAND_TTL_MS) return hit.row;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/widget_clients?slug=eq.${slug}&active=is.true&select=slug,name,model,max_tokens,allowed_origins,widget,system_prompt`,
      {
        headers: {
          "apikey": SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        },
      },
    );
    const rows = res.ok ? await res.json() : [];
    const row: BrandRow | null = rows[0] ?? null;
    brandCache.set(slug, { row, ts: Date.now() });
    return row;
  } catch (_e) {
    return hit?.row ?? null;
  }
}

// ---- best-effort per-IP rate limit (per isolate) ----
const hits = new Map<string, number[]>();
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_MAX = 30;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RL_MAX;
}

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return true; // server-to-server / curl tests
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(origin);
}

function errMsg(row: BrandRow): string {
  return (row.widget?.errorMessage as string) ?? "Sorry, I cannot answer right now.";
}

const svcHeaders = {
  "Content-Type": "application/json",
  "apikey": SERVICE_ROLE_KEY,
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
};

// Live takeover: is a human agent handling this session right now?
async function liveAgentFor(slug: string, session: string): Promise<string | null> {
  if (!session) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/widget_handoffs?client_id=eq.${slug}&session_id=eq.${encodeURIComponent(session)}&live=is.true&select=agent_name&limit=1`,
      { headers: svcHeaders },
    );
    const rows = res.ok ? await res.json() : [];
    return rows.length ? (rows[0].agent_name ?? "") : null;
  } catch (_e) {
    return null;
  }
}

async function logOne(clientId: string, session: string, page: string, role: string, content: string) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/widget_chat_logs`, {
      method: "POST",
      headers: { ...svcHeaders, "Prefer": "return=minimal" },
      body: JSON.stringify({ client_id: clientId, session_id: session, page, role, content }),
    });
  } catch (_e) { /* logging must never break the chat */ }
}

async function logChat(
  clientId: string,
  session: string,
  page: string,
  userMsg: string,
  botMsg: string,
) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/widget_chat_logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify([
        { client_id: clientId, session_id: session, page, role: "user", content: userMsg },
        { client_id: clientId, session_id: session, page, role: "assistant", content: botMsg },
      ]),
    });
  } catch (_e) {
    // logging must never break the chat
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ---------- GET ?sync=1: live-chat sync (poll from the widget) ----------
  if (req.method === "GET" && url.searchParams.get("sync") === "1") {
    const slug = url.searchParams.get("client") ?? "";
    const session = (url.searchParams.get("session") ?? "").slice(0, 100);
    const after = parseInt(url.searchParams.get("after") ?? "0", 10) || 0;
    const row = await getBrand(slug);
    if (!row || !session) return json({ error: "bad request" }, 400, origin);
    const agent = await liveAgentFor(slug, session);
    let msgs: unknown[] = [];
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/widget_chat_logs?client_id=eq.${slug}&session_id=eq.${encodeURIComponent(session)}&role=eq.agent&id=gt.${after}&select=id,content&order=id.asc&limit=50`,
        { headers: svcHeaders },
      );
      if (res.ok) msgs = await res.json();
    } catch (_e) { /* empty */ }
    return new Response(JSON.stringify({ live: agent !== null, agent: agent ?? "", messages: msgs }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(origin) },
    });
  }

  // ---------- GET: serve widget.js ----------
  if (req.method === "GET") {
    const slug = url.searchParams.get("client") ?? "";
    const row = await getBrand(slug);
    if (!row) {
      return new Response("// unknown client", {
        status: 404,
        headers: { "Content-Type": "application/javascript", ...corsHeaders(origin) },
      });
    }
    const cfg = {
      clientId: row.slug,
      // url.origin/pathname are proxy-internal here; build the public URL instead.
      endpoint: `${SUPABASE_URL}/functions/v1/support-widget`,
      ...row.widget,
    };
    const js = `window.__AIB_WIDGET_CONFIG__=${JSON.stringify(cfg)};\n${WIDGET_JS}`;
    return new Response(js, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        ...corsHeaders(origin),
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405, origin);
  }

  // ---------- POST: chat or handoff ----------
  let payload: {
    type?: string;
    client?: string;
    session?: string;
    page?: string;
    name?: string;
    contact?: string;
    message?: string;
    messages?: { role: string; content: string }[];
  };
  try {
    payload = await req.json();
  } catch (_e) {
    return json({ error: "invalid json" }, 400, origin);
  }

  const row = await getBrand(payload.client ?? "");
  if (!row) return json({ error: "unknown client" }, 403, origin);
  if (!originAllowed(origin, row.allowed_origins)) {
    return json({ error: "origin not allowed" }, 403, origin);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (rateLimited(ip)) {
    return json({ reply: errMsg(row) }, 429, origin);
  }

  // ---------- human handoff ----------
  if (payload.type === "handoff") {
    const contact = (payload.contact ?? "").trim().slice(0, 200);
    if (!contact) return json({ error: "contact required" }, 400, origin);
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/widget_handoffs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({
          client_id: row.slug,
          session_id: (payload.session ?? "").slice(0, 100),
          page: (payload.page ?? "").slice(0, 500),
          name: (payload.name ?? "").trim().slice(0, 120),
          contact,
          message: (payload.message ?? "").trim().slice(0, 2000),
        }),
      });
    } catch (e) {
      console.error("handoff error", e);
      return json({ reply: errMsg(row) }, 200, origin);
    }
    const thanks = (row.widget?.humanThanks as string) ??
      "Thank you! A real person will contact you as soon as possible.";
    return json({ reply: thanks }, 200, origin);
  }

  const raw = Array.isArray(payload.messages) ? payload.messages : [];
  const messages = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return json({ error: "no user message" }, 400, origin);
  }

  // ---------- live takeover: a human agent answers, the AI stays silent ----------
  const liveAgent = await liveAgentFor(row.slug, payload.session ?? "");
  if (liveAgent !== null) {
    const userMsg = messages[messages.length - 1].content;
    await logOne(row.slug, payload.session ?? "", payload.page ?? "", "user", userMsg);
    return json({ live: true, agent: liveAgent }, 200, origin);
  }

  if (!ANTHROPIC_API_KEY) {
    return json({ reply: errMsg(row), note: "ANTHROPIC_API_KEY not set" }, 200, origin);
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: row.model,
        max_tokens: row.max_tokens,
        system: row.system_prompt,
        messages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("anthropic error", res.status, errText);
      return json({ reply: errMsg(row) }, 200, origin);
    }

    const data = await res.json();
    const reply: string = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim() || errMsg(row);

    const userMsg = messages[messages.length - 1].content;
    // fire-and-forget logging
    logChat(row.slug, payload.session ?? "", payload.page ?? "", userMsg, reply);

    return json({ reply }, 200, origin);
  } catch (e) {
    console.error("chat error", e);
    return json({ reply: errMsg(row) }, 200, origin);
  }
});
