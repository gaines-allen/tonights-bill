#!/usr/bin/env node
/**
 * Enrich the curated catalog with sourced data.
 *
 * Every film in the store is tagged by the same rules, every night: genres and
 * attributes come from tagsFrom() and the Streaming Availability API (Movie of
 * the Night), whether the film is on the curated list or turned up in the
 * scan. The tags written into index.html are only the fallback for a page
 * opened without data/catalog.json.
 *
 * Also sourced: runtime, audience score, poster art, a synopsis, and which
 * services actually carry it right now, with a link straight to the title on
 * each service.
 *
 *   STREAMING_AVAILABILITY_KEY=<key>  node scripts/enrich.mjs
 *   STREAMING_AVAILABILITY_KEY=<key>  node scripts/enrich.mjs --limit 10
 *   --budget 30            stop after 30 API calls and carry the rest forward
 *   OMDB_KEY=<key>         (optional, adds real Rotten Tomatoes scores)
 *
 * The key comes from developers.movieofthenight.com. It is read from the
 * environment only, never from a file in the repo.
 *
 * Writes data/catalog.json. The page falls back to its built-in catalog when
 * that file is absent, so index.html keeps working as a standalone file.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const API = process.env.STREAMING_AVAILABILITY_URL || "https://api.movieofthenight.com/v4";
const REGION = process.env.REGION || "US";
const COUNTRY = REGION.toLowerCase();

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i === -1 ? d : (args[i + 1] ?? true);
};
const LIMIT = Number(flag("--limit", 0)) || 0;
const CONCURRENCY = Number(flag("--concurrency", 4));
const VERBOSE = args.includes("--verbose");
const NO_DISCOVER   = args.includes("--no-discover");
const PAGES         = Number(flag("--pages", 9));        /* per service, 20 titles a page */
const MIN_SCORE     = Number(flag("--min-score", 61));   /* Movie of the Night's 0-100 rating */
const MAX_SHELF     = Number(flag("--max-shelf", 900));  /* ceiling on discovered titles */
const OMDB_BUDGET   = Number(flag("--omdb-budget", 950)); /* OMDb allows 1000 lookups a day */
/* API calls one run may spend. 0 means no ceiling. The free plan allows 1,000
   calls a month, so a nightly run on it needs about 30; see README. */
const BUDGET        = Number(flag("--budget", process.env.MOTN_BUDGET || 0)) || 0;

const KEY = process.env.STREAMING_AVAILABILITY_KEY || "";
const OMDB = process.env.OMDB_KEY || "";

/* ---------------- service mapping ----------------
   Movie of the Night names each service by a stable id, so there is no display
   name to drift. Only these eight are tracked; anything else is ignored. */
export const SERVICE_IDS = Object.freeze({
  netflix: "NFX", hbo: "MAX", hulu: "HUL", disney: "DIS",
  prime: "PRV", apple: "APL", paramount: "PAR", peacock: "PCK"
});
export function serviceCode(id) {
  return (id && SERVICE_IDS[String(id).toLowerCase()]) || null;
}
/* Watching it on the service itself with a subscription you already pay for,
   or free there. Rent, buy and add-on channels (Max inside Prime Video) never
   count: "on Max" means on Max. Apple TV's subscription catalog is Apple TV+;
   its store listings are rent or buy and are left out. */
const COUNTED = new Set(["subscription", "free"]);
function counted(o) { return o && COUNTED.has(o.type) && !o.addon && serviceCode(o.service?.id); }

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

/* ---------------- http ----------------
   One counter for the whole run, so --budget is a real ceiling. */
export class BudgetSpent extends Error {
  constructor() { super("request budget for this run is spent"); this.name = "BudgetSpent"; }
}
export const calls = { made: 0, budget: BUDGET };
function apiUrl(path, params = {}) {
  const u = new URL(API.replace(/\/$/, "") + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, v);
  return u.toString();
}
export function headersFor(url, key = KEY) {
  /* The same API is also sold through RapidAPI under another host and header. */
  const h = { accept: "application/json" };
  if (/rapidapi\.com/i.test(url)) {
    h["X-RapidAPI-Key"] = key;
    h["X-RapidAPI-Host"] = new URL(url).host;
  } else {
    h["X-API-Key"] = key;
  }
  return h;
}

