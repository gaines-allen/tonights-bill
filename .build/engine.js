
/* ---------- catalog ---------- */
const FILMS = RAW.map(function(row,i){
  const o = {id:i};
  COLS.forEach(function(c,j){ o[c] = row[j]; });
  o.g = o.g.split("|"); o.a = o.a.split("|");
  o.svcs = [o.s];              /* enrichment can widen this to several services */
  o.poster = null; o.backdrop = null;   /* filled in by data/catalog.json when present */
  return o;
});
const BY_TITLE = {};
FILMS.forEach(function(f){ BY_TITLE[f.t] = f; });

/* Rarity weighting. "comic" and "brisk" are everywhere; "twisty" and "auteur" are not.
   A shared rare tag says far more about taste than a shared common one, so every tag
   is weighted by how uncommon it is across the catalog. */
const IDF_A = {}, IDF_G = {};
(function(){
  const dfA = {}, dfG = {}, N = FILMS.length;
  FILMS.forEach(function(f){
    f.a.forEach(function(x){ dfA[x] = (dfA[x]||0)+1; });
    f.g.forEach(function(x){ dfG[x] = (dfG[x]||0)+1; });
  });
  Object.keys(dfA).forEach(function(x){ IDF_A[x] = Math.log(N/dfA[x]) + 0.30; });
  Object.keys(dfG).forEach(function(x){ IDF_G[x] = Math.log(N/dfG[x]) + 0.30; });
})();
function idfA(x){ return IDF_A[x] || 1; }

/* weighted mean of a taste table over a film's tags, rare tags counting for more */
function wmean(keys, table, idf){
  let num = 0, den = 0;
  for(let i=0;i<keys.length;i++){
    const w = idf[keys[i]] || 1;
    num += (table[keys[i]]||0) * w;
    den += w;
  }
  return den ? num/den : 0;
}

/* ---------- vocab ---------- */
const SERVICES = [
  {k:"NFX", n:"Netflix",      c:"#E50914", on:true},
  {k:"MAX", n:"Max",          c:"#8A5CF6", on:true},
  {k:"HUL", n:"Hulu",         c:"#1CE783", on:true},
  {k:"DIS", n:"Disney+",      c:"#4B7BEC", on:true},
  {k:"PRV", n:"Prime Video",  c:"#00A8E1", on:true},
  {k:"APL", n:"Apple TV+",    c:"#9AA0A6", on:true},
  {k:"PAR", n:"Paramount+",   c:"#0064FF", on:false},
  {k:"PCK", n:"Peacock",      c:"#FCCC12", on:false}
];
const SVC_NAME = {}; SERVICES.forEach(function(s){ SVC_NAME[s.k]=s.n; });

const ROOMS = [
  {k:"solo",   n:"Just me",       floor:"adult",
   up:["cerebral","slowburn","weird","auteur","characterstudy","bleak","visual"], down:[]},
  {k:"two",    n:"Two of us",     floor:"adult",
   up:["romantic","dialogue","characterstudy","stylish","twisty","melancholy"], down:["violent"]},
  {k:"friends",n:"Friends over",  floor:"adult",
   up:["comic","ensemble","spectacle","propulsive","twisty","visceral","brisk"],
   down:["slowburn","bleak","cerebral","melancholy"]},
  {k:"teens",  n:"With teens",    floor:"teen",
   up:["propulsive","spectacle","earnest","comic","uplifting","twisty"], down:["slowburn","bleak"]},
  {k:"kids",   n:"Kids in the room", floor:"all",
   up:["uplifting","comic","cozy","earnest","spectacle","visual"],
   down:["bleak","violent","scary","slowburn"]}
];
const FLOOR_RANK = {all:0, teen:1, adult:2};

/* Content rating, as a FLOOR — the minimum maturity you want tonight. Picking R
   returns R and up, not everything below it. The top end is already capped by
   "Who's watching", so the two controls squeeze from opposite directions.
   NR titles (older films, festival and streaming releases that never went
   through the board) fall back to the audience column, so an unrated film is
   never silently treated as tamer than it is. */
