# NEWS-8: Artikel-Review-Ansicht (Quellen-Detail & Verwaltung)

**Status:** Planned
**Priority:** P0 (MVP)
**Created:** 2026-03-06

## Dependencies
- Requires: NEWS-1 (User Authentication) — eingeloggte User / Admin-Rolle
- Requires: NEWS-2 (News-Quellen-Verwaltung) — Quellen-Liste als Einstiegspunkt
- Requires: NEWS-5 (Scraping Scheduler) — Artikel müssen in der DB vorhanden sein
- Requires: NEWS-6 (News REST API) — Artikel und Quellen werden über die API geladen

## Overview
Eine quellenspezifische Review-Ansicht, die es Nutzern ermöglicht, die gescrappten Artikel einer einzelnen Quelle zur Kontrolle zu inspizieren. Die Ansicht bietet zwei Darstellungsmodi (Liste / Kachel) und erlaubt Admins, einzelne Artikel zu löschen. Bilder werden direkt von der ursprünglichen Quell-URL geladen und angezeigt.

## User Stories

1. Als **eingeloggter User** möchte ich eine Übersicht aller Newsquellen sehen, damit ich eine Quelle zur Kontrolle auswählen kann.
2. Als **eingeloggter User** möchte ich in eine Quelle klicken und alle dazugehörigen Artikel sehen, damit ich das Scraping-Ergebnis prüfen kann.
3. Als **eingeloggter User** möchte ich zwischen Listen- und Kachelansicht umschalten können, damit ich die für mich passende Darstellung wählen kann.
4. Als **eingeloggter User** möchte ich pro Artikel einen direkten Link zur Originalseite haben, damit ich den Artikel vollständig lesen kann.
5. Als **Admin** möchte ich einzelne Artikel löschen können, damit ich fehlerhafte oder unerwünschte Artikel aus der Datenbank entfernen kann.
6. Als **eingeloggter User** möchte ich das Artikel-Bild sehen, damit ich auf einen Blick erkenne, worum es im Artikel geht.

## Acceptance Criteria

### Quellen-Übersicht (`/dashboard/sources`)
- [ ] Liste aller konfigurierten Newsquellen (Name, Typ, Sprache, letzter Scrape, Artikel-Anzahl)
- [ ] Jede Quelle ist klickbar und führt zur Quellen-Detailansicht
- [ ] Deaktivierte Quellen sind visuell gekennzeichnet (z.B. ausgegraut)

### Quellen-Detailansicht (`/dashboard/sources/[id]/articles`)
- [ ] Zeigt alle Artikel der gewählten Quelle (paginiert, neueste zuerst)
- [ ] Toggle-Button in der Toolbar: **Listenansicht** ↔ **Kachelansicht**
- [ ] Auswahl wird im `localStorage` gespeichert (bleibt beim Reload erhalten)

### Listenansicht
- [ ] Jede Zeile zeigt: Thumbnail (60×60px), Überschrift, Teaser-Text (max. 2 Zeilen), Datum, Link-Icon
- [ ] Link-Icon öffnet Originalseite in neuem Tab
- [ ] Admin sieht zusätzlich: Löschen-Button (Papierkorb-Icon) am Ende der Zeile

### Kachelansicht
- [ ] Grid: 3 Spalten Desktop, 2 Spalten Tablet, 1 Spalte Mobile
- [ ] Pro Kachel: Bild oben (16:9, `object-fit: cover`), darunter Headline, darunter Teaser-Text (max. 3 Zeilen), ganz unten Datum + Link
- [ ] Bild ist das dominante Element: mindestens 60% der Kachel-Höhe
- [ ] Kein Bild vorhanden → Placeholder mit Quellen-Name oder neutralem Icon
- [ ] Admin sieht Löschen-Button als Icon-Overlay oben rechts auf der Kachel (erscheint beim Hover)

### Bilder
- [ ] Bild-URL wird direkt aus der Datenbank (`articles.image_url`) geladen
- [ ] Wenn `image_url` leer oder Bild lädt nicht → Placeholder anzeigen (kein gebrochenes Bild-Icon)
- [ ] Bilder werden lazy-geladen (`loading="lazy"`)

### Artikel löschen (nur Admin)
- [ ] Klick auf Löschen-Button → Bestätigungsdialog: "Artikel löschen? Diese Aktion kann nicht rückgängig gemacht werden."
- [ ] Bestätigt → Artikel wird aus der DB gelöscht, verschwindet aus der Liste ohne Seiten-Reload
- [ ] Normale User sehen keinen Löschen-Button

### Allgemein
- [ ] Breadcrumb-Navigation: Dashboard → Quellen → [Quellenname]
- [ ] Lade-Skeleton während Artikel geladen werden
- [ ] Fehlermeldung wenn API nicht erreichbar
- [ ] Leerer Zustand: "Noch keine Artikel für diese Quelle" wenn 0 Artikel vorhanden

## Edge Cases

- Quelle hat 0 Artikel (noch nie gescrapt oder alle gelöscht) → Empty State mit CTA "Jetzt scrapen" (nur Admin)
- Bild-URL zeigt auf nicht mehr erreichbare Ressource (404) → Placeholder greift via `onError` Handler
- Admin löscht letzten Artikel einer Quelle → Empty State erscheint direkt
- Sehr langer Artikel-Titel (> 100 Zeichen) → Text-Truncation mit Ellipsis, voller Text als `title`-Attribut
- Viele Artikel (> 500) → Pagination (50 pro Seite) verhindert Performance-Probleme
- User öffnet `/dashboard/sources/[id]/articles` mit ungültiger Quelle-ID → 404-Seite
- Normaler User versucht DELETE-API-Endpunkt direkt aufzurufen → 403 Forbidden

## Abgrenzung zu NEWS-7

| Aspekt | NEWS-7 (News Dashboard) | NEWS-8 (Artikel-Review) |
|--------|------------------------|------------------------|
| Ziel | Alle News im Überblick lesen | Scraping-Ergebnis pro Quelle kontrollieren |
| Navigation | Nach Datum / Sprache / Quelle filtern | Direkt in eine Quelle hineingehen |
| Bilder | Optional / nicht primär | Zentral (Kachelansicht) |
| Löschen | Nein | Ja (nur Admin) |
| Ansichtsmodi | Nur Liste | Liste + Kachel |

## Out of Scope
- Artikel bearbeiten oder Inhalt korrigieren (nur löschen)
- Bulk-Delete (mehrere Artikel gleichzeitig)
- Artikel als "geprüft" markieren (v2)
- Export der Artikel-Liste als CSV (v2)
