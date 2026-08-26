/* ============================================================
   Presentation. The engine above decides what to watch; nothing
   down here changes a score, it only stages the result.
   ============================================================ */

const AUDIENCES = [
  {k:"solo",    n:"Just me",    d:"Anything goes"},
  {k:"two",     n:"Date night", d:"Two on the couch"},
  {k:"friends", n:"Friends",    d:"A room to please"},
  {k:"teens",   n:"Family",     d:"Nothing too grown-up"}
];
const TIMES = [
  {k:"short", n:"Under 90",          d:"In and out",        mins:100},
  {k:"two",   n:"About two hours",   d:"The usual",         mins:135},
  {k:"long",  n:"We've got all night", d:"Bring something big", mins:240}
];

let SCREEN = "tonight";
let LAST = null;          /* most recent scoring run */
let HEAD = null;          /* the headliner currently on screen */
let WHY_OPEN = false;
let REROLLS = 0;          /* how deep into the ranking a reroll has gone */

/* ---------- small builders ---------- */
function posterFrame(f, cls){
  const box = el("div", "poster-frame" + (cls ? " " + cls : ""));
  if(f.poster){
    box.classList.add("ldg");
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "Poster for " + f.t;
    img.src = POSTER_BASE + f.poster;
    img.addEventListener("load",  function(){ box.classList.remove("ldg"); });
    img.addEventListener("error", function(){ box.classList.remove("ldg"); img.remove(); fallback(); });
    box.appendChild(img);
  } else { fallback(); }
  function fallback(){
    const fb = el("div","poster-fallback");
    fb.appendChild(el("span","pt", f.t));
    fb.appendChild(el("span","py", String(f.y)));
    box.appendChild(fb);
  }
  return box;
}
function pct(rec){ return Math.round(rec.score * 100); }
function clock(mins){
  const d = new Date(Date.now() + mins * 60000);
  return d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
}
function svcLine(rec){
  const on = rec.on && rec.on.length ? rec.on : rec.f.svcs;
  return on.map(function(c){ return SVC_NAME[c]; }).filter(Boolean);
}

/* ---------- screens ---------- */
function showScreen(name){
  SCREEN = name;
  ["tonight","bill","taste","bills"].forEach(function(s){
    $("s-" + s).classList.toggle("on", s === name);
  });
  document.querySelectorAll(".nav button").forEach(function(b){
    const target = b.dataset.go === "tonight" && name === "bill" ? "tonight" : b.dataset.go;
    if(target === b.dataset.go) b.setAttribute("aria-current", b.dataset.go === (name === "bill" ? "tonight" : name) ? "page" : "false");
  });
  if(name === "taste") renderTaste();
  if(name === "bills") renderPastBills();
  window.scrollTo({top:0, behavior:"instant"});
}

/* ---------- question one ---------- */
function renderWho(){
  const w = $("q-who"); w.innerHTML = "";
  AUDIENCES.forEach(function(a){
    const b = el("button","card"); b.type = "button";
    b.setAttribute("aria-pressed", S.room === a.k ? "true" : "false");
    b.appendChild(el("span","k", a.n));
    b.appendChild(el("span","d", a.d));
    b.addEventListener("click", function(){ S.room = a.k; save(); renderWho(); renderAudienceChips(); gate(); });
    w.appendChild(b);
  });
}

/* ---------- question two ---------- */
function renderTime(){
  const w = $("q-time"); w.innerHTML = "";
  TIMES.forEach(function(t){
    const b = el("button","card"); b.type = "button";
    b.setAttribute("aria-pressed", S.timePreset === t.k ? "true" : "false");
    b.appendChild(el("span","k", t.n));
    b.appendChild(el("span","d", t.d));
    b.addEventListener("click", function(){
      S.timePreset = t.k; S.time = t.mins; save();
      $("time-range").value = t.mins; syncExact(); renderTime(); gate();
    });
    w.appendChild(b);
  });
}
function syncExact(){
  $("time-read").textContent = S.time;
  $("time-hm").textContent = "min · " + hm(S.time);
}

