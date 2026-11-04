/**
 * Offline tests for the enrichment transforms. No key and no network: the
 * show fixtures are Movie of the Night's own published example responses
 * (trimmed to the US), and the HTTP layer is driven by a fake fetch.
 * Run: node scripts/enrich.test.mjs
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { serviceCode, parseCatalog, pickMatch, rtFromOmdb, deriveAttrs, tagsFrom, genresFrom,
         audienceFrom, fameFromRank, readOmdbPayload, tmdbIdOf, streamingCodes, watchLinks,
         logoUrls, imagesOf, rentLinkOf, overviewTerms, factsOf, curatedRecord, shelfRecord,
         scanUrl, scanService, scanOrder, checkOrder, getJSON, headersFor, calls, BudgetSpent,
         SERVICE_IDS } from "./enrich.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const ok = (label, cond) => eq(label, !!cond, true);
const fixture = async (name) => JSON.parse(await readFile(join(ROOT, "scripts/fixtures", name), "utf8"));
const DARK = await fixture("motn-show-the-dark-knight.json");
const SEARCH = await fixture("motn-search-netflix-us.json");

/* A show built by hand around the one thing a test is about. */
const svc = (id, name) => ({ id, name, imageSet: { whiteImage: `https://media.movieofthenight.com/services/${id}/logo-white.svg` } });
const opt = (id, type, extra = {}) => ({ service: svc(id, id), type, link: `https://example.com/${id}/${type}`, ...extra });
const show = (over = {}) => ({
  itemType: "show", showType: "movie", id: "1", imdbId: "tt0000001", tmdbId: "movie/42",
  title: "A Film", originalTitle: "A Film", releaseYear: 2010, runtime: 110, rating: 80,
  overview: "A detective unravels a conspiracy in a city that never sleeps, one twist ending at a time.",
  genres: [{ id: "crime", name: "Crime" }, { id: "thriller", name: "Thriller" }],
  directors: ["Someone"], cast: [],
  imageSet: {
    verticalPoster: { w240: "https://cdn.movieofthenight.com/p/240.jpg", w360: "https://cdn.movieofthenight.com/p/360.jpg",
                      w480: "https://cdn.movieofthenight.com/p/480.jpg", w600: "x", w720: "x" },
    horizontalPoster: { w360: "x", w480: "x", w720: "x", w1080: "https://cdn.movieofthenight.com/hp/1080.jpg", w1440: "x" },
    horizontalBackdrop: { w360: "x", w480: "x", w720: "https://cdn.movieofthenight.com/b/720.jpg",
                          w1080: "https://cdn.movieofthenight.com/b/1080.jpg", w1440: "x" }
  },
  streamingOptions: { us: [opt("netflix", "subscription")] },
  ...over
});

console.log("\nservice ids (stable ids, so no display name can drift)");
eq("the eight services", Object.values(SERVICE_IDS).sort(), ["APL","DIS","HUL","MAX","NFX","PAR","PCK","PRV"]);
eq("netflix", serviceCode("netflix"), "NFX");
eq("hbo is Max", serviceCode("hbo"), "MAX");
eq("case does not matter", serviceCode("Prime"), "PRV");
eq("an untracked service", serviceCode("tubi"), null);
eq("nothing", serviceCode(null), null);

console.log("\nwhere it streams (subscription or free on the service itself)");
eq("the published example: The Dark Knight is on Max in the US", streamingCodes(DARK, "us"), ["MAX"]);
eq("rent and buy never count", streamingCodes(show({ streamingOptions: { us: [
   opt("apple", "rent"), opt("prime", "buy")] } }), "us"), []);
eq("an add-on channel is not the service", streamingCodes(show({ streamingOptions: { us: [
   opt("prime", "addon", { addon: { id: "hbomaxus", name: "HBO Max" } })] } }), "us"), []);
