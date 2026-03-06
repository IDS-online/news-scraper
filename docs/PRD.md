# Product Requirements Document

## Vision
Newsgrap3r ist eine Web-Applikation, die automatisiert News-Artikel von konfigurierten Quellen (RSS/Atom-Feeds und HTML-Seiten) scraped, dedupliziert und über eine authentifizierte REST-API bereitstellt. Interne Teams und Redakteure erhalten damit einen zentralen, mehrsprachigen News-Aggregator mit Web-Dashboard zur Überwachung und Verwaltung.

## Target Users

**Primär: Interne Teams & Redakteure**
- Beobachten mehrere Nachrichtenquellen gleichzeitig
- Benötigen einen zentralen Überblick über aktuelle News in verschiedenen Sprachen
- Wollen keine manuellen Checks — alles soll automatisch aggregiert werden

**Sekundär: Entwickler / Integrationen**
- Konsumieren die News-API in eigene Systeme (Dashboards, Alerts, Bots)
- Benötigen strukturierte, authentifizierte API-Endpunkte

## Core Features (Roadmap)

| Priority | Feature | Status |
|----------|---------|--------|
| P0 (MVP) | User Authentication & Rollen | Planned |
| P0 (MVP) | News-Quellen-Verwaltung (Admin) | Planned |
| P0 (MVP) | RSS/Atom Feed Scraping Engine | Planned |
| P0 (MVP) | HTML DOM Scraping Engine | Planned |
| P0 (MVP) | Scraping Scheduler & Deduplizierung | Planned |
| P0 (MVP) | News REST API | Planned |
| P0 (MVP) | News Dashboard UI | Planned |
| P0 (MVP) | Artikel-Review-Ansicht (Quellen-Detail & Verwaltung) | Planned |

## Success Metrics
- Mindestens 10 konfigurierte News-Quellen laufen stabil ohne manuelle Eingriffe
- Scraping-Fehlerrate < 5% pro Quelle pro Tag
- API-Antwortzeit < 300ms für paginierte Abfragen
- Keine Duplikate in der Datenbank (URL-Eindeutigkeit 100%)
- Spracherkennung korrekt bei > 95% der Artikel

## Constraints
- Tech-Stack: Next.js 16, Supabase (PostgreSQL + Auth), Vercel
- Cronjobs laufen als Vercel Cron Jobs oder Supabase Edge Functions
- Kein eigener Scraping-Proxy — externe Webseiten müssen öffentlich zugänglich sein
- Team: Kleines Team, iterative Entwicklung

## Non-Goals
- Kein automatisches Kategorisieren oder KI-Zusammenfassungen von Artikeln (v1)
- Keine Mobile App (nur responsive Web)
- Kein eigener User-Self-Service für Quellen (nur Admin verwaltet Quellen)
- Kein Bezahl-/Subscription-Modell
- Kein Social-Sharing oder Kommentarfunktion