/* ---------- question three ---------- */
function renderMoods(){
  const w = $("q-mood"); w.innerHTML = "";
  MOODS.forEach(function(m){
    const b = el("button","mood"); b.type = "button";
    b.setAttribute("aria-pressed", S.moods.indexOf(m.k) > -1 ? "true" : "false");
    b.appendChild(el("span","k", m.n));
    b.appendChild(el("span","d", m.sub));
    b.addEventListener("click", function(){
      const i = S.moods.indexOf(m.k);
      if(i > -1) S.moods.splice(i,1); else S.moods.push(m.k);
      save(); renderMoods(); gate();
    });
    w.appendChild(b);
  });
}

function gate(){
  const ready = !!S.room && !!S.timePreset;
  $("show-bill").disabled = !ready;
  const tagged = Object.keys(S.taste).length;
  $("cta-note").textContent = !ready
    ? "Answer the first two and we'll take it from there."
    : (tagged ? "" : "Tip: teach us five films you love and this gets a lot sharper.");
  $("dealer").style.display = tagged >= 3 ? "" : "none";
}

/* ---------- fine tune ---------- */
function renderAudienceChips(){
  const w = $("f-audience"); if(!w) return;
  w.innerHTML = "";
  ROOMS.forEach(function(r){
    const b = el("button","chip", r.n); b.type = "button";
    b.setAttribute("aria-pressed", S.room === r.k ? "true" : "false");
    b.addEventListener("click", function(){ S.room = r.k; save(); renderAudienceChips(); renderWho(); gate(); });
    w.appendChild(b);
  });
}
function renderRatingChips(){
  const w = $("f-rating"); w.innerHTML = "";
  RATE_FLOORS.forEach(function(c){
    const b = el("button","chip", c.n); b.type = "button";
    b.setAttribute("aria-pressed", S.rate === c.k ? "true" : "false");
    b.addEventListener("click", function(){ S.rate = c.k; save(); renderRatingChips(); });
    w.appendChild(b);
  });
}
function renderGenreChips(){
  const w = $("f-genres"); w.innerHTML = "";
  GENRES.forEach(function(g){
    const b = el("button","chip", gLabel(g)); b.type = "button";
    b.setAttribute("aria-pressed", S.genres.indexOf(g) > -1 ? "true" : "false");
    b.addEventListener("click", function(){
      const i = S.genres.indexOf(g);
      if(i > -1) S.genres.splice(i,1); else S.genres.push(g);
      save(); renderGenreChips();
    });
    w.appendChild(b);
  });
}
function renderServiceRows(){
  const w = $("f-services"); w.innerHTML = "";
  SERVICES.forEach(function(s){
    const row = el("div","svc-row" + (S.svc[s.k] ? "" : " off"));
    row.appendChild(el("span","n", s.n));
    const sw = el("button","sw"); sw.type = "button";
    sw.setAttribute("aria-pressed", S.svc[s.k] ? "true" : "false");
    sw.setAttribute("aria-label", s.n);
    sw.addEventListener("click", function(){ S.svc[s.k] = !S.svc[s.k]; save(); renderServiceRows(); });
    row.appendChild(sw);
    w.appendChild(row);
  });
}

/* ---------- the reveal ---------- */
function programEvening(opts){
  opts = opts || {};
  REROLLS = opts.keepDepth ? REROLLS : 0;
  const out = scoreAll();
  LAST = out;
  showScreen("bill");
  renderBill(out);
  if(!opts.silent && out.picks.length){
    rememberOffer(out.picks.slice(0,8).map(function(r){ return r.f.t; }));
  }
}

