# NEWS-19: Bubble-Sync (Artikel in den Datentyp "News Scraped" übertragen)

**Status:** In Progress
**Priority:** P0
**Created:** 2026-09-22

## Overview
Alle gescrapten Artikel sollen zusätzlich in der Bubble-Datenbank im Datentyp
**News Scraped** liegen. Ein täglicher Cron-Lauf am Morgen — nach den nächtlichen
Scrapes — überträgt genau die Artikel, die seit dem letzten Lauf neu hinzugekommen
sind. Bereits übertragene Artikel werden nicht erneut geschickt.

## Dependencies
- Requires: NEWS-5 (Scraping Scheduler) — liefert die Artikel
- Extern: Bubble-App mit aktivierter Data API und einem API-Token

## User Stories
1. Als **Betreiber** möchte ich, dass neu gescrapte News automatisch in meiner
   Bubble-Datenbank landen, damit ich sie dort ohne manuellen Export weiterverwenden kann.
2. Als **Betreiber** möchte ich, dass pro Artikel genau ein Bubble-Eintrag entsteht,
   damit meine Bubble-Daten keine Dubletten enthalten.
3. Als **Betreiber** möchte ich, dass ein fehlgeschlagener Übertragungslauf am nächsten
   Tag automatisch nachgeholt wird, damit keine News verloren gehen.

## Acceptance Criteria

### Erkennung neuer Artikel
- [x] `articles.bubble_synced_at` (nullable) und `articles.bubble_id` (text) per Migration ergänzt
- [x] Der Sync wählt ausschließlich Artikel mit `bubble_synced_at IS NULL`, älteste zuerst
- [x] Der Zeitstempel wird **erst nach** der Bestätigung durch Bubble gesetzt
- [x] Partieller Index `articles_bubble_unsynced_idx` für genau diese Abfrage

### Übertragung
- [x] Bubble Data API, Bulk-Endpoint `POST /api/1.1/obj/<datatype>/bulk`
- [x] Newline-delimited JSON, `Content-Type: text/plain`, Bearer-Token
- [x] Batchgröße 100, maximal 1000 Artikel pro Lauf
- [x] Pro Lauf konfigurierbar gegen Live- oder Test-Datenbank (`/version-test`)
- [x] Leere optionale Felder werden weggelassen, nicht als `""` geschickt

### Fehlerbehandlung
- [x] Transportfehler (Netzwerk, Timeout, non-2xx) → ganzer Batch bleibt unsynchronisiert, Retry am Folgetag
- [x] Einzelne von Bubble abgelehnte Datensätze stoppen die restlichen Batches nicht
- [x] Eine abgeschnittene Bubble-Antwort gilt als Fehlschlag, nie als Erfolg
- [x] Fehlende Bubble-Konfiguration → Lauf wird sauber übersprungen (`skipped_reason`), kein Cron-Fehler

### Zeitplan & Zugriff
- [x] `GET|POST /api/cron/bubble-sync`, abgesichert über `CRON_SECRET`
- [x] Täglich 06:00 UTC via `vercel.json`

## Feldzuordnung
Definiert in `src/lib/bubble/mapping.ts` — die einzige Stelle, die angepasst werden muss,
wenn sich die Feldnamen in Bubble ändern. Die Namen wurden aus einem bestehenden Datensatz
der App ids.online ausgelesen; Gross-/Kleinschreibung und Leerzeichen sind Teil des Namens.

| Supabase (`articles`) | Bubble ("News Scraped") |
|---|---|
| `title` | `Headline_DE` |
| `title` (wiederholt) | `Subheadline_DE` |
| `description` | `Teaser_Text_DE` |
| `url` | `Link Source URL` |
| `image_url` | `Picture` **und** `Picture URL` |
| Host aus `url`, ohne `www.` | `Publisher` |
| `published_at` | `Date publishing` |

`language` und `source_category_raw` werden nicht übertragen — in Bubble gibt es dafür kein
Feld. `Subheadline_DE` wiederholt die Headline, weil der Scraper keine eigene Subheadline
liefert und die bestehenden Datensätze es genauso halten.

## Konfiguration
| Variable | Pflicht | Bedeutung |
|---|---|---|
| `BUBBLE_API_BASE_URL` | ja | z.B. `https://meine-app.bubbleapps.io` |
| `BUBBLE_API_TOKEN` | ja | Data-API-Token aus Settings → API |
| `BUBBLE_DATA_TYPE` | ja | API-Name des Datentyps, z.B. `newsscraped` |
| `BUBBLE_USE_TEST_VERSION` | nein | `true` schreibt in die Bubble-Entwicklungsdatenbank |

Fehlt eine der drei Pflichtvariablen, überspringt der Cron den Sync ohne Fehler.

## Edge Cases
- Artikel wurde an Bubble übertragen, der Stempel in Supabase schlug fehl → wird geloggt
  und gemeldet; der Folgelauf erzeugt dann eine Dublette. Bewusst in Kauf genommen: Bubble
  hat kein Feld für die Supabase-ID, über das sich das abfangen liesse.
- Mehr als 1000 unsynchronisierte Artikel → der Rest folgt am nächsten Tag.
- Unparsbare Artikel-URL → `Publisher` entfällt, der Datensatz geht trotzdem raus.
- Retention (NEWS-12) löscht einen Artikel in Supabase → der Bubble-Eintrag bleibt bestehen.

## Out of Scope
- Rückrichtung Bubble → News-Scraper
- Updates bereits übertragener Artikel (nur Neuanlage)
- Löschen in Bubble, wenn die Retention in Supabase löscht
- Manueller "Jetzt synchronisieren"-Button im Dashboard
