# Main Feature: approved UI and functionality brief

You are my lead UI engineer and creative developer. Implement the approved Main Feature interface in this existing repository, then add the functionality below. Complete the build and verification; do not stop at a plan or substitute your own redesign.

Current site: https://gaines-allen.github.io/tonights-bill/

Main Feature recommends movies for tonight. Its existing core functionality works. Preserve that foundation while implementing this approved visual direction, movie search, monthly hero selections, and persistent save/taste controls.

## Read these references first

- `approved-preview.html`: the approved visual reference, including interactive questionnaire and search examples. Open it in a browser at desktop and mobile widths.
- `approved-fragment.html`: the editable source of the preview.
- `assets/`: the exact film stills used in the approved preview.
- `REFERENCE-NOTES.md`: asset mapping and the distinction between the preview and production behavior.

Treat this brief as authoritative. The preview establishes appearance and interaction direction. Its embedded catalog is a dated example, and its recommendation button is a presentation stub. Reconnect all controls to the actual application. Do not ship the preview as a replacement for the real app or copy its embedded search snapshot into production.

Inspect the existing code, catalog enrichment, saved-service preferences, recommendation engine, taste/shelf storage, and deployment workflow before editing. Reuse the existing stack and data flow. Keep GitHub Pages compatibility. Preserve unrelated work and existing saved user data.

## Approved design: implement closely

The entrance should feel cinematic, warm, and personal, with real film imagery and a playful marquee. Match the reference's fonts, colors, gradients, proportions, rounded buttons, and light animation.

### Header and favicon

- Keep the compact Main Feature brand at the left and existing navigation.
- Put movie search at the top right on desktop. Reflow it cleanly on mobile.
- Include an accessible way to manage selected streaming services beside search. These must be the same preferences used by recommendations.
- Use a fun popcorn-bucket favicon. The preview's popcorn emoji represents the idea. Create a consistent, simple red-and-cream bucket with popcorn that remains recognizable at 16 and 32 pixels; use a proper vector/PNG asset rather than relying on platform emoji appearance. Include standard browser favicon assets and an Apple touch icon. Use asset paths that work under the `/tonights-bill/` GitHub Pages base path.

### Hero

- Exactly THREE real movie backdrops sit side by side across the hero, with overlapping gradient masks that gradually blend their joins. No visible hard seams, image frames, or three separate cards.
- Preserve enough of each film shot to make all three visible. The background should feel cinematic, not nearly black. Apply only the shading needed for readable foreground content, and blend the lower edge into the page.
- Center the animated marquee over the imagery, horizontally and within the hero composition. Its ONLY copy is **Main Feature**. No subtitle inside it.
- Preserve the warm bulbs and the subtle chasing/shimmer animation around the marquee. Keep the animation restrained and respect reduced-motion preferences.
- The only other hero text is the primary button: **Find your movie →**. No “A great movie,” “A terrible bedtime,” supporting hero copy, or “Open Late.”
- Clicking Find your movie opens/reveals the existing questionnaire and takes the visitor to it. Search remains available independently. This is an entrance to the recommendation flow, not an additional questionnaire step.
- Keep the composition compact. Avoid tall empty bands above or below the marquee, and do not restore the large dark gaps from earlier versions.
- The three images change as a set MONTHLY. They do not become an autoplay carousel or swap randomly during a visit.

### Questionnaire, cards, and footer

- Preserve the working audience, runtime, mood, genre, service, and other existing filters and their behavior. Keep Dealer's choice.
- Keep the real image-based mood options, the soft blended buttons, restrained selected highlights, and small interaction animations.
- Preserve the approved font system: Bebas Neue for the marquee and display controls; Cormorant Garamond for the existing editorial/question treatment; Archivo for body text; IBM Plex Mono for small metadata; Caveat for the few established handwritten accents. Reuse existing assets/styles where possible. Do not replace these with generic dashboard typography.
- Explicitly set component text colors so host or default heading styles cannot introduce unreadable black text on dark surfaces.
- Keep the existing aisles, personal shelf, past showings, movie details, and recommendation results connected to the app.
- The footer copy is exactly **Real Movies, Real Recommendations**. Remove “Open Late” and “Still open late” throughout the interface.