const RATE_RANK = {"G":0, "PG":1, "PG-13":2, "R":3, "NC-17":4};
const NR_FALLBACK = {all:1, teen:2, adult:3};
const RATE_FLOORS = [
  {k:0, n:"Any"}, {k:1, n:"PG+"}, {k:2, n:"PG-13+"}, {k:3, n:"R"}
];
function floorName(k){
  const f = RATE_FLOORS.filter(function(c){ return c.k === k; })[0];
  return f ? f.n : "Any";
}
function rateRank(f){
  const r = RATE_RANK[f.mpaa];
  return (r === undefined) ? NR_FALLBACK[f.k] : r;
}

/* Moods are the consumer-facing way in. Each one is just a bundle of the
   attribute tags the scorer already understands, so nothing about the taste
   maths changes — a mood simply adds a second thing to match against. */
const MOODS = [
  {k:"easy",    n:"Easy win",        sub:"Nothing heavy",
   up:["brisk","comic","uplifting","cozy","propulsive"], down:["slowburn","bleak","cerebral"]},
  {k:"laugh",   n:"Make me laugh",   sub:"Actually funny",
   up:["comic","ironic","brisk","ensemble"],             down:["bleak","slowburn"]},
  {k:"guess",   n:"Keep me guessing",sub:"Twists and turns",
   up:["twisty","cerebral","propulsive","mystery"],      down:["cozy"]},
  {k:"big",     n:"Big movie",       sub:"Scale and spectacle",
   up:["spectacle","epic","practical","propulsive","visual"], down:["dialogue"]},
  {k:"weird",   n:"Something weird", sub:"Off the beaten path",
   up:["weird","auteur","visual","stylish"],             down:["grounded"]},
  {k:"acting",  n:"Great acting",    sub:"People, not plot",
   up:["characterstudy","dialogue","ensemble","earnest"],down:["spectacle"]},
  {k:"dark",    n:"Dark & intense",  sub:"Turn the lights off",
   up:["bleak","visceral","violent","slowburn","scary"], down:["comic","cozy","uplifting"]},
  {k:"comfort", n:"Comfort movie",   sub:"Something kind",
   up:["cozy","uplifting","earnest","romantic","hopeful"],down:["bleak","violent","scary"]}
];
const MOOD_BY = {}; MOODS.forEach(function(m){ MOOD_BY[m.k] = m; });

function moodVector(){
  const v = {};
  S.moods.forEach(function(k){
    const m = MOOD_BY[k]; if(!m) return;
    m.up.forEach(function(a){   v[a] = (v[a]||0) + 1; });
    m.down.forEach(function(a){ v[a] = (v[a]||0) - 0.8; });
  });
  return v;
}

/* Same rarity-weighted coverage idea the taste profile uses: how much of what
   tonight is asking for does this film actually carry? */
function moodScore(f, v){
  const keys = Object.keys(v);
  if(!keys.length) return 0.5;
  let mass = 0, hit = 0;
  keys.forEach(function(a){ if(v[a] > 0) mass += v[a] * idfA(a); });
  f.a.forEach(function(a){ if(v[a]) hit += v[a] * idfA(a); });
  f.g.forEach(function(g){ if(v[g]) hit += v[g] * idfA(g) * 0.6; });
  const cov = mass ? hit / mass : 0;
  return clamp((cov * 1.6 + 1) / 2, 0, 1);
}

const GENRES = ["action","adventure","animation","comedy","crime","documentary","drama","fantasy",
                "horror","musical","mystery","romance","scifi","thriller","war","family"];
const GENRE_LABEL = {scifi:"Sci-Fi", documentary:"Documentary"};
function gLabel(g){ return GENRE_LABEL[g] || g.charAt(0).toUpperCase()+g.slice(1); }

