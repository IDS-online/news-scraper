/**
 * NEWS-20: one shared rule for "is this value a usable image address?".
 *
 * The scraper (src/lib/scraping/html-engine.ts) and the Bubble mapping
 * (src/lib/bubble/mapping.ts) both apply it, so the two cannot drift apart:
 * the scraper must not *create* a placeholder value, and the sync must not
 * *send* one that was stored before this fix.
 *
 * Background: lazy-loading sources such as ZM-online ship
 * `<img src="data:," data-src="https://real-url...">`. The `src` attribute is
 * present but holds a placeholder, and Bubble's "Picture" field rejects the
 * whole record over it.
 */

/** Matches a leading URI scheme, e.g. `https:`, `data:`, `javascript:`. */
const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i

/**
 * Tab, LF and CR — the characters the WHATWG URL parser removes from anywhere
 * inside a URL before parsing it.
 */
const URL_STRIPPED_WHITESPACE = /[\t\n\r]/g

/**
 * Leading and trailing C0 controls (U+0000–U+001F) and spaces — the characters
 * the WHATWG URL parser strips from the ends of a URL before parsing it.
 *
 * `String.prototype.trim()` is not a substitute: it removes Unicode whitespace
 * but leaves the non-whitespace C0 controls (NUL, SOH, … US) untouched.
 */
const URL_STRIPPED_ENDS = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g

/**
 * Bring a raw attribute value into the form the URL parser will actually see
 * (NEWS-20 BUG-6, BUG-7).
 *
 * Two removals, in the order the URL spec applies them:
 *
 * 1. Strip leading/trailing C0 controls and spaces. Without this,
 *    `\u0001javascript:alert(1)` slips past the scheme allowlist — the control
 *    character makes SCHEME_PATTERN miss, so the value looks scheme-less — and
 *    `new URL()` then normalises it back to `javascript:alert(1)` (BUG-7).
 * 2. Remove tab, LF and CR from *anywhere* in the value, for the same reason:
 *    `java\nscript:alert(1)` would otherwise be accepted and normalised back
 *    into a rejected scheme (BUG-6).
 *
 * A final `trim()` handles the Unicode whitespace the URL parser does not strip
 * (U+00A0, U+2028, …). Rejecting slightly more than the parser does is the safe
 * direction: the worst case is an image we decline to use.
 */
export function normalizeImageUrl(value: string): string {
  return value
    .replace(URL_STRIPPED_ENDS, '')
    .replace(URL_STRIPPED_WHITESPACE, '')
    .replace(URL_STRIPPED_ENDS, '')
    .trim()
}

/**
 * True when the value can be used as an image address.
 *
 * This is an allowlist, not a `data:` blacklist (NEWS-20 BUG-2): a value that
 * carries a URI scheme is only accepted for `http:` and `https:`. Everything
 * else — `data:`, `javascript:`, `about:`, `blob:` — is rejected, because
 * Bubble's "Picture" field cannot fetch it and refuses the whole record.
 *
 * Scheme-less values (`/media/a.jpg`, `//cdn/a.jpg`, `a.jpg`) are accepted:
 * resolving them against the page URL is the caller's job.
 *
 * The value is normalised first (NEWS-20 BUG-6/BUG-7) so whitespace or control
 * characters hidden in or before the scheme cannot smuggle a rejected scheme
 * past the match.
 */
export function isUsableImageUrl(value: string | null | undefined): value is string {
  if (!value) return false
  const normalized = normalizeImageUrl(value)
  if (normalized.length === 0) return false

  const scheme = SCHEME_PATTERN.exec(normalized)
  if (!scheme) return true

  const protocol = scheme[1].toLowerCase()
  return protocol === 'http' || protocol === 'https'
}

/**
 * Split a `srcset` value into its candidate URLs, in source order.
 *
 * Follows the HTML parsing rule rather than a naive comma split (NEWS-20
 * BUG-1): a candidate URL is a run of non-whitespace characters, so commas
 * *inside* a URL — routine in CDN paths such as Cloudinary's `/w_300,h_200/` —
 * are preserved. Only trailing commas terminate a candidate.
 */
export function srcsetUrls(srcset: string | null | undefined): string[] {
  if (!srcset) return []

  const urls: string[] = []
  let index = 0

  while (index < srcset.length) {
    // 1. Skip the separators between candidates.
    while (index < srcset.length && /[\s,]/.test(srcset[index])) index += 1
    if (index >= srcset.length) break

    // 2. The URL is the run of non-whitespace characters.
    const start = index
    while (index < srcset.length && !/\s/.test(srcset[index])) index += 1
    const token = srcset.slice(start, index)

    // 3. Trailing commas belong to the separator, not to the URL.
    const url = token.replace(/,+$/, '')
    if (url.length > 0) urls.push(url)

    // 4. A token that ended in a comma has no descriptor; otherwise skip one.
    if (!token.endsWith(',')) {
      while (index < srcset.length && srcset[index] !== ',') index += 1
    }
  }

  return urls
}

/**
 * Take the first URL out of a `srcset` value.
 *
 * Deliberately the *first* candidate, not the highest resolution: picking the
 * best image is quality work and out of scope for this bugfix.
 */
export function firstSrcsetUrl(srcset: string | null | undefined): string | null {
  return srcsetUrls(srcset)[0] ?? null
}

/**
 * Pick the image address from the candidate attributes, in order of precedence:
 * `src`, `data-src`, `data-lazy-src`, then `srcset` as the last resort.
 *
 * Within `srcset` every candidate is tried in source order (NEWS-20 BUG-4), so
 * a placeholder in the first slot no longer hides a real image behind it.
 *
 * Returns null when none of them yields a usable value — "no image" is a valid
 * outcome: the article is still scraped, stored and synced, just without a
 * picture, which beats having the whole record rejected.
 */
export function pickImageUrl(attrs: {
  src?: string | null
  dataSrc?: string | null
  dataLazySrc?: string | null
  srcset?: string | null
}): string | null {
  const candidates = [
    attrs.src,
    attrs.dataSrc,
    attrs.dataLazySrc,
    ...srcsetUrls(attrs.srcset),
  ]

  for (const candidate of candidates) {
    if (isUsableImageUrl(candidate)) return normalizeImageUrl(candidate)
  }

  return null
}
