# NEWS-6: News REST API

**Status:** Planned
**Priority:** P0 (MVP)
**Created:** 2026-03-05

## Dependencies
- Requires: NEWS-1 (User Authentication) — alle Endpunkte erfordern gültigen JWT
- Requires: NEWS-5 (Scraping Scheduler) — Artikel müssen in der DB vorhanden sein

## Overview
Eine authentifizierte REST API (Next.js API Routes), über die eingeloggte Nutzer gespeicherte News-Artikel abrufen können. Unterstützt Filterung nach Quelle, Sprache und Datum sowie Pagination. Alle Endpunkte erfordern einen gültigen Supabase JWT im `Authorization: Bearer <token>`-Header.

## User Stories

1. Als **eingeloggter Nutzer** möchte ich alle News-Artikel paginiert abrufen können, damit ich die Daten in eigene Systeme integrieren kann.
2. Als **eingeloggter Nutzer** möchte ich Artikel nach Quelle filtern können, damit ich nur relevante Quellen abfragen kann.
3. Als **eingeloggter Nutzer** möchte ich Artikel nach Sprache filtern können, damit ich sprachspezifische News erhalte.
4. Als **eingeloggter Nutzer** möchte ich Artikel nach Zeitraum filtern können, damit ich nur aktuelle News erhalte.
5. Als **eingeloggter Nutzer** möchte ich einen einzelnen Artikel per ID abrufen können.
6. Als **Developer** möchte ich eine API-Dokumentation (OpenAPI/Swagger) haben, damit ich die Endpunkte ohne Trial-and-Error nutzen kann.

## Acceptance Criteria

### Endpunkte

- [ ] `GET /api/articles` — Liste aller Artikel (paginiert)
  - Query-Parameter: `page` (default: 1), `limit` (default: 20, max: 100), `source_id`, `language`, `from` (ISO 8601), `to` (ISO 8601), `search` (Volltextsuche in Titel)
  - Response: `{ data: Article[], total: number, page: number, limit: number }`
- [ ] `GET /api/articles/[id]` — Einzelner Artikel per UUID
  - Response: `{ data: Article }` oder 404
- [ ] `GET /api/sources` — Liste aller aktiven Quellen (read-only für User)
  - Response: `{ data: Source[] }`

### Allgemein

- [ ] Alle Endpunkte: `Authorization: Bearer <JWT>` erforderlich → 401 ohne Token
- [ ] Ungültiger/abgelaufener Token → 401 Unauthorized
- [ ] Fehlende Pflicht-Parameter → 400 Bad Request mit Fehlermeldung
- [ ] Artikel-Objekt enthält: `id`, `title`, `url`, `description`, `published_at`, `language`, `source_id`, `source_name`, `created_at`
- [ ] Sortierung: Standard `published_at DESC`
- [ ] Alle Queries nutzen `.limit()` (kein unbegrenztes SELECT)
- [ ] API-Fehler geben strukturiertes JSON zurück: `{ error: string, code: string }`

## Edge Cases

- `limit` > 100 → wird auf 100 gedeckelt (kein Fehler)
- `page` < 1 → wird auf 1 gesetzt
- `source_id` existiert nicht → leere Liste (kein 404)
- `from` > `to` → 400 Bad Request
- `search` mit Sonderzeichen (SQL Injection) → Zod-Validierung + parametrisierte Queries
- Keine Artikel in DB → leere Liste `{ data: [], total: 0 }`
- Sehr viele Ergebnisse → Pagination verhindert Performance-Probleme

## Out of Scope
- Artikel schreiben/löschen über die API (read-only für User)
- Webhook-Subscriptions für neue Artikel (v2)
- GraphQL (v2)
- API-Keys als Alternative zu JWT (v2)
