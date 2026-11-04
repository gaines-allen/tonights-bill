#!/usr/bin/env node
/**
 * Check the Streaming Availability API key and the shape of what comes back,
 * with as few calls as possible (three). Run it with --probe on the refresh
 * workflow, or locally:
 *
 *   STREAMING_AVAILABILITY_KEY=<key> node scripts/probe.mjs
 *
 * It prints status codes and counts, never the key.
 */
import { API, headersFor, streamingCodes, imagesOf, tmdbIdOf } from "./enrich.mjs";

const KEY = process.env.STREAMING_AVAILABILITY_KEY || "";
if (!KEY) { console.error("STREAMING_AVAILABILITY_KEY is not set."); process.exit(1); }

async function probe(label, path) {
  const url = API.replace(/\/$/, "") + path;
  const res = await fetch(url, { headers: headersFor(url, KEY) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  console.log(`${res.ok ? "ok  " : "FAIL"} ${String(res.status).padEnd(4)} ${label}`);
  if (!res.ok) console.log(`       ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  return body;
}

const dk = await probe("a film by TMDB id (The Dark Knight)", "/shows/movie/155?country=us");
if (dk) {
  const img = imagesOf(dk);
  console.log(`       tmdb ${tmdbIdOf(dk)}, rating ${dk.rating}, runtime ${dk.runtime}, ` +
    `streams on ${streamingCodes(dk, "us").join(" ") || "none of the eight"}, poster ${img.poster ? "yes" : "no"}, still ${img.backdrop ? "yes" : "no"}`);
}
const page = await probe("one page of Netflix films", "/shows/search/filters?country=us&catalogs=netflix.subscription&show_type=movie&order_by=popularity_alltime&order_direction=desc");
if (page) console.log(`       ${page.shows?.length ?? 0} titles, more: ${!!page.hasMore}`);
await probe("title search (Dune)", "/shows/search/title?country=us&title=Dune&show_type=movie");
