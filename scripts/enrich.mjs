#!/usr/bin/env node
/**
 * Enrich the hand-authored catalog with sourced data.
 *
 * What stays hand-authored: the attribute tags, the one-line hook, the fame
 * rating, the audience call. No API knows how a film *plays*, and that is what
 * the recommender actually scores on.
 *
 * What this replaces with sourced values: runtime, MPAA certification, critic
 * score, poster art, and which services actually carry it right now.
 *
 *   TMDB_TOKEN=<v4 read token>  node scripts/enrich.mjs
 *   TMDB_API_KEY=<v3 key>       node scripts/enrich.mjs --limit 10
 *   OMDB_KEY=<key>              (optional — adds real Rotten Tomatoes scores)
 *
 * Writes data/catalog.json. The page falls back to its built-in catalog when
 * that file is absent, so index.html keeps working as a standalone file.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMDB = "https://api.themoviedb.org/3";
const REGION = process.env.REGION || "US";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i === -1 ? d : (args[i + 1] ?? true);
};
const LIMIT = Number(flag("--limit", 0)) || 0;
const CONCURRENCY = Number(flag("--concurrency", 6));
const VERBOSE = args.includes("--verbose");
const NO_DISCOVER   = args.includes("--no-discover");
const PAGES         = Number(flag("--pages", 9));        /* per service, 20 titles a page */
const MIN_VOTES     = Number(flag("--min-votes", 400));  /* enough that someone has seen it */
const MIN_SCORE     = Number(flag("--min-score", 6.1));
const MAX_SHELF     = Number(flag("--max-shelf", 900));  /* ceiling on discovered titles */

const TOKEN = process.env.TMDB_TOKEN || "";
const APIKEY = process.env.TMDB_API_KEY || "";
const OMDB = process.env.OMDB_KEY || "";

/* ---------------- service mapping ----------------
   TMDB returns display names that drift ("Netflix Standard with Ads",
   "Max Amazon Channel"). Match on how the name STARTS so resold channels
   still map to the parent service, and so "Cinemax" never becomes "Max". */
const SERVICE_RULES = [
  [/^netflix\b/i,               "NFX"],
  [/^(hbo\s+)?max\b/i,          "MAX"],
  [/^hulu\b/i,                  "HUL"],
  [/^disney\s*\+?\s*(plus)?\b/i,"DIS"],
  [/^(amazon\s+)?prime\s+video\b/i, "PRV"],
  [/^apple\s*tv\s*\+/i,         "APL"],
  [/^apple\s*tv\s+plus\b/i,     "APL"],
  [/^paramount\s*\+?\s*(plus)?\b/i, "PAR"],
  [/^peacock\b/i,               "PCK"]
];
export function serviceCode(name) {
  if (!name) return null;
  for (const [re, code] of SERVICE_RULES) if (re.test(name.trim())) return code;
  return null;
}

/* ---------------- catalog parsing ----------------
   index.html holds the hand-authored catalog as a JS array literal. Pull the
   rows out rather than duplicating them into a second file that can drift. */
