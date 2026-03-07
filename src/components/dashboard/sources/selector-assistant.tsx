'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { AlertCircle, ChevronDown, Loader2, Wand2 } from 'lucide-react'

/** Maximum bytes of pasted HTML to process (500 KB). */
const MAX_HTML_SIZE = 500 * 1024

/** Fields the assistant can detect selectors for. */
type SelectorField =
  | 'selector_container'
  | 'selector_title'
  | 'selector_link'
  | 'selector_description'
  | 'selector_date'
  | 'selector_category'
  | 'selector_image'

interface SelectorCandidate {
  selector: string
  preview: string
}

interface FieldResult {
  field: SelectorField
  label: string
  candidates: SelectorCandidate[]
}

interface SelectorAssistantProps {
  onApply: (field: SelectorField, selector: string) => void
}

// ---------------------------------------------------------------------------
// Detection heuristics
// ---------------------------------------------------------------------------

/**
 * Build a concise CSS selector for the given element relative to the document.
 * Prefers tag + class combinations. Falls back to tag name.
 */
/** Escape CSS-special characters in a class name so it can be used in a selector. */
function escapeCssClass(cls: string): string {
  // Escape characters that are special in CSS selectors: : . [ ] # ( ) > ~ + *
  return cls.replace(/([.:[\]#()+~*>])/g, '\\$1')
}

function buildSelector(el: Element): string {
  const tag = el.tagName.toLowerCase()

  // If the element has meaningful classes, use the first one or two
  const classes = Array.from(el.classList)
    .filter((c) => !c.match(/^(js-|is-|has-|active|hidden|visible|open|closed)/))
    .map(escapeCssClass)
  if (classes.length > 0) {
    return `${tag}.${classes.slice(0, 2).join('.')}`
  }

  // If element has a useful attribute like data-* or role
  const role = el.getAttribute('role')
  if (role) return `${tag}[role="${role}"]`

  return tag
}

/**
 * Extract a short text preview from an element.
 */
function previewText(el: Element, maxLen = 60): string {
  // For images, show src
  if (el.tagName === 'IMG') {
    const src = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || ''
    return truncate(src, maxLen)
  }

  // For time elements, show datetime
  if (el.tagName === 'TIME') {
    const dt = el.getAttribute('datetime')
    if (dt) return truncate(dt, maxLen)
  }

  // For links, show href
  if (el.tagName === 'A') {
    const href = el.getAttribute('href') || ''
    const text = el.textContent?.trim() || ''
    if (text) return truncate(text, maxLen)
    return truncate(href, maxLen)
  }

  const text = el.textContent?.trim() || ''
  return truncate(text, maxLen)
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '\u2026'
}

/**
 * Detect container candidates by looking for repeated structural elements
 * that contain both a link and heading-like text.
 */
function detectContainers(doc: Document): SelectorCandidate[] {
  const candidateSelectors = [
    'article',
    '[class*="article"]',
    '[class*="item"]',
    '[class*="post"]',
    '[class*="entry"]',
    'li',
  ]

  const results: SelectorCandidate[] = []
  const seen = new Set<string>()

  for (const sel of candidateSelectors) {
    try {
      const elements = doc.querySelectorAll(sel)
      if (elements.length < 1) continue

      // Check if these elements contain a link and some text
      const first = elements[0]
      const hasLink = first.querySelector('a[href]')
      const hasText =
        first.querySelector('h1, h2, h3, h4, [class*="title"], [class*="headline"]') ||
        (first.textContent?.trim().length ?? 0) > 20

      if (hasLink && hasText) {
        const builtSel = buildSelector(first)
        if (!seen.has(builtSel)) {
          seen.add(builtSel)
          results.push({
            selector: builtSel,
            preview: elements.length === 1 ? '1 Element gefunden' : `${elements.length} Elemente gefunden`,
          })
        }
      }
    } catch {
      // Invalid selector, skip
    }

    if (results.length >= 3) break
  }

  return results
}

/**
 * Detect candidates for a specific field within a container context.
 */
function detectField(
  doc: Document,
  containerSel: string | null,
  fieldSelectors: string[],
  extractPreview: (el: Element) => string
): SelectorCandidate[] {
  const scope = containerSel ? doc.querySelector(containerSel) : doc.body
  if (!scope) return []

  const results: SelectorCandidate[] = []
  const seen = new Set<string>()

  for (const sel of fieldSelectors) {
    try {
      const el = scope.querySelector(sel)
      if (!el) continue

      const builtSel = buildSelector(el)
      if (seen.has(builtSel)) continue
      seen.add(builtSel)

      const preview = extractPreview(el)
      if (!preview) continue

      results.push({ selector: builtSel, preview })
    } catch {
      // Invalid selector, skip
    }

    if (results.length >= 3) break
  }

  return results
}

function analyzeHtml(htmlString: string): FieldResult[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlString, 'text/html')

  const results: FieldResult[] = []

  // 1. Detect containers
  const containers = detectContainers(doc)
  if (containers.length > 0) {
    results.push({
      field: 'selector_container',
      label: 'Artikel-Container',
      candidates: containers,
    })
  }

  // Use first container candidate as scope for child fields
  const containerSel = containers.length > 0 ? containers[0].selector : null

  // 2. Title
  const titles = detectField(
    doc,
    containerSel,
    [
      'h1',
      'h2',
      'h3',
      'h4',
      '[class*="title"]',
      '[class*="headline"]',
      'a[href]',
    ],
    (el) => previewText(el)
  )
  if (titles.length > 0) {
    results.push({ field: 'selector_title', label: 'Titel', candidates: titles })
  }

  // 3. Link
  const links = detectField(
    doc,
    containerSel,
    ['a[href]', '[class*="link"] a', 'h2 a', 'h3 a'],
    (el) => {
      const href = el.getAttribute('href') || ''
      return truncate(href, 60)
    }
  )
  if (links.length > 0) {
    results.push({ field: 'selector_link', label: 'Link', candidates: links })
  }

  // 4. Description
  const descriptions = detectField(
    doc,
    containerSel,
    ['p', '[class*="desc"]', '[class*="summary"]', '[class*="teaser"]', '[class*="excerpt"]'],
    (el) => previewText(el)
  )
  if (descriptions.length > 0) {
    results.push({
      field: 'selector_description',
      label: 'Beschreibung',
      candidates: descriptions,
    })
  }

  // 5. Date
  const dates = detectField(
    doc,
    containerSel,
    ['time[datetime]', '[class*="date"]', '[class*="time"]', '[class*="published"]'],
    (el) => {
      if (el.tagName === 'TIME') {
        return el.getAttribute('datetime') || el.textContent?.trim() || ''
      }
      return previewText(el)
    }
  )
  if (dates.length > 0) {
    results.push({ field: 'selector_date', label: 'Datum', candidates: dates })
  }

  // 6. Category
  const cats = detectField(
    doc,
    containerSel,
    ['[class*="category"]', '[class*="tag"]', '[class*="rubrik"]'],
    (el) => previewText(el)
  )
  if (cats.length > 0) {
    results.push({ field: 'selector_category', label: 'Kategorie', candidates: cats })
  }

  // 7. Image
  const images = detectField(
    doc,
    containerSel,
    ['img[src]', '[class*="image"] img', '[class*="thumb"] img', '[data-src]', '[data-lazy-src]'],
    (el) => {
      const src =
        el.getAttribute('src') ||
        el.getAttribute('data-src') ||
        el.getAttribute('data-lazy-src') ||
        ''
      return truncate(src, 60)
    }
  )
  if (images.length > 0) {
    results.push({ field: 'selector_image', label: 'Bild', candidates: images })
  }

  return results
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SelectorAssistant({ onApply }: SelectorAssistantProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [htmlInput, setHtmlInput] = useState('')
  const [results, setResults] = useState<FieldResult[]>([])
  const [analyzed, setAnalyzed] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  // Track which candidate was last applied: `${field}-${idx}`
  const [appliedKey, setAppliedKey] = useState<string | null>(null)

  function handleAnalyze() {
    setValidationError(null)
    setResults([])
    setAnalyzed(false)

    const trimmed = htmlInput.trim()
    if (!trimmed) {
      setValidationError('Bitte HTML einfuegen')
      return
    }

    setAnalyzing(true)
    // Use rAF + setTimeout(0) to guarantee the browser paints the loading
    // spinner before the synchronous HTML parse blocks the main thread.
    requestAnimationFrame(() => {
      setTimeout(() => {
        const capped = trimmed.slice(0, MAX_HTML_SIZE)
        const fieldResults = analyzeHtml(capped)
        setAnalyzed(true)
        setResults(fieldResults)
        setAnalyzing(false)
      }, 0)
    })
  }

  const handleApply = useCallback((field: SelectorField, selector: string, key: string) => {
    onApply(field, selector)
    setAppliedKey(key)
    setTimeout(() => setAppliedKey(null), 1500)
  }, [onApply])

  function reset() {
    setHtmlInput('')
    setResults([])
    setAnalyzed(false)
    setAnalyzing(false)
    setValidationError(null)
    setAppliedKey(null)
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-between px-0 hover:bg-transparent"
          aria-label={isOpen ? 'Selektor-Assistent schliessen' : 'Selektor-Assistent oeffnen'}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Wand2 className="h-4 w-4" />
            Selektor-Assistent
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 pt-2">
        <p className="text-xs text-muted-foreground">
          Fuege den HTML-Quelltext einer News-Seite ein und klicke
          &quot;Selektoren erkennen&quot;, um passende CSS-Selektoren
          automatisch zu ermitteln.
        </p>

        <Textarea
          value={htmlInput}
          onChange={(e) => {
            setHtmlInput(e.target.value)
            setValidationError(null)
          }}
          placeholder="<html>...</html>"
          className="min-h-[120px] font-mono text-xs"
          aria-label="HTML-Quelltext"
        />

        {validationError && (
          <p className="text-xs text-destructive">{validationError}</p>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleAnalyze}
            disabled={analyzing}
            aria-label="Selektoren erkennen"
          >
            {analyzing ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-1.5" />
            )}
            {analyzing ? 'Analysiere...' : 'Selektoren erkennen'}
          </Button>
          {(analyzed || htmlInput) && !analyzing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reset}
              aria-label="Assistent zuruecksetzen"
            >
              Zuruecksetzen
            </Button>
          )}
        </div>

        {/* No results message */}
        {analyzed && results.length === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Keine Selektoren erkannt. Pruefe das HTML. Tipp: Verwende den
              Quelltext aus &quot;Seitenquelltext anzeigen&quot; statt aus den
              DevTools-Elementen, da letztere JavaScript-gerenderten Inhalt
              enthalten koennen.
            </AlertDescription>
          </Alert>
        )}

        {/* Results grouped by field */}
        {results.length > 0 && (
          <div className="space-y-3">
            {results.map((fieldResult) => (
              <div key={fieldResult.field} className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {fieldResult.label}
                </p>
                <div className="space-y-1">
                  {fieldResult.candidates.map((candidate, idx) => {
                    const key = `${fieldResult.field}-${idx}`
                    const isApplied = appliedKey === key
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleApply(fieldResult.field, candidate.selector, key)}
                        className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isApplied
                            ? 'border-green-500/60 bg-green-50 dark:bg-green-950/20'
                            : 'hover:bg-accent hover:border-primary/30'
                        }`}
                        aria-label={`Selektor "${candidate.selector}" fuer ${fieldResult.label} uebernehmen`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            variant={isApplied ? 'default' : 'secondary'}
                            className={`font-mono text-xs shrink-0 ${isApplied ? 'bg-green-600' : ''}`}
                          >
                            {candidate.selector}
                          </Badge>
                          <span className="text-xs text-muted-foreground truncate">
                            {isApplied ? 'Uebernommen' : candidate.preview}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
