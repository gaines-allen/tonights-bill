/**
 * Verifies the mood table is coherent and that the moods which are genre asks
 * actually rule films out. The case this exists for: "Make me laugh" used to
 * return Die Hard, Goodfellas and Pulp Fiction, because all three carry tags
 * the laugh mood scores on and scoring alone can never exclude anything.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const html = await readFile(join(ROOT, "index.html"), "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const body = blocks[1].split("/* ---------- state ---------- */")[0]
  .replace(/\(function\(\)\{/, "").replace(/"use strict";/, "");
/* S lives past the cut. Everything under test only reaches for it when called,
   so a stub standing in for the viewer's answers is enough. */
/* clamp is defined past the cut too. Lifted from the source rather than
   rewritten here, so the test can never score against a different one. */
const clampSrc = blocks[1].match(/function clamp\([^)]*\)\{[^}]*\}/)[0];
const src = blocks[0] + "\n" + body + "\n" + clampSrc +
  "\nconst S = {moods:[], minRT:0};" +
  "\nexport {FILMS, MOODS, MOOD_BY, GENRES, moodVector, moodScore, moodGates, minCritics, S};";
const mod = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
const { FILMS, MOODS, GENRES, moodVector, moodScore, moodGates, minCritics, S } = mod;

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) { pass++; console.log(`  ok   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}\n       got  ${a}\n       want ${b}`); }
};

const attrVocab = new Set();
const genreVocab = new Set();
FILMS.forEach(f => { f.a.forEach(a => attrVocab.add(a)); f.g.forEach(g => genreVocab.add(g)); });

console.log("\nthe vocabulary a mood is allowed to use");
/* A typo here does not error, it silently invents a tag nothing shares and
   quietly degrades every recommendation. That is why this is a test. */
const strayTags = [];
MOODS.forEach(m => [...m.up, ...m.down].forEach(t => {
  if (!attrVocab.has(t) && !genreVocab.has(t)) strayTags.push(m.k + ":" + t);
}));
eq("every mood tag exists in the catalog", strayTags, []);

const strayNeeds = [];
MOODS.forEach(m => (m.need || []).forEach(g => {
  if (!genreVocab.has(g)) strayNeeds.push(m.k + ":" + g + " (not in catalog)");
  if (GENRES.indexOf(g) === -1) strayNeeds.push(m.k + ":" + g + " (not selectable)");
}));
eq("every gated genre is real and selectable", strayNeeds, []);

console.log("\nevery genre in the data can be filtered to");
const unreachable = [...genreVocab].filter(g => GENRES.indexOf(g) === -1).sort();
eq("no genre is unreachable from the filters", unreachable, []);

console.log("\nthe moods that rule films out");
const gatedOf = key => { S.moods = [key]; const g = moodGates(); S.moods = []; return g; };
eq("make me laugh is a comedy ask", gatedOf("laugh").map(m => m.need), [["comedy"]]);
eq("i want to scream is a horror ask", gatedOf("scream").map(m => m.need), [["horror","thriller"]]);
eq("an atmosphere mood rules nothing out", gatedOf("beautiful"), []);
eq("comfort rules nothing out", gatedOf("comfort"), []);

const eligible = (key, title) => {
  const f = FILMS.find(x => x.t === title);
  if (!f) return "no such film";
  return gatedOf(key).every(m => f.g.some(g => m.need.indexOf(g) > -1));
};

console.log("\nthe films that started this");
eq("Die Hard is not a comedy",           eligible("laugh", "Die Hard"), false);
eq("Goodfellas is not a comedy",         eligible("laugh", "Goodfellas"), false);
eq("Pulp Fiction is not a comedy",       eligible("laugh", "Pulp Fiction"), false);
eq("Inglourious Basterds is not either", eligible("laugh", "Inglourious Basterds"), false);
eq("Airplane! is",                       eligible("laugh", "Airplane!"), true);
eq("Hot Fuzz is, jokes and violence together", eligible("laugh", "Hot Fuzz"), true);
eq("Shaun of the Dead answers both asks",
   eligible("laugh", "Shaun of the Dead") && eligible("scream", "Shaun of the Dead"), true);
eq("Toy Story is not a horror film",      eligible("scream", "Toy Story"), false);
eq("Alien is",                           eligible("scream", "Alien"), true);

console.log("\nthe whole eligible pool, not just the top of it");
S.moods = ["laugh"];
const gates = moodGates();
const pool = FILMS.filter(f => gates.every(m => f.g.some(g => m.need.indexOf(g) > -1)));
S.moods = [];
eq("every film a laugh night can return is a comedy",
   pool.filter(f => f.g.indexOf("comedy") === -1).map(f => f.t), []);
eq("and there are enough of them to programme from", pool.length >= 40, true);

console.log("\nranking inside the gate still works");
S.moods = ["laugh"];
const v = moodVector();
const scored = pool.map(f => ({ t: f.t, n: moodScore(f, v) })).sort((a, b) => b.n - a.n);
S.moods = [];
const sadComedies = ["The Farewell", "The Holdovers", "The Banshees of Inisherin"];
const half = Math.floor(scored.length / 2);
eq("the comedies that are not funny sink",
   sadComedies.every(t => scored.findIndex(x => x.t === t) > half), true);
eq("Airplane! floats", scored.findIndex(x => x.t === "Airplane!") < 8, true);

console.log("\nthe mood score has to discriminate, not saturate");
/* It used to run coverage through a gain of 1.6, which put the ceiling at 62%:
   a film carrying two of the three things a laugh night asks for scored
   identically to one carrying all three, every good answer arrived tied, and
   the room and fame tiebreaks decided the night instead. */
S.moods = ["laugh"];
const lv = moodVector();
const three = moodScore({ a:["comic","ironic","brisk"], g:["comedy"] }, lv);
const two   = moodScore({ a:["comic","ironic"],         g:["comedy"] }, lv);
const one   = moodScore({ a:["comic"],                  g:["comedy"] }, lv);
S.moods = [];
eq("carrying everything asked for scores top", three, 1);
eq("carrying two of three scores strictly less", two < three, true);
eq("carrying one scores less again", one < two, true);
eq("and the gaps are big enough to reorder a bill", three - two > 0.05, true);

console.log("\nsomething great is still an acclaim ask, not a genre one");
S.moods = ["great"]; const bar = minCritics(); const greatGates = moodGates(); S.moods = [];
eq("it lifts the critic floor", bar, 88);
eq("and rules out no genre", greatGates, []);

console.log("\nthe hard filter is actually wired into the bill");
eq("checkFilters carries a mood row", /\{k:"mood", label:/.test(html), true);
eq("hardPass only ever exempts service",
   /hardPass\(f\)\{\s*return checkFilters\(f\)\.every\(function\(c\)\{ return c\.k === "service" \|\| c\.pass; \}\);/
     .test(html.replace(/\n/g, "")), true);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
