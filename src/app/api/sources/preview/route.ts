import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { scrapeHtmlPreview } from '@/lib/scraping/html-engine'

const previewSchema = z.object({
  url: z.string().url('Bitte eine gueltige URL eingeben'),
  selector_container: z.string().min(1, 'Container-Selektor ist erforderlich'),
  selector_title: z.string().min(1, 'Titel-Selektor ist erforderlich'),
  selector_link: z.string().min(1, 'Link-Selektor ist erforderlich'),
  selector_description: z.string().optional().nullable(),
  selector_date: z.string().optional().nullable(),
  selector_category: z.string().optional().nullable(),
  selector_image: z.string().optional().nullable(),
  language: z.string().optional().nullable(),
})

/**
 * POST /api/sources/preview
 * Perform a dry-run HTML scrape and return up to 5 article candidates.
 * Admin only. Does NOT save anything to the database.
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

  const parsed = previewSchema.safeParse(body)
  if (!parsed.success) {
    const details: Record<string, string[]> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.')
      if (!details[key]) details[key] = []
      details[key].push(issue.message)
    }
    return NextResponse.json(
      { error: 'Validierungsfehler', details },
      { status: 422 }
    )
  }

  const config = parsed.data

  try {
    const result = await scrapeHtmlPreview(
      {
        url: config.url,
        selector_container: config.selector_container,
        selector_title: config.selector_title,
        selector_link: config.selector_link,
        selector_description: config.selector_description ?? null,
        selector_date: config.selector_date ?? null,
        selector_category: config.selector_category ?? null,
        selector_image: config.selector_image ?? null,
        language: config.language ?? undefined,
      },
      5
    )

    if (result.articles.length === 0) {
      // Determine a helpful error message from the scrape errors
      const errorMessage =
        result.errors.length > 0
          ? result.errors[0].message
          : 'Keine Artikel gefunden. Bitte URL und Selektoren ueberpruefen.'

      const errorCode = result.errors.length > 0 ? result.errors[0].code : 'PARSE_ERROR'

      // Provide human-readable suggestions based on error type
      let suggestion = 'Bitte die CSS-Selektoren und die URL ueberpruefen.'
      if (errorCode === 'TIMEOUT') {
        suggestion = 'Die Webseite hat nicht rechtzeitig geantwortet. Bitte spaeter erneut versuchen.'
      } else if (errorCode === 'HTTP_ERROR') {
        const httpStatus = result.errors[0]?.http_status
        if (httpStatus === 403) {
          suggestion =
            'Die Webseite hat die Anfrage blockiert (403). Einige Seiten erlauben kein automatisches Abrufen.'
        } else if (httpStatus === 404) {
          suggestion = 'Die Seite wurde nicht gefunden (404). Bitte die URL ueberpruefen.'
        } else {
          suggestion = `Die Webseite hat mit HTTP ${httpStatus} geantwortet.`
        }
      } else if (errorCode === 'NETWORK_ERROR') {
        suggestion =
          'Die Webseite ist nicht erreichbar. Bitte die URL und die Internetverbindung ueberpruefen.'
      }

      return NextResponse.json(
        {
          success: false,
          articles: [],
          error: errorMessage,
          suggestion,
          errors: result.errors,
        },
        { status: 200 }
      )
    }

    return NextResponse.json({
      success: true,
      articles: result.articles.map((a) => ({
        title: a.title,
        url: a.url,
        description: a.description,
        image_url: a.image_url,
        published_at: a.published_at,
        source_category_raw: a.source_category_raw,
        language: a.language,
      })),
      count: result.articles.length,
      errors: result.errors,
    })
  } catch (err: unknown) {
    console.error('Preview scrape failed:', err)
    return NextResponse.json(
      { error: 'Ein unerwarteter Fehler ist aufgetreten', success: false },
      { status: 500 }
    )
  }
}
