# AIB Widget HQ

Multi-brand AI customer-support widget platform.

- **Dashboard (login gated):** https://ainfluencermethod.github.io/aib-widget-hq/
- **Backend:** Supabase project `vbo-racun` (`fwynqfnrorhuixodnezs`)
- **Repo:** https://github.com/ainfluencermethod/aib-widget-hq
- **First brand:** VBO dental (`vbo-dental`, invisalign.vbo.si)

## What it does

| Piece | Purpose |
|---|---|
| `support-widget` edge function | Serves the embeddable widget.js per brand + answers chat via Claude + stores human-handoff requests |
| `brand-setup` edge function | 1-click onboarding: scrapes the brand site (homepage + up to 8 key pages: prices, FAQ, contact, about, services), Claude writes the full widget config + knowledge base; also powers the "Rescan site" button; stores the raw scrape in `widget_clients.scraped_context` |
| Dashboard (GitHub Pages) | Login gate (Supabase Auth), brand list, 1-click "Create with AI", settings editor, embed snippet, conversation logs, human requests inbox |
| `widget_clients` table | Brand configs; new brand = new row, live in ≤1 min, no redeploy |
| `widget_chat_logs` table | Every chat message per brand/session |
| `widget_handoffs` table | "Talk to a human" requests (name, contact, message, open/done) |

## Daily use

1. Open the dashboard, sign in.
2. **New brand** → enter name + website → *Create with AI*.
3. Copy the embed snippet, give it to the client:

```html
<script src="https://fwynqfnrorhuixodnezs.supabase.co/functions/v1/support-widget?client=BRAND-SLUG" defer></script>
```

4. Check *Conversations* and *Human requests* tabs per brand.
5. When a client site changes (new prices, new offer): open the brand → **↻ Rescan site**. The AI re-scrapes and rebuilds the config. Warning: this overwrites manual edits. Rescan requires the `ANTHROPIC_API_KEY` secret.

Test login (change or delete it): `demo@ainfluencerblueprint.com` / `AIB-widget-2026`.
New team members: "Create one" on the login page (email confirmation required).

## One-time setup still pending

Set the Anthropic API key (needed for AI answers and AI brand generation):

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref fwynqfnrorhuixodnezs
```

Or dashboard: https://supabase.com/dashboard/project/fwynqfnrorhuixodnezs/settings/functions

Until then: the widget answers with each brand's fallback message (with contact info), and brand setup uses a neutral template instead of AI-generated config. Human handoff works either way.

## Widget features

- Brand colors, language, greeting, quick replies — all from the DB config
- "Talk to a human" link → contact form → lands in the dashboard's Human requests
- Shadow DOM (no CSS conflicts), mobile full-screen, session memory
- Protection: per-brand origin allowlist, per-IP rate limit, message caps, graceful fallbacks

## Security model

- Widget endpoints are public by design; brand slug + Origin allowlist + rate limit gate them.
- Dashboard uses the public anon key; **RLS** restricts all data to signed-in users (owner or shared brands).
- `brand-setup` requires a valid Supabase Auth JWT.
- Chat logs and handoffs are writable only via service role (edge functions).

## Development

- Widget UI source: `widget.js`. After editing, regenerate + redeploy `support-widget`:

```bash
cd vbo-support-widget && { printf 'export const WIDGET_JS = `'; sed -e 's/\\/\\\\/g' -e 's/`/\\`/g' -e 's/${/\\${/g' widget.js; printf '`;\n'; } > supabase/functions/support-widget/widget-src.ts
```

- Dashboard source: `dashboard/` → copy to `docs/` and push to deploy (GitHub Pages serves `/docs`).
- `supabase/functions/hq/` is an unused experiment (Supabase cannot serve HTML on the shared domain); ignore it.
- Local demo page: `demo.html` (serve the folder on localhost:8080).

## Notes

- Vercel deploy was blocked: the team role cannot create projects. GitHub Pages is used instead. To move to Vercel or a custom domain later, deploy `docs/` anywhere static; only the dashboard moves, the backend stays.
