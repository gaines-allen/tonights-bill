# Main Feature

A movie picker for one household, dressed as a neighborhood video store that is
still open late. (Formerly "Tonight's Bill".) You tell it who's on the couch,
how much time you have, what you're in the mood for, and which films you've
loved or bounced off. It scores a catalog of 244 major releases against that and
hands you tonight's pick, with a written reason from the store.

One self-contained file. No build step, no dependencies, no server.
Open `index.html` in any browser.

The 2026 redesign replaced the "ninety seconds before a movie starts" theater
look with the Main Feature brand world: an illuminated marquee, cream ticket
stock, laminated shelf signage, paper recommendation notes, and a browsable
"The Aisles" section cut from the same catalog tags. Everything below about
scoring, filters, and data still holds; where this document describes the old
visual language, trust the code.

## Why it isn't an AI app

The obvious design is a page that asks a model for recommendations. That isn't
possible in the environment this was built for, and it turned out to be the
better constraint. A local engine over hand-tagged data cannot invent a film
that doesn't exist or claim something is on Netflix when it isn't — the two
failure modes that would have made an LLM version useless in practice.

For anything outside the catalog, there is nothing to ask — the house programmes
from what it actually has on the shelf, and says so.

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
| plot synopsis | TMDB overview, trimmed on sentence boundaries |
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

### The house

The interface is the ninety seconds before a movie starts, not a form that
returns results. It is built as **scenes** rather than pages: arrival, making
the night, the lights going down, the feature.

Three voices do the work and never trade jobs. **Instrument Serif** is the
cinematic voice — the opening statement, the mood programme, every movie title.
**Archivo** is functional: navigation, buttons, questions, labels. **IBM Plex
Mono** is ticket stock and nothing else — showtimes, runtime, year, rating,
the date and time at the top of the arrival.

Colour is almost entirely black, charcoal and warm cream with one restrained
red. The films supply the rest.

**Arrival** is deliberately compact. A mono annotation (`SATURDAY / 8:47 PM`),
the statement, one line under it, and then the first real decision inside the
same viewport on a laptop. Behind it, a heavily scrimmed backdrop drifts slowly
between a few films — and once the viewer answers something, the room starts
reacting to them instead.

**Three decisions, one scene.** On a wide screen the questions hang out in the
left margin like credits, set in serif italic, so three decisions read as one
composed page rather than three form sections stacked down the screen. Nothing
is numbered. None of them is a card:

- *Who's watching* — large type in a row, with a rule that draws itself under
  the answer and turns red when it is the one.
- *How long have we got* — a programme listing. One hair rule across the top,
  the times hanging beneath it in Archivo with a mono cap under each
  (`UNDER 2H 15`), and a red segment burned into the rule above tonight's.
- *What kind of night is it* — a programme page set in Instrument Serif at six
  different sizes, on a three-column grid where each column starts at a
  different height. Approaching one fades a film in behind the words at 13%,
  and the one you pick keeps it.

**The call** takes the full width of the frame and the largest sans on the
page — the scene has been building to it. Disabled it is a hairline outline;
armed it is a red slab.

**Let the house decide** is not a smaller button under the big one. It gets its
own room below the call — hairlines top and bottom, *Or don't decide at all.*
set in serif italic on one side and the action on the other. Taking it deals:
seven posters pass through a shuffle for about 620ms and one stays, then the
reveal opens on it — one film, no shelf.

**The lights go down.** Requesting a bill does not swap screens.

```
0ms     the room recedes — opacity, a little blur, a fractional scale-down
~40ms   the chosen film's artwork starts downloading behind the black
240ms   a line of mono in the dark: FEATURE PRESENTATION
380ms   the scene changes while nobody can see it
420ms   the darkness begins a long, slow lift while the backdrop resolves out
        of a 22px blur underneath it — the film emerges *through* the dark
~790ms  the title lands, blurring into focus, last and hardest
```

About 1.0s end to end. The house darkens in 300ms and comes back in 640ms, and
that asymmetry is the whole trick: nothing is ever revealed by a cut. The wait
for the artwork is spent inside the transition rather than in front of a
spinner. Skipped entirely under `prefers-reduced-motion`.

**The feature** fills the viewport, and the film supplies the palette. Under
the backdrop sits a blown-up, blurred, saturated copy of the same artwork —
that is what makes Dune's orange and The Matrix's green colour the whole room
rather than just the middle of the frame. The backdrop itself is carried at 92%
and legibility comes from layered scrims that darken the side the words are on
while leaving a lit region alone, never from flattening the image.

