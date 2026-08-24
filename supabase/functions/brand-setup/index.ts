// AIB Brand Setup — 1-click onboarding with a real site scrape.
// POST { name, website }          -> create a new brand (JWT required; platform verifies it)
// POST { rescan: true, slug }     -> re-scrape + regenerate an existing brand (needs ANTHROPIC_API_KEY)
//
// Scrape: homepage + up to MAX_PAGES prioritized internal pages (prices, FAQ,
// contact, about, services…). The corpus goes to Claude, which writes the full
// widget config + system prompt. The raw corpus is stored in
// widget_clients.scraped_context for audit and future regeneration.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_PAGES = 8;
const PAGE_TEXT_CAP = 12000;
const HOMEPAGE_HTML_CAP = 40000;
const CORPUS_CAP = 120000;

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

// ---------------- scraping ----------------

async function fetchPage(url: string, timeoutMs = 10000): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AIB-WidgetSetup/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(t);
    if (!res.ok) return "";
    const type = res.headers.get("content-type") ?? "";
    if (type && !type.includes("html")) return "";
    return await res.text();
  } catch (_e) {
    return "";
  }
}

function stripNoise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function htmlToText(html: string): string {
  const noStyleBlocks = stripNoise(html)
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return noStyleBlocks
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// High-value pages first: prices, FAQ, contact, about, services (multi-language).
const LINK_KEYWORDS = [
  "cena", "cenik", "price", "pricing", "preis", "tarif",
  "faq", "vprasanja", "vprašanja", "questions", "pogosta",
  "kontakt", "contact", "kje-smo", "lokacij", "location",
  "o-nas", "onas", "about", "uber-uns", "team", "ekipa",
  "storitve", "service", "ponudba", "offer", "paketi", "plans",
  "kako", "how-it-works", "postopek", "delivery", "dostava",
  "garancija", "warranty", "vracil", "return", "pogoji", "terms",
];

function scoreLink(url: string): number {
  const u = url.toLowerCase();
  let score = 0;
  for (const kw of LINK_KEYWORDS) if (u.includes(kw)) score += 10;
  score -= (u.match(/\//g) ?? []).length; // prefer shallow pages
  return score;
}

function extractLinks(html: string, base: string): string[] {
  const origin = new URL(base).origin;
  const found = new Set<string>();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1], base);
      if (u.origin !== origin) continue;
      if (/\.(png|jpe?g|gif|webp|svg|ico|css|js|pdf|zip|mp4|webm|woff2?|ttf|xml|json)(\?|$)/i.test(u.pathname)) continue;
      u.hash = "";
      const clean = u.toString().replace(/\/$/, "");
      if (clean !== origin && clean !== base.replace(/\/$/, "")) found.add(clean);
    } catch (_e) { /* ignore bad urls */ }
  }
  return [...found].sort((a, b) => scoreLink(b) - scoreLink(a)).slice(0, MAX_PAGES);
}

interface ScrapeResult {
  homepageHtml: string;
  corpus: string;
  pagesScanned: string[];
}

async function scrapeSite(website: string): Promise<ScrapeResult> {
  const rawHome = await fetchPage(website, 12000);
  if (!rawHome) return { homepageHtml: "", corpus: "", pagesScanned: [] };

  const homepageHtml = stripNoise(rawHome).slice(0, HOMEPAGE_HTML_CAP);
  const links = extractLinks(rawHome, website);

  const pages = await Promise.all(
    links.map(async (url) => {
      const html = await fetchPage(url, 8000);
      const text = html ? htmlToText(html).slice(0, PAGE_TEXT_CAP) : "";
      return { url, text };
    }),
  );

  const good = pages.filter((p) => p.text.length > 200);
  let corpus =
    `## HOMEPAGE (${website}) — raw HTML, use it for brand colors and structure\n` +
    homepageHtml +
    `\n\n## HOMEPAGE TEXT\n` + htmlToText(rawHome).slice(0, PAGE_TEXT_CAP);
  for (const p of good) {
    corpus += `\n\n## PAGE: ${p.url}\n${p.text}`;
  }
  corpus = corpus.slice(0, CORPUS_CAP);

  return { homepageHtml, corpus, pagesScanned: [website, ...good.map((p) => p.url)] };
}

