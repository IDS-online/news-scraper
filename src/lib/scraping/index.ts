/**
 * Scraping engines for Newsgrap3r.
 *
 * Usage (by NEWS-5 Scheduler):
 *   import { scrapeRssFeed, scrapeHtmlPage } from '@/lib/scraping'
 *   const result = await scrapeRssFeed(source)   // for RSS/Atom sources
 *   const result = await scrapeHtmlPage(source)   // for HTML sources
 */
export { scrapeRssFeed } from './rss-engine'
export { scrapeHtmlPage } from './html-engine'
export type { NormalizedArticle, ScrapeResult, ScrapeError } from '@/types/article'