function renderBill(out){
  const picks = out.picks;
  $("bill-recap").innerHTML = "";
  [["Room", (ROOMS.filter(function(r){return r.k===S.room;})[0]||{}).n || "—"],
   ["Under", hm(S.time)],
   S.moods.length ? ["Mood", S.moods.map(function(k){ return MOOD_BY[k].n; }).join(", ")] : null,
   ["On", SERVICES.filter(function(s){ return S.svc[s.k]; }).length + " services"]
  ].filter(Boolean).forEach(function(pair){
    const c = el("span"); c.innerHTML = pair[0] + " <b>" + pair[1] + "</b>";
    $("bill-recap").appendChild(c);
  });

  const head = $("headliner-slot"); head.innerHTML = "";
  const also = $("also-slot");      also.innerHTML = "";
  const dbl  = $("double-slot");    dbl.innerHTML  = "";
  $("why-panel").classList.add("hide"); WHY_OPEN = false;
  renderLocked();

  if(!picks.length){ renderNothing(head); renderNotice(out); return; }

  const idx = Math.min(REROLLS, Math.max(0, picks.length - 1));
  HEAD = picks[idx];
  head.appendChild(headliner(HEAD));

  const rest = picks.filter(function(r){ return r !== HEAD; });
  const alts = rest.slice(0, 2);
  const wild = wildCard(rest);
  if(alts.length){
    also.appendChild(el("p","strip-head","Also playing"));
    const g = el("div","also");
    alts.forEach(function(r){ g.appendChild(altCard(r)); });
    if(wild && alts.indexOf(wild) === -1) g.appendChild(altCard(wild, true));
    also.appendChild(g);
  }

  const pair = doubleFeature(picks, S.time);
  if(S.timePreset === "long" && pair) dbl.appendChild(doubleCard(pair));

  renderNotice(out);
}

function headliner(rec){
  const f = rec.f;
  const box = el("div","headliner reveal");
  if(f.backdrop){
    const bd = el("div","backdrop");
    bd.style.backgroundImage = "url(" + BACKDROP_BASE + f.backdrop + ")";
    box.appendChild(bd);
  }
  box.appendChild(posterFrame(f));

  const b = el("div","hl-body reveal-2");
  b.appendChild(el("h3","",f.t));

  const meta = el("div","meta");
  [String(f.y), f.mpaa, hm(f.r)].forEach(function(v,i){
    if(i) meta.appendChild(el("i","","·"));
    meta.appendChild(el("span","",v));
  });
  meta.appendChild(el("i","","·"));
  meta.appendChild(el("span","", f.rt + "% critics"));
  b.appendChild(meta);

  const m = el("div","match");
  m.appendChild(el("span","n mono", pct(rec) + "%"));
  m.appendChild(el("span","l","Tonight match"));
  b.appendChild(m);

  const pitch = el("p","pitch");
  pitch.innerHTML = why(rec);
  b.appendChild(pitch);

  if(f.hSrc === "tmdb") b.appendChild(el("p","synopsis", f.h));

  const names = svcLine(rec);
  if(names.length){
    const w = el("div","where");
    w.appendChild(el("span","","Streaming on"));
    names.slice(0,3).forEach(function(n){ w.appendChild(el("span","tag",n)); });
    b.appendChild(w);
  }

  const acts = el("div","acts");
  const watch = el("button","btn-primary","Watch this"); watch.type = "button";
  watch.addEventListener("click", function(){ lockBill(rec); });
  acts.appendChild(watch);

  const again = el("button","ghost","Give me another"); again.type = "button";
  again.addEventListener("click", function(){
    REROLLS++;
    if(REROLLS >= LAST.picks.length) REROLLS = 0;
    renderBill(LAST);
    $("headliner-slot").scrollIntoView({behavior:"smooth", block:"start"});
  });
  acts.appendChild(again);

  const whyBtn = el("button","ghost","Why this?"); whyBtn.type = "button";
  whyBtn.addEventListener("click", function(){ toggleWhy(rec); });
  acts.appendChild(whyBtn);
  b.appendChild(acts);

  box.appendChild(b);
  return box;
}

function altCard(rec, isWild){
  const f = rec.f;
  const c = el("button","alt" + (isWild ? " wild" : "")); c.type = "button";
  c.setAttribute("aria-label", "Make " + f.t + " tonight's pick");
  if(isWild) c.appendChild(el("span","badge","Wild card"));
  c.appendChild(posterFrame(f));
  c.appendChild(el("h4","",f.t));
  c.appendChild(el("p","m mono", f.y + " · " + hm(f.r) + " · " + f.rt + "%"));
  const names = svcLine(rec);
  c.appendChild(el("p","why-line", names.length ? "On " + names[0] : "Rent or buy"));
  c.addEventListener("click", function(){
    const i = LAST.picks.indexOf(rec);
    if(i > -1){ REROLLS = i; renderBill(LAST); }
    $("headliner-slot").scrollIntoView({behavior:"smooth", block:"start"});
  });
  return c;
}