export function parseCatalog(html) {
  const m = html.match(/const RAW = \[([\s\S]*?)\n\];/);
  if (!m) throw new Error("Could not find the RAW catalog array in index.html");
  const rows = new Function("return [" + m[1] + "]")();
  const colsM = html.match(/const COLS = (\[[^\]]*\]);/);
  const cols = colsM ? JSON.parse(colsM[1].replace(/'/g, '"')) : [];
  return rows.map((r) => {
    const o = {};
    cols.forEach((c, i) => (o[c] = r[i]));
    return o;
  });
}

/* ---------------- http ---------------- */
function tmdbUrl(path, params = {}) {
  const u = new URL(TMDB + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  if (!TOKEN && APIKEY) u.searchParams.set("api_key", APIKEY);
  return u.toString();
}

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetch(url, {
        headers: TOKEN
          ? { Authorization: `Bearer ${TOKEN}`, accept: "application/json" }
          : { accept: "application/json" }
      });
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(600 * (i + 1));
      continue;
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") || 1) * 1000 + 250;
      await sleep(wait);
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      if (res.status >= 500 && i < tries - 1) { await sleep(1500 * (i + 1) ** 2); continue; }
      throw new Error(`${res.status} ${res.statusText} for ${url.replace(/api_key=[^&]+/, "api_key=***")}`);
    }
    return res.json();
  }
  throw new Error("retries exhausted: " + url.replace(/api_key=[^&]+/, "api_key=***"));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- matching ----------------
   Search can return the wrong film for common titles, so score candidates on
   exact-title and exact-year rather than trusting result order. */
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function pickMatch(results, title, year) {
  if (!results || !results.length) return null;
  const want = norm(title);
  const scored = results.map((r) => {
    const t = norm(r.title), ot = norm(r.original_title);
    const ry = Number((r.release_date || "").slice(0, 4));
    let s = 0;
    if (t === want || ot === want) s += 100;
    else if (t.startsWith(want) || want.startsWith(t)) s += 55;
    else if (t.includes(want) || want.includes(t)) s += 25;
    if (ry && year) {
      const d = Math.abs(ry - year);
      s += d === 0 ? 60 : d === 1 ? 40 : d <= 3 ? 10 : -35;
    }
    s += Math.min(12, (r.popularity || 0) / 12);
    return { r, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0].s >= 55 ? scored[0].r : null;
}

export function usCertification(releaseDates) {
  const us = (releaseDates?.results || []).find((x) => x.iso_3166_1 === REGION);
  if (!us) return null;
  const dates = us.release_dates || [];
  // prefer theatrical (3), then digital (4), then anything carrying a value
  for (const type of [3, 4, 1, 2, 5, 6]) {
    const hit = dates.find((d) => d.type === type && d.certification);
    if (hit) return hit.certification;
  }
  return dates.find((d) => d.certification)?.certification || null;
}

export function flatrateCodes(providers) {
  const region = providers?.results?.[REGION];
  if (!region) return [];
  const names = [...(region.flatrate || []), ...(region.ads || [])].map((p) => p.provider_name);
  return [...new Set(names.map(serviceCode).filter(Boolean))];
}

/* The per-movie providers payload already carries each service's own logo, so
   the marks shown next to a film are the real ones rather than hand-drawn
   imitations. Collected once across the whole run into _meta, never per film. */
export function logoPaths(providers) {
  const region = providers?.results?.[REGION];
  if (!region) return {};
  const out = {};
  for (const p of [...(region.flatrate || []), ...(region.ads || [])]) {
    const code = serviceCode(p.provider_name);
    if (code && p.logo_path && !out[code]) out[code] = p.logo_path;
  }
  return out;
}

export function rtFromOmdb(omdb) {
  const r = (omdb?.Ratings || []).find((x) => x.Source === "Rotten Tomatoes");
  if (!r) return null;
  const n = parseInt(String(r.Value).replace("%", ""), 10);
  return Number.isFinite(n) ? n : null;
}

/* ---------------- per-film pipeline ---------------- */
async function enrichOne(film) {
  const out = { t: film.t, y: film.y, ok: false };
  const search = await getJSON(
    tmdbUrl("/search/movie", { query: film.t, primary_release_year: film.y, include_adult: false })
  );
  let hit = pickMatch(search?.results, film.t, film.y);
  if (!hit) {
    const loose = await getJSON(tmdbUrl("/search/movie", { query: film.t, include_adult: false }));
    hit = pickMatch(loose?.results, film.t, film.y);
  }
  if (!hit) { out.error = "no confident TMDB match"; return out; }

  const [details, rel, prov] = await Promise.all([
    getJSON(tmdbUrl(`/movie/${hit.id}`)),
    getJSON(tmdbUrl(`/movie/${hit.id}/release_dates`)),
    getJSON(tmdbUrl(`/movie/${hit.id}/watch/providers`))
  ]);

  out.tmdb    = hit.id;
  out.imdb    = details?.imdb_id || null;
  out.matched = { title: hit.title, year: Number((hit.release_date || "").slice(0, 4)) || null };
  out.runtime = details?.runtime || null;
  out.cert    = usCertification(rel);
  out.tmdbScore = details?.vote_average ? Math.round(details.vote_average * 10) : null;
  out.votes   = details?.vote_count ?? null;
  out.poster  = details?.poster_path || hit.poster_path || null;
  /* A real plot synopsis, in complete sentences. The hand-written hooks in
     index.html are deliberately terse and often sentence fragments; this
     replaces them wherever TMDB has something usable. */
  out.overview = trimOverview(details?.overview || hit.overview || "");
  out.backdrop = details?.backdrop_path || hit.backdrop_path || null;
  out.providers = flatrateCodes(prov);
  out.logos = logoPaths(prov);
  /* Distinguishes "checked, and it is on nothing" from "never checked".
     Without this the page would keep showing a hand-guessed service for a
     film that is demonstrably not streaming anywhere. */
  out.providersChecked = !!prov;

  if (OMDB && out.imdb) {
    const r = await fetchOmdb(out.imdb);
    out.rt = r.rt;
    if (r.error) out.omdbError = r.error;
  }
  out.ok = true;
  return out;
}

/**
 * OMDb reports failures in the BODY with HTTP 401, so a plain !res.ok throw
 * loses the actual reason ("Invalid API key!", "No API key provided.",
 * "Request limit reached!"). Read the body either way and return the reason,
 * so a misconfigured key is visible instead of silently yielding null scores.
 */
export async function readOmdbPayload(res, text) {
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON error page */ }
  if (!body) return { rt: null, error: `HTTP ${res.status}: ${text.slice(0, 90)}` };
  if (String(body.Response) === "False") return { rt: null, error: body.Error || "OMDb returned Response:False" };
  const rt = rtFromOmdb(body);
  return { rt, error: rt == null ? "no Rotten Tomatoes entry for this title" : null };
}

async function fetchOmdb(imdbId) {
  const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(OMDB)}&i=${imdbId}&tomatoes=true`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    return await readOmdbPayload(res, await res.text());
  } catch (e) {
    return { rt: null, error: "network: " + e.message };
  }
}

/**
 * TMDB overviews run from one line to a full marketing paragraph. Keep whole
 * sentences up to a readable length rather than cutting mid-clause, and drop
 * anything too thin to be worth showing.
 */
export function trimOverview(text, max = 400) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length < 40) return null;                 // stubs like "No overview found."
  if (t.length <= max) return t;
  const sentences = t.match(/[^.!?]+[.!?]+(\s|$)/g) || [];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  out = out.trim();
  return out.length >= 60 ? out : t.slice(0, max).replace(/\s+\S*$/, "") + "\u2026";
}

/* ============================================================================
   DISCOVERY
   The hand-authored catalog is a seed, not the whole store. This walks what is
   actually on the eight services right now and brings back everything worth
   shelving, streaming originals included, since an original only ever lives on
   its own service and would never turn up in a hand-written list.

   Nothing here invents a tag it cannot defend. Attributes come from TMDB's own
   human-curated keywords, the genres, the runtime, and, where the director is
   already someone the curated catalog has an opinion about, from that opinion.
   A film that cannot earn at least three attributes is left on the shelf,
   because a thinly-tagged film scores badly and would crowd out a real match.
   ============================================================================ */

const TMDB_GENRE = {
  28:"action", 12:"adventure", 16:"animation", 35:"comedy", 80:"crime",
  99:"documentary", 18:"drama", 10751:"family", 14:"fantasy", 36:"drama",
  27:"horror", 10402:"musical", 9648:"mystery", 10749:"romance", 878:"scifi",
  53:"thriller", 10752:"war", 37:"western"
};

/* One or two attributes a genre can be trusted to imply on its own. */
const GENRE_ATTRS = {
  horror:["scary"], comedy:["comic"], romance:["romantic"], documentary:["grounded"],
  war:["visceral"], thriller:["propulsive"], action:["propulsive"], animation:["visual"],
  family:["cozy"], crime:["violent"], musical:["uplifting"], drama:["characterstudy"],
  mystery:["twisty"], fantasy:["visual"], scifi:["cerebral"], adventure:["spectacle"],
  western:["grounded"]
};

/* TMDB keywords are written by people, which makes them the best signal here
   for how a film actually plays rather than what it is filed under. */
const KEYWORD_ATTRS = [
  [/dystopi|post.?apocalyp|nihilis|despair|bleak/,                 "bleak"],
  [/time loop|surreal|absurd|psychedelic|bizarre|body horror/,     "weird"],
  [/dark comedy|black comedy|satire|parody/,                       "ironic"],
  [/coming of age|father son|mother daughter|family relationship/, "earnest"],
  [/christmas|holiday season|feel.?good|heartwarming/,             "cozy"],
  [/twist ending|unreliable narrator|whodunit|conspiracy/,         "twisty"],
  [/heist|chase|race against time|escape|manhunt|survival/,        "propulsive"],
  [/based on (a )?true|biography|true crime|docudrama/,            "grounded"],
  [/revenge|gore|slasher|brutality|massacre/,                      "violent"],
  [/supernatural|haunting|ghost|possession|demon|monster|serial killer/, "scary"],
  [/love triangle|wedding|first love|romantic/,                    "romantic"],
  [/space|alien|superhero|kaiju|giant monster|battle/,             "spectacle"],
  [/stop motion|puppet|practical effect|miniature/,                "practical"],
  [/courtroom|trial|dialogue|stage play|play adaptation/,          "dialogue"],
  [/ensemble cast|multiple storylines/,                            "ensemble"],
  [/artificial intelligence|philosoph|memory|identity|time travel/,"cerebral"],
  [/grief|loss|loneliness|terminal illness|melancholy/,            "melancholy"],
  [/redemption|inspirational|underdog|triumph/,                    "hopeful"],
  [/slow burn|meditative|contemplative/,                           "slowburn"],
  [/visually striking|cinematography|neo.?noir|stylish/,           "stylish"]
];

/**
 * Everything a discovered film's attribute list is allowed to come from.
 * Kept pure so it can be tested without touching the network.
 */
export function deriveAttrs({ genres = [], keywords = [], runtime = 0, dirAttrs = [] }) {
  const out = [];
  const add = (a) => { if (a && out.indexOf(a) === -1) out.push(a); };

  const kw = keywords.map((k) => String(k).toLowerCase()).join(" | ");
  for (const [re, attr] of KEYWORD_ATTRS) if (re.test(kw)) add(attr);
  for (const g of genres) (GENRE_ATTRS[g] || []).forEach(add);
  if (runtime && runtime <= 100) add("brisk");
  if (runtime && runtime >= 150) add("epic");
  /* A director the curated catalog already has a read on carries that read
     forward, which is how a new Villeneuve lands as visual rather than generic. */
  dirAttrs.slice(0, 2).forEach(add);

  return out.length >= 3 ? out.slice(0, 6) : null;
}

export function audienceFrom(cert, genres = []) {
  if (cert === "G" || cert === "PG") return "all";
  if (cert === "PG-13") return "teen";
  if (cert === "R" || cert === "NC-17") return "adult";
  if (genres.indexOf("horror") > -1) return "adult";
  if (genres.indexOf("family") > -1 || genres.indexOf("animation") > -1) return "all";
  return "teen";
}

/* How recognisable a film is, on the catalog's 3/2/1 scale. Vote count tracks
   reach far better than TMDB's own popularity number, which spikes on release. */
export function fameFrom(votes = 0) {
  return votes >= 15000 ? 3 : votes >= 4000 ? 2 : 1;
}

/* Provider ids are looked up by name rather than hardcoded, so a service that
   renumbers (HBO Max -> Max did exactly that) cannot silently stop returning
   anything. The same call carries every service's logo. */
async function providerDirectory() {
  const list = await getJSON(tmdbUrl("/watch/providers/movie", { watch_region: REGION }));
  const ids = {}, logos = {};
  for (const p of list?.results || []) {
    const code = serviceCode(p.provider_name);
    if (!code || ids[code]) continue;
    ids[code] = p.provider_id;
    if (p.logo_path) logos[code] = p.logo_path;
  }
  return { ids, logos };
}

/**
 * A page of what a service is streaming.
 *
 * TMDB 500s on any vote_* filter or sort combined with a provider filter,
 * confirmed by walking the query up one parameter at a time (scripts/probe.mjs).
 * So the query never mentions votes and the thresholds are applied here. Same
 * result set, minus a server-side bug we cannot fix from this end.
 */
async function discoverPage(providerId, page) {
  return getJSON(tmdbUrl("/discover/movie", {
    watch_region: REGION,
    with_watch_providers: providerId,
    with_watch_monetization_types: "flatrate",
    sort_by: "popularity.desc",
    include_adult: false,
    page
  }));
}

async function discoverOn(providerId, pages, minVotes, minScore) {
  const found = [];
  for (let page = 1; page <= pages; page++) {
    let data;
    try {
      data = await discoverPage(providerId, page);
    } catch (e) {
      /* These queries flake. Losing page 7 is not a reason to lose pages 1-6. */
      if (page === 1) throw e;
      break;
    }
    if (!data?.results?.length) break;
    for (const r of data.results) {
      if ((r.vote_count || 0) < minVotes) continue;
      if ((r.vote_average || 0) < minScore) continue;
      found.push(r);
    }
    if (page >= (data.total_pages || 1)) break;
    await sleep(320);          /* these queries are expensive at their end */
  }
  return found;
}

/* One request per candidate: details, keywords, credits, certification and
   availability all come back together. */
async function shelfRecord(id, dirLookup) {
  const d = await getJSON(tmdbUrl(`/movie/${id}`, {
    append_to_response: "keywords,credits,release_dates,watch/providers"
  }));
  if (!d || !d.title || !d.release_date) return null;

  const year = Number(d.release_date.slice(0, 4));
  const runtime = d.runtime || 0;
  if (!year || runtime < 60 || runtime > 260) return null;
  if (!d.poster_path || !d.backdrop_path) return null;

  const providers = flatrateCodes(d["watch/providers"]);
  if (!providers.length) return null;                 // discovery only ever shelves what streams

  const genres = [...new Set((d.genres || []).map((g) => TMDB_GENRE[g.id]).filter(Boolean))];
  if (!genres.length) return null;

  const keywords = (d.keywords?.keywords || []).map((k) => k.name);
  const director = (d.credits?.crew || []).find((c) => c.job === "Director")?.name || "";
  const attrs = deriveAttrs({
    genres, keywords, runtime,
    dirAttrs: dirLookup[director] || []
  });
  if (!attrs) return null;

  const overview = trimOverview(d.overview || "");
  if (!overview) return null;

  const cert = usCertification(d.release_dates);
  return {
    t: d.title,
    y: year,
    r: runtime,
    g: genres,
    a: attrs,
    svcs: providers,
    d: director || "Unknown",
    h: overview,
    k: audienceFrom(cert, genres),
    pop: fameFrom(d.vote_count || 0),
    mpaa: cert || "NR",
    rt: d.vote_average ? Math.round(d.vote_average * 10) : 0,
    rtSrc: "tmdb",
    poster: d.poster_path,
    backdrop: d.backdrop_path,
    tmdb: d.id,
    logos: logoPaths(d["watch/providers"])
  };
}

/* What the curated catalog believes about each director it already knows. */
export function directorAttrs(curated) {
  const tally = {};
  for (const f of curated) {
    if (!f.d) continue;
    const bag = (tally[f.d] = tally[f.d] || {});
    String(f.a || "").split("|").forEach((a) => { if (a) bag[a] = (bag[a] || 0) + 1; });
  }
  const out = {};
  for (const [dir, bag] of Object.entries(tally)) {
    out[dir] = Object.entries(bag).sort((a, b) => b[1] - a[1]).map(([a]) => a);
  }
  return out;
}

/* ---------------- runner ---------------- */
async function pool(items, n, fn) {
  const results = new Array(items.length);
  let i = 0, done = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { results[idx] = await fn(items[idx], idx); }
        catch (e) { results[idx] = { t: items[idx].t, y: items[idx].y, ok: false, error: e.message }; }
        done++;
        if (!VERBOSE && done % 10 === 0) process.stdout.write(`\r  ${done}/${items.length}`);
        if (VERBOSE) console.log(`  ${done}/${items.length}  ${results[idx].ok ? "ok " : "MISS"} ${items[idx].t}`);
      }
    })
  );
  if (!VERBOSE) process.stdout.write(`\r  ${done}/${items.length}\n`);
  return results;
}

async function main() {
  if (!TOKEN && !APIKEY) {
    console.error(
      "No TMDB credentials.\n" +
      "  export TMDB_TOKEN='<v4 read access token>'   # preferred\n" +
      "  export TMDB_API_KEY='<v3 api key>'           # also works\n" +
      "  export OMDB_KEY='<key>'                      # optional, adds real RT scores\n" +
      "Get them free at https://www.themoviedb.org/settings/api"
    );
    process.exit(1);
  }
  const html = await readFile(join(ROOT, "index.html"), "utf8");
  let films = parseCatalog(html);
  if (LIMIT) films = films.slice(0, LIMIT);
  console.log(`Enriching ${films.length} titles from TMDB${OMDB ? " + OMDb" : ""} (region ${REGION})…`);

  const rows = await pool(films, CONCURRENCY, enrichOne);
  const ok = rows.filter((r) => r.ok);
  const missed = rows.filter((r) => !r.ok);

  /* ---- what is on the services right now ---------------------------------
     Runs after the curated pass so a discovered title can be checked against
     the hand-authored list and never shelved twice. */
  let previous = null;
  try { previous = JSON.parse(await readFile(join(ROOT, "data", "catalog.json"), "utf8")); }
  catch { /* first run */ }

  const seen = new Set(films.map((f) => `${norm(f.t)}::${f.y}`));
  let shelf = [], directory = { ids: {}, logos: {} }, scanned = false;
  const failed = [];
  if (!NO_DISCOVER) {
    try {
      directory = await providerDirectory();
      const codes = Object.keys(directory.ids);
      console.log(`\nScanning ${codes.length} services for what is streaming now…`);
      const dirLookup = directorAttrs(films);

      const candidates = new Map();
      for (const code of codes) {
        try {
          let rows;
          try {
            rows = await discoverOn(directory.ids[code], PAGES, MIN_VOTES, MIN_SCORE);
          } catch (first) {
            /* The 500s come and go rather than tracking any one service, which
               reads as load at their end. Stand back and ask once more before
               writing the service off for the night. */
            await sleep(6000);
            rows = await discoverOn(directory.ids[code], PAGES, MIN_VOTES, MIN_SCORE);
          }
          for (const r of rows) if (!candidates.has(r.id)) candidates.set(r.id, r);
          console.log(`  ${code.padEnd(4)} ${String(rows.length).padStart(4)} candidates`);
          await sleep(900);
        } catch (e) {
          /* One service having a bad day is not the whole store closing. */
          failed.push(code);
          console.log(`  ${code.padEnd(4)}    - unreachable (${e.message.slice(0, 60)})`);
        }
      }
      if (!candidates.size) throw new Error("every service returned nothing");

      const fresh = [...candidates.values()]
        .filter((r) => !seen.has(`${norm(r.title)}::${Number((r.release_date || "").slice(0, 4))}`))
        .slice(0, MAX_SHELF);
      console.log(`\n${fresh.length} new candidates, fetching details…`);
      const built = await pool(fresh.map((r) => ({ id: r.id, t: r.title, y: 0 })), CONCURRENCY,
        (item) => shelfRecord(item.id, dirLookup));

      const byKey = new Map();
      for (const r of built) {
        if (!r || !r.t) continue;
        const key = `${norm(r.t)}::${r.y}`;
        if (!byKey.has(key)) byKey.set(key, r);
      }
      shelf = [...byKey.values()];
      /* Films whose only home is a service we could not read this time would
         otherwise vanish and read as "left the service". Carry those forward
         from the last good scan instead of pretending they are gone. */
      if (failed.length) {
        const held = new Set(shelf.map((r) => `${norm(r.t)}::${r.y}`));
        for (const r of previous?.shelf || []) {
          const key = `${norm(r.t)}::${r.y}`;
          if (held.has(key)) continue;
          if ((r.svcs || []).some((c) => failed.includes(c))) { shelf.push(r); held.add(key); }
        }
      }
      scanned = true;
    } catch (e) {
      /* A daily job must not turn a bad afternoon at TMDB into an empty store.
         Keep yesterday's shelf and say so, rather than reporting that every
         film on it has left. */
      console.warn(`\n  !! scan failed: ${e.message.slice(0, 120)}`);
      console.warn(`  keeping the shelf from the last good scan.`);
      shelf = (previous?.shelf || []).slice();
    }
  } else if (previous?.shelf) {
    shelf = previous.shelf.slice();
  }

  /* ---- what changed since yesterday --------------------------------------
     Only a scan that actually ran can claim a title has left. */
  const today = new Date().toISOString().slice(0, 10);
  const firstSeen = new Map();
  for (const r of previous?.shelf || []) if (r.firstSeen) firstSeen.set(`${norm(r.t)}::${r.y}`, r.firstSeen);
  /* On the first run there is nothing to compare against, so every title would
     read as "just arrived". Leave the date unset instead of claiming a whole
     catalog landed today; tomorrow's run is the first that can tell. */
  const hadShelf = Array.isArray(previous?.shelf) && previous.shelf.length > 0;
  /* Presence on yesterday's shelf is what makes a title old, not whether it
     happened to carry a date. Keying on the date marked an entire carried-over
     shelf as arriving today the first time dates existed. */
  const prevKeys = new Set((previous?.shelf || []).map((r) => `${norm(r.t)}::${r.y}`));
  const arrived = [];
  for (const r of shelf) {
    const key = `${norm(r.t)}::${r.y}`;
    if (prevKeys.has(key)) {
      r.firstSeen = firstSeen.get(key) || null;      // was here before, date unknown
    } else {
      r.firstSeen = hadShelf && scanned ? today : null;
      if (r.firstSeen) arrived.push(r.t);
    }
  }

  const nowStreaming = new Set();
  for (const f of ok)    if ((f.providers || []).length) nowStreaming.add(f.t);
  for (const r of shelf) nowStreaming.add(r.t);
  let departed = [];
  if (scanned && !failed.length) {
    const wasStreaming = new Set();
    for (const f of previous?.films || []) if ((f.providers || []).length) wasStreaming.add(f.t);
    for (const r of previous?.shelf  || []) wasStreaming.add(r.t);
    departed = [...wasStreaming].filter((t) => !nowStreaming.has(t));
  }

  const payload = {
    _meta: {
      generatedAt: new Date().toISOString(),
      region: REGION,
      source: OMDB ? "TMDB + OMDb" : "TMDB",
      total: rows.length,
      matched: ok.length,
      withProviders: ok.filter((r) => r.providers.length).length,
      withRT: ok.filter((r) => r.rt != null).length,
      withOverview: ok.filter((r) => r.overview).length,
      omdbErrors: (() => {
        const tally = {};
        ok.forEach((r) => { if (r.omdbError) tally[r.omdbError] = (tally[r.omdbError] || 0) + 1; });
        return tally;
      })(),
      unmatched: missed.map((r) => `${r.t} (${r.y}): ${r.error || "unknown"}`),
      logos: (() => {
        const all = Object.assign({}, directory.logos);
        [...ok, ...shelf].forEach((r) => Object.entries(r.logos || {}).forEach(([code, path]) => {
          if (!all[code]) all[code] = path;
        }));
        return all;
      })(),
      scannedAt: today,
      scanOk: scanned,
      servicesMissed: failed,
      shelfCount: shelf.length,
      streamingNow: nowStreaming.size,
      arrived,
      departed
    },
    films: ok.map(({ logos, ...rest }) => rest),
    shelf: shelf.map(({ logos, ...rest }) => rest)
  };

  await mkdir(join(ROOT, "data"), { recursive: true });
  await writeFile(join(ROOT, "data", "catalog.json"), JSON.stringify(payload, null, 1) + "\n");

  console.log(`\nmatched          ${ok.length}/${rows.length}`);
  console.log(`with providers   ${payload._meta.withProviders}`);
  console.log(`with RT score    ${payload._meta.withRT}`);
  const errs = Object.entries(payload._meta.omdbErrors || {});
  if (OMDB && errs.length) {
    console.log(`\nOMDb did not return scores. Reasons:`);
    errs.sort((a, b) => b[1] - a[1]).forEach(([msg, n]) => console.log(`  ${n}x  ${msg}`));
    if (errs.some(([m]) => /api key/i.test(m))) {
      console.log(`\n  -> An OMDb key only works after you click the activation link they email you.`);
    }
  }
  console.log(`with poster      ${ok.filter((r) => r.poster).length}`);
  console.log(`with synopsis    ${payload._meta.withOverview}`);
  if (missed.length) {
    console.log(`\nunmatched (${missed.length}) — check these by hand:`);
    missed.slice(0, 25).forEach((r) => console.log(`  - ${r.t} (${r.y}): ${r.error}`));
  }
  const suspect = ok.filter((r) => r.matched.year && Math.abs(r.matched.year - r.y) > 1);
  if (suspect.length) {
    console.log(`\nyear drift — verify these matched the right film:`);
    suspect.forEach((r) => console.log(`  - "${r.t}" (${r.y}) matched "${r.matched.title}" (${r.matched.year})`));
  }
  console.log(`\ndiscovered      ${shelf.length} streaming titles`);
  console.log(`streaming now   ${nowStreaming.size} of ${ok.length + shelf.length} total`);
  if (arrived.length)  console.log(`arrived today   ${arrived.length}: ${arrived.slice(0, 6).join(", ")}${arrived.length > 6 ? "…" : ""}`);
  if (departed.length) console.log(`no longer on    ${departed.length}: ${departed.slice(0, 6).join(", ")}${departed.length > 6 ? "…" : ""}`);
  console.log(`\nwrote data/catalog.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error("\n" + e.message); process.exit(1); });
}
