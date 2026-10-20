/** Verifies data/catalog.json merges into the built-in catalog correctly. */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const html = await readFile(join(ROOT, "index.html"), "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const body = blocks[1].split("/* ---------- state ---------- */")[0]
  .replace(/\(function\(\)\{/, "").replace(/"use strict";/, "");
const src = blocks[0] + "\n" + body +
  "\nexport {FILMS, BY_TITLE, applyEnrichment, ENRICHED, scanDay};";
const mod = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
const { FILMS, BY_TITLE, applyEnrichment, scanDay } = mod;

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) { pass++; console.log(`  ok   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}\n       got  ${a}\n       want ${b}`); }
};

const before = {
  parasiteRuntime: BY_TITLE["Parasite"].r,
  parasiteSvcs:    BY_TITLE["Parasite"].svcs.slice(),
  parasiteRt:      BY_TITLE["Parasite"].rt,
  heatMpaa:        BY_TITLE["Heat"].mpaa
};
console.log("\nbefore enrichment");
eq("built-in svcs is a single-element array", before.parasiteSvcs, ["MAX"]);
eq("no poster by default", BY_TITLE["Parasite"].poster, null);
eq("no provenance flag by default", BY_TITLE["Parasite"].rtSrc, undefined);

const payload = { _meta: {
    generatedAt: new Date().toISOString(), region: "US", source: "TMDB + OMDb",
    total: 4, matched: 4 },
  films: [
    { t:"Parasite", y:2019, runtime:133, cert:"R",  rt:99, tmdbScore:85,
      poster:"/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg", providers:["MAX","NFX"] },
    { t:"Heat",     y:1995, runtime:170, cert:"R",  tmdbScore:79, providers:["PRV"] },
    { t:"Parasite", y:1999, runtime:99,  cert:"G",  rt:1,  providers:["DIS"] },   // wrong year
    { t:"Not In Catalog", y:2020, runtime:100, cert:"R", rt:50, providers:["NFX"] }
  ]};
const applied = applyEnrichment(payload);

console.log("\nafter enrichment");
eq("returns true when rows applied", applied, true);
eq("runtime replaced from source", BY_TITLE["Parasite"].r, 133);
eq("certification applied", BY_TITLE["Parasite"].mpaa, "R");
eq("real RT wins over tmdbScore", BY_TITLE["Parasite"].rt, 99);
eq("provenance marked as rt", BY_TITLE["Parasite"].rtSrc, "rt");
eq("multi-service availability", BY_TITLE["Parasite"].svcs.sort(), ["MAX","NFX"]);
eq("poster path stored", BY_TITLE["Parasite"].poster, "/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg");
eq("falls back to tmdbScore when no RT", BY_TITLE["Heat"].rt, 79);
eq("provenance marked as tmdb", BY_TITLE["Heat"].rtSrc, "tmdb");
eq("Heat runtime updated", BY_TITLE["Heat"].r, 170);

console.log("\nsafety: bad rows must not corrupt the catalog");
eq("year mismatch rejected — runtime untouched", BY_TITLE["Parasite"].r, 133);
eq("year mismatch rejected — cert untouched",    BY_TITLE["Parasite"].mpaa, "R");
eq("unknown title ignored", BY_TITLE["Not In Catalog"], undefined);
eq("untouched film keeps built-in data", BY_TITLE["Goodfellas"].svcs, ["MAX"]);

console.log("\nmalformed payloads must be inert");
eq("null payload", applyEnrichment(null), false);
eq("missing films array", applyEnrichment({ _meta: {} }), false);
eq("films not an array", applyEnrichment({ films: "nope" }), false);
const rt = BY_TITLE["Sinners"].rt;
applyEnrichment({ films: [{ t:"Sinners", y:2025, rt:"high", cert:"XX", runtime:-5, providers:[] }] });
eq("non-numeric rt ignored", BY_TITLE["Sinners"].rt, rt);
eq("invalid certification ignored", BY_TITLE["Sinners"].mpaa, "R");
eq("negative runtime ignored", BY_TITLE["Sinners"].r > 0, true);
eq("empty providers keeps built-in", BY_TITLE["Sinners"].svcs, ["MAX"]);


console.log("\nthe footer's scan date");
{
  const words = (m) => scanDay(m);
  const local = new Date(2026, 8, 24).toLocaleDateString([], {weekday:"long", month:"long", day:"numeric"});
  eq("the scan's plain date is read as a local day, so the time zone cannot shift it", words({ scannedAt: "2026-09-24" }), local);
  eq("and is spelled out for the footer", /September 24/.test(words({ scannedAt: "2026-09-24" })), true);
  eq("the generation time stands in when the date is missing",
     words({ generatedAt: "2026-09-24T15:52:07.200Z" }), new Date("2026-09-24T15:52:07.200Z").toLocaleDateString([], {weekday:"long", month:"long", day:"numeric"}));
  eq("a malformed date says nothing rather than 'Invalid Date'", words({ scannedAt: "yesterday" }), "");
  eq("as does no date at all", words({}), "");
}

console.log("\nno test may name a film that streaming rights can take away");
/* The nightly refresh runs these tests against the catalog it just scanned and
   commits only if they pass, so an assertion naming a *shelved* title fails on
   the night that title leaves every service — and throws the whole scan away.
   It happened: taste.test.mjs named The Thing (2011), the film left, and five
   nights of data were discarded. Curated titles live in index.html and cannot
   move, so they are safe to name; shelved ones are built with shelfRow(). */
{
  const { readdir, readFile: rf } = await import("node:fs/promises");
  const rawStart = html.indexOf("const RAW = [");
  const rawBlock = html.slice(rawStart, html.indexOf("\n];", rawStart));
  const curated = new Set([...rawBlock.matchAll(/^\["([^"]+)",(\d{4})/gm)].map((m) => m[1] + " (" + m[2] + ")"));
  const live = JSON.parse(await rf(join(ROOT, "data/catalog.json"), "utf8"));
  const shelved = new Set((live.shelf || []).map((e) => e.t + " (" + e.y + ")"));
  const offenders = [];
  for (const f of (await readdir(join(ROOT, "scripts"))).filter((x) => x.endsWith(".test.mjs"))) {
    const src = await rf(join(ROOT, "scripts", f), "utf8");
    for (const k of new Set([...src.matchAll(/"([^"\n]{2,70} \(\d{4}\))"/g)].map((m) => m[1]))) {
      if (!curated.has(k) && shelved.has(k)) offenders.push(f + ' names "' + k + '"');
    }
  }
  eq("every film a test names is curated, not shelved", offenders, []);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
