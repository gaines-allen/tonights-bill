/**
 * The header search: what it finds, how it ranks, and what it is willing to
 * say about where a film streams. Runs against the real catalog in
 * index.html merged with the committed data/catalog.json, offline.
 *
 *   node scripts/search.test.mjs
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadApp, eq, ok, walk, finish, html, ROOT } from "./harness.mjs";

const catalog = JSON.parse(await readFile(join(ROOT, "data/catalog.json"), "utf8"));
const { mod, env } = await loadApp({ reduced: true });
mod.applyEnrichment(catalog);
Object.keys(mod.S.svc).forEach((k) => { mod.S.svc[k] = true; });
const titles = (q) => mod.searchCatalog(q).map((f) => f.t + " (" + f.y + ")");
const $ = (id) => env.doc.getElementById(id);
const results = () => walk($("hunt-results"));
const hits = () => results().filter((n) => /\bhunt-hit\b/.test(n.className));
const lineOf = (hit) => walk(hit).find((n) => /\bhunt-a\b/.test(n.className)).textContent;
const search = (q) => { $("hunt-q").value = q; mod.runSearch(); };

console.log("\nfinding titles");
eq("an exact title comes first", titles("heat")[0], "Heat (1995)");
eq("case does not matter", titles("PARASITE")[0], "Parasite (2019)");
ok("a partial finds titles that start with it", ["Blade Runner (1982)", "Blade Runner 2049 (2017)"].every((t) => titles("blade runner").slice(0, 2).includes(t)));
ok("and a shorter one still reaches them", titles("blad").filter((t) => /^Blade Runner/.test(t)).length === 2);
ok("and words inside a title", titles("onion").includes("Glass Onion (2022)"));
ok("punctuation does not get in the way", titles("spiderman").some((t) => /^Spider-Man/.test(t)));
eq("a leading article is optional", titles("godfather")[0], "The Godfather (1972)");
eq("exact beats partial: 'Up' is Up, not Upgrade", titles("up")[0], "Up (2009)");

console.log("\ntwo films, one title");
const things = titles("the thing");
ok("both films named The Thing are there", things.includes("The Thing (1982)") && things.includes("The Thing (2011)"));
eq("each keeps its own year", things.filter((t) => /^The Thing \(/.test(t)).length, 2);
eq("a year narrows it", titles("the thing 2011")[0], "The Thing (2011)");
const ids = mod.searchCatalog("star wars").map((f) => f.tmdb).filter(Boolean);
eq("one film under two names comes back once", ids.length, new Set(ids).size);
ok("as the curated record", titles("star wars").includes("Star Wars: A New Hope (1977)") && !titles("star wars").includes("Star Wars (1977)"));

console.log("\nnot in the catalog");
search("zzzz not a film");
const none = results().find((n) => n.tagName === "P").textContent;
ok("says it is absent from the catalog", /isn't in our catalog/.test(none));
ok("without claiming it streams nowhere", /doesn't mean it isn't streaming/.test(none));
search("");
ok("an empty query gets a prompt", /Search a title/.test(results()[0].textContent));

console.log("\navailability, honestly");
const film = (t) => mod.BY_TITLE[t];
const godfather = film("The Godfather");           /* checked: PRV, PAR */
ok("the fixture streams where we think", godfather.svcChecked && godfather.svcs.includes("PRV"));
Object.keys(mod.S.svc).forEach((k) => { mod.S.svc[k] = (k === "PRV"); });
eq("on a selected service", mod.availability(godfather).line, "On your services: Prime Video");
Object.keys(mod.S.svc).forEach((k) => { mod.S.svc[k] = (k === "NFX"); });
eq("on services you didn't pick", mod.availability(godfather).line, "Not on your selected services");
ok("and it says where it is", /Prime Video/.test(mod.availability(godfather).detail));
const nowhere = mod.FILMS.find((f) => f.svcChecked && !f.svcs.length);
ok("a checked film on no tracked service is not 'on' anything", mod.availability(nowhere).k === "off");
ok("and is described as not on the services we track, not as unstreamable",
   /services we track/.test(mod.availability(nowhere).detail));
const guess = Object.assign({}, godfather, { svcChecked: false });
eq("an unchecked hand-tagged film is 'not confirmed'", mod.availability(guess).line, "Availability not confirmed");
eq("never 'not on your services'", mod.availability(guess).k, "unknown");
Object.keys(mod.S.svc).forEach((k) => { mod.S.svc[k] = false; });
eq("with no services picked it asks first", mod.availability(godfather).line, "Select your services to check availability.");
search("godfather");
ok("and a title search still lists catalog matches", hits().length > 0);