## Movie search and streaming services

Build a working search against the application's current catalog and current streaming-availability data.

1. Search titles case-insensitively as the visitor types, with appropriate debounce if needed. Prioritize exact matches, then useful partial matches. Deduplicate records by stable movie identity, not display title. Different releases with the same title must retain their release years.
2. Show title, release year, and availability on the visitor's SELECTED streaming services. Use US availability, matching the existing application's region.
3. Search the complete catalog so a movie can be found even if it is not available on a selected service. Distinguish “On your services,” “Not on your selected services,” and “Availability not confirmed” using the actual available evidence. Do not report unknown or failed availability checks as definitely unavailable.
4. Show only subscription streaming offers as subscription matches. Rental/purchase listings must not be presented as included with a subscription.
5. Reuse one persisted streaming-service preference state for search and recommendations. Changing services in either place updates the other immediately. Reuse the app's service identifiers, including Peacock's existing code.
6. If no services are selected, ask the visitor to select services before claiming a match. A title search can still show catalog matches.
7. An empty query has a helpful search prompt. A query with no catalog match should explain that it is absent from the catalog, without claiming that it is not streaming anywhere.
8. Opening a result should use the existing movie-detail experience, showing its streaming homes and the compact save/taste controls. Preserve existing provider links if available.
9. Support keyboard use, Escape to close, mobile touch, accessible input labels, visible focus, and understandable empty/error states. Do not let the results cover or disable unrelated navigation.

Use the existing enrichment and refresh pipeline where practical. Do not expose API secrets in browser bundles. If a genuinely necessary API credential is missing, finish the UI and integration code, document the exact required secret, and use an honest unavailable state instead of fabricated availability.

## Automatic monthly hero selection

Implement the monthly change as part of the existing data/build refresh workflow. Extend the existing scheduled catalog workflow where possible; a static GitHub Pages site should not require a newly hosted backend just for this feature.

- Maintain a small hero-selection manifest containing the calendar month, selection timestamp, region, rating source, and the three selected movies' stable IDs, titles, years, backdrop paths, rating/vote evidence, and streaming-service evidence.
- On the first successful refresh in a new calendar month, choose three distinct, highly rated movies currently available through at least one supported subscription service in the US. Use America/Chicago consistently for deciding the calendar month.
- Use one comparable rating source for all candidates, preferably the existing TMDB audience rating plus vote count. Do not mix Rotten Tomatoes percentages and TMDB scores into one ranking.
- As the initial selection rule, require a verified backdrop, a rating of at least 7.5/10, and at least 500 audience votes. Rank eligible titles by rating, then vote count, with a stable-ID tie break. Use actual source values; do not fabricate votes when missing.
- Exclude the previous month's hero IDs when enough eligible alternatives exist, so the monthly update actually rotates the selection. If fewer than three qualify, relax the repeat restriction before weakening quality thresholds. If the source fails or still cannot supply three appropriate films, keep the last valid set rather than publishing an incomplete or fabricated selection.
- Keep a selected set stable for the month. Do not recompute it on every visitor's page load or whenever someone changes their services. Search and recommendations remain personalized to selected services; the hero is a shared monthly feature.
- Revalidate streaming availability through the regular catalog refresh. If a selected movie leaves all supported services, replace only that invalid slot with the next eligible candidate and retain the other two.
- Use high-quality real film stills, responsive sizes, deliberate crops, and the approved overlapping masks. Optimize loading and include sensible image-failure fallbacks. Keep appropriate source attribution where required by the image/data provider.
- Use the supplied three shots as the initial visual reference/fallback while wiring up the automated selection. Production selection must come from current data.

## Miniature save and taste controls

Under each movie recommendation, put a compact row containing exactly:

**star · thumbs up · thumbs down**

