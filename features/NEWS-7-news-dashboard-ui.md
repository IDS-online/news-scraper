# NEWS-7: News Dashboard UI

**Status:** Planned
**Priority:** P0 (MVP)
**Created:** 2026-03-05

## Dependencies
- Requires: NEWS-1 (User Authentication) — Login-geschütztes Dashboard
- Requires: NEWS-6 (News REST API) — Artikel werden über die API geladen
- Requires: NEWS-2 (News-Quellen-Verwaltung) — Quellen-Verwaltung ist Teil des Dashboards (Admin)

## Overview
Ein Web-Dashboard mit News-Feed, Filteroptionen und Admin-Bereich zur Quellen-Verwaltung. Normale User sehen den News-Feed mit Filter- und Suchmöglichkeiten. Admins haben zusätzlich Zugriff auf die Quellen-Verwaltung (aus NEWS-2) integriert in die Navigation.

## User Stories

1. Als **eingeloggter User** möchte ich auf einer Übersichtsseite alle aktuellen News sehen, damit ich schnell informiert bin.
2. Als **eingeloggter User** möchte ich Artikel nach Quelle, Sprache und Datum filtern können, damit ich relevante News finde.
3. Als **eingeloggter User** möchte ich nach News suchen (Volltextsuche im Titel), damit ich gezielt Artikel finde.
4. Als **eingeloggter User** möchte ich auf einen Artikel klicken und zur Originalseite weitergeleitet werden.
5. Als **eingeloggter User** möchte ich infinite scroll oder Pagination nutzen, damit ich ältere Artikel laden kann.
6. Als **Admin** möchte ich im Dashboard die Quellen-Verwaltung aufrufen, damit ich Quellen direkt aus dem Dashboard heraus verwalten kann.
7. Als **User** möchte ich den Scraping-Status (letzter Scrape, Fehler) pro Quelle sehen, damit ich weiß ob das System korrekt arbeitet.

## Acceptance Criteria

### News Feed (alle User)
- [ ] `/dashboard` — Haupt-News-Feed mit Artikel-Liste
- [ ] Artikel-Karte zeigt: Titel, Quelle, Sprache-Badge, Datum, Teaser-Text (falls vorhanden)
- [ ] Filter-Leiste: Dropdown Quelle, Dropdown Sprache, Datums-Range-Picker
- [ ] Suchfeld (Debounce 300ms) filtert nach Titel
- [ ] Pagination (20 Artikel pro Seite) oder Infinite Scroll
- [ ] Lade-Skeleton während API-Request
- [ ] Fehlermeldung wenn API nicht erreichbar
- [ ] Leerer Zustand: "Noch keine Artikel vorhanden" wenn keine Ergebnisse
- [ ] Artikel-Link öffnet in neuem Tab

### Admin-Bereich (nur Admin)
- [ ] Navigation zeigt "Quellen" nur für Admins
- [ ] `/dashboard/sources` — Quellen-Liste mit Status (letzte Scraping-Zeit, Fehler-Indikator)
- [ ] `/dashboard/sources/new` — Neue Quelle anlegen (Formular aus NEWS-2)
- [ ] `/dashboard/sources/[id]/edit` — Quelle bearbeiten
- [ ] Manueller "Jetzt scrapen"-Button pro Quelle → ruft `POST /api/sources/[id]/scrape` auf

### Layout
- [ ] Responsive: Mobile (375px), Tablet (768px), Desktop (1440px)
- [ ] Sidebar-Navigation auf Desktop, Hamburger-Menü auf Mobile
- [ ] Header mit Nutzer-Avatar/Name und Logout-Button
- [ ] Nur shadcn/ui Komponenten (Button, Card, Badge, Input, Select, Table, Tabs, Sidebar)

## Edge Cases

- User öffnet `/dashboard` ohne Login → Weiterleitung zu `/login`
- Admin öffnet `/dashboard/sources` als normaler User → 403-Seite oder Redirect
- Suche gibt 0 Ergebnisse → Empty-State "Keine Artikel gefunden für ..."
- Quelle hat `last_error` gesetzt → rotes Fehler-Badge neben Quellen-Name
- Sehr langer Artikel-Titel → Text-Truncation mit Ellipsis
- Netzwerkfehler beim manuellen Scrape-Trigger → Toast-Fehlermeldung

## Out of Scope
- Artikel als "gelesen" markieren (v2)
- Favoriten / Bookmarks (v2)
- Push-Benachrichtigungen bei neuen Artikeln (v2)
- Dark Mode (v2)
- Mehrsprachige UI (die UI ist auf Deutsch/Englisch, die NEWS sind mehrsprachig)
