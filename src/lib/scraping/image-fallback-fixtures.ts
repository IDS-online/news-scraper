/**
 * NEWS-21 test fixtures: recorded from the real sources on 2026-09-28, then
 * trimmed to the parts the fallback actually reads.
 *
 * Trimmed, not invented: every URL, meta tag, title, `pubDate` and charset
 * declaration below is the value the live site served. The bodies, navigation,
 * scripts and the remaining ~200 head tags are cut, because a byte-exact copy of
 * six pages would bury the one line each test is about.
 *
 * Nothing here is ever fetched live. The tests mock `fetch` (and `rss-parser`'s
 * `parseURL`) and serve these strings, so the suite cannot break because a
 * third-party site was redesigned or was briefly down.
 *
 * What the recording confirmed, i.e. why this feature exists:
 *  - `mgb-dental.de/feed/`: 0 occurrences of `media:content`, `media:thumbnail`
 *    or `<enclosure>`. There IS an `<img>` in `content:encoded` — but it is the
 *    site logo, which is exactly why "first `<img>` in the content" was rejected
 *    as a strategy.
 *  - `de.dental-tribune.com/news/feed/`: 0 media tags AND no `<img>` in the
 *    content at all. Nothing usable is in that feed, full stop.
 *  - Both article pages carry `og:image` with `property=`.
 *  - `dentalmarketing-magazin.de`: no `og:image`, no `twitter:image`, and it
 *    declares `charset=iso-8859-1` — which is why the fallback shares the HTML
 *    engine's charset detection instead of assuming UTF-8.
 */

// ---- mgb-dental (RSS, no media tags, article page has og:image) ----

export const MGB_FEED_URL = 'https://mgb-dental.de/feed/'

export const MGB_ARTICLE_URL =
  'https://mgb-dental.de/news/zahnmedizin/makroglossie-ursachen-diagnose-therapie'

export const MGB_SECOND_ARTICLE_URL =
  'https://mgb-dental.de/news/zahnmedizin/therapie-jahrelanger-dentinueberempfindlichkeiten'

/** The real `og:image` of MGB_ARTICLE_URL. */
export const MGB_EXPECTED_IMAGE =
  'https://mgb-dental.de/wp-content/uploads/2026/09/dzw_2026_15_AdobeStock_128262178.jpg'

export const MGB_SECOND_EXPECTED_IMAGE =
  'https://mgb-dental.de/wp-content/uploads/2026/09/dzw_2026_15_cp-gaba_moser-fallbericht_01.jpg'

/**
 * Two items, exactly as the feed ships them: no `media:*`, no `<enclosure>`, and
 * a `content:encoded` whose only `<img>` is the logo.
 */
export const MGB_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>MGB Dental</title>
  <link>https://mgb-dental.de/</link>
  <description>Nachrichten aus der Zahnmedizin</description>
  <language>de-DE</language>
  <item>
    <title>Makroglossie: Ursachen, Diagnose, Therapie</title>
    <link>${MGB_ARTICLE_URL}</link>
    <pubDate>Mon, 28 Sep 2026 05:33:00 +0000</pubDate>
    <dc:creator>Redaktion</dc:creator>
    <description><![CDATA[Eine vergroesserte Zunge hat viele Ursachen.]]></description>
    <content:encoded><![CDATA[<p><img src="https://mgb-dental.de/wp-content/uploads/2024/01/mgb-logo.png" alt="Logo" /></p><p>Eine vergroesserte Zunge hat viele Ursachen.</p>]]></content:encoded>
  </item>
  <item>
    <title>Therapie jahrelanger Dentinueberempfindlichkeiten</title>
    <link>${MGB_SECOND_ARTICLE_URL}</link>
    <pubDate>Sun, 27 Sep 2026 08:36:43 +0000</pubDate>
    <dc:creator>Redaktion</dc:creator>
    <description><![CDATA[Ein Fallbericht ueber hartnaeckige Hypersensibilitaeten.]]></description>
    <content:encoded><![CDATA[<p><img src="https://mgb-dental.de/wp-content/uploads/2024/01/mgb-logo.png" alt="Logo" /></p><p>Ein Fallbericht.</p>]]></content:encoded>
  </item>
</channel>
</rss>`

export const MGB_ARTICLE_HTML = `<!DOCTYPE html>
<html lang="de-DE">
<head>
  <meta charset="UTF-8">
  <title>Makroglossie: Ursachen, Diagnose, Therapie - MGB Dental</title>
  <meta property="og:locale" content="de_DE" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="Makroglossie: Ursachen, Diagnose, Therapie" />
  <meta property="og:url" content="${MGB_ARTICLE_URL}" />
  <meta property="og:image" content="${MGB_EXPECTED_IMAGE}" />
  <meta property="og:image:width" content="2560" />
  <meta property="og:image:height" content="1440" />
  <meta property="og:image:type" content="image/jpeg" />
