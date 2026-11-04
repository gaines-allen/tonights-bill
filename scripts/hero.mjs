#!/usr/bin/env node
/**
 * The three films behind the marquee, chosen once a month.
 *
 *   node scripts/hero.mjs            reads data/catalog.json, writes data/hero.json
 *   node scripts/hero.mjs --now 2026-11-01T12:00:00Z   pretend it is another day
 *
 * Runs after the nightly catalog refresh and needs no key of its own: every
 * fact it uses is already in data/catalog.json, sourced that night from Movie
 * of the Night's Streaming Availability API.
 *
 * The rule, as briefed:
 *   - the month is decided in America/Chicago, so a 7pm Central refresh on the
 *     31st does not start next month early;
 *   - a candidate needs a verified backdrop, an audience rating of 7.5 or
 *     more out of 10, a fame of at least 2 (well known, so the marquee is never
 *     three films nobody has heard of), and a subscription home on one of the
 *     services the app supports, in the US;
 *   - one rating source for everyone (the source's 0-100 rating, read on a
 *     0-10 scale). Rotten Tomatoes percentages are a different scale and never
 *     enter the ranking. The source publishes no vote counts, so fame (hand
 *     written for curated films, popularity rank for scanned ones) stands in
 *     for "enough people have seen it";
 *   - rank by rating, then fame, then TMDB id, so the order is total and the
 *     same data always gives the same three;
 *   - a new month skips last month's three while there are enough others, and
 *     only after that would a repeat be allowed. The thresholds never weaken;
 *   - within a month the set holds. The nightly run only re-checks that each
 *     film still streams somewhere supported, and replaces a slot that has
 *     left every service with the next eligible film, keeping the other two;
 *   - if the catalog looks broken, or three good films cannot be found, the
 *     last valid set stays up. Nothing incomplete or invented is published.
 *
 * The file is rewritten only when the selection or its evidence changes, so a
 * quiet night commits nothing.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const RULE = Object.freeze({
  minRating: 7.5,
  minFame: 2,
  timeZone: "America/Chicago",
  region: "US",
  services: ["NFX", "MAX", "HUL", "DIS", "PRV", "APL", "PAR", "PCK"]
});
export const RATING_SOURCE = "Movie of the Night audience rating (0-100, read as 0-10) with the catalog's fame";
const SLOTS = ["left", "middle", "right"];

/* "2026-10" for any instant, as the calendar reads in Chicago. */
export function monthIn(date, timeZone = RULE.timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" })
    .formatToParts(date);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  return `${y}-${m}`;
}

/* Every film the catalog knows, curated and shelved, as one comparable record.
   Identity is the TMDB id: the same film can arrive under two display titles
   ("Star Wars" and "Star Wars: A New Hope"), and two films can share one. */
export function candidates(catalog) {
  const out = new Map();
  const take = (rec) => {
    if (!rec.id || out.has(rec.id)) return;
    out.set(rec.id, rec);
  };
  for (const f of catalog?.films || []) {
    if (!f || !f.ok || !f.tmdb) continue;
    take(record(f.tmdb, f.t, f.y, f.backdrop, f.rating, f.score ?? f.tmdbScore, f.pop,
      f.providersChecked ? (f.providers || []) : null));
  }
  for (const f of catalog?.shelf || []) {
    if (!f || !f.tmdb) continue;
    take(record(f.tmdb, f.t, f.y, f.backdrop, f.rating, null, f.pop, f.svcs || []));
  }
  return out;
}

/* rating: the 0-10 rating when the refresh recorded it, otherwise the 0-100
   score read back to the same scale. fame is never guessed: a record without
   it cannot qualify. */
function record(id, title, year, backdrop, rating, score, fame, services) {
  let r = null, rounded = false;
  if (typeof rating === "number" && isFinite(rating)) r = rating;
  else if (typeof score === "number" && isFinite(score)) { r = score / 10; rounded = true; }
  return {
    id, key: `${title} (${year})`, title, year,
    backdrop: typeof backdrop === "string" && backdrop ? backdrop : null,
    rating: r, ratingRounded: rounded,
    fame: typeof fame === "number" && isFinite(fame) ? fame : null,
    services: Array.isArray(services) ? services.filter((s) => RULE.services.includes(s)) : null
  };
}

export function streams(c) { return !!(c && c.services && c.services.length); }

export function qualifies(c) {
  return !!(c && c.backdrop && streams(c) &&
    c.rating !== null && c.rating >= RULE.minRating &&
    c.fame !== null && c.fame >= RULE.minFame);
}

export function ranked(pool) {
  return [...pool.values()].filter(qualifies).sort((a, b) =>
    (b.rating - a.rating) || (b.fame - a.fame) || (a.id - b.id));
}

/* Is this a catalog worth deciding anything on? A refresh that matched
   nothing, or found no streaming homes at all, is an outage, not news. */
export function healthy(catalog) {
  const m = catalog?._meta || {};
  if (!Array.isArray(catalog?.films) || !catalog.films.length) return false;
  if ((m.matched || 0) === 0) return false;
  if ((m.withProviders || 0) === 0) return false;
  return true;
}