const ATTR_PHRASE = {
  slowburn:"slow-burn pacing", propulsive:"a relentless pace", brisk:"a brisk clip",
  bleak:"a bleak streak", hopeful:"hopefulness", comic:"comedy", melancholy:"melancholy",
  ironic:"irony", earnest:"earnestness", cerebral:"a cerebral bent", visceral:"visceral energy",
  spectacle:"spectacle", characterstudy:"close character work", twisty:"a twisting plot",
  visual:"visual storytelling", dialogue:"dialogue-driven scenes", ensemble:"a strong ensemble",
  auteur:"a singular director's hand", practical:"practical effects", violent:"hard violence",
  romantic:"romance", scary:"real scares", weird:"strangeness", grounded:"a grounded feel",
  stylish:"style", epic:"epic scale", cozy:"warmth", uplifting:"a lift at the end"
};

/* ---------- sourced data ----------
   data/catalog.json is produced by scripts/enrich.mjs from TMDB (and OMDb for
   real Rotten Tomatoes scores). It is optional on purpose: opened as a bare
   file, or served without it, the page falls back to its built-in catalog and
   says so. Nothing here ever blocks first render. */
const POSTER_BASE   = "https://image.tmdb.org/t/p/w342";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
let ENRICHED = null;

function applyEnrichment(payload){
  if(!payload || !Array.isArray(payload.films)) return false;
  let hit = 0;
  payload.films.forEach(function(e){
    const f = BY_TITLE[e.t];
    if(!f || f.y !== e.y) return;                       /* title+year must both agree */
    if(typeof e.runtime === "number" && e.runtime > 0) f.r = e.runtime;
    if(e.cert && RATE_RANK[e.cert] !== undefined)      f.mpaa = e.cert;
    if(typeof e.rt === "number")                        { f.rt = e.rt; f.rtSrc = "rt"; }
    else if(typeof e.tmdbScore === "number")            { f.rt = e.tmdbScore; f.rtSrc = "tmdb"; }
    if(Array.isArray(e.providers) && (e.providers.length || e.providersChecked)){
      f.svcs = e.providers.slice();
      f.svcChecked = true;      /* checked and empty means "on nothing", not "unknown" */
    }
    if(e.poster) f.poster = e.poster;
    if(e.backdrop) f.backdrop = e.backdrop;
    if(e.overview){ f.h = e.overview; f.hSrc = "tmdb"; }   /* real synopsis beats the terse hook */
    hit++;
  });
  ENRICHED = Object.assign({}, payload._meta, {applied: hit});
  return hit > 0;
}

async function loadEnrichment(){
  try{
    const res = await fetch("data/catalog.json", {cache:"no-cache"});
    if(!res.ok) return;
    if(applyEnrichment(await res.json())) afterEnrichment();
  }catch(e){ /* absent or blocked: built-in catalog stands */ }
}

/* ---------- storage ----------
   Some embedding contexts (sandboxed frames, data: URLs) block localStorage
   outright. Probe once so the page can tell the truth about whether a profile
   will actually survive the visit, and fall back to memory either way. */
const MEM = {};
let STORAGE_OK = false;
try {
  localStorage.setItem("tb:probe","1");
  localStorage.removeItem("tb:probe");
  STORAGE_OK = true;
} catch(e){ STORAGE_OK = false; }
function store(k,v){
  try{ localStorage.setItem("tb:"+k, JSON.stringify(v)); }catch(e){ MEM[k]=v; }
}
function load(k,dflt){
  try{
    const raw = localStorage.getItem("tb:"+k);
    if(raw !== null) return JSON.parse(raw);
  }catch(e){ if(k in MEM) return MEM[k]; }
  return (k in MEM) ? MEM[k] : dflt;
}

/* ---------- state ---------- */
const svcDefault = {};
SERVICES.forEach(function(s){ svcDefault[s.k] = s.on; });

