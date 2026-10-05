/**
 * Star, thumbs up, thumbs down: the one control, its saved state, the move of
 * older title-keyed shelves onto stable keys, and what the reactions do to
 * the recommendations. Offline, against the real catalog in index.html and
 * the committed data/catalog.json.
 *
 *   node scripts/taste.test.mjs
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadApp, eq, ok, walk, finish, html, ROOT } from "./harness.mjs";

const catalog = JSON.parse(await readFile(join(ROOT, "data/catalog.json"), "utf8"));
const settle = () => {};
function night(S){
  S.room = "solo"; S.timePreset = "long"; S.time = 240; S.moods = []; S.genres = [];
  S.rate = 0; S.minRT = 0; S.taste = {}; S.watched = {}; S.saved = {};
  S.locked = null; S.bills = []; S.offered = [];
  Object.keys(S.svc).forEach((k) => { S.svc[k] = true; });
}
const rankOf = (mod, title) => mod.scoreAll().picks.findIndex((r) => r.f.t === title);
const minis = (node) => walk(node).filter((n) => n.getAttribute && n.getAttribute("data-mini"));

console.log("\nthe control");
{
  const { mod } = await loadApp({ reduced: true });
  night(mod.S);
  const f = mod.BY_TITLE["Heat"];
  const row = mod.miniRow(f, "test");
  const b = row.children;
  eq("exactly three buttons, in order", b.map((x) => x.getAttribute("data-mini")), ["star", "up", "down"]);
  eq("each a real button", b.map((x) => x.tagName + ":" + x.type), ["BUTTON:button", "BUTTON:button", "BUTTON:button"]);
  eq("named for the film", b.map((x) => x.getAttribute("aria-label")), ["Save Heat", "Like Heat", "Dislike Heat"]);
  eq("pressed states start off", b.map((x) => x.getAttribute("aria-pressed")), ["false", "false", "false"]);
  eq("one shared class, so one size", b.map((x) => /\bmini-b\b/.test(x.className)), [true, true, true]);
  ok("every glyph is a 16-unit drawing", b.every((x) => /viewBox="0 0 16 16"/.test(x.innerHTML)));
  eq("each points at its own drawing", b.map((x) => (x.innerHTML.match(/#g-(\w+)/) || [])[1]), ["star", "up", "down"]);
  ok("drawn sixteen pixels square in CSS", /\.mini-b svg\{width:16px;height:16px;/.test(html));
  ok("in equal 28px boxes", /\.mini-b\{[^}]*width:28px;height:28px;/.test(html));
  ok("with 44px targets, not overlapping, on touch screens", /@media \(pointer:coarse\)\{[^}]*\.mini\{gap:0\}\s*\.mini-b\{width:44px;height:44px\}/.test(html));
  ok("one stroke weight for all three", /\.mini-b svg\{[^}]*stroke-width:1\.5;/.test(html) && !/mini-(star|up|down)[^{]*\{[^}]*stroke-width/.test(html));
  ok("all three drawn from one sprite on the same 16-unit grid",
     ["star", "up", "down"].every((g) => new RegExp('<symbol id="g-' + g + '" viewBox="0 0 16 16">').test(html)));
  eq("the row is labelled as a group", row.getAttribute("role"), "group");
  ok("the case's old button style cannot reach the row inside it", !/\.case-react button[{:.]/.test(html));
}

console.log("\nwhat each press does");
{
  const { mod, env } = await loadApp({ reduced: true });
  night(mod.S);
  const f = mod.BY_TITLE["Heat"], key = mod.filmKey(f);
  const a = mod.miniRow(f, "bill"), c = mod.miniRow(f, "search");
  const [star, up, down] = a.children;

  star.click();
  ok("star saves", mod.isSaved(f));
  eq("and does not like it", mod.reactionOf(f), "");
  ok("or mark it watched", !mod.isWatched(f));
  eq("the other copy on screen follows at once", c.children[0].getAttribute("aria-pressed"), "true");
  ok("it is announced", /Saved Heat/.test(env.doc.getElementById("announce").textContent));
  star.click();
  ok("pressing it again removes the save", !mod.isSaved(f));

  up.click();
  eq("thumbs up records a like", mod.S.taste[key], "loved");
  down.click();
  eq("thumbs down replaces it", mod.S.taste[key], "hated");
  eq("never both", [up, down].map((x) => x.getAttribute("aria-pressed")), ["false", "true"]);
  eq("the second copy agrees", [c.children[1], c.children[2]].map((x) => x.getAttribute("aria-pressed")), ["false", "true"]);
  down.click();
  eq("pressing the lit thumb clears it", mod.S.taste[key], undefined);
  ok("the clear is announced too", /Cleared your dislike/.test(env.doc.getElementById("announce").textContent));

  up.click(); star.click();
  const stored = JSON.parse(env.store.get("tb:taste2"));
  eq("likes persist by stable key", stored[key], "loved");
  ok("saves persist by stable key", !!JSON.parse(env.store.get("tb:saved"))[key]);
  const again = await loadApp({ reduced: true, store: env.store });
  eq("after a refresh the like is there", again.mod.reactionOf(again.mod.BY_TITLE["Heat"]), "loved");
  ok("and the save", again.mod.isSaved(again.mod.BY_TITLE["Heat"]));
}

console.log("\nolder shelves move onto stable keys, safely");
{
  const store = new Map([
    ["tb:taste", JSON.stringify({ "Knives Out": "loved", "Barbie": "hated", "Demon Slayer: Kimetsu no Yaiba Infinity Castle": "loved" })],
    ["tb:watched", JSON.stringify({ "Coraline": "2026-02-01T00:00:00.000Z" })],
    ["tb:bills", JSON.stringify([{ t: "Coraline", at: "2026-02-01T00:00:00.000Z" }])],
    ["tb:locked", JSON.stringify({ t: "Coraline", at: "2026-02-01T00:00:00.000Z", mins: 100 })]
  ]);
  const { mod, env } = await loadApp({ reduced: true, store });
  eq("a curated like is keyed by title and year", mod.S.taste["Knives Out (2019)"], "loved");
  eq("so is a dislike", mod.S.taste["Barbie (2023)"], "hated");
  eq("and a watch", mod.S.watched["Coraline (2009)"], "2026-02-01T00:00:00.000Z");
  ok("a scanned title the page cannot place yet waits instead of being dropped",
     mod.S.pending.taste["Demon Slayer: Kimetsu no Yaiba Infinity Castle"] === "loved");
  mod.applyEnrichment(catalog); mod.migrateLegacy();
  eq("and is placed once the catalog arrives", mod.S.taste["Demon Slayer: Kimetsu no Yaiba Infinity Castle (2025)"], "loved");
  eq("nothing is left waiting", Object.keys(mod.S.pending.taste).length, 0);
  eq("an old title-only history record still finds its film", mod.filmOf(mod.S.bills[0]).t, "Coraline");
  eq("and the locked night", mod.filmOf(mod.S.locked).y, 2009);
  mod.setTaste(mod.BY_TITLE["Heat"], "loved");
  eq("the old record is never rewritten", JSON.parse(env.store.get("tb:taste"))["Heat"], undefined);
  ok("nor deleted", env.store.has("tb:taste") && env.store.has("tb:watched"));
  eq("the new one holds both old and new", Object.keys(JSON.parse(env.store.get("tb:taste2"))).sort(),
     ["Barbie (2023)", "Demon Slayer: Kimetsu no Yaiba Infinity Castle (2025)", "Heat (1995)", "Knives Out (2019)"]);
}

console.log("\none film, one identity");
{
  const { mod } = await loadApp({ reduced: true });
  mod.applyEnrichment(catalog);
  const byTmdb = {};
  mod.FILMS.forEach((f) => { if (f.tmdb) byTmdb[f.tmdb] = (byTmdb[f.tmdb] || 0) + 1; });
  eq("no TMDB id appears twice in the catalog", Object.values(byTmdb).filter((n) => n > 1).length, 0);
  ok("'Star Wars' from the scan is not a second A New Hope", !mod.FILMS.some((f) => f.t === "Star Wars" && f.y === 1977));
  ok("but The Thing (2011) is its own film beside The Thing (1982)",
     !!mod.BY_KEY["The Thing (2011)"] && !!mod.BY_KEY["The Thing (1982)"]);
  eq("and a title-only lookup still means the curated film", mod.BY_TITLE["The Thing"].y, 1982);
  ok("a remake never borrows the original's written store line",
     !/Antarctic/.test(mod.storeSays({ f: mod.BY_KEY["The Thing (2011)"], T: mod.buildTaste(), parts: {}, weights: {}, on: [] })) ||
     /Antarctic/.test(mod.BY_KEY["The Thing (2011)"].h));
}

console.log("\nreactions move the ranking, in the right direction");
{
  const { mod } = await loadApp({ reduced: true });
  night(mod.S);
  /* Glass Onion against a liked Knives Out, and against a disliked one */
  const base = rankOf(mod, "Glass Onion");
  mod.S.taste = { "Knives Out (2019)": "loved" };
  const liked = rankOf(mod, "Glass Onion");
  mod.S.taste = { "Knives Out (2019)": "hated" };
  const disliked = rankOf(mod, "Glass Onion");
  ok(`liking Knives Out lifts Glass Onion (${base} -> ${liked})`, liked < base);
  ok(`disliking it drops Glass Onion (${base} -> ${disliked})`, disliked > base);
  mod.S.taste = {};
  eq("clearing the reaction puts it back exactly", rankOf(mod, "Glass Onion"), base);

  mod.S.taste = { "Knives Out (2019)": "loved", "Ocean's Eleven (2001)": "loved", "Hot Fuzz (2007)": "loved" };
  const out = mod.scoreAll();
  eq("the canary still holds: that profile puts Glass Onion first", out.picks[0].f.t, "Glass Onion");

  mod.S.taste = { "Glass Onion (2022)": "hated" };
  ok("a disliked film is not recommended again", rankOf(mod, "Glass Onion") === -1);
  mod.S.taste = {};
  ok("and returns when the dislike is cleared", rankOf(mod, "Glass Onion") > -1);

  /* a save leans, a thumb pushes */
  mod.S.taste = {}; mod.S.saved = { "Knives Out (2019)": { at: "x" } };
  const saved = rankOf(mod, "Glass Onion");
  ok(`a save nudges similar films up (${base} -> ${saved})`, saved < base);
  ok(`but less than a like does (${saved} vs ${liked})`, saved > liked);
  ok("a saved film is still recommended, since saving is not watching", rankOf(mod, "Knives Out") > -1);
  mod.S.saved = {};
}

