# Newsgrap3r – System-Architektur

> Holistische technische Architektur für alle 13 Features (NEWS-1 bis NEWS-13).
> Erstellt: 2026-03-06

> Stand: dieses Dokument beschreibt den Zielzustand. Abweichungen zwischen Entwurf und
> Implementierung sind mit "GEPLANT" markiert. Der verbindliche Stand des Schemas ist
> `supabase/migrations/`, nicht dieses Dokument. Zuletzt gegen den Code geprüft: 2026-07-28.

---

## 1. Technologie-Übersicht

| Schicht | Technologie | Warum |
|---------|------------|-------|
| Frontend | Next.js 16 App Router + React | Server- und Client-Komponenten in einem Framework |
| Styling | Tailwind CSS + shadcn/ui | IDS.online Design System umsetzbar, keine Custom-CSS nötig |
| Datenbank | Supabase PostgreSQL | Managed DB + Auth + RLS in einem Service |
| Authentifizierung | Supabase Auth | Email/Passwort out-of-the-box, JWT-Integration |
| Scraping: RSS | rss-parser (npm) | Bewährte Library für RSS 2.0 + Atom 1.0 |
| Scraping: HTML | cheerio (npm) | jQuery-artiges DOM-Parsing für Node.js |
| Spracherkennung | franc (npm) | Leichtgewichtig, 187 Sprachen, keine API nötig |
| Kategorisierung | Anthropic Claude API (Haiku) | **GEPLANT** — NEWS-11 nicht implementiert. Kein `@anthropic-ai`-Paket in `package.json`, kein `src/lib/categorization/`; nur `ANTHROPIC_API_KEY` ist in `src/lib/env.ts` deklariert |
| Cronjobs | Vercel Cron Jobs | Native Vercel-Integration, kein externer Service |
| Deployment | Vercel | Nahtlose Next.js-Integration, kostenlos für MVP |
| Validierung | Zod | Typsichere Validierung auf Server und Client |
| Charts | Recharts | **GEPLANT** — NEWS-13 nicht implementiert. `recharts` ist keine Abhängigkeit in `package.json` |

---

## 2. Datenbankschema (Supabase PostgreSQL)

### Tabellen-Übersicht

```
auth.users          (Supabase intern — nicht direkt modifiziert)
    ↓ 1:1
profiles            (Rolle: admin / user)

categories          (NEWS-9)
    ↑ n:m via article_categories
articles            (Kern-Datentabelle)
    ↑ n:1
sources             (NEWS-2, NEWS-10)
    ↑ 1:n
source_category_mappings  (NEWS-10)

system_settings     (NEWS-12: globaler Retention-Schalter)
retention_log       (NEWS-12: Protokoll der Löschläufe)
```

### Tabelle: `profiles`
Erweitert Supabase `auth.users` mit der Anwendungsrolle.

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| id | uuid (PK, FK → auth.users) | Identisch mit Supabase User-ID |
| email | text | Kopie aus auth.users (für Lesbarkeit) |
| role | text | `admin` oder `user` |
| created_at | timestamptz | Automatisch gesetzt |
| updated_at | timestamptz | Automatisch per Trigger `set_profiles_updated_at` gesetzt; fehlte bisher in diesem Dokument |

### Tabelle: `categories`
Vom Admin definierte Klassifizierungs-Kategorien.

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| id | uuid (PK) | — |
| name | text (unique über `idx_categories_name_lower`) | Anzeigename, case-insensitive eindeutig — durchgesetzt per `UNIQUE INDEX` auf `lower(name)`, nicht per Tabellen-Constraint |
| description | text (NOT NULL, DEFAULT `''`) | Semantischer Kontext für LLM (min. 20 Zeichen) |
| created_at | timestamptz | — |
| updated_at | timestamptz | — |