const S = {
  room:    load("room","two"),
  time:    load("time",140),
  /* was a ceiling (99 meant "no limit"); anything out of floor range migrates to 0 */
  rate:    (function(v){ return (typeof v === "number" && v >= 0 && v <= 4) ? v : 0; })(load("rate",0)),
  fitOnly: load("fitOnly",false),
  minRT:   load("minRT",0),
  moods:   load("moods",[]),
  timePreset: load("timePreset",""),
  watched: load("watched",{}),
  bills:   load("bills",[]),
  locked:  load("locked",null),
  offered: load("offered",[]),
  genres:  load("genres",[]),
  svc:     Object.assign({}, svcDefault, load("svc",{})),
  taste:   load("taste",{}),
  ran:     false
};

function save(){
  store("room",S.room); store("time",S.time); store("genres",S.genres);
  store("svc",S.svc);   store("taste",S.taste);
  store("rate",S.rate); store("minRT",S.minRT); store("fitOnly",S.fitOnly);
  store("watched",S.watched); store("offered",S.offered);
  store("moods",S.moods); store("bills",S.bills); store("locked",S.locked);
  store("timePreset",S.timePreset);
}

/* ---------- evening history ----------
   Two memories doing two different jobs:
   watched  - you actually watched it, so never offer it again until cleared
   offered  - the last few bills, so tonight's does not repeat yesterday's */
const OFFER_MEMORY = 3;

function recentlyOfferedIndex(title){
  for(let i = 0; i < S.offered.length && i < OFFER_MEMORY; i++){
    if(S.offered[i].titles.indexOf(title) > -1) return i;
  }
  return -1;
}
function rememberOffer(titles){
  if(!titles.length) return;
  S.offered.unshift({at: new Date().toISOString(), titles: titles.slice(0,8)});
  S.offered = S.offered.slice(0, OFFER_MEMORY);
  save();
}
function markWatched(title){
  S.watched[title] = new Date().toISOString();
  save(); renderBill(); renderGrid(); renderHistory();
}
function unmarkWatched(title){
  delete S.watched[title];
  save(); renderBill(); renderGrid(); renderHistory();
}

/* ---------- helpers ---------- */
const $ = function(id){ return document.getElementById(id); };
function el(tag,cls,txt){
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(txt !== undefined) n.textContent = txt;
  return n;
}
function hm(m){
  const h = Math.floor(m/60), r = m%60;
  return h ? (h+"h" + (r ? " "+r+"m" : "")) : r+"m";
}
function clamp(v,lo,hi){ return v<lo?lo:(v>hi?hi:v); }
function room(){ return ROOMS.filter(function(r){ return r.k===S.room; })[0] || ROOMS[1]; }

/* ---------- taste model ---------- */
function buildTaste(){
  const aw = {}, gw = {}, dw = {};
  const loved = [], hated = [];
  Object.keys(S.taste).forEach(function(t){
    const f = BY_TITLE[t]; if(!f) return;
    (S.taste[t] === "loved" ? loved : hated).push(f);
  });
  function feed(list, sign){
    list.forEach(function(f){
      f.a.forEach(function(x){ aw[x] = (aw[x]||0) + sign; });
      f.g.forEach(function(x){ gw[x] = (gw[x]||0) + sign; });
      dw[f.d] = (dw[f.d]||0) + sign;
    });
  }
  feed(loved, 1);
  feed(hated, -1.15);          /* a miss is a sharper signal than a like */
  const n = loved.length + hated.length;
  if(n){
    /* Scale, don't clamp. Clamping saturates whatever tag is most common in the
       profile, which flattens the distinctive traits into the generic ones. */
    const d = Math.max(1, loved.length, hated.length);
    Object.keys(aw).forEach(function(k){ aw[k] = clamp(aw[k]/d, -1.3, 1.3); });
    Object.keys(gw).forEach(function(k){ gw[k] = clamp(gw[k]/d, -1.3, 1.3); });
  }
  /* total distinctive mass of what this viewer likes — the target a film tries to cover */
  let posMass = 0;
  Object.keys(aw).forEach(function(x){ if(aw[x] > 0) posMass += aw[x] * idfA(x); });
  return {aw:aw, gw:gw, dw:dw, loved:loved, hated:hated, n:n, posMass:posMass};
}

