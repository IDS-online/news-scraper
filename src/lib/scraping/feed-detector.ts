import * as cheerio from 'cheerio'
import Parser from 'rss-parser'

export interface DetectedFeed {
  url: string
  title: string
  type: 'rss' | 'atom'
  item_count: number
  /** true if the feed requires authentication (401/403 response) */
  requires_auth: boolean
}

const COMMON_FEED_PATHS = [
  '/feed',
  '/feed.xml',
  '/rss',
  '/rss.xml',
  '/atom.xml',
  '/feeds/posts/default',
  '/blog/feed',
  '/blog/rss',
  '/news/feed',
  '/news/rss',
  '/index.xml',
]

const FEED_MIME_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/feed+json',
  'application/xml',
  'text/xml',
]

const parser = new Parser({ timeout: 5000 })

/**
 * Normalize a user-entered URL: prepend https:// if no scheme present.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

/**
 * Attempt to parse a URL as an RSS/Atom feed.
 * Returns the feed metadata on success, or null if invalid/inaccessible.
 */
async function tryParseFeed(
  url: string,
  signal: AbortSignal
): Promise<DetectedFeed | null> {
  try {
    // Check for auth requirement first via a HEAD request
    const headRes = await fetch(url, { method: 'HEAD', signal, redirect: 'follow' })

    if (headRes.status === 401 || headRes.status === 403) {
      return {
        url,
        title: url,
        type: 'rss',
        item_count: 0,
        requires_auth: true,
      }
    }

    if (!headRes.ok) return null

    const feed = await parser.parseURL(url)
    if (!feed.items || feed.items.length === 0) return null

    const isAtom = url.includes('atom') || (feed as unknown as { feedUrl?: string }).feedUrl?.includes('atom') === true
    return {
      url,
      title: feed.title ?? url,
      type: isAtom ? 'atom' : 'rss',
      item_count: feed.items.length,
      requires_auth: false,
    }
  } catch {
    return null
  }
}

/**
 * Extract feed URLs from HTML <link> tags.
 */
function extractLinkTagFeeds(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html)
  const urls: string[] = []

  $('link[type]').each((_, el) => {
    const type = $(el).attr('type') ?? ''
    const href = $(el).attr('href') ?? ''
    if (FEED_MIME_TYPES.some((m) => type.includes(m)) && href) {
      try {
        urls.push(new URL(href, baseUrl).toString())
      } catch {
        // ignore invalid URLs
      }
    }
  })

  return urls
}

/**
 * Check /robots.txt for Sitemap directives, then check /sitemap.xml as fallback.
 * Returns up to 50 potential feed-like URLs from the sitemap.
 */
async function discoverFromSitemap(
  origin: string,
  signal: AbortSignal
): Promise<string[]> {
  const feedUrls: string[] = []

  // Step 1: check robots.txt for Sitemap: directives
  let sitemapUrls: string[] = []
  try {
    const robotsRes = await fetch(`${origin}/robots.txt`, { signal })
    if (robotsRes.ok) {
      const text = await robotsRes.text()
      const matches = [...text.matchAll(/^Sitemap:\s*(.+)$/gim)]
      sitemapUrls = matches.map((m) => m[1].trim())
    }
  } catch {
    // ignore
  }

  // Fallback: try /sitemap.xml directly
  if (sitemapUrls.length === 0) {
    sitemapUrls = [`${origin}/sitemap.xml`]
  }

  // Step 2: fetch each sitemap and look for feed-like URLs
  for (const sitemapUrl of sitemapUrls.slice(0, 3)) {
    try {
      const res = await fetch(sitemapUrl, { signal })
      if (!res.ok) continue

      const xml = await res.text()
      const $ = cheerio.load(xml, { xmlMode: true })

      $('loc').each((_, el) => {
        const loc = $(el).text().trim()
        if (
          loc &&
          COMMON_FEED_PATHS.some((p) => loc.includes(p)) ||
          /\/(feed|rss|atom)(\.xml)?$/i.test(loc)
        ) {
          feedUrls.push(loc)
        }
      })

      if (feedUrls.length >= 50) break
    } catch {
      // ignore
    }
  }

  return feedUrls.slice(0, 50)
}

/**
 * Main entry point: detect all valid RSS/Atom feeds for a given URL.
 * Uses a 10-second overall timeout.
 */
export async function detectFeeds(rawUrl: string): Promise<DetectedFeed[]> {
  const url = normalizeUrl(rawUrl)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)

  try {
    const origin = new URL(url).origin
    const candidateUrls = new Set<string>()

    // 1. Check if the URL itself is a feed
    const selfFeed = await tryParseFeed(url, controller.signal)
    if (selfFeed) {
      return [selfFeed]
    }

    // 2. Fetch the page HTML and extract <link> tags
    let pageHtml = ''
    try {
      const pageRes = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Newsgrap3r/1.0 Feed Detector' },
      })
      if (pageRes.ok) {
        pageHtml = await pageRes.text()
      }
    } catch {
      // ignore — fall through to pattern/sitemap detection
    }

    const linkTagUrls = extractLinkTagFeeds(pageHtml, url)
    linkTagUrls.forEach((u) => candidateUrls.add(u))

    // 3. Probe common URL patterns
    for (const path of COMMON_FEED_PATHS) {
      candidateUrls.add(`${origin}${path}`)
    }

    // 4. Discover from sitemap / robots.txt
    const sitemapUrls = await discoverFromSitemap(origin, controller.signal)
    sitemapUrls.forEach((u) => candidateUrls.add(u))

    // 5. Validate all candidates in parallel (skip the original URL, already checked)
    const candidates = [...candidateUrls].filter((u) => u !== url)
    const results = await Promise.all(
      candidates.map((candidateUrl) => tryParseFeed(candidateUrl, controller.signal))
    )

    // 6. Collect and deduplicate confirmed feeds (valid + auth-flagged)
    const seen = new Set<string>()
    const feeds: DetectedFeed[] = []

    for (const feed of results) {
      if (feed && !seen.has(feed.url)) {
        seen.add(feed.url)
        feeds.push(feed)
      }
    }

    // Sort: valid feeds first (requires_auth=false), then auth-required
    feeds.sort((a, b) => Number(a.requires_auth) - Number(b.requires_auth))

    return feeds
  } finally {
    clearTimeout(timeoutId)
  }
}
