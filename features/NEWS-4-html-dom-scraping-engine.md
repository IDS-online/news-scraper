# NEWS-4: HTML DOM Scraping Engine

**Status:** In Progress
**Priority:** P0 (MVP)
**Created:** 2026-03-05

## Dependencies
- Requires: NEWS-2 (News-Quellen-Verwaltung) — Quellen mit Typ "HTML" und konfigurierten CSS-Selektoren müssen existieren

## Overview
Eine serverseitige Engine, die beliebige HTML-Nachrichtenseiten via CSS-Selektoren scraped. Die konfigurierten Selektoren (Artikel-Container, Titel, Link, Beschreibung, Datum) werden verwendet, um Artikel zu extrahieren und in das einheitliche interne Format zu normalisieren. Wie bei NEWS-3 übernimmt NEWS-5 das Speichern.

## User Stories

1. Als **System** möchte ich eine HTML-Seite abrufen und via CSS-Selektoren Artikel extrahieren, damit strukturierte Daten aus beliebigen Newsseiten gewonnen werden.
2. Als **System** möchte ich relative URLs in absolute URLs umwandeln, damit alle Artikel-Links direkt aufgerufen werden können.
3. Als **System** möchte ich mit fehlenden DOM-Elementen umgehen, damit ein fehlender Selektor nicht den gesamten Scrape bricht.
4. Als **Admin** möchte ich im Fehlerfall einen Log-Eintrag sehen, damit ich CSS-Selektoren korrigieren kann.

## Acceptance Criteria

- [ ] Ruft HTML per HTTP GET ab (User-Agent: konfigurierbarer String, Standard: "Newsgrap3r/1.0")
- [ ] Parst HTML mit CSS-Selektoren aus der Quell-Konfiguration:
  - `selector_container`: Wiederholt, einer pro Artikel
  - `selector_title`: Titel-Text des Artikels
  - `selector_link`: `href`-Attribut des Links
  - `selector_description`: Teaser-Text (optional)
  - `selector_date`: Datum-Text (optional)
- [ ] Relative URLs (`/artikel/123`) werden zu absoluten URLs (`https://example.com/artikel/123`) umgewandelt
- [ ] Normalisiertes Ausgabeformat: `{ title, url, description, published_at, source_id, language }` (identisch zu NEWS-3)
- [ ] `published_at`: Datum-Text wird geparst (gängige Formate: ISO 8601, DD.MM.YYYY, "vor 2 Stunden"); bei Fehler: aktueller Timestamp
- [ ] Sprache aus Quell-Konfiguration; bei "Auto-Detect": `<html lang="">` oder `<meta http-equiv="Content-Language">` ausgelesen
- [ ] Netzwerkfehler / HTTP-Fehler werden geloggt, Engine gibt leere Liste zurück
- [ ] Timeout: 15 Sekunden
- [ ] JavaScript-gerenderte Seiten (SPA): explizit nicht unterstützt in v1 (nur statisches HTML)

## Edge Cases

- CSS-Selektor findet 0 Elemente → leere Liste, Log-Warnung "Kein Artikel gefunden für Quelle X"
- `selector_title` findet kein Element im Artikel-Container → Artikel wird verworfen
- `selector_link` findet kein Element → Artikel wird verworfen
- Seite gibt HTTP 200 zurück, aber kein gültiges HTML → Log-Fehler, leere Liste
- Seite blockiert Scraper (HTTP 403, Captcha) → geloggt, Quelle als "Letzter Scrape fehlgeschlagen" markiert
- Sehr große HTML-Seiten (> 5MB) → abgebrochen, Log-Warnung
- Encoding: UTF-8 bevorzugt, `<meta charset>` wird berücksichtigt

## Out of Scope
- RSS/Atom-Feeds (das ist NEWS-3)
- JavaScript-Rendering via Headless Browser (v2)
- Automatisches Erkennen von CSS-Selektoren
- Vollständigen Artikel-Text von der Detailseite scrapen (nur Teaser/Listing-Seite)

---

## Tech Design (Solution Architect)

**Implementierung:** Server-seitige TypeScript-Funktion in `src/lib/scraping/html-engine.ts` — wird vom Scheduler (NEWS-5) aufgerufen.

**HTML-Parsing:** `cheerio` npm-Package (jQuery-artiges DOM-Parsing für Node.js, kein Browser nötig)

**HTTP-Abruf:** Native `fetch` mit 15s Timeout, User-Agent `Newsgrap3r/1.0`, folgt bis zu 3 Redirects

**Output:** Identisches normalisiertes Format wie NEWS-3 — Scheduler und Datenbank unterscheiden nicht zwischen RSS und HTML nach dem Parsing.

**Neue Packages:** `cheerio`
