# Newsgrap3r – System-Architektur

> Holistische technische Architektur für alle 13 Features (NEWS-1 bis NEWS-13).
> Erstellt: 2026-03-06

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
| Kategorisierung | Anthropic Claude API (Haiku) | Kosteneffizient (~$15/Monat), strukturierter JSON-Output |
| Cronjobs | Vercel Cron Jobs | Native Vercel-Integration, kein externer Service |
| Deployment | Vercel | Nahtlose Next.js-Integration, kostenlos für MVP |
| Validierung | Zod | Typsichere Validierung auf Server und Client |
| Charts | Recharts | React-native, einfach integrierbar, kein D3-Boilerplate |

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

### Tabelle: `categories`
Vom Admin definierte Klassifizierungs-Kategorien.

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| id | uuid (PK) | — |
| name | text (unique) | Anzeigename, case-insensitive eindeutig |
| description | text | Semantischer Kontext für LLM (min. 20 Zeichen) |
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
| active | boolean | `true` = wird gescrapt |
| default_category_id | uuid (FK → categories, nullable) | Basis-Kategorie |
| retention_days | int (nullable) | Aufbewahrungsfrist; `NULL` = nie löschen |
| last_scraped_at | timestamptz (nullable) | Letzter erfolgreicher Scrape |
| last_error | text (nullable) | Letzter Fehler-Text |
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
| source_id | uuid (FK → sources, CASCADE) | Zugehörige Quelle |
| source_slug | text | Denormalisiert für schnelles Filtern |
| url | text (unique) | Artikel-URL — Basis der Deduplizierung |
| title | text | Artikel-Titel |
| description | text (nullable) | Teaser-Text |
| image_url | text (nullable) | Bild-URL von der Quelle |
| source_category_raw | text (nullable) | Rohkategorie aus dem Feed/HTML |
| language | text | Erkannter oder konfigurierter Sprachcode |
| published_at | timestamptz (nullable) | Veröffentlichungsdatum |
| categorization_status | text | `pending` / `done` / `failed` / `skipped` |
| created_at | timestamptz | Zeitpunkt des Scrapings |

### Tabelle: `article_categories`
n:m-Verknüpfung zwischen Artikeln und Kategorien.

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| article_id | uuid (FK → articles, CASCADE) | — |
| category_id | uuid (FK → categories, CASCADE) | — |
| PRIMARY KEY | (article_id, category_id) | Keine Duplikate |

### Tabelle: `system_settings`
Schlüssel-Wert-Store für globale Einstellungen (NEWS-12).

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| key | text (PK) | z.B. `retention_enabled` |
| value | text | z.B. `false` |

### Tabelle: `retention_log`
Protokoll der täglichen Löschläufe (NEWS-12).

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| id | uuid (PK) | — |
| source_id | uuid (FK → sources, nullable) | Quelle, aus der gelöscht wurde |
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
| sources | `active` | Scheduler filtert inaktive Quellen |
| article_categories | `article_id` | Kategorie-Lookup pro Artikel |
| article_categories | `category_id` | Artikel-Lookup pro Kategorie |

---

## 3. Row Level Security (RLS)

Jede Tabelle hat RLS aktiviert. Grundprinzip:

| Rolle | Lesen | Schreiben |
|-------|-------|-----------|
| Anonym (kein JWT) | Nein | Nein |
| `user` | Alle Daten | Nein |
| `admin` | Alle Daten | Alle Tabellen außer `profiles` (nur eigene) |
| Service Role (Cron/API) | Alle | Alle (via Supabase Service Key) |

---

## 4. Frontend-Seitenstruktur

```
/ (Root)
└── /login                        Öffentlich — Login-Formular
└── /register                     Öffentlich — Registrierungsformular

/dashboard                        Geschützt (alle eingeloggten User)
├── /                             → Redirect zu /dashboard/news
├── /news                         NEWS-7: News-Feed (alle Artikel, Filter)
├── /sources                      NEWS-8: Quellen-Übersicht
│   └── /[id]/articles            NEWS-8: Artikel einer Quelle (Liste/Kachel)
├── /statistics                   NEWS-13: Statistik-Dashboard
├── /categories                   NEWS-9: Kategorien (read für User, CRUD für Admin)
└── /admin                        Geschützt (nur Admin)
    ├── /sources                  NEWS-2+10: Quellen-CRUD
    │   ├── /new
    │   └── /[id]/edit
    └── /settings                 NEWS-12: Retention-Einstellungen
```

### Middleware-Schutz
- Next.js Middleware prüft Session-JWT bei allen `/dashboard/*` und `/api/*` Routen
- Admin-Routen prüfen zusätzlich `profiles.role = 'admin'`

---

## 5. API-Routen (Next.js App Router)

