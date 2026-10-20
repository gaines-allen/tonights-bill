/**
 * The genre filter is a filter. Selecting Comedy used to return The Menu,
 * Evil Dead II, Bride of Chucky and Fright Night, because the filter asked
 * only whether a film carried Comedy *somewhere* in its genre list. Horror
 * rode in as the second genre on something the viewer had asked for.
 *
 * Scored on tonight's tags, the ones in data/catalog.json, so a bad refresh
 * fails here before it is committed.
 *
 *   node scripts/genre.test.mjs
 *   CATALOG=/path/to/catalog.json node scripts/genre.test.mjs
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadApp, eq, ok, finish, ROOT } from "./harness.mjs";

const catalog = JSON.parse(await readFile(process.env.CATALOG || join(ROOT, "data/catalog.json"), "utf8"));
const { mod } = await loadApp({ reduced: true });
mod.applyEnrichment(catalog);
const S = mod.S;
S.room = "solo"; S.timePreset = "long"; S.time = 240; S.moods = []; S.genres = [];
S.rate = 0; S.minRT = 0; S.watched = {}; S.saved = {}; S.locked = null; S.bills = []; S.offered = [];
S.taste = {};
Object.keys(S.svc).forEach((k) => { S.svc[k] = true; });

/* What the viewer would actually be offered for a given genre selection. */
const pool = (genres) => { S.genres = genres; return mod.scoreAll().picks.map((r) => r.f); };
const names = (fs) => fs.map((f) => f.t).slice(0, 6).join(", ");
const horrorIn = (fs) => fs.filter((f) => f.g.includes("horror"));
const has = (fs, t) => fs.some((f) => f.t === t);

console.log("\na scare has to be asked for");
/* Which genre a film is centred on is not in the data: TMDB's genre order is
   not a ranking (Happy Death Day and A Haunted House 2 list Comedy first,
   Shaun of the Dead and Evil Dead II list Horror first) and its keywords
   separate them no better. How a film plays is known, for every film, by the
   same rules — so the rule is about the scare, not the filing. */
eq("a film filed as horror is a scare", mod.isScare({ g: ["horror", "comedy"], a: ["comic"] }), true);
eq("so is one that plays as one", mod.isScare({ g: ["comedy"], a: ["comic", "scary"] }), true);
eq("a straight comedy is not", mod.isScare({ g: ["comedy"], a: ["comic", "brisk"] }), false);
eq("nor is an action comedy", mod.isScare({ g: ["action", "comedy"], a: ["comic", "propulsive", "violent"] }), false);

const comedy = pool(["comedy"]);
const scaresIn = (fs) => fs.filter((f) => mod.isScare(f));
ok("a Comedy-only filter returns no scare at all", !scaresIn(comedy).length, names(scaresIn(comedy)));
ok("and no horror film", !horrorIn(comedy).length, names(horrorIn(comedy)));
ok("and still has plenty to programme from", comedy.length > 100, "pool: " + comedy.length);

console.log("\nthe films that started this");
for (const t of ["The Menu", "Happy Death Day", "Evil Dead II", "Bride of Chucky",
                 "Fright Night", "A Haunted House 2", "Gremlins", "Ready or Not",
                 "The Cabin in the Woods", "Bodies Bodies Bodies"]) {
  ok(t + " is not a comedy night", !has(comedy, t));
}

console.log("\nan action comedy is not a scare, so it still comes through");
for (const t of ["Hot Fuzz", "Game Night", "Thor: Ragnarok", "22 Jump Street"]) {
  const f = mod.FILMS.find((x) => x.t === t);
  if (f && f.svcs.length) ok(t + " is still a comedy night", has(comedy, t));
}

console.log("\nevery other genre may still ride along");
/* Nobody who picks Comedy objects to Knives Out also being a crime film, so
   the rule has to be narrow enough to leave the crime comedies alone. */
ok("a crime comedy passes a Comedy filter", has(comedy, "Despicable Me") || has(comedy, "Glass Onion"),
   "neither Despicable Me nor Glass Onion survived");
