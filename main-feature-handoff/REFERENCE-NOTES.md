# Reference package

This package follows the last approved Main Feature preview from October 4, 2026.

## Files

- `PROMPT.md`: complete Claude Code implementation brief.
- `approved-preview.html`: standalone reference that can be opened in a browser.
- `approved-fragment.html`: original editable inline source.
- `assets/`: decoded copies of the exact original film stills in that reference; these are not AI-generated images.

## Asset mapping

| File | Use |
| --- | --- |
| `hero-left-comedy.jpg` | Left hero film shot, also the comedy mood shot |
| `hero-center-mystery.jpg` | Center hero film shot, also the mystery mood shot |
| `hero-right-scifi.jpg` | Right hero film shot |
| `mood-comedy.jpg` | Make me laugh |
| `mood-mystery.jpg` | Keep me guessing |
| `mood-action.jpg` | I want a banger |
| `mood-horror.jpg` | I want to scream |
| `mood-beautiful.jpg` | Something beautiful |
| `mood-comfort.jpg` | Comfort movie |
| `mood-weird.jpg` | Get weird |

The preview embeds image bytes, so the imagery remains visible without referencing a ChatGPT path. The separate JPEGs make reuse easier. Production should request responsive, higher-resolution versions through the existing movie-image source when needed, especially for the full-width hero.

## What is approved

Three blended film shots, a centered animated marquee reading only Main Feature, a soft Find your movie button, the popcorn-bucket tab-icon direction, header search, and the existing image-based questionnaire. There is no standalone hero headline or hero subcopy. Footer: Real Movies, Real Recommendations.

The font families in the preview are loaded from Google Fonts; viewing those exact fonts requires an internet connection. The preview uses a popcorn emoji to communicate the icon idea. The production brief calls for consistent favicon artwork.

## Prototype limits

This is a design reference, not a replacement for the working application. The questionnaire reveal, filter button states, and streaming-service search examples work locally. The generate-pick button updates a demo summary rather than running the production recommendation engine. Navigation labels are presentation-only. Search uses an October 4, 2026 catalog snapshot and must be wired to fresh application data in production.

Monthly hero selection, miniature star/thumbs controls, and cumulative personalization are implementation requirements described in PROMPT.md; they are not already implemented in this preview.

The standalone reference uses native text symbols for the two small search-header utility icons so it can be opened without ChatGPT's icon runtime. Use the repository's actual icon component/library in production.
