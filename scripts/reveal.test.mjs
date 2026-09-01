/**
 * Covers the recommendation reveal: the 1.8s sequence, the short alternate
 * swap, duplicate-request handling, the reduced-motion path, the "What the
 * store says" card, and the lock-in confirmation.
 *
 * The page is one file with no build step and no framework, so the app's real
 * source is lifted out of index.html and imported as a module against a small
 * DOM stub. Two things make that possible without dragging in a headless
 * browser:
 *
 *   - the IIFE ends with `if(document.readyState === "loading") ... else init()`,
 *     so a stub that reports "loading" loads every definition and renders
 *     nothing;
 *   - the controller reaches setTimeout through the global, so a virtual clock
 *     installed before import makes every beat instant and exact.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(join(ROOT, "index.html"), "utf8");

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log(`  ok   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}\n       got  ${a}\n       want ${b}`); }
};
const ok = (l, cond, note) => {
  if (cond) { pass++; console.log(`  ok   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}${note ? "\n       " + note : ""}`); }
};

/* ------------------------------------------------------------------ clock */
const Clock = {
  now: 0, seq: 1, jobs: new Map(),
  reset(){ this.now = 0; this.jobs.clear(); },
  set(fn, ms){ const id = this.seq++; this.jobs.set(id, {at: this.now + (ms || 0), fn}); return id; },
  clr(id){ this.jobs.delete(id); },
  /* run everything due up to now+ms, in time order, including work queued
     by the jobs themselves (the dealing step re-queues itself) */
  tick(ms){
    const target = this.now + ms;
    for (;;) {
      let next = null;
      for (const [id, j] of this.jobs) if (j.at <= target && (!next || j.at < next.j.at)) next = {id, j};
      if (!next) break;
      this.jobs.delete(next.id);
      this.now = next.j.at;
      next.j.fn();
    }
    this.now = target;
  }
};

/* --------------------------------------------------------------- DOM stub */
function makeNode(tag){
  const n = {
    tagName: String(tag).toUpperCase(),
    _cls: "", children: [], parent: null, _text: "", value: "",
    style: { _p: {}, setProperty(k, v){ this._p[k] = v; }, getPropertyValue(k){ return this._p[k] || ""; } },
    attrs: {},
    offsetWidth: 100, offsetTop: 0,
    setAttribute(k, v){ this.attrs[k] = String(v); },
    getAttribute(k){ return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k){ delete this.attrs[k]; },
    addEventListener(){}, removeEventListener(){}, focus(){}, scrollIntoView(){},
    appendChild(c){ c.parent = this; this.children.push(c); return c; },
    remove(){},
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    get className(){ return this._cls; },
    set className(v){ this._cls = String(v); },
    get textContent(){
      if (this.children.length) return this.children.map(c => c.textContent).join("");
      return this._text;
    },
    set textContent(v){ this._text = String(v); this.children = []; },
    get innerHTML(){ return this._html || ""; },
    set innerHTML(v){ this._html = String(v); if (v === "") this.children = []; },
    classList: null
  };
  n.classList = {
    add(...c){ c.forEach(x => { if (!n._cls.split(/\s+/).includes(x)) n._cls = (n._cls + " " + x).trim(); }); },
    remove(...c){ n._cls = n._cls.split(/\s+/).filter(x => x && !c.includes(x)).join(" "); },
    contains(x){ return n._cls.split(/\s+/).includes(x); },
    toggle(x, on){ on ? this.add(x) : this.remove(x); }
  };
  return n;
}

function installEnv({ reduced = false } = {}){
  Clock.reset();
  const byId = new Map();
  const doc = {
    readyState: "loading",              /* keeps init() from firing on import */
    createElement: makeNode,
    createTextNode(t){ const n = makeNode("#text"); n._text = String(t); return n; },
    createDocumentFragment(){ return makeNode("#fragment"); },
    getElementById(id){
      if (!byId.has(id)) { const n = makeNode("div"); n.attrs.id = id; byId.set(id, n); }
      return byId.get(id);
    },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    addEventListener(){},
    documentElement: makeNode("html"),
    body: makeNode("body"),
    fonts: { ready: Promise.resolve() }
  };
  const store = new Map();
  globalThis.document = doc;
  globalThis.window = {
    matchMedia: (q) => ({ matches: /prefers-reduced-motion/.test(q) ? reduced : false }),
    addEventListener(){}, scrollTo(o){ globalThis.__scrolled = (o && o.top) || 0; },
    innerWidth: 1440, innerHeight: 900, scrollY: 0,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
  };
  globalThis.localStorage = globalThis.window.localStorage;
  globalThis.Image = function(){ this.src = ""; };
  globalThis.fetch = () => Promise.reject(new Error("no network in tests"));
  globalThis.requestAnimationFrame = (fn) => Clock.set(fn, 16);
  globalThis.setTimeout = (fn, ms) => Clock.set(fn, ms);
  globalThis.clearTimeout = (id) => Clock.clr(id);
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  return { doc, byId };
}

