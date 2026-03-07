# NEWS-5: Scraping Scheduler & Deduplizierung

**Status:** In Progress
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
  6. Bei Fehler: `sources.last_error = <Fehlermeldung>` setzen
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