### Tabelle: `sources`
Konfigurierte Newsquellen (NEWS-2 + NEWS-10 + NEWS-12).

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| id | uuid (PK) | — |
| name | text | Anzeigename |
| slug | text (unique) | URL-sicherer Bezeichner, z.B. `heise-online` |
| url | text | Feed- oder HTML-URL |
| type | text | `rss` oder `html` |
| language | text | Sprachcode z.B. `de`, `en`, oder `auto` |
| interval_minutes | int | Scraping-Intervall (min. 5) |
| is_active | boolean | `true` = wird gescrapt (Spalte heißt `is_active`, nicht `active` — siehe `sources.is_active` in der Migration und `src/lib/validations/source.ts`) |
| default_category_id | uuid (FK → categories, nullable) | Basis-Kategorie |
| retention_days | int (nullable) | Aufbewahrungsfrist; `NULL` = nie löschen |
| last_scraped_at | timestamptz (nullable) | Letzter erfolgreicher Scrape |
| last_error | text (nullable) | Letzter Fehler-Text |
| scraping_in_progress | boolean | Sperrt gleichzeitige Scrape-Läufe derselben Quelle (fehlte bisher in diesem Dokument) |
| selector_container | text (nullable) | CSS: Artikel-Container (nur HTML) |
| selector_title | text (nullable) | CSS: Titel-Element (nur HTML) |
| selector_link | text (nullable) | CSS: Link-Element (nur HTML) |
| selector_description | text (nullable) | CSS: Teaser-Element (nur HTML) |
| selector_date | text (nullable) | CSS: Datum-Element (nur HTML) |
| selector_image | text (nullable) | CSS: Bild-Element (nur HTML) |
| selector_category | text (nullable) | CSS: Kategorie-Element (nur HTML) |
| created_at | timestamptz | — |
| updated_at | timestamptz | — |

### Tabelle: `source_category_mappings`
Übersetzung von Quellen-eigenen Kategorien in Systemkategorien (NEWS-10).

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| id | uuid (PK) | — |
| source_id | uuid (FK → sources, CASCADE) | Zugehörige Quelle |
| source_category_raw | text | Kategorie-String aus der Quelle, z.B. `Tech` |
| category_id | uuid (FK → categories, CASCADE) | Unsere Kategorie |

### Tabelle: `articles`
Gescrapte Artikel (Kern-Datentabelle).

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| id | uuid (PK) | — |
| source_id | uuid (FK → sources, `ON DELETE SET NULL`) | Zugehörige Quelle |
| url | text (unique, case-insensitiv über `lower(url)`) | Artikel-URL — Basis der Deduplizierung |
| title | text | Artikel-Titel |
| description | text (nullable) | Teaser-Text |
| image_url | text (nullable) | Bild-URL von der Quelle |
| source_category_raw | text (nullable) | Rohkategorie aus dem Feed/HTML |
| language | text (DEFAULT `'und'`) | Erkannter oder konfigurierter Sprachcode |
| published_at | timestamptz **NOT NULL** (DEFAULT `now()`) | Veröffentlichungsdatum — anders als früher hier dokumentiert ist diese Spalte nicht nullable |
| category_id | uuid (FK → categories, `ON DELETE SET NULL`, nullable) | Zugewiesene Kategorie; fehlte bisher in diesem Dokument |
| categorization_status | text | `pending` / `done` / `failed` / `skipped` |
| created_at | timestamptz | Zeitpunkt des Scrapings |
| updated_at | timestamptz | Automatisch per Trigger `articles_updated_at` gesetzt; fehlte bisher in diesem Dokument |

> Es gibt **keine** `source_slug`-Spalte auf `articles` — diese Zeile stand hier fälschlich; die
> Migration kennt kein solches Feld. Filterung nach Quelle läuft über `source_id`.

### Tabelle: `article_categories`
n:m-Verknüpfung zwischen Artikeln und Kategorien.

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| id | uuid (PK) | Tatsächlicher Primärschlüssel — nicht `(article_id, category_id)`, siehe unten |
| article_id | uuid (FK → articles, CASCADE) | — |
| category_id | uuid (FK → categories, CASCADE) | — |
| assigned_by | text | `llm` / `mapping` / `default` / `manual`; fehlte bisher in diesem Dokument |
| created_at | timestamptz | Fehlte bisher in diesem Dokument |
| UNIQUE | (article_id, category_id) | Verhindert Duplikate — ist ein UNIQUE-Constraint, nicht der Primärschlüssel |

