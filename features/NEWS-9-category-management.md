# NEWS-9: Kategorie-Verwaltung

**Status:** Planned
**Priority:** P0 (MVP)
**Created:** 2026-03-06

## Dependencies
- Requires: NEWS-1 (User Authentication) — nur Admins können Kategorien anlegen/bearbeiten/löschen

## Overview
Admins können Kategorien definieren, mit denen News-Artikel klassifiziert werden. Jede Kategorie hat einen Namen und eine Beschreibung. Die Beschreibung dient als semantischer Kontext für die automatische KI-Kategorisierung (NEWS-11) und für manuelle Zuordnungen. Normale User können Kategorien einsehen, aber nicht verwalten.

## User Stories

1. Als **Admin** möchte ich eine neue Kategorie mit Name und Beschreibung anlegen, damit Artikel automatisch dieser Kategorie zugeordnet werden können.
2. Als **Admin** möchte ich eine Kategorie bearbeiten können, damit ich Name oder Beschreibung anpassen kann.
3. Als **Admin** möchte ich eine Kategorie löschen können, damit veraltete Kategorien entfernt werden.
4. Als **Admin** möchte ich alle Kategorien in einer Übersicht sehen, inkl. Anzahl der zugeordneten Artikel.
5. Als **User** möchte ich die Kategorien-Liste einsehen, damit ich weiß, welche Kategorien im System definiert sind.

## Acceptance Criteria

- [ ] Formular: Name (Pflichtfeld), Beschreibung (Pflichtfeld, Freitext, min. 20 Zeichen)
- [ ] Name muss projektweit eindeutig sein (case-insensitive)
- [ ] Kategorien-Übersicht zeigt: Name, Beschreibung (gekürzt), Anzahl zugeordneter Artikel, Aktionen (Bearbeiten / Löschen)
- [ ] Löschen einer Kategorie mit zugeordneten Artikeln → Warnung: "X Artikel sind dieser Kategorie zugeordnet. Kategorie trotzdem löschen?" (Artikel verlieren diese Kategorie, werden nicht gelöscht)
- [ ] Nur Nutzer mit Rolle `admin` können Kategorien anlegen/bearbeiten/löschen
- [ ] Normale User sehen Kategorien read-only
- [ ] Navigation: Eigener Menüpunkt "Kategorien" im Dashboard-Sidebar (für alle User sichtbar, Edit-Funktionen nur für Admin)

## Beispiele für gute Beschreibungen

Die Beschreibung ist der wichtigste Input für die KI-Kategorisierung. Sie sollte enthalten:
- Worum es thematisch geht
- Welche Unterthemen dazugehören
- Welche Begriffe typisch sind

**Gut:** "Artikel über Dentaltechnik, Zahnarztpraxen, Dentalimplantate, Zahnmedizin, Zahntechnik, dentale KI-Lösungen und Dentalindustrie."
**Schlecht:** "Zahnsachen"

## Edge Cases

- Name bereits vergeben → Fehlermeldung "Kategorie 'X' existiert bereits"
- Beschreibung zu kurz (< 20 Zeichen) → Validierungsfehler mit Hinweis auf Wichtigkeit für KI-Kategorisierung
- Letzte verbleibende Kategorie löschen → erlaubt (System funktioniert auch ohne Kategorien)
- Kategorie wird gelöscht während ein Scraping-Job läuft → Kategorie-Zuordnung in laufendem Job schlägt still fehl, kein Crash
- Sehr viele Kategorien (> 50) → Liste ist scrollbar, kein Pager nötig in v1

## Out of Scope
- Kategorie-Hierarchien / Unterkategorien (v2)
- Kategorie-Icons oder Farben (v2)
- Kategorien für User-Self-Service sichtbar machen (nur intern)
- Manuelle Kategorie-Zuweisung an einzelne Artikel (v2)