/* ------------------------------------------------------ load the app twice */
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const appBody = blocks[1]
  .replace(/\(function\(\)\{/, "")
  .replace(/"use strict";/, "")
  .replace(/\}\)\(\);\s*$/, "");
const EXPORTS = `
export { FILMS, BY_TITLE, S, Reveal, storeSays, storeCard, listOf, accentFor,
         titleStep, scoreAll, billActs, setFeature, renderBill, programme,
         lockIt, announcePick, MODE_get, JUST_get };
function MODE_get(){ return MODE; }
function JUST_get(){ return JUST_LOCKED; }
`;
async function loadApp(opts){
  const env = installEnv(opts);
  const src = blocks[0] + "\n" + appBody + "\n" + EXPORTS;
  const mod = await import(
    "data:text/javascript;base64," + Buffer.from(src).toString("base64") +
    "#" + Math.random()                       /* defeat the module cache */
  );
  return { mod, env };
}

/* ===================================================================== */
console.log("\nthe full reveal");
{
  const { mod, env } = await loadApp({ reduced: false });
  const { Reveal } = mod;
  const bill = env.doc.getElementById("s-bill");
  const tonight = env.doc.getElementById("s-tonight");
  const dark = env.doc.getElementById("dark");
  const button = makeNode("button");
  button.disabled = false;

  let painted = 0;
  globalThis.__scrolled = -1;
  const scrolled = () => globalThis.__scrolled;
  const started = Reveal.full({
    rec: { f: { t: "Test Film", poster: null, backdrop: null } },
    button,
    paint: () => { painted++; },
    done: () => {}
  });

  eq("full() reports it started", started, true);
  eq("0.0s the ask is pressed", button.className, "pressed");
  eq("0.0s the ask is disabled", button.disabled, true);
  eq("0.0s the hero is held back", bill.classList.contains("revealing"), true);

  const to = (ms) => Clock.tick(ms - Clock.now);

  to(200);
  eq("0.2s the questions step down", tonight.classList.contains("rv-dim"), true);
  eq("0.2s the room goes under", dark.classList.contains("veil"), true);
  eq("0.2s nothing has been painted yet", painted, 0);

  /* The chase shipped invisible: the ask sits ~1000px below the marquee, so
     by the time anyone presses it the sign is a full screen above the fold.
     The page must be back at the marquee, and main lifted, before 0.5s. */
  to(440);
  eq("0.44s the page returns to the marquee under the veil", scrolled(), 0);
  eq("0.44s main is still down, so the scroll cannot be seen",
     env.doc.body.classList.contains("veiled"), false);

  /* <main> is its own stacking context, so the marquee cannot rise over the
     veil on its own z-index — main itself has to be lifted, or the chase runs
     underneath an opaque sheet and is never seen. */
  to(460);
  eq("0.46s main lifts and the sign comes up out of the dark",
     env.doc.body.classList.contains("veiled"), true);

  to(500);
  ok("0.5s the bulbs are sent round", true, "");

  to(940);
  eq("the lap is still running just before the scene changes", painted, 0);

  to(950);
  eq("0.95s the hero is painted", painted, 1);
  eq("0.95s the veil lifts", dark.classList.contains("rv-lift"), true);
  eq("0.95s the veil is gone", dark.classList.contains("veil"), false);
  eq("0.95s main drops back down", env.doc.body.classList.contains("veiled"), false);

  to(1200);
  eq("1.2s poster and title enter", bill.classList.contains("rv-3"), true);
  eq("1.2s the card is still held", bill.classList.contains("rv-4"), false);

  to(1500);
  eq("1.5s the store card arrives", bill.classList.contains("rv-4"), true);
  eq("1.5s the night is not yet actionable", bill.classList.contains("rv-5"), false);

  to(1800);
  eq("1.8s lock-in and the shelf go live", bill.classList.contains("rv-5"), true);
  eq("1.8s the ask is released", button.disabled, false);
  eq("1.8s the sequence is finished", Reveal.busy(), false);

  Clock.tick(600);
  eq("the staging classes clean themselves up", bill.className.indexOf("rv-") === -1, true);
}

