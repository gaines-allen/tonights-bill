/**
 * Covers Your Shelf: the poster and title open a film's case, the status
 * buttons on the tile work without opening it, the same buttons inside the
 * case change the same saved state and every visible copy follows, the
 * status survives a refresh, and the case closes on Close, Escape and the
 * backdrop with focus handed back to the film that opened it.
 */
import { loadApp, eq, ok, walk, finish, html } from "./harness.mjs";

const wallOf  = (env) => env.doc.getElementById("wall");
const titleOf = (tile) => walk(tile).find(n => n.className === "kt").textContent;
const tileFor = (env, title) => wallOf(env).children
  .find(c => /\bkeep\b/.test(c.className) && walk(c).some(n => n.className === "kt" && n.textContent === title));
const openerOf = (tile) => tile.children.find(c => /keep-open/.test(c.className));
const reactOf  = (tile) => walk(tile).find(n => n.className === "react");
const inCase   = (env) => walk(env.doc.getElementById("case-body"));
const caseReact = (env) => inCase(env).find(n => /case-react/.test(n.className));
const caseTitle = (env) => inCase(env).find(n => /case-title/.test(n.className));
const caseState = (env) => inCase(env).find(n => n.className === "case-state");
const btn = (row, label) => row.children.find(b => b.textContent === label);
const hm = (m) => { const h = Math.floor(m / 60), r = m % 60; return h ? (h + "h" + (r ? " " + r + "m" : "")) : r + "m"; };

async function shelf(opts){
  const { mod, env } = await loadApp(Object.assign({ reduced: true }, opts || {}));
  if (!opts || !opts.store) { mod.S.taste = {}; mod.S.watched = {}; }
  mod.showScene("taste");
  return { mod, env };
}