function mean(arr, fn){
  if(!arr.length) return 0;
  let s = 0;
  for(let i=0;i<arr.length;i++) s += fn(arr[i]);
  return s/arr.length;
}

/* ---------- scoring ---------- */
/* Single source of truth for "does this film fit tonight". The bill and the
   taste grid both call it, so the two can never disagree on screen again.
   Service is separate: it is reported rather than silently dropped. */
function checkFilters(f){
  const R = room();
  const roomOK = FLOOR_RANK[f.k] <= FLOOR_RANK[R.floor];
  const on = f.svcs.filter(function(c){ return S.svc[c]; });
  const genreOK = !S.genres.length || f.g.some(function(g){ return S.genres.indexOf(g)>-1; });
  return [
    {k:"clock", label:"Runtime", pass: f.r <= S.time,
     detail: f.r <= S.time
       ? hm(f.r) + " fits inside " + hm(S.time)
       : hm(f.r) + " runs past your " + hm(S.time) + " — " + hm(f.r - S.time) + " too long"},
    {k:"room", label:"Who’s watching", pass: roomOK,
     detail: roomOK
       ? "rated " + f.k + ", fine for " + R.n.toLowerCase()
       : "rated " + f.k + ", too old for " + R.n.toLowerCase()},
    {k:"rating", label:"Minimum rating", pass: rateRank(f) >= S.rate,
     detail: S.rate === 0 ? f.mpaa + ", no minimum set"
       : (rateRank(f) >= S.rate ? f.mpaa + " meets " + floorName(S.rate)
                                : f.mpaa + " is below your " + floorName(S.rate) + " floor")},
    {k:"critics", label:"Critic score", pass: f.rt >= S.minRT,
     detail: S.minRT === 0 ? f.rt + "%, no bar set"
       : (f.rt >= S.minRT ? f.rt + "% clears " + S.minRT + "%"
                          : f.rt + "% is under your " + S.minRT + "% bar")},
    {k:"genre", label:"Genre", pass: genreOK,
     detail: !S.genres.length ? f.g.map(gLabel).join(", ") + ", no genre filter"
       : (genreOK ? "matches " + f.g.filter(function(g){ return S.genres.indexOf(g)>-1; }).map(gLabel).join(", ")
                  : f.g.map(gLabel).join(", ") + " — none of them selected")},
    {k:"service", label:"Where it streams", pass: on.length > 0,
     detail: on.length ? "on " + on.map(function(c){ return SVC_NAME[c]; }).join(", ")
       : (f.svcs.length ? "only on " + f.svcs.map(function(c){ return SVC_NAME[c]; }).join(", ") + ", which you don’t have"
                        : (f.svcChecked ? "not on any subscription service right now — rent or buy only"
                                        : "no availability recorded"))}
  ];
}

/* Service is judged separately in scoreAll so it can report WHY a title is
   missing rather than silently dropping it, so it is excluded here. */
function hardPass(f){
  return checkFilters(f).every(function(c){ return c.k === "service" || c.pass; });
}
function fitsTonight(f){
  return checkFilters(f).every(function(c){ return c.pass; });
}