ok("Ratatouille passes", has(comedy, "Ratatouille"));
const crimeComedies = comedy.filter((f) => f.g.includes("crime"));
ok("crime comedies are still on the shelf", crimeComedies.length > 0, "none left");

console.log("\nasked for by name, horror comes back");
const horror = pool(["horror"]);
ok("a Horror filter returns horror", horror.length > 0 && horror.every((f) => f.g.includes("horror")),
   names(horror.filter((f) => !f.g.includes("horror"))));
const both = pool(["comedy", "horror"]);
ok("Comedy plus Horror returns the horror comedies again",
   horrorIn(both).length > 0 && both.length > comedy.length);
ok("The Menu is a comedy-and-horror night", has(both, "The Menu"));

console.log("\nwith no genre set, nothing is ruled out");
/* The rule bites only once a filter is set. With none set the viewer has asked
   for nothing in particular, which is what lets "I want to scream" work. */
const open = pool([]);
ok("horror is still available when no genre is selected", horrorIn(open).length > 0);
ok("and the open shelf is the largest", open.length > both.length);
S.moods = ["scream"];
const scream = mod.scoreAll().picks;
ok("I want to scream still returns horror", scream.slice(0, 5).some((r) => r.f.g.includes("horror")),
   scream.slice(0, 5).map((r) => r.f.t).join(", "));
S.moods = [];

console.log("\nthe room is told why, in its own words");
S.genres = ["comedy"];
const menu = mod.BY_KEY["The Menu (2022)"] || mod.FILMS.find((f) => f.t === "The Menu");
const row = mod.checkFilters(menu).find((c) => c.k === "genre");
eq("the genre row fails for an uninvited horror comedy", row.pass, false);
ok("and says it is a scare nobody asked for", /plays as a scare/.test(row.detail), row.detail);
const rat = mod.FILMS.find((f) => f.t === "Ratatouille");
const ratRow = mod.checkFilters(rat).find((c) => c.k === "genre");
ok("a passing film reports what it matched", ratRow.pass && /matches .*Comedy/.test(ratRow.detail), ratRow.detail);
S.genres = [];
const openRow = mod.checkFilters(menu).find((c) => c.k === "genre");
ok("with no filter the row passes and says so", openRow.pass && /no genre filter/.test(openRow.detail), openRow.detail);

console.log("\nthe filter and the explanation can never disagree");
S.genres = ["comedy"];
const drift = mod.FILMS.filter((f) => {
  const r = mod.checkFilters(f).find((c) => c.k === "genre");
  const wanted = f.g.includes("comedy") && !mod.isScare(f);
  return r.pass !== wanted;
});
ok("every film's genre row agrees with the rule", !drift.length, names(drift));
S.genres = [];

console.log("\nasking for a genre asks for films centred on it");
/* With a single genre selected, the old score was hits / min(...) — which is 1
   for every film that carries the genre at all. The ask contributed nothing to
   the order, so fame and acclaim decided it, and a Comedy-only bill opened
   with The Wolf of Wall Street, Parasite and Forrest Gump. */
eq("a film that reads like the ask scores top",
   mod.genreCentre({ a: ["comic", "brisk", "cozy"] }, ["comedy"]), 1);
eq("one that reads like its opposite scores bottom",
   mod.genreCentre({ a: ["bleak", "slowburn"] }, ["comedy"]), 0);
eq("carrying both lands in the middle",
   mod.genreCentre({ a: ["comic", "bleak"] }, ["comedy"]), 0.5);
eq("tags that say neither are neutral",
   mod.genreCentre({ a: ["grounded"] }, ["comedy"]), 0.5);
eq("a genre with no tone entry does not guess",
   mod.genreCentre({ a: ["comic"] }, ["nonsense"]), 0.5);