console.log("\none thumbs up does not collapse the bill");
{
  const { mod } = await loadApp({ reduced: true });
  night(mod.S);
  for (const [liked, lead] of [["Superbad (2007)", "comedy"], ["Toy Story (1995)", "animation"], ["Hereditary (2018)", "horror"]]) {
    mod.S.taste = { [liked]: "loved" };
    const top = mod.scoreAll().picks.slice(0, 10).map((r) => r.f);
    const same = top.filter((f) => f.g[0] === lead).length;
    ok(`after liking ${liked}, ${same} of the top ten lead with ${lead}: present, not everything`, same >= 1 && same <= 4);
    ok(`  and at least five lead genres share the top ten`, new Set(top.map((f) => f.g[0])).size >= 5);
  }
  mod.S.taste = { "Knives Out (2019)": "loved", "Ocean's Eleven (2001)": "loved", "Hot Fuzz (2007)": "loved" };
  const full = mod.scoreAll().picks.map((r) => r.f.t).slice(0, 5).join("|");
  mod.S.taste = {};
  ok("the re-deal is off once three reactions are in", full.startsWith("Glass Onion"));
}

console.log("\nhard limits are never crossed");
{
  const { mod } = await loadApp({ reduced: true });
  night(mod.S);
  mod.S.room = "kids"; mod.S.time = 100; mod.S.timePreset = "short";
  mod.S.svc = Object.fromEntries(Object.keys(mod.S.svc).map((k) => [k, k === "DIS"]));
  mod.S.taste = { "Se7en (1995)": "loved", "The Departed (2006)": "loved", "Heat (1995)": "loved" };
  const picks = mod.scoreAll().picks;
  ok("loving three R-rated crime films brings no adult film into a kids' room",
     picks.length > 0 && picks.every((r) => r.f.k === "all"));
  ok("nothing over the runtime", picks.every((r) => r.f.r <= 100));
  ok("nothing off the selected service", picks.every((r) => r.on.includes("DIS")));
  mod.S.genres = ["animation"];
  ok("and a genre filter still filters", mod.scoreAll().picks.every((r) => r.f.g.includes("animation")));
}