eq("a free tier counts", streamingCodes(show({ streamingOptions: { us: [opt("peacock", "free")] } }), "us"), ["PCK"]);
eq("one code per service", streamingCodes(show({ streamingOptions: { us: [
   opt("hulu", "subscription"), opt("hulu", "free"), opt("tubi", "free")] } }), "us"), ["HUL"]);
eq("another country's listings are ignored", streamingCodes(show({ streamingOptions: { gb: [opt("netflix", "subscription")] } }), "us"), []);
eq("no listings at all", streamingCodes({}, "us"), []);

console.log("\nlinks straight to the title");
eq("the published example links to the film on Max",
   Object.keys(watchLinks(DARK, "us")), ["MAX"]);
ok("and the link is https", /^https:\/\//.test(watchLinks(DARK, "us").MAX));
eq("the subscription listing wins over the free one", watchLinks(show({ streamingOptions: { us: [
   opt("peacock", "free"), opt("peacock", "subscription")] } }), "us"), { PCK: "https://example.com/peacock/subscription" });
eq("a non-https link is dropped", watchLinks(show({ streamingOptions: { us: [
   opt("netflix", "subscription", { link: "javascript:alert(1)" })] } }), "us"), {});
eq("a rental lead when nothing streams it", rentLinkOf(show({ streamingOptions: { us: [
   opt("prime", "buy"), opt("apple", "rent")] } }), "us"), { name: "apple", link: "https://example.com/apple/rent" });
eq("no store, no rental lead", rentLinkOf(show({ streamingOptions: { us: [] } }), "us"), null);

console.log("\nlogos and pictures");
eq("the white mark of each tracked service", logoUrls(DARK, "us"),
   { MAX: "https://media.movieofthenight.com/services/hbo/logo-white.svg" });
const pics = imagesOf(show());
eq("poster at 480, small at 240", [pics.poster, pics.posterSm],
   ["https://cdn.movieofthenight.com/p/480.jpg", "https://cdn.movieofthenight.com/p/240.jpg"]);
eq("the still is the clean backdrop, never the lettered horizontal poster", pics.backdrop, "https://cdn.movieofthenight.com/b/1080.jpg");
eq("no backdrop means no still", imagesOf(show({ imageSet: { verticalPoster: {}, horizontalPoster: {} } })).backdrop, null);
ok("the published example has a poster and a still", imagesOf(DARK).poster && imagesOf(DARK).backdrop);

console.log("\nids carry over from before the switch");
eq("movie/155 is TMDB 155", tmdbIdOf(DARK), 155);
eq("a series id is not a film id", tmdbIdOf({ tmdbId: "tv/70593" }), null);
eq("missing", tmdbIdOf({}), null);

console.log("\ntitle matching (search returns wrong films for common titles)");
const results = [
  { id: "1", showType: "movie", title: "Dune", originalTitle: "Dune", releaseYear: 1984 },
  { id: "2", showType: "movie", title: "Dune", originalTitle: "Dune", releaseYear: 2021 },
  { id: "3", showType: "movie", title: "Dune: Part Two", originalTitle: "Dune: Part Two", releaseYear: 2024 },
  { id: "4", showType: "series", title: "Dune: Prophecy", originalTitle: "Dune: Prophecy", releaseYear: 2024 }
];
eq("year disambiguates 2021 Dune", pickMatch(results, "Dune", 2021)?.id, "2");
eq("year disambiguates 1984 Dune", pickMatch(results, "Dune", 1984)?.id, "1");
eq("exact title wins", pickMatch(results, "Dune: Part Two", 2024)?.id, "3");
eq("a series is never the film", pickMatch(results.slice(3), "Dune: Prophecy", 2024), null);
eq("no plausible match -> null",
   pickMatch([{ id: "9", title: "Completely Different", originalTitle: "Completely Different", releaseYear: 1950 }], "Dune", 2021), null);
eq("empty results -> null", pickMatch([], "Anything", 2000), null);

console.log("\nrecords built from one show object");
const cur = curatedRecord({ t: "The Dark Knight", y: 2008, pop: 3, k: "teen" }, DARK, "2026-11-04", "us");
eq("a curated record keeps the identity it had", [cur.t, cur.y, cur.tmdb, cur.imdb], ["The Dark Knight", 2008, 155, "tt0468569"]);
eq("rating on both scales", [cur.score, cur.rating], [89, 8.9]);
eq("checked tonight, on Max", [cur.providersChecked, cur.checkedAt, cur.providers], [true, "2026-11-04", ["MAX"]]);
eq("hand-written fame rides along for the marquee", cur.pop, 3);
ok("audience and certificate are left to the hand-written row", !("k" in cur) && !("cert" in cur));
ok("tagged by the shared rule", Array.isArray(cur.a) && cur.a.length >= 3);
ok("a streaming film carries no rental lead", !("rentLink" in cur));
const off = curatedRecord({ t: "A Film", y: 2010 }, show({ streamingOptions: { us: [opt("apple", "rent")] } }), "2026-11-04", "us");
eq("checked and on nothing is recorded as such", [off.providers, off.providersChecked], [[], true]);
eq("with somewhere to rent it", off.rentLink, { name: "apple", link: "https://example.com/apple/rent" });

const shelved = shelfRecord(show(), 5, "us");
eq("a scanned film is shelved with the fields the page reads",
   Object.keys(shelved).filter((k) => k !== "_src" && k !== "logos").sort(),
   ["a","backdrop","d","g","h","imdb","k","links","mpaa","pop","poster","posterSm","r","rating","rt","rtSrc","svcs","t","tmdb","y"].sort());
eq("its score is marked as an audience score", [shelved.rt, shelved.rtSrc], [80, "audience"]);
eq("no certificate in the source", shelved.mpaa, "NR");
eq("series are not shelved", shelfRecord(show({ showType: "series" }), 0, "us"), null);
eq("nothing streaming, nothing shelved", shelfRecord(show({ streamingOptions: { us: [] } }), 0, "us"), null);
eq("no still, nothing shelved", shelfRecord(show({ imageSet: { verticalPoster: { w480: "https://x/p.jpg" }, horizontalPoster: {} } }), 0, "us"), null);
eq("a short film is not shelved", shelfRecord(show({ runtime: 40 }), 0, "us"), null);
eq("from the published search: only the films, not the series",
   SEARCH.shows.map((s, i) => shelfRecord(s, i, "us")).filter(Boolean).map((r) => r.t),
   SEARCH.shows.filter((s) => s.showType === "movie").map((s) => s.title));

console.log("\nfame from the scan's popularity order");
eq("top of the list is iconic, then well known, then for film people",
   [fameFromRank(0), fameFromRank(17), fameFromRank(18), fameFromRank(89), fameFromRank(90), fameFromRank(500)],
   [3, 3, 2, 2, 1, 1]);
eq("no rank is the lowest", fameFromRank(undefined), 1);

console.log("\nsynopsis words feed the tags");
eq("phrases found whole", overviewTerms("A heist goes wrong. Twist ending included.").sort(), ["heist", "twist ending"]);
eq("never inside another word", overviewTerms("A glove salesman"), []);
eq("curly apostrophes read like straight ones", overviewTerms("the hero’s journey").includes("hero's journey"), true);
eq("empty synopsis", overviewTerms(""), []);
eq("history reads as drama, music is not a genre here",
   genresFrom([{ id: "history" }, { id: "music" }, { id: "scifi" }]), ["drama", "scifi"]);
eq("a synopsis that says musical makes it one",
   genresFrom([{ id: "comedy" }, { id: "romance" }], ["musical"]), ["comedy", "romance", "musical"]);
eq("a film about musicians is not a musical",
   genresFrom([{ id: "drama" }, { id: "music" }], ["drummer"]), ["drama"]);
const facts = factsOf(show(), "us");
ok("the facts carry the terms they were tagged from", facts._src.terms.includes("conspiracy"));

console.log("\ndiscovered titles must earn their tags");
eq("keywords carry the read",
   deriveAttrs({ genres:["horror"], keywords:["haunting","gore","dystopia"], runtime:95 }).sort(),
   ["bleak","brisk","scary","violent","visceral"].sort());
eq("too thin to shelve",
   deriveAttrs({ genres:[], keywords:[], runtime:0 }), null);
eq("a long film reads as epic",
   deriveAttrs({ genres:["adventure","drama"], keywords:["battle"], runtime:165 }).indexOf("epic") > -1, true);
eq("no duplicate attributes",
   (() => { const a = deriveAttrs({ genres:["horror","thriller"], keywords:["ghost","possession","slasher"], runtime:99 });
            return a.length === new Set(a).size; })(), true);
eq("caps at six",
   deriveAttrs({ genres:["horror","comedy","action","drama","romance","scifi","war"],
                 keywords:["ghost","dark comedy","heist","grief","wedding","space","dystopia"],
                 runtime:95 }).length <= 6, true);
eq("a director's name lends nothing: every film is read on its own data",
   deriveAttrs({ genres:["drama"], keywords:["grief"], runtime:120, dirAttrs:["auteur","visual"] }).indexOf("auteur"), -1);
eq("curated and scanned films go through the same rules",
   tagsFrom({ genres:["drama"], keywords:["grief"], runtime:120 }),
   deriveAttrs({ genres:["drama"], keywords:["grief"], runtime:120 }));

console.log("\nwhat a genre may and may not say");
eq("a crime comedy is not violent just for being filed under crime",
   tagsFrom({ genres:["comedy","crime","mystery"], keywords:["whodunit","murder","family"], runtime:130 }).indexOf("violent"), -1);
eq("an adventure its keywords describe is not spectacle just for being an adventure",
   tagsFrom({ genres:["adventure","comedy","family"], keywords:["whimsical","heartwarming","witty"], runtime:104 }).indexOf("spectacle"), -1);
eq("a thinly described film is filled up to three from its genres, and no further",
   tagsFrom({ genres:["drama"], keywords:[], runtime:120 }), ["characterstudy","earnest"].concat([]).slice(0, 2));
eq("one genre fills two; a second genre fills the third",
   tagsFrom({ genres:["drama","thriller"], keywords:[], runtime:120 }).length, 3);
eq("a film its keywords describe is not overruled by a genre guess",
   tagsFrom({ genres:["drama"], keywords:["hilarious","witty","amused","playful"], runtime:120 }).indexOf("characterstudy"), -1);
eq("keywords match whole, never inside another word",
   tagsFrom({ genres:[], keywords:["glove","lovebirds"], runtime:120 }), []);

console.log("\nsubjects are not moods");
eq("a monster in a family film is not scary",
   tagsFrom({ genres:["animation","family","comedy"], keywords:["monster","ghost"], runtime:92 }).indexOf("scary"), -1);
ok("a monster in a horror film is",
   tagsFrom({ genres:["horror"], keywords:["monster","ghost"], runtime:92 }).indexOf("scary") > -1);
ok("a frightened tone is scary in any genre",
   tagsFrom({ genres:["animation","family"], keywords:["frightened","terrifying"], runtime:92 }).indexOf("scary") > -1);
eq("a gangster in a cartoon is not violence",
   tagsFrom({ genres:["animation","family"], keywords:["gangster","shootout"], runtime:92 }).indexOf("violent"), -1);
ok("a gangster in a crime film is",
   tagsFrom({ genres:["crime","drama"], keywords:["gangster","shootout"], runtime:150 }).indexOf("violent") > -1);


console.log("\nthe HTTP layer, with a fake fetch (no key, no network)");
const reply = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300, statusText: "",
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body
});
const seen = [];
const fake = (queue) => async (url, init) => { seen.push({ url, headers: init.headers }); return queue.shift(); };
eq("the key goes in X-API-Key on the direct API",
   headersFor("https://api.movieofthenight.com/v4/shows/movie/1", "k")["X-API-Key"], "k");