console.log("\nsubscriptions only");
const enrich = await readFile(join(ROOT, "scripts/enrich.mjs"), "utf8");
ok("the catalog only ever records flatrate and ad-tier offers", /\[\.\.\.\(region\.flatrate \|\| \[\]\), \.\.\.\(region\.ads \|\| \[\]\)\]/.test(enrich) && !/region\.(rent|buy)/.test(enrich));
const { flatrateCodes } = await import(join(ROOT, "scripts/enrich.mjs"));
eq("a rental-only listing yields no subscription service",
   flatrateCodes({ results: { US: { rent: [{ provider_name: "Netflix" }], buy: [{ provider_name: "Max" }] } } }), []);

console.log("\none services setting, both places");
mod.setService("NFX", true);
const box = walk($("hunt-svc-list")).find((n) => n.value === "NFX");
eq("the drawer's box follows a change made through the shared setter", box.checked, true);
const tune = walk($("f-services")).find((n) => n.textContent === "Netflix");
eq("so does Got rules?", tune.getAttribute("aria-pressed"), "true");
box.checked = false; box.dispatch("change");
eq("unticking in the drawer changes the stored preference", mod.S.svc.NFX, false);
eq("and Got rules? follows at once", walk($("f-services")).find((n) => n.textContent === "Netflix").getAttribute("aria-pressed"), "false");
ok("and it is saved", JSON.parse(env.store.get("tb:svc")).NFX === false);
ok("Peacock keeps its existing code", walk($("hunt-svc-list")).some((n) => n.value === "PCK"));
Object.keys(mod.S.svc).forEach((k) => mod.setService(k, k === "PRV"));
search("godfather");
eq("results repaint against the new choice", lineOf(hits()[0]), "On your services: Prime Video");

console.log("\nresults are films you can act on");
const first = hits()[0];
const rowButtons = walk(first).filter((n) => n.getAttribute && n.getAttribute("data-mini"));
eq("each result carries the star and thumbs row", rowButtons.map((b) => b.getAttribute("data-mini")), ["star", "up", "down"]);
walk(first).find((n) => /\bhunt-open\b/.test(n.className)).click();
eq("opening a result opens the film's case", $("case").hidden, false);
ok("with its streaming homes", walk($("case-body")).some((n) => /playing-label/.test(n.className)));
ok("and the same row", walk($("case-body")).some((n) => n.getAttribute && n.getAttribute("data-mini") === "star"));
mod.closeCase();

console.log("\nkeyboard and labels");
ok("the input has a real label", /<label class="sr" for="hunt-q">Search movies<\/label>/.test(html));
ok("Search is an item in the header row, after the sections",
   /data-go="showings">Past Showings<\/button>\s*<button type="button" class="door-hunt" id="hunt-go" aria-expanded="false" aria-controls="hunt-panel">Search<\/button>\s*<\/nav>/.test(html));
ok("and the search bar is not in the header until it is opened",
   html.indexOf('id="hunt-q"') > html.indexOf('id="hunt-panel"'));
mod.wireHunt();                     /* what init() does on a real page */
eq("closed to begin with", $("hunt-panel").hidden !== false, true);
$("hunt-go").click();
eq("pressing Search opens the bar", $("hunt-panel").hidden, false);
eq("says so", $("hunt-go").getAttribute("aria-expanded"), "true");
ok("with the cursor in the box", globalThis.__focused === $("hunt-q"));
const esc = $("masthead").dispatch("keydown", { key: "Escape" });
eq("Escape closes it", $("hunt-panel").hidden, true);
ok("and the key goes no further", esc._stopped);
ok("focus goes back to Search", globalThis.__focused === $("hunt-go"));
$("hunt-go").click();
$("hunt-close").click();
eq("Close closes it", $("hunt-panel").hidden, true);
$("hunt-go").click(); $("hunt-go").click();
eq("pressing Search again closes it too", $("hunt-panel").hidden, true);
$("hunt-go").click();
mod.closeHunt(false);

console.log("\nchanging services under a pick");
{
  const { mod: m2 } = await loadApp({ reduced: true });
  m2.applyEnrichment(catalog);
  const S = m2.S;
  S.room = "solo"; S.timePreset = "two"; S.time = 135; S.moods = ["guess"]; S.genres = []; S.rate = 0; S.minRT = 0;
  S.taste = {}; S.watched = {}; S.saved = {}; S.locked = null; S.bills = []; S.offered = [];
  Object.keys(S.svc).forEach((k) => { S.svc[k] = k !== "PCK"; });
  m2.programme({ quiet: true, silent: true });
  const head = m2.HEAD_get().f;
  m2.setTaste(head, "loved");
  m2.setService("PCK", true);
  eq("a liked pick still on your services stays on screen when a service is added", m2.HEAD_get().f, head);
  const only = head.svcs.filter((c) => S.svc[c]);
  only.forEach((c) => m2.setService(c, false));
  ok("but when its last service is dropped, a film you can watch takes its place",
     m2.HEAD_get() && m2.HEAD_get().f !== head && m2.HEAD_get().f.svcs.some((c) => S.svc[c]));
}

finish();
