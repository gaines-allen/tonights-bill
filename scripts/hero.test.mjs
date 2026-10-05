/**
 * The monthly marquee selection: stable inside a month, rotating at the
 * boundary (as Chicago reads the calendar), honest about thin data, and
 * patient with a broken refresh.
 *
 *   node scripts/hero.test.mjs
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decide, monthIn, candidates, ranked, qualifies, RULE } from "./hero.mjs";
import { ROOT, eq, ok, finish } from "./harness.mjs";

const film = (id, rating, votes, providers, extra = {}) => ({
  t: "Film " + id, y: 2000 + (id % 20), ok: true, tmdb: id,
  rating, votes, backdrop: "/b" + id + ".jpg",
  providers, providersChecked: true, ...extra
});
const catalog = (films, shelf = [], meta = {}) => ({
  _meta: { matched: films.length, withProviders: films.filter((f) => f.providers?.length).length,
           scanOk: true, scannedAt: "2026-10-04", ...meta },
  films, shelf
});
/* six good films, ranked 1..6 by rating, plus some that fail one test each */
const GOOD = [
  film(1, 8.9, 9000, ["NFX"]), film(2, 8.8, 9000, ["MAX"]), film(3, 8.7, 9000, ["HUL"]),
  film(4, 8.6, 9000, ["DIS"]), film(5, 8.5, 9000, ["PRV"]), film(6, 8.4, 9000, ["APL"])
];
const BAD = [
  film(20, 9.5, 499, ["NFX"]),                         // too few votes
  film(21, 7.49, 90000, ["NFX"]),                      // just under the bar
  film(22, 9.0, 9000, []),                             // checked, streams nowhere
  film(23, 9.0, 9000, ["NFX"], { backdrop: null }),    // no verified backdrop
  film(24, 9.0, null, ["NFX"]),                        // votes missing: never guessed
  film(25, 9.0, 9000, ["STARZ"])                       // not a supported service
];
const C = catalog(GOOD.concat(BAD));
const ids = (m) => m.films.map((f) => f.id);

console.log("\nthe calendar is Chicago's");
eq("11pm Central on Oct 31 is still October", monthIn(new Date("2026-11-01T04:00:00Z")), "2026-10");
eq("an hour later it is November", monthIn(new Date("2026-11-01T05:30:00Z")), "2026-11");
eq("the zone is fixed in the rule", RULE.timeZone, "America/Chicago");

console.log("\neligibility");
const pool = candidates(C);
eq("only the six good films qualify", ranked(pool).map((c) => c.id), [1, 2, 3, 4, 5, 6]);
ok("499 votes is not enough", !qualifies(pool.get(20)));
ok("7.49 is not 7.5", !qualifies(pool.get(21)));
ok("checked and streaming nowhere is out", !qualifies(pool.get(22)));
ok("no backdrop is out", !qualifies(pool.get(23)));
ok("missing votes are not invented", !qualifies(pool.get(24)) && pool.get(24).votes === null);
ok("an unsupported service does not count", !qualifies(pool.get(25)));
const tie = candidates(catalog([film(9, 8, 1000, ["NFX"]), film(8, 8, 1000, ["NFX"]), film(7, 8, 2000, ["NFX"])]));
eq("ties go to votes, then the lower TMDB id", ranked(tie).map((c) => c.id), [7, 8, 9]);
const rounded = candidates(catalog([{ ...film(30, undefined, 900, ["NFX"]), tmdbScore: 81 }]));
eq("an older refresh's rounded score reads back on the same scale", rounded.get(30).rating, 8.1);
ok("and says it was rounded", rounded.get(30).ratingRounded === true);

console.log("\nfirst selection");
const oct = decide({ catalog: C, previous: null, now: new Date("2026-10-04T16:00:00Z") });
eq("the top three by rating", ids(oct.manifest), [1, 2, 3]);
eq("for this month", oct.manifest.month, "2026-10");
eq("in left, middle, right slots", oct.manifest.films.map((f) => f.slot), ["left", "middle", "right"]);
ok("carries the evidence: rating, votes, services, backdrop",
   oct.manifest.films.every((f) => f.rating && f.votes && f.services.length && f.backdrop));
eq("names its rating source", /TMDB/.test(oct.manifest.ratingSource), true);
eq("and its region", oct.manifest.region, "US");

console.log("\nstable within the month");
const later = decide({ catalog: C, previous: oct.manifest, now: new Date("2026-10-28T16:00:00Z") });
ok("a later night in October changes nothing", !later.changed);
eq("same three", ids(later.manifest), [1, 2, 3]);
/* even if a better film turns up mid-month */
const better = catalog(GOOD.concat([film(99, 9.9, 99999, ["NFX"])]));
const mid = decide({ catalog: better, previous: oct.manifest, now: new Date("2026-10-20T16:00:00Z") });
ok("a better film arriving mid-month waits for November", !mid.changed && !ids(mid.manifest).includes(99));

console.log("\nrotates at the boundary");
const nov = decide({ catalog: C, previous: oct.manifest, now: new Date("2026-11-01T12:00:00Z") });
ok("November chooses again", nov.changed);
eq("and skips October's three", ids(nov.manifest), [4, 5, 6]);
eq("remembering what it skipped", nov.manifest.previous.ids, [1, 2, 3]);
const halloween = decide({ catalog: C, previous: oct.manifest, now: new Date("2026-11-01T04:30:00Z") });
ok("but not at 11:30pm Central on Halloween", !halloween.changed);