eq("and in X-RapidAPI-Key through RapidAPI",
   headersFor("https://streaming-availability.p.rapidapi.com/shows/movie/1", "k")["X-RapidAPI-Key"], "k");
calls.made = 0; calls.budget = 0;
eq("a 404 is no show, not an error",
   await getJSON("https://api.movieofthenight.com/v4/shows/movie/1", { fetchImpl: fake([reply(404)]), key: "k" }), null);
let refused = "";
try { await getJSON("https://api.movieofthenight.com/v4/x", { fetchImpl: fake([reply(401)]), key: "bad" }); }
catch (e) { refused = e.message; }
ok("a refused key says which variable to check", /STREAMING_AVAILABILITY_KEY/.test(refused));
ok("and never prints the key", !/bad/.test(refused));
calls.made = 0; calls.budget = 2;
let spent = null;
try {
  const q = fake([reply(200, {}), reply(200, {}), reply(200, {})]);
  await getJSON("https://api.movieofthenight.com/v4/a", { fetchImpl: q, key: "k" });
  await getJSON("https://api.movieofthenight.com/v4/b", { fetchImpl: q, key: "k" });
  await getJSON("https://api.movieofthenight.com/v4/c", { fetchImpl: q, key: "k" });
} catch (e) { spent = e; }
ok("the budget is a hard ceiling", spent instanceof BudgetSpent && calls.made === 2);
calls.made = 0; calls.budget = 0;

