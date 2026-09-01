/**
 * Offline tests for the enrichment transforms.
 * Fixtures mirror the response shapes documented at developer.themoviedb.org.
 * Run: node scripts/enrich.test.mjs
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { serviceCode, parseCatalog, pickMatch, usCertification, flatrateCodes, logoPaths, rtFromOmdb,
         deriveAttrs, softenForKids, audienceFrom, fameFrom, directorAttrs,
         readOmdbPayload } from "./enrich.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};

console.log("\nservice name mapping (TMDB display names drift a lot)");
eq("Netflix",                     serviceCode("Netflix"), "NFX");
eq("Netflix Standard with Ads",   serviceCode("Netflix Standard with Ads"), "NFX");
eq("Max",                         serviceCode("Max"), "MAX");
eq("HBO Max",                     serviceCode("HBO Max"), "MAX");
eq("Max Amazon Channel",          serviceCode("Max Amazon Channel"), "MAX");
eq("Cinemax is NOT Max",          serviceCode("Cinemax"), null);
eq("Disney Plus",                 serviceCode("Disney Plus"), "DIS");
eq("Disney+",                     serviceCode("Disney+"), "DIS");
eq("Amazon Prime Video",          serviceCode("Amazon Prime Video"), "PRV");
eq("Prime Video",                 serviceCode("Prime Video"), "PRV");
eq("Apple TV+",                   serviceCode("Apple TV+"), "APL");
eq("Apple TV (store) is not APL", serviceCode("Apple TV"), null);
eq("Paramount Plus",              serviceCode("Paramount Plus"), "PAR");
eq("Paramount+ Apple TV Channel", serviceCode("Paramount+ Apple TV Channel"), "PAR");
eq("Peacock Premium",             serviceCode("Peacock Premium"), "PCK");
eq("unknown service",             serviceCode("Tubi"), null);

console.log("\nUS certification extraction");
const rel = { id: 550, results: [
  { iso_3166_1: "GB", release_dates: [{ certification: "18", type: 3 }] },
  { iso_3166_1: "US", release_dates: [
      { certification: "",     type: 1 },
      { certification: "R",    type: 3, release_date: "1999-10-15T00:00:00.000Z" },
      { certification: "R",    type: 4 }
  ]}
]};
eq("prefers US theatrical", usCertification(rel), "R");
eq("falls back to digital when no theatrical",
   usCertification({ results: [{ iso_3166_1: "US", release_dates: [{ certification: "PG-13", type: 4 }] }] }), "PG-13");
eq("no US block -> null",
   usCertification({ results: [{ iso_3166_1: "FR", release_dates: [{ certification: "12", type: 3 }] }] }), null);
eq("empty certs -> null",
   usCertification({ results: [{ iso_3166_1: "US", release_dates: [{ certification: "", type: 3 }] }] }), null);

console.log("\nstreaming providers (flatrate only — rent/buy must not count)");
const prov = { id: 550, results: { US: {
  link: "https://www.themoviedb.org/movie/550/watch?locale=US",
  flatrate: [{ provider_name: "Hulu", provider_id: 15 }, { provider_name: "Netflix", provider_id: 8 }],
  rent:     [{ provider_name: "Apple TV", provider_id: 2 }],
  buy:      [{ provider_name: "Amazon Video", provider_id: 10 }],
  ads:      []
}}};
eq("subscription only", flatrateCodes(prov).sort(), ["HUL","NFX"]);
eq("no US region -> []", flatrateCodes({ results: { GB: { flatrate: [{ provider_name: "Netflix" }] } } }), []);
eq("missing results -> []", flatrateCodes({}), []);
eq("dedupes repeats",
   flatrateCodes({ results: { US: { flatrate: [
     { provider_name: "Netflix" }, { provider_name: "Netflix Standard with Ads" }] } } }), ["NFX"]);

console.log("\ndiscovered titles must earn their tags");
eq("keywords carry the read",
   deriveAttrs({ genres:["horror"], keywords:["haunting","gore","dystopia"], runtime:95 }).sort(),
   ["bleak","brisk","scary","violent"].sort());
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
eq("a known director lends his read",
   deriveAttrs({ genres:["drama"], keywords:["grief"], runtime:120, dirAttrs:["auteur","visual"] }).indexOf("auteur") > -1, true);

console.log("\na children's certificate cannot carry a harsh tag");
eq("G strips scary — Monsters, Inc. is not a horror film",
   softenForKids(["scary","visual","comic","cozy"], "G"), ["visual","comic","cozy"]);
eq("PG strips violent — a cartoon heist is not violence",
   softenForKids(["violent","practical","visual","comic","cozy"], "PG"),
   ["practical","visual","comic","cozy"]);
eq("R is left exactly as it was",
   softenForKids(["violent","bleak","slowburn"], "R"), ["violent","bleak","slowburn"]);
eq("an unrated film is left alone rather than guessed at",
   softenForKids(["bleak","cerebral","propulsive"], "NR"), ["bleak","cerebral","propulsive"]);
eq("crime no longer implies violence",
   deriveAttrs({ genres:["crime","comedy","family"], keywords:["heist"], runtime:95 })
     .indexOf("violent"), -1);
eq("science fiction no longer implies cerebral",
   deriveAttrs({ genres:["scifi","action","family"], keywords:["battle"], runtime:99 })
     .indexOf("cerebral"), -1);
eq("a PG film loses scary even when the keywords earn it",
   (deriveAttrs({ genres:["family","animation","comedy"], keywords:["monster","ghost"],
                  runtime:92, cert:"PG" }) || []).indexOf("scary"), -1);
eq("softening below three tags leaves the film off the shelf",
   deriveAttrs({ genres:["horror"], keywords:["gore","slasher"], runtime:120, cert:"PG" }), null);
eq("an R-rated horror still earns its tags",
   deriveAttrs({ genres:["horror"], keywords:["gore","haunting"], runtime:95, cert:"R" })
     .sort(), ["brisk","scary","violent"].sort());

eq("PG-13 is a teen room", audienceFrom("PG-13", ["action"]), "teen");
eq("R is grown-ups", audienceFrom("R", ["drama"]), "adult");
eq("unrated horror is not for kids", audienceFrom(null, ["horror"]), "adult");
eq("unrated animation is", audienceFrom(null, ["animation"]), "all");

eq("vote count sets fame", [fameFrom(20000), fameFrom(5000), fameFrom(100)], [3, 2, 1]);

eq("director opinions come from the curated rows",
   directorAttrs([{ d:"Ari Aster", a:"scary|bleak" }, { d:"Ari Aster", a:"scary|weird" }])["Ari Aster"][0],
   "scary");

console.log("\nprovider logos (the real marks, taken from the same response)");
const provLogo = { results: { US: {
  flatrate: [{ provider_name: "Netflix", logo_path: "/net.jpg" },
             { provider_name: "Hulu", logo_path: "/hul.jpg" }],
  rent:     [{ provider_name: "Apple TV", logo_path: "/rent.jpg" }]
}}};
eq("logos for subscription services only", logoPaths(provLogo), { NFX: "/net.jpg", HUL: "/hul.jpg" });
eq("no US region -> {}", logoPaths({ results: { GB: { flatrate: [{ provider_name: "Netflix", logo_path: "/x.jpg" }] } } }), {});
eq("missing logo_path is skipped", logoPaths({ results: { US: { flatrate: [{ provider_name: "Netflix" }] } } }), {});

console.log("\ntitle matching (search returns wrong films for common titles)");
const results = [
  { id: 1, title: "Dune",           original_title: "Dune", release_date: "1984-12-14", popularity: 30 },
  { id: 2, title: "Dune",           original_title: "Dune", release_date: "2021-09-15", popularity: 120 },
  { id: 3, title: "Dune: Part Two", original_title: "Dune: Part Two", release_date: "2024-02-27", popularity: 200 }
];
eq("year disambiguates 2021 Dune", pickMatch(results, "Dune", 2021)?.id, 2);
eq("year disambiguates 1984 Dune", pickMatch(results, "Dune", 1984)?.id, 1);
eq("exact title wins over popularity", pickMatch(results, "Dune: Part Two", 2024)?.id, 3);
eq("no plausible match -> null",
   pickMatch([{ id: 9, title: "Completely Different", original_title: "Completely Different",
                release_date: "1970-01-01", popularity: 1 }], "Casablanca", 1942), null);
eq("empty results -> null", pickMatch([], "Anything", 2000), null);

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