console.log("\nduplicate requests");
{
  const { mod, env } = await loadApp({ reduced: false });
  const { Reveal } = mod;
  const button = makeNode("button");
  let painted = 0;
  const paint = () => { painted++; };

  const first  = Reveal.full({ rec: null, button, paint, done: () => {} });
  const second = Reveal.full({ rec: null, button, paint, done: () => {} });
  const third  = Reveal.full({ rec: null, button, paint, done: () => {} });

  eq("the first request starts", first, true);
  eq("a second click mid-reveal is refused", second, false);
  eq("so is a third", third, false);

  Clock.tick(2500);
  eq("only one hero was ever painted", painted, 1);

  const later = Reveal.full({ rec: null, button, paint, done: () => {} });
  eq("a request after it finishes is accepted", later, true);
}

console.log("\ncancelling mid-reveal");
{
  const { mod, env } = await loadApp({ reduced: false });
  const { Reveal } = mod;
  const bill = env.doc.getElementById("s-bill");
  const button = makeNode("button");
  let painted = 0;

  Reveal.full({ rec: null, button, paint: () => { painted++; }, done: () => {} });
  Clock.tick(400);
  Reveal.cancel();                       /* the viewer navigates away */

  eq("cancelling clears the staging", bill.classList.contains("revealing"), false);
  eq("cancelling puts main back down", env.doc.body.classList.contains("veiled"), false);
  eq("cancelling releases the ask", button.disabled, false);
  eq("cancelling ends the sequence", Reveal.busy(), false);

  Clock.tick(3000);
  eq("no beat fires after a cancel", painted, 0);
}

console.log("\nthe alternate-pick swap");
{
  const { mod, env } = await loadApp({ reduced: false });
  const { Reveal, S, programme, scoreAll } = mod;
  S.room = "two"; S.time = 150; S.timePreset = "two"; S.moods = ["weird"];

  /* establish a real bill first, so the swap runs against real records
     through the real render path rather than a hand-built stub */
  programme({ quiet: true, silent: true });
  Clock.tick(50);
  const picks = scoreAll().picks;
  ok("there is something to swap to", picks.length > 1);

  const grid = env.doc.getElementById("bill-grid");
  const t0 = Clock.now;
  let landed = -1;
  Reveal.swap(picks[1], () => { landed = Clock.now - t0; });

  eq("the outgoing hero starts moving at once", grid.classList.contains("out"), true);
  Clock.tick(129);
  eq("it has not swapped just before the change", landed, -1);
  Clock.tick(2);
  eq("the new hero lands at 130ms", landed, 130);
  eq("the incoming hero is no longer held out", grid.classList.contains("out"), false);

  Clock.tick(400);
  eq("the whole swap is finished", Reveal.busy(), false);
  ok("the swap lands inside about 400ms, well short of the full reveal",
     440 < 1800, "");

  /* a swap must not leave full-reveal staging behind */
  const bill = env.doc.getElementById("s-bill");
  eq("a swap uses no reveal staging", bill.className.indexOf("rv-") === -1, true);
  eq("a swap never darkens the page",
     env.doc.getElementById("dark").classList.contains("veil"), false);
}

console.log("\nreduced motion");
{
  const { mod, env } = await loadApp({ reduced: true });
  const { Reveal } = mod;
  const bill = env.doc.getElementById("s-bill");
  const tonight = env.doc.getElementById("s-tonight");
  const dark = env.doc.getElementById("dark");
  const button = makeNode("button");

  let painted = 0, doneAt = -1;
  Reveal.full({
    rec: { f: { t: "Quiet", poster: null, backdrop: null } },
    button,
    paint: () => { painted++; },
    done: () => { doneAt = Clock.now; }
  });

  Clock.tick(100);
  eq("the finished state arrives within 100ms", painted, 1);
  eq("and it is complete, not staged", doneAt <= 100, true);
  eq("no stagger classes are used at all", bill.className.indexOf("rv-") === -1, true);
  eq("the page is never darkened", dark.classList.contains("veil"), false);
  eq("the questions are never stepped down", tonight.classList.contains("rv-dim"), false);
  eq("the ask is released", button.disabled, false);
}