console.log("\nthin data relaxes repeats, never the bar");
const four = catalog(GOOD.slice(0, 4).concat(BAD));
const thin = decide({ catalog: four, previous: oct.manifest, now: new Date("2026-11-02T12:00:00Z") });
eq("one new film plus two repeats", ids(thin.manifest), [4, 1, 2]);
ok("flagged as a relaxed month", thin.manifest.repeatsAllowed === true);
ok("no film under the bar crept in", thin.manifest.films.every((f) => f.rating >= 7.5 && f.votes >= 500));
const two = catalog(GOOD.slice(0, 2).concat(BAD));
const short = decide({ catalog: two, previous: oct.manifest, now: new Date("2026-12-01T12:00:00Z") });
ok("two qualifiers: nothing incomplete is published", !short.changed);
eq("the last valid set stays", ids(short.manifest), [1, 2, 3]);
const none = decide({ catalog: two, previous: null, now: new Date("2026-12-01T12:00:00Z") });
eq("and with no set yet, nothing is written at all", none.manifest, null);

console.log("\na failed refresh keeps the last valid set");
for (const [label, cat] of [
  ["no catalog at all", null],
  ["an empty catalog", { _meta: {}, films: [], shelf: [] }],
  ["a run that matched nothing", catalog(GOOD, [], { matched: 0 })],
  ["a run that found no streaming homes", catalog(GOOD.map((f) => ({ ...f, providers: [] })), [], { withProviders: 0 })]
]) {
  const out = decide({ catalog: cat, previous: oct.manifest, now: new Date("2026-11-03T12:00:00Z") });
  ok(label + ": unchanged", !out.changed && ids(out.manifest).join() === "1,2,3");
}

console.log("\nreplaces only a film that stops streaming");
const left = catalog(GOOD.map((f) => f.tmdb === 2 ? { ...f, providers: [] } : f));
const swap = decide({ catalog: left, previous: oct.manifest, now: new Date("2026-10-15T12:00:00Z") });
ok("the change is written", swap.changed);
eq("the middle slot takes the next eligible film; the others stay", ids(swap.manifest), [1, 4, 3]);
eq("in the same slot", swap.manifest.films[1].slot, "middle");
eq("and the swap is recorded", swap.manifest.replacements.map((r) => [r.out, r.in]), [[2, 4]]);
eq("the month's selection time is unchanged", swap.manifest.selectedAt, oct.manifest.selectedAt);
const moved = catalog(GOOD.map((f) => f.tmdb === 3 ? { ...f, providers: ["PCK"] } : f));
const hop = decide({ catalog: moved, previous: oct.manifest, now: new Date("2026-10-15T12:00:00Z") });
eq("a film that moved services keeps its slot", ids(hop.manifest), [1, 2, 3]);
eq("with its new home recorded", hop.manifest.films[2].services, ["PCK"]);
const unmatched = catalog(GOOD.map((f) => f.tmdb === 1 ? { ...f, ok: false } : f));
const blip = decide({ catalog: unmatched, previous: oct.manifest, now: new Date("2026-10-15T12:00:00Z") });
ok("a curated film that failed to match tonight is not treated as gone", !blip.changed);
const shelfSet = decide({ catalog: catalog([film(40, 6.0, 9000, ["NFX"])], [{ tmdb: 50, t: "A", y: 2020, rating: 8, votes: 900, backdrop: "/a", svcs: ["NFX"] },
  { tmdb: 51, t: "B", y: 2020, rating: 8, votes: 800, backdrop: "/b", svcs: ["NFX"] },
  { tmdb: 52, t: "C", y: 2020, rating: 8, votes: 700, backdrop: "/c", svcs: ["NFX"] },
  { tmdb: 53, t: "D", y: 2020, rating: 8, votes: 600, backdrop: "/d", svcs: ["NFX"] }], { matched: 1, withProviders: 1 }),
  previous: null, now: new Date("2026-10-04T12:00:00Z") });
eq("shelved titles with real votes qualify too", ids(shelfSet.manifest), [50, 51, 52]);
const shelfLeft = { ...catalog([film(40, 6.0, 9000, ["NFX"]), film(1, 8.9, 9000, ["NFX"])], [
  { tmdb: 50, t: "A", y: 2020, rating: 8, votes: 900, backdrop: "/a", svcs: ["NFX"] },
  { tmdb: 52, t: "C", y: 2020, rating: 8, votes: 700, backdrop: "/c", svcs: ["NFX"] },
  { tmdb: 53, t: "D", y: 2020, rating: 8, votes: 600, backdrop: "/d", svcs: ["NFX"] }]) };
const dropped = decide({ catalog: shelfLeft, previous: shelfSet.manifest, now: new Date("2026-10-20T12:00:00Z") });
eq("a shelved film that fell off every service is replaced in place", ids(dropped.manifest), [50, 1, 52]);

console.log("\nthe committed manifest");
const real = JSON.parse(await readFile(join(ROOT, "data/hero.json"), "utf8"));
eq("holds exactly three films", real.films.length, 3);
eq("all distinct", new Set(real.films.map((f) => f.id)).size, 3);
ok("each meets the bar on the evidence it records",
   real.films.every((f) => f.rating >= 7.5 && f.votes >= 500 && f.backdrop && f.services.length));
ok("each on a supported service", real.films.every((f) => f.services.every((s) => RULE.services.includes(s))));
const realCat = JSON.parse(await readFile(join(ROOT, "data/catalog.json"), "utf8"));
const again = decide({ catalog: realCat, previous: real, now: new Date(real.selectedAt) });
ok("re-running against tonight's catalog in the same month keeps it", !again.changed || ids(again.manifest).join() === ids(real).join());

finish();
