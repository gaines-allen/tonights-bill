/**
 * Covers the recommendation run: "Show me something else" never returns to a
 * film that has already headlined this run, a film promoted off the shelf
 * counts as shown, the honest state when every match has had its turn,
 * starting the list over, a new run forgetting the old one, and a skip
 * leaving the taste profile alone.
 *
 * Runs against the built-in catalog only (the fetch for data/catalog.json is
 * refused), so the candidate pool is the same on every machine.
 */
import { Clock, loadApp, eq, ok, walk, finish, html } from "./harness.mjs";

const SPENT = "You've made it through every match for these answers.";
const settle = () => Clock.tick(50);
const key = (mod) => mod.filmKey(mod.HEAD_get().f);
function night(S){
  S.room = "two"; S.time = 150; S.timePreset = "two"; S.moods = ["weird"];
  S.genres = []; S.rate = 0; S.minRT = 0;
  S.taste = {}; S.watched = {}; S.locked = null; S.bills = []; S.offered = [];
}

console.log("\nshow me something else");
{
  /* The report: the first film came back after three clicks. The old code
     stepped an index round the ranked list and wrapped. */
  const { mod } = await loadApp({ reduced: true });
  night(mod.S);
  mod.programme({ quiet: true, silent: true }); settle();
  const pool = mod.scoreAll().picks.length;
  ok(`the pool is big enough to click through (${pool})`, pool >= 6);
  eq("the first feature is the top pick", key(mod), mod.filmKey(mod.scoreAll().picks[0].f));

  const shown = [key(mod)];
  let ranked = 0;
  for (let i = 0; i < 10 && shown.length < pool; i++) {
    const want = mod.nextPick(mod.LAST_get());
    mod.dealAnother(); settle();
    if (mod.HEAD_get() === want) ranked++;
    shown.push(key(mod));
  }
  ok(`well past three clicks (${shown.length - 1})`, shown.length - 1 >= 5);
  eq("no main recommendation repeats", new Set(shown).size, shown.length);
  eq("each replacement is the best-ranked film not yet shown", ranked, shown.length - 1);
  eq("every feature is in the run's shown set", shown.filter(k => !mod.Run.keys().includes(k)), []);
  eq("and nothing from the shelf is", mod.Run.keys().length, shown.length);
}

console.log("\npromotion from the shelf");
{
  const { mod } = await loadApp({ reduced: true });
  night(mod.S);
  mod.programme({ quiet: true, silent: true }); settle();
  const first = mod.HEAD_get();
  const alt = mod.LAST_get().picks[3];
  eq("an alternate on the shelf is not counted as shown", mod.Run.has(alt.f), false);

  mod.promote(alt); settle();
  eq("promoting it makes it the feature", key(mod), mod.filmKey(alt.f));
  eq("and it joins the shown set", mod.Run.has(alt.f), true);

  mod.dealAnother(); settle();
  ok("something else is not the promoted film", key(mod) !== mod.filmKey(alt.f));
  ok("nor the first one", key(mod) !== mod.filmKey(first.f));

  const seen = new Set([mod.filmKey(first.f), mod.filmKey(alt.f), key(mod)]);
  let repeats = 0;
  for (let i = 0; i < 40 && mod.MODE_get() !== "spent"; i++) {
    mod.dealAnother(); settle();
    if (mod.MODE_get() === "spent") break;
    const k = key(mod);
    if (seen.has(k)) repeats++;
    seen.add(k);
  }
  eq("clicking to the end never brings either back", repeats, 0);
}

console.log("\nwhen every match has had its turn");
{
  const { mod, env } = await loadApp({ reduced: true });
  night(mod.S); mod.S.genres = ["documentary"];
  mod.programme({ quiet: true, silent: true }); settle();
  const pool = mod.scoreAll().picks.length;
  ok(`a small pool for these answers (${pool})`, pool >= 2 && pool <= 12);

  const shown = [key(mod)];
  for (let i = 1; i < pool; i++) { mod.dealAnother(); settle(); shown.push(key(mod)); }
  eq("every candidate is shown exactly once", new Set(shown).size, pool);

  const last = key(mod);
  mod.dealAnother(); settle();
  eq("the next click does not recycle a film", key(mod), last);
  eq("the run is spent instead", mod.MODE_get(), "spent");
  const grid = walk(env.doc.getElementById("bill-grid"));
  ok("the page says so, in the promised words", grid.some(n => n.textContent === SPENT));
  eq("so does the live region", env.doc.getElementById("announce").textContent, SPENT);
  const labels = grid.filter(n => n.tagName === "BUTTON").map(n => n.textContent);
  ok("it offers to change tonight's answers", labels.includes("Change tonight's answers"), labels.join(" | "));
  ok("and to start this list over", labels.some(l => l.startsWith("Start this list over")), labels.join(" | "));
  eq("the shelf is cleared rather than left pointing at shown films",
     env.doc.getElementById("shelf-slot").children.length, 0);

  /* start this list over: only the shown set is forgotten */
  const genres = mod.S.genres.slice();
  const over = grid.find(n => n.tagName === "BUTTON" && n.textContent.startsWith("Start this list over"));
  over.click(); settle();
  eq("the shown set holds just the new feature", mod.Run.keys().length, 1);
  eq("the list begins again from the top", key(mod), shown[0]);
  eq("as a feature, not a spent run", mod.MODE_get(), "feature");
  eq("the answers were not touched", mod.S.genres, genres);
  mod.dealAnother(); settle();
  eq("and it moves on from there", key(mod), shown[1]);

  /* change tonight's answers: back to the counter, the set intact */
  for (let i = 0; i < pool; i++) { mod.dealAnother(); settle(); }
  eq("spent again after a second lap", mod.MODE_get(), "spent");
  const back = walk(env.doc.getElementById("bill-grid"))
    .find(n => n.tagName === "BUTTON" && n.textContent === "Change tonight's answers");
  back.click();
  eq("change tonight's answers returns to the counter", mod.SCENE_get(), "tonight");
  eq("returning does not destroy the set by itself", mod.Run.keys().length, pool);
  mod.programme({ quiet: true, silent: true }); settle();
  eq("submitting the counter again does", mod.Run.keys().length, 1);
}

