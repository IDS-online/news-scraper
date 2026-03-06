# NEWS-2: News-Quellen-Verwaltung (Admin)

**Status:** Planned
**Priority:** P0 (MVP)
**Created:** 2026-03-05

## Dependencies
- Requires: NEWS-1 (User Authentication) — nur Admins können Quellen verwalten

## Overview
Admins können News-Quellen (URLs) anlegen, bearbeiten, deaktivieren und löschen. Jede Quelle hat einen Typ (RSS oder HTML), eine konfigurierte Sprache, ein Scraping-Intervall und — bei HTML-Quellen — CSS-Selektoren für die Inhalte. Normale User sehen die Quellen-Liste (read-only).

## User Stories

1. Als **Admin** möchte ich eine neue News-Quelle anlegen können, damit der Scraper sie abfragen kann.
2. Als **Admin** möchte ich eine Quelle bearbeiten können, damit ich Intervall, Sprache oder Selektoren anpassen kann.
3. Als **Admin** möchte ich eine Quelle deaktivieren können, ohne sie zu löschen, damit Scraping pausiert werden kann.
4. Als **Admin** möchte ich eine Quelle löschen können, damit sie dauerhaft entfernt wird (inkl. Option ob zugehörige Artikel gelöscht werden).
5. Als **Admin** möchte ich alle konfigurierten Quellen in einer Übersicht sehen, inkl. Status (aktiv/inaktiv) und letztem erfolgreichen Scrape.
6. Als **User** möchte ich die Quellen-Liste lesen können, damit ich weiß, welche Quellen aktiv sind.

## Acceptance Criteria

- [ ] Admin-Formular: Name, URL, Typ (RSS/HTML), Sprache (Dropdown), Intervall in Minuten, CSS-Selektoren (nur bei HTML)
- [ ] Pflichtfelder: Name, URL, Typ, Intervall
- [ ] URL muss gültiges HTTP/HTTPS-Format haben
- [ ] Intervall: Mindestwert 5 Minuten
- [ ] CSS-Selektoren (HTML-Typ): Felder für Artikel-Container, Titel, Link, Beschreibung/Teaser, Datum (optional)
- [ ] Sprache: Dropdown mit Sprachcodes (de, en, fr, es, ...) + Option "Auto-Detect"
- [ ] Quelle kann aktiviert / deaktiviert werden (Toggle)
- [ ] Quellen-Liste zeigt: Name, URL, Typ, Sprache, Intervall, Aktiv-Status, letzter Scrape
- [ ] Nur Nutzer mit Rolle `admin` können Quellen anlegen/bearbeiten/löschen
- [ ] Normale User sehen die Liste (read-only), kein Zugriff auf Formulare

## Edge Cases

- URL bereits als andere Quelle konfiguriert → Warnung, aber kein harter Block (gleiche URL könnte in anderem Kontext sinnvoll sein)
- Quelle wird gelöscht → System fragt: "Zugehörige Artikel ebenfalls löschen?" (mit Hinweis auf Datenverlust)
- CSS-Selektor bei RSS-Typ ausgefüllt → ignoriert, keine Fehlermeldung
- Intervall unter 5 Minuten → Validierungsfehler "Mindestintervall ist 5 Minuten"
- Sehr lange URL (> 2000 Zeichen) → Fehlermeldung
- Deaktivierte Quelle wird vom Scheduler ignoriert

## Out of Scope
- User-seitiges Anlegen von Quellen (nur Admin)
- Import/Export von Quellen als CSV
- Quellen-Gruppen oder Tags (v2)

---

## Tech Design (Solution Architect)

**Tabelle:** `sources` — enthält alle Quellen-Konfigurationen inkl. CSS-Selektoren und später Slug/Retention (NEWS-10/12).

**API-Routen:** `POST/GET /api/sources`, `GET/PUT/DELETE /api/sources/[id]` (Admin-only für Schreiben)

**Frontend:** `/dashboard/admin/sources` (Liste + CRUD), Formular mit konditionellen Feldern (CSS-Selektoren nur bei Typ HTML)

**RLS:** Lesen für alle eingeloggten User. Schreiben nur für `admin`-Rolle.

**Validierung:** Zod-Schema auf Server (URL-Format, Intervall ≥ 5, CSS-Selector-Felder nur bei HTML-Typ)

**Neue Packages:** Keine