function doubleCard(pair){
  const box = el("div","dbl reveal-3");
  box.appendChild(el("p","strip-head","Double feature — you said all night"));
  const row = el("div","dbl-films");
  const a = pair[0].f, b = pair[1].f;
  row.appendChild(filmSlot(a, clock(0)));
  row.appendChild(el("div","dbl-then","then"));
  row.appendChild(filmSlot(b, clock(a.r + 15)));
  box.appendChild(row);
  function filmSlot(f, at){
    const d = el("div","dbl-film");
    d.appendChild(posterFrame(f));
    const t = el("div");
    t.appendChild(el("div","t",f.t));
    t.appendChild(el("div","s mono", at + " · " + hm(f.r)));
    d.appendChild(t);
    return d;
  }
  return box;
}

/* ---------- why this? ---------- */
function toggleWhy(rec){
  const p = $("why-panel");
  WHY_OPEN = !WHY_OPEN;
  p.classList.toggle("hide", !WHY_OPEN);
  if(!WHY_OPEN) return;
  p.innerHTML = "";
  const T = rec.T;

  const cols = el("div","why-cols");

  /* what we think you like */
  const likes = el("div","why-col");
  likes.appendChild(el("h4","","You tend to like"));
  const ul1 = document.createElement("ul");
  tasteTraits(T, 4).forEach(function(t){ const li=document.createElement("li"); li.textContent=t; ul1.appendChild(li); });
  if(!ul1.children.length){
    const li=document.createElement("li");
    li.textContent = "Nothing taught yet — this pick is running on tonight's answers alone.";
    ul1.appendChild(li);
  }
  likes.appendChild(ul1);
  cols.appendChild(likes);

  /* how tonight's constraints played out */
  const fits = el("div","why-col");
  fits.appendChild(el("h4","","Tonight"));
  const ul2 = document.createElement("ul");
  checkFilters(rec.f).forEach(function(c){
    if(!c.pass) return;
    const li = document.createElement("li");
    li.textContent = c.detail;
    ul2.appendChild(li);
  });
  fits.appendChild(ul2);
  cols.appendChild(fits);

  /* the films that pulled it in */
  const seedFilms = seeds(rec, T, 3);
  if(seedFilms.length){
    const sc = el("div","why-col");
    sc.appendChild(el("h4","","Feels closest to"));
    const row = el("div","seeds");
    seedFilms.forEach(function(L){
      const s = el("div","seed");
      s.appendChild(posterFrame(L));
      s.appendChild(el("div","sn", L.t));
      row.appendChild(s);
    });
    sc.appendChild(row);
    cols.appendChild(sc);
  }
  p.appendChild(cols);
  p.scrollIntoView({behavior:"smooth", block:"nearest"});
}

/* Plain-English read of the taste profile, strongest and rarest first. */
function tasteTraits(T, n){
  if(!T || !T.n) return [];
  return Object.keys(T.aw)
    .filter(function(a){ return T.aw[a] > 0.25 && ATTR_PHRASE[a]; })
    .sort(function(a,b){ return (T.aw[b]*idfA(b)) - (T.aw[a]*idfA(a)); })
    .slice(0, n)
    .map(function(a){ return ATTR_PHRASE[a]; });
}
function seeds(rec, T, n){
  if(!T || !T.loved.length) return [];
  return T.loved.map(function(L){
      let mass = 0;
      rec.f.a.forEach(function(x){ if(L.a.indexOf(x) > -1) mass += idfA(x); });
      return {L:L, mass:mass};
    })
    .filter(function(x){ return x.mass > 0; })
    .sort(function(a,b){ return b.mass - a.mass; })
    .slice(0, n)
    .map(function(x){ return x.L; });
}

