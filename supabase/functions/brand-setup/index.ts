// AIB Brand Setup — 1-click onboarding for a new brand.
// POST { name, website } (JWT required; platform verifies it)
// 1. Fetches the brand website.
// 2. Claude reads it and writes the full widget config + system prompt.
// 3. Inserts a row into widget_clients, owned by the calling user.
// Returns { brand, snippet }.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "brand";
}

function userIdFromJwt(auth: string | null): string | null {
  // Platform already verified the JWT (verify_jwt = true); we only read the payload.
  try {
    const token = (auth ?? "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
      ),
    );
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch (_e) {
    return null;
  }
}

async function fetchSite(website: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(website, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AIB-WidgetSetup/1.0)" },
    });
    clearTimeout(t);
    if (!res.ok) return "";
    const html = await res.text();
    // Drop scripts, keep markup (inline styles carry brand colors).
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .slice(0, 60000);
  } catch (_e) {
    return "";
  }
}

interface GeneratedConfig {
  language: string;
  widget: Record<string, unknown>;
  system_prompt: string;
}

function fallbackConfig(name: string, website: string): GeneratedConfig {
  return {
    language: "en",
    widget: {
      title: `${name} Assistant`,
      subtitle: "We usually reply in a few seconds",
      avatar: "💬",
      accent: "#F97316",
      accentDark: "#EA580C",
      greeting: `Hi! 👋 I am the ${name} AI assistant. How can I help you today?`,
      placeholder: "Write a message…",
      quickReplies: ["What do you offer?", "Prices", "How can I contact you?"],
      errorMessage: `Sorry, I cannot answer right now. Please contact ${name} directly.`,
      powered: "AI assistant",
      humanLabel: "👤 I would rather talk to a human",
      humanIntro: "Leave your contact info. A real person will get back to you.",
      humanNamePh: "Your name",
      humanContactPh: "Phone or email (required)",
      humanMsgPh: "How can we help?",
      humanSend: "Send request",
      humanThanks: "Thank you! A real person will contact you as soon as possible.",
    },
    system_prompt:
      `You are the friendly AI support assistant for ${name} (${website}). ` +
      `Answer questions about the brand briefly and helpfully. ` +
      `If you do not know an answer, say so and point the visitor to the brand's contact options. ` +
      `When the visitor asks for a human, point to the 'talk to a human' button below the chat. ` +
      `Never invent prices, offers, or facts. Keep answers to 2-5 sentences. ` +
      `Reply in the language of the visitor.`,
  };
}