</head>
<body><article><h1>Makroglossie</h1></article></body>
</html>`

export const MGB_SECOND_ARTICLE_HTML = MGB_ARTICLE_HTML.replace(
  MGB_EXPECTED_IMAGE,
  MGB_SECOND_EXPECTED_IMAGE
)

// ---- dental-tribune (RSS, nothing usable in the feed at all) ----

export const DT_FEED_URL = 'https://de.dental-tribune.com/news/feed/'

export const DT_ARTICLE_URL =
  'https://de.dental-tribune.com/news/deutscher-millerpreis-2026-fur-innovative-forschung-zum-kiefergelenk-verliehen/'

/** The real `og:image` of DT_ARTICLE_URL (a CDN URL with a base64-ish path segment). */
export const DT_EXPECTED_IMAGE =
  'https://cdn.dental-tribune.com/dti/0001/130d869e/cmVzaXplLWNyb3Aodz0xMjAwO2g9NjI3KTpzaGFycGVuKGxldmVsPTApOm91dHB1dChmb3JtYXQ9anBlZyk/up/dt/2026/09/millerpreis-2026_dgzmk.jpg'

export const DT_FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Dental Tribune Deutschland</title>
  <link>https://de.dental-tribune.com</link>
  <description>Neuigkeiten</description>
  <language>de-DE</language>
  <item>
    <title>Deutscher Millerpreis 2026 fuer innovative Forschung zum Kiefergelenk verliehen</title>
    <link>${DT_ARTICLE_URL}</link>
    <pubDate>Fri, 25 Sep 2026 06:08:16 +0000</pubDate>
    <description><![CDATA[Die DGZMK hat den Millerpreis verliehen.]]></description>
  </item>
</channel>
</rss>`

export const DT_ARTICLE_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Deutscher Millerpreis 2026 verliehen</title>
  <meta property="og:url" content="${DT_ARTICLE_URL}?time=1790323700">
  <meta property="og:image" content="${DT_EXPECTED_IMAGE}">
</head>
<body><article><h1>Millerpreis</h1></article></body>
</html>`

// ---- dentalmarketing-magazin style: no meta image at all ----

export const NO_META_ARTICLE_URL = 'https://www.dentalmarketing-magazin.de/artikel.php?id=42'

/**
 * Modeled on the recorded head of dentalmarketing-magazin.de: an older PHP site
 * with no Open Graph and no Twitter Card, declaring ISO-8859-1.
 *
 * The expected outcome is `image_url: null` and NO error — today's behaviour for
 * a source without a usable image, not a new failure mode.
 */
export const NO_META_ARTICLE_HTML = `<!DOCTYPE html>
<html lang="de-DE">
<head>
<meta http-equiv="content-Type" content="text/html; charset=iso-8859-1" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dentalmarketing Magazin</title>
</head>
<body><div id="content"><h1>Ueberschrift</h1></div></body>
</html>`

// ---- HTML-engine path: listing page without a usable image element ----

export const HTML_LISTING_URL = 'https://beispiel-dental.de/aktuelles/'

export const HTML_LISTING_ARTICLE_URL = 'https://beispiel-dental.de/aktuelles/neue-praxis'

/**
 * Resolved against the ARTICLE URL (`/aktuelles/neue-praxis`), so the
 * path-relative meta value lands in `/aktuelles/`. Resolved against the origin —
 * the way `html-engine.ts:224` does it — it would wrongly become
 * `https://beispiel-dental.de/media/neue-praxis-teaser.jpg`.
 */
export const HTML_LISTING_EXPECTED_IMAGE =
  'https://beispiel-dental.de/aktuelles/media/neue-praxis-teaser.jpg'

/**
 * A listing page of the kind most new sources are: titles and links in the
 * markup, no image anywhere in the teaser. `selector_image` has nothing to match,
 * so the HTML engine leaves `image_url: null` — and the fallback has to earn the
 * "engine-agnostic" claim on this path too, not just on the RSS one.
 */
export const HTML_LISTING_HTML = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><title>Aktuelles</title></head>
<body>
  <main>
    <article class="teaser">
      <h2 class="teaser__title">Neue Praxis in Muenster eroeffnet</h2>
      <a class="teaser__link" href="/aktuelles/neue-praxis">weiterlesen</a>
      <p class="teaser__text">Die Praxis setzt auf digitale Abdruecke.</p>
    </article>
  </main>
</body>
</html>`

/**
 * The article page behind the listing. Its `og:image` is a PATH-relative value on
 * purpose, so the end-to-end test also pins resolution against the article URL:
 * only that base yields `/aktuelles/media/...`.
 */
export const HTML_LISTING_ARTICLE_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>Neue Praxis in Muenster eroeffnet</title>
  <meta property="og:image" content="media/neue-praxis-teaser.jpg">
</head>
<body><article><h1>Neue Praxis</h1></article></body>
</html>`