### Tabelle: `system_settings`
Schlüssel-Wert-Store für globale Einstellungen (NEWS-12).

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| key | text (PK) | z.B. `retention_enabled` |
| value | text | z.B. `false` |
| updated_at | timestamptz | Fehlte bisher in diesem Dokument |

### Tabelle: `retention_log`
Protokoll der täglichen Löschläufe (NEWS-12).

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| id | uuid (PK) | — |
| source_id | uuid (FK → sources, nullable, `ON DELETE SET NULL`) | Quelle, aus der gelöscht wurde |
| source_name | text (nullable) | Name der Quelle zum Zeitpunkt des Löschlaufs (denormalisiert, überlebt Quellen-Löschung); fehlte bisher in diesem Dokument |
| deleted_count | int | Anzahl gelöschter Artikel |
| run_at | timestamptz | Zeitpunkt des Löschlaufs |

### Wichtige Datenbankindizes

| Tabelle | Index auf | Grund |
|---------|-----------|-------|
| articles | `url` (unique) | Deduplizierung |
| articles | `source_id` | Artikel-Abfragen pro Quelle |
| articles | `published_at` | Zeitliche Sortierung + Retention-Filter |
| articles | `categorization_status` | LLM-Job-Queue |
| sources | `slug` (unique) | Schnelles Nachschlagen |
| sources | `is_active` | Scheduler filtert inaktive Quellen |
| article_categories | `article_id` | Kategorie-Lookup pro Artikel |
| article_categories | `category_id` | Artikel-Lookup pro Kategorie |

> Diese Tabelle ist eine Auswahl der wichtigsten Indizes, keine vollständige Liste. Die Migration
> enthält weitere (u.a. `idx_articles_language`, `idx_articles_created_at`,
> `idx_articles_source_published`, `idx_articles_title_search` — ein GIN-Volltextindex auf
> `articles.title`, der von der aktuellen Suche in `/api/articles` derzeit nicht genutzt wird, da
> dort mit `ILIKE` gefiltert wird —, `idx_sources_type`, `idx_sources_last_scraped_at` und
> `profiles_role_idx`). Verbindlich ist immer `supabase/migrations/`.

---

## 3. Row Level Security (RLS)

Jede Tabelle hat RLS aktiviert. Grundprinzip:

| Rolle | Lesen | Schreiben |
|-------|-------|-----------|
| Anonym (kein JWT) | Nein | Nein |
| `user` | Alle Daten | Nein |
| `admin` | Alle Daten | Alle Tabellen außer `profiles` (nur eigene) |
| Service Role (Cron/API) | Alle | Alle (via Supabase Service Key) |

> Präzisierung zu `articles`: Admins haben laut Policies nur eine DELETE-Policy
> (`"Admins can delete articles"`). INSERT und UPDATE auf `articles` sind ausschließlich der
> `service_role` vorbehalten (Scraper/Cron) — ein Admin kann über die normale Session also keine
> Artikel anlegen oder bearbeiten, nur löschen.

---

## 4. Frontend-Seitenstruktur

> Es gibt **keine** `/dashboard/admin/*`-Routengruppe — dieses Verzeichnis existiert nicht.
> Quellen- und Kategorie-CRUD liegen direkt unter `/dashboard/sources` bzw.
> `/dashboard/categories`; die Admin-Berechtigung wird pro Seite/Komponente geprüft, nicht über
> ein eigenes Routenpräfix. Ein separates `/dashboard/statistics` gibt es ebenfalls nicht
> (NEWS-13 ist **GEPLANT**, nicht gebaut).