console.log("\nthe tile");
{
  const { env } = await shelf();
  const tile = wallOf(env).children[0];
  const opener = openerOf(tile);
  const title = titleOf(tile);
  eq("the tile itself is not a button", tile.tagName, "DIV");
  eq("the poster and title are opened by a button", opener.tagName, "BUTTON");
  eq("with an accessible name", opener.getAttribute("aria-label"), "Open details for " + title);
  eq("it is a native button, so Enter and Space activate it", opener.type, "button");
  eq("no button is nested inside it", walk(opener).filter(n => n.tagName === "BUTTON").length, 0);
  const react = reactOf(tile);
  ok("the status buttons are siblings of the opener, not its children", react && !walk(opener).includes(react));
  eq("three of them, as before", react.children.map(b => b.textContent), ["Loved", "Not for me", "Seen it"]);
  ok("they sit above the opener's hit area", /\.keep \.react\{[^}]*z-index:2/.test(html));
  ok("and on touch screens stay in the overlay, always shown, where the poster cannot clip them",
     /@media \(hover:none\)\{\s*\.keep \.react\{opacity:1\}/.test(html));
  ok("the hit area is the whole tile, as a real element rather than a pseudo-element",
     /\.keep-open\{\s*position:absolute;inset:0;z-index:1/.test(html) && !/keep-open::before/.test(html));
  eq("the button is empty; the printed title stays a plain element beside it",
     [opener.children.length, walk(tile).some(n => n.className === "kt" && !walk(opener).includes(n))], [0, true]);
  eq("the case starts closed", env.doc.getElementById("case").hidden !== false, true);
}

console.log("\nstatus from the grid");
{
  const { mod, env } = await shelf();
  const title = titleOf(wallOf(env).children[0]);
  const c = env.doc.getElementById("case");

  btn(reactOf(tileFor(env, title)), "Loved").click();
  eq("Loved is saved", mod.S.taste[title], "loved");
  eq("without opening the case", c.hidden !== false, true);
  eq("the tile shows it", tileFor(env, title).getAttribute("data-state"), "loved");
  eq("its button is pressed", btn(reactOf(tileFor(env, title)), "Loved").getAttribute("aria-pressed"), "true");

  btn(reactOf(tileFor(env, title)), "Seen it").click();
  ok("Seen it is saved", !!mod.S.watched[title]);
  eq("still without opening the case", c.hidden !== false, true);

  btn(reactOf(tileFor(env, title)), "Loved").click();
  eq("choosing Loved again clears it, as it always has", mod.S.taste[title], undefined);
  btn(reactOf(tileFor(env, title)), "Not for me").click();
  btn(reactOf(tileFor(env, title)), "Loved").click();
  eq("a different status replaces the last one", mod.S.taste[title], "loved");
  eq("the case never opened", c.hidden !== false, true);
}

console.log("\nthe case");
{
  const { mod, env } = await shelf();
  const title = titleOf(wallOf(env).children[2]);
  const f = mod.BY_TITLE[title];
  const c = env.doc.getElementById("case");
  const fetchesBefore = globalThis.__fetches;

  openerOf(tileFor(env, title)).click();
  eq("clicking the title opens the case", c.hidden, false);
  eq("it is named after the film", caseTitle(env).textContent, title);
  eq("through the id the dialog is labelled by", caseTitle(env).id, "case-title");
  ok("the dialog carries that label",
     /role="dialog" aria-modal="true" aria-labelledby="case-title"/.test(html));
  ok("and is hidden by default, so its controls are out of the tab order",
     /<div class="case" id="case" hidden>/.test(html));
  ok("focus moves into the panel", globalThis.__focused === env.doc.getElementById("case-panel"));
  ok("the page behind it stops scrolling", env.doc.body.classList.contains("cased"));

  const flat = inCase(env);
  ok("it shows the poster", flat.some(n => /\bposter\b/.test(n.className)));
  ok("the year", flat.some(n => n.className === "tick" && n.textContent === String(f.y)));
  ok("the runtime", flat.some(n => n.className === "tick" && n.textContent === hm(f.r).toUpperCase()));
  ok("the rating", flat.some(n => n.className === "tick" && n.textContent === f.mpaa));
  ok("the story", flat.some(n => n.className === "synopsis-copy" && n.textContent === f.h));
  ok("where it streams", flat.some(n => /playing-label/.test(n.className)));
  eq("the shelf status", caseState(env).textContent, "Not marked yet");
  eq("and the same three buttons", caseReact(env).children.map(b => b.textContent), ["Loved", "Not for me", "Seen it"]);
  eq("nothing was fetched for it", globalThis.__fetches - fetchesBefore, 0);

  /* status from inside the case */
  btn(caseReact(env), "Not for me").click();
  eq("Not for me is saved", mod.S.taste[title], "hated");
  eq("the case repaints", btn(caseReact(env), "Not for me").getAttribute("aria-pressed"), "true");
  eq("the status line follows", caseState(env).textContent, "Not for me");
  eq("the tile follows at once", tileFor(env, title).getAttribute("data-state"), "hated");
  eq("so does its button", btn(reactOf(tileFor(env, title)), "Not for me").getAttribute("aria-pressed"), "true");
  eq("the case stays open through it", c.hidden, false);

  btn(caseReact(env), "Seen it").click();
  eq("Seen it joins the line", caseState(env).textContent, "Not for me · Seen it");
  eq("the tile's Seen it is pressed", btn(reactOf(tileFor(env, title)), "Seen it").getAttribute("aria-pressed"), "true");
  btn(caseReact(env), "Not for me").click();
  eq("choosing it again clears it here too", mod.S.taste[title], undefined);
  eq("and the tile clears with it", tileFor(env, title).getAttribute("data-state"), null);
  btn(caseReact(env), "Loved").click();

  /* persistence through the app's own storage */
  eq("the status is in localStorage", JSON.parse(env.store.get("tb:taste"))[title], "loved");
  ok("so is the watch", !!JSON.parse(env.store.get("tb:watched"))[title]);
  const again = await shelf({ store: env.store });
  eq("a refresh keeps the status", again.mod.S.taste[title], "loved");
  ok("and the watch", !!again.mod.S.watched[title]);
  eq("and the tile shows it", tileFor(again.env, title).getAttribute("data-state"), "loved");
  eq("and so does the case", (openerOf(tileFor(again.env, title)).click(), caseState(again.env).textContent), "Loved · Seen it");
}

console.log("\nclosing the case");
{
  const { env } = await shelf();
  const title = titleOf(wallOf(env).children[1]);
  const c = env.doc.getElementById("case");

  openerOf(tileFor(env, title)).click();
  eq("open", c.hidden, false);
  const esc = c.dispatch("keydown", { key: "Escape" });
  eq("Escape closes it", c.hidden, true);
  ok("focus returns to the film that opened it", globalThis.__focused === openerOf(tileFor(env, title)));
  eq("the body is emptied, so nothing stale is read out later", env.doc.getElementById("case-body").children.length, 0);
  ok("the page scrolls again", !env.doc.body.classList.contains("cased"));
  ok("the key is consumed", esc.defaultPrevented);

  openerOf(tileFor(env, title)).click();
  env.doc.getElementById("case-close").click();
  eq("the Close control closes it", c.hidden, true);
  ok("and it is a visible control, not a hidden hotspot",
     /<button class="act case-close" id="case-close" type="button">Close<\/button>/.test(html));

  openerOf(tileFor(env, title)).click();
  env.doc.getElementById("case-panel").click();
  eq("a click inside the panel leaves it open", c.hidden, false);
  env.doc.getElementById("case-back").click();
  eq("a click on the backdrop closes it", c.hidden, true);

  /* the wall is rebuilt under an open case when a status changes, so focus
     has to find the film's new button rather than the node that opened it */
  openerOf(tileFor(env, title)).click();
  const before = openerOf(tileFor(env, title));
  btn(caseReact(env), "Loved").click();
  const after = openerOf(tileFor(env, title));
  ok("the wall was rebuilt while the case was open", before !== after);
  c.dispatch("keydown", { key: "Escape" });
  ok("focus goes to the film's new button", globalThis.__focused === after);
  ok("not the old detached one", globalThis.__focused !== before);
}

console.log("\nthe rest of the shelf");
{
  const { env } = await shelf();
  const wall = wallOf(env);
  const more = walk(wall).find(n => n.tagName === "BUTTON" && n.textContent === "Show more");
  ok("show more is still offered", !!more);
  const n0 = wall.children.length;
  more.click();
  ok("and still pages the wall", wall.children.length > n0, `${n0} -> ${wall.children.length}`);
  ok("the search field is untouched", /<input class="find" id="find" type="search"/.test(html));
  ok("the case has a narrow-screen layout", /\.case-grid\{grid-template-columns:minmax\(0,1fr\)\}/.test(html));
}

finish();