console.log("\nno genre in the data is unreachable from the filter");
{
  const inData = new Set();
  mod.FILMS.forEach((f) => f.g.forEach((g) => inData.add(g)));
  const unreachable = [...inData].filter((g) => mod.GENRES.indexOf(g) === -1).sort();
  eq("every genre the catalog uses can be selected", unreachable, []);
}

ok("every genre in the tone table is one the filter offers",
   Object.keys(mod.GENRE_TONE).every((g) => mod.GENRES.indexOf(g) > -1),
   Object.keys(mod.GENRE_TONE).filter((g) => mod.GENRES.indexOf(g) === -1).join(", "));

/* The ordering this exists for, on tonight's data. */
S.genres = ["comedy"];
const ranked = mod.scoreAll().picks.map((r) => r.f.t);
S.genres = [];
const at = (t) => ranked.indexOf(t);
for (const t of ["The Wolf of Wall Street", "Parasite", "Forrest Gump"]) {
  if (at(t) > -1) ok(t + " no longer opens a comedy night", at(t) > 20, "ranked #" + (at(t) + 1));
}
ok("a bleak comedy-filed drama ranks below a straight comedy of similar fame",
   at("Parasite") === -1 || at("Parasite") > at("Monsters, Inc."),
   "Parasite #" + (at("Parasite") + 1) + " vs Monsters, Inc. #" + (at("Monsters, Inc.") + 1));

console.log("\nthe mood buttons are gated too");
/* "Make me laugh" is not a request for a film with jokes in it — Die Hard has
   jokes in it — it is a request for a comedy. Before this, with no genre
   filter set, it returned Scream VI, The Substance, Inglourious Basterds and
   Full Metal Jacket, all of which carry `comic` or `ironic` honestly. */
S.genres = [];
const moodPool = (moods) => { S.moods = moods; const p = mod.scoreAll().picks.map((r) => r.f); S.moods = []; return p; };
eq("make me laugh is a comedy ask", (mod.MOOD_BY["laugh"].need || []), ["comedy"]);
eq("i want to scream is a horror ask", (mod.MOOD_BY["scream"].need || []), ["horror", "thriller"]);
ok("a texture mood rules nothing out", !mod.MOOD_BY["comfort"].need && !mod.MOOD_BY["beautiful"].need);

const laugh = moodPool(["laugh"]);
const offLaugh = laugh.filter((f) => !f.g.includes("comedy"));
ok("every film a laugh night can return is a comedy", !offLaugh.length, names(offLaugh));
ok("and there are enough to programme from", laugh.length > 100, "pool: " + laugh.length);
for (const t of ["Scream VI", "The Substance", "Inglourious Basterds", "Full Metal Jacket", "Nobody 2"]) {
  const f = mod.FILMS.find((x) => x.t === t);
  if (f) ok(t + " is not a laugh night", !has(laugh, t));
}

const screamPool = moodPool(["scream"]);
const offScream = screamPool.filter((f) => !f.g.includes("horror") && !f.g.includes("thriller"));
ok("every film a scream night can return is horror or a thriller", !offScream.length, names(offScream));

const bothMoods = moodPool(["laugh", "scream"]);
ok("laugh and scream together asks for horror-comedy",
   bothMoods.length > 0 && bothMoods.every((f) => f.g.includes("comedy") && (f.g.includes("horror") || f.g.includes("thriller"))),
   names(bothMoods.filter((f) => !(f.g.includes("comedy") && (f.g.includes("horror") || f.g.includes("thriller"))))));

const comfortPool = moodPool(["comfort"]);
ok("comfort movie is still soft, so the whole shelf stays eligible", comfortPool.length > laugh.length);

console.log("\nand the gate explains itself");
S.moods = ["laugh"];
const diehard = mod.FILMS.find((f) => f.t === "Die Hard");
if (diehard) {
  const row = mod.checkFilters(diehard).find((c) => c.k === "mood");
  eq("Die Hard fails a laugh night", row.pass, false);
  ok("and is told why", /wants Comedy/.test(row.detail), row.detail);
}
S.moods = [];

finish();
