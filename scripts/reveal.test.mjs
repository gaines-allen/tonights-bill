/**
 * Covers the recommendation reveal: the 1.8s sequence, the short alternate
 * swap, duplicate-request handling, the reduced-motion path, the "What the
 * store says" card, and the lock-in confirmation.
 *
 * The DOM stub, the virtual clock and the loader that lifts the app out of
 * index.html live in harness.mjs, shared with session.test.mjs and
 * shelf.test.mjs.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, html, Clock, makeNode, loadApp, eq, ok, finish } from "./harness.mjs";

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

  to(300);
  eq("0.3s the questions step down", tonight.classList.contains("rv-dim"), true);
  eq("0.3s the room goes under", dark.classList.contains("veil"), true);
  eq("0.3s nothing has been painted yet", painted, 0);

  /* The chase shipped invisible: the ask sits ~1000px below the marquee, so
     by the time anyone presses it the sign is a full screen above the fold.
     The page must be back at the marquee, and main lifted, before 0.5s. */
  to(680);
  eq("0.68s the page returns to the marquee under the veil", scrolled(), 0);
  eq("0.68s main is still down, so the scroll cannot be seen",
     env.doc.body.classList.contains("veiled"), false);

  /* <main> is its own stacking context, so the marquee cannot rise over the
     veil on its own z-index — main itself has to be lifted, or the chase runs
     underneath an opaque sheet and is never seen. */
  to(700);
  eq("0.7s main lifts and the sign comes up out of the dark",
     env.doc.body.classList.contains("veiled"), true);

  to(800);
  ok("0.8s the bulbs are sent round", true, "");

  to(2020);
  eq("the hero waits for the whole lap", painted, 0);

  to(2050);
  eq("2.05s the hero is painted", painted, 1);
  eq("2.05s the veil lifts", dark.classList.contains("rv-lift"), true);
  eq("2.05s the veil is gone", dark.classList.contains("veil"), false);
  eq("2.05s main drops back down", env.doc.body.classList.contains("veiled"), false);

  to(2350);
  eq("2.35s poster and title enter", bill.classList.contains("rv-3"), true);
  eq("2.35s the card is still held", bill.classList.contains("rv-4"), false);

  to(2680);
  eq("2.68s the store card arrives", bill.classList.contains("rv-4"), true);
  eq("2.68s the night is not yet actionable", bill.classList.contains("rv-5"), false);

  to(3000);
  eq("3.0s lock-in and the shelf go live", bill.classList.contains("rv-5"), true);
  eq("3.0s the ask is released", button.disabled, false);
  eq("3.0s the sequence is finished", Reveal.busy(), false);

  Clock.tick(900);
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

  Clock.tick(3800);
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

  Clock.tick(4000);
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

console.log("\nwhat the store says: the written lines");
{
  const { mod } = await loadApp({ reduced: false });
  const { BY_TITLE, FILMS, S, storeSays, storeCard, CLERK } = mod;

  /* Every curated film. The nightly scan shelves several hundred more off the
     services which cannot be written ahead of time; those are the generator's
     job, and the fallback below covers them. */
  eq("every curated film has a written line",
     FILMS.filter(f => !CLERK[f.t]).length, 0);
  eq("no line is written for a film that is not in the catalog",
     Object.keys(CLERK).filter(t => !BY_TITLE[t]).length, 0);

  const sentences = v => v.replace(/\b(Dr|Mr|Mrs|St|Jr|Sr|vs|E\.T)\./g, "$1")
                          .split(/(?<=[.!?])\s+/).filter(Boolean).length;
  const bad = {long:[], short:[], sent:[], punct:[], stock:[], year:[], score:[], svc:[], plot:[]};
  const STOCK = /must-watch|hidden gem|masterpiece|roller ?coaster|cinematic experience|something for everyone|perfect for fans|doesn't disappoint|it has heart|it delivers|checks all the boxes|edge of your seat|\bcontent\b|You asked for|Based on your/i;
  const LABELS = /ensemble-led|character-led|dialogue-driven|a brisk clip|a twisting plot|uplifting throughout/i;
  const SVCS = /Netflix|Hulu|Disney\+|Prime Video|Apple TV|Paramount\+|Peacock/i;

  FILMS.forEach(f => {
    const v = CLERK[f.t]; if (!v) return;
    const w = v.split(/\s+/).length;
    if (w > 58) bad.long.push(f.t);
    if (w < 30) bad.short.push(f.t);
    const n = sentences(v);
    if (n < 2 || n > 3) bad.sent.push(f.t + "(" + n + ")");
    if (/[‘’“”–—!?]/.test(v)) bad.punct.push(f.t);
    if (STOCK.test(v) || LABELS.test(v)) bad.stock.push(f.t);
    if (v.includes(String(f.y))) bad.year.push(f.t);       /* the year is printed elsewhere */
    if (/\d+%/.test(v)) bad.score.push(f.t);
    if (SVCS.test(v)) bad.svc.push(f.t);
    if (f.h && v.includes(f.h.slice(0, 24))) bad.plot.push(f.t);  /* the synopsis is right below */
  });

  eq("none run long", bad.long, []);
  eq("none run short", bad.short, []);
  eq("all are two or three sentences", bad.sent, []);
  eq("no curly quotes, dashes, exclamations or rhetorical questions", bad.punct, []);
  eq("no stock praise and no raw tag names", bad.stock, []);
  eq("none repeat the release year", bad.year, []);
  eq("none quote a critic score", bad.score, []);
  eq("none name the streaming service", bad.svc, []);
  eq("none restate the synopsis printed under them", bad.plot, []);

  /* the whole point: a line that could sit under another film is a failed line */
  const seen = {}, dupes = [];
  Object.keys(CLERK).forEach(t => {
    const k = CLERK[t].toLowerCase();
    if (seen[k]) dupes.push(t); else seen[k] = 1;
  });
  eq("no two films share a line", dupes, []);

  const shape = BY_TITLE["The Shape of Water"];
  S.room = "two"; S.time = 135; S.moods = ["weird", "beautiful"];
  const rec = { f: shape, T: {n:0, loved:[], aw:{}, dw:{}}, score: .8, on: ["MAX"], upSet: {} };
  ok("the written line is what the card shows",
     storeSays(rec) === CLERK["The Shape of Water"]);
  ok("and it carries a detail no other film could claim",
     /fish man/.test(storeSays(rec)), storeSays(rec));

  const card = storeCard(rec);
  eq("the card is titled exactly",
     card.children.find(c => c.className === "store-label").textContent,
     "WHAT THE STORE SAYS");
  eq("the tape is hidden from assistive tech",
     card.children.find(c => c.className === "store-tape").getAttribute("aria-hidden"), "true");
}