function scoreAll(){
  const T = buildTaste();
  const R = room();
  const floorMax = FLOOR_RANK[R.floor];
  const upSet = {}, downSet = {};
  R.up.forEach(function(x){ upSet[x]=1; });
  R.down.forEach(function(x){ downSet[x]=1; });

  const kept = [], lockedSvc = [], notStreaming = [], watched = [];
  const MV = moodVector();

  FILMS.forEach(function(f){
    if(S.taste[f.t]) return;                                  /* rated, so already seen */
    if(S.watched[f.t]){ watched.push(f); return; }            /* watched on a recent evening */
    if(!hardPass(f)) return;                                  /* clock, room, rating, score, genre */

    /* taste */
    /* purity  = of this film's own character, how much does the viewer like?
       coverage = of the viewer's distinctive taste, how much does this film hit?
       Purity alone lets a bland film win on two common tags; coverage is what
       rewards actually matching the rare traits the profile is built on. */
    let hit = 0, own = 0, cov = 0;
    for(let i=0;i<f.a.length;i++){
      const w = idfA(f.a[i]), a = T.aw[f.a[i]] || 0;
      own += w; hit += a*w;
      if(a > 0) cov += a*w;
    }
    const purity   = own ? hit/own : 0;
    const coverage = T.posMass ? Math.min(1, (cov/T.posMass) * 1.4) : 0;
    const attrScore  = 0.5*purity + 0.5*coverage;
    const genreTaste = wmean(f.g, T.gw, IDF_G);
    const dirScore   = clamp((T.dw[f.d]||0)/1.5, -1, 1);
    const tasteRaw   = 0.62*attrScore + 0.26*genreTaste + 0.12*dirScore;
    const tasteN     = T.n ? clamp((tasteRaw+1)/2, 0, 1) : 0.5;

    /* explicit genre ask */
    let genreN = 0.55;
    if(S.genres.length){
      const hits = f.g.filter(function(g){ return S.genres.indexOf(g)>-1; }).length;
      genreN = clamp(hits / Math.min(f.g.length, S.genres.length), 0, 1);
    }

    /* room fit */
    const roomRaw = mean(f.a, function(x){
      return upSet[x] ? 1 : (downSet[x] ? -1 : 0);
    });
    const roomN = clamp((roomRaw+1)/2, 0, 1);

    /* recognizability — a light tiebreak, heavier with a crowd */
    const fameN = f.pop === 3 ? 1 : (f.pop === 2 ? 0.82 : 0.62);
    /* With nothing tagged, recognizability is the only honest tiebreak. Once the
       viewer has a real profile, fame must get out of the way of it. */
    const fameW = !T.n ? 0.34
                : ((S.room === "friends" || S.room === "kids") ? 0.16 : 0.09)
                  / (1 + T.n * 0.35);

    const moodN = moodScore(f, MV);
    const W = {taste:0.46, genre:0.22, room:0.18, fame:fameW, mood: S.moods.length ? 0.40 : 0};
    let score = (W.taste*tasteN + W.genre*genreN + W.room*roomN + W.fame*fameN + W.mood*moodN) /
                (W.taste + W.genre + W.room + W.fame + W.mood);

    /* Shown on a recent evening? Nudge it down so the bill is not word-for-word
       identical night after night. Small and bounded — this reorders near-ties,
       it never buries a genuinely better match. */
    const seenIdx = recentlyOfferedIndex(f.t);
    const stale = seenIdx === -1 ? 0 : (0.05 - seenIdx * 0.015);
    score = score * (1 - stale);

    const on = f.svcs.filter(function(c){ return S.svc[c]; });
    const rec = {f:f, score:score, taste:tasteRaw, T:T, upSet:upSet, on:on,
                 parts:{taste:tasteN, genre:genreN, room:roomN, fame:fameN, mood:moodN},
                 weights:W, stale:stale, seenIdx:seenIdx};
    if(!f.svcs.length && f.svcChecked){ notStreaming.push(rec); return; }  /* rent or buy only */
    if(!on.length){ lockedSvc.push(rec); return; }                        /* carried, not by you */
    kept.push(rec);
  });

  kept.sort(function(a,b){ return b.score - a.score; });
  lockedSvc.sort(function(a,b){ return b.score - a.score; });
  notStreaming.sort(function(a,b){ return b.score - a.score; });
  return {picks:kept, locked:lockedSvc, notStreaming:notStreaming, watched:watched, T:T};
}

