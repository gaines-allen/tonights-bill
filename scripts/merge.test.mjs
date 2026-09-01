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
  "\nexport {FILMS, BY_TITLE, applyEnrichment, ENRICHED};";
const mod = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
const { FILMS, BY_TITLE, applyEnrichment } = mod;

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

console.log("\nshelf rows are softened for a children's certificate");
applyEnrichment({ films: [], shelf: [
  { t:"Cartoon Heist", y:2021, r:95, g:["animation","comedy","crime"],
    a:["violent","comic","cozy","visual"], svcs:["NFX"], mpaa:"PG", rt:80 },
  { t:"Monster Factory", y:2001, r:92, g:["animation","family"],
    a:["scary","visual","comic","cozy"], svcs:["NFX"], mpaa:"G", rt:90 },
  { t:"Grown Up Business", y:2019, r:130, g:["crime","thriller"],
    a:["violent","bleak","slowburn"], svcs:["NFX"], mpaa:"R", rt:85 },
  { t:"Only Harsh Tags", y:2020, r:100, g:["horror"],
    a:["scary","violent","bleak"], svcs:["NFX"], mpaa:"PG", rt:70 }
]});
eq("a PG cartoon heist is not violent", BY_TITLE["Cartoon Heist"].a, ["comic","cozy","visual"]);
eq("a G film about monsters is not scary", BY_TITLE["Monster Factory"].a, ["visual","comic","cozy"]);
eq("an R row is untouched", BY_TITLE["Grown Up Business"].a, ["violent","bleak","slowburn"]);
eq("softening never empties a row", BY_TITLE["Only Harsh Tags"].a, ["scary","violent","bleak"]);
eq("a hand-tagged scare survives — Coraline is meant to be scary",
   BY_TITLE["Coraline"].a.indexOf("scary") > -1, true);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
