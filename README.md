# Main Feature

A movie picker for one household, dressed as a neighborhood video store.
(Formerly "Tonight's Bill".) You tell it who's on the couch,
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

## The October 2026 entrance

The approved design handoff lives in `main-feature-handoff/` (brief, reference
page, stills). What it changed:

- **The entrance.** Three real film backdrops run edge to edge behind the
  marquee, blended with overlapping masks so there is no seam. The marquee
  says only *Main Feature*; the only other words in the hero are **Find your
  movie →**, which opens the questionnaire (closed until then) and moves focus
  to it. The bulbs keep their shimmer and slow orbit and stop under
  `prefers-reduced-motion`. The old drifting backdrop, the date stamp and the
  *Open Late* sign are gone. The footer is one line: *Real Movies, Real
  Recommendations*. The provenance note that used to sit there is now at the
  foot of The Aisles, with the TMDB attribution; the scan date sits under the
  search; the storage note sits on Your Shelf.
- **Search** is the last item in the header row (Tonight, The Aisles, Your
  Shelf, Past Showings, Search). Pressing it opens the search bar with the
  cursor in it; pressing it again, Close, or Escape puts it away. See below.
- **Star · thumbs up · thumbs down** under every film. See below.
- **Favicon.** A red-and-cream popcorn bucket: `assets/icons/favicon.svg`, a
  pixel-tuned 16px drawing, PNGs at 16/32/48/180/192/512, a multi-size
  `favicon.ico`, an Apple touch icon and `site.webmanifest`. Every path is
  relative, so it all works under the `/tonights-bill/` Pages base path.
- **Type.** Bebas Neue for the marquee and display controls; Cinzel (the free
  equivalent of Trajan, the movie-poster capitals) for the three questions;
  Barlow Condensed for the mood cards and search; Archivo for body; IBM Plex
  Mono for metadata; Caveat for the two handwritten asides. The handoff's
  Cormorant Garamond was dropped on review for reading too much like a stock
  serif. Trajan Pro itself is Adobe-only, so Cinzel ships instead.

### The month's three films

`scripts/hero.mjs` picks them and writes `data/hero.json`; the page only
displays what is published, so everyone sees the same three all month,
whatever services they have. It runs in the nightly refresh after the tests
and needs no secret of its own (it reads `data/catalog.json`).

- The month is decided in **America/Chicago**.
- A film qualifies with a verified backdrop, a **TMDB audience rating of 7.5+
  from 500+ votes**, and a subscription home on a supported service in the US.
  One rating source for everyone; Rotten Tomatoes never enters the ranking.
  Missing votes are never guessed.
- Ranked by rating, then votes, then TMDB id. A new month skips last month's
  three; if fewer than three others qualify it allows repeats before it would
  ever lower the bar.
- Within a month the set holds. Each night only re-checks availability: a
  film that has left every supported service is replaced in its slot by the
  next eligible film, the other two stay.
- A failed or unhealthy refresh, or too few qualifiers, keeps the last valid
  set. If `hero.json` is missing or an image fails, the page shows the
  approved stills in `assets/hero/` for that slot.

The first set (October 2026, The Godfather, 12 Angry Men, Interstellar) was
chosen from the October 4 catalog. That catalog stored ratings rounded to a
percentage, so this set's evidence is marked `ratingRounded`; `enrich.mjs` now
also records the exact `rating` and shelf `votes`, and later months use those.

### Search

Searches every film the store knows, curated and scanned, whether or not it is
on your services. Exact title first, then starts-with, then word, then
anywhere; punctuation and accents are ignored and a trailing year narrows it
("the thing 2011"). Films are de-duplicated by TMDB id, so one film never
appears under two names, while two films sharing a title keep their years.
Each result says one of:

- **On your services: …** — a checked subscription home on a service you picked
- **Not on your selected services** — checked; it says where it does stream,
  or that it is on none of the services we track
- **Availability not confirmed** — nobody has checked (a built-in guess, or
  the catalog did not load). Never reported as "no".