The copy is anchored low and left, not centred. The hierarchy is fixed:
`TONIGHT'S PICK` / the title / **what the store says** / the story /
`2018 / 1H 40M / R / MAX` with the service lit / **LOCK IT IN**. Titles scale
to their own length — a short one runs to 184px on a laptop. Critics and fit
share one small mono line at the very bottom, where the arithmetic belongs.

**What the store says** is the one place the recommendation is explained. It
replaced a one-line pitch and a separate *Why this tonight* panel that said the
same thing twice in two voices. The card is two to four sentences in the
clerk's handwriting: what you asked for, what the film actually carries and
whose film it is, how it sits against your clock and your room, and a sign-off
— a title already on your shelf where there is one, three one-word reads where
there is not. It stays off the synopsis, the year, the rating, the service and
the critic score on purpose; all five are printed within a few inches of it.
No model and no network call: every ingredient is in hand by the time a pick
exists. *The story* stays below it as the plot synopsis.

### The bulbs
Each bulb is its own element, because a background-image strip can only pulse
as a single object and that is the tell of a fake marquee. At rest two
animations ride together without touching each other's properties: `shimmer`
owns opacity, giving every bulb its own period, phase and floor; `orbit` owns
the glow and the scale, walking one light round the whole border every eleven
seconds. Each bulb's place in that lap is handed to it as a *negative* delay,
so the wave is already mid-circuit on the first frame instead of ramping in.

### Who writes the store's lines
Each of the curated films has a line written by hand in `CLERK`. The nightly
scan shelves several hundred more titles straight off the services, and those
turn over week to week, so they cannot be written in advance and are not worth
guessing at: a line invented for a film nobody here has seen is the same
fabrication that hand-writing them was meant to replace. Those fall back to the
generator. In practice about three quarters of top picks come out written,
because the scorer favours the curated titles.

The scan that shelves them also says which ones now need a line.
`scripts/unwritten.mjs` writes `data/unwritten.md`, a worklist carrying the
year, runtime, rating, service, genres, director and premise for each, sorted
so the titles most likely to be recommended come first. Recency is read from
each entry's `firstSeen` date rather than by diffing the file against its own
previous run, which is what makes it idempotent: a night when nothing moved
rewrites nothing and commits nothing. There is no timestamp in the output for
the same reason. Write the line into `CLERK` and the title drops off the list
on the next scan.

### The reveal
Asking for a pick runs one 3-second sequence, owned by a single controller
(`Reveal`). The ask depresses and locks out; the questions step down and the
room goes under a veil; the page returns to the marquee while that veil is
opaque and `main` is lifted over it, so the sign comes up out of the dark
already in frame; one slow lap of the bulbs runs the full border; the hero is
painted and the veil lifts off it while the film's own colour flares and
settles; the poster comes forward past its resting angle as the title lands a
line at a time; the store's card arrives; then *Lock it in* goes live and the
shelf appears underneath. Taking an alternate off the shelf is not a new
recommendation, so it gets a ~400ms swap instead.

The lap is the anticipation, so nothing is allowed to arrive on top of it — the
hero waits for it to finish. Getting that wrong is most of what went wrong
here: the chase was first timed at 160ms, which is a circuit of the sign in
less than a blink, and it was fired at a marquee sitting a full screen above
the fold, because three questions is about a thousand pixels of page. It ran
correctly every time and could never be seen. `chaseBulbs()` now refuses to
fire at an off-screen sign rather than animating into the void.

Every beat is a ticketed timeout: a callback whose ticket is stale does
nothing, so a fast second click, a navigation, or a fresh request part-way
through cannot leave half of one sequence layered over another. Under
`prefers-reduced-motion` there is no chase, stagger, rotation or travel — the
finished page arrives inside 100ms. The result is announced through a polite
live region as *Tonight's pick is [title]* and focus moves to the heading
without scrolling the page.

The accent colour is derived from the film's own attribute and genre tags,
nudged by a hash of the title, rather than sampled from the poster — reading
pixels from a cross-origin image is one missing CORS header away from throwing
on every title, and the accent must never cost a second request. It reaches
light, hairlines and glow only, never a text colour.

**Also playing** is a shelf that runs off the right edge of the frame so it is
obvious the room continues. Hovering focuses one poster and steps the others
back to 50%, and previews that film's backdrop behind the feature. The first
alternative is flagged *Second choice*; the wild card — a well-reviewed film
your profile would not have surfaced — is flagged *Wild card* and is promoted
onto the shelf if the ranking would otherwise have buried it.

