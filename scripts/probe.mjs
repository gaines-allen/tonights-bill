#!/usr/bin/env node
/**
 * Ask TMDB which discover parameter it is actually refusing.
 *
 * The nightly scan started failing with a bare 500 and no explanation, which
 * is the kind of thing you can burn an afternoon guessing at. This walks the
 * query up one parameter at a time and prints where it breaks, so the fix is
 * a fact rather than a hunch. Run it with --probe on the refresh workflow.
 */
const TMDB = "https://api.themoviedb.org/3";
const TOKEN = process.env.TMDB_TOKEN || "";
const APIKEY = process.env.TMDB_API_KEY || "";

function url(path, params) {
  const u = new URL(TMDB + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  if (!TOKEN && APIKEY) u.searchParams.set("api_key", APIKEY);
  return u.toString();
}
async function probe(label, params) {
  const res = await fetch(url("/discover/movie", params), {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}`, accept: "application/json" }
                   : { accept: "application/json" }
  });
  const body = await res.text();
  const n = (() => { try { return JSON.parse(body).results?.length ?? "-"; } catch { return "-"; } })();
  console.log(`${res.ok ? "ok  " : "FAIL"} ${String(res.status).padEnd(4)} ${label.padEnd(46)} results=${n}`);
  if (!res.ok) console.log(`       ${body.slice(0, 160).replace(/\s+/g, " ")}`);
}

const base = { watch_region: "US", with_watch_providers: 8 };
await probe("providers only",                base);
await probe("+ monetization flatrate",       { ...base, with_watch_monetization_types: "flatrate" });
await probe("+ sort popularity.desc",        { ...base, with_watch_monetization_types: "flatrate", sort_by: "popularity.desc" });
await probe("+ include_adult",               { ...base, with_watch_monetization_types: "flatrate", sort_by: "popularity.desc", include_adult: false });
await probe("+ page",                        { ...base, with_watch_monetization_types: "flatrate", sort_by: "popularity.desc", include_adult: false, page: 1 });
await probe("+ vote filters (the suspect)",  { ...base, with_watch_monetization_types: "flatrate", sort_by: "popularity.desc", include_adult: false, page: 1, "vote_count.gte": 400, "vote_average.gte": 6.1 });
await probe("no providers at all",           { sort_by: "popularity.desc", page: 1 });
await probe("sort vote_count.desc",          { ...base, with_watch_monetization_types: "flatrate", sort_by: "vote_count.desc", page: 1 });
await probe("language en-US",                { ...base, with_watch_monetization_types: "flatrate", sort_by: "popularity.desc", language: "en-US" });