console.log("\na thumb means seen; a save does not");
{
  const { mod, env } = await loadApp({ reduced: true });
  night(mod.S);
  const f = mod.BY_TITLE["Parasite"];
  mod.toggleSaved(f);
  ok("saved", mod.isSaved(f));
  ok("a save alone does not hold a film back", !mod.scoreAll().watched.includes(f));
  mod.setTaste(f, "loved");
  ok("a thumb holds it back as seen", mod.scoreAll().watched.includes(f));
  ok("and the save survives it", mod.isSaved(f));
  mod.setTaste(f, "loved");
  ok("clearing the thumb offers it again", !mod.scoreAll().watched.includes(f));
  ok("there is no Seen it button anywhere on the page", !/>Seen it</.test(html) && !/"Seen it"/.test(html));
  mod.S.room = "solo"; mod.S.timePreset = "long"; mod.S.time = 240;
  mod.programme({ quiet: true, silent: true });
  const acts = walk(env.doc.getElementById("bill-grid")).filter((n) => n.tagName === "BUTTON").map((n) => n.textContent);
  ok("the feature offers Lock it in and Show me something else, and no Seen it",
     acts.some((x) => /Lock it in/.test(x)) && acts.some((x) => /something else/.test(x)) && !acts.includes("Seen it"));
}