// ---------------- generation ----------------

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

async function generateConfig(name: string, website: string, corpus: string): Promise<GeneratedConfig> {
  if (!ANTHROPIC_API_KEY || !corpus) return fallbackConfig(name, website);

  const instructions =
    `You configure an embeddable AI customer-support chat widget for the brand "${name}" (${website}).\n` +
    `Below is a scrape of the brand's website: the homepage HTML (use it for brand colors) plus the ` +
    `text of its most important pages (prices, FAQ, contact, about, services). Read everything, then ` +
    `call save_widget_config with the complete configuration. All visitor-facing texts must be in the ` +
    `site's primary language.\n\n` +
    `Rules for system_prompt: give the assistant a name and friendly persona; include a '## Facts' section with ` +
    `EVERY concrete fact found anywhere in the scrape (services, prices, offers, discounts, locations, ` +
    `phone numbers, emails, opening hours, guarantees, delivery/return policies, team members) — be exhaustive, ` +
    `this is the assistant's entire knowledge base; include a '## Goal' section (guide visitors to the site's ` +
    `main call to action); include a '## Rules' section: answer briefly (2-5 sentences), never invent facts or ` +
    `prices, no medical/legal/financial advice, redirect off-topic questions politely, reply in the visitor's ` +
    `language, and escalate to the brand's real contact channels when unsure; when the visitor asks for a human, ` +
    `point to the 'talk to a human' button below the chat. Only use facts that appear in the scrape.\n\n` +
    `WEBSITE SCRAPE:\n${corpus}`;

  const configTool = {
    name: "save_widget_config",
    description: "Save the generated support-widget configuration for this brand.",
    input_schema: {
      type: "object",
      required: ["language", "widget", "system_prompt"],
      properties: {
        language: { type: "string", description: "Primary site language code, e.g. en, sl, de" },
        widget: {
          type: "object",
          required: ["title", "subtitle", "avatar", "accent", "accentDark", "greeting", "placeholder",
            "quickReplies", "errorMessage", "powered", "humanLabel", "humanIntro", "humanNamePh",
            "humanContactPh", "humanMsgPh", "humanSend", "humanThanks"],
          properties: {
            title: { type: "string", description: "Short assistant name in site language, e.g. 'Acme Assistant'" },
            subtitle: { type: "string", description: "Short reassurance line ('we usually reply in seconds')" },
            avatar: { type: "string", description: "One fitting emoji" },
            accent: { type: "string", description: "Main brand color as hex from the HTML/styles; fallback #F97316" },
            accentDark: { type: "string", description: "Slightly darker variant of accent, hex" },
            greeting: { type: "string", description: "Warm 1-2 sentence opening message, may use one emoji" },
            placeholder: { type: "string", description: "Input placeholder like 'Write a message…'" },
            quickReplies: { type: "array", items: { type: "string" }, description: "3-4 questions visitors most likely ask" },
            errorMessage: { type: "string", description: "Apology + the brand's real contact (phone/email if found)" },
            powered: { type: "string", description: "'AI assistant' translated to site language" },
            humanLabel: { type: "string", description: "Link text like '👤 I would rather talk to a human'" },
            humanIntro: { type: "string", description: "One sentence: leave your contact info and the team will reach out" },
            humanNamePh: { type: "string", description: "Placeholder 'Your name'" },
            humanContactPh: { type: "string", description: "Placeholder 'Phone or email (required)'" },
            humanMsgPh: { type: "string", description: "Placeholder 'How can we help?'" },
            humanSend: { type: "string", description: "Button text 'Send request'" },
            humanThanks: { type: "string", description: "Thank-you message incl. the brand's phone if found" },
          },
        },
        system_prompt: { type: "string", description: "Full system prompt for the support AI, in site language" },
      },
    },
  };

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
        max_tokens: 5000,
        tools: [configTool],
        tool_choice: { type: "tool", name: "save_widget_config" },
        messages: [{ role: "user", content: instructions }],
      }),
    });
    if (!res.ok) {
      console.error("anthropic error", res.status, await res.text());
      return fallbackConfig(name, website);
    }
    const data = await res.json();
    const call = (data.content ?? []).find((b: { type: string }) => b.type === "tool_use");
    const parsed = call?.input;
    if (!parsed || !parsed.widget || !parsed.system_prompt) {
      console.error("generateConfig: no tool_use in response", JSON.stringify(data).slice(0, 500));
      return fallbackConfig(name, website);
    }
    return parsed as GeneratedConfig;
  } catch (e) {
    console.error("generateConfig error", e);
    return fallbackConfig(name, website);
  }
}

