# AIB Support Widget

Embeddable AI customer-support chat widget, multi-client, powered by Claude.
Backend: Supabase Edge Function `support-widget` on project `vbo-racun` (`fwynqfnrorhuixodnezs`).
First client: **VBO dental** (invisalign.vbo.si), client id `vbo-dental`.

## Integrate on a client site

Add one line before `</body>`:

```html
<script src="https://fwynqfnrorhuixodnezs.supabase.co/functions/v1/support-widget?client=vbo-dental" defer></script>
```

That is all. The script injects the launcher bubble and the chat panel (shadow DOM, no CSS conflicts).

## One-time setup (required before AI answers work)

Set the Anthropic API key as a Supabase secret. Until then the widget replies with a polite fallback (phone + email).

Dashboard: https://supabase.com/dashboard/project/fwynqfnrorhuixodnezs/settings/functions → add secret `ANTHROPIC_API_KEY`.

Or CLI:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref fwynqfnrorhuixodnezs
```

No redeploy needed after setting the secret.

## Architecture

| Piece | What it does |
|---|---|
| `GET /support-widget?client=<id>` | Serves `widget.js` with that client's config injected |
| `POST /support-widget` | Chat endpoint; calls Claude with the client's system prompt |
| `widget_chat_logs` table | Every user/assistant message pair, per client + session (RLS on, service-role only) |

Protection: client-id allowlist, per-client Origin allowlist, per-IP rate limit (30 req / 5 min), message length + history caps. Graceful fallback message on any API error.

## Add a new client

1. Edit `supabase/functions/support-widget/clients.ts` — copy the `vbo-dental` block.
2. Fill in: name, model, `allowedOrigins`, widget texts (title, greeting, quick replies, colors), and the `systemPrompt` knowledge base.
3. Redeploy the function (ask Claude, or `supabase functions deploy support-widget`).
4. Give the client the one-line snippet with their `?client=<id>`.

## Edit the widget UI

1. Edit `widget.js`.
2. Regenerate the embedded module:

```bash
cd vbo-support-widget && { printf 'export const WIDGET_JS = `'; sed -e 's/\\/\\\\/g' -e 's/`/\\`/g' -e 's/${/\\${/g' widget.js; printf '`;\n'; } > supabase/functions/support-widget/widget-src.ts
```

3. Redeploy the function.

## Test locally

```bash
cd "/Users/jarvis/Customer Support/vbo-support-widget" && python3 -m http.server 8080
```

Open http://localhost:8080/demo.html (localhost:8080 is in VBO's origin allowlist).

## Read conversations

```sql
select created_at, session_id, role, content
from widget_chat_logs
where client_id = 'vbo-dental'
order by created_at desc
limit 100;
```