```
/ (Root)
└── /login                        Öffentlich — Login-Formular
└── /register                     Öffentlich — Registrierungsformular

/dashboard                        Geschützt (alle eingeloggten User, per Middleware)
├── /                             page.tsx — Redirect zu /dashboard/news
├── /news                         NEWS-7: News-Feed (alle Artikel, Filter)
├── /sources                      NEWS-2+8+10: Quellen-Übersicht, CRUD-Dialoge und
│   │                             Kategorie-Mapping direkt auf dieser Seite (Admin-Prüfung
│   │                             erfolgt in der Komponente, nicht per Routenpräfix)
│   ├── /new/visual               NEWS-18: Visueller Einrichtungs-Assistent
│   └── /[id]/articles            NEWS-8: Artikel einer Quelle (Liste/Kachel, NEWS-15)
├── /categories                   NEWS-9: Kategorien (read für User, CRUD für Admin)
└── /settings                     NEWS-12: Retention-Einstellungen (Admin-Prüfung in der Seite)

/dashboard/statistics              GEPLANT — NEWS-13 nicht implementiert, existiert nicht
```

### Middleware-Schutz
- `middleware.ts` (Projekt-Root) prüft nur, ob ein eingeloggter User existiert, für alle
  `/dashboard/*`- und `/api/*`-Routen (außer `/api/auth/*`) — kein `router`/`admin`-Check hier.
- Die Admin-Rolle (`profiles.role = 'admin'`) wird **nicht** in der Middleware geprüft, sondern
  pro Seite bzw. API-Route serverseitig (`requireAdmin()` in `src/lib/auth.ts`) und clientseitig
  in den jeweiligen Komponenten (`sources`, `categories`, Artikel-Löschung, `settings`).

---

## 5. API-Routen (Next.js App Router)

| Methode | Route | Feature | Zugriffsrecht |
|---------|-------|---------|---------------|
| POST | `/api/auth/login` | NEWS-1 | Öffentlich |
| POST | `/api/auth/logout` | NEWS-1 | User + Admin |
| POST | `/api/auth/register` | NEWS-1 | Öffentlich |
| GET | `/api/auth/me` | NEWS-1 | User + Admin |
| GET | `/api/articles` | NEWS-6 | User + Admin |
| GET | `/api/articles/[id]` | NEWS-6 | User + Admin |
| DELETE | `/api/articles/[id]` | NEWS-8 | Admin only |
| GET | `/api/sources` | NEWS-6 | User + Admin |
| POST | `/api/sources` | NEWS-2 | Admin only |
| GET | `/api/sources/[id]` | NEWS-2 | User + Admin |
| PUT | `/api/sources/[id]` | NEWS-2+10 | Admin only |
| DELETE | `/api/sources/[id]` | NEWS-2 | Admin only |
| POST | `/api/sources/[id]/scrape` | NEWS-5 | Admin only |
| GET | `/api/sources/[id]/mappings` | NEWS-10 | User + Admin |
| PUT | `/api/sources/[id]/mappings` | NEWS-10 | Admin only |
| POST | `/api/sources/detect-feeds` | NEWS-14 | Admin only |
| POST | `/api/sources/preview` | NEWS-17 | Admin only |
| POST | `/api/sources/proxy-fetch` | NEWS-16/18 | Admin only |
| GET | `/api/categories` | NEWS-9 | User + Admin |
| POST | `/api/categories` | NEWS-9 | Admin only |
| PUT | `/api/categories/[id]` | NEWS-9 | Admin only |
| DELETE | `/api/categories/[id]` | NEWS-9 | Admin only |
| GET | `/api/admin/settings` | NEWS-12 | Admin only |
| PUT | `/api/admin/settings` | NEWS-12 | Admin only |
| GET | `/api/admin/users` | — (kein Feature-Spec) | Admin only |
| GET, POST | `/api/cron/scrape` | NEWS-5 | Vercel Cron (GET für Vercel-Cron-Aufrufe, POST für manuelles Auslösen) |
| GET, POST | `/api/cron/retention` | NEWS-12 | Vercel Cron (GET für Vercel-Cron-Aufrufe, POST für manuelles Auslösen) |

> `GET /api/stats/sources` existiert **nicht** — NEWS-13 ist **GEPLANT**, nicht implementiert.
> `GET /api/admin/users` ist real vorhanden (paginierte Nutzerliste für Admins), hat aber keine
> zugehörige Feature-Spec unter `features/`.