// ---------------- db helpers ----------------

const dbHeaders = {
  "Content-Type": "application/json",
  "apikey": SERVICE_ROLE_KEY,
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
};

async function getBrandRow(slug: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/widget_clients?slug=eq.${slug}&select=*`,
    { headers: dbHeaders },
  );
  const rows = res.ok ? await res.json() : [];
  return rows[0] ?? null;
}

// ---------------- handler ----------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: { name?: string; website?: string; rescan?: boolean; slug?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return json({ error: "invalid json" }, 400);
  }

  const owner = userIdFromJwt(req.headers.get("Authorization"));
  if (!owner) return json({ error: "unauthorized" }, 401);

  // ---------- rescan an existing brand ----------
  if (body.rescan) {
    const slug = (body.slug ?? "").trim();
    if (!slug) return json({ error: "slug required" }, 400);
    if (!ANTHROPIC_API_KEY) {
      return json({ error: "Rescan needs the ANTHROPIC_API_KEY secret. Set it in Supabase first." }, 400);
    }
    const row = await getBrandRow(slug);
    if (!row) return json({ error: "unknown brand" }, 404);
    if (!row.website) return json({ error: "brand has no website" }, 400);

    const scrape = await scrapeSite(row.website);
    if (!scrape.corpus) return json({ error: "could not read the website" }, 400);
    const gen = await generateConfig(row.name, row.website, scrape.corpus);

    const upd = await fetch(`${SUPABASE_URL}/rest/v1/widget_clients?slug=eq.${slug}`, {
      method: "PATCH",
      headers: { ...dbHeaders, "Prefer": "return=representation" },
      body: JSON.stringify({
        widget: gen.widget,
        system_prompt: gen.system_prompt,
        scraped_context: scrape.corpus.slice(0, 100000),
        updated_at: new Date().toISOString(),
      }),
    });
    if (!upd.ok) {
      console.error("rescan update error", upd.status, await upd.text());
      return json({ error: "could not save brand" }, 500);
    }
    const saved = (await upd.json())[0];
    return json({
      brand: saved,
      snippet: `<script src="${SUPABASE_URL}/functions/v1/support-widget?client=${slug}" defer></script>`,
      ai_generated: true,
      pages_scanned: scrape.pagesScanned,
    });
  }

  // ---------- create a new brand ----------
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

  const scrape = await scrapeSite(website);
  const gen = await generateConfig(name, website, scrape.corpus);

  // Unique slug.
  const base = slugify(name);
  let slug = base;
  for (let i = 2; i < 20; i++) {
    if (!(await getBrandRow(slug))) break;
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
    scraped_context: scrape.corpus.slice(0, 100000),
    active: true,
  };

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/widget_clients`, {
    method: "POST",
    headers: { ...dbHeaders, "Prefer": "return=representation" },
    body: JSON.stringify(row),
  });
  if (!ins.ok) {
    console.error("insert error", ins.status, await ins.text());
    return json({ error: "could not save brand" }, 500);
  }
  const saved = (await ins.json())[0];

  return json({
    brand: saved,
    snippet: `<script src="${SUPABASE_URL}/functions/v1/support-widget?client=${slug}" defer></script>`,
    ai_generated: Boolean(ANTHROPIC_API_KEY && scrape.corpus),
    pages_scanned: scrape.pagesScanned,
  });
});
