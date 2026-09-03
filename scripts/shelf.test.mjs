/**
 * Covers Your Shelf: each tile is one button wrapping the poster and the
 * title, carrying the film's key; either opens the film's case, populated
 * before it is shown. The grid carries no status buttons at all, only a
 * printed badge. Inside the case, Loved, Not for me and Seen it change the
 * same saved state the badge is drawn from, and the status survives a
 * refresh. The case closes on Close, Escape and the backdrop, never on a
 * click inside, and hands focus back to the tile that opened it.
 */
import { loadApp, eq, ok, walk, finish, html } from "./harness.mjs";

const STATUS = ["Loved", "Not for me", "Seen it"];
const wallOf   = (env) => env.doc.getElementById("wall");
const tiles    = (env) => wallOf(env).children.filter(c => /\bkeep\b/.test(c.className));
const openerOf = (tile) => tile.children.find(c => /keep-open/.test(c.className));
const titleOf  = (tile) => walk(tile).find(n => n.className === "kt").textContent;
const badgeOf  = (tile) => { const b = walk(tile).find(n => n.className === "kb"); return b ? b.textContent : null; };
const posterOf = (tile) => walk(tile).find(n => /\bposter\b/.test(n.className));
const tileFor  = (env, title) => tiles(env).find(t => titleOf(t) === title);
const inCase    = (env) => walk(env.doc.getElementById("case-body"));
const caseReact = (env) => inCase(env).find(n => /case-react/.test(n.className));
const caseTitle = (env) => inCase(env).find(n => /case-title/.test(n.className));
const caseState = (env) => inCase(env).find(n => n.className === "case-state");
const btn = (row, label) => row.children.find(b => b.textContent === label);
const gridStatusButtons = (env) => walk(wallOf(env)).filter(n => n.tagName === "BUTTON" && STATUS.includes(n.textContent));
const hm = (m) => { const h = Math.floor(m / 60), r = m % 60; return h ? (h + "h" + (r ? " " + r + "m" : "")) : r + "m"; };

async function shelf(opts){
  const { mod, env } = await loadApp(Object.assign({ reduced: true }, opts || {}));
  if (!opts || !opts.store) { mod.S.taste = {}; mod.S.watched = {}; }
  mod.showScene("taste");
  return { mod, env };
}