export async function getJSON(url, { tries = 4, fetchImpl = fetch, key = KEY } = {}) {
  for (let i = 0; i < tries; i++) {
    if (calls.budget && calls.made >= calls.budget) throw new BudgetSpent();
    calls.made++;
    let res;
    try {
      res = await fetchImpl(url, { headers: headersFor(url, key) });
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(600 * (i + 1));
      continue;
    }
    if (res.status === 429) {
      const wait = Number(res.headers?.get?.("retry-after") || 2) * 1000 + 250;
      if (i === tries - 1) throw new Error("429 rate limited (monthly quota or per-second limit)");
      await sleep(wait);
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${res.status}: the API refused the key (check STREAMING_AVAILABILITY_KEY)`);
    }
    if (!res.ok) {
      if (res.status >= 500 && i < tries - 1) { await sleep(1500 * (i + 1) ** 2); continue; }
      throw new Error(`${res.status} ${res.statusText || ""} for ${url}`.trim());
    }
    return res.json();
  }
  throw new Error("retries exhausted: " + url);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- reading a show ---------------- */
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* "movie/155" -> 155. The id stays the film's identity across the store, so a
   film shelved before the switch is still the same film after it. */
export function tmdbIdOf(show) {
  const m = String(show?.tmdbId || "").match(/^movie\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

/* Title search can return the wrong film for common titles, so score
   candidates on exact title and exact year rather than trusting result order. */
export function pickMatch(results, title, year) {
  if (!results || !results.length) return null;
  const want = norm(title);
  const scored = results.filter((r) => !r.showType || r.showType === "movie").map((r) => {
    const t = norm(r.title), ot = norm(r.originalTitle);
    const ry = Number(r.releaseYear) || 0;
    let s = 0;
    if (t === want || ot === want) s += 100;
    else if (t.startsWith(want) || want.startsWith(t)) s += 55;
    else if (t.includes(want) || want.includes(t)) s += 25;
    if (ry && year) {
      const d = Math.abs(ry - year);
      s += d === 0 ? 60 : d === 1 ? 40 : d <= 3 ? 10 : -35;
    }
    return { r, s };
  });
  if (!scored.length) return null;
  scored.sort((a, b) => b.s - a.s);
  return scored[0].s >= 55 ? scored[0].r : null;
}

/* Which of the eight services carry it tonight, by subscription or free. */
export function streamingCodes(show, country = COUNTRY) {
  const opts = show?.streamingOptions?.[country] || [];
  return [...new Set(opts.filter(counted).map((o) => serviceCode(o.service.id)))];
}

/* A link straight to the title on each service, so "where to stream" opens the
   film itself instead of a search. https only; anything else is dropped. */
export function watchLinks(show, country = COUNTRY) {
  const out = {};
  const opts = (show?.streamingOptions?.[country] || []).filter(counted);
  /* a subscription listing beats a free one for the same service */
  opts.sort((a, b) => (a.type === "subscription" ? 0 : 1) - (b.type === "subscription" ? 0 : 1));
  for (const o of opts) {
    const code = serviceCode(o.service.id);
    if (!out[code] && /^https:\/\//i.test(o.link || "")) out[code] = o.link;
  }
  return out;
}

/* Where to rent or buy it when no subscription carries it: one store listing,
   rental first, so "rent or buy only" can still lead somewhere real. */
export function rentLinkOf(show, country = COUNTRY) {
  const opts = (show?.streamingOptions?.[country] || [])
    .filter((o) => (o.type === "rent" || o.type === "buy") && /^https:\/\//i.test(o.link || ""));
  opts.sort((a, b) => (a.type === "rent" ? 0 : 1) - (b.type === "rent" ? 0 : 1));
  const o = opts[0];
  return o ? { name: o.service?.name || "", link: o.link } : null;
}

/* Each service's own logo, collected once per run into _meta. The white mark
   is drawn on the service's colour, which is how the page shows it. */
export function logoUrls(show, country = COUNTRY) {
  const out = {};
  for (const o of (show?.streamingOptions?.[country] || []).filter(counted)) {
    const code = serviceCode(o.service.id);
    const img = o.service.imageSet?.whiteImage || o.service.imageSet?.darkThemeImage;
    if (code && !out[code] && /^https:\/\//i.test(img || "")) out[code] = img;
  }
  return out;
}

/* Poster and still, as full addresses. The image addresses are signed and
   expire after some months, which is why every nightly run rewrites them. */
export function imagesOf(show) {
  const is = show?.imageSet || {};
  const ok = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);
  return {
    poster: ok(is.verticalPoster?.w480) || ok(is.verticalPoster?.w360),
    posterSm: ok(is.verticalPoster?.w240),
    /* the clean still, never the horizontal poster with its title lettering */
    backdrop: ok(is.horizontalBackdrop?.w1080) || ok(is.horizontalBackdrop?.w720)
  };
}

/* Movie of the Night's genre ids, in the catalog's vocabulary. History reads
   as drama, as it always has here; music is not a genre the page has. */
const MOTN_GENRE = {
  action: "action", adventure: "adventure", animation: "animation", comedy: "comedy",
  crime: "crime", documentary: "documentary", drama: "drama", family: "family",
  fantasy: "fantasy", history: "drama", horror: "horror", mystery: "mystery",
  romance: "romance", scifi: "scifi", thriller: "thriller", war: "war", western: "western"
};

/* ============================================================================
   TAGGING
   Nothing here invents a tag it cannot defend. Attributes come from the
   film's genres, the words of its synopsis and its runtime, and nothing else:
   the curated films are tagged by these same rules, so there is no
   hand-written opinion left for a scanned film to borrow. A scanned film that
   cannot earn at least three attributes is left off the shelf, because a
   thinly-tagged film scores badly and would crowd out a real match.
   ============================================================================ */

/* A film is a musical when its own synopsis says so, whatever its genres say:
   music films (Whiplash, A Complete Unknown) are not musicals, and the genre
   lists leave La La Land out of music altogether. */
const MUSICAL_WORDS = ["musical", "jukebox musical", "musical comedy", "horror musical", "rock musical"];

/* Only what a genre guarantees on its own. A crime film is not necessarily
   violent (Knives Out), an adventure is not necessarily spectacle (Paddington
   2), a drama is not necessarily a character study: those calls are left to
   the keywords, which describe the film rather than the shelf it sits on. */
const GENRE_ATTRS = {
  horror:["scary"], comedy:["comic"], romance:["romantic"], documentary:["grounded"],
  animation:["visual"], family:["cozy"], mystery:["twisty"], musical:["uplifting"],
  action:["propulsive"], war:["visceral"]
};

/* Phrases that say how a film plays. Each one found in a film's synopsis is a
   vote for the attributes it names. Matched whole, never as a substring, so
   "love" cannot fire on "glove". The list was first built from the keywords
   people wrote for the films in the store; the synopsis is the text the
   current source carries, so the same vocabulary is read from there. */
const KEYWORD_ATTRS = {
  comic: ["amused", "hilarious", "witty", "playful", "absurd", "satirical", "sexual humor",
    "slapstick", "slapstick comedy", "parody", "spoof", "romcom", "buddy comedy", "farce",
    "comedy of errors", "dark comedy", "black comedy", "screwball comedy", "mockumentary",
    "stoner comedy", "sketch comedy", "teen comedy", "comedic", "funny"],
  ironic: ["dark comedy", "black comedy", "satire", "satirical", "parody", "spoof", "irony",
    "cynical", "critical", "mockumentary", "absurdism"],
  cozy: ["comforting", "lighthearted", "whimsical", "serene", "relaxed", "christmas",
    "holiday", "feel-good", "feel good", "heartwarming", "wholesome", "cute", "sweet"],
  uplifting: ["cheerful", "joyful", "joyous", "exuberant", "celebratory", "triumphant", "inspirational",
    "exhilarated", "enthusiastic", "feel-good", "feel good", "musical", "uplifting",
    "3d animation", "pixar", "cartoon", "hilarious", "adoring", "anthropomorphism"],
  hopeful: ["hopeful", "underdog", "redemption", "second chance", "triumph", "overcoming adversity",
    "optimistic"],
  earnest: ["earnest", "sincere", "coming of age", "parent child relationship", "family relationships",
    "father son relationship", "father daughter relationship", "mother son relationship",
    "mother daughter relationship", "sibling relationship", "friendship", "empathetic",
    "compassionate", "tender", "heartfelt", "family", "comforting", "high school", "school",
    "single mother", "adoring", "cartoon", "hopeful", "inspirational", "semi autobiographical",
    "powerful"],
  melancholy: ["melancholy", "sadness", "sad", "tragic", "tragedy", "grief", "loss", "loss of loved one",
    "dying and death", "loneliness", "terminal illness", "regret", "nostalgic", "nostalgia",
    "bittersweet", "mourning", "death of husband", "death of wife", "death of father",
    "death of mother", "death of son", "death of daughter", "heartbreak", "grieving",
    "psychological drama", "semi autobiographical", "marriage crisis", "memory"],
  bleak: ["dreary", "bleak", "dystopia", "dystopian", "despair", "nihilism", "nihilistic",
    "post-apocalyptic future", "post-apocalyptic", "apocalypse", "genocide", "war crimes",
    "misanthrophy", "depression", "drug addiction", "addiction", "hopelessness", "grim",
    "anti war", "mass grave", "holocaust", "concentration camp", "psychological thriller",
    "psychopath", "violence", "dysfunctional family", "psychological disorders", "paranoia",
    "child abuse", "grieving", "cruelty"],
  cerebral: ["philosophical", "existentialism", "consciousness", "artificial intelligence (a.i.)",
    "artificial intelligence", "time travel", "thought-provoking", "mathematics", "puzzle",
    "quantum mechanics", "physics", "simulation", "mind-bending", "multiverse", "time paradox",
    "memory loss"],
  twisty: ["twist ending", "plot twist", "whodunit", "murder mystery", "unreliable narrator",
    "conspiracy", "heist", "caper", "con artist", "con man", "double cross", "deception",
    "manipulation", "detective", "mind-bending", "nonlinear timeline", "cat and mouse",
    "mistaken identity", "puzzle", "riddle", "whodunnit"],
  propulsive: ["suspenseful", "intense", "exhilarated", "chase", "car chase",
    "race against time", "escape", "manhunt", "on the run", "heist", "getaway car",
    "getaway driver", "survival", "action hero", "one man army", "shootout", "gunfight",
    "gunfights", "martial arts", "hitman", "assassin", "spy", "secret agent", "mission",
    "bank robbery", "armed robbery", "fast-paced", "thrilling", "tense", "pursuit"],
  visceral: ["aggressive", "brutality", "combat", "battle", "martial arts", "boxing", "boxer",
    "brawl", "torture", "gore", "body horror", "survival horror", "fighting", "hand to hand combat",
    "mixed martial arts", "war", "world war ii", "world war i", "vietnam war", "trench warfare",
    "visceral", "gruesome", "fistfight"],
  violent: ["violence", "brutality", "gore", "slasher", "massacre", "torture", "serial killer",
    "psychopath", "violent retaliation", "gunfight", "gunfights", "shootout", "gangster",
    "organized crime", "hitman", "assassin", "mafia", "mobster", "bratva (russian mafia)",
    "yakuza", "cartel", "drug cartel", "war crimes", "genocide", "bloody", "blood",
    "splatter", "home invasion", "vigilante", "killing spree", "mass murder", "decapitation"],
  scary: ["frightened", "supernatural horror", "psychological horror", "haunted house",
    "haunting", "haunted", "ghost", "demon", "demonic possession", "possession", "poltergeist",
    "slasher", "monster", "creature", "zombie", "vampire", "werewolf", "curse",
    "paranormal phenomena", "paranormal", "body horror", "survival horror", "serial killer",
    "horror", "folk horror", "cosmic horror", "occult", "exorcism", "creepy", "terrifying",
    "jump scare", "evil spirit", "killer doll"],
  romantic: ["romantic", "romance", "romcom", "falling in love", "new love", "first love",
    "love triangle", "soulmates", "star crossed lovers", "love of one's life",
    "unexpected romance", "gay romance", "secret love", "lovers", "love affair",
    "forbidden love", "lost love", "childhood sweethearts", "romantic comedy"],
  spectacle: ["superhero", "superhero team", "alien invasion", "space opera", "space battle",
    "kaiju", "giant monster", "dinosaur", "disaster", "disaster movie", "epic battle",
    "spacecraft", "space travel", "fighter pilot", "aircraft carrier", "naval aviation",
    "saving the world", "globetrotting", "marvel cinematic universe (mcu)",
    "dc extended universe (dceu)", "dragon", "awestruck", "mecha", "giant robot",
    "end of the world", "natural disaster", "space war", "battlefield", "spectacle", "explosion"],
  visual: ["vibrant", "awestruck", "wonder", "anime", "3d animation", "stop motion", "surrealism",
    "surreal", "fantasy world", "parallel world", "black and white", "visually striking",
    "neo-noir", "colorful", "hand-drawn animation", "dreamlike", "beautiful", "breathtaking",
    "cinematography", "magical realism", "reflective", "admiring", "alien contact",
    "astronaut", "space station", "magic realism", "cyberpunk", "epic fantasy"],
  stylish: ["neo-noir", "stylish", "stylized", "bold", "audacious", "james bond", "split screen",
    "flashy", "film noir", "noir", "retro", "slick", "whodunit", "spy", "alter ego", "heist",
    "con artist", "cyberpunk", "tech noir", "voyeurism", "paranoid", "frantic", "caper"],
  grounded: ["based on true story", "biography", "docudrama", "true crime", "matter of fact",
    "autobiographical", "semi autobiographical", "nature documentary", "sports documentary",
    "recession", "working class", "rural setting", "immigrant", "historical event",
    "based on real person", "biopic", "realism", "poverty", "blue collar", "sports",
    "parenting", "journalist", "moral dilemma", "journalism"],
  dialogue: ["talking", "conversation", "legal drama", "court case", "courtroom", "court martial",
    "legal thriller", "military court", "based on play or musical", "stage play",
    "play adaptation", "based on play", "witty", "debate", "dinner party", "trial", "lawyer",
    "screenplay", "talky", "monologue", "chamber piece", "moral dilemma", "journalist"],
  ensemble: ["group of friends", "ensemble cast", "multiple storylines", "superhero team", "heist crew",
    "ensemble", "multiple perspectives", "large cast", "family reunion", "band of brothers",
    "platoon", "marvel cinematic universe (mcu)", "murder mystery", "whodunit", "heist",
    "caper", "epic fantasy", "fellowship", "companionship", "sword and sorcery"],
  characterstudy: ["character study", "psychological study", "loneliness", "obsession", "narcissism",
    "mental illness", "mental health", "masculinity", "midlife crisis", "addict", "alcoholic",
    "alcoholism", "introspective", "intimate", "self-discovery", "inner conflict", "trauma",
    "ptsd", "existential crisis", "psychological drama", "personality disorder", "biography",
    "semi autobiographical", "provocative", "grief", "grieving"],
  slowburn: ["slow burn", "meditative", "contemplative", "reflective", "quiet", "minimalism",
    "atmospheric", "slow-paced", "patient", "dreary", "semi autobiographical", "isolation",
    "symbolism", "loneliness", "grief", "grieving", "psychological disorders",
    "existentialism", "character study"],
  weird: ["surrealism", "surreal", "absurd", "absurdism", "bizarre", "psychedelic", "time loop",
    "body horror", "parallel world", "mind-bending", "weird", "strange", "dreamlike",
    "eccentric", "quirky", "offbeat", "cult film", "cosmic horror", "multiverse",
    "magic realism", "dark fantasy"],
  practical: ["stop motion", "puppet", "puppetry", "practical effects", "animatronics",
    "claymation", "miniature", "stop-motion animation", "clay animation"],
  epic: ["epic", "saga", "dynasty", "multiple generations", "historical epic", "war epic",
    "epic battle", "space opera", "epic fantasy", "sword and sorcery", "hero's journey",
    "empire", "rebellion", "chosen one", "destiny", "good versus evil"]
};

/* When a film's keywords say too little, its genres fill it up to three tags,
   and only to three: a film whose keywords already describe it is never
   overruled by what its genre usually means. Crime never fills with
   "violent", so a crime comedy cannot come out reading like a thriller. */
const GENRE_FILL = {
  drama:["characterstudy", "earnest"], thriller:["propulsive", "twisty"],
  adventure:["spectacle", "propulsive"], fantasy:["visual", "spectacle"],
  scifi:["spectacle", "cerebral"], crime:["twisty", "stylish"], western:["grounded", "epic"],
  romance:["earnest", "cozy"], family:["uplifting", "earnest"], animation:["uplifting", "cozy"],
  documentary:["earnest", "characterstudy"], horror:["visceral", "bleak"],
  war:["bleak", "grounded"], action:["spectacle", "visceral"], mystery:["propulsive", "stylish"],
  musical:["cozy", "visual"], comedy:["ironic", "cozy"]
};

/* Some keywords name a subject, not a feeling. A monster is frightening in a
   horror film and a mascot in Monsters, Inc.; a gangster is violent in Heat and
   a sight gag in a cartoon. These only vote when the genre says the subject is
   played straight. Mood keywords ("frightened", "terrifying") always vote. */
const SUBJECT_ONLY = {
  scary: { words: ["supernatural horror", "psychological horror", "haunted house", "haunting",
    "haunted", "ghost", "demon", "demonic possession", "possession", "poltergeist", "monster",
    "creature", "zombie", "vampire", "werewolf", "curse", "paranormal phenomena", "paranormal",
    "occult", "exorcism", "evil spirit", "killer doll", "serial killer", "slasher"],
    when: (g) => g.includes("horror") || g.includes("thriller") },
  violent: { words: ["gangster", "organized crime", "hitman", "assassin", "mafia", "mobster",
    "bratva (russian mafia)", "yakuza", "cartel", "drug cartel", "home invasion", "vigilante",
    "shootout", "gunfight", "gunfights", "blood", "bloody"],
    when: (g) => !g.includes("family") && !g.includes("animation") }
};

/* keyword -> the attributes it votes for, built once */
const KW_INDEX = (() => {
  const idx = new Map();
  for (const [attr, words] of Object.entries(KEYWORD_ATTRS)) {
    for (const w of words) {
      if (!idx.has(w)) idx.set(w, []);
      if (idx.get(w).indexOf(attr) === -1) idx.get(w).push(attr);
    }
  }
  return idx;
})();
/* Order the vocabulary is listed in, used only to break ties. */
const ATTR_ORDER = Object.keys(KEYWORD_ATTRS).concat(["brisk"]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TERM_RES = [...KW_INDEX.keys()].concat(MUSICAL_WORDS)
  .filter((w, i, all) => all.indexOf(w) === i)
  .map((w) => [w, new RegExp("(^|[^a-z0-9])" + escapeRe(w) + "($|[^a-z0-9])")]);

/* The vocabulary phrases a synopsis actually uses, whole words only. */
export function overviewTerms(text) {
  const t = String(text || "").toLowerCase().replace(/[‘’]/g, "'");
  if (!t) return [];
  return TERM_RES.filter(([, re]) => re.test(t)).map(([w]) => w);
}

/* What the tags were made from, kept so the rules can be tuned and tested
   offline. Written to data/keywords.json, which the page never loads. */
function sourceOf(genres, terms) {
  return { genres: (genres || []).map((g) => g.name || g.id), terms };
}

/* Movie of the Night's genre objects in the catalog's vocabulary, duplicates
   folded. A synopsis that calls the film a musical makes it one. */
export function genresFrom(list = [], terms = []) {
  const out = (list || []).map((g) => MOTN_GENRE[g?.id]).filter(Boolean);
  if ((terms || []).some((k) => MUSICAL_WORDS.includes(String(k).toLowerCase()))) out.push("musical");
  return [...new Set(out)];
}

/**
 * Everything any film's attribute list is allowed to come from, curated or
 * scanned. Kept pure so it can be tested without touching the network.
 *
 * Every keyword votes for the attributes it names; a genre adds one vote for
 * what it guarantees. The six with the most votes win, so a film's strongest
 * traits are the ones that survive the cap, not whichever rule ran first.
 */
export function tagsFrom({ genres = [], keywords = [], runtime = 0 }) {
  const votes = {};
  const vote = (a, n = 1) => { votes[a] = (votes[a] || 0) + n; };

  for (const k of new Set(keywords.map((x) => String(x).toLowerCase().trim()))) {
    (KW_INDEX.get(k) || []).forEach((a) => {
      const rule = SUBJECT_ONLY[a];
      if (rule && rule.words.includes(k) && !rule.when(genres)) return;
      vote(a);
    });
  }
  for (const g of genres) (GENRE_ATTRS[g] || []).forEach((a) => vote(a));
  if (runtime && runtime <= 100) vote("brisk");
  if (runtime && runtime >= 150) vote("epic");

  const out = Object.keys(votes)
    .sort((a, b) => votes[b] - votes[a] || ATTR_ORDER.indexOf(a) - ATTR_ORDER.indexOf(b))
    .slice(0, 6);
  for (let i = 0; out.length < 3 && i < 2; i++) {
    for (const g of genres) {
      const a = (GENRE_FILL[g] || [])[i];
      if (a && out.length < 3 && out.indexOf(a) === -1) out.push(a);
    }
  }
  return out;
}

/* The scan's bar for shelving a film: the same tags, but at least three. */
export function deriveAttrs(input) {
  const a = tagsFrom(input);
  return a.length >= 3 ? a : null;
}

export function audienceFrom(cert, genres = []) {
  if (cert === "G" || cert === "PG") return "all";
  if (cert === "PG-13") return "teen";
  if (cert === "R" || cert === "NC-17") return "adult";
  if (genres.indexOf("horror") > -1) return "adult";
  if (genres.indexOf("family") > -1 || genres.indexOf("animation") > -1) return "all";
  return "teen";
}


/* How recognisable a film is, on the catalog's 3/2/1 scale, from where it sits
   in a service's all-time popularity list (0 is the most popular). The source
   publishes no vote counts, so the scan's own order stands in: roughly the
   top tenth of each service's list reads as iconic, the top half as well
   known. Curated films keep the fame written for them by hand. */
export function fameFromRank(rank) {
  if (typeof rank !== "number" || !isFinite(rank) || rank < 0) return 1;
  return rank < 18 ? 3 : rank < 90 ? 2 : 1;
}

export function rtFromOmdb(omdb) {
  const r = (omdb?.Ratings || []).find((x) => x.Source === "Rotten Tomatoes");
  if (!r) return null;
  const n = parseInt(String(r.Value).replace("%", ""), 10);
  return Number.isFinite(n) ? n : null;
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

/* OMDb allows 1000 lookups a day and answers every one after that with the
   same refusal. Once it says so, stop asking for the rest of the run. */
let omdbSpent = false;
async function fetchOmdb(imdbId) {
  if (omdbSpent) return { rt: null, error: "daily limit already reached" };
  const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(OMDB)}&i=${imdbId}&tomatoes=true`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const out = await readOmdbPayload(res, await res.text());
    if (out.error && /limit reached/i.test(out.error)) omdbSpent = true;
    return out;
  } catch (e) {
    return { rt: null, error: "network: " + e.message };
  }
}

/**
 * Synopses run from one line to a full marketing paragraph. Keep whole
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
   RECORDS
   One show object from the API carries everything a record needs: title,
   year, runtime, rating, synopsis, genres, poster, still, and where it streams
   in the country asked for. So a film seen in the scan costs no extra call.
   ============================================================================ */

/* The facts any record is built from, curated or scanned. Pure. */
export function factsOf(show, country = COUNTRY) {
  const terms = overviewTerms(show?.overview);
  const genres = genresFrom(show?.genres, terms);
  const img = imagesOf(show);
  return {
    tmdb: tmdbIdOf(show),
    imdb: show?.imdbId || null,
    title: show?.title || "",
    year: Number(show?.releaseYear) || null,
    runtime: Number(show?.runtime) || null,
    /* the source's 0-100 audience rating; 0 means it has none */
    score: typeof show?.rating === "number" && show.rating > 0 ? show.rating : null,
    overview: trimOverview(show?.overview || ""),
    ...img,
    providers: streamingCodes(show, country),
    links: watchLinks(show, country),
    rentLink: rentLinkOf(show, country),
    logos: logoUrls(show, country),
    director: (show?.directors || [])[0] || "",
    genres, terms,
    _src: sourceOf(show?.genres, terms)
  };
}

/* A curated film, checked tonight. Audience, fame and certificate are not in
   the source, so the hand-written values in index.html stand for those. */
export function curatedRecord(film, show, today, country = COUNTRY) {
  const f = factsOf(show, country);
  const out = {
    t: film.t, y: film.y, ok: true,
    tmdb: f.tmdb, imdb: f.imdb,
    matched: { title: f.title, year: f.year },
    runtime: f.runtime,
    score: f.score,
    /* the same rating on a 0-10 scale, for the monthly marquee */
    rating: f.score != null ? f.score / 10 : null,
    poster: f.poster, posterSm: f.posterSm, backdrop: f.backdrop,
    overview: f.overview,
    providers: f.providers,
    links: f.links,
    ...(f.providers.length ? {} : { rentLink: f.rentLink }),
    logos: f.logos,
    /* Distinguishes "checked, and it is on nothing" from "never checked".
       Without this the page would keep showing a hand-guessed service for a
       film that is demonstrably not streaming anywhere. */
    providersChecked: true,
    checkedAt: today,
    _src: f._src
  };
  if (typeof film.pop === "number") out.pop = film.pop;
  if (f.genres.length) {
    out.g = f.genres;
    out.a = tagsFrom({ genres: f.genres, keywords: f.terms, runtime: f.runtime || 0 });
  }
  return out;
}

/* A scanned film worth shelving, or null. The bar is the one the shelf has
   always had: a real runtime, a poster and a still, a streaming home, genres,
   three attributes and a synopsis. */
export function shelfRecord(show, rank, country = COUNTRY) {
  if (!show || (show.showType && show.showType !== "movie")) return null;
  const f = factsOf(show, country);
  if (!f.title || !f.year) return null;
  const runtime = f.runtime || 0;
  if (runtime < 60 || runtime > 260) return null;
  if (!f.poster || !f.backdrop) return null;
  if (!f.providers.length) return null;          // discovery only ever shelves what streams
  if (!f.genres.length) return null;
  const attrs = deriveAttrs({ genres: f.genres, keywords: f.terms, runtime });
  if (!attrs) return null;
  if (!f.overview) return null;
  return {
    t: f.title,
    y: f.year,
    r: runtime,
    g: f.genres,
    a: attrs,
    svcs: f.providers,
    d: f.director || "Unknown",
    h: f.overview,
    k: audienceFrom(null, f.genres),
    pop: fameFromRank(rank),
    mpaa: "NR",
    rt: f.score || 0,
    rtSrc: "audience",
    rating: f.score != null ? f.score / 10 : null,
    poster: f.poster,
    posterSm: f.posterSm,
    backdrop: f.backdrop,
    links: f.links,
    tmdb: f.tmdb,
    imdb: f.imdb,
    logos: f.logos,
    _src: f._src
  };
}

/* ============================================================================
   DISCOVERY
   The curated catalog is a seed, not the whole store. This walks what is
   actually on the eight services right now, most popular first, and brings
   back everything worth shelving, streaming originals included.
   ============================================================================ */

/* What to search on each service: its subscription catalog, plus its free
   tier where it has one. */
export const SCAN_CATALOGS = Object.freeze({
  netflix: "netflix.subscription",
  hbo: "hbo.subscription",
  hulu: "hulu.subscription",
  disney: "disney.subscription",
  prime: "prime.subscription,prime.free",
  apple: "apple.subscription",
  paramount: "paramount.subscription,paramount.free",
  peacock: "peacock.subscription,peacock.free"
});

export function scanUrl(serviceId, cursor, { country = COUNTRY, minScore = MIN_SCORE } = {}) {
  return apiUrl("/shows/search/filters", {
    country,
    catalogs: SCAN_CATALOGS[serviceId],
    show_type: "movie",
    order_by: "popularity_alltime",
    order_direction: "desc",
    rating_min: minScore,
    output_language: "en",
    cursor
  });
}

/* Up to `pages` pages of one service, each show with its place in the list.
   Losing page 7 is not a reason to lose pages 1-6; running out of budget part
   way is, because a half-read service would read as films leaving it. */
export async function scanService(serviceId, pages, opts = {}) {
  const get = opts.getJSON || getJSON;
  const found = [];
  let cursor;
  for (let page = 1; page <= pages; page++) {
    let data;
    try {
      data = await get(scanUrl(serviceId, cursor, opts));
    } catch (e) {
      if (e instanceof BudgetSpent || page === 1) throw e;
      break;
    }
    const shows = data?.shows || [];
    for (const s of shows) found.push({ show: s, rank: found.length });
    if (!data?.hasMore || !data.nextCursor || !shows.length) break;
    cursor = data.nextCursor;
    if (!opts.getJSON) await sleep(250);
  }
  return found;
}

/* Services least recently read go first, so a run on a small budget works
   round the eight over several nights instead of reading Netflix every time. */
export function scanOrder(serviceScans = {}) {
  return Object.keys(SERVICE_IDS).sort((a, b) => {
    const da = serviceScans[SERVICE_IDS[a]] || "", db = serviceScans[SERVICE_IDS[b]] || "";
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

/* Curated films that need their own call, least recently checked first. */
export function checkOrder(films, prevByKey) {
  return films.slice().sort((a, b) => {
    const pa = prevByKey.get(`${a.t}::${a.y}`)?.checkedAt || "";
    const pb = prevByKey.get(`${b.t}::${b.y}`)?.checkedAt || "";
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
}

/* One curated film looked up on its own: by its TMDB id when we hold one,
   otherwise by title, scored on title and year. */
async function lookupCurated(film, prev) {
  const id = prev?.tmdb || film.tmdb;
  if (id) {
    const show = await getJSON(apiUrl(`/shows/movie/${id}`, { country: COUNTRY, output_language: "en" }));
    if (show) return show;
  }
  const list = await getJSON(apiUrl("/shows/search/title", {
    title: film.t, country: COUNTRY, show_type: "movie", output_language: "en"
  }));
  return pickMatch(Array.isArray(list) ? list : [], film.t, film.y);
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
        if (VERBOSE) console.log(`  ${done}/${items.length}  ${results[idx]?.ok ? "ok " : "MISS"} ${items[idx].t}`);
      }
    })
  );
  if (!VERBOSE && items.length) process.stdout.write(`\r  ${done}/${items.length}\n`);
  return results;
}

async function main() {
  if (!KEY) {
    console.error(
      "No Streaming Availability API key.\n" +
      "  export STREAMING_AVAILABILITY_KEY='<key>'   # from developers.movieofthenight.com\n" +
      "  export OMDB_KEY='<key>'                     # optional, adds real RT scores\n" +
      "On GitHub, add it as the repository secret STREAMING_AVAILABILITY_KEY."
    );
    process.exit(1);
  }
  const html = await readFile(join(ROOT, "index.html"), "utf8");
  let films = parseCatalog(html);
  if (LIMIT) films = films.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Enriching ${films.length} titles from Movie of the Night${OMDB ? " + OMDb" : ""} ` +
    `(region ${REGION}${BUDGET ? `, budget ${BUDGET} calls` : ""})…`);

  let previous = null;
  try { previous = JSON.parse(await readFile(join(ROOT, "data", "catalog.json"), "utf8")); }
  catch { /* first run */ }
  const prevByKey = new Map((previous?.films || []).map((f) => [`${f.t}::${f.y}`, f]));
  const serviceScans = Object.assign({}, previous?._meta?.serviceScans || {});

  /* ---- what is on the services right now ---------------------------------
     Runs first: a curated film found here needs no call of its own. */
  const scanShare = BUDGET ? Math.max(PAGES, Math.floor(BUDGET * 0.6)) : Infinity;
  const candidates = new Map();        // show id -> { show, rank }
  const failed = [], deferred = [], scannedCodes = [];
  if (!NO_DISCOVER) {
    console.log(`\nScanning services for what is streaming now…`);
    for (const id of scanOrder(serviceScans)) {
      const code = SERVICE_IDS[id];
      if (calls.made + PAGES > scanShare) { deferred.push(code); continue; }
      try {
        const rows = await scanService(id, PAGES);
        for (const { show, rank } of rows) {
          const had = candidates.get(show.id);
          if (!had || rank < had.rank) candidates.set(show.id, { show, rank });
        }
        scannedCodes.push(code);
        serviceScans[code] = today;
        console.log(`  ${code.padEnd(4)} ${String(rows.length).padStart(4)} titles`);
      } catch (e) {
        if (e instanceof BudgetSpent) { deferred.push(code); continue; }
        /* One service having a bad day is not the whole store closing. */
        failed.push(code);
        console.log(`  ${code.padEnd(4)}    - unreachable (${e.message.slice(0, 60)})`);
      }
    }
    if (deferred.length) console.log(`  left for another night: ${deferred.join(" ")}`);
  }
  const scanned = scannedCodes.length > 0;

  /* ---- the curated films ---------------------------------------------------- */
  const byTmdb = new Map(), byTitle = new Map();
  for (const { show } of candidates.values()) {
    const id = tmdbIdOf(show);
    if (id) byTmdb.set(id, show);
    byTitle.set(`${norm(show.title)}::${show.releaseYear}`, show);
  }
  const rows = new Array(films.length);
  const lookups = [];
  films.forEach((film, i) => {
    const prev = prevByKey.get(`${film.t}::${film.y}`);
    const seen = (prev?.tmdb && byTmdb.get(prev.tmdb)) || byTitle.get(`${norm(film.t)}::${film.y}`);
    if (seen) rows[i] = curatedRecord(film, seen, today);
    else lookups.push({ film, prev, i });
  });
  const ordered = checkOrder(lookups.map((l) => l.film), prevByKey)
    .map((film) => lookups.find((l) => l.film === film));
  let carriedCurated = 0;
  await pool(ordered.map((l) => ({ ...l, t: l.film.t, y: l.film.y })), CONCURRENCY, async (l) => {
    try {
      const show = await lookupCurated(l.film, l.prev);
      rows[l.i] = show ? curatedRecord(l.film, show, today)
                       : { t: l.film.t, y: l.film.y, ok: false, error: "no confident match" };
    } catch (e) {
      /* Not checked tonight is not the same as not found: keep what we knew. */
      if (l.prev?.ok) { rows[l.i] = { ...l.prev, carried: true }; carriedCurated++; }
      else rows[l.i] = { t: l.film.t, y: l.film.y, ok: false,
        error: e instanceof BudgetSpent ? "not checked yet (request budget)" : e.message };
    }
    return rows[l.i];
  });
  const ok = rows.filter((r) => r && r.ok);
  const missed = rows.filter((r) => r && !r.ok);

  /* A critic score we already hold is better than one we could not fetch today. */
  const heldRT = new Map();
  for (const f of previous?.films || []) if (f.rt != null && f.rtSrc !== "tmdb" && f.rtSrc !== "audience") heldRT.set(`${f.t}::${f.y}`, f.rt);
  for (const f of previous?.shelf || []) if (f.rt != null && f.rtSrc === "rt") heldRT.set(`${f.t}::${f.y}`, f.rt);
  let carried = 0;
  const fresh = ok.filter((r) => !r.carried);
  if (OMDB) {
    const queue = fresh.filter((r) => r.imdb).slice(0, OMDB_BUDGET);
    if (queue.length) console.log(`\nCritic scores for ${queue.length} curated titles…`);
    await pool(queue, CONCURRENCY, async (r) => {
      const res = await fetchOmdb(r.imdb);
      r.rt = res.rt;
      if (res.error) r.omdbError = res.error;
      return { ok: true, t: r.t };
    });
  }
  /* Without this, a day when OMDb is out of quota quietly drops every real
     Rotten Tomatoes score. */
  for (const r of fresh) {
    if (r.rt == null && heldRT.has(`${r.t}::${r.y}`)) { r.rt = heldRT.get(`${r.t}::${r.y}`); r.rtCarried = true; carried++; }
  }

  /* ---- the shelf ------------------------------------------------------------ */
  const seenCurated = new Set(films.map((f) => `${norm(f.t)}::${f.y}`));
  const curatedIds = new Set(ok.map((r) => r.tmdb).filter(Boolean));
  let shelf = [];
  if (!NO_DISCOVER && scanned) {
    const byKey = new Map();
    const fresh = [...candidates.values()].sort((a, b) => a.rank - b.rank);
    for (const { show, rank } of fresh) {
      if (byKey.size >= MAX_SHELF) break;
      const r = shelfRecord(show, rank);
      if (!r) continue;
      const key = `${norm(r.t)}::${r.y}`;
      if (seenCurated.has(key) || (r.tmdb && curatedIds.has(r.tmdb)) || byKey.has(key)) continue;
      byKey.set(key, r);
    }
    shelf = [...byKey.values()];
    /* Films whose only homes are services not read tonight would otherwise
       vanish and read as "left the service". Carry those forward from the last
       scan instead of pretending they are gone. */
    const unread = new Set([...failed, ...deferred]);
    if (unread.size) {
      const held = new Set(shelf.map((r) => `${norm(r.t)}::${r.y}`));
      for (const r of previous?.shelf || []) {
        const key = `${norm(r.t)}::${r.y}`;
        if (held.has(key) || seenCurated.has(key)) continue;
        if ((r.svcs || []).some((c) => unread.has(c))) { shelf.push(r); held.add(key); }
      }
    }
    /* Critic scores for the shelf, most recognisable first, within OMDb's
       daily ceiling. The rest keep the audience score, clearly marked. */
    if (OMDB && shelf.length) {
      const budget = Math.max(0, OMDB_BUDGET - ok.length);
      const queue = shelf.filter((r) => r.imdb && r.rtSrc !== "rt")
                         .sort((a, b) => b.pop - a.pop || b.rt - a.rt)
                         .slice(0, budget);
      console.log(`\nCritic scores for ${queue.length} of ${shelf.length} discovered titles…`);
      await pool(queue.map((r) => ({ t: r.t, y: r.y, rec: r })), CONCURRENCY, async (item) => {
        const held = heldRT.get(`${item.rec.t}::${item.rec.y}`);
        if (held != null) { item.rec.rt = held; item.rec.rtSrc = "rt"; return { ok: true, t: item.t }; }
        const res = await fetchOmdb(item.rec.imdb);
        if (res.rt != null) { item.rec.rt = res.rt; item.rec.rtSrc = "rt"; }
        return { ok: true, t: item.t };
      });
    }
  } else if (previous?.shelf) {
    /* No scan tonight (or every service failed): keep yesterday's shelf
       rather than reporting that every film on it has left. */
    if (!NO_DISCOVER) console.warn(`\n  !! no service could be read; keeping the shelf from the last good scan.`);
    shelf = previous.shelf.slice();
  }

  /* ---- what changed since yesterday --------------------------------------
     Only a scan that actually ran can claim a title has left. */
  const firstSeen = new Map();
  for (const r of previous?.shelf || []) if (r.firstSeen) firstSeen.set(`${norm(r.t)}::${r.y}`, r.firstSeen);
  const hadShelf = Array.isArray(previous?.shelf) && previous.shelf.length > 0;
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
  if (scanned) {
    const wasStreaming = new Set();
    for (const f of previous?.films || []) if ((f.providers || []).length) wasStreaming.add(f.t);
    for (const r of previous?.shelf  || []) wasStreaming.add(r.t);
    departed = [...wasStreaming].filter((t) => !nowStreaming.has(t));
  }

  const payload = {
    _meta: {
      generatedAt: new Date().toISOString(),
      region: REGION,
      source: OMDB ? "Movie of the Night + OMDb" : "Movie of the Night",
      attribution: { name: "Movie of the Night", url: "https://www.movieofthenight.com" },
      total: rows.length,
      matched: ok.length,
      checkedTonight: ok.filter((r) => !r.carried).length,
      carriedForward: carriedCurated,
      withProviders: ok.filter((r) => (r.providers || []).length).length,
      withRT: ok.filter((r) => r.rt != null).length,
      withOverview: ok.filter((r) => r.overview).length,
      tagged: ok.filter((r) => r.a).length,
      thinlyTagged: ok.filter((r) => r.a && r.a.length < 3).map((r) => `${r.t} (${r.y})`),
      omdbErrors: (() => {
        const tally = {};
        ok.forEach((r) => { if (r.omdbError) tally[r.omdbError] = (tally[r.omdbError] || 0) + 1; });
        return tally;
      })(),
      unmatched: missed.map((r) => `${r.t} (${r.y}): ${r.error || "unknown"}`),
      logos: (() => {
        const all = {};
        [...ok, ...shelf].forEach((r) => Object.entries(r.logos || {}).forEach(([code, url]) => {
          if (!all[code] && /^https:\/\//.test(url)) all[code] = url;
        }));
        /* keep last night's mark for a service nobody streamed on tonight; an
           older TMDB logo path still draws until a new mark replaces it */
        for (const [code, url] of Object.entries(previous?._meta?.logos || {})) {
          if (!all[code] && typeof url === "string" && url) all[code] = url;
        }
        return all;
      })(),
      scannedAt: today,
      scanOk: scanned,
      serviceScans,
      servicesMissed: failed,
      servicesDeferred: deferred,
      requests: calls.made,
      budget: BUDGET || null,
      shelfCount: shelf.length,
      streamingNow: nowStreaming.size,
      arrived,
      departed
    },
    films: ok.map(({ logos, _src, carried, ...rest }) => rest),
    shelf: shelf.map(({ logos, _src, ...rest }) => rest)
  };

  await mkdir(join(ROOT, "data"), { recursive: true });
  await writeFile(join(ROOT, "data", "catalog.json"), JSON.stringify(payload, null, 1) + "\n");

  /* The raw genres and synopsis terms behind every film's tags, one line a
     film. A record carried over from an earlier night keeps its earlier line. */
  let prevSrc = {};
  try { prevSrc = JSON.parse(await readFile(join(ROOT, "data", "keywords.json"), "utf8")); }
  catch { /* first run */ }
  const src = {};
  for (const r of [...ok, ...shelf]) {
    const key = `${r.t} (${r.y})`;
    if (r._src) src[key] = { curated: ok.includes(r), ...r._src };
    else if (prevSrc[key]) src[key] = prevSrc[key];
  }
  await writeFile(join(ROOT, "data", "keywords.json"),
    "{\n" + Object.entries(src).map(([k, v]) => JSON.stringify(k) + ":" + JSON.stringify(v)).join(",\n") + "\n}\n");

  console.log(`\nAPI calls        ${calls.made}${BUDGET ? ` of ${BUDGET}` : ""}`);
  console.log(`matched          ${ok.length}/${rows.length}${carriedCurated ? ` (${carriedCurated} carried from an earlier night)` : ""}`);
  console.log(`with providers   ${payload._meta.withProviders}`);
  console.log(`with RT score    ${payload._meta.withRT}${carried ? ` (${carried} held from the last good run)` : ""}`);
  const errs = Object.entries(payload._meta.omdbErrors || {});
  if (OMDB && errs.length) {
    console.log(`\nOMDb did not return scores. Reasons:`);
    errs.sort((a, b) => b[1] - a[1]).forEach(([msg, n]) => console.log(`  ${n}x  ${msg}`));
  }
  console.log(`with poster      ${ok.filter((r) => r.poster).length}`);
  console.log(`with synopsis    ${payload._meta.withOverview}`);
  console.log(`tagged by rule   ${payload._meta.tagged}${payload._meta.thinlyTagged.length ? ` (${payload._meta.thinlyTagged.length} with fewer than three attributes)` : ""}`);
  if (missed.length) {
    console.log(`\nunmatched (${missed.length}), check these by hand:`);
    missed.slice(0, 25).forEach((r) => console.log(`  - ${r.t} (${r.y}): ${r.error}`));
  }
  const suspect = ok.filter((r) => r.matched?.year && Math.abs(r.matched.year - r.y) > 1);
  if (suspect.length) {
    console.log(`\nyear drift, verify these matched the right film:`);
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