console.log("\nthe scan");
const u = new URL(scanUrl("prime", "abc", { country: "us", minScore: 61 }));
eq("asks for films on the service's subscription and free catalogs, most popular first",
   ["catalogs","show_type","order_by","order_direction","rating_min","country","cursor"].map((k) => u.searchParams.get(k)),
   ["prime.subscription,prime.free","movie","popularity_alltime","desc","61","us","abc"]);
ok("no cursor on the first page", !new URL(scanUrl("netflix", undefined)).searchParams.has("cursor"));
const pagesSeen = [];
const pager = async (url) => {
  const c = new URL(url).searchParams.get("cursor");
  pagesSeen.push(c);
  if (!c) return { shows: [{ id: "a" }, { id: "b" }], hasMore: true, nextCursor: "p2" };
  if (c === "p2") return { shows: [{ id: "c" }], hasMore: true, nextCursor: "p3" };
  return { shows: [{ id: "d" }], hasMore: false };
};
const got = await scanService("netflix", 9, { getJSON: pager });
eq("follows the cursor until the list ends", pagesSeen, [null, "p2", "p3"]);
eq("each show keeps its place in the list", got.map((r) => [r.show.id, r.rank]), [["a",0],["b",1],["c",2],["d",3]]);
eq("stops at the page limit", (await scanService("netflix", 2, { getJSON: pager })).length, 3);
const flaky = async (url) => { if (new URL(url).searchParams.get("cursor") === "p2") throw new Error("500"); return pager(url); };
eq("a bad later page keeps the earlier ones", (await scanService("netflix", 9, { getJSON: flaky })).length, 2);
let first = null;
try { await scanService("netflix", 9, { getJSON: async () => { throw new Error("500"); } }); } catch (e) { first = e; }
ok("a bad first page is a failed service", first && /500/.test(first.message));
let mid = null;
try { await scanService("netflix", 9, { getJSON: async (url) => { if (new URL(url).searchParams.get("cursor")) throw new BudgetSpent(); return pager(url); } }); }
catch (e) { mid = e; }
ok("running out of budget part way is not a short list", mid instanceof BudgetSpent);