console.log("\nseen it, mid-run");
{
  /* the other way a run can empty: the last unshown film is marked seen */
  const { mod } = await loadApp({ reduced: true });
  night(mod.S); mod.S.genres = ["documentary"];
  mod.programme({ quiet: true, silent: true }); settle();
  const pool = mod.scoreAll().picks.length;
  for (let i = 1; i < pool; i++) { mod.dealAnother(); settle(); }
  mod.markWatched(mod.HEAD_get().f.t);
  mod.rebuild();
  eq("with nothing unshown left, the rebuild is honest too", mod.MODE_get(), "spent");
}

console.log("\na new run forgets the old one");
{
  const { mod, env } = await loadApp({ reduced: true });
  night(mod.S);
  mod.programme({ quiet: true, silent: true }); settle();
  for (let i = 0; i < 4; i++) { mod.dealAnother(); settle(); }
  eq("five films have headlined", mod.Run.keys().length, 5);

  const stored = JSON.parse(env.session.get("tb:run"));
  eq("the chain is kept in sessionStorage", stored.length, 5);
  eq("not in the profile's localStorage", [...env.store.keys()].filter(k => k === "tb:run"), []);
  eq("and it is keyed by title and year", stored[0], mod.HEAD_get() && mod.Run.keys()[0]);
  ok("in a shape that cannot collide across remakes", /\(\d{4}\)$/.test(stored[0]), stored[0]);

  /* a refresh in the same tab keeps the chain */
  const again = await loadApp({ reduced: true, session: env.session, store: env.store });
  eq("a refresh keeps the chain", again.mod.Run.keys(), stored);

  /* a fresh run does not */
  night(again.mod.S);
  again.mod.programme({ quiet: true, silent: true }); settle();
  eq("submitting the counter starts over", again.mod.Run.keys().length, 1);
  eq("with the top pick", key(again.mod), again.mod.filmKey(again.mod.scoreAll().picks[0].f));
  eq("and replaces the stored chain", JSON.parse(again.env.session.get("tb:run")).length, 1);

  again.mod.dealAnother(); settle(); again.mod.dealAnother(); settle();
  eq("three shown", again.mod.Run.keys().length, 3);
  again.mod.houseDecides(); settle();
  eq("dealer's choice starts over too", again.mod.Run.keys().length, 1);
  eq("in house mode", again.mod.MODE_get(), "house");
  again.mod.dealAnother(); settle();
  eq("and something else works from there", again.mod.Run.keys().length, 2);
}

console.log("\na skip is not a verdict");
{
  const { mod } = await loadApp({ reduced: true });
  night(mod.S);
  mod.S.taste = { "Heat": "loved", "Barbie": "hated" };
  mod.S.watched = { "Coraline": "2026-01-01T00:00:00.000Z" };
  mod.programme({ quiet: true, silent: true }); settle();
  const snap = () => JSON.stringify([mod.S.taste, mod.S.watched, mod.S.bills, mod.S.locked, mod.S.offered]);
  const before = snap();
  for (let i = 0; i < 6; i++) { mod.dealAnother(); settle(); }
  eq("loved, not for me, seen it, past showings, the lock and the offered memory are untouched",
     snap(), before);
  eq("no skipped film was rated", Object.keys(mod.S.taste).length, 2);
  eq("none was marked watched", Object.keys(mod.S.watched).length, 1);
}

console.log("\nthe wiring");
{
  ok("the index that went round the list is gone", !/REROLLS/.test(html));
  ok("the shown set comes out of the pool before a winner is chosen",
     /function nextPick\(out\)\{\s*const rest = eligible\(out\);\s*return rest\.length \? rest\[0\] : null;/.test(html));
  ok("the headliner is recorded in exactly one place, as it is painted",
     (html.match(/Run\.add\(/g) || []).length === 1 &&
     /function setFeature\(rec\)\{\s*HEAD = rec;\s*Run\.add\(rec\.f\);/.test(html));
  ok("the run lives in sessionStorage", html.includes('sessionStorage.setItem(KEY'));
  ok("and never in the profile's save()", !/function save\(\)\{[\s\S]{0,500}\bRun\b/.test(html));
  ok("the scoring still carries every filter and the offered penalty",
     html.includes("if(!hardPass(f)) return;") && html.includes("recentlyOfferedIndex(f.t)"));
}

finish();
