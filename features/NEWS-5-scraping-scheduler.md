# NEWS-5: Scraping Scheduler & Deduplizierung

**Status:** Deployed
**Priority:** P0 (MVP)
**Created:** 2026-03-05

## Dependencies
- Requires: NEWS-2 (News-Quellen-Verwaltung) — aktive Quellen mit Intervall-Konfiguration
- Requires: NEWS-3 (RSS Scraping Engine) — für RSS-Quellen
- Requires: NEWS-4 (HTML DOM Scraping Engine) — für HTML-Quellen

## Overview
Ein Scheduler-System, das pro Quelle einen Cron-Job ausführt. Jeder Job ruft die passende Scraping Engine auf, vergleicht die gescrapten Artikel-URLs mit der Datenbank und speichert nur neue Artikel (URL-basierte Deduplizierung). Der Job aktualisiert außerdem den `last_scraped_at`-Timestamp und `last_error` der Quelle.

## User Stories

1. Als **System** möchte ich jede aktive Quelle gemäß ihrem konfigurierten Intervall scrapen, damit News automatisch aktuell gehalten werden.
2. Als **System** möchte ich bereits gespeicherte Artikel-URLs erkennen und überspringen, damit keine Duplikate in der Datenbank entstehen.
3. Als **System** möchte ich nach jedem Scraping-Lauf `last_scraped_at` und `last_error` der Quelle aktualisieren, damit der Status im Dashboard sichtbar ist.
4. Als **Admin** möchte ich einen Scraping-Job manuell auslösen können, damit ich Quellen sofort testen kann ohne auf den nächsten Cron-Termin zu warten.
5. Als **System** möchte ich fehlerhafte Jobs isolieren, damit ein Fehler bei einer Quelle keine anderen Quellen beeinträchtigt.

## Acceptance Criteria