---

## 6. Scraping-Pipeline (pro Quelle)

```
Vercel Cron → POST /api/cron/scrape
    │
    ├─ Alle aktiven Quellen laden
    │
    └─ Pro Quelle (sequenziell):
        1. Engine aufrufen
        │   ├─ RSS-Quelle → rss-parser → normalisierte Artikel
        │   └─ HTML-Quelle → cheerio → normalisierte Artikel
        │
        2. Deduplizierung
        │   └─ URLs gegen articles.url prüfen → nur neue URLs weiter
        │
        3. Sprache erkennen
        │   └─ Config-Sprache ODER franc (Auto-Detect)
        │
        4. Kategorie-Mapping (NEWS-10) — GEPLANT, NICHT implementiert
        │   └─ source_category_raw → source_category_mappings → category_id
        │      (source_category_mappings und default_category_id werden von
        │       src/lib/scraping/scheduler.ts derzeit nirgends gelesen; die
        │       Mapping-Tabelle und ihre CRUD-API existieren, die Anwendung beim
        │       Scraping fehlt)
        │
        5. Artikel in DB speichern
        │   └─ categorization_status = 'pending'
        │
        6. LLM-Kategorisierung (NEWS-11) — GEPLANT, NICHT implementiert
        │   └─ Batch à 10 Artikel → Claude Haiku API → article_categories
        │
        7. sources-Tabelle aktualisieren
            └─ last_scraped_at = now()
            └─ last_error = NULL (bei Erfolg)
```

> Schritte 4 und 6 beschreiben den Zielzustand, laufen aber heute nicht. Neue Artikel bleiben
> dauerhaft auf `categorization_status = 'pending'` ohne zugewiesene Kategorie, sofern sie nicht
> manuell kategorisiert werden.

---

## 7. Cron-Job-Zeitpläne (vercel.json)

| Job | Route | Zeitplan | Feature |
|-----|-------|----------|---------|
| Scraping | `/api/cron/scrape` | `*/15 * * * *` (alle 15 Min.) | NEWS-5 |
| Retention | `/api/cron/retention` | `0 3 * * *` (tägl. 03:00 UTC) | NEWS-12 |

> Der Scraping-Cron prüft intern welche Quellen gemäß ihrem `interval_minutes` fällig sind.

---

## 8. Komponentenstruktur (Frontend)

> Der folgende Baum ist gegen den tatsächlichen Code (2026-07-28) korrigiert. Es gibt keine
> `(auth)`-Routengruppe, kein `components/layout/`, kein `components/statistics/` und kein
> `lib/categorization/` — Datei- und Ordnernamen im Repo sind durchgehend kebab-case, nicht
> PascalCase/camelCase wie in einer früheren Version dieses Dokuments.