**Recent evenings.** Two memories doing two jobs. *Watched* is explicit: mark a
film **Seen it** and it stops being offered. *Offered* is automatic: the last
three bills carry a small bounded penalty so tonight is not word-for-word
yesterday. It reorders near-ties and never buries a better match.

**Show me something else** is a third, shorter memory, and a hard one. Every
film that has held the feature slot since the counter was last submitted is in
the run's shown set, keyed by title and year: the first pick, each replacement,
and any alternate promoted off the shelf. The next pick is the best-ranked
candidate not in that set. The set is taken out of the pool before ranking,
never applied as a penalty, because a penalised film can still win, which is
how the first pick used to come back after three clicks. Films that only sit
on the shelf are not counted. A skip is not a verdict: nothing is marked seen
or disliked. The set lives in `sessionStorage`, apart from the profile, so a
refresh keeps the chain and closing the tab drops it. It is cleared when the
counter is submitted again, when the house deals, or on **Start this list
over**. When every match has had its turn the page says so, *You've made it
through every match for these answers*, and offers **Change tonight's answers**
or **Start this list over** rather than going back round.

**Keyboard:** `Enter` asks for tonight's pick, `R` deals another, `Esc` goes
back to the counter. Shortcuts are ignored while typing in a field.

**Returning viewers** get the fast lane — *Back for another?*, the films they'd
defend, a mono line recapping tonight, and one button. **Change** brings the
questions back.

**Your Shelf** asks for five films you'd defend rather than five you liked.
Loved posters are numbered `01`–`05` and outlined in red; the rest of the wall
is untouched artwork. Each tile is a plain container holding one button for the
poster and title, named *Open details for …*, with **Loved**, **Not for me**
and **Seen it** as its siblings, so a status press never opens anything. The
button opens the film's case: poster, year, runtime, rating, the story, where
it streams, its shelf status, and the same three buttons, all from data the
page already holds. Both surfaces call the same state change and repaint from
the same stored state. The case is a labelled modal dialog: it closes on
**Close**, Escape or the backdrop, keeps the tab ring inside itself, and hands
focus back to the film's tile, looked up by title because the wall repaints
under it.

### Mobile

Composed for the size, not stacked from the desktop. The masthead drops to the
theatre name and two links. The feature bottom-aligns and takes a second scrim
keyed to where the copy actually sits — a left-hand scrim protects nothing when
text spans the full width. The pitch and synopsis clamp so the red action stays
in reach, rails let the next poster peek in, and hover-only affordances become
permanently visible. Touch targets are 44px or larger.

### Accessibility

Semantic sections and headings, a live region announcing each change of
feature, focus rings in the system's own gold rather than the browser default,
and a full `prefers-reduced-motion` path that removes the transition, the
drift, the grain and every animation while keeping the state changes immediate.
Small text sits at 4.5:1 against the ground; the dimmer tone is reserved for
large display type, where 3:1 applies.

### Performance

Posters are lazy `<img>` tags with a `srcset` across TMDB's 185/342/500 widths
and an explicit aspect ratio, so nothing reflows under the reader. Backdrops
are requested at 780px on phones and 1280px above, preloaded off-screen and
crossfaded in so a half-drawn image never appears. Only the artwork on screen
is fetched. Everything moves on CSS transitions — there is no animation
library. Some embedded viewers block external images; those elements remove
themselves on error and fall back to a typographic poster.

### Why isn't this film showing up?

`checkFilters()` is the single source of truth for "does this fit tonight", and
it returns a per-filter pass/fail record with a written reason for each —
runtime, room, rating floor, critic bar, genre, and where it streams
("2h 25m runs past your 2h 20m — 5m too long"). `hardPass()` is derived from it,
so an explanation can never drift from the behaviour it describes.

The passing half of that record is what the store's card draws on. The failing half is
summarised under the bill: how many titles would have made it but sit on a
service you don't have, how many are rent-or-buy only, how many are held back
because you have already seen them. An unexplained absence is the hardest thing
to debug in a recommender, because nothing appears to be wrong.

### Tests

```bash
node scripts/enrich.test.mjs   # transforms: service mapping, cert, providers, matching
node scripts/merge.test.mjs    # merge safety against the real index.html catalog
node scripts/reveal.test.mjs   # the reveal sequence, store copy, accent, lock-in
node scripts/session.test.mjs  # "show me something else" never repeats; the spent state
node scripts/shelf.test.mjs    # the shelf tile, the film's case, status in both places
node scripts/unwritten.mjs     # which shelved titles still need a store line
```

All run offline — no API key, no network, no headless browser. The three
page tests share `scripts/harness.mjs`, a small DOM stub and virtual clock
that import the app's real source out of `index.html`.

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
