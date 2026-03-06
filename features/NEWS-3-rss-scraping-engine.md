# NEWS-3: RSS/Atom Feed Scraping Engine

**Status:** Planned
**Priority:** P0 (MVP)
**Created:** 2026-03-05

## Dependencies
- Requires: NEWS-2 (News-Quellen-Verwaltung) — Quellen mit Typ "RSS" müssen existieren

## Overview
Eine serverseitige Engine, die RSS 2.0 und Atom 1.0 Feeds von konfigurierten Quellen abruft und die Artikel in ein einheitliches internes Format normalisiert. Die Engine gibt eine Liste normalisierter Artikel zurück — das Speichern übernimmt NEWS-5 (Scheduler & Deduplizierung).

## User Stories

1. Als **System** möchte ich einen RSS/Atom-Feed-URL abrufen und parsen können, damit Artikel extrahiert werden.
2. Als **System** möchte ich Artikel aus dem Feed in ein einheitliches Format normalisieren, damit sie konsistent gespeichert werden können.
3. Als **System** möchte ich mit Netzwerkfehlern und ungültigen Feeds umgehen, damit ein einzelner Fehler nicht den gesamten Scraping-Lauf abbricht.
4. Als **Admin** möchte ich im Fehlerfall einen Log-Eintrag sehen, damit ich fehlerhafte Quellen identifizieren kann.

## Acceptance Criteria

- [ ] Unterstützt RSS 2.0 und Atom 1.0
- [ ] Extrahiert pro Artikel: `title`, `url` (link), `description`/`summary`, `published_at`, `source_id`
- [ ] `published_at` wird aus Feed-Datum geparst; falls fehlt: aktueller Timestamp
- [ ] Normalisiertes Ausgabeformat: `{ title, url, description, published_at, source_id, language }`
- [ ] Sprache wird von der Quell-Konfiguration übernommen; bei "Auto-Detect" wird die Sprache aus dem Feed-Metadatum oder dem Content erkannt
- [ ] Netzwerkfehler (Timeout > 10s, HTTP 4xx/5xx) werden geloggt, Engine wirft keinen unkontrollierten Fehler
- [ ] Ungültiges XML / kein Feed → geloggt, leere Artikel-Liste zurückgegeben
- [ ] Encoding-Probleme (UTF-8, ISO-8859-1) werden behandelt
- [ ] Artikel-URLs werden normalisiert (trailing slashes entfernt, Query-Parameter beibehalten)

## Edge Cases

- Feed ist leer (0 Einträge) → leere Liste, kein Fehler
- Artikel ohne `<title>` → Artikel wird mit leerem Titel übernommen (nicht verworfen)
- Artikel ohne `<link>` → Artikel wird verworfen, Log-Eintrag
- Feed liefert doppelte URLs innerhalb eines einzelnen Abrufs → Duplikate innerhalb des Runs dedupliziert
- Feed antwortet mit HTTP 301/302 Redirect → Redirect wird gefolgt (max. 3 Redirects)
- Feed antwortet mit HTTP 429 (Rate Limit) → geloggt, Quelle wird beim nächsten Intervall erneut versucht
- Sehr großer Feed (> 1000 Einträge) → nur die neuesten 100 Artikel werden verarbeitet

## Out of Scope
- HTML-Seiten scrapen (das ist NEWS-4)
- Artikel in die Datenbank speichern (das ist NEWS-5)
- Feed-Validierung oder Vorschau in der UI