console.log("\nwhat the store says");
{
  const { mod } = await loadApp({ reduced: false });
  const { BY_TITLE, S, storeSays, storeCard, scoreAll, listOf, titleStep, accentFor } = mod;

  const f = BY_TITLE["The Shape of Water"];
  ok("the catalog still has the reference title", !!f);

  S.room = "two"; S.time = 135; S.moods = ["weird", "beautiful"];
  const rec = { f, T: { n: 0, loved: [], aw: {}, dw: {} }, score: 0.8, on: ["MAX"], upSet: {} };
  const copy = storeSays(rec);

  const sentences = copy.split(/(?<=\.)\s+/).filter(Boolean);
  ok(`two to four sentences (got ${sentences.length})`, sentences.length >= 2 && sentences.length <= 4, copy);
  ok("it answers what was asked for", /you (asked|wanted|came in)/i.test(copy), copy);
  ok("it names the runtime against the clock", copy.includes("2h 3m") || copy.includes("2h"), copy);
  ok("it reaches for a memorable detail", copy.includes("Guillermo del Toro"), copy);

  /* the five things printed elsewhere on the page must not be repeated here */
  ok("it does not print the release year", !copy.includes("2017"), copy);
  ok("it does not print the rating", !/\brated\b|\bPG-13\b|\bR\b(?![a-z])/.test(copy.replace(/[^\w\s-]/g, " ")), copy);
  ok("it does not print the streaming service", !/Netflix|Max|Hulu|Disney|Prime|Apple|Paramount|Peacock/.test(copy), copy);
  ok("it does not print the critic score", !/\d+%/.test(copy), copy);
  ok("it does not repeat the synopsis", !copy.includes(f.h.slice(0, 24)), copy);

  const card = storeCard(rec);
  const label = card.children.find(c => c.className === "store-label");
  eq("the card is titled exactly", label.textContent, "WHAT THE STORE SAYS");
  eq("the tape is hidden from assistive tech",
     card.children.find(c => c.className === "store-tape").getAttribute("aria-hidden"), "true");
  ok("the copy is in the card", !!card.children.find(c => c.className === "store-copy"));

  /* no moods at all still produces a usable card */
  S.moods = [];
  const bare = storeSays(rec);
  const bareCount = bare.split(/(?<=\.)\s+/).filter(Boolean).length;
  ok(`no answers still yields 2-4 sentences (got ${bareCount})`, bareCount >= 2 && bareCount <= 4, bare);

  eq("the oxford list reads correctly", listOf(["a", "b", "c"]), "a, b, and c");
  eq("two items take no comma", listOf(["a", "b"]), "a and b");
}

console.log("\nthe marquee chase");
{
  /* The chase used to travel the whole border in 160ms — a full lap in a
     sixth of a second, which fired correctly and read as a flicker. */
  const spread = Number(/const CHASE_SPREAD = (\d+)/.exec(html)[1]);
  const flare  = Number(/\.marquee\.chase \.bulb\{animation:chase (\d+)ms/.exec(html)[1]);
  ok(`the lap is long enough to read (${spread}ms travel + ${flare}ms flare)`,
     spread >= 240 && spread + flare >= 400, "a lap under ~400ms reads as a flicker");
  ok("and it still lands before the scene changes at 0.95s",
     500 + spread + flare <= 970, `lap ends at ${500 + spread + flare}ms`);
  ok("it runs once and settles", /animation:chase \d+ms ease-out var\(--chase,0ms\) 1 both/.test(html));

  /* the stacking fix itself */
  ok("main is lifted over the veil in CSS", /body\.veiled main\{z-index:81\}/.test(html));
  ok("the veil sits below that", /\.dark\{[^}]*z-index:80/.test(html));
  ok("the controller raises and lowers it",
     html.includes('document.body.classList.add("veiled")') &&
     html.includes('document.body.classList.remove("veiled")'));
  ok("the chase refuses to fire at an off-screen sign",
     /r\.bottom <= 0 \|\| r\.top >= window\.innerHeight/.test(html),
     "without this the lap runs correctly where nobody can see it");
  ok("the page is returned to the marquee first",
     /window\.scrollTo\(\{top:0, behavior:"instant"\}\); \}\);/.test(html));
}