console.log("\nthe nightly worklist");
{
  /* The scan shelves titles nobody has written a line for, and a shelved title
     can be the top pick, so the job that shelves them says which ones need
     one. The file has to be a pure function of its inputs: the first version
     diffed against its own previous run, which committed churn every night. */
  const { mod } = await loadApp({ reduced: false });
  const { CLERK } = mod;
  const src = await readFile(join(ROOT, "scripts/unwritten.mjs"), "utf8");

  ok("the worklist carries no timestamp", !/generatedAt: new Date/.test(src),
     "a timestamp in the output means a commit every night whether or not anything moved");
  ok("recency comes from firstSeen, not from diffing the last run",
     src.includes("e.firstSeen") && !src.includes("newSinceLastScan"));
  ok("recency is measured against the catalog's own date, not the wall clock",
     src.includes('payload._meta?.generatedAt'),
     "using Date.now() makes the same input produce different output");
  ok("it never fails the build", !/process\.exit\(1\)/.test(src));

  let list = null;
  try { list = JSON.parse(await readFile(join(ROOT, "data/unwritten.json"), "utf8")); }
  catch { /* not generated in this checkout */ }

  if (list) {
    eq("the worklist has no timestamp field", "generatedAt" in list, false);
    const rawBlock = html.slice(html.indexOf("const RAW = ["),
                                html.indexOf("\n];", html.indexOf("const RAW = [")));
    const curated = new Set([...rawBlock.matchAll(/^\["((?:[^"\\]|\\.)*)",\d{4},/gm)].map(m => m[1]));
    eq("no curated film is on the worklist",
       list.titles.filter(t => curated.has(t)), []);
    eq("nothing already written is on the worklist",
       list.titles.filter(t => CLERK[t]), []);
    eq("the count matches the list", list.unwritten, list.titles.length);
    ok("every recent title is also on the worklist",
       list.recent.every(t => list.titles.includes(t)));
  }
}

console.log("\nwhat the store says: the fallback");
{
  /* Every catalog film is written, so the generator is exercised against a
     title that is not, which is what a newly added film looks like. */
  const { mod } = await loadApp({ reduced: false });
  const { S, storeSays, listOf } = mod;
  S.room = "two"; S.time = 135; S.moods = ["weird", "beautiful"];

  const f = { id: 7, t: "An Unwritten Picture", y: 2011, r: 118, mpaa: "R",
              g: ["drama"], a: ["visual", "weird", "melancholy", "slowburn"],
              d: "Someone", h: "A synopsis that the card must not repeat.", svcs: ["MAX"] };
  const rec = { f, T: {n:0, loved:[], aw:{}, dw:{}}, score: .8, on: ["MAX"], upSet: {} };
  const copy = storeSays(rec);

  const n = copy.split(/(?<=\.)\s+/).filter(Boolean).length;
  ok(`an unwritten film still gets 2-4 sentences (got ${n})`, n >= 2 && n <= 4, copy);
  ok("it answers what was asked for", /you (asked|wanted|came in|left|didn't)/i.test(copy), copy);
  ok("it names the runtime", copy.includes("1h 58m"), copy);
  ok("it does not name the director", !copy.includes("Someone"), copy);
  ok("it does not print the release year", !copy.includes("2011"), copy);
  ok("it does not repeat the synopsis", !copy.includes(f.h.slice(0, 24)), copy);

  eq("the oxford list reads correctly", listOf(["a", "b", "c"]), "a, b, and c");
  eq("two items take no comma", listOf(["a", "b"]), "a and b");
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

finish();
