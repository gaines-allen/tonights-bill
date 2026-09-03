/**
 * The shared test rig: a small DOM stub, a virtual clock, and a loader that
 * lifts the app's real source out of index.html and imports it as a module.
 *
 * The page is one file with no build step and no framework, so two things make
 * this possible without dragging in a headless browser:
 *
 *   - the IIFE ends with `if(document.readyState === "loading") ... else init()`,
 *     so a stub that reports "loading" loads every definition and renders
 *     nothing;
 *   - the app reaches setTimeout through the global, so a virtual clock
 *     installed before import makes every beat instant and exact.
 *
 * Nodes record their listeners, so a test can `click()` a button or
 * `dispatch("keydown", {key:"Escape"})` at an element and run the real
 * handler. `focus()` records the node in `globalThis.__focused`, which is also
 * what `document.activeElement` reports. There is no bubbling and no layout.
 *
 * Used by reveal.test.mjs, session.test.mjs and shelf.test.mjs.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const html = await readFile(join(ROOT, "index.html"), "utf8");

/* ------------------------------------------------------------ assertions */
let pass = 0, fail = 0;
export const eq = (l, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log(`  ok   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}\n       got  ${a}\n       want ${b}`); }
};
export const ok = (l, cond, note) => {
  if (cond) { pass++; console.log(`  ok   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}${note ? "\n       " + note : ""}`); }
};
export function finish(){
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

/* ------------------------------------------------------------------ clock */
export const Clock = {
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
export function makeNode(tag){
  const n = {
    tagName: String(tag).toUpperCase(),
    _cls: "", children: [], parent: null, _text: "", value: "", _ev: {},
    style: { _p: {}, setProperty(k, v){ this._p[k] = v; }, getPropertyValue(k){ return this._p[k] || ""; } },
    attrs: {}, dataset: {}, disabled: false,
    offsetWidth: 100, offsetTop: 0,
    setAttribute(k, v){ this.attrs[k] = String(v); },
    getAttribute(k){ return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k){ delete this.attrs[k]; },
    addEventListener(t, fn){ (this._ev[t] = this._ev[t] || []).push(fn); },
    removeEventListener(t, fn){ this._ev[t] = (this._ev[t] || []).filter(f => f !== fn); },
    /* fire the real handlers registered on this node; no bubbling */
    dispatch(t, props){
      const e = Object.assign({ type: t, target: this, currentTarget: this, key: "", shiftKey: false,
        defaultPrevented: false, preventDefault(){ e.defaultPrevented = true; }, stopPropagation(){} }, props || {});
      (this._ev[t] || []).slice().forEach(fn => fn.call(this, e));
      return e;
    },
    click(){ return this.dispatch("click"); },
    focus(){ globalThis.__focused = this; },
    scrollIntoView(){},
    appendChild(c){ c.parent = this; this.children.push(c); return c; },
    remove(){},
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    closest(){ return null; },
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

/* every descendant of a node, in document order */
export function walk(node){
  const out = [];
  (function w(x){ x.children.forEach(c => { out.push(c); w(c); }); })(node);
  return out;
}

const mapStore = (m) => ({
  getItem: k => (m.has(k) ? m.get(k) : null),
  setItem: (k, v) => m.set(k, String(v)),
  removeItem: k => m.delete(k)
});

/* `store` and `session` are Maps standing in for localStorage and
   sessionStorage; pass the same Map to a second loadApp() to simulate a
   refresh in the same tab. */
export function installEnv({ reduced = false, store = null, session = null } = {}){
  Clock.reset();
  globalThis.__focused = null;
  globalThis.__fetches = 0;
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
    fonts: { ready: Promise.resolve() },
    get activeElement(){ return globalThis.__focused || doc.body; }
  };
  store = store || new Map();
  session = session || new Map();
  globalThis.document = doc;
  globalThis.window = {
    matchMedia: (q) => ({ matches: /prefers-reduced-motion/.test(q) ? reduced : false }),
    addEventListener(){}, scrollTo(o){ globalThis.__scrolled = (o && o.top) || 0; },
    innerWidth: 1440, innerHeight: 900, scrollY: 0,
    localStorage: mapStore(store),
    sessionStorage: mapStore(session)
  };
  globalThis.localStorage = globalThis.window.localStorage;
  globalThis.sessionStorage = globalThis.window.sessionStorage;
  globalThis.Image = function(){ this.src = ""; };
  globalThis.fetch = () => { globalThis.__fetches++; return Promise.reject(new Error("no network in tests")); };
  globalThis.requestAnimationFrame = (fn) => Clock.set(fn, 16);
  globalThis.setTimeout = (fn, ms) => Clock.set(fn, ms);
  globalThis.clearTimeout = (id) => Clock.clr(id);
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  return { doc, byId, store, session };
}

/* ------------------------------------------------------------ load the app */
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const appBody = blocks[1]
  .replace(/\(function\(\)\{/, "")
  .replace(/"use strict";/, "")
  .replace(/\}\)\(\);\s*$/, "");
const EXPORTS = `
export { FILMS, BY_TITLE, S, Reveal, storeSays, storeCard, listOf, accentFor, ATTR_PHRASE, CLERK,
         titleStep, scoreAll, billActs, setFeature, renderBill, programme, houseDecides,
         lockIt, announcePick, dealAnother, promote, startListOver, rebuild, aislePick,
         Run, filmKey, eligible, nextPick,
         showScene, renderWall, keepTile, openCase, closeCase, setTaste, toggleWatched, markWatched,
         MODE_get, JUST_get, HEAD_get, LAST_get, CASE_get, SCENE_get };
function MODE_get(){ return MODE; }
function JUST_get(){ return JUST_LOCKED; }
function HEAD_get(){ return HEAD; }
function LAST_get(){ return LAST; }
function CASE_get(){ return CASE; }
function SCENE_get(){ return SCENE; }
`;
export async function loadApp(opts){
  const env = installEnv(opts);
  const src = blocks[0] + "\n" + appBody + "\n" + EXPORTS;
  const mod = await import(
    "data:text/javascript;base64," + Buffer.from(src).toString("base64") +
    "#" + Math.random()                       /* defeat the module cache */
  );
  return { mod, env };
}
