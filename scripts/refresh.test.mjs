/**
 * The whole nightly refresh, end to end, with no key and no network: the real
 * scripts/enrich.mjs runs in a scratch copy of the repo against a fake
 * Streaming Availability API on localhost. Checks the scan, the curated
 * matching, the shelf, the call budget and carrying unread work forward.
 *
 *   node scripts/refresh.test.mjs
 */
import http from "node:http";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT as REPO, eq, ok, finish } from "./harness.mjs";

const prev = JSON.parse(await readFile(join(REPO, "data/catalog.json"), "utf8"));
const base = JSON.parse(await readFile(join(REPO, "scripts/fixtures/motn-show-the-dark-knight.json"), "utf8"));
const mk = (tmdb, title, year, svcId, n) => ({ ...base, id: "s" + tmdb, tmdbId: "movie/" + tmdb, imdbId: "tt" + tmdb, title, originalTitle: title,
  releaseYear: year, overview: "A detective races against time to stop a heist in a city full of secrets and violence.",
  streamingOptions: { us: svcId ? [{ service: { id: svcId, name: svcId, imageSet: { whiteImage: `https://media.movieofthenight.com/services/${svcId}/logo-white.svg` } },
    type: "subscription", link: `https://${svcId}.example/title/${tmdb}` }] : [] } });
const cur = prev.films.filter((f) => f.tmdb).slice(0, 20);
const SVCS = ["netflix","hbo","hulu","disney","prime","apple","paramount","peacock"];
const lists = {};
SVCS.forEach((s, i) => {
  lists[s] = [mk(cur[i].tmdb, cur[i].t, cur[i].y, s), mk(900000 + i, "New Film " + i, 2020, s), mk(910000 + i, "Other Film " + i, 2019, s)];
});
let hits = 0;
const srv = http.createServer((req, res) => {
  hits++;
  const u = new URL(req.url, "http://x");
  if (req.headers["x-api-key"] !== "test-key") { res.writeHead(401); return res.end("{}"); }
  const send = (b) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  if (u.pathname.endsWith("/shows/search/filters")) {
    const s = u.searchParams.get("catalogs").split(".")[0];
    return send({ shows: lists[s], hasMore: false });
  }
  const m = u.pathname.match(/\/shows\/movie\/(\d+)$/);
  if (m) { const f = cur.find((x) => String(x.tmdb) === m[1]); if (!f) { res.writeHead(404); return res.end("{}"); }
    return send(mk(f.tmdb, f.t, f.y, null)); }
  if (u.pathname.endsWith("/shows/search/title")) return send([]);
  res.writeHead(404); res.end("{}");
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${srv.address().port}/v4`;

async function refresh(extra) {
  const dir = await mkdtemp(join(tmpdir(), "mf-refresh-"));
  for (const p of ["index.html", "scripts", "data"]) await cp(join(REPO, p), join(dir, p), { recursive: true });
  hits = 0;
  const out = await new Promise((r) => execFile("node", [join(dir, "scripts/enrich.mjs"), "--limit", "20", ...extra],
    { env: { ...process.env, STREAMING_AVAILABILITY_KEY: "test-key", STREAMING_AVAILABILITY_URL: url, OMDB_KEY: "", MOTN_BUDGET: "" } },
    (err, stdout, stderr) => r({ err, stdout, stderr })));
  const catalog = out.err ? null : JSON.parse(await readFile(join(dir, "data/catalog.json"), "utf8"));
  await rm(dir, { recursive: true, force: true });
  return { ...out, catalog, hits };
}

console.log("\na full night");
const full = await refresh([]);
ok("the run succeeds", !full.err, full.stderr);
const m = full.catalog._meta;
eq("names its source", m.source, "Movie of the Night");
eq("every curated film is matched and checked tonight", [m.matched, m.checkedTonight, m.carriedForward], [20, 20, 0]);
eq("all eight services read", Object.keys(m.serviceScans).sort(), ["APL","DIS","HUL","MAX","NFX","PAR","PCK","PRV"]);
eq("one call per service page plus one per curated film not seen in the scan", m.requests, 8 + 12);
eq("the calls counted are the calls made", full.hits, m.requests);
const found = full.catalog.films.filter((f) => f.providers.length);
eq("the curated films the scan saw stream where it saw them", found.length, 8);
ok("each with a link straight to the title", found.every((f) => f.links[f.providers[0]]));
ok("posters and stills are full addresses, not TMDB paths",
   full.catalog.films.every((f) => /^https:\/\/cdn\.movieofthenight\.com\//.test(f.poster) && /^https:/.test(f.backdrop)));
const nf = full.catalog.shelf.find((s) => s.t === "New Film 0");
ok("a new film from the scan is shelved", nf && nf.svcs.join() === "NFX" && nf.firstSeen);
eq("the most popular title on a service reads as iconic", nf && nf.pop, 3);
ok("the curated films are not shelved twice", !full.catalog.shelf.some((s) => cur.some((c) => c.t === s.t && c.y === s.y)));
eq("eight service marks", Object.keys(m.logos).length, 8);
ok("the key never reaches the output", !/test-key/.test(full.stdout + full.stderr + JSON.stringify(full.catalog)));

console.log("\na night on a small budget");
const small = await refresh(["--budget", "12"]);
ok("the run succeeds", !small.err, small.stderr);
const s = small.catalog._meta;
eq("stops at the budget", [s.requests, small.hits], [12, 12]);
eq("reads one service and leaves the rest for another night", [Object.keys(s.serviceScans).length, s.servicesDeferred.length], [1, 7]);
eq("curated films it could not reach are carried, not dropped", [s.matched, s.carriedForward], [20, 20 - s.checkedTonight]);
ok("shelved films on unread services are carried, not reported gone",
   small.catalog.shelf.length > 600 && !s.departed.some((t) => prev.shelf.some((r) => r.t === t && r.svcs.some((c) => s.servicesDeferred.includes(c)))));

console.log("\na refused key");
const bad = await new Promise((r) => execFile("node", [join(REPO, "scripts/enrich.mjs"), "--limit", "1", "--no-discover"],
  { env: { ...process.env, STREAMING_AVAILABILITY_KEY: "", STREAMING_AVAILABILITY_URL: url } }, (err, stdout, stderr) => r({ err, stderr })));
ok("no key stops the run before it touches anything", bad.err && /STREAMING_AVAILABILITY_KEY/.test(bad.stderr));

srv.close();
finish();