console.log("\nround the services and the films over several nights");
eq("never-read services first, then the oldest",
   scanOrder({ NFX: "2026-11-03", MAX: "2026-11-01", HUL: "2026-11-04", DIS: "2026-11-02", PRV: "2026-11-04", APL: "2026-11-04", PAR: "2026-11-04" }).slice(0, 4),
   ["peacock", "hbo", "disney", "netflix"]);
const prev = new Map([["B::2001", { checkedAt: "2026-11-01" }], ["C::2002", { checkedAt: "2026-10-20" }]]);
eq("films never checked first, then the least recently checked",
   checkOrder([{ t: "B", y: 2001 }, { t: "C", y: 2002 }, { t: "A", y: 2000 }], prev).map((f) => f.t), ["A", "C", "B"]);

console.log("\ngenre and audience rules");

eq("PG-13 is a teen room", audienceFrom("PG-13", ["action"]), "teen");
eq("R is grown-ups", audienceFrom("R", ["drama"]), "adult");
eq("unrated horror is not for kids", audienceFrom(null, ["horror"]), "adult");
eq("unrated animation is", audienceFrom(null, ["animation"]), "all");

console.log("\nRotten Tomatoes extraction from OMDb");
eq("reads the RT entry", rtFromOmdb({ Ratings: [
   { Source: "Internet Movie Database", Value: "8.8/10" },
   { Source: "Rotten Tomatoes", Value: "87%" },
   { Source: "Metacritic", Value: "74/100" }]}), 87);