With no services picked it asks for them first. Rent and buy listings never
enter the catalog's service lists. The services checkboxes in the search drawer
and the toggles under *More filters* are the same stored preference
(`tb:svc`); changing either repaints both, re-runs the search, and re-scores
a pick on screen. Opening a result opens the film's case. Escape closes the
drawer; arrow keys walk the results.

### Star, thumbs up, thumbs down

One control, three equal 16px glyphs in equal boxes (44px targets on touch
screens), under the feature, the shelf beneath it, the double feature, every
aisle card, Your Shelf, past showings, search results and the case. Every copy
of a film's row repaints together.

- **Star** saves to *Your shelf* (a *Saved for later* rail at the top). It
  does not like the film or mark it watched, and a saved film can still be
  recommended.
- **Thumbs up / down** are the old *Loved* / *Not for me*: one per film,
  pressing the lit one clears it, pressing the other replaces it. Either
  thumb means the film has been seen, so it is not recommended again while
  the thumb stands and the footnote counts it with the films you've seen.
- **There is no Seen it button.** The thumbs say it. Locking a film in still
  records it as watched for Past Showings, as before.

Personalization extends the existing engine rather than replacing it: thumbs
feed the rarity-weighted taste profile at full weight (dislikes at −1.15), a
save at 0.35 of a like. Until there are three reactions the taste weight ramps
up and the head of the bill is re-dealt with a small cost for repeating a lead
genre, so one thumbs up nudges the night instead of turning it into one genre.
From three reactions on the ranking is exactly the old one (the Knives Out /
Ocean's Eleven / Hot Fuzz canary still returns Glass Onion first). Hard
filters are applied before any of this.

### Saved data

Everything is still browser-local; there is no account. Reactions, watches and
saves are now keyed by title and year (`Heat (1995)`) in `tb:taste2`,
`tb:watched2` and `tb:saved`. The old title-keyed `tb:taste` and `tb:watched`
are read on first load, copied across, and never rewritten or deleted. A title
the page cannot place until the catalog loads waits in `tb:pending2` and is
placed afterwards. History records (`tb:bills`, `tb:locked`) gain a key and
old ones without it still resolve by title.

## Why it isn't an AI app

The obvious design is a page that asks a model for recommendations. That isn't
possible in the environment this was built for, and it turned out to be the
better constraint. A local engine over a fixed tagged catalog cannot invent a film
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

Out of the box the catalog runs on the tags and estimates written into
`index.html` by Claude when the app was built, including the streaming
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
| genres | TMDB genres; "Music" only counts as a musical when TMDB's taggers also say "musical" |
| attribute tags | TMDB keywords (including its tone words: "amused", "suspenseful", "dreary"), genres and runtime, through `tagsFrom()` |
| audience, fame | certification and TMDB vote count |

**Every film is tagged the same way, every night.** The curated 245 and the
scanned shelf go through the same `tagsFrom()` rules, so a film's tags never
depend on which list it came from. The tags written into `index.html` are only
used when the page has no data file. The rules cannot produce `auteur`, which
only ever came from hand-written tags, so it no longer appears.

How the rules decide, in order:

- **Keywords vote.** Each keyword votes for the tags it names; the six tags with
  the most votes win. Matching is whole-keyword, never a substring.
- **Subjects are not moods.** "Monster" or "ghost" only votes `scary` in a
  horror film or thriller; "gangster" or "shootout" never votes `violent` in a
  family or animated film. Tone words ("frightened", "terrifying") always vote.
- **Genre only says what it guarantees.** Horror is `scary`, comedy is `comic`.
  Crime is never `violent` and adventure is never `spectacle` on genre alone.
- **Thin films are filled to three, and no further,** from their genres.

`data/keywords.json` keeps the genres and keywords behind every film so the
rules can be tuned offline. The page never loads it.

## Tone: a comedy night is not a thriller night

Each film's tone comes from its genres: a comedy is *light*; a thriller, horror,
war or crime film that is not a comedy and is tagged violent, scary or bleak is
*dark*; a crime comedy like Knives Out is *mixed* and never clashes. When three
in four of the films someone likes lean one way, films of the other tone drop
below everything that fits, and the wild card never picks one.
`scripts/tone.test.mjs` checks this on every nightly refresh, against that
night's tags, and a failure stops the refresh from being saved.

The same idea holds for genre. A genre is someone's when it is on three in four
of the films they liked (two likes at least), and a film with none of their
genres drops below those that have one, however well its mood tags match.
Arrival, Blade Runner 2049 and Dune ask for sci-fi, so Manchester by the Sea no
longer rides in on a shared melancholy. Drama never counts, since TMDB files
nearly every serious film under it.

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

**Recent evenings.** Three memories doing three jobs. *Headlined* is the
films that actually held the feature slot lately: asking again with the same
answers pushes the last few down (12%, 9%, 6%, 3%), so a fresh ask rotates
through close matches instead of handing back the film you just saw; a film
far ahead of the rest still wins. The other two: *Watched* is explicit: thumb a
film up or down, or lock it in, and it stops being offered. *Offered* is automatic: the last
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
refresh keeps the chain and closing the tab drops it. It is kept when the counter is submitted again with the same answers, so
asking twice never hands back the same film; it is cleared when any answer
changes, when the house deals, once every match has had its turn, or on
**Start this list over**. When *Show me something else* reaches the end of the
matches the page says so, *You've made it through every match for these
answers*, and offers **Change tonight's answers** or **Start this list over**
rather than going back round.

**Keyboard:** `Enter` asks for tonight's pick, `R` deals another, `Esc` goes
back to the counter. Shortcuts are ignored while typing in a field.

**Returning viewers** get the fast lane — *Back for another?*, the films they'd
defend, a mono line recapping tonight, and one button. **Change** brings the
questions back.

**Your Shelf** opens with *Saved for later* (everything starred, newest
first), then asks for five films you'd defend. Liked posters are numbered
`01`–`05` and outlined in red. Each tile is one button wrapping the poster and
the printed title, named *Open details for …* and carrying the film's
title-and-year key, so the right case opens however the wall has been
searched, sorted or extended. Under it sits the star and thumbs row; a status
is printed as a small badge (*Liked*, *Not for me*, *Watched*, *Saved*). Thumbing
a tile repaints the wall in the order it already has, so the tile stays where
the reader is; it moves to the front the next time the wall is laid out. The
button opens the film's case: poster, year, runtime, rating, the story, where
it streams, its shelf status and the same row, all from data the
page already holds. The case is a labelled modal dialog: it closes on
**Close**, Escape or the backdrop, keeps the tab ring inside itself, locks the
page behind it, and hands focus back to whatever opened it, looked up again
because the views repaint under it.

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
node scripts/taste.test.mjs    # star/thumbs control, persistence, migration, personalization
node scripts/search.test.mjs   # header search, availability wording, shared services
node scripts/hero.test.mjs     # the monthly marquee selection
node scripts/unwritten.mjs     # which shelved titles still need a store line
```

All run offline — no API key, no network, no headless browser. The page
tests share `scripts/harness.mjs`, a small DOM stub and virtual clock
that import the app's real source out of `index.html`.

## Staying current

The page is one file on a plain host, and a phone that brings it back from
memory, a tab left open for a week or an icon on the home screen, shows the
build it loaded, however long ago, until someone pulls down to refresh. So the
page remembers which build it is (the host's ETag for the file, or its date)
and, when it comes back into view after at least a minute away, or is restored
from the back-forward cache, asks the host again with one HEAD request and
reloads itself if the answer has changed. Nothing happens within a minute of
leaving, mid-reveal, or when the check fails. A nightly catalog deploy changes
the stamp too, so a page left open overnight picks up the new data on its next
return. `scripts/fresh.test.mjs` covers it.

## Known limitations

These are deliberate, and the page states them in its own footer:

- **Streaming locations are built-in guesses until you run the enrichment**, and
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