/* ---------- lock the bill ---------- */
function lockBill(rec){
  const f = rec.f;
  S.locked = {t:f.t, at:new Date().toISOString(), mins:f.r};
  S.bills = (S.bills || []).filter(function(b){ return b.t !== f.t; });
  S.bills.unshift({t:f.t, at:S.locked.at});
  S.bills = S.bills.slice(0, 24);
  markWatched(f.t);
  save();
  renderLocked();
  $("locked-slot").scrollIntoView({behavior:"smooth", block:"start"});
}
function renderLocked(){
  const w = $("locked-slot"); w.innerHTML = "";
  if(!S.locked) return;
  const f = BY_TITLE[S.locked.t];
  if(!f){ S.locked = null; return; }
  const card = el("div","locked-card reveal");
  card.appendChild(posterFrame(f));
  const b = el("div");
  b.appendChild(el("p","eyebrow","Tonight's bill is set"));
  b.appendChild(el("h3","",f.t));
  const times = el("div","showtimes");
  [["Start","now"], ["Feature ends", clock(f.r)], ["Running", hm(f.r)],
   ["Where", (f.svcs.map(function(c){return SVC_NAME[c];})[0] || "rent or buy")]
  ].forEach(function(p){
    const s = el("div","showtime");
    s.appendChild(el("div","l",p[0]));
    s.appendChild(el("div","v",p[1]));
    times.appendChild(s);
  });
  b.appendChild(times);
  const un = el("button","ghost","Change my mind"); un.type = "button";
  un.style.marginTop = "20px";
  un.addEventListener("click", function(){
    unmarkWatched(S.locked.t); S.locked = null; save();
    renderLocked(); if(LAST) renderBill(scoreAll());
  });
  b.appendChild(un);
  card.appendChild(b);
  w.appendChild(card);
}

/* ---------- nothing made the cut ---------- */
function renderNothing(host){
  const e = el("div","empty");
  e.appendChild(el("h3","","Nothing made the cut."));
  e.appendChild(el("p","","Tonight's answers rule out everything we have. Loosen one and we'll find something worth watching."));
  const acts = el("div","acts"); acts.style.justifyContent = "center";
  const relax = el("button","btn-primary","Relax the filters"); relax.type = "button";
  relax.addEventListener("click", function(){
    S.genres = []; S.rate = 0; S.minRT = 0;
    if(S.time < 150){ S.time = 150; S.timePreset = "long"; $("time-range").value = 150; syncExact(); }
    save(); renderRatingChips(); renderGenreChips(); $("rt-range").value = 0; $("rt-read").textContent = "0";
    renderTime(); programEvening({silent:true});
  });
  acts.appendChild(relax);
  const back = el("button","ghost","Change my answers"); back.type = "button";
  back.addEventListener("click", function(){ showScreen("tonight"); });
  acts.appendChild(back);
  e.appendChild(acts);
  host.appendChild(e);
}

function renderNotice(out){
  const n = $("bill-notice"); n.innerHTML = "";
  const bits = [];
  const bar = out.picks.length ? out.picks[out.picks.length-1].score : 0.5;
  const locked = (out.locked||[]).filter(function(r){ return r.score >= bar; });
  const gone   = (out.notStreaming||[]).filter(function(r){ return r.score >= bar; });
  if(locked.length) bits.push("<b>" + locked.length + "</b> would have made it but sit on a service you don't have.");
  if(gone.length)   bits.push("<b>" + gone.length + "</b> are rent-or-buy only tonight.");
  if((out.watched||[]).length) bits.push("<b>" + out.watched.length + "</b> held back because you've already seen them.");
  if(bits.length) n.innerHTML = bits.join(" ");
}

/* ---------- teach us your taste ---------- */
let tasteQ = "";
const TASTE_TARGET = 5;