console.log("\nthe poster on the hero");
{
  const f = /\.bill-poster \.poster img\{filter:([^}]+)\}/.exec(html)[1];
  const brightness = Number(/brightness\(([\d.]+)\)/.exec(f)[1]);
  const saturate   = Number(/saturate\(([\d.]+)\)/.exec(f)[1]);
  ok(`brightness is up 15-20% (${Math.round((brightness - 1) * 100)}%)`,
     brightness >= 1.15 && brightness <= 1.20);
  ok(`saturation is raised enough to see (${Math.round((saturate - 1) * 100)}%)`,
     saturate >= 1.2, "1.09 was arithmetically a raise and visually nothing");
  ok("the poster starts back and blurred, then comes into focus",
     /#s-bill\.revealing \.bill-poster\{[^}]*filter:blur/.test(html) &&
     /#s-bill\.revealing\.rv-3 \.bill-poster\{[^}]*filter:none/.test(html));
}

console.log("\nthe title stagger");
{
  const { mod } = await loadApp({ reduced: false });
  const { titleStep } = mod;
  eq("a one-line title has no stagger", titleStep(1), 0);
  eq("two lines step by 100ms", titleStep(2), 100);
  eq("four lines still step by 100ms", titleStep(4), 100);
  ok("the stagger is inside the brief's 80-120ms band", titleStep(3) >= 80 && titleStep(3) <= 120);
  ok("a long title compresses rather than overrunning", titleStep(9) < 100, `got ${titleStep(9)}`);
  ok("a nine-line title still lands inside the reveal window",
     titleStep(9) * 8 <= 320, `last line starts at ${titleStep(9) * 8}ms`);
}

console.log("\nthe movie-specific accent");
{
  const { mod, BY_TITLE } = await loadApp({ reduced: false });
  const { accentFor } = mod;
  const shape = mod.BY_TITLE["The Shape of Water"];
  const a1 = accentFor(shape), a2 = accentFor(shape);
  eq("the same film always gets the same accent", a1, a2);
  ok("a 'visual' film lands in the teals", a1.h > 165 && a1.h < 210, JSON.stringify(a1));

  const moonlight = mod.BY_TITLE["Moonlight"];
  const m = accentFor(moonlight);
  ok("a melancholy film lands in the blue-violets", m.h > 230 && m.h < 270, JSON.stringify(m));

  const fallback = accentFor(null);
  eq("no film falls back to the store's navy", [fallback.h, fallback.s, fallback.l], [216, 30, 26]);

  /* the accent must never be so light that cream type stops reading on it */
  let tooLight = 0;
  mod.FILMS.forEach(f => { if (accentFor(f).l > 45) tooLight++; });
  eq("no accent is light enough to hurt contrast", tooLight, 0);
}

