import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import * as cheerio from 'cheerio'
import dns from 'node:dns/promises'

const proxyFetchSchema = z.object({
  url: z.string().url('Bitte eine gueltige URL eingeben'),
})

// Simple in-memory rate limiter (best-effort in serverless — resets per instance)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true
  const lower = ip.toLowerCase()
  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7))
  // IPv6 unique local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd]/i.test(lower) || /^fe[89ab]/i.test(lower)) return true
  // Parse IPv4
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return false
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/**
 * The element-picker script injected into the proxied HTML.
 * Runs inside the sandboxed iframe — adds hover highlights, captures clicks,
 * generates minimal CSS selectors, and sends them to the parent via postMessage.
 */
function getPickerScript(): string {
  return `
<style>
  .__picker-highlight {
    outline: 3px solid #3b82f6 !important;
    outline-offset: -1px;
    cursor: crosshair !important;
    background-color: rgba(59, 130, 246, 0.08) !important;
  }
  .__picker-selected {
    outline: 3px solid #22c55e !important;
    outline-offset: -1px;
    background-color: rgba(34, 197, 94, 0.08) !important;
  }
  * { cursor: crosshair !important; }
</style>
<script>
(function() {
  var lastHighlighted = null;

  function generateSelector(el) {
    var parts = [];
    var current = el;
    var depth = 0;
    while (current && current !== document.body && current !== document.documentElement && depth < 5) {
      var tag = current.tagName.toLowerCase();

      // Prefer ID
      if (current.id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(current.id)) {
        parts.unshift(tag + '#' + current.id);
        break;
      }

      // Prefer unique class
      var classes = Array.from(current.classList || []).filter(function(c) {
        return c && !c.startsWith('__picker') && /^[a-zA-Z_-]/.test(c);
      });
      if (classes.length > 0) {
        var found = false;
        for (var i = 0; i < classes.length; i++) {
          var sel = tag + '.' + classes[i];
          try {
            if (document.querySelectorAll(sel).length <= 20) {
              parts.unshift(sel);
              found = true;
              break;
            }
          } catch(e) {}
        }
        if (found) {
          current = current.parentElement;
          depth++;
          continue;
        }
      }

      // nth-child fallback
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children);
        var sameTag = siblings.filter(function(s) { return s.tagName === current.tagName; });
        if (sameTag.length > 1) {
          var idx = sameTag.indexOf(current) + 1;
          parts.unshift(tag + ':nth-of-type(' + idx + ')');
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }

      current = current.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  document.addEventListener('mouseover', function(e) {
    if (lastHighlighted && lastHighlighted !== e.target) {
      lastHighlighted.classList.remove('__picker-highlight');
    }
    e.target.classList.add('__picker-highlight');
    lastHighlighted = e.target;
  }, true);

  document.addEventListener('mouseout', function(e) {
    e.target.classList.remove('__picker-highlight');
  }, true);

  document.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    var el = e.target;
    el.classList.remove('__picker-highlight');
    el.classList.add('__picker-selected');

    var selector = generateSelector(el);
    window.parent.postMessage({
      type: 'selector-picked',
      selector: selector,
      tagName: el.tagName.toLowerCase(),
      textContent: (el.textContent || '').trim().substring(0, 120)
    }, '*');
  }, true);

  // Block all link navigations
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
})();
</script>`
}