Apply the same control component to primary recommendations, secondary recommendation cards, and other movie cards/details where these actions appear, including search results. The icons must remain visually miniature, aligned, and the same size.

### Appearance and accessibility

- All three glyphs are **16 × 16 pixels**, with matching stroke weight, equal container sizing, and consistent spacing. Do not make one larger or more prominent.
- Use restrained styling that fits the cream/red/gold interface. A saved star can fill with muted gold. A selected thumb can receive a subtle tint or fill. Avoid large circles, text-button bars, bright neon states, or a new visual style.
- Keep the row beneath the movie content and always discoverable. Do not make it hover-only.
- Each glyph lives in a real button with accessible names such as “Save [title],” “Like [title],” and “Dislike [title],” and correct pressed states. Preserve small visible glyphs while providing non-overlapping touch targets around 44 pixels on touch devices.
- Use quiet state transitions and an accessible confirmation of the action. Keep the existing restrained gamification and theater reveal; do not introduce points, badges, or oversized celebrations.

### Behavior and persistence

- Star toggles saving to **Your shelf**. Clicking it again removes the saved entry. Saving must NOT automatically like a film or mark it watched.
- Thumbs up records positive taste feedback. Thumbs down records negative taste feedback. They are mutually exclusive for one movie. Selecting the active thumb again clears that feedback; selecting the other replaces it.
- Persist saves, reactions, and streaming-service choices using the app's current storage approach. Retain them after refresh and across visits in the same browser. If the existing app is browser-local, preserve that model and do not add an account/sign-in requirement.
- Store by stable movie ID, and migrate legacy records safely so existing shelf/history/taste data survives. Do not duplicate a movie because search and recommendations use slightly different titles.
- Synchronize state across every visible instance of a film, including search, recommendations, details, and Your shelf.
- Reuse existing watched/history behavior. A save is not a watched signal. Taste reactions should feed personalization; any existing explicit watched action remains available.

### Personalization

- Extend the existing recommendation engine rather than replacing it. The algorithm should learn from accumulated positive and negative reactions using available genres, tone/mood tags, and other supported movie attributes.
- Make reactions materially affect future rankings: favor films similar to liked titles and reduce titles similar to disliked ones. Avoid recommending an explicitly disliked title again by default while its dislike remains active.
- Weight explicit thumbs more strongly than saving. A star is primarily a bookmark, not proof of enjoyment. Clearing/changing a reaction must remove/change its prior influence.
- Preserve hard constraints such as selected services, audience suitability, runtime, genres, and ratings. Personalization must never silently violate those choices.
- Keep discovery varied and maintain a useful cold-start experience. Do not collapse picks into one genre after a single thumbs up.
- Reuse existing history to avoid immediately recommending watched titles where that is already the app's behavior. Preserve intentional comfort/rewatch behavior.

## Verification and completion

Use targeted checks appropriate to the repository, then inspect the actual interface at desktop, tablet, and narrow mobile widths. Verify:

- The three real film shots blend gradually with no hard joins or empty hero bands.
- Only Main Feature and Find your movie appear in the hero; the marquee bulbs still animate and stop with reduced motion.
- The questionnaire opens and the existing recommendation flow still produces real picks.
- Search finds exact/partial titles, handles duplicate names and missing titles, and responds correctly when selected services change.
- Unknown availability is not misreported; rental offers are not labeled subscription matches.
- The monthly selector is stable within a month, rotates at a simulated month boundary, and keeps a valid fallback when the data source fails.
- All three mini icons have identical dimensions; saves and mutually exclusive reactions persist and synchronize across views.
- Controlled like/dislike examples change recommendations in the intended direction without overriding hard filters.
- Existing shelf/history data is preserved; there are no console errors, clipped controls, broken images, or GitHub Pages base-path failures.
- The popcorn favicon loads in an actual browser tab and saved bookmarks.

Finish with a concise report of what changed, what you checked, and any concrete credential/setup requirement. Leave the implementation ready for review. Do not publish or push unless separately authorized.