```
src/
├── app/
│   ├── login/page.tsx
│   ├── register/page.tsx
│   └── dashboard/
│       ├── layout.tsx            ← Sidebar + Header (geschützt durch middleware.ts)
│       ├── page.tsx              ← Redirect zu /dashboard/news
│       ├── news/page.tsx
│       ├── sources/
│       │   ├── page.tsx          ← Liste + CRUD-Dialoge (Admin-Check in der Komponente)
│       │   ├── new/visual/page.tsx   ← NEWS-18: visueller Assistent
│       │   └── [id]/articles/page.tsx
│       ├── categories/page.tsx
│       └── settings/page.tsx     ← NEWS-12: Retention-Einstellungen
│
├── components/
│   ├── ui/                       ← shadcn/ui (unverändert)
│   └── dashboard/
│       ├── header.tsx
│       ├── news/
│       │   ├── article-card.tsx
│       │   ├── article-card-skeleton.tsx
│       │   ├── article-feed.tsx
│       │   ├── article-filters.tsx
│       │   └── article-pagination.tsx
│       ├── sources/
│       │   ├── source-list.tsx
│       │   ├── source-form-dialog.tsx
│       │   ├── source-delete-dialog.tsx
│       │   ├── selector-assistant.tsx     ← NEWS-16
│       │   ├── articles/                  ← NEWS-8
│       │   │   ├── source-articles.tsx
│       │   │   ├── article-grid-card.tsx
│       │   │   ├── article-list-item.tsx
│       │   │   ├── article-delete-dialog.tsx
│       │   │   └── view-toggle.tsx        ← NEWS-15
│       │   └── wizard/                    ← NEWS-18
│       │       ├── visual-source-wizard.tsx
│       │       ├── step-url.tsx
│       │       ├── step-fields.tsx
│       │       ├── step-preview.tsx       ← NEWS-17
│       │       └── wizard-header.tsx
│       ├── categories/
│       │   ├── category-list.tsx
│       │   ├── category-form-dialog.tsx
│       │   └── category-delete-dialog.tsx
│       └── settings/
│           └── retention-settings.tsx     ← NEWS-12
│
│   (Es gibt kein components/statistics/ — NEWS-13 ist GEPLANT)
│
├── lib/
│   ├── auth.ts                   ← requireAuth() / requireAdmin()
│   ├── env.ts                    ← Startup-Validierung der Umgebungsvariablen
│   ├── rate-limit.ts
│   ├── utils.ts
│   ├── supabase/
│   │   ├── client.ts             ← Browser-Client
│   │   └── server.ts             ← Server-Client
│   ├── scraping/
│   │   ├── rss-engine.ts         ← NEWS-3
│   │   ├── html-engine.ts        ← NEWS-4
│   │   ├── scheduler.ts          ← NEWS-5
│   │   ├── feed-detector.ts      ← NEWS-14
│   │   └── index.ts
│   └── validations/
│       ├── article.ts
│       ├── category.ts
│       └── source.ts
│
│   (Es gibt kein lib/categorization/llm-categorizer.ts — NEWS-11 ist GEPLANT)
│
└── hooks/
    ├── use-articles.ts
    ├── use-persisted-view-mode.ts ← NEWS-15
    ├── use-mobile.tsx
    └── use-toast.ts

    (Es gibt kein use-sources.ts oder use-categories.ts — die Sources- und Categories-Seiten
    laden ihre Daten direkt in der jeweiligen Komponente statt über einen eigenen Hook)
```

---

## 9. Umgebungsvariablen

| Variable | Wo | Beschreibung |
|----------|----|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Supabase Projekt-URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Öffentlicher Supabase-Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Admin-Key für Cron-Jobs + Server-seitige Operationen |
| `ANTHROPIC_API_KEY` | Server only | Claude API für LLM-Kategorisierung — **GEPLANT**, wird nur deklariert (NEWS-11 nicht gebaut) |
| `CRON_SECRET` | Server only | Absicherung der Cron-Job-Endpunkte |

> Laut `src/lib/env.ts` sind nur die drei Supabase-Variablen zur Startzeit REQUIRED (fehlen →
> Absturz beim Boot via `instrumentation.ts`). `ANTHROPIC_API_KEY` und `CRON_SECRET` sind
> OPTIONAL — beim Fehlen wird nur eine Warnung geloggt, die App startet trotzdem.

---

## 10. Empfohlene Build-Reihenfolge

```
Phase 1 — Fundament
  NEWS-1  User Authentication
  NEWS-2  Quellen-Verwaltung (Basis)

Phase 2 — Daten sammeln
  NEWS-3  RSS Scraping Engine
  NEWS-4  HTML DOM Scraping Engine
  NEWS-5  Scheduler + Deduplizierung

Phase 3 — Kategorisierung
  NEWS-9  Kategorie-Verwaltung
  NEWS-10 Quellen-Erweiterungen (Slug, Basis-Kategorie, Mapping)
  NEWS-11 LLM-Kategorisierung

Phase 4 — API + UI
  NEWS-6  REST API
  NEWS-7  News Dashboard UI
  NEWS-8  Artikel-Review-Ansicht
  NEWS-13 Statistik-Dashboard

Phase 5 — Wartung (P1)
  NEWS-12 Retention Policy
```