eq("absent RT -> null", rtFromOmdb({ Ratings: [{ Source: "Metacritic", Value: "74/100" }] }), null);
eq("no Ratings key -> null", rtFromOmdb({}), null);

console.log("\nOMDb failure reporting (it returns errors in the BODY with HTTP 401)");
eq("invalid key is reported, not swallowed",
   (await readOmdbPayload({status:401}, JSON.stringify({Response:"False",Error:"Invalid API key!"}))).error,
   "Invalid API key!");
eq("unactivated key surfaces its reason",
   (await readOmdbPayload({status:401}, JSON.stringify({Response:"False",Error:"No API key provided."}))).error,
   "No API key provided.");
eq("rate limit surfaces",
   (await readOmdbPayload({status:401}, JSON.stringify({Response:"False",Error:"Request limit reached!"}))).error,
   "Request limit reached!");
eq("a good response yields the score",
   (await readOmdbPayload({status:200}, JSON.stringify({Response:"True",
      Ratings:[{Source:"Rotten Tomatoes",Value:"93%"}]}))).rt, 93);
eq("a good response has no error",
   (await readOmdbPayload({status:200}, JSON.stringify({Response:"True",
      Ratings:[{Source:"Rotten Tomatoes",Value:"93%"}]}))).error, null);
eq("title with no RT entry is explained",
   (await readOmdbPayload({status:200}, JSON.stringify({Response:"True",Ratings:[]}))).error,
   "no Rotten Tomatoes entry for this title");
eq("non-JSON error page still reports",
   (await readOmdbPayload({status:503}, "<html>down</html>")).error.startsWith("HTTP 503"), true);

console.log("\ncatalog parsing from index.html");
const html = await readFile(join(ROOT, "index.html"), "utf8");
const films = parseCatalog(html);
eq("parses every row", films.length, 245);   /* hand-authored seed; discovery adds on top */
eq("keys named by COLS", Object.keys(films[0]).sort().join(","),
   "a,d,g,h,k,mpaa,pop,r,rt,s,t,y");
eq("first title", films[0].t, "The Godfather");
eq("hand-authored attributes survive", Array.isArray(films[0].a) || typeof films[0].a === "string", true);
const dupes = films.map(f => f.t).filter((t, i, arr) => arr.indexOf(t) !== i);
eq("no duplicate titles", dupes, []);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
