# NEWS-10: Quellen-Erweiterung (Slug, Basis-Kategorie & Kategorie-Mapping)

**Status:** In Progress
**Priority:** P0 (MVP)
**Created:** 2026-03-06

## Dependencies
- Requires: NEWS-1 (User Authentication) — nur Admins konfigurieren Quellen
- Requires: NEWS-2 (News-Quellen-Verwaltung) — erweitert das Quellen-Formular
- Requires: NEWS-9 (Kategorie-Verwaltung) — Kategorien müssen existieren, um zugewiesen zu werden

## Overview
Das Quellen-Formular (NEWS-2) wird um drei Felder erweitert:
1. **Slug** — ein manuell vergebbarer, URL-sicherer Bezeichner für die Quelle (z.B. `heise-online`), der mit jedem gescrapten Artikel gespeichert wird.
2. **Basis-Kategorie** — eine Standard-Kategorie, die allen Artikeln dieser Quelle als Ausgangskategorie zugewiesen wird, wenn keine spezifischere Zuordnung greift.
3. **Quellen-Kategorie-Mapping** — eine Zuordnungstabelle: welche Kategorie der Quelle entspricht welcher unserer Kategorien (z.B. Quellen-Kategorie "Tech" → unsere Kategorie "Technologie").

## User Stories

1. Als **Admin** möchte ich einer Quelle einen Slug vergeben, damit Artikel eindeutig einer Quelle zugeordnet und über den Slug identifiziert werden können.
2. Als **Admin** möchte ich einer Quelle eine Basis-Kategorie zuweisen, damit alle Artikel dieser Quelle standardmäßig dieser Kategorie zugeordnet werden.
3. Als **Admin** möchte ich Kategorie-Mappings für eine Quelle definieren, damit aus der Quelle gescrapte Kategorien auf unsere Kategorien übersetzt werden.
4. Als **System** möchte ich den Slug der Quelle mit jedem Artikel speichern, damit Artikel nach Quellenbezeichner filterbar sind.
5. Als **System** möchte ich bei gescrapten Artikeln die Quellen-Kategorie anhand des Mappings in unsere Kategorie übersetzen.

## Acceptance Criteria

### Slug
- [ ] Neues Pflichtfeld im Quellen-Formular: "Slug" (Text, max. 80 Zeichen)
- [ ] Slug muss URL-sicher sein: nur Kleinbuchstaben, Zahlen, Bindestriche (Regex: `^[a-z0-9-]+$`)
- [ ] Slug wird automatisch aus dem Quellen-Namen vorausgefüllt (Leerzeichen → `-`, Sonderzeichen entfernt), aber ist manuell editierbar
- [ ] Slug muss projektweit eindeutig sein
- [ ] Slug wird im `articles`-Datensatz als `source_slug` gespeichert (zusätzlich zur `source_id`)

### Basis-Kategorie
- [ ] Optionales Dropdown-Feld im Quellen-Formular: "Basis-Kategorie"
- [ ] Dropdown listet alle in NEWS-9 definierten Kategorien
- [ ] Auswahl "Keine" möglich (kein Default)
- [ ] Die Basis-Kategorie wird bei der Kategorisierung (NEWS-11) als Fallback verwendet, wenn weder Mapping noch KI eine Kategorie liefert

### Quellen-Kategorie-Mapping
- [ ] Abschnitt "Kategorie-Mapping" im Quellen-Formular (nur sichtbar wenn Typ = HTML oder RSS mit Kategorie-Feld)
- [ ] Dynamische Tabelle: Admin kann beliebig viele Zeilen hinzufügen
- [ ] Jede Zeile: Quellen-Kategorie (Freitext, z.B. `Tech`, `Wirtschaft`) → Unsere Kategorie (Dropdown aus NEWS-9)
- [ ] Mehrere Quellen-Kategorien können auf dieselbe unserer Kategorien gemappt werden
- [ ] Mappings werden in eigener Tabelle `source_category_mappings` gespeichert (nicht als JSON-Feld)
- [ ] Beim Scraping: gescrapte Kategorie (aus RSS `<category>` oder HTML-Selektor) wird gegen Mapping geprüft → bei Treffer wird die gemappte Kategorie zugewiesen

### Scraping-Integration
- [ ] RSS-Scraper (NEWS-3) extrahiert `<category>`-Tags aus Feed-Einträgen und speichert sie als `source_category_raw`
- [ ] HTML-Scraper (NEWS-4) erhält optionalen Selektor `selector_category` für Quellen mit eigenem Kategorie-Element
- [ ] Mapping-Auflösung passiert im Scheduler (NEWS-5) nach dem Scraping, vor dem Speichern

## Edge Cases

- Slug bereits vergeben → Fehlermeldung "Slug 'X' ist bereits in Verwendung"
- Basis-Kategorie wird gelöscht (in NEWS-9) → Quellen-Referenz wird auf NULL gesetzt, kein Fehler
- Kategorie-Mapping verweist auf gelöschte Kategorie → Mapping wird beim Auflösen ignoriert, Log-Warnung
- Gescrapte Quellen-Kategorie ist leer oder fehlt → Mapping-Schritt wird übersprungen, Basis-Kategorie greift
- Quellen-Kategorie im Feed entspricht keinem Mapping-Eintrag → keine Mapping-Zuweisung, Basis-Kategorie als Fallback
- Slug-Vorausfüllung aus Namen bei Sonderzeichen (Umlaute ä→ae, ö→oe, ü→ue, ß→ss)
- Quelle ohne Slug (Altdaten) → `source_slug` = NULL in `articles`, kein Crash

## Out of Scope
- Automatisches Erkennen der Quellen-Kategorien ohne Konfiguration
- Slug nachträglich ändern ohne Auswirkung auf bestehende Artikel (Slug-Change ist breaking — muss bewusst gemacht werden)
- Mapping via Regex-Pattern statt exaktem String-Match (v2)

---

## Tech Design (Solution Architect)

**Tabellen-Erweiterungen an `sources`:** `slug` (unique text), `default_category_id` (FK → categories, nullable), `selector_category` (nullable), `retention_days` (nullable int)

**Neue Tabelle:** `source_category_mappings` (id, source_id, source_category_raw, category_id)

**Frontend:** Erweiterung des bestehenden Quellen-Formulars (NEWS-2) um die drei neuen Abschnitte. Kategorie-Mapping als dynamische Zeilen-Tabelle (`FieldArray` via react-hook-form).

**Slug-Autogenerierung:** Client-seitige Funktion: Quellen-Name → Kleinbuchstaben, Leerzeichen → `-`, Umlaute umschreiben, Sonderzeichen entfernen. Manuell überschreibbar.

**Mapping-Auflösung:** Im Scheduler (NEWS-5) nach dem Scraping — `source_category_raw` des Artikels gegen `source_category_mappings` matchen → `article_categories` befüllen.

**Neue Packages:** Keine



artikel
teasertitel
teasertext
teasertext
spitzmarketeaser