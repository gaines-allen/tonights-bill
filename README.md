# Tonight's Bill

A movie picker for one household. You tell it who's on the couch, how much time
you have, what you're in the mood for, and which films you've loved or bounced
off. It scores a catalog of 244 major releases against that and returns a ranked
bill, with a written reason for every pick.

One self-contained file. No build step, no dependencies, no server.
Open `index.html` in any browser.

## Why it isn't an AI app

The obvious design is a page that asks a model for recommendations. That isn't
possible in the environment this was built for, and it turned out to be the
better constraint. A local engine over hand-tagged data cannot invent a film
that doesn't exist or claim something is on Netflix when it isn't — the two
failure modes that would have made an LLM version useless in practice.

For anything outside the catalog, the **Copy brief** button produces a
structured prompt you can hand to any assistant with live search.

## How the scoring works

Every film carries a set of attribute tags describing how it plays — `slowburn`,
`twisty`, `visceral`, `dialogue`, `auteur`, and so on — rather than just genre.
Genre tells you what a film is about; these tell you what it's like to watch.

When you tag films as loved or missed, the engine builds a taste profile from
those tags and scores every candidate on two things:

- **purity** — of this film's own character, how much do you like?
- **coverage** — of your distinctive taste, how much does this film hit?

Coverage is the important half. An early version scored films on a plain average
of their tag weights and ranked *Superbad* top for someone who loved
*Knives Out*, *Ocean's Eleven* and *Hot Fuzz*. Common tags like `comic` and
`brisk` saturate at maximum weight while a rare, discriminating tag like `twisty`
sits lower, so blandness won. Tags are now weighted by how uncommon they are
across the catalog (TF-IDF), and coverage rewards hitting the rare traits your
profile is actually built on. The same profile now returns *Glass Onion* first.

Misses count for slightly more than loves (`-1.15` vs `+1.0`) — knowing what
someone rejects is sharper signal than knowing what they enjoyed. With nothing
tagged, recognizability breaks ties; as the profile grows, fame gets out of the
way of it.

### Filters are hard, scoring is soft

Runtime, audience, rating floor, critic score, genre and service are absolute
cutoffs — a film that fails any of them never appears, regardless of fit. Only
ranking is fuzzy. The two rating controls squeeze from opposite ends:
**Who's watching** caps the top (kids in the room means all-ages only), and
**Minimum rating** sets the floor (R returns R and up).

`hardPass()` is the single predicate for "does this fit tonight". Both the bill
and the taste grid call it, so the two can never disagree on screen.

## Editing the catalog

Films live in the `RAW` array as positional rows:

```
[ title, year, runtime, genres, attributes, service, director, hook,
  audience, fame, mpaa, tomatometer ]
```

- `genres` / `attributes` — pipe-separated. Keep attributes to the existing
  vocabulary; a typo silently creates a tag nothing else shares, which quietly
  degrades every recommendation rather than erroring.
- `service` — `NFX MAX HUL DIS PRV APL PAR PCK`
- `audience` — `all | teen | adult` (independent of `mpaa`; this is
  "who can watch it", not the board's rating)
- `fame` — `3` iconic, `2` well known, `1` for film people
- `mpaa` — `G | PG | PG-13 | R | NR`. Unrated titles fall back to `audience`
  for filtering, so nothing unrated is ever treated as tamer than it is.

After changing the catalog, sanity-check that a profile of *Knives Out*,
*Ocean's Eleven* and *Hot Fuzz* still returns *Glass Onion* first. That case is
the canary for the scoring regression described above.

## Sourced data (optional)

Out of the box the catalog is entirely hand-authored, including the streaming
homes and critic scores — those are estimates, and the page says so. Running the
enrichment script replaces them with sourced values.

```bash
export TMDB_TOKEN='<v4 read access token>'   # free: themoviedb.org/settings/api
export OMDB_KEY='<key>'                      # optional: omdbapi.com — adds real RT scores
node scripts/enrich.mjs                      # or --limit 10 to try it first
```

That writes `data/catalog.json`, which the page fetches on load and merges over
its built-in data, replacing:

| Field | Source |
|---|---|
| runtime | TMDB movie details |
| MPAA certification | TMDB release dates, US theatrical |
| critic score | **OMDb** (real Rotten Tomatoes) if `OMDB_KEY` is set, else TMDB user score |
| streaming availability | TMDB watch providers (JustWatch), US, subscription only |
| poster art | TMDB images — no API key needed to *display* them |

The attribute tags, hooks, fame and audience calls stay hand-authored. No API
knows how a film plays, and that is what the recommender actually scores on.

**The key never reaches the page.** Enrichment happens ahead of time and only
its output ships, so this stays a static site with nothing to leak. The included
GitHub Action re-runs it daily from repository secrets.

Three deliberate properties:

- **The page works without it.** If `data/catalog.json` is missing or the fetch
  is blocked, the built-in catalog stands and the footer says the numbers are
  estimates. Opening `index.html` straight off disk still works.
- **Provenance is per-film.** A title that matched shows "Rotten Tomatoes score,
  via OMDb"; one that did not still says "estimated". Mixed states are normal
  and are labelled honestly rather than averaged into a single claim.
- **Bad rows cannot corrupt the catalog.** A row is only applied when both title
  and year agree, and each field is validated before it overwrites anything.
  `scripts/merge.test.mjs` covers the malformed cases.

Posters are `<img>` tags pointed at TMDB's CDN. Some embedded viewers block
external images; those elements remove themselves on error rather than leaving
broken boxes, which is why posters appear on GitHub Pages or locally but not
inside a sandboxed artifact frame.

### Tests

```bash
node scripts/enrich.test.mjs   # transforms: service mapping, cert, providers, matching
node scripts/merge.test.mjs    # merge safety against the real index.html catalog
```

Both run offline — no API key, no network.

## Known limitations

These are deliberate, and the page states them in its own footer:

- **Streaming locations are hand-tagged until you run the enrichment**, and
  rights move constantly. Verify before committing the evening.
- **Critic scores are estimates until you run the enrichment.** The built-in
  numbers approximate critical consensus; they are not sourced from, affiliated
  with, or endorsed by any review aggregator. Run `scripts/enrich.mjs` with an
  OMDb key to replace them with real Rotten Tomatoes scores. Note the catalog
  skews acclaimed either way, so the score floor only really bites above 95%.
- **Availability is accurate to about a day, not the minute.** JustWatch pushes
  to TMDB once per 24 hours, so a title that moved this morning may still show
  yesterday's home.
- **Profile persistence depends on the host.** It saves to `localStorage`, which
  some embedded viewers block. The page probes for this on load and tells you
  which case you're in rather than silently losing your settings.