| Methode | Route | Feature | Zugriffsrecht |
|---------|-------|---------|---------------|
| GET | `/api/articles` | NEWS-6 | User + Admin |
| GET | `/api/articles/[id]` | NEWS-6 | User + Admin |
| DELETE | `/api/articles/[id]` | NEWS-8 | Admin only |
| GET | `/api/sources` | NEWS-6 | User + Admin |
| POST | `/api/sources` | NEWS-2 | Admin only |
| PUT | `/api/sources/[id]` | NEWS-2+10 | Admin only |
| DELETE | `/api/sources/[id]` | NEWS-2 | Admin only |
| POST | `/api/sources/[id]/scrape` | NEWS-5 | Admin only |
| GET | `/api/categories` | NEWS-9 | User + Admin |
| POST | `/api/categories` | NEWS-9 | Admin only |
| PUT | `/api/categories/[id]` | NEWS-9 | Admin only |
| DELETE | `/api/categories/[id]` | NEWS-9 | Admin only |
| GET | `/api/stats/sources` | NEWS-13 | User + Admin |
| GET | `/api/admin/settings` | NEWS-12 | Admin only |
| PUT | `/api/admin/settings` | NEWS-12 | Admin only |
| POST | `/api/cron/scrape` | NEWS-5 | Vercel Cron |
| POST | `/api/cron/retention` | NEWS-12 | Vercel Cron |

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
        4. Kategorie-Mapping (NEWS-10)
        │   └─ source_category_raw → source_category_mappings → category_id
        │
        5. Artikel in DB speichern
        │   └─ categorization_status = 'pending'
        │
        6. LLM-Kategorisierung (NEWS-11)
        │   └─ Batch à 10 Artikel → Claude Haiku API → article_categories
        │
        7. sources-Tabelle aktualisieren
            └─ last_scraped_at = now()
            └─ last_error = NULL (bei Erfolg)
```

---

## 7. Cron-Job-Zeitpläne (vercel.json)

| Job | Route | Zeitplan | Feature |
|-----|-------|----------|---------|
| Scraping | `/api/cron/scrape` | `*/15 * * * *` (alle 15 Min.) | NEWS-5 |
| Retention | `/api/cron/retention` | `0 3 * * *` (tägl. 03:00 UTC) | NEWS-12 |

> Der Scraping-Cron prüft intern welche Quellen gemäß ihrem `interval_minutes` fällig sind.

---

## 8. Komponentenstruktur (Frontend)

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   └── dashboard/
│       ├── layout.tsx            ← Sidebar + Header (geschützt)
│       ├── news/page.tsx
│       ├── sources/
│       │   ├── page.tsx
│       │   └── [id]/articles/page.tsx
│       ├── statistics/page.tsx
│       ├── categories/page.tsx
│       └── admin/
│           ├── sources/
│           │   ├── page.tsx
│           │   ├── new/page.tsx
│           │   └── [id]/edit/page.tsx
│           └── settings/page.tsx
│
├── components/
│   ├── ui/                       ← shadcn/ui (unverändert)
│   ├── layout/
│   │   ├── AppSidebar.tsx        ← Hauptnavigation
│   │   └── DashboardHeader.tsx
│   ├── news/
│   │   ├── ArticleCard.tsx       ← Kachel-/Listenansicht
│   │   ├── ArticleList.tsx
│   │   ├── ArticleFilters.tsx
│   │   └── ViewToggle.tsx        ← Liste/Kachel Toggle
│   ├── sources/
│   │   ├── SourceForm.tsx        ← Anlegen/Bearbeiten
│   │   ├── SourceTable.tsx
│   │   └── CategoryMappingTable.tsx
│   ├── categories/
│   │   └── CategoryForm.tsx
│   └── statistics/
│       ├── StatsCard.tsx
│       ├── SourceStatsTable.tsx
│       └── ArticleSparkline.tsx
│
├── lib/
│   ├── supabase.ts               ← Supabase Client
│   ├── scraping/
│   │   ├── rss-engine.ts         ← NEWS-3
│   │   └── html-engine.ts        ← NEWS-4
│   ├── categorization/
│   │   └── llm-categorizer.ts    ← NEWS-11
│   └── utils.ts
│
└── hooks/
    ├── useArticles.ts
    ├── useSources.ts
    └── useCategories.ts
```

---

## 9. Umgebungsvariablen

| Variable | Wo | Beschreibung |
|----------|----|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Supabase Projekt-URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Öffentlicher Supabase-Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Admin-Key für Cron-Jobs + Server-seitige Operationen |
| `ANTHROPIC_API_KEY` | Server only | Claude API für LLM-Kategorisierung |
| `CRON_SECRET` | Server only | Absicherung der Cron-Job-Endpunkte |

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