/**
 * POST /api/sources/proxy-fetch
 * Fetches a URL server-side, strips scripts and security headers,
 * rewrites relative URLs, injects the element-picker script,
 * and returns the modified HTML.
 * Admin only.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin()
  } catch (err: unknown) {
    const authErr = err as { status?: number; error?: string }
    return NextResponse.json(
      { error: authErr.error ?? 'Nicht berechtigt' },
      { status: authErr.status ?? 401 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Ungueltiger JSON-Body' },
      { status: 400 }
    )
  }

  const parsed = proxyFetchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validierungsfehler' },
      { status: 422 }
    )
  }

  const { url } = parsed.data

  // Rate limiting — key by IP (best-effort in serverless)
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Zu viele Anfragen. Bitte eine Minute warten.' },
      { status: 429 }
    )
  }

  // SSRF protection: only allow public routable IPs
  try {
    const parsedUrlForDns = new URL(url)
    if (parsedUrlForDns.protocol !== 'http:' && parsedUrlForDns.protocol !== 'https:') {
      return NextResponse.json(
        { error: 'Nur HTTP- und HTTPS-URLs sind erlaubt.' },
        { status: 422 }
      )
    }
    const { address } = await dns.lookup(parsedUrlForDns.hostname)
    if (isPrivateIp(address)) {
      return NextResponse.json(
        { error: 'Interne oder private URLs sind nicht erlaubt.' },
        { status: 422 }
      )
    }
  } catch {
    return NextResponse.json(
      { error: 'Der Hostname konnte nicht aufgeloest werden. Bitte die URL ueberpruefen.' },
      { status: 422 }
    )
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      redirect: 'follow',
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return NextResponse.json(
        { error: `Die Webseite hat mit HTTP ${response.status} geantwortet.` },
        { status: 502 }
      )
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return NextResponse.json(
        { error: `Die URL liefert keinen HTML-Inhalt (Content-Type: ${contentType}).` },
        { status: 422 }
      )
    }

    const html = await response.text()

    // Parse with cheerio
    const $ = cheerio.load(html)

    // Determine base URL for rewriting relative paths
    const parsedUrl = new URL(url)
    const baseUrl = $('base').attr('href')
      ? new URL($('base').attr('href')!, url).href
      : `${parsedUrl.protocol}//${parsedUrl.host}`

    // Strip all existing <script> tags
    $('script').remove()

    // Strip noscript tags (often contain redirect/fallback content)
    $('noscript').remove()

    // Rewrite relative URLs to absolute
    const rewriteAttr = (selector: string, attr: string) => {
      $(selector).each((_i, el) => {
        const val = $(el).attr(attr)
        if (val && !val.startsWith('data:') && !val.startsWith('javascript:') && !val.startsWith('#')) {
          try {
            const absolute = new URL(val, baseUrl).href
            $(el).attr(attr, absolute)
          } catch {
            // Invalid URL, skip
          }
        }
      })
    }

    rewriteAttr('[src]', 'src')
    rewriteAttr('[href]', 'href')
    rewriteAttr('[action]', 'action')
    rewriteAttr('[srcset]', 'srcset') // simplified — may not handle all srcset formats
    rewriteAttr('source[src]', 'src')

    // Also rewrite CSS url() in inline styles (simplified)
    $('[style]').each((_i, el) => {
      const style = $(el).attr('style')
      if (style && style.includes('url(')) {
        const rewritten = style.replace(/url\(['"]?([^'")\s]+)['"]?\)/g, (_match, p1) => {
          if (p1.startsWith('data:') || p1.startsWith('http')) return `url(${p1})`
          try {
            return `url(${new URL(p1, baseUrl).href})`
          } catch {
            return `url(${p1})`
          }
        })
        $(el).attr('style', rewritten)
      }
    })

    // Inject the picker script at end of <body>
    $('body').append(getPickerScript())

    // Add a base tag so remaining relative resources resolve correctly
    if (!$('base').length) {
      $('head').prepend(`<base href="${baseUrl}/" />`)
    }

    const modifiedHtml = $.html()

    // Detect likely SPA/JS-only pages: very little text or known SPA root elements
    const bodyText = $('body').text().trim()
    const hasSpaRoot = $('div#root, div#app, div#__next').length > 0
    const spaWarning = bodyText.length < 200 || hasSpaRoot

    return NextResponse.json({
      html: modifiedHtml,
      spaWarning,
    })
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Die Webseite hat nicht innerhalb von 15 Sekunden geantwortet (Timeout).' },
        { status: 408 }
      )
    }

    if (err instanceof TypeError && (err as Error).message?.includes('fetch')) {
      return NextResponse.json(
        { error: 'Die Webseite ist nicht erreichbar. Bitte die URL ueberpruefen.' },
        { status: 502 }
      )
    }

    console.error('Proxy-fetch error:', err)
    return NextResponse.json(
      { error: 'Ein unerwarteter Fehler ist aufgetreten beim Laden der Webseite.' },
      { status: 500 }
    )
  }
}
