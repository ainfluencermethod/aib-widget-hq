// Zobko answer-quality harness.
// Sends every case in cases.json to the LIVE chat endpoint and applies
// deterministic checks (facts present, no invented facts, style rules).
// Eval sessions are named eval_<run>_<case>; portal analytics exclude them.
//
//   node eval/run.mjs [clientSlug]
//
// Global style checks on every answer:
//   - no informal address (tikanje) markers
//   - brand words: never "zdravljenje"/"stranka"
//   - no markdown headings
// Cleanup of eval log rows happens outside (see README).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENDPOINT = "https://fwynqfnrorhuixodnezs.supabase.co/functions/v1/support-widget";
const CLIENT = process.argv[2] ?? "vbo-dental";

const TIKANJE = [" tvoj", " tebi", " zate", "imaš", "želiš si", "dobiš", "prejmeš", "rezerviraš", "poveš", "vidiš", "lahko si "];
const BRAND_BANNED = ["zdravljenje", "zdravljenja", "zdravljenju", " stranka", " stranke", " stranki"];

const cases = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"));
const run = "eval_" + Math.random().toString(36).slice(2, 8);

function checkCase(c, answer) {
  const fails = [];
  const low = " " + answer.toLowerCase() + " ";

  for (const s of c.mustInclude ?? []) {
    if (!answer.toLowerCase().includes(s.toLowerCase())) fails.push(`missing "${s}"`);
  }
  if (c.mustIncludeAny && !c.mustIncludeAny.some((s) => answer.toLowerCase().includes(s.toLowerCase()))) {
    fails.push(`missing all of [${c.mustIncludeAny.join(", ")}]`);
  }
  for (const s of c.mustExclude ?? []) {
    if (answer.toLowerCase().includes(s.toLowerCase())) fails.push(`contains "${s}"`);
  }
  if (c.maxChars && answer.length > c.maxChars) fails.push(`too long (${answer.length} > ${c.maxChars})`);

  for (const t of TIKANJE) if (low.includes(t)) fails.push(`informal address: "${t.trim()}"`);
  for (const b of BRAND_BANNED) if (low.includes(b)) fails.push(`banned brand word: "${b.trim()}"`);
  if (/\n#{1,3} /.test(answer)) fails.push("markdown heading");

  return fails;
}

let pass = 0;
const results = [];
for (const [i, c] of cases.entries()) {
  const messages = [...(c.history ?? []), { role: "user", content: c.q }];
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: CLIENT, session: `${run}_${c.id}`, page: "eval", messages }),
  });
  const data = await res.json();
  const answer = data.reply ?? "";
  const fails = answer ? checkCase(c, answer) : ["no answer"];
  if (!fails.length) pass++;
  results.push({ id: c.id, ok: !fails.length, fails, answer });
  console.log(`${fails.length ? "✗" : "✓"} ${c.id}${fails.length ? " — " + fails.join("; ") : ""}`);
}

const stamp = new Date().toISOString().slice(0, 10);
writeFileSync(join(HERE, `results-${stamp}.json`), JSON.stringify({ run, pass, total: cases.length, results }, null, 2));
console.log(`\n${pass}/${cases.length} passed. Details: eval/results-${stamp}.json (run ${run})`);