- [ ] Jede aktive Quelle hat einen eigenen Cron-Schedule basierend auf `interval_minutes`
- [ ] Cron-Implementierung: Vercel Cron Jobs (via `vercel.json`) oder Supabase Edge Functions mit pg_cron
- [ ] Job-Ablauf pro Quelle:
  1. Quelle laden (Typ, URL, Selektoren, Sprache)
  2. Passende Engine aufrufen (RSS oder HTML)
  3. Gescrapte URLs gegen `articles.url` in der DB prüfen (Batch-Query)
  4. Nur neue URLs in `articles` einfügen
  5. `sources.last_scraped_at = now()` setzen
  6. Bei Fehler: `sources.last_error = <Fehlermeldung>` setzen — refined 2026-08-11, see
     ["Post-deployment fix" below](#post-deployment-fix-2026-08-11): only a total failure
     (zero articles extracted) sets `last_error`; partial per-container skips alongside a
     successful run go to the new `sources.last_scrape_warning` column instead
- [ ] URL-Vergleich ist case-insensitive und ignoriert trailing slashes
- [ ] Maximale Batch-Insert-Größe: 100 Artikel pro Lauf
- [ ] Jobs für deaktivierte Quellen (`active = false`) werden nicht ausgeführt
- [ ] Manueller Trigger: API-Endpunkt `POST /api/sources/[id]/scrape` (nur Admin)
- [ ] Concurrency: Kein paralleler Job für die gleiche Quelle (Lock via DB oder Semaphore)

## Edge Cases

- Scraping Engine gibt 0 neue Artikel zurück → kein Insert, `last_scraped_at` trotzdem aktualisiert
- Zwei simultane Job-Runs für die gleiche Quelle (Race Condition) → zweiter Run erkennt Lock und wird übersprungen
- Datenbank-Insert schlägt fehl (Constraint Violation) → Fehler wird geloggt, restliche Artikel werden trotzdem versucht
- Quelle wird während eines laufenden Jobs deaktiviert → aktueller Job läuft bis zum Ende durch
- Job-Timeout (Scraping dauert > 30s) → Job wird abgebrochen, `last_error` gesetzt
- Alle Quellen scrapen gleichzeitig (gleiche Intervalle) → Vercel Cron startet Jobs nacheinander, kein System-Überlastschutz nötig in v1

## Out of Scope
- Retry-Logik mit Backoff (v2)
- Job-Queue mit Priorisierung (v2)
- Scraping-Statistiken / Metriken-Dashboard (v2)
- Benachrichtigungen bei dauerhaft fehlgeschlagenen Jobs (v2)

---

## Tech Design (Solution Architect)

**Cron-Trigger:** Vercel Cron Job ruft `POST /api/cron/scrape` alle 15 Minuten auf. Der Endpunkt prüft welche aktiven Quellen gemäß ihrem `interval_minutes` fällig sind.

**Absicherung:** `CRON_SECRET` Environment Variable — Vercel sendet diesen als Header, unautorisierte Calls werden abgewiesen.

**Ablauf pro Quelle:** Engine aufrufen → Deduplizierung (URL-Vergleich gegen DB) → Artikel speichern (status: `pending`) → LLM-Kategorisierung (NEWS-11) → `sources.last_scraped_at` aktualisieren

**Concurrency-Schutz:** `sources.last_scraped_at` wird zu Beginn des Jobs gesetzt (optimistic lock) — zweiter gleichzeitiger Job für dieselbe Quelle erkennt den laufenden Job und überspringt.

**Manueller Trigger:** `POST /api/sources/[id]/scrape` (Admin only) — ruft denselben Job-Code direkt auf.

**Neue Packages:** Keine (nutzt NEWS-3/4 intern)

---

## Post-deployment fix (2026-08-11)

**Problem:** `sources.last_error` was set to the joined list of per-article scrape messages
(e.g. `Artikel ohne Titel uebersprungen — selector_title "..." nicht gefunden`) whenever *any*
container failed to parse during a run — even when the same run successfully found and
inserted other articles. This made an actively-working source (e.g. ZWP: 15 `article.medium`
containers matching correctly, articles arriving in the DB) show up with a red "Fehler" badge
in the sources list, indistinguishable from a source that was fully broken. Two of the three
call sites in `scrapeSource()` additionally discarded `result.errors` outright (always passed
`null`), which was a separate, pre-existing bug in the opposite direction.

**Root cause context:** per-container skip messages in `html-engine.ts` /
`scrapeHtmlPage()` (see [NEWS-4](NEWS-4-html-dom-scraping-engine.md)) are informational by
design — a single malformed container shouldn't abort the whole run — but the scheduler had
no way to distinguish "some containers were skipped" from "the whole source is down."

**Fix:** added `resolveScrapeStatus(result)` in `src/lib/scraping/scheduler.ts`:
- `errors.length === 0` → both `last_error` and `last_scrape_warning` cleared (`null`)
- `errors.length > 0` and `articles_found === 0` → hard failure, `last_error` set (nothing at
  all came out of this run)
- `errors.length > 0` and `articles_found > 0` → non-fatal, `last_scrape_warning` set instead,
  `last_error` cleared

A thrown exception (network error, timeout, unhandled crash) still always sets `last_error`
directly in the `catch` block — that path is unrelated to per-article skip messages.

**Schema change:** new nullable column `sources.last_scrape_warning` (migration
`20260811101658_add_sources_last_scrape_warning.sql`).

**Also updated:**
- `POST /api/sources/[id]/scrape` ([route.ts](../src/app/api/sources/[id]/scrape/route.ts)):
  the "hard failure" response (HTTP 207) now checks `articles_found === 0` instead of
  `articles_inserted === 0`, so a run that found articles but inserted 0 new ones (all
  duplicates) is no longer reported as an error.
- Sources list UI ([source-list.tsx](../src/components/dashboard/sources/source-list.tsx)):
  added a yellow "Artikel übersprungen" badge/tooltip driven by `last_scrape_warning`,
  separate from the existing red "Fehler" badge (`last_error`). The manual-scrape result
  banner now has three visual states (success/warning/error) instead of two.
- `resolveScrapeStatus()` is unit-tested in `scheduler.test.ts`.

**Not changed:** the underlying `article.medium` / `h3.large_headline.check_title_size`
selector configuration for ZWP was already correct — this fix is purely about how the
scheduler reports partial per-container failures, not about scraping accuracy itself.