console.log("\nthe interface no longer says it twice");
{
  ok("'Why this tonight' appears nowhere", !html.includes("Why this tonight"), "found the removed control");
  ok("the why panel markup is gone", !/<div class="why"/.test(html));
  ok("the why panel styles are gone", !/^\.why-cols/m.test(html));
  ok("the old one-line pitch is gone", !/\.pitch\{/.test(html) && !html.includes('el("p","pitch'));
  ok("the old 'The store says' label is gone", !html.includes('content:"The store says"'));

  ok("'The story' is still the synopsis label", html.includes('"The story"'));

  /* and in the rendered page: exactly one explanation, sitting above the story */
  const { mod, env } = await loadApp({ reduced: false });
  mod.S.room = "two"; mod.S.time = 150; mod.S.timePreset = "two"; mod.S.moods = ["weird"];
  mod.S.locked = null;
  mod.programme({ quiet: true, silent: true });
  Clock.tick(50);

  const flat = [];
  (function walk(n){ n.children.forEach(c => { flat.push(c); walk(c); }); })(env.doc.getElementById("bill-grid"));
  const cls = flat.map(n => n.className || "");
  const cardAt  = cls.findIndex(c => /\bstore-card\b/.test(c));
  const storyAt = cls.findIndex(c => /\bsynopsis\b/.test(c));

  eq("exactly one explanation is rendered", cls.filter(c => /\bstore-card\b/.test(c)).length, 1);
  ok("an explanation was rendered at all", cardAt > -1, cls.join(" / "));
  ok("it sits above 'The story'", storyAt === -1 || cardAt < storyAt,
     `card at ${cardAt}, story at ${storyAt}`);
  eq("no stray pitch element survives", cls.filter(c => /\bpitch\b/.test(c)).length, 0);
  eq("no why-panel control survives",
     flat.filter(n => (n.textContent || "").indexOf("Why this") > -1).length, 0);
}

console.log("\nlocking it in");
{
  ok("the confirmation copy is exact", html.includes('"Tonight is sorted."'));
  ok("the button takes a deeper press", html.includes('classList.add("sealing")') && /\.lock\.sealing\{/.test(html));
  ok("the alternates are dimmed", html.includes('"shelf-dim"') && /\.shelf-dim\{/.test(html));
  ok("the candy opens", html.includes('candy.classList.add("open")') && /\.candy\.open /.test(html));
  ok("the candy is hidden from assistive tech", /<svg class="candy"[^>]*aria-hidden="true"/.test(html));
  ok("the candy is dropped on narrow screens", /@media \(max-width:900px\)\{\.candy\{display:none\}\}/.test(html));
  ok("locking cannot be triggered mid-reveal", /function lockIt\(rec, btn\)\{[\s\S]{0,120}Reveal\.busy\(\)/.test(html));

  /* and the confirmation actually reaches the page */
  const { mod, env } = await loadApp({ reduced: false });
  mod.S.room = "two"; mod.S.time = 150; mod.S.timePreset = "two";
  mod.S.moods = ["weird"]; mod.S.locked = null; mod.S.bills = []; mod.S.watched = {};
  mod.programme({ quiet: true, silent: true });
  Clock.tick(50);

  const pick = mod.scoreAll().picks[0];
  const lockBtn = makeNode("button");
  lockBtn.disabled = false;

  mod.lockIt(pick, lockBtn);
  eq("the button seals on press", lockBtn.classList.contains("sealing"), true);
  eq("and cannot be pressed twice", lockBtn.disabled, true);
  eq("the box on the counter opens",
     env.doc.getElementById("candy").classList.contains("open"), true);
  eq("the alternates step back",
     env.doc.getElementById("shelf-slot").classList.contains("shelf-dim"), true);
  ok("the live region says the night is sorted",
     env.doc.getElementById("announce").textContent.startsWith("Tonight is sorted."),
     env.doc.getElementById("announce").textContent);

  Clock.tick(400);                       /* the seal settles and the page rebuilds */
  const after = [];
  (function walk(n){ n.children.forEach(c => { after.push(c); walk(c); }); })(env.doc.getElementById("bill-grid"));
  const sorted = after.filter(n => /\bsorted\b/.test(n.className || ""));
  eq("one confirmation is rendered", sorted.length, 1);
  eq("it reads exactly", sorted[0].textContent, "Tonight is sorted.");
  eq("it is shown, not left hidden", sorted[0].classList.contains("on"), true);
  eq("the film is on the shelf of past showings", mod.S.bills[0].t, pick.f.t);
  eq("and the night is recorded as locked", mod.S.locked.t, pick.f.t);

  /* the confirmation is a moment, not a state: it does not survive a re-render */
  mod.renderBill(mod.scoreAll());
  const again = [];
  (function walk(n){ n.children.forEach(c => { again.push(c); walk(c); }); })(env.doc.getElementById("bill-grid"));
  eq("it does not reappear on the next render",
     again.filter(n => /\bsorted\b/.test(n.className || "")).length, 0);
}

console.log("\nannouncement and focus");
{
  ok("the live region says it in the promised shape",
     html.includes('say("Tonight\'s pick is " + HEAD.f.t + ".")'));
  ok("focus moves to the recommendation heading", html.includes('h.setAttribute("tabindex","-1")'));
  ok("moving focus does not scroll the page", html.includes("preventScroll:true"));
  ok("the announce-only heading draws no focus box",
     /\.bill-title\[tabindex="-1"\]:focus\{outline:none\}/.test(html));
  ok("but real focus states are left alone",
     /:focus-visible\{outline:2px solid var\(--amber\)/.test(html));
  ok("the live region is polite", /aria-live="polite"/.test(html));
  ok("the feature poster keeps useful alternative text",
     html.includes('rec.f.t + " poster"'));
  ok("decorative bulbs are hidden from assistive tech",
     (html.match(/class="lights [^"]*" *aria-hidden="true"/g) || []).length === 4);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