function renderTaste(){
  const loved = Object.keys(S.taste).filter(function(t){ return S.taste[t] === "loved"; });
  const pipRow = $("pips"); pipRow.innerHTML = "";
  for(let i = 0; i < TASTE_TARGET; i++){
    pipRow.appendChild(el("span","pip" + (i < loved.length ? " on" : "")));
  }
  const msgs = [
    "Pick one you love and we'll start guessing less.",
    "One down. Keep going.",
    "Two in. We're getting a shape.",
    "Three down. Two more and we're dangerous.",
    "One more and we'll stop guessing.",
    "That'll do it. We know you."
  ];
  $("taste-msg").textContent = msgs[Math.min(loved.length, msgs.length - 1)];

  const prof = $("taste-profile"); prof.innerHTML = "";
  const T = buildTaste();
  tasteTraits(T, 6).forEach(function(t){ prof.appendChild(el("span","trait", t)); });

  const g = $("taste-grid"); g.innerHTML = "";
  const q = tasteQ.trim().toLowerCase();
  const list = FILMS.filter(function(f){
      if(!q) return true;
      return f.t.toLowerCase().indexOf(q) > -1 || f.d.toLowerCase().indexOf(q) > -1;
    })
    .sort(function(a,b){
      const sa = S.taste[a.t] ? 1 : 0, sb = S.taste[b.t] ? 1 : 0;
      return (sb - sa) || (b.pop - a.pop) || (b.y - a.y);
    })
    .slice(0, q ? 60 : 60);

  if(!list.length){
    g.appendChild(el("p","", "Nothing matches “" + tasteQ + "”."));
    return;
  }
  list.forEach(function(f){ g.appendChild(tasteCard(f)); });
}

function tasteCard(f){
  const state = S.taste[f.t] || "";
  const c = el("div","tcard");
  if(state) c.setAttribute("data-state", state);
  const frame = posterFrame(f);
  if(state) frame.appendChild(el("span","state-flag", state === "loved" ? "Loved" : "Not for me"));
  const acts = el("div","tcard-acts");
  const love = el("button","mini love", state === "loved" ? "Loved" : "Love it"); love.type = "button";
  love.setAttribute("aria-label", "Mark " + f.t + " as loved");
  love.addEventListener("click", function(e){
    e.stopPropagation();
    if(S.taste[f.t] === "loved") delete S.taste[f.t]; else S.taste[f.t] = "loved";
    save(); renderTaste(); gate();
  });
  const nope = el("button","mini nope", state === "hated" ? "Nope" : "Not for me"); nope.type = "button";
  nope.setAttribute("aria-label", "Mark " + f.t + " as not for me");
  nope.addEventListener("click", function(e){
    e.stopPropagation();
    if(S.taste[f.t] === "hated") delete S.taste[f.t]; else S.taste[f.t] = "hated";
    save(); renderTaste(); gate();
  });
  acts.appendChild(love); acts.appendChild(nope);
  frame.appendChild(acts);
  c.appendChild(frame);
  c.appendChild(el("span","tt", f.t));
  c.appendChild(el("span","ty mono", f.y + " · " + hm(f.r)));
  return c;
}

/* ---------- past bills ---------- */
function renderPastBills(){
  const w = $("bills-slot"); w.innerHTML = "";
  const bills = (S.bills || []).filter(function(b){ return BY_TITLE[b.t]; });
  if(!bills.length){
    const e = el("div","empty");
    e.appendChild(el("h3","","No bills yet."));
    e.appendChild(el("p","","Once you lock something in, it lands here. Consider this the stub drawer."));
    const go = el("button","btn-primary","Programme tonight"); go.type = "button";
    go.addEventListener("click", function(){ showScreen("tonight"); });
    e.appendChild(go);
    w.appendChild(e);
    return;
  }
  const list = el("div","bills-list");
  bills.forEach(function(b){
    const f = BY_TITLE[b.t];
    const row = el("div","bill-row");
    row.appendChild(posterFrame(f));
    const mid = el("div");
    mid.appendChild(el("div","t", f.t));
    mid.appendChild(el("div","d mono",
      new Date(b.at).toLocaleDateString([], {month:"short", day:"numeric"}) + " · " + hm(f.r) + " · " + f.mpaa));
    row.appendChild(mid);
    const rm = el("button","ghost","Remove"); rm.type = "button";
    rm.addEventListener("click", function(){
      S.bills = S.bills.filter(function(x){ return x.t !== b.t; });
      unmarkWatched(b.t);
      if(S.locked && S.locked.t === b.t) S.locked = null;
      save(); renderPastBills();
    });
    row.appendChild(rm);
    list.appendChild(row);
  });
  w.appendChild(list);
}

