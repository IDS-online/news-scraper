# NEWS-22: Source Creation — Show How (or Whether) an Image Was Found

## Status: Planned
**Created:** 2026-09-28
**Last Updated:** 2026-09-28 (review round 3: RSS preview is in scope, form dialog as well
as wizard, maxDuration on the preview route)

## Dependencies
- Requires NEWS-21 (Generic Image Fallback) — this ticket surfaces that fallback's outcome; it
  has nothing to show without it.
- Builds on NEWS-18 (Visual Source Setup Wizard) and NEWS-17 (HTML Source Scraping Preview) —
  the existing preview step is where this diagnostic is added for HTML sources.
- **Scope correction (review round 3): an RSS article preview does not exist yet and is part of
  this ticket.** `POST /api/sources/preview` validates HTML selectors via its Zod schema and calls
  only `scrapeHtmlPreview()`; `scrapeRssFeed()` is never invoked outside the scheduler. RSS
  sources today get feed auto-detection (NEWS-14) and no article preview at all. Scoping this
  ticket to HTML would mean the diagnostic cannot see the two sources that caused NEWS-21 in the
  first place — both are RSS — which would deliver *false confidence*, a worse outcome than no
  diagnostic. A minimal RSS preview (first N items with title, link and the image outcome) is
  therefore in scope.
- **Both creation paths, not just the wizard.** Sources can be created through
  `src/components/dashboard/sources/source-form-dialog.tsx` as well as through the visual wizard
  (`wizard/`). A diagnostic that only exists in the wizard misses the operator who uses the plain
  form, so the ticket title says "Source Creation", not "Source Wizard".

## Background

Today, a source with no usable image extraction path (missing `selector_image`, a selector that
doesn't match, or — after NEWS-21 — no `og:image`/`twitter:image` either) is only discovered
weeks later, when its articles show up without pictures in Bubble. The wizard's existing preview
step (NEWS-17) already fetches and shows sample articles at source-creation time; this ticket adds
one more signal to that preview: did we get an image, and where did it come from.

## User Stories
- As an operator adding a new source, I want to see whether the previewed sample articles have
  images, so that I catch a missing/broken image selector before the source goes live instead of
  after Bubble sync fails weeks later.
- As an operator, I want to know *which* mechanism found the image (selector/RSS field vs. the
  og:image/twitter:image page fallback), so that I can tell "this works because I configured it
  correctly" apart from "this works only by luck of the fallback."
- As an operator, when no image was found at all for a previewed article, I want that called out
  clearly, so that I can decide whether to adjust `selector_image` or accept the source will run
  without images.

## Acceptance Criteria
- [ ] The source wizard's preview step (existing NEWS-17/18 preview UI) shows, per previewed
      article, one of three states: image found via source selector/RSS field, image found via
      page fallback (og:image/twitter:image), or no image found.
- [ ] The three states are visually distinct (e.g. badge/label), not just present in a tooltip —
      the goal is that a missing/fallback-only image is noticeable at a glance across the preview
      list, not something the operator has to hunt for.
- [ ] When at least one previewed article has no image at all, a summary note above the preview
      list flags it (e.g. "2 of 5 preview articles have no image") so it isn't missed in a longer
      list.
- [ ] The preview thumbnail itself (if NEWS-17 already renders one) is shown regardless of which
      state produced it — this ticket adds the "how"/"whether" label, it doesn't change what's
      rendered as the image.
- [ ] Uses shadcn/ui primitives for the state indicator (`Badge`/`Tooltip` per the project's
      frontend rules) — no custom badge component.
- [ ] No change to what gets saved on the source record — this is preview-only information, not
      a new column or config field.

## Edge Cases
- **Fallback fetch is still in flight when the operator views the preview**: the preview step
  already waits for the scrape-preview call to resolve before rendering (per NEWS-17); the image
  state is part of that same response, not a separate async load — no new loading state needed
  beyond what NEWS-17 already has.
- **All previewed articles have images via selector/RSS field (the common case)**: no summary
  note shown — the callout in AC3 only appears when there's something to flag, so a healthy
  source's preview looks exactly as clean as it does today.
- **Preview limit is small (NEWS-17 previews a handful of articles)**: the diagnostic reflects
  only the previewed sample, not the full feed/page — label it as such if there's any risk of
  the operator reading "0 of 3 missing" as a guarantee for all future articles from that source.

## Technical Requirements (optional)
- **`maxDuration` on the preview route.** `src/app/api/sources/preview/route.ts` declares none
  today, so it runs on the platform default. With NEWS-21's fallback added, a preview may now
  perform up to N extra page fetches (5s timeout each) on top of the page fetch it already does.
  Set an explicit `maxDuration` and bound the number of fallback fetches the preview performs
  (the previewed sample is small, so a fixed small cap is enough) — a preview that times out in
  the operator's face is a worse failure than a preview without image diagnostics.
- The preview reuses NEWS-21's shared fallback helper directly. It must **not** be "fixed" by
  moving the fallback back into the engines — that is exactly the defect review correction 2a of
  NEWS-21 removed (≈1,900 requests/day), and reintroducing it here would reintroduce it globally.
- No new API route: extend the existing preview response (`scrapeHtmlPreview`/RSS preview
  equivalent) with an `image_source: 'selector' | 'fallback' | 'none'` field per article, backed
  by NEWS-21's fallback helper.
- **The preview path does not go through the scheduler.** NEWS-21 hooks the fallback into
  `scrapeSource()` (post-deduplication), which `scrapeHtmlPreview()` never calls — so the
  preview must invoke NEWS-21's shared helper *directly* for its sample articles. This is the
  one place where the helper is called outside the scheduler, and it is safe to do so: a preview
  is operator-initiated, one-off, and limited to a handful of articles, so neither the run-wide
  time budget nor the "only for newly inserted articles" rule applies. Do not work around this
  by moving the fallback back into the engines — see NEWS-21 review correction 2a for why that
  placement was rejected.

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
