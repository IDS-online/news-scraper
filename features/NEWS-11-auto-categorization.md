# NEWS-11: Automatische Kategorisierung via LLM

**Status:** Planned
**Priority:** P0 (MVP)
**Created:** 2026-03-06

## Dependencies
- Requires: NEWS-5 (Scraping Scheduler) — Kategorisierung läuft als Post-Processing-Schritt nach dem Scraping
- Requires: NEWS-9 (Kategorie-Verwaltung) — Kategorien mit Name + Beschreibung müssen existieren
- Requires: NEWS-10 (Quellen-Erweiterung) — Basis-Kategorie und Mapping werden vor der LLM-Kategorisierung ausgewertet

## Overview
Nach dem Scraping und der Mapping-Auflösung (NEWS-10) analysiert ein LLM (Claude API) Titel und Teaser-Text jedes neuen Artikels und weist ihm eine oder mehrere Kategorien aus dem System zu. Der Kategorie-Name und die Beschreibung (NEWS-9) dienen als Kontext für das Modell. Artikel können mehreren Kategorien zugeordnet werden. Artikel mit gesetzter Basis-Kategorie oder Mapping-Kategorie werden ebenfalls durch die LLM-Kategorisierung ergänzt (additive Logik).

## User Stories

1. Als **System** möchte ich jeden neuen Artikel automatisch durch ein LLM kategorisieren, damit keine manuelle Kategorisierung nötig ist.
2. Als **System** möchte ich dem LLM die Kategorie-Namen und Beschreibungen als Kontext mitgeben, damit es präzise Zuordnungen trifft.
3. Als **System** möchte ich, dass ein Artikel mehrere Kategorien erhalten kann, damit er in allen relevanten Bereichen gefunden wird.
4. Als **Admin** möchte ich sehen, welche Kategorien einem Artikel zugewiesen wurden, damit ich die Kategorisierungsqualität prüfen kann.
5. Als **System** möchte ich mit LLM-Fehlern und Timeouts umgehen, damit ein einzelner Fehler den gesamten Scraping-Run nicht abbricht.

## Acceptance Criteria

### Kategorisierungsablauf (pro neuem Artikel)
- [ ] Reihenfolge der Kategoriezuweisung:
  1. Mapping-Kategorien (aus NEWS-10, falls vorhanden)
  2. Basis-Kategorie der Quelle (aus NEWS-10, falls kein Mapping greift und noch keine Kategorie gesetzt)
  3. LLM-Kategorisierung (läuft immer, fügt weitere Kategorien additiv hinzu)
- [ ] Endresultat: Artikel kann 0–N Kategorien haben (Union aus allen Schritten)

### LLM-Kategorisierung
- [ ] Modell: Claude API (claude-haiku-4-5-20251001 für Kosteneffizienz)
- [ ] Input pro API-Call: Artikel-Titel + Teaser-Text + vollständige Kategorienliste (Name + Beschreibung)
- [ ] Output: Liste der zutreffenden Kategorie-Namen (JSON-Array)
- [ ] Prompt gibt explizit vor: "Weise nur Kategorien zu, die klar zutreffen. Wenn keine passt, gib ein leeres Array zurück."
- [ ] Wenn Kategorien-Liste leer ist (keine Kategorien definiert) → LLM-Schritt wird übersprungen
- [ ] Batch-Verarbeitung: bis zu 10 Artikel pro LLM-Aufruf (Kosten-Optimierung via strukturiertem Prompt)
- [ ] Kategoriezuordnung wird in Tabelle `article_categories` gespeichert (n:m Relation)

### Fehlerbehandlung
- [ ] LLM-Timeout (> 30s) → Artikel wird ohne LLM-Kategorien gespeichert, `categorization_status = 'failed'`
- [ ] LLM gibt ungültiges JSON zurück → Parsing-Fehler wird geloggt, Artikel ohne LLM-Kategorie gespeichert
- [ ] LLM gibt Kategorie zurück, die nicht im System existiert → ignoriert (Halluzination-Schutz)
- [ ] Rate-Limit der Claude API → Retry nach 60s, maximal 3 Versuche

### Status-Tracking
- [ ] Feld `categorization_status` an jedem Artikel: `pending` | `done` | `failed` | `skipped`
- [ ] `skipped` wenn keine Kategorien im System definiert sind
- [ ] Admin kann in der Artikel-Review-Ansicht (NEWS-8) den Status sehen

## Edge Cases

- Artikel hat nur Titel (kein Teaser) → LLM erhält nur den Titel, funktioniert trotzdem
- Artikel in fremder Sprache → LLM kategorisiert sprachunabhängig anhand von Kategorie-Beschreibungen
- Kategorie-Beschreibung wird nachträglich geändert → bestehende Zuordnungen bleiben, neue Artikel nutzen neue Beschreibung
- Kategorie wird gelöscht (NEWS-9) → zugehörige `article_categories`-Einträge werden via CASCADE gelöscht
- Sehr viele Kategorien (> 30) → alle werden im Prompt aufgelistet; bei > 50 Performance-Test erforderlich (v2: Chunking)
- Gleichzeitige Scraping-Jobs mehrerer Quellen → LLM-Calls laufen sequenziell im Job-Kontext, kein paralleles Overloading

## Kostenabschätzung

| Faktor | Wert |
|--------|------|
| Modell | claude-haiku-4-5-20251001 |
| Artikel/Tag (10 Quellen) | ~500 Artikel |
| Tokens/Artikel (geschätzt) | ~300 Input + ~20 Output |
| Kosten/Artikel | < $0.001 |
| Monatliche Kosten | < $15 |

## Out of Scope
- Manuelle Korrektur der LLM-Kategorisierung durch User (v2)
- Re-Kategorisierung bestehender Artikel nach Kategorie-Änderung (v2)
- Konfidenz-Score pro Kategorie-Zuordnung (v2)
- Anderes LLM als Claude (konfigurierbar) (v2)