/* ---------- provenance ---------- */
function renderFoot(){
  const rtCount = FILMS.filter(function(f){ return f.rtSrc === "rt"; }).length;
  let t = "244 films, hand-tagged for pace, tone and how much a night they ask of you. ";
  t += ENRICHED
    ? ("Runtimes, ratings, posters, synopses and streaming availability from " + ENRICHED.source +
       ", refreshed daily. " + (rtCount ? "Critic scores are Rotten Tomatoes, via OMDb. " : "") +
       "Availability is accurate to about a day, not the minute. ")
    : "Streaming homes and critic scores here are our own estimates, not sourced feeds. ";
  t += STORAGE_OK ? "Your taste is saved in this browser only." : "This viewer blocks storage, so tonight's answers last for this visit.";
  $("foot").textContent = t;
}

/* Sourced data lands after first paint; repaint whatever is on screen. */
function afterEnrichment(){
  renderFoot(); renderLocked();
  if(SCREEN === "taste") renderTaste();
  if(SCREEN === "bills") renderPastBills();
  if(SCREEN === "bill"){ const out = scoreAll(); LAST = out; renderBill(out); }
}

/* ---------- theme ---------- */
function applyTheme(mode){
  const r = document.documentElement, b = $("themebtn");
  if(mode === "light") r.setAttribute("data-theme","light"); else r.removeAttribute("data-theme");
  b.textContent = mode === "light" ? "☀" : "☽";
  b.setAttribute("aria-label", "Theme is " + (mode === "light" ? "light" : "dark") + ". Activate to switch.");
}

/* ---------- boot ---------- */
function init(){
  renderWho(); renderTime(); renderMoods();
  renderRatingChips(); renderGenreChips(); renderServiceRows(); renderAudienceChips();
  syncExact(); gate(); renderFoot(); renderLocked();

  $("time-range").value = S.time;
  $("time-range").addEventListener("input", function(e){
    S.time = parseInt(e.target.value,10); S.timePreset = "exact";
    syncExact(); renderTime(); gate();
  });
  $("time-range").addEventListener("change", save);

  $("rt-range").value = S.minRT;
  $("rt-read").textContent = S.minRT;
  $("rt-range").addEventListener("input", function(e){
    S.minRT = parseInt(e.target.value,10); $("rt-read").textContent = S.minRT;
  });
  $("rt-range").addEventListener("change", save);

  $("exact-toggle").addEventListener("click", function(){
    const p = $("exact-panel"), open = p.classList.toggle("hide");
    $("exact-toggle").setAttribute("aria-expanded", open ? "false" : "true");
  });

  $("show-bill").addEventListener("click", function(){ programEvening(); });
  $("back-tonight").addEventListener("click", function(){ showScreen("tonight"); });

  $("dealer").addEventListener("click", function(){
    if(!S.room) S.room = "two";
    if(!S.timePreset){ S.timePreset = "two"; S.time = 135; }
    S.moods = [];
    save(); renderWho(); renderTime(); renderMoods(); gate();
    programEvening();
    $("bill-eyebrow").textContent = "Dealer's choice — no backsies";
  });

  $("taste-search").addEventListener("input", function(e){ tasteQ = e.target.value; renderTaste(); });

  document.querySelectorAll(".nav button").forEach(function(b){
    b.addEventListener("click", function(){ showScreen(b.dataset.go); });
  });

  let theme = load("theme","dark");
  applyTheme(theme);
  $("themebtn").addEventListener("click", function(){
    theme = theme === "light" ? "dark" : "light";
    store("theme", theme); applyTheme(theme);
  });

  document.addEventListener("keydown", function(e){
    const tag = (e.target.tagName||"").toLowerCase();
    if(tag === "input" || tag === "textarea" || e.metaKey || e.ctrlKey || e.altKey) return;
    if(e.key === "Enter" && SCREEN === "tonight" && !$("show-bill").disabled){ programEvening(); }
    if(e.key.toLowerCase() === "r" && SCREEN === "bill" && LAST){
      REROLLS++; if(REROLLS >= LAST.picks.length) REROLLS = 0; renderBill(LAST);
    }
    if(e.key === "Escape" && SCREEN === "bill") showScreen("tonight");
  });

  loadEnrichment();
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