console.log("\nthe entrance");
{
  const hero = html.slice(html.indexOf('<div class="hero" id="hero">'), html.indexOf('<div class="evening frame"'));
  const words = hero.replace(/<[^>]+>/g, " ").replace(/&rarr;/g, "").replace(/\s+/g, " ").trim();
  eq("the hero's only words are the marquee and the button", words, "Main Feature Find your movie");
  eq("exactly three film shots", (hero.match(/class="shot shot-/g) || []).length, 3);
  ok("no Open Late anywhere", !/open late/i.test(html));
  ok("the footer is the one line", /<footer class="colophon">\s*<p>Real Movies, Real Recommendations<\/p>\s*<\/footer>/.test(html));
  const rm = html.slice(html.indexOf("@media (prefers-reduced-motion: reduce)"));
  ok("the bulbs stop under reduced motion", /\.bulb,\.marquee\.chase \.bulb\{animation:none/.test(rm));
  ok("the touch-screen tap-size rule never shrinks the mood cards",
     !/@media \(pointer:coarse\)\{[^}]*\.night-opt[,{]/.test(html));
  ok("and the hero images and controls stop moving", /\.shot img\{transition:none\}/.test(rm) && /\.mini-b\.pop svg/.test(rm));
  ok("Find your movie opens the questionnaire, which starts closed",
     /<div class="evening frame" id="evening" hidden>/.test(html) && /aria-controls="evening"/.test(html));
  const { mod, env } = await loadApp({ reduced: true });
  mod.openEvening({ go: true });
  eq("opening it shows the questions", env.doc.getElementById("evening").hidden, false);
  ok("and takes focus there", globalThis.__focused === env.doc.getElementById("statement"));
  ok("the favicon set is linked with relative paths for the Pages sub-path",
     ['href="favicon.ico"', 'href="assets/icons/favicon.svg"', 'href="assets/icons/apple-touch-icon.png"', 'href="site.webmanifest"'].every((h) => html.includes(h)));
}

console.log("\nmore filters");
{
  const i = html.indexOf('<details class="tune" id="tune">'), j = html.indexOf('id="show-bill"');
  ok("More filters sits above the Show me the main feature button", i > -1 && j > -1 && i < j);
  ok("and is called More filters", /<span class="tune-name">More filters<\/span>/.test(html) && !/Got rules/.test(html));
  const { mod, env } = await loadApp({ reduced: true });
  const c = env.doc.getElementById("tune-count");
  mod.S.genres = []; mod.S.rate = 0; mod.S.minRT = 0; mod.S.moods = [];
  mod.gate(); mod.tuneCount();
  ok("with nothing set, no count shows", c.hidden === true);
  mod.S.genres = ["horror", "comedy"]; mod.S.minRT = 80;
  mod.tuneCount();
  eq("with filters set, it says how many", [c.hidden, c.textContent], [false, "3 on"]);
}

finish();
