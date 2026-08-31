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
      if (res.status >= 500 && i < tries - 1) { await sleep(600 * (i + 1)); continue; }
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
export function trimOverview(text, max = 260) {
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
        const all = {};
        ok.forEach((r) => Object.entries(r.logos || {}).forEach(([code, path]) => {
          if (!all[code]) all[code] = path;
        }));
        return all;
      })()
    },
    films: ok.map(({ logos, ...rest }) => rest)
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
  console.log(`\nwrote data/catalog.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error("\n" + e.message); process.exit(1); });
}
