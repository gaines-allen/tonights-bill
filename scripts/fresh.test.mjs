/**
 * Covers the page keeping itself current: it remembers the host's stamp for
 * this file at load, asks again with one HEAD request when it comes back into
 * view after being away, and reloads only when the stamp has changed. It stays
 * quiet within a minute of leaving, mid-reveal, when the host gives it no
 * stamp, and when the check fails.
 */
import { loadApp, eq, ok, finish, html } from "./harness.mjs";

/* a host that answers HEAD with whatever headers the test hands it */
function host(headers, opts){
  const calls = [];
  globalThis.fetch = (url, init) => {
    calls.push({ url, method: init && init.method, cache: init && init.cache });
    if (opts && opts.fail) return Promise.reject(new Error("offline"));
    return Promise.resolve({ ok: !(opts && opts.status) || opts.status < 400,
      headers: { get: (n) => headers[n.toLowerCase()] || null } });
  };
  return calls;
}

console.log("\nremembering the build");
{
  const { mod } = await loadApp({ reduced: true });
  const calls = host({ etag: '"abc-1"', "last-modified": "Thu, 10 Sep 2026 15:03:48 GMT" });
  await mod.Fresh.start();
  eq("one HEAD request at load", calls.map(c => c.method), ["HEAD"]);
  eq("straight to the host, past every cache", calls[0].cache, "no-store");
  eq("for this page", calls[0].url, "./");
  eq("the ETag is the stamp", mod.Fresh.mark, '"abc-1"');

  const { mod: mw } = await loadApp({ reduced: true });
  host({ etag: 'W/"abc-1"' });
  await mw.Fresh.start();
  eq("a weak ETag from the CDN is the same tag", mw.Fresh.mark, '"abc-1"');

  const { mod: m2 } = await loadApp({ reduced: true });
  host({ "last-modified": "Thu, 10 Sep 2026 15:03:48 GMT" });
  await m2.Fresh.start();
  eq("without an ETag the date stands in", m2.Fresh.mark, "Thu, 10 Sep 2026 15:03:48 GMT");

  const { mod: m3 } = await loadApp({ reduced: true });
  host({});
  await m3.Fresh.start();
  eq("with neither there is no stamp", m3.Fresh.mark, null);
  host({ etag: '"anything"' });
  m3.Fresh.hidden(); m3.Fresh.away -= 120000;
  let reloads = 0; m3.Fresh.reload = () => reloads++;
  eq("and no stamp means no checking", await m3.Fresh.shown(), false);
  eq("nor reloading", reloads, 0);
}

console.log("\ncoming back into view");
{
  const { mod } = await loadApp({ reduced: true });
  let reloads = 0; mod.Fresh.reload = () => reloads++;
  const calls = host({ etag: '"abc-1"' });
  await mod.Fresh.start();

  mod.Fresh.hidden();
  eq("back within a minute: no request", await mod.Fresh.shown(), false);
  eq("", calls.length, 1);

  mod.Fresh.away -= 61000;
  eq("back after a minute with the same build: one request, no reload", await mod.Fresh.shown(), false);
  eq("", [calls.length, reloads], [2, 0]);

  host({ etag: '"abc-2"' });
  mod.Fresh.hidden(); mod.Fresh.away -= 61000;
  eq("back to find a newer build: reload", await mod.Fresh.shown(), true);
  eq("once", reloads, 1);
  eq("and the new stamp is remembered, so a blocked reload cannot loop", mod.Fresh.mark, '"abc-2"');

  host({ etag: '"abc-2"' }, { fail: true });
  mod.Fresh.hidden(); mod.Fresh.away -= 61000;
  eq("a failed check changes nothing", await mod.Fresh.shown(), false);
  eq("", reloads, 1);

  host({ etag: '"abc-3"' }, { status: 500 });
  mod.Fresh.hidden(); mod.Fresh.away -= 61000;
  eq("nor does an error from the host", await mod.Fresh.shown(), false);

  host({ etag: '"abc-3"' });
  mod.Fresh.hidden();
  eq("restored from the back-forward cache: checked at once, however brief the absence", await mod.Fresh.shown(true), true);
  eq("", reloads, 2);
}

console.log("\nnever mid-reveal");
{
  const { mod } = await loadApp({ reduced: true });
  let reloads = 0; mod.Fresh.reload = () => reloads++;
  const calls = host({ etag: '"abc-1"' });
  await mod.Fresh.start();
  host({ etag: '"abc-9"' });
  mod.Reveal.busy = () => true;
  mod.Fresh.hidden(); mod.Fresh.away -= 61000;
  eq("a reveal in flight is left alone", await mod.Fresh.shown(), false);
  eq("it did not even ask", calls.length, 1);
  eq("", reloads, 0);
  mod.Reveal.busy = () => false;
  eq("once it is over, the check goes ahead", await mod.Fresh.shown(), true);
}

console.log("\nthe wiring");
{
  ok("the page starts watching from init", /watchFreshness\(\);/.test(html));
  ok("it listens for the page going hidden and coming back",
     /document\.addEventListener\("visibilitychange", function\(\)\{\s*if\(document\.visibilityState === "hidden"\) Fresh\.hidden\(\); else Fresh\.shown\(\);/.test(html));
  ok("and for restoration from the back-forward cache",
     /window\.addEventListener\("pageshow", function\(e\)\{ if\(e\.persisted\) Fresh\.shown\(true\); \}\);/.test(html));
  ok("the reload is the browser's own", /reload\(\)\{ location\.reload\(\); \}/.test(html));
}

finish();