function evidence(c, slot) {
  return {
    slot, id: c.id, key: c.key, title: c.title, year: c.year,
    backdrop: c.backdrop,
    rating: c.rating, ...(c.ratingRounded ? { ratingRounded: true } : {}),
    fame: c.fame, services: c.services.slice()
  };
}

/**
 * The whole decision, pure. `previous` is the manifest already published (or
 * null), `now` a Date. Returns {manifest, changed, reason}; `manifest` is
 * whatever should be on disk afterwards, which is `previous` untouched when
 * nothing may change.
 */
export function decide({ catalog, previous, now }) {
  const month = monthIn(now);
  const keep = (reason) => ({ manifest: previous || null, changed: false, reason });

  if (!healthy(catalog)) return keep("catalog unavailable or unhealthy; keeping the last valid set");
  const pool = candidates(catalog);
  const order = ranked(pool);

  const base = {
    version: 1,
    region: RULE.region,
    timeZone: RULE.timeZone,
    ratingSource: RATING_SOURCE,
    rule: {
      minRating: RULE.minRating, minFame: RULE.minFame,
      rank: "rating desc, then fame desc, then TMDB id asc",
      services: RULE.services, monetization: "subscription or free on the service itself, US"
    },
    catalogScannedAt: catalog._meta?.scannedAt || null,
    imageSource: "Movie of the Night"
  };

  /* ---- same month: hold the set, re-check availability only ---- */
  if (previous && previous.month === month && Array.isArray(previous.films) && previous.films.length === 3) {
    const scanOk = catalog._meta?.scanOk !== false;
    /* A curated film is always listed; one missing from tonight's pool just
       failed to match this run, which says nothing about where it streams. */
    const curated = new Set((catalog.films || []).map((f) => f && f.tmdb).filter(Boolean));
    const inSet = new Set(previous.films.map((f) => f.id));
    const avoid = new Set([...(previous.previous?.ids || []), ...inSet]);
    const replacements = (previous.replacements || []).slice();
    let changed = false;
    const films = previous.films.map((old, i) => {
      const cur = pool.get(old.id);
      let gone;
      if (cur) gone = cur.services !== null && !streams(cur);
      else gone = scanOk && !curated.has(old.id);   /* a shelved film drops out when it leaves every service */
      if (!gone) {
        if (!cur || cur.services === null) return old;          /* unknown tonight: leave it be */
        if (JSON.stringify(cur.services) === JSON.stringify(old.services)) return old;
        changed = true;                                         /* still streaming, somewhere new */
        return { ...old, services: cur.services.slice() };
      }
      const next = order.find((c) => !avoid.has(c.id)) || order.find((c) => !inSet.has(c.id));
      if (!next) return old;                 /* nothing to swap in: keep what is up */
      avoid.add(next.id); inSet.add(next.id);
      changed = true;
      replacements.push({ at: now.toISOString(), slot: old.slot || SLOTS[i], out: old.id, in: next.id,
                          reason: "left every supported subscription service" });
      return evidence(next, old.slot || SLOTS[i]);
    });
    if (!changed) return keep("same month; all three still streaming");
    return {
      manifest: { ...previous, ...base, month, films, replacements },
      changed: true, reason: "same month; replaced a film that stopped streaming or refreshed its services"
    };
  }

  /* ---- a new month (or no set yet): choose three ---- */
  const last = new Set((previous?.films || []).map((f) => f.id));
  let pick = order.filter((c) => !last.has(c.id)).slice(0, 3);
  let relaxed = false;
  if (pick.length < 3) {
    /* Relax the repeat rule before anything else; never the thresholds. */
    pick = pick.concat(order.filter((c) => last.has(c.id))).slice(0, 3);
    relaxed = true;
  }
  if (pick.length < 3) return keep(`only ${pick.length} films qualify; keeping the last valid set`);

  return {
    manifest: {
      ...base,
      month,
      selectedAt: now.toISOString(),
      previous: previous && previous.films ? { month: previous.month, ids: previous.films.map((f) => f.id) } : null,
      repeatsAllowed: relaxed,
      films: pick.map((c, i) => evidence(c, SLOTS[i])),
      replacements: []
    },
    changed: true,
    reason: previous ? `new month ${month}` : `first selection for ${month}`
  };
}

/* ---------------------------------------------------------------- CLI */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
async function readJSON(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}
async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--now");
  const now = at > -1 ? new Date(args[at + 1]) : new Date();
  if (isNaN(now.getTime())) throw new Error("--now needs an ISO date");
  const catalog = await readJSON(join(ROOT, "data/catalog.json"));
  const previous = await readJSON(join(ROOT, "data/hero.json"));
  const out = decide({ catalog, previous, now });
  console.log(`hero: ${out.reason}`);
  if (out.manifest && out.manifest.films) {
    out.manifest.films.forEach((f) => console.log(`  ${f.slot.padEnd(6)} ${f.title} (${f.year})  ${f.rating}/10, fame ${f.fame}  ${f.services.join(" ")}`));
  }
  if (out.changed) await writeFile(join(ROOT, "data/hero.json"), JSON.stringify(out.manifest, null, 1) + "\n");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