console.log("\nthe tile");
{
  const { mod, env } = await shelf();
  const tile = tiles(env)[0];
  const opener = openerOf(tile);
  const title = titleOf(tile);
  const f = mod.BY_TITLE[title];
  eq("the tile itself is a plain container", tile.tagName, "DIV");
  eq("holding one button", tile.children.length, 1);
  eq("which is the opener", opener.tagName, "BUTTON");
  eq("with an accessible name", opener.getAttribute("aria-label"), "Open details for " + title);
  eq("a native button, so Enter and Space activate it", opener.type, "button");
  eq("it carries the film's key, the same title-and-year identifier the app uses elsewhere",
     opener.getAttribute("data-film"), mod.filmKey(f));
  ok("the poster is inside it", !!posterOf(opener));
  ok("so is the printed title", walk(opener).some(n => n.className === "kt"));
  ok("and the year and runtime", walk(opener).some(n => n.className === "ky" && n.textContent === f.y + " / " + hm(f.r).toUpperCase()));
  eq("no button is nested inside it", walk(opener).filter(n => n.tagName === "BUTTON").length, 0);
  eq("an unmarked film has no badge", badgeOf(tile), null);
  eq("the grid carries no Loved, Not for me or Seen it buttons", gridStatusButtons(env).length, 0);
  ok("the poster overlay is gone from the stylesheet", !/\.keep \.react\b/.test(html) && !/\.keep:hover \.react/.test(html));
  ok("and so is its touch-screen rule", !/@media \(hover:none\)\{\s*\.keep/.test(html));
  ok("the tile hover is restrained: a small lift, nothing laid over the poster",
     /\.keep-open:hover\{transform:translateY\(-2px\)\}/.test(html) && !/\.keep-open::before/.test(html));
  eq("the case starts closed", env.doc.getElementById("case").hidden !== false, true);
}

console.log("\nopening the case");
{
  const { mod, env } = await shelf();
  const c = env.doc.getElementById("case");
  const body = env.doc.getElementById("case-body");
  const fetchesBefore = globalThis.__fetches;

  /* the poster and the title are inside the button, so a click on either
     bubbles to it, as it does in a browser */
  const first = tiles(env)[0], firstTitle = titleOf(first);
  let childrenWhenShown = -1;
  Object.defineProperty(c, "hidden", {
    get(){ return this._h; },
    set(v){ this._h = v; if (v === false) childrenWhenShown = body.children.length; },
    configurable: true
  });
  posterOf(first).click();
  eq("clicking the poster opens the case", c.hidden, false);
  eq("for that film", caseTitle(env).textContent, firstTitle);
  ok("the panel was populated before it was shown", childrenWhenShown > 0, `children at reveal: ${childrenWhenShown}`);
  ok("focus moves into the panel", globalThis.__focused === env.doc.getElementById("case-panel"));
  ok("the page behind it stops scrolling", env.doc.body.classList.contains("cased"));
  mod.closeCase();

  const second = tiles(env)[1], secondTitle = titleOf(second);
  walk(second).find(n => n.className === "kt").click();
  eq("clicking the title opens the case", c.hidden, false);
  eq("for that film, not the first", caseTitle(env).textContent, secondTitle);
  const f = mod.BY_TITLE[secondTitle];
  eq("the title carries the id the dialog is labelled by", caseTitle(env).id, "case-title");
  ok("and the dialog points at it", /role="dialog" aria-modal="true" aria-labelledby="case-title"/.test(html));
  const flat = inCase(env);
  ok("it shows the poster", !!flat.find(n => /\bposter\b/.test(n.className)));
  ok("the year", flat.some(n => n.className === "tick" && n.textContent === String(f.y)));
  ok("the runtime", flat.some(n => n.className === "tick" && n.textContent === hm(f.r).toUpperCase()));
  ok("the rating", flat.some(n => n.className === "tick" && n.textContent === f.mpaa));
  ok("the story", flat.some(n => n.className === "synopsis-copy" && n.textContent === f.h));
  ok("where it streams", flat.some(n => /playing-label/.test(n.className)));
  eq("the current status", caseState(env).textContent, "Not marked yet");
  eq("and the three shelf actions", caseReact(env).children.map(b => b.textContent), STATUS);
  eq("nothing was fetched for any of it", globalThis.__fetches - fetchesBefore, 0);
  mod.closeCase();
}

console.log("\nthe right film, however the wall is arranged");
{
  const { mod, env } = await shelf();
  const c = env.doc.getElementById("case");

  /* searched */
  mod.searchWall("parasite");
  eq("the search narrows the wall", tiles(env).map(titleOf), ["Parasite"]);
  posterOf(tiles(env)[0]).click();
  eq("a search result opens its own film", caseTitle(env).textContent, "Parasite");
  mod.closeCase();
  mod.searchWall("");

  /* extended */
  const before = tiles(env).length;
  walk(wallOf(env)).find(n => n.tagName === "BUTTON" && n.textContent === "Show more").click();
  ok("show more extends the wall", tiles(env).length > before, `${before} -> ${tiles(env).length}`);
  const deep = tiles(env)[before + 5];
  walk(deep).find(n => n.className === "kt").click();
  eq("a card past the first page opens its own film", caseTitle(env).textContent, titleOf(deep));
  mod.closeCase();

  /* re-sorted: a rated film moves to the front of the wall */
  const late = tiles(env)[20], lateTitle = titleOf(late);
  mod.setTaste(mod.BY_TITLE[lateTitle], "loved");
  eq("rating a film moves it to the front", titleOf(tiles(env)[0]), lateTitle);
  posterOf(tiles(env)[0]).click();
  eq("and it still opens its own case there", caseTitle(env).textContent, lateTitle);
  eq("the opener's key is what found it", openerOf(tiles(env)[0]).getAttribute("data-film"), mod.filmKey(mod.BY_TITLE[lateTitle]));
  mod.closeCase();
  ok("the case is closed again", c.hidden);
}

console.log("\nstatus, inside the case only");
{
  const { mod, env } = await shelf();
  const c = env.doc.getElementById("case");
  const title = titleOf(tiles(env)[2]);
  posterOf(tileFor(env, title)).click();

  btn(caseReact(env), "Loved").click();
  eq("Loved is saved", mod.S.taste[title], "loved");
  eq("the case stays open", c.hidden, false);
  eq("the button shows it is pressed", btn(caseReact(env), "Loved").getAttribute("aria-pressed"), "true");
  ok("visibly", btn(caseReact(env), "Loved").classList.contains("is-on"));
  eq("the status line follows", caseState(env).textContent, "Loved");
  eq("the tile's badge appears at once", badgeOf(tileFor(env, title)), "Loved");
  eq("and the tile is marked", tileFor(env, title).getAttribute("data-state"), "loved");
  eq("the grid still has no status buttons", gridStatusButtons(env).length, 0);

  btn(caseReact(env), "Not for me").click();
  eq("Not for me replaces Loved", mod.S.taste[title], "hated");
  eq("only one of the two is pressed", caseReact(env).children.map(b => b.getAttribute("aria-pressed")), ["false", "true", "false"]);
  eq("the badge follows", badgeOf(tileFor(env, title)), "Not for me");

  btn(caseReact(env), "Seen it").click();
  ok("Seen it is saved alongside", !!mod.S.watched[title]);
  eq("the line says both", caseState(env).textContent, "Not for me · Seen it");
  eq("the badge keeps the taste, which outranks a watch", badgeOf(tileFor(env, title)), "Not for me");

  btn(caseReact(env), "Not for me").click();
  eq("pressing the current status clears it, as the app always allowed", mod.S.taste[title], undefined);
  eq("the badge falls back to Seen", badgeOf(tileFor(env, title)), "Seen");
  btn(caseReact(env), "Seen it").click();
  eq("clearing the watch removes the badge", badgeOf(tileFor(env, title)), null);
  eq("and unmarks the tile", tileFor(env, title).getAttribute("data-state"), null);

  btn(caseReact(env), "Loved").click();
  eq("the status is in localStorage", JSON.parse(env.store.get("tb:taste"))[title], "loved");
  const again = await shelf({ store: env.store });
  eq("a refresh keeps the status", again.mod.S.taste[title], "loved");
  eq("and the badge", badgeOf(tileFor(again.env, title)), "Loved");
  posterOf(tileFor(again.env, title)).click();
  eq("and the case agrees", caseState(again.env).textContent, "Loved");
}

console.log("\nclosing the case");
{
  const { env } = await shelf();
  const title = titleOf(tiles(env)[1]);
  const c = env.doc.getElementById("case");

  posterOf(tileFor(env, title)).click();
  const esc = c.dispatch("keydown", { key: "Escape" });
  eq("Escape closes it", c.hidden, true);
  ok("the key is consumed", esc.defaultPrevented);
  ok("focus returns to the exact card that opened it", globalThis.__focused === openerOf(tileFor(env, title)));
  eq("the body is emptied, so nothing stale is read out later", env.doc.getElementById("case-body").children.length, 0);
  ok("the page scrolls again", !env.doc.body.classList.contains("cased"));
  ok("the closed panel is hidden, so its controls leave the tab order",
     /<div class="case" id="case" hidden>/.test(html) && /\[hidden\]\{display:none !important\}/.test(html));

  posterOf(tileFor(env, title)).click();
  env.doc.getElementById("case-close").click();
  eq("the Close control closes it", c.hidden, true);
  ok("and it is a visible control", /<button class="act case-close" id="case-close" type="button">Close<\/button>/.test(html));

  posterOf(tileFor(env, title)).click();
  env.doc.getElementById("case-panel").click();
  eq("a click inside the panel leaves it open", c.hidden, false);
  caseTitle(env).click();
  eq("so does a click on its contents", c.hidden, false);
  env.doc.getElementById("case-back").click();
  eq("a click on the backdrop closes it", c.hidden, true);

  /* the wall is rebuilt under an open case when a status changes */
  posterOf(tileFor(env, title)).click();
  const before = openerOf(tileFor(env, title));
  btn(caseReact(env), "Loved").click();
  const after = openerOf(tileFor(env, title));
  ok("the wall was rebuilt while the case was open", before !== after);
  c.dispatch("keydown", { key: "Escape" });
  ok("focus goes to the film's new button, not the detached one", globalThis.__focused === after && globalThis.__focused !== before);
}

finish();