/* A good film the profile would not have surfaced: strong on its own merits,
   weak on taste overlap. Deliberately drawn from outside the leading group. */
function wildCard(picks){
  if(picks.length < 6) return null;
  const tail = picks.slice(4);
  const scored = tail
    .filter(function(r){ return r.f.rt >= 82; })
    .map(function(r){ return {r:r, off: (r.f.rt/100) - r.parts.taste}; })
    .sort(function(a,b){ return b.off - a.off; });
  return scored.length ? scored[0].r : null;
}

/* Two films that both fit inside the evening, with a change of pace between
   them — a second helping of the same thing is not a double feature. */
function doubleFeature(picks, budget){
  for(let i = 0; i < picks.length && i < 6; i++){
    for(let j = i + 1; j < picks.length && j < 10; j++){
      const a = picks[i].f, b = picks[j].f;
      if(a.r + b.r + 15 > budget) continue;
      const shared = a.a.filter(function(x){ return b.a.indexOf(x) > -1; }).length;
      if(shared > 2) continue;
      return [picks[i], picks[j]];
    }
  }
  return null;
}

/* ---------- reasoning ---------- */
function why(rec){
  const f = rec.f, T = rec.T;
  const bits = [];

  if(T.n){
    /* which loved title does this most resemble? */
    let best = null, bestN = 0;
    T.loved.forEach(function(L){
      const shared = f.a.filter(function(x){ return L.a.indexOf(x)>-1; });
      let mass = 0;
      shared.forEach(function(x){ mass += idfA(x); });
      if(mass > bestN){
        shared.sort(function(a,b){ return idfA(b)-idfA(a); });   /* rarest first */
        bestN = mass; best = {L:L, shared:shared, n:shared.length};
      }
    });
    const strong = f.a
      .filter(function(x){ return (T.aw[x]||0) > 0.12; })
      .sort(function(a,b){ return (T.aw[b]||0)*idfA(b) - (T.aw[a]||0)*idfA(a); });

    if(best && best.n >= 2){
      const ph = best.shared.slice(0,2).map(function(x){ return ATTR_PHRASE[x]||x; });
      bits.push("Shares " + ph.join(" and ") + " with <b>" + best.L.t + "</b>, which you loved.");
    }else if(strong.length){
      bits.push("Leans on " + strong.slice(0,2).map(function(x){ return ATTR_PHRASE[x]||x; }).join(" and ") +
                " &mdash; what your picks keep pointing at.");
    }

    /* director echo */
    if((T.dw[f.d]||0) > 0 && (!best || best.L.d !== f.d)){
      bits.push("Same director you already rated well: " + f.d + ".");
    }
    /* honest caveat when a disliked trait is present */
    const risk = f.a
      .filter(function(x){ return (T.aw[x]||0) < -0.22; })
      .sort(function(a,b){ return (T.aw[a]||0)-(T.aw[b]||0); })[0];
    if(risk){
      bits.push("Fair warning: it does have " + (ATTR_PHRASE[risk]||risk) + ", which your misses share.");
    }
  }

  /* room note */
  const R = room();
  const roomHits = f.a.filter(function(x){ return rec.upSet[x]; })
                       .sort(function(a,b){ return idfA(b)-idfA(a); });
  if(roomHits.length >= 2 && S.room !== "solo"){
    bits.push("Built for " + R.n.toLowerCase() + ": " +
      roomHits.slice(0,2).map(function(x){ return ATTR_PHRASE[x]||x; }).join(" and ") + ".");
  }

  /* clock note */
  const slack = S.time - f.r;
  if(slack <= 12) bits.push("Uses nearly all the time you have &mdash; " + hm(f.r) + " against " + hm(S.time) + ".");
  else if(slack >= 55) bits.push("Leaves " + hm(slack) + " on the clock.");

  if(!bits.length) bits.push("A clean fit for the runtime and the room. Tag a few titles above and this gets sharper.");
  return bits.slice(0,3).join(" ");
}

