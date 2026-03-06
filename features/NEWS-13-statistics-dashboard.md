# NEWS-13: Statistik-Dashboard (Quellen-Übersicht & Verlauf)

**Status:** Planned
**Priority:** P0 (MVP)
**Created:** 2026-03-06

## Dependencies
- Requires: NEWS-1 (User Authentication) — eingeloggte User
- Requires: NEWS-2 (News-Quellen-Verwaltung) — Quellen müssen im System existieren
- Requires: NEWS-5 (Scraping Scheduler) — Artikel müssen vorhanden sein

## Overview
Ein dediziertes Statistik-Dashboard, das auf einen Blick zeigt, wie aktiv jede Newsquelle ist. Pro Quelle werden absolute Artikel-Zahlen (Gesamt, aktueller Monat, aktuelle KW, letzte 2 KW) sowie ein Verlaufsdiagramm der letzten Wochen angezeigt. Das Dashboard dient zur Systemüberwachung und hilft, inaktive oder fehlerhafte Quellen schnell zu erkennen.

## User Stories

1. Als **eingeloggter User** möchte ich auf einen Blick sehen, wie viele Artikel jede Quelle insgesamt geliefert hat, damit ich die Produktivität der Quellen vergleichen kann.
2. Als **eingeloggter User** möchte ich die Artikel-Anzahl pro Quelle für die aktuelle und die letzten zwei Kalenderwochen sehen, damit ich Trends und Ausreißer erkennen kann.
3. Als **eingeloggter User** möchte ich die monatliche Artikel-Gesamtzahl pro Quelle sehen, damit ich den Monatsverlauf nachvollziehen kann.
4. Als **eingeloggter User** möchte ich eine Verlaufsgrafik pro Quelle sehen, damit ich auf einen Blick erkenne ob die Quelle regelmäßig Artikel liefert oder Lücken hat.
5. Als **eingeloggter User** möchte ich auf eine Quelle klicken und zur Artikel-Review-Ansicht (NEWS-8) wechseln, damit ich von den Statistiken direkt in die Inhalte navigieren kann.

## Acceptance Criteria

### Seite `/dashboard/statistics`

#### Kopfbereich (Gesamtübersicht)
- [ ] Kennzahlen-Kacheln (Summary Cards):
  - Gesamtanzahl Artikel im System
  - Artikel in der aktuellen Kalenderwoche
  - Artikel im aktuellen Monat
  - Anzahl aktiver Quellen
- [ ] Zeitpunkt des letzten Scraping-Runs (systemweit)

#### Quellen-Tabelle
- [ ] Eine Zeile pro Newsquelle, sortierbar nach: Name, Gesamt, KW aktuell, Monat gesamt
- [ ] Spalten:
  | Spalte | Inhalt |
  |--------|--------|
  | Quelle | Name + Typ-Icon (RSS/HTML) + Aktiv-Status |
  | KW aktuell | Artikel-Anzahl der laufenden Kalenderwoche |
  | KW -1 | Artikel-Anzahl der letzten Kalenderwoche |
  | KW -2 | Artikel-Anzahl der vorletzten Kalenderwoche |
  | Monat gesamt | Artikel-Anzahl im aktuellen Kalendermonat |
  | Gesamt | Alle Artikel dieser Quelle in der DB |
  | Trend | Mini-Sparkline (letzte 8 Wochen) |
  | Letzter Scrape | Zeitstempel + Fehler-Badge falls `last_error` gesetzt |
- [ ] Zeilen mit `last_error` sind visuell hervorgehoben (roter Rand oder Warnsymbol)
- [ ] Klick auf eine Zeile → Navigation zu `/dashboard/sources/[id]/articles` (NEWS-8)

#### Verlaufsgrafik (Detail-Expand oder Modal)
- [ ] Klick auf die Sparkline oder ein "Details"-Button öffnet eine größere Verlaufsgrafik für diese Quelle
- [ ] Balkendiagramm: X-Achse = Kalenderwochen (letzte 12 Wochen), Y-Achse = Artikel-Anzahl
- [ ] Nullwochen (keine Artikel) werden als leere Balken dargestellt (nicht ausgelassen)
- [ ] Hover-Tooltip: KW + Jahr + Anzahl Artikel

#### Aktualisierung
- [ ] Daten werden beim Laden der Seite frisch aus der DB abgefragt (kein Cache)
- [ ] Manueller "Aktualisieren"-Button zum Reload ohne Seitennavigation

### Allgemein
- [ ] Responsive: Tabelle auf Mobile scrollbar (horizontal), Sparklines vereinfacht
- [ ] Lade-Skeleton während Daten geladen werden
- [ ] Leerer Zustand: "Noch keine Artikel im System" wenn 0 Artikel vorhanden
- [ ] Navigation: Eigener Menüpunkt "Statistiken" im Dashboard-Sidebar

## Kalenderwoche-Definition
- Kalenderwochen nach ISO 8601 (Montag = erster Wochentag)
- "KW aktuell" = die laufende KW zum Zeitpunkt des Seitenaufrufs
- "KW -1" = die abgeschlossene Woche davor
- "KW -2" = die Woche vor KW -1

## Edge Cases

- Quelle hat in einer KW 0 Artikel → Spalte zeigt "0" (nicht leer)
- Neue Quelle (< 1 Woche alt) → alle KW-Spalten zeigen 0 oder tatsächliche Zahlen, kein Fehler
- Quelle ist deaktiviert → wird trotzdem in der Tabelle angezeigt, visuell als "Inaktiv" markiert
- System hat 0 Quellen → leerer Zustand mit CTA "Erste Quelle anlegen" (nur Admin)
- Sehr viele Quellen (> 50) → Tabelle paginiert (25 pro Seite) oder scrollbar ohne Paginierung
- Verlaufsgrafik für Quelle mit wenigen Daten (< 4 Wochen) → Diagramm zeigt verfügbare Wochen, fehlende als 0

## Abgrenzung zu bestehenden Features

| Feature | Fokus |
|---------|-------|
| NEWS-7 (News Dashboard) | Artikel lesen und filtern |
| NEWS-8 (Artikel-Review) | Einzelartikel pro Quelle kontrollieren + löschen |
| **NEWS-13 (Statistiken)** | Systemüberwachung: Zahlen, Trends, Quellen-Gesundheit |

## Out of Scope
- Statistiken pro Kategorie (v2)
- Export als CSV oder PDF (v2)
- E-Mail-Report mit Wochenstatistiken (v2)
- Vergleich zwischen zwei Quellen nebeneinander (v2)
- Echtzeit-Updates via WebSocket (v2 — Polling mit manuellem Reload reicht für v1)
