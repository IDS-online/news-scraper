# NEWS-12: Automatische Artikel-Löschung (Retention Policy)

**Status:** Planned
**Priority:** P1 (nach MVP)
**Created:** 2026-03-06

## Dependencies
- Requires: NEWS-2 (News-Quellen-Verwaltung) — Retention-Einstellungen werden pro Quelle konfiguriert
- Requires: NEWS-5 (Scraping Scheduler) — Lösch-Job läuft als separater Cron-Job

## Overview
Admins können pro Newsquelle eine Aufbewahrungsfrist (Retention Period) in Tagen festlegen. Ein täglicher Cron-Job löscht automatisch alle Artikel, deren `published_at`-Datum die konfigurierte Frist überschreitet. Die gesamte Funktion hat einen globalen Ein-/Ausschalter, mit dem sie systemweit deaktiviert werden kann — unabhängig von den Einstellungen der einzelnen Quellen.

## User Stories

1. Als **Admin** möchte ich pro Newsquelle eine Aufbewahrungsfrist in Tagen konfigurieren, damit ich den Speicherbedarf pro Quelle steuern kann.
2. Als **Admin** möchte ich die automatische Löschung systemweit ein- und ausschalten, damit ich die Funktion kontrolliert aktivieren kann ohne Quellen-Konfigurationen zu verlieren.
3. Als **System** möchte ich einmal täglich Artikel löschen, die älter als die konfigurierte Frist sind, damit die Datenbank nicht unbegrenzt wächst.
4. Als **Admin** möchte ich sehen, wie viele Artikel beim letzten Löschlauf entfernt wurden, damit ich die Auswirkungen nachvollziehen kann.
5. Als **Admin** möchte ich für eine Quelle festlegen können, dass Artikel dieser Quelle nie automatisch gelöscht werden, damit ich wichtige Quellen dauerhaft archivieren kann.

## Acceptance Criteria

### Quellen-Konfiguration (Erweiterung NEWS-2-Formular)
- [ ] Neues optionales Feld im Quellen-Formular: "Aufbewahrungsfrist" (Zahl in Tagen)
- [ ] Optionen: Freitext (Ganzzahl, min. 1) oder Toggle "Nie löschen" (= kein Ablauf)
- [ ] Standard: "Nie löschen" (kein Default-Wert, explizite Entscheidung nötig)
- [ ] Mindestfrist: 7 Tage (Validierungsfehler bei < 7)
- [ ] Beispielwerte als Hint: 30 Tage, 90 Tage, 365 Tage

### Globaler Schalter (System-Einstellungen)
- [ ] Eigene Einstellungsseite oder Abschnitt in den Admin-Einstellungen: "Automatische Artikel-Löschung"
- [ ] Toggle: Aktiviert / Deaktiviert (Standard: **Deaktiviert**)
- [ ] Wenn deaktiviert: Cron-Job läuft nicht, keine Artikel werden gelöscht, Quellen-Konfigurationen bleiben erhalten
- [ ] Statusanzeige: "Zuletzt ausgeführt: [Datum]" und "Gelöscht beim letzten Lauf: X Artikel"

### Lösch-Cron-Job
- [ ] Läuft einmal täglich (z.B. 03:00 UTC)
- [ ] Job prüft globalen Schalter — wenn deaktiviert: sofortiger Exit ohne Aktion
- [ ] Pro Quelle mit konfigurierter Frist: `DELETE FROM articles WHERE source_id = ? AND published_at < now() - interval '[n] days'`
- [ ] Quellen mit "Nie löschen" werden übersprungen
- [ ] Nach dem Lauf: Anzahl gelöschter Artikel pro Quelle wird geloggt
- [ ] Gesamtanzahl gelöschter Artikel wird in `retention_log`-Tabelle gespeichert (Datum, Quelle, Anzahl)
- [ ] Fehler bei einer Quelle brechen den Job nicht ab — restliche Quellen werden weiter verarbeitet

### Sicherheitsmechanismen
- [ ] Mindestfrist 7 Tage verhindert versehentliches sofortiges Löschen
- [ ] Kein Lösch-Job wenn globaler Schalter deaktiviert (doppelte Absicherung: DB-Flag + Code-Check)
- [ ] Vor der ersten Aktivierung: Warnung "Dadurch werden Artikel unwiderruflich gelöscht. Sind Sie sicher?" mit Bestätigungsdialog

## Edge Cases

- Globaler Schalter wird aktiviert während Cron-Job läuft → kein Problem (Job wird beim nächsten Lauf ausgeführt)
- Quelle wird gelöscht (in NEWS-2) → zugehörige Aufbewahrungskonfiguration wird mitgelöscht, Artikel bereits via CASCADE gelöscht
- Aufbewahrungsfrist wird von 30 auf 7 Tage gesenkt → beim nächsten Lauf werden alle Artikel älter als 7 Tage gelöscht (kein sanfter Übergang)
- Sehr viele zu löschende Artikel (> 10.000 auf einmal) → Batch-Deletes in Gruppen von 1000, um DB-Last zu verteilen
- Alle Quellen auf "Nie löschen" gesetzt → Job läuft, findet nichts zu tun, Log-Eintrag "0 Artikel gelöscht"
- `published_at` eines Artikels ist NULL → Artikel wird nicht gelöscht (kein Datum = kein Ablauf)

## Out of Scope
- Soft-Delete / Archivierung statt hartem Löschen (v2)
- Unterschiedliche Fristen pro Kategorie (nur pro Quelle)
- Manuelle Löschung mehrerer Artikel über die UI (v2 — außer Einzel-Löschen in NEWS-8)
- E-Mail-Benachrichtigung nach Löschlauf (v2)
- Wiederherstellung gelöschter Artikel (niemals — hartes Löschen)
