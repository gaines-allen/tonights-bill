/**
 * Offline tests for the enrichment transforms.
 * Fixtures mirror the response shapes documented at developer.themoviedb.org.
 * Run: node scripts/enrich.test.mjs
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { serviceCode, parseCatalog, pickMatch, usCertification, flatrateCodes, rtFromOmdb }
  from "./enrich.mjs";

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

console.log("\ncatalog parsing from index.html");
const html = await readFile(join(ROOT, "index.html"), "utf8");
const films = parseCatalog(html);
eq("parses every row", films.length, 244);
eq("keys named by COLS", Object.keys(films[0]).sort().join(","),
   "a,d,g,h,k,mpaa,pop,r,rt,s,t,y");
eq("first title", films[0].t, "The Godfather");
eq("hand-authored attributes survive", Array.isArray(films[0].a) || typeof films[0].a === "string", true);
const dupes = films.map(f => f.t).filter((t, i, arr) => arr.indexOf(t) !== i);
eq("no duplicate titles", dupes, []);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
