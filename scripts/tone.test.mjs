/**
 * A comedy night is not a thriller night. Scored on tonight's tags, the ones
 * in data/catalog.json, so a bad refresh fails here before it is committed.
 *
 *   node scripts/tone.test.mjs
 *   CATALOG=/path/to/catalog.json node scripts/tone.test.mjs
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
Object.keys(S.svc).forEach((k) => { S.svc[k] = true; });
const top = (loved, n = 10) => {
  S.taste = Object.fromEntries(loved.map((k) => [k, "loved"]));
  return mod.scoreAll().picks.slice(0, n).map((r) => r.f);
};
const names = (fs) => fs.map((f) => f.t).join(", ");
const film = (k) => mod.BY_KEY[k];

console.log("\nthe tags are tonight's, from the same rules for every film");
ok("every curated film carries sourced tags", mod.FILMS.filter((f) => !f.found).every((f) => f.aSrc === "tmdb"),
   mod.FILMS.filter((f) => !f.found && f.aSrc !== "tmdb").map((f) => f.t).slice(0, 5).join(", "));
ok("and at least two of them", mod.FILMS.every((f) => f.a.length >= 2),
   mod.FILMS.filter((f) => f.a.length < 2).map((f) => f.t).slice(0, 5).join(", "));

console.log("\neach film's tone, from its genres");
eq("a crime comedy is mixed, not dark", mod.toneOf(film("Knives Out (2019)")), "mixed");
eq("a straight comedy is light", mod.toneOf(film("Superbad (2007)")), "light");
eq("a hard thriller is dark", mod.toneOf(film("Se7en (1995)")), "dark");

console.log("\nthe canary, on tonight's tags");
const canary = ["Knives Out (2019)", "Ocean's Eleven (2001)", "Hot Fuzz (2007)"];
eq("Knives Out, Ocean's Eleven and Hot Fuzz put Glass Onion first", top(canary, 1)[0].t, "Glass Onion");

console.log("\nno hard thriller for a comedy, no comedy for a thriller");
const dark = (fs) => fs.filter((f) => mod.toneOf(f) === "dark");
const light = (fs) => fs.filter((f) => mod.toneOf(f) === "light");
let picks = top(canary);
ok("a crime-comedy profile gets no dark film in its top ten", !dark(picks).length, names(dark(picks)));
picks = top(["Superbad (2007)", "Bridesmaids (2011)", "Booksmart (2019)"]);
ok("a straight-comedy profile gets no dark film in its top ten", !dark(picks).length, names(dark(picks)));
picks = top(["Paddington 2 (2017)", "Up (2009)", "Toy Story (1995)"]);
ok("a family profile gets no dark film in its top ten", !dark(picks).length, names(dark(picks)));
picks = top(["Zodiac (2007)", "Prisoners (2013)", "Sicario (2015)"]);
ok("a tense-crime profile gets no straight comedy in its top ten", !light(picks).length, names(light(picks)));
picks = top(["Hereditary (2018)", "Get Out (2017)"]);
ok("a horror profile gets no straight comedy in its top ten", !light(picks).length, names(light(picks)));

console.log("\na mixed profile is left alone");
S.taste = { "Superbad (2007)": "loved", "Se7en (1995)": "loved" };
eq("one comedy and one thriller lean neither way", mod.toneLean(mod.buildTaste()), "");

finish();