async function generateConfig(name: string, website: string, html: string): Promise<GeneratedConfig> {
  if (!ANTHROPIC_API_KEY || !html) return fallbackConfig(name, website);

  const instructions =
    `You configure an embeddable AI customer-support chat widget for the brand "${name}" (${website}).\n` +
    `Below is the raw HTML of the brand's website. Read it and produce the widget configuration.\n\n` +
    `Return ONLY a JSON object, no markdown fences, with exactly these keys:\n` +
    `{\n` +
    `  "language": "<primary site language code, e.g. en, sl, de>",\n` +
    `  "widget": {\n` +
    `    "title": "<short assistant name, in site language, e.g. 'Acme Assistant'>",\n` +
    `    "subtitle": "<short reassurance line, site language>",\n` +
    `    "avatar": "<one fitting emoji>",\n` +
    `    "accent": "<main brand color as hex, from the HTML/styles; fallback #F97316>",\n` +
    `    "accentDark": "<slightly darker variant of accent, hex>",\n` +
    `    "greeting": "<warm 1-2 sentence opening message from the assistant, site language, may use one emoji>",\n` +
    `    "placeholder": "<input placeholder like 'Write a message…', site language>",\n` +
    `    "quickReplies": ["<3-4 questions visitors most likely ask, site language>"],\n` +
    `    "errorMessage": "<apology + the brand's real contact (phone/email if found), site language>",\n` +
    `    "powered": "<'AI assistant' translated to site language>",\n` +
    `    "humanLabel": "<link text like '👤 I would rather talk to a human', site language>",\n` +
    `    "humanIntro": "<one sentence: leave your contact info and the team will reach out, site language>",\n` +
    `    "humanNamePh": "<placeholder 'Your name', site language>",\n` +
    `    "humanContactPh": "<placeholder 'Phone or email (required)', site language>",\n` +
    `    "humanMsgPh": "<placeholder 'How can we help?', site language>",\n` +
    `    "humanSend": "<button text 'Send request', site language>",\n` +
    `    "humanThanks": "<thank-you message incl. the brand's phone if found, site language>"\n` +
    `  },\n` +
    `  "system_prompt": "<full system prompt for the support AI, written in the site language>"\n` +
    `}\n\n` +
    `Rules for system_prompt: give the assistant a name and friendly persona; include a '## Facts' section with ` +
    `every concrete fact found on the site (services, prices, offers, locations, contacts, hours, guarantees); ` +
    `include a '## Goal' section (guide visitors to the site's main call to action); include a '## Rules' section: ` +
    `answer briefly (2-5 sentences), never invent facts or prices, no medical/legal/financial advice, ` +
    `redirect off-topic questions politely, reply in the visitor's language, and escalate to the brand's ` +
    `real contact channels when unsure; when the visitor asks for a human, point to the ` +
    `'talk to a human' button below the chat. Only use facts that appear in the HTML.\n\n` +
    `WEBSITE HTML:\n${html}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 3500,
        messages: [{ role: "user", content: instructions }],
      }),
    });
    if (!res.ok) {
      console.error("anthropic error", res.status, await res.text());
      return fallbackConfig(name, website);
    }
    const data = await res.json();
    const text: string = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return fallbackConfig(name, website);
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!parsed.widget || !parsed.system_prompt) return fallbackConfig(name, website);
    return parsed as GeneratedConfig;
  } catch (e) {
    console.error("generateConfig error", e);
    return fallbackConfig(name, website);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: { name?: string; website?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return json({ error: "invalid json" }, 400);
  }

  const name = (body.name ?? "").trim().slice(0, 80);
  let website = (body.website ?? "").trim().slice(0, 300);
  if (!name || !website) return json({ error: "name and website are required" }, 400);
  if (!/^https?:\/\//i.test(website)) website = "https://" + website;
  let siteOrigin = "";
  try {
    siteOrigin = new URL(website).origin;
  } catch (_e) {
    return json({ error: "invalid website url" }, 400);
  }

  const owner = userIdFromJwt(req.headers.get("Authorization"));
  if (!owner) return json({ error: "unauthorized" }, 401);

  const html = await fetchSite(website);
  const gen = await generateConfig(name, website, html);

  // Unique slug.
  const base = slugify(name);
  let slug = base;
  for (let i = 2; i < 20; i++) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/widget_clients?slug=eq.${slug}&select=slug`,
      { headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const rows = res.ok ? await res.json() : [];
    if (rows.length === 0) break;
    slug = `${base}-${i}`;
  }

  const reqOrigin = req.headers.get("Origin");
  const row = {
    slug,
    name,
    owner,
    website,
    model: "claude-sonnet-5",
    max_tokens: 600,
    allowed_origins: [
      ...new Set([
        siteOrigin,
        siteOrigin.replace("://", "://www."),
        ...(reqOrigin ? [reqOrigin] : []), // dashboard origin, so Preview works
        "http://localhost:3000",
        "http://localhost:8080",
      ]),
    ],
    widget: gen.widget,
    system_prompt: gen.system_prompt,
    active: true,
  };

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/widget_clients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Prefer": "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!ins.ok) {
    console.error("insert error", ins.status, await ins.text());
    return json({ error: "could not save brand" }, 500);
  }
  const saved = (await ins.json())[0];

  const snippet =
    `<script src="${SUPABASE_URL}/functions/v1/support-widget?client=${slug}" defer></script>`;

  return json({
    brand: saved,
    snippet,
    ai_generated: Boolean(ANTHROPIC_API_KEY && html),
  });
});
