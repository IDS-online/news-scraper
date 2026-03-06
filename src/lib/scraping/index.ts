/**
 * Scraping engines for Newsgrap3r.
 *
 * Usage (by NEWS-5 Scheduler):
 *   import { scrapeRssFeed } from '@/lib/scraping'
 *   const result = await scrapeRssFeed(source)
 */
export { scrapeRssFeed } from './rss-engine'
export type { NormalizedArticle, ScrapeResult, ScrapeError } from '@/types/article'
