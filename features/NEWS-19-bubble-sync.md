# NEWS-19: Bubble-Sync (Artikel in den Datentyp "News Scraped" übertragen)

**Status:** In Review
**Priority:** P0
**Created:** 2026-09-22

## Overview
Alle gescrapten Artikel sollen zusätzlich in der Bubble-Datenbank im Datentyp
**News Scraped** liegen. Ein täglicher Cron-Lauf am Morgen — nach den nächtlichen
Scrapes — überträgt genau die Artikel, die seit dem letzten Lauf neu hinzugekommen
sind. Bereits übertragene Artikel werden nicht erneut geschickt.

## Dependencies
- Requires: NEWS-5 (Scraping Scheduler) — liefert die Artikel
- Extern: Bubble-App mit aktivierter Data API und einem API-Token

## User Stories
1. Als **Betreiber** möchte ich, dass neu gescrapte News automatisch in meiner
   Bubble-Datenbank landen, damit ich sie dort ohne manuellen Export weiterverwenden kann.
2. Als **Betreiber** möchte ich, dass pro Artikel genau ein Bubble-Eintrag entsteht,
   damit meine Bubble-Daten keine Dubletten enthalten.
3. Als **Betreiber** möchte ich, dass ein fehlgeschlagener Übertragungslauf am nächsten
   Tag automatisch nachgeholt wird, damit keine News verloren gehen.

## Acceptance Criteria

### Erkennung neuer Artikel
- [x] `articles.bubble_synced_at` (nullable) und `articles.bubble_id` (text) per Migration ergänzt
- [x] Der Sync wählt ausschließlich Artikel mit `bubble_synced_at IS NULL`, älteste zuerst
- [x] Der Zeitstempel wird **erst nach** der Bestätigung durch Bubble gesetzt
- [x] Partieller Index `articles_bubble_unsynced_idx` für genau diese Abfrage

### Übertragung
- [x] Bubble Data API, Bulk-Endpoint `POST /api/1.1/obj/<datatype>/bulk`
- [x] Newline-delimited JSON, `Content-Type: text/plain`, Bearer-Token
- [x] Batchgröße 100, maximal 1000 Artikel pro Lauf
- [x] Pro Lauf konfigurierbar gegen Live- oder Test-Datenbank (`/version-test`)
- [x] Leere optionale Felder werden weggelassen, nicht als `""` geschickt

### Fehlerbehandlung
- [x] Transportfehler (Netzwerk, Timeout, non-2xx) → ganzer Batch bleibt unsynchronisiert, Retry am Folgetag
- [x] Einzelne von Bubble abgelehnte Datensätze stoppen die restlichen Batches nicht
- [x] Eine abgeschnittene Bubble-Antwort gilt als Fehlschlag, nie als Erfolg
- [x] Fehlende Bubble-Konfiguration → Lauf wird sauber übersprungen (`skipped_reason`), kein Cron-Fehler

### Zeitplan & Zugriff
- [x] `GET|POST /api/cron/bubble-sync`, abgesichert über `CRON_SECRET`
- [x] Täglich 06:00 UTC via `vercel.json`

## Feldzuordnung
Definiert in `src/lib/bubble/mapping.ts` — die einzige Stelle, die angepasst werden muss,
wenn sich die Feldnamen in Bubble ändern. Die Namen wurden aus einem bestehenden Datensatz
der App ids.online ausgelesen; Gross-/Kleinschreibung und Leerzeichen sind Teil des Namens.

| Supabase (`articles`) | Bubble ("News Scraped") |
|---|---|
| `title` | `Headline_DE` |
| `title` (wiederholt) | `Subheadline_DE` |
| `description` | `Teaser_Text_DE` |
| `url` | `Link Source URL` |
| `image_url` | `Picture` **und** `Picture URL` |
| Host aus `url`, ohne `www.` | `Publisher` |
| `published_at` | `Date publishing` |

`language` und `source_category_raw` werden nicht übertragen — in Bubble gibt es dafür kein
Feld. `Subheadline_DE` wiederholt die Headline, weil der Scraper keine eigene Subheadline
liefert und die bestehenden Datensätze es genauso halten.

## Konfiguration
| Variable | Pflicht | Bedeutung |
|---|---|---|
| `BUBBLE_API_BASE_URL` | ja | z.B. `https://meine-app.bubbleapps.io` |
| `BUBBLE_API_TOKEN` | ja | Data-API-Token aus Settings → API |
| `BUBBLE_DATA_TYPE` | ja | API-Name des Datentyps, z.B. `newsscraped` |
| `BUBBLE_USE_TEST_VERSION` | nein | `true` schreibt in die Bubble-Entwicklungsdatenbank |

Fehlt eine der drei Pflichtvariablen, überspringt der Cron den Sync ohne Fehler.

## Edge Cases
- Artikel wurde an Bubble übertragen, der Stempel in Supabase schlug fehl → wird geloggt
  und gemeldet; der Folgelauf erzeugt dann eine Dublette. Bewusst in Kauf genommen: Bubble
  hat kein Feld für die Supabase-ID, über das sich das abfangen liesse.
- Mehr als 1000 unsynchronisierte Artikel → der Rest folgt am nächsten Tag.
- Unparsbare Artikel-URL → `Publisher` entfällt, der Datensatz geht trotzdem raus.
- Retention (NEWS-12) löscht einen Artikel in Supabase → der Bubble-Eintrag bleibt bestehen.

## Out of Scope
- Rückrichtung Bubble → News-Scraper
- Updates bereits übertragener Artikel (nur Neuanlage)
- Löschen in Bubble, wenn die Retention in Supabase löscht
- Manueller "Jetzt synchronisieren"-Button im Dashboard

---

## QA-Ergebnis (2026-09-23, PR #18)

**Testumfang:** Akzeptanzkriterien NEWS-19, Fix aus PR #18 (Middleware/Cron), Security-Audit
der jetzt ungeschützten `/api/cron/*`-Routen.
**Automatisierte Checks:** `lint` (0 Fehler, 13 Warnungen — alle vorbestehend), `typecheck` (sauber),
`test` (133/133), CI auf PR #18 (`verify`, `migrations`) grün.

### Root Cause des gemeldeten 401 — bestätigt
Die alte `middleware.ts` (aus NEWS-1, 2026-03-06) hat **jede** `/api/*`-Anfrage ohne
Supabase-Session mit 401 beantwortet; ein Cron-Request trägt kein Cookie. Betroffen waren
nicht nur `/api/cron/bubble-sync`, sondern seit jeher auch `/api/cron/scrape` und
`/api/cron/retention`. Der Fix in PR #18 nimmt `/api/cron/*` korrekt aus der Session-Prüfung
und lässt die routeneigene `CRON_SECRET`-Prüfung als alleinigen Schutz stehen.

### B-1 — Blocker: Fix ist nicht deployt
PR #18 ist **offen, nicht gemerged**. Der Fix-Commit entstand um 08:52 GMT+2, der gemeldete
fehlgeschlagene Lauf war um 08:38 GMT+2 — der 401 stammt also noch aus dem alten Stand.
Produktion läuft unverändert weiter, bis PR #18 gemerged und deployt ist.

### B-2 — Hoch: erster erfolgreicher Lauf überträgt den gesamten Altbestand
Die Migration legt `bubble_synced_at` nullable an, ohne Backfill. Damit gilt **jeder** bisher
gescrapte Artikel als unsynchronisiert. Der erste Lauf schickt bis zu 1000 Altartikel (und die
Folgeläufe den Rest) nach Bubble; die 53 bereits vorhandenen Bubble-Datensätze werden dabei
dupliziert, sofern sie denselben Artikeln entsprechen. Vor dem ersten Live-Lauf entweder
Altbestand per `update public.articles set bubble_synced_at = now() where created_at < '<stichtag>'`
stempeln oder bewusst gegen `/version-test` laufen lassen.

### B-3 — Mittel: Voller Backlog-Lauf läuft in das 60-Sekunden-Limit
`syncBatch()` stempelt jeden Artikel mit einem eigenen `UPDATE` (bis zu 1000 sequenzielle
Round-Trips pro Lauf), dazu bis zu 10 Bubble-Calls mit je 30 s Timeout. `maxDuration = 60`
reicht dafür nicht. Kein Datenverlust (Stempel sind pro Artikel), aber der Lauf bricht mittendrin
ab und die Zusammenfassung geht verloren. Empfehlung: Stempel pro Batch gebündelt
(`.in('id', [...])` je Bubble-ID-Gruppe bzw. ein `upsert`) statt pro Artikel.

### B-4 — Niedrig: `src/lib/bubble/sync.ts` hat keinen Test
`client.ts` und `mapping.ts` sind getestet, `sync.ts` — die Stelle mit der Stempel-Logik und
dem Batching — nicht. CLAUDE.md verlangt für neue Logik unter `src/lib/` einen Test.

### B-5 — Niedrig: Kein Schutz gegen künftige ungeschützte Cron-Routen
Nach dem Fix ist die routeneigene `CRON_SECRET`-Prüfung die einzige Absicherung. Alle drei
heutigen Routen prüfen korrekt, inklusive „Secret nicht gesetzt → 500" (in PR #18 für
`retention` nachgezogen). Eine neue Route unter `/api/cron/*` ohne eigene Prüfung wäre jedoch
öffentlich; kein Test erzwingt das.

### Security-Audit
- `CRON_SECRET` sowie alle vier `BUBBLE_*`-Variablen sind in Vercel Production gesetzt.
- Keine Secrets im Repo; `.env.local.example` dokumentiert alle Variablen.
- Kein Auth-Bypass durch den Fix: `/api/cron/*` ist nach wie vor nur mit korrektem Bearer-Token
  bedienbar, die Antwort ohne Token ist ein 401 ohne Informationsleck.
- Der Vergleich des Secrets ist nicht laufzeitkonstant — bei einem zufälligen 64-Zeichen-Token
  praktisch irrelevant, hier nur der Vollständigkeit halber notiert.

### Akzeptanzkriterien
Alle Kriterien im Code umgesetzt und per Unit-Test bzw. Code-Review verifiziert. **Ausstehend:**
Ende-zu-Ende-Verifikation gegen die Bubble-Testdatenbank — die steht erst nach dem Merge von
PR #18 aus, und dafür muss `BUBBLE_USE_TEST_VERSION` in Vercel exakt auf `true` stehen
(jeder andere Wert schreibt in die Live-Datenbank).

### B-6 — Kritisch: HTTP 400 bei Teil-Erfolg wirft den ganzen Batch weg (Lauf 2026-09-23, 07:12 UTC)
**Beobachtet:** `dpl_6cMM3VUXLrq2s2Nn963LSiSvkTvg`, Request `qn5qs-1790147577156-620d7866e3d1`.
96 unsynchronisierte Artikel, ein Batch. Bubble antwortet mit **HTTP 400** — der Body ist aber
die reguläre newline-delimitierte Antwort mit `{"status":"success","id":"..."}`-Zeilen. In Bubble
sind 76 Datensätze tatsächlich angelegt worden. Ergebnis im Log: `0 übertragen, 96 fehlgeschlagen`.

**Ursache:** Bubbles Bulk-Endpoint gibt 400 zurück, sobald *eine* Zeile scheitert — die übrigen
Zeilen werden trotzdem angelegt. `bulkCreate()` in `src/lib/bubble/client.ts` behandelt jedes
non-2xx als Transportfehler und wirft, bevor `parseBulkResponse()` überhaupt aufgerufen wird.
`syncBatch()` fängt das ab und markiert den kompletten Batch als fehlgeschlagen.

**Auswirkung (Datenintegrität):** Die 76 Datensätze existieren in Bubble, `bubble_synced_at`
bleibt aber bei allen 96 Artikeln NULL. **Jeder weitere Lauf legt dieselben 76 Datensätze erneut
an** — die Dublettenmenge wächst mit jedem Tag. Die in den Edge Cases als seltener Ausnahmefall
beschriebene Dublettengefahr ist damit der Normalfall, nicht die Ausnahme.

**Fix-Richtung:** Der Statuscode darf nicht mehr allein entscheiden. Bei non-2xx zuerst den Body
lesen und prüfen, ob er parsebare Statuszeilen enthält; wenn ja, ist es ein Teil-Erfolg und das
Ergebnis von `parseBulkResponse()` gilt. Nur wenn sich keine einzige Statuszeile lesen lässt
(echter 401/404/5xx, HTML-Fehlerseite), bleibt es beim `throw`.

**Sofortmaßnahme vor dem nächsten Lauf:** Cron aussetzen oder Bubble-Konfiguration entfernen,
bis der Fix steht. Die heute in der Testdatenbank angelegten 76 Datensätze löschen — welche 76
der 96 Artikel es waren, lässt sich nicht rekonstruieren, weil die Antwort verworfen wurde.

**Offen:** Warum ~20 Zeilen abgelehnt wurden, ist unbekannt — die Fehlermeldungen steckten in
genau dem Body, den der Code weggeworfen hat. Wahrscheinlichster Kandidat ist das Format von
`Date publishing` oder ein Pflichtfeld des Datentyps. Der Fix legt diese Meldungen offen.

**Bestätigt durch denselben Lauf:** Middleware-Fix wirkt (200 statt 401), Ziel ist korrekt die
Testdatenbank (`ids.online/version-test/...`), Laufzeit 2,12 s von 60 s.

---

## QA-Ergebnis (2026-09-24, Re-Test nach den Fixes zu B-3/B-4/B-6)

**Testumfang:** alle Akzeptanzkriterien NEWS-19, Verifikation der Fixes zu B-3, B-4 und B-6,
Security-Audit, Regression auf den deployten Bestand.
**Stand:** Arbeitsverzeichnis (noch nicht committet) — geändert: `src/lib/bubble/client.ts`,
`src/lib/bubble/sync.ts`, `src/lib/bubble/client.test.ts`, neu: `src/lib/bubble/sync.test.ts`.
**Automatisierte Checks:** `typecheck` sauber · `lint` 0 Fehler / 13 Warnungen (alle vorbestehend,
keine in `src/lib/bubble/`) · `test` **153/153** grün (vorher 133 — 20 neue Tests).
**Browser/Responsive:** nicht anwendbar. NEWS-19 ist reine Backend-/Cron-Funktionalität, ein
Dashboard-Button ist explizit Out of Scope. Keine UI-Fläche zum Testen.

### Status der offenen Punkte aus dem Lauf vom 2026-09-23

| Bug | Status | Beleg |
|---|---|---|
| B-1 Fix nicht deployt | **behoben** | `1e038e1` auf `main`, Middleware nimmt `/api/cron/*` aus der Session-Prüfung |
| B-2 Altbestand wird komplett übertragen | **offen** | kein Backfill in `20260922120855_add_articles_bubble_sync.sql`, keine weitere Migration |
| B-3 60-Sekunden-Limit | **teilweise behoben** | siehe B-7 |
| B-4 kein Test für `sync.ts` | **behoben** | `src/lib/bubble/sync.test.ts`, 9 Tests |
| B-5 kein Test erzwingt Cron-Schutz | **offen** | weiterhin kein Test unter `src/app/api/cron/` |
| B-6 HTTP 400 verwirft Teil-Erfolg | **behoben, aber siehe B-8** | `countStatusLines()` in `client.ts:96-116` |

### Akzeptanzkriterien

**Erkennung neuer Artikel — 4/4 bestanden**
- PASS Migration ergänzt `bubble_synced_at` (nullable) und `bubble_id` (text).
- PASS `loadUnsyncedArticles()` filtert `.is('bubble_synced_at', null)`, `.order('created_at', asc)`,
  `.limit(1000)`. Test: „does nothing when no article is pending".
- PASS Stempel erst nach Bubble-Bestätigung: `stampSynced()` läuft nur über `accepted`.
  Test: „stamps only the articles Bubble accepted" (a, c gestempelt, b nicht).
- PASS Partieller Index `articles_bubble_unsynced_idx on (created_at) where bubble_synced_at is null`
  deckt die Abfrage exakt ab.

**Übertragung — 5/5 bestanden**
- PASS Bulk-URL `…/api/1.1/obj/<datatype>/bulk`, mit `/version-test` bei aktivem Testmodus.
- PASS NDJSON-Body, `Content-Type: text/plain`, `Authorization: Bearer …`.
- PASS Batchgröße 100, Deckel 1000. Test: 250 Artikel → Calls mit 100/100/50.
- PASS `BUBBLE_USE_TEST_VERSION` steuert das Ziel pro Lauf.
- PASS Leere optionale Felder werden weggelassen. Test: „maps the article into the Bubble record shape".

**Fehlerbehandlung — 3/4 bestanden, 1 mit Einschränkung**
- PASS Transportfehler → ganzer Batch unsynchronisiert, kein Stempel.
  Test: „fails a whole batch when the Bubble call throws, without stamping".
- PASS Einzelne Ablehnungen stoppen die Folgebatches nicht.
- **EINSCHRÄNKUNG** „Eine abgeschnittene Bubble-Antwort gilt als Fehlschlag, nie als Erfolg":
  gilt nur, solange Bubble pro eingereichter Zeile eine Antwortzeile liefert. Siehe **B-8**.
- PASS Fehlende Konfiguration → `skipped_reason`, kein Fehler. Test vorhanden.

**Zeitplan & Zugriff — 2/2 bestanden**
- PASS `GET|POST /api/cron/bubble-sync`, `CRON_SECRET` geprüft, „Secret nicht gesetzt → 500"
  vor dem Vergleich (kein „Bearer undefined"-Bypass).
- PASS `vercel.json`: `0 6 * * *`, nach dem Retention-Lauf (03:00) und den 15-Minuten-Scrapes.

**Summe: 14/15 bestanden, 1 mit Einschränkung (B-8).**

### B-8 — Kritisch: Der B-6-Fix vertraut ungeprüft auf die Zeilen-Reihenfolge von Bubble
`parseBulkResponse()` ordnet Antwortzeilen **positionell** den eingereichten Datensätzen zu.
Solange Bubble für jede eingereichte Zeile genau eine Antwortzeile liefert — auch für die
abgelehnten — stimmt das. Liefert Bubble im 400-Fall dagegen **nur die Zeilen der angelegten
Datensätze** und lässt die abgelehnten weg, verschiebt sich die gesamte Zuordnung.

Reproduziert (3 Datensätze, Datensatz 1 abgelehnt und nicht mitgeliefert, HTTP 400):
```
Antwort: {"status":"success","id":"id-of-b"}\n{"status":"success","id":"id-of-c"}
Ergebnis: [ {success:true, id:"id-of-b"},   ← gehört zu Artikel a
            {success:true, id:"id-of-c"},   ← gehört zu Artikel b
            {success:false, "Keine Antwortzeile von Bubble erhalten"} ]
```
**Auswirkung:** Artikel a wird als synchronisiert gestempelt, obwohl er **nie** in Bubble
angelegt wurde — und wird nie wieder versucht (dauerhafter Datenverlust). Artikel c wurde
angelegt, gilt aber als fehlgeschlagen und wird jeden Tag erneut geschickt (dauerhafte
Dubletten). Zusätzlich stehen in `bubble_id` durchweg fremde IDs. Das ist schlechter als der
B-6-Zustand, der zwar alles neu schickte, aber nichts falsch stempelte.

**Warum das offen ist:** Der einzige reale Beleg (Lauf 2026-09-23: 96 eingereicht, 76 angelegt)
sagt **nicht**, wie viele Zeilen der Body enthielt — die Antwort wurde ja verworfen. Die
Annahme „gleiche Reihenfolge, eine Zeile pro Datensatz" steht als Kommentar in `client.ts`,
ist aber nie gegen die echte API verifiziert worden. Der neue Test „pads a truncated 400 body
with failures" schreibt genau diese ungeprüfte Annahme fest.

**Empfehlung (zwei Teile):**
1. Schutzgeländer im Code: Bei non-2xx nur dann positionell zuordnen, wenn die Zahl der
   lesbaren Statuszeilen der Zahl der eingereichten Datensätze **entspricht**. Weicht sie ab,
   den Batch als fehlgeschlagen behandeln und den Body loggen — nichts stempeln. Das
   B-6-Verhalten (alles neu schicken) bleibt dann der Worst Case, statt Fehlstempel zu riskieren.
2. Ende-zu-Ende-Lauf gegen `/version-test` mit einem bewusst ungültigen Datensatz in der Mitte
   des Batches, um die tatsächliche Antwortform festzuhalten. Ohne diesen Lauf ist B-8 nicht
   abschließend zu beurteilen.

### B-7 — Mittel: 60-Sekunden-Budget bei vollem Backlog weiterhin nicht garantiert (Nachfolger von B-3)
`stampSynced()` läuft jetzt in Parallelblöcken zu 25 (`sync.ts:176-208`) — aus 1000 sequenziellen
Round-Trips werden 40 Blöcke. Deutliche Verbesserung, B-3 ist damit im Kern adressiert.
Nicht adressiert ist der andere Anteil: 10 Bubble-Calls mit je bis zu 30 s Timeout ergeben im
Worst Case 300 s gegen `maxDuration = 60`. Bei einem langsamen Bubble bricht der Lauf weiterhin
mittendrin ab. Kein Datenverlust (Stempel sind pro Artikel), aber die Zusammenfassung geht
verloren und der Rest wartet auf den Folgetag. Optionen: `MAX_ARTICLES_PER_RUN` senken,
`REQUEST_TIMEOUT_MS` reduzieren oder ein Zeitbudget prüfen und den Lauf geordnet beenden.

### B-9 — Niedrig: Ein flaches Bubble-Fehler-Envelope wird nicht mehr als Transportfehler erkannt
`countStatusLines()` zählt jede Zeile mit einem der Felder `status`, `id` oder `message` als
Statuszeile. Bubbles verschachteltes Fehlerformat (`{"statusCode":401,"body":{…}}`) fällt korrekt
durch und wirft — verifiziert. Ein **flaches** Envelope wie `{"status":"ERROR","message":"Missing
or invalid token"}` würde dagegen als eine Statuszeile zählen und den Lauf statt eines Throws
als „alle Datensätze abgelehnt" melden.
**Auswirkung gering:** Es wird nichts gestempelt, der Batch wird am Folgetag wiederholt — das
Verhalten ist also fehlersicher. Betroffen ist nur die Diagnose: ein Token-Problem erscheint im
Log als fachliche Ablehnung von 100 Artikeln. Die unter Empfehlung 1 zu B-8 vorgeschlagene
Anzahl-Prüfung würde diesen Fall nebenbei mit erschlagen.

### B-10 — Niedrig: Zusammenfassung geht bei Stempel-Fehlern nicht auf
Schlägt der Stempel fehl, wird der Artikel weder in `articles_synced` noch in `articles_failed`
gezählt (`sync.ts:195-207`), nur `errors` wächst. `articles_synced + articles_failed` ist dann
kleiner als `articles_pending`, was die Auswertung im Cron-Log stillschweigend verfälscht.

### B-2 und B-5 — unverändert offen
B-2 (kein Backfill, erster Live-Lauf überträgt den Altbestand) und B-5 (kein Test erzwingt die
`CRON_SECRET`-Prüfung für künftige `/api/cron/*`-Routen) sind gegenüber dem Vortag unverändert.
Beschreibung und Empfehlung siehe QA-Ergebnis vom 2026-09-23.

### Security-Audit (Red Team)
- **Auth-Bypass:** `/api/cron/bubble-sync` ist nach dem Middleware-Fix nur noch durch die
  eigene `CRON_SECRET`-Prüfung geschützt. Diese sitzt vor jeder Verarbeitung, prüft zuerst auf
  ein **gesetztes** Secret (sonst 500) und vergleicht dann exakt. Kein Bypass über `GET`
  (delegiert an `POST`), kein Bypass über fehlendes Secret. Alle drei Cron-Routen gleich.
- **Informationsleck:** Antwort ohne Token ist `401 {"error":"Nicht autorisiert"}` — keine
  Angaben zu Konfiguration oder Bestand. Unerwartete Fehler geben `500 {"error":"Interner
  Serverfehler"}` zurück, die Meldung bleibt im Log.
- **Datenleck über die Erfolgsantwort:** Der 200er-Body enthält `errors[]` mit Artikel-Titeln.
  Nur mit gültigem Secret erreichbar, Titel sind ohnehin öffentliche News — akzeptabel.
- **Secrets:** keine Hardcodes in `src/lib/bubble/`; `BUBBLE_API_TOKEN` fließt ausschließlich in
  den `Authorization`-Header und taucht in keiner Log- oder Fehlermeldung auf. Der Throw-Text in
  `bulkCreate()` enthält nur Statuscode und die ersten 500 Zeichen des Bubble-Bodys — kein Token.
  Alle vier `BUBBLE_*`-Variablen sind in `.env.local.example` dokumentiert, kein `NEXT_PUBLIC_`-Präfix.
- **Datenabfluss Richtung Bubble:** `toBubbleRecord()` überträgt nur die sieben gemappten Felder,
  keine Supabase-IDs, keine Nutzer- oder Quellen-Metadaten. Positiv geprüft.
- **SSRF:** `BUBBLE_API_BASE_URL` ist serverseitig konfiguriert, kein Nutzereinfluss auf das
  Fetch-Ziel. `toPublisher()` parst die Artikel-URL nur, ruft sie nicht ab.
- **Neue Spalten in API-Antworten:** `bubble_id`/`bubble_synced_at` werden von keiner Route
  ausgeliefert — `/api/articles` und `/api/articles/[id]` selektieren explizite Spaltenlisten,
  kein `select('*')` auf `articles`. Kein Leck.
- **Rate Limiting:** keines auf `/api/cron/*`. Ohne gültiges Secret passiert nichts, mit gültigem
  Secret ist ein paralleler Doppelaufruf aber möglich — zwei gleichzeitige Läufe lesen dieselbe
  ungestempelte Menge und legen sie doppelt in Bubble an. Kein Lock vorhanden. Praktisch nur
  relevant, wenn jemand den Cron manuell zusätzlich auslöst; als Hinweis notiert.

### Regression
- `test` 153/153 grün, darunter die vollständigen Suiten zu NEWS-3/4/5 (Scraping), NEWS-9
  (Kategorien), NEWS-6 (Artikel-Validierung) und `env`.
- Migration ist rein additiv (`add column if not exists`, `create index if not exists`), ohne
  `not null` und ohne Default — bestehende Inserts der Scraping-Engine sind nicht betroffen.
- Middleware: `/dashboard`-Schutz, `/api`-Schutz und die Login-Weiterleitung sind unverändert;
  ausgenommen ist ausschließlich `/api/cron/*`. Keine Auswirkung auf NEWS-1.
- Keine gemeinsam genutzten Komponenten berührt, keine visuellen Regressionen möglich.

### Produktionsreife: **NEIN**
Offen: 1 kritischer (B-8), 1 mittlerer (B-7), 1 hoher aus dem Vortag (B-2, vor dem Umschalten
auf die Live-Datenbank zwingend), dazu B-5, B-9, B-10 (niedrig).
B-8 muss vor dem nächsten Lauf gegen die Live-Datenbank geschlossen sein — im Fehlerfall
entstehen Fehlstempel, und ein fehlgestempelter Artikel ist ohne Reparatur nicht mehr auffindbar.
Gegen `/version-test` kann und sollte weitergetestet werden.

---

## QA-Ergebnis (2026-09-24, Re-Test nach dem B-8-Fix + Backfill-Skript)

**Testumfang:** Schwerpunkt B-8 (Zuordnungs-Check `countStatusLines === records.length`), neues
`scripts/backfill-bubble-synced.mjs`, Kurzstatus B-2/B-5/B-7/B-9/B-10.
**Stand:** Arbeitsverzeichnis, nicht committet — geändert `src/lib/bubble/client.ts`, `sync.ts`,
`client.test.ts`, `package.json`, `features/INDEX.md`; neu `src/lib/bubble/sync.test.ts`,
`scripts/backfill-bubble-synced.mjs`.
**Automatisierte Checks:** `typecheck` sauber · `lint` 0 Fehler / 13 Warnungen (alle vorbestehend)
· `test` **159/159** grün (vorher 153).
**Browser/Responsive:** nicht anwendbar (reine Backend-/Cron-Funktionalität, kein UI).

### B-8 — überwiegend geschlossen, aber der Check ist umgehbar → siehe B-11
Der Zuordnungs-Check gilt jetzt für **jede** Antwort, auch 2xx (`client.ts:104-125`); bei
Abweichung wird geloggt und geworfen, `syncBatch()` zählt den Batch komplett als fehlgeschlagen
und stempelt nichts. Das ursprünglich beschriebene Szenario (400 liefert nur die angelegten
Zeilen) ist damit abgedeckt: 2 Zeilen für 3 Datensätze → Throw, kein Stempel. Verifiziert.
**Nicht** abgedeckt ist der Fall, dass die Zeilenzahl zwar stimmt, der Body aber zusätzliche
**unlesbare** Zeilen enthält — siehe B-11. B-8 bleibt deshalb offen, bis B-11 behoben ist.

### B-11 — Kritisch: `countStatusLines()` und `parseBulkResponse()` zählen unterschiedlich
`countStatusLines()` zählt nur Zeilen, die als Statuszeile **parsebar** sind;
`parseBulkResponse()` bildet dagegen **jede** nicht-leere Zeile auf ein Ergebnis ab. Enthält der
Body `records.length` gültige Statuszeilen **plus** mindestens eine unlesbare Zeile (HTML-Prefix,
Proxy-Meldung, abgeschnittene Restzeile, Bubble-Fehlerzeile ohne `status`/`id`/`message`), besteht
er den Check und `bulkCreate()` gibt mehr Ergebnisse zurück als Datensätze eingereicht wurden.

Reproduziert (2 Datensätze, HTTP 400):
```
Body:     <!doctype html>\n{"status":"success","id":"id-of-a"}\n{"status":"success","id":"id-of-b"}
countStatusLines: 2 === 2  → Check bestanden
bulkCreate():     3 Ergebnisse
```
Auf `runBubbleSync()` angewandt (Artikel a, b):
```
UPDATE: article "b" → bubble_synced_at=…, bubble_id="id-of-a"   ← fremde bubble_id
ERR:    Cannot read properties of undefined (reading 'id')      ← batch[2] existiert nicht
```
**Auswirkung:** genau die beiden Schäden, gegen die B-8 schützen sollte — ein Artikel bekommt die
**fremde** `bubble_id` eines anderen Datensatzes gestempelt, und der Lauf bricht anschließend mit
einer `TypeError` ab (Route antwortet 500, Zusammenfassung verloren, Restbatches laufen nicht).
Der Stempel ist bereits geschrieben, bevor der Fehler auftritt.
**Fix-Richtung:** `parseBulkResponse()` dieselbe Filterung anwenden lassen wie `countStatusLines()`
(nur parsebare Statuszeilen), oder zusätzlich die Zahl der **nicht-leeren** Zeilen gegen
`records.length` prüfen. Zusätzlich in `syncBatch()` ein Geländer: `outcomes.length !==
batch.length` → Batch als fehlgeschlagen werten statt über `undefined` zu stolpern.

### Gibt es sonst noch einen Pfad zu einem unbestätigten Stempel?
Systematisch geprüft, ausser B-11 **nein**:
- `stampSynced()` wird ausschliesslich mit `accepted` aufgerufen; dort landet nur, was
  `outcome.success === true` hat, und das setzt in `parseBulkResponse()` `status === 'success'`
  **und** eine vorhandene `id` voraus. Ein `bubble_id: null` kann auf diesem Weg nicht entstehen.
- Throw in `bulkCreate()` (Netz, Timeout, Bulk-Limit, Zuordnungsfehler) → `catch` in `syncBatch()`,
  kein Stempel.
- Leerer Batch → `bulkCreate()` gibt `[]` zurück, kein Stempel.
- Stempelfehler werden nicht verschluckt, sondern als `errors[]`-Eintrag gemeldet (Zählung: B-10).
- Zweiter Pfad zu fremden `bubble_id`s bleibt die **Reihenfolge** der Bubble-Antwort: stimmt die
  Anzahl, wird weiterhin positionell zugeordnet. Das ist unvermeidbar ohne Rückkanal, aber immer
  noch nicht gegen die echte API verifiziert (E2E-Lauf gegen `/version-test` mit einem bewusst
  ungültigen Datensatz **in der Mitte** des Batches steht aus).

### Backfill-Skript `scripts/backfill-bubble-synced.mjs`
- PASS **Dry-Run-Default:** ohne `--apply` wird ausschliesslich gelesen und berichtet.
- PASS **Idempotenz:** liest nur `bubble_synced_at IS NULL`, und das `UPDATE` trägt zusätzlich
  `.is('bubble_synced_at', null)` — ein Zweitlauf kann einen bestehenden Stempel nicht überschreiben.
- PASS **Secrets:** keine Hardcodes, Token nur im `Authorization`-Header, kein Token in Logs oder
  Fehlermeldungen; `.env.local` wird gelesen, ohne echte Env-Variablen zu überschreiben; die
  Kommentar-Zeilen-Regex verhindert, dass `# KEY=…` gesetzt wird.
- PASS **URL-Normalisierung:** Host kleingeschrieben, `www.` entfernt, Fragment entfernt, Protokoll
  auf `https`, abschliessender Slash entfernt, Query bewusst erhalten.
- **B-12 — Hoch: falsches Bubble-Ziel stempelt dauerhaft falsch.** Läuft das Skript mit
  `BUBBLE_USE_TEST_VERSION=true` und `--apply`, werden Supabase-Artikel mit den `_id`s der
  **Testdatenbank** gestempelt und gelten damit für die Live-Datenbank als übertragen — sie
  erreichen die Live-Datenbank nie mehr, und `bubble_id` zeigt auf einen Datensatz, den es dort
  nicht gibt. Das Ziel wird zwar geloggt, aber nicht bestätigt. Empfehlung: bei `--apply` das Ziel
  explizit bestätigen lassen (`--target=live|test` muss zur Env passen).
- **B-13 — Mittel: `--cutoff` stempelt bei leerem/unvollständigem Bubble-Index blind.** Der Index
  bricht nach `MAX_PAGES` (20 000 Records) **ohne Warnung** ab; liefert Bubble wegen Privacy-Rules
  ein `results: []` mit HTTP 200, ist der Index leer. In beiden Fällen laufen alle Artikel in den
  `--cutoff`-Zweig und werden ohne `bubble_id` als synchronisiert markiert — inhaltlich „nie
  übertragen, gilt aber als erledigt". Der Dry Run macht es sichtbar, erzwingt aber nichts.
  Empfehlung: Abbruch bei erreichtem `MAX_PAGES` und bei leerem Index.
- **B-14 — Niedrig: `npm run backfill:bubble --apply` wirkt nicht.** npm interpretiert `--apply`
  als eigenes Flag; nötig ist `npm run backfill:bubble -- --apply`. Fehlerrichtung ist sicher
  (es bleibt beim Dry Run), sollte aber im Skript-Header stehen.
- **B-15 — Niedrig:** fällt `normaliseUrl()` auf den Catch-Zweig zurück, wird der **gesamte**
  String kleingeschrieben, im Normalfall dagegen nur der Host — dieselbe URL kann so je nach
  Parsebarkeit unterschiedlich normalisiert werden. Ausserdem wird ein Bubble-Record ohne `_id`
  als Treffer mit `bubble_id: null` gestempelt. Kein Test deckt das Skript ab.

### Kurzstatus der übrigen Punkte
| Bug | Schwere | Status |
|---|---|---|
| B-2 Altbestand wird komplett übertragen | Hoch | **werkzeugseitig adressiert, fachlich offen** — das Backfill-Skript existiert, ist aber nachweislich noch nicht gelaufen (alle Artikel weiterhin `bubble_synced_at IS NULL`, keine Migration). Vor dem ersten Live-Lauf zwingend auszuführen. |
| B-5 kein Test erzwingt den `CRON_SECRET`-Schutz | Niedrig | **offen** — weiterhin kein Test unter `src/app/api/cron/`. Die drei bestehenden Routen prüfen korrekt (Re-Review von `bubble-sync/route.ts`: Secret-Existenz → 500, dann exakter Vergleich, GET delegiert an POST). |
| B-7 60-Sekunden-Budget | Mittel | **offen** — `maxDuration = 60`, bis zu 10 Bubble-Calls à 30 s Timeout, `MAX_ARTICLES_PER_RUN` unverändert 1000. |
| B-9 flaches Fehler-Envelope | Niedrig | **de facto entschärft** — ein einzeiliges Envelope besteht den Anzahl-Check nur noch bei einem Batch der Grösse 1; ansonsten führt es zum Throw mit vollständigem Body im Log. Restrisiko nur bei Ein-Artikel-Läufen. |
| B-10 Zusammenfassung geht bei Stempelfehlern nicht auf | Niedrig | **offen** — `sync.ts:195-207` unverändert. |

### Security-Audit (Delta zum Vortag)
- Keine Änderung an Auth, Middleware oder Routen. `/api/cron/bubble-sync` weiterhin nur per
  `CRON_SECRET` erreichbar, kein Informationsleck in den Fehlerantworten.
- Neu geprüft: das Backfill-Skript liest den Supabase **Service-Role-Key** und umgeht damit RLS.
  Es ist ein lokal auszuführendes Einmal-Skript, nicht im Deployment-Pfad und in keiner Route
  importiert — korrekt so. `.env.local` bleibt gitignored, keine Secrets im Skript.
- `client.ts` loggt bei Zuordnungsfehlern bis zu 2000 Zeichen des Bubble-Bodys. Enthält nur
  Bubble-Antwortdaten, kein Token — geprüft.
- Kein Lock gegen parallele Cron-Läufe (unverändert, s. Vortag).

### Regression
`test` 159/159 grün inkl. NEWS-3/4/5/6/9 und `env`. Keine Migration, keine Routenänderung,
keine gemeinsam genutzten Komponenten berührt.

### Produktionsreife: **NEIN**
Offen: **B-11 (kritisch)**, B-12 (hoch), B-2 (hoch, Ausführung des Backfills), B-7/B-13 (mittel),
B-5/B-9/B-10/B-14/B-15 (niedrig). B-11 muss vor dem nächsten Lauf — auch gegen `/version-test` —
geschlossen sein, weil dabei bereits ein Fehlstempel geschrieben wird.

---

## QA-Ergebnis (2026-09-24, Re-Test nach dem B-11-Fix)

**Testumfang:** Verifikation von B-11 und B-8 mit eigenen, unabhängigen Angriffs-Probes gegen
`bulkCreate()`/`parseBulkResponse()`; End-to-End-Lauf des Backfill-Skripts gegen einen
nachgebauten Bubble-/PostgREST-Server; Kurzstatus B-2/B-5/B-7/B-9/B-10/B-12…B-15;
Security-Audit; Regression.
**Stand:** Arbeitsverzeichnis, nicht committet — `src/lib/bubble/client.ts`, `sync.ts`,
`client.test.ts`, `package.json`, `.gitignore`, `features/*`; neu `src/lib/bubble/sync.test.ts`,
`scripts/backfill-bubble-synced.mjs`.
**Automatisierte Checks:** `typecheck` sauber · `lint` 0 Fehler / 13 Warnungen (alle vorbestehend,
keine in `src/lib/bubble/` oder `scripts/`) · `test` **169/169** grün (vorher 159).
**Browser/Responsive:** nicht anwendbar — NEWS-19 ist reine Backend-/Cron-Funktionalität ohne
UI-Fläche, ein Dashboard-Button ist explizit Out of Scope.

### B-11 — behoben, unabhängig verifiziert
`splitResponseLines()` ist jetzt die einzige Quelle für beide Zählungen, und `bulkCreate()`
prüft zweistufig: erst `statusLineCount === lines.length` (keine unlesbare Zeile), dann
`statusLineCount === records.length`. `parseBulkResponse()` wirft zusätzlich bei einer
unlesbaren Zeile, statt ein Ergebnis zu erfinden. `syncBatch()` hat als drittes Geländer
`outcomes.length !== batch.length` → Batch fehlgeschlagen, nichts gestempelt.

Eigene Probes, nicht aus der bestehenden Suite (alle bestanden):
| Probe | Antwort auf 3 Datensätze | Ergebnis |
|---|---|---|
| HTML-Prefix + 3 Verdikte (B-11-Repro) | `<!doctype html>` + 3 Zeilen | Throw, kein Stempel |
| 502-HTML-Seite mit zufällig 3 Zeilen | 3 unlesbare Zeilen | Throw |
| JSON-**Array** statt NDJSON | 1 Zeile, unlesbar | Throw |
| CRLF-Zeilenenden | 3 Verdikte mit `\r\n` | korrekt 3 Ergebnisse |
| Leerzeilen zwischen den Verdikten | 3 Verdikte + `   ` | korrekt 3 Ergebnisse, beide Zählungen einig |
| Wert mit Zeilenumbruch im Artikel | `"line1\nline2"` | wird escaped, Body bleibt einzeilig |
| `{"id":"x"}` ohne `status` / `{"status":"success"}` ohne `id` | — | `success:false`, kein Stempel |

**B-8 gilt damit ebenfalls als geschlossen.** Es wurde kein Pfad mehr gefunden, auf dem ein
Artikel ohne bestätigte Bubble-ID gestempelt wird.

### B-16 — Hoch (neu): Backfill stempelt den Altbestand, obwohl der Bubble-Index unbrauchbar ist
`assertIndexTrustworthy()` prüft nur `total` (Anzahl gelesener Records) und `complete`.
Nicht geprüft wird `index.size` — also wie viele Records eine **verwertbare URL** hatten.
Heißt `Link Source URL` in Bubble anders (Umbenennung, anderer Datentyp, Feld per Privacy Rule
ausgeblendet, Feld leer), liefert Bubble 200 mit vollen Records, `normaliseUrl()` gibt für jeden
`null` zurück, der Index bleibt leer — und die Prüfung lässt den Lauf durch.

Reproduziert (Fake-Bubble, 2 Records mit Feldnamen `Article Link`, 2 Artikel, `--cutoff`):
```
[Backfill] 2 Bubble-Records gelesen, 0 mit eindeutiger URL
[Backfill] URL-Treffer in Bubble: 0
[Backfill] Ohne Treffer: 2 — davon vor 2026-09-01: 2 (werden als synchronisiert markiert)
[Backfill] Fertig: 2 gestempelt, 0 fehlgeschlagen
```
**Auswirkung:** genau der Schaden, gegen den B-13 schützen sollte — der komplette Altbestand
gilt als erledigt, ohne je übertragen worden zu sein, und der Sync fasst ihn nie wieder an.
Ohne `--cutoff` ist die Wirkung umgekehrt, aber ebenfalls falsch: 0 Treffer heißt, der erste
Live-Lauf dupliziert alles, was in Bubble schon liegt (B-2 bleibt ungelöst, obwohl das Skript
„erfolgreich" lief). Das Skript kennt die Zahl — sie steht in der eigenen Log-Zeile — handelt
aber nicht danach.
**Fix-Richtung:** `index.size` in `assertIndexTrustworthy()` aufnehmen: `total > 0 && index.size === 0`
→ Abbruch mit dem Hinweis auf den Feldnamen; und einen auffälligen Warnhinweis, wenn
`index.size / total` unter einem Schwellwert (z.B. 90 %) liegt. `--allow-empty-index` darf das
**nicht** überschreiben, denn hier ist die Datenbank ja gerade nicht leer.

### B-17 — Mittel (neu): fehlendes `remaining` beendet die Paginierung stillschweigend
`loadBubbleIndex()` wertet `payload?.response?.remaining ?? 0` aus und bricht bei `<= 0` mit
`complete = true` ab. Liefert Bubble das Feld nicht (anderer API-Modus, geänderte Antwortform,
Proxy), sieht der Code „0 verbleibend" und hält einen Index aus **einer einzigen Seite** (100
Records) für vollständig.

Reproduziert (Fake-Bubble, 2 Records auf 2 Seiten, Antwort ohne `remaining`):
```
[Backfill] Bubble-Seite 1: 1 Records, 0 verbleibend
[Backfill] 1 Bubble-Records gelesen, 1 mit eindeutiger URL
```
Seite 2 wurde nie abgefragt, kein Hinweis, `complete = true`. Mit `--cutoff --apply` würden die
Artikel von Seite 2 als synchronisiert gestempelt, ohne je in Bubble zu landen — dieselbe Klasse
wie B-13, nur durch die andere Tür. Bei >100 Bubble-Records ist das der Regelfall, sobald das
Feld fehlt.
**Fix-Richtung:** Der Default muss misstrauisch sein. Fehlt `remaining`, ist der Index nicht
vollständig: nur `typeof remaining === 'number' && remaining <= 0` (oder `results.length === 0`)
darf `complete` setzen, alles andere weiterpagen bzw. abbrechen.

### Akzeptanzkriterien

**Erkennung neuer Artikel — 4/4 PASS**
- PASS Migration `20260922120855_add_articles_bubble_sync.sql`: `bubble_synced_at timestamptz`
  (nullable) und `bubble_id text`, rein additiv (`add column if not exists`).
- PASS `loadUnsyncedArticles()`: `.is('bubble_synced_at', null)`, `.order('created_at', asc)`,
  `.limit(1000)`.
- PASS Stempel erst nach Bestätigung: `stampSynced()` erhält nur `accepted`, und dort landet nur,
  was `status === 'success'` **und** eine `id` hat. Über eigene Probes gegengeprüft.
- PASS Partieller Index `articles_bubble_unsynced_idx on (created_at) where bubble_synced_at is null`.

**Übertragung — 5/5 PASS**
- PASS Bulk-URL `…/api/1.1/obj/<datatype>/bulk`, `/version-test` bei aktivem Testmodus.
- PASS NDJSON, `Content-Type: text/plain`, `Authorization: Bearer …`.
- PASS `BATCH_SIZE = 100`, `MAX_ARTICLES_PER_RUN = 1000`, `BUBBLE_BULK_LIMIT`-Prüfung vor dem Senden.
- PASS `BUBBLE_USE_TEST_VERSION` steuert das Ziel, nur der exakte String `"true"` aktiviert Test.
- PASS Leere optionale Felder werden weggelassen (`toBubbleRecord()`), nicht als `""` gesendet.

**Fehlerbehandlung — 4/4 PASS**
- PASS Transportfehler → ganzer Batch unsynchronisiert, kein Stempel.
- PASS Einzelne Ablehnungen stoppen die Folgebatches nicht.
- PASS „Abgeschnittene Antwort gilt nie als Erfolg" — die Einschränkung aus dem Vorlauf ist mit
  dem B-11-Fix weg: jede Abweichung in der Zeilenzahl **oder** eine unlesbare Zeile wirft.
- PASS Fehlende Konfiguration → `skipped_reason`, Cron antwortet 200.

**Zeitplan & Zugriff — 2/2 PASS**
- PASS `GET|POST /api/cron/bubble-sync`; Secret-Existenz zuerst (→ 500), dann exakter Vergleich,
  GET delegiert an POST.
- PASS `vercel.json`: `0 6 * * *`, nach Retention (03:00) und den 15-Minuten-Scrapes.

**Summe: 15/15 bestanden.** Ausstehend bleibt die Ende-zu-Ende-Verifikation gegen `/version-test`
mit einem bewusst ungültigen Datensatz in der Mitte des Batches — erst sie zeigt, ob Bubble im
400-Fall wirklich eine Zeile pro Datensatz liefert. Der Code ist jetzt in beiden Fällen sicher
(er wirft und stempelt nichts), aber ob Teil-Erfolge überhaupt ausgewertet werden können oder
immer in den Retry laufen, ist ungeklärt. Ebenso ungeklärt: warum am 2026-09-23 rund 20 von 96
Zeilen abgelehnt wurden.

### Status aller Punkte
| Bug | Schwere | Status |
|---|---|---|
| B-1 Middleware-Fix nicht deployt | — | behoben (`1e038e1`) |
| B-2 Altbestand wird komplett übertragen | Hoch | **offen** — Skript existiert, ist aber nachweislich nicht gelaufen (alle Artikel weiterhin `bubble_synced_at IS NULL`). Vor dem ersten Live-Lauf zwingend, und erst nach B-16/B-17. |
| B-3 60-Sekunden-Limit | Mittel | im Kern behoben → Rest als B-7 |
| B-4 kein Test für `sync.ts` | Niedrig | behoben (12 Tests) |
| B-5 kein Test erzwingt `CRON_SECRET` | Niedrig | **offen** — weiterhin kein Test unter `src/app/api/cron/`. Alle drei Routen prüfen im Re-Review korrekt. |
| B-6 HTTP 400 verwirft Teil-Erfolg | Kritisch | behoben |
| B-7 Bubble-Timeouts sprengen `maxDuration` | Mittel | **offen** — `maxDuration = 60`, bis zu 10 Calls à 30 s Timeout, `MAX_ARTICLES_PER_RUN` unverändert 1000. |
| B-8 positionelle Zuordnung ungeprüft | Kritisch | **behoben**, unabhängig verifiziert |
| B-9 flaches Fehler-Envelope | Niedrig | **Restrisiko bestätigt** — Probe: `401` mit `{"status":"ERROR","message":"Missing or invalid token"}` und **Batchgröße 1** ergibt `[{success:false,…}]` statt eines Throws. Fehlersicher (nichts gestempelt, Retry morgen), aber im Log erscheint ein Token-Problem als fachliche Ablehnung. |
| B-10 Summe geht bei Stempelfehlern nicht auf | Niedrig | **offen** — `sync.ts` zählt einen Stempelfehler weder in `articles_synced` noch `articles_failed`. |
| B-11 zwei Zählweisen | Kritisch | **behoben**, unabhängig verifiziert |
| B-12 Backfill-Ziel nicht bestätigt | Hoch | behoben — `--target=live|test` Pflicht, muss zu `BUBBLE_USE_TEST_VERSION` passen, Test zusätzlich `--confirm-test-target`; Banner nennt Bubble-Umgebung **und** Supabase-Projekt-Ref; `--undo=<Journal>` als Rückweg. Alle drei Abbrüche gegen den Fake-Server verifiziert. |
| B-13 unvollständiger/leerer Index | Mittel | behoben für Abbruch & leeren Index — **aber unvollständig**, siehe B-16 und B-17 |
| B-14 `npm run backfill:bubble --apply` wirkt nicht | Niedrig | behoben — der Skript-Header nennt die `--`-Form ausdrücklich |
| B-15 `normaliseUrl()`-Catch-Zweig, kein Test für das Skript | Niedrig | **offen** — Catch-Zweig lowercased weiterhin den ganzen String, `scripts/` hat keinen Test |
| B-18 Middleware-Ausnahme ist ein Präfix-Match | Niedrig (neu) | **offen** — `pathname.startsWith('/api/cron')` nimmt auch `/api/cronjobs`, `/api/cron-admin` usw. von der Session-Prüfung aus. Heute folgenlos (keine solche Route, Next liefert 404), aber eine künftige Route mit diesem Präfix wäre ungeschützt. Sauberer: `'/api/cron/'` bzw. exakter Präfix-Vergleich. Verstärkt B-5. |

### Security-Audit (Red Team)
- **Auth-Bypass:** `/api/cron/bubble-sync` ist seit dem Middleware-Fix nur durch die eigene
  `CRON_SECRET`-Prüfung geschützt. Sie sitzt vor jeder Verarbeitung, prüft zuerst auf ein
  gesetztes Secret (sonst 500 — kein `Bearer undefined`-Bypass) und vergleicht dann exakt.
  GET delegiert an POST, keine zweite Codepfad-Variante. Kein Bypass gefunden.
- **Präfix-Match in der Middleware:** siehe B-18. Kein aktuell ausnutzbarer Pfad.
- **Informationsleck:** ohne Token `401 {"error":"Nicht autorisiert"}`, bei unerwarteten Fehlern
  `500 {"error":"Interner Serverfehler"}` — die Meldung bleibt im Server-Log. Kein Hinweis auf
  Konfiguration oder Datenbestand.
- **Secrets:** keine Hardcodes. `BUBBLE_API_TOKEN` fließt ausschließlich in den
  `Authorization`-Header und taucht in keiner Log- oder Fehlermeldung auf — Throw-Texte und die
  neuen `console.error`-Zeilen in `client.ts` enthalten nur Statuscode und Bubble-Body (max. 2000
  Zeichen). Alle vier `BUBBLE_*` in `.env.local.example` dokumentiert, kein `NEXT_PUBLIC_`-Präfix.
- **Datenabfluss Richtung Bubble:** `toBubbleRecord()` überträgt nur die sieben gemappten Felder,
  keine Supabase-IDs, keine Nutzer- oder Quellen-Metadaten.
- **Injection:** Der NDJSON-Body entsteht per `JSON.stringify` pro Datensatz. Probe mit einem
  Artikeltitel, der einen Zeilenumbruch enthält: wird zu `\n` escaped, der Body bleibt einzeilig —
  eine Zeilen-Injection, die die positionelle Zuordnung verschieben könnte, ist nicht möglich.
- **SSRF:** `BUBBLE_API_BASE_URL` ist serverseitig konfiguriert, kein Nutzereinfluss auf das
  Fetch-Ziel. `toPublisher()` parst die Artikel-URL, ruft sie nicht ab.
- **Neue Spalten in API-Antworten:** `/api/articles` und `/api/articles/[id]` selektieren explizite
  Spaltenlisten, kein `select('*')` auf `articles`. `bubble_id`/`bubble_synced_at` werden von
  keiner Route ausgeliefert.
- **Backfill-Skript:** liest den Supabase Service-Role-Key und umgeht damit RLS. Lokales
  Einmal-Skript, nicht im Deployment-Pfad, in keiner Route importiert — korrekt. Die
  Journal-Dateien (`scripts/.backfill-journal-*.json`) sind neu in `.gitignore`; sie enthalten
  Supabase- und Bubble-IDs, keine Secrets.
- **Rate Limiting / Nebenläufigkeit:** keines auf `/api/cron/*`. Ohne Secret passiert nichts; mit
  Secret sind zwei parallele Läufe möglich, die dieselbe ungestempelte Menge lesen und doppelt
  nach Bubble schreiben. `stampSynced()` hat keinen `.is('bubble_synced_at', null)`-Guard (das
  Backfill-Skript hat ihn). Kein Lock vorhanden — praktisch nur bei manuellem Zusatz-Trigger
  relevant, als Hinweis notiert.

### Regression
- `test` 169/169 grün, darunter die vollständigen Suiten zu NEWS-3/4/5 (Scraping), NEWS-6
  (Artikel-Validierung), NEWS-9 (Kategorien) und `env`.
- Migration rein additiv, ohne `not null` und ohne Default — die Inserts der Scraping-Engine
  (NEWS-3/4/5) sind nicht betroffen.
- Middleware: `/dashboard`-Schutz, `/api`-Schutz und die Login-Weiterleitung unverändert;
  ausgenommen ist ausschließlich `/api/cron/*`. Keine Auswirkung auf NEWS-1.
- Keine gemeinsam genutzte Komponente berührt, keine UI-Datei geändert → keine visuellen
  Regressionen auf NEWS-7/8/15/16/17/18 möglich.
- Neu in `package.json` ist nur das Skript `backfill:bubble`; keine neue Dependency.

### Produktionsreife: **NEIN**
Kein kritischer Bug mehr offen — B-6, B-8 und B-11 sind geschlossen, der Sync-Pfad selbst ist
aus QA-Sicht produktionsreif und kann gegen `/version-test` laufen.

Blockierend sind die beiden **hohen** Punkte rund um den Altbestand: **B-2** (Backfill ist nicht
gelaufen, der erste Live-Lauf dupliziert sonst alles) und **B-16** (das Werkzeug dafür kann
stillschweigend das Gegenteil tun und den Altbestand als erledigt stempeln, ohne ihn je
übertragen zu haben). B-16 und B-17 müssen vor dem ersten `--apply` behoben sein, B-2 vor dem
ersten Lauf gegen die Live-Datenbank.
Danach offen, aber nicht blockierend: B-7 (mittel), B-5/B-9/B-10/B-15/B-18 (niedrig).

---

## QA-Ergebnis (2026-09-24, Re-Test Nr. 4 — Verifikation von B-16 und B-17)

**Testumfang:** gezielte Nachprüfung der beiden blockierenden Punkte aus dem Vorlauf (B-16, B-17)
mit eigenem Repro gegen einen nachgebauten Bubble-/PostgREST-Server; Kurzstatus aller übrigen
offenen Punkte; Regression.
**Stand:** Arbeitsverzeichnis, nicht committet — `.gitignore`, `features/*`, `package.json`,
`src/lib/bubble/client.ts`, `sync.ts`, `client.test.ts`; neu `src/lib/bubble/sync.test.ts`,
`scripts/backfill-bubble-synced.mjs`.
**Automatisierte Checks:** `typecheck` sauber · `lint` 0 Fehler / 13 Warnungen (alle vorbestehend)
· `test` **169/169** grün.
**Browser/Responsive:** nicht anwendbar — reine Backend-/Cron-Funktionalität ohne UI-Fläche.

### Kernbefund: der Stand ist unverändert

Der Arbeitsbaum entspricht exakt dem des Vorlaufs — dieselben geänderten Dateien, dieselbe
Testzahl (169, vorher ebenfalls 169), keine neue Migration, kein neuer Commit ausser dem bereits
bekannten `1e038e1`. **B-16 und B-17 sind nicht angefasst worden.** Beide wurden erneut
reproduziert und sind weiterhin blockierend.

### B-16 — Hoch, weiterhin offen (mit `--apply` verifiziert)
`assertIndexTrustworthy({ total, complete }, …)` (`scripts/backfill-bubble-synced.mjs:163`) liest
nach wie vor nur `total` und `complete`. `index.size` — die Zahl der Records mit verwertbarer URL —
steht in der eigenen Log-Zeile (`:372`), wird aber nicht geprüft.

Reproduziert (Fake-Bubble, 2 Records mit dem Feldnamen `Article Link` statt `Link Source URL`,
2 unsynchronisierte Artikel, diesmal **mit `--apply --target=test --confirm-test-target`**):
```
[Backfill] 2 Bubble-Records gelesen, 0 mit eindeutiger URL
[Backfill] URL-Treffer in Bubble: 0
[Backfill] Ohne Treffer: 2 — davon vor 2026-09-01: 2 (werden als synchronisiert markiert)
[Backfill] Fertig: 2 gestempelt, 0 fehlgeschlagen
```
Der Lauf bricht nicht ab, sondern stempelt den gesamten Altbestand als übertragen, obwohl kein
einziger Artikel je in Bubble war. Fix-Richtung unverändert: `total > 0 && index.size === 0` →
Abbruch; Warnung bei `index.size / total` unter ca. 90 %; `--allow-empty-index` darf das **nicht**
überschreiben.

### B-17 — Mittel, weiterhin offen (reproduziert)
`const remaining = payload?.response?.remaining ?? 0` (`:361`) macht ein **fehlendes** Feld zu
„0 verbleibend"; `:366` setzt daraufhin `complete = true`.

Reproduziert (Fake-Bubble, 2 Records auf 2 Seiten, Antwort ohne `remaining`):
```
[Backfill] Bubble-Seite 1: 1 Records, 0 verbleibend
[Backfill] 1 Bubble-Records gelesen, 1 mit eindeutiger URL
[Backfill] Ohne Treffer: 1 — davon vor 2026-09-01: 1 (werden als synchronisiert markiert)
```
Seite 2 wird nie abgefragt, kein Hinweis, `complete = true`. Fix-Richtung unverändert: nur
`typeof remaining === 'number' && remaining <= 0` (oder `results.length === 0`) darf `complete`
setzen.

### Akzeptanzkriterien — 15/15 unverändert bestanden
Der Sync-Pfad selbst (`client.ts`, `sync.ts`, `mapping.ts`, Route, `vercel.json`) ist gegenüber
dem Vorlauf unverändert; die dort im Detail geführte Prüfung gilt weiter. B-6, B-8 und B-11
bleiben geschlossen, kein kritischer Bug offen.

### Kurzstatus der übrigen Punkte (alle unverändert)
| Bug | Schwere | Status |
|---|---|---|
| B-2 Altbestand wird komplett übertragen | Hoch | **offen** — keine Backfill-Migration, Skript nachweislich nicht produktiv gelaufen. Hängt an B-16/B-17. |
| B-7 Bubble-Timeouts sprengen `maxDuration` | Mittel | **offen** — `maxDuration = 60`, `REQUEST_TIMEOUT_MS = 30_000`, `MAX_ARTICLES_PER_RUN = 1000` |
| B-5 kein Test erzwingt `CRON_SECRET` | Niedrig | **offen** — 0 Testdateien unter `src/app/api/cron/` |
| B-9 flaches Fehler-Envelope | Niedrig | **offen (Restrisiko bei Batchgröße 1)** |
| B-10 Summe geht bei Stempelfehlern nicht auf | Niedrig | **offen** — `stampSynced()` zählt einen Stempelfehler weder in `articles_synced` noch `articles_failed` |
| B-15 `normaliseUrl()`-Catch-Zweig, kein Test für `scripts/` | Niedrig | **offen** — 0 Testdateien unter `scripts/` |
| B-18 Middleware-Präfix-Match | Niedrig | **offen** — `middleware.ts:41` weiterhin `!pathname.startsWith('/api/cron')` ohne abschliessenden Slash |

### Security-Audit
Kein Delta zum Vorlauf: keine Änderung an Auth, Middleware, Routen oder Secrets-Handhabung.
`/api/cron/*` weiterhin ausschliesslich per `CRON_SECRET` erreichbar, Fehlerantworten ohne
Informationsleck, kein Token in Logs, kein Rate Limit / Lock gegen parallele Läufe (unverändert
notiert). `stampSynced()` in `sync.ts` hat weiterhin keinen `.is('bubble_synced_at', null)`-Guard,
anders als das Backfill-Skript.

### Regression
`test` 169/169 grün inkl. NEWS-3/4/5/6/9 und `env`. Keine Migration, keine Routen- oder
UI-Änderung — keine visuellen Regressionen auf NEWS-7/8/15/16/17/18 möglich.

### Produktionsreife: **NEIN**
Unverändert blockierend: **B-16 (hoch)** und **B-2 (hoch)**, dazu B-17 (mittel) als Voraussetzung
für einen vertrauenswürdigen Backfill. B-16 und B-17 müssen vor dem ersten `--apply` behoben sein,
B-2 vor dem ersten Lauf gegen die Live-Datenbank. Der Sync-Pfad selbst kann weiterhin gegen
`/version-test` laufen.

---

## QA-Ergebnis (2026-09-24, Re-Test Nr. 5 — Verifikation von B-16 und B-17)

**Testumfang:** gezielte Nachprüfung der beiden blockierenden Punkte des Vorlaufs (B-16, B-17)
mit eigenem Repro gegen einen nachgebauten Bubble-/PostgREST-Server; unabhängige Angriffs-Probes
gegen `bulkCreate()` (nicht aus der bestehenden Suite); Kurzstatus aller übrigen offenen Punkte;
Security-Audit; Regression.
**Stand:** Arbeitsverzeichnis, nicht committet — `.gitignore`, `features/*`, `package.json`,
`src/lib/bubble/client.ts`, `sync.ts`, `client.test.ts`; neu `src/lib/bubble/sync.test.ts`,
`scripts/backfill-bubble-synced.mjs` (seit dem Vorlauf überarbeitet).
**Automatisierte Checks:** `typecheck` sauber · `lint` 0 Fehler / 13 Warnungen (alle vorbestehend,
keine in `src/lib/bubble/` oder `scripts/`) · `test` **169/169** grün (unverändert — die Fixes
dieses Laufs liegen im ungetesteten `scripts/`, siehe B-15).
**Browser/Responsive:** nicht anwendbar — NEWS-19 ist reine Backend-/Cron-Funktionalität ohne
UI-Fläche, ein Dashboard-Button ist explizit Out of Scope.

### B-16 — behoben, unabhängig verifiziert
`assertIndexTrustworthy()` prüft jetzt auch `index.size` (`scripts/backfill-bubble-synced.mjs:179`):
`total > 0 && index.size === 0` → Abbruch mit Hinweis auf `BUBBLE_URL_FIELD`, **nicht** über
`--allow-empty-index` übersteuerbar. Zusätzlich eine laute Warnung unterhalb von 90 % verwertbarer
URLs (`:191`).

Repro des Vorlaufs (Fake-Bubble, 2 Records mit dem Feldnamen `Article Link` statt
`Link Source URL`, 2 unsynchronisierte Artikel, `--apply --target=test --confirm-test-target
--cutoff=2026-09-01`):
```
[Backfill] 2 Bubble-Records gelesen, 0 mit eindeutiger URL
[Backfill] Abgebrochen: Bubble-Index unbrauchbar: 2 Records gelesen, aber kein einziger
           mit verwertbarer URL im Feld "Link Source URL". … Es wird nichts geschrieben
exit=1, kein PATCH auf der Fake-DB
```

### B-17 — behoben, unabhängig verifiziert
`loadBubbleIndex()` beendet die Paginierung nur noch bei einer leeren Seite **oder** einem
explizit numerischen `remaining <= 0` (`:397-409`); ein fehlendes Feld wird als „unbekannt"
geloggt und weitergepagt. `MAX_PAGES` von 20 auf 200 erhöht.

Repro des Vorlaufs (2 Records auf 2 Seiten, Antwort **ohne** `remaining`):
```
[Backfill] Bubble-Seite 1: 1 Records, Feld "remaining" fehlt in der Antwort
[Backfill] Bubble-Seite 2: 1 Records, Feld "remaining" fehlt in der Antwort
[Backfill] Bubble-Seite 3: 0 Records, Feld "remaining" fehlt in der Antwort
[Backfill] 2 Bubble-Records gelesen, 2 mit eindeutiger URL → beide korrekt als Treffer gestempelt
```
Seite 2 wird jetzt gelesen, der Abbruch erfolgt erst auf Bubbles eigenem End-of-Data-Signal.

### Weitere eigene Probes gegen die Schutzgeländer des Skripts (alle bestanden)
| Probe | Erwartung | Ergebnis |
|---|---|---|
| B-16-Fall **plus** `--allow-empty-index` | Flag darf nicht übersteuern | Abbruch, exit=1 |
| Wirklich leerer Index, ohne Flag | Abbruch (B-13) | Abbruch, exit=1 |
| Wirklich leerer Index, mit Flag | läuft durch | Dry Run korrekt |
| 10 Records, nur 5 mit URL (50 %) | laute Warnung, kein Abbruch | Warnbanner, Lauf geht weiter |
| `--apply` ohne `--target` | Abbruch (B-12) | exit=1 |
| `--apply --target=live` bei `BUBBLE_USE_TEST_VERSION=true` | Ziel-Konflikt | exit=1 |
| `--apply --target=test` ohne `--confirm-test-target` | Abbruch | exit=1 |

### Eigene Probes gegen `bulkCreate()` (Sync-Pfad unverändert, trotzdem gegengeprüft)
| Probe (3 Datensätze) | Ergebnis |
|---|---|
| 400 mit nur 2 Erfolgszeilen (B-8-Repro) | Throw, kein Stempel |
| 200 mit HTML-Prefix + 3 Verdikten (B-11-Repro) | Throw |
| 200 mit 4 Verdikten für 3 Datensätze | Throw |
| 400 mit genau 3 Verdikten, mittleres abgelehnt | korrekt `[true,false,true]` — Teil-Erfolg ausgewertet |
| Leerer Body | Throw |
| 401 mit verschachteltem Envelope | Throw |
| Token im Config, 500er Antwort | Token taucht in der Fehlermeldung **nicht** auf |

### Akzeptanzkriterien — 15/15 bestanden
Der Sync-Pfad (`client.ts`, `sync.ts`, `mapping.ts`, Route, `vercel.json`) ist gegenüber dem
Vorlauf unverändert; die dort geführte Detailprüfung gilt weiter und wurde durch die obigen
Probes stichprobenartig bestätigt. B-6, B-8 und B-11 bleiben geschlossen, kein kritischer Bug offen.

**Ausstehend bleibt** die Ende-zu-Ende-Verifikation gegen `/version-test` mit einem bewusst
ungültigen Datensatz **in der Mitte** des Batches. Der Code ist in beiden Fällen sicher (er wirft
und stempelt nichts), aber ob Bubble im 400-Fall eine Zeile pro Datensatz liefert — und Teil-Erfolge
damit überhaupt auswertbar sind oder immer in den Retry laufen — ist weiterhin ungeklärt. Ebenso
ungeklärt: warum am 2026-09-23 rund 20 von 96 Zeilen abgelehnt wurden.

### Status aller Punkte
| Bug | Schwere | Status |
|---|---|---|
| B-1 Middleware-Fix nicht deployt | — | behoben (`1e038e1`) |
| B-2 Altbestand wird komplett übertragen | Hoch | **offen (operativ)** — keine Backfill-Migration, Skript nachweislich nicht produktiv gelaufen. Das Werkzeug ist nach B-16/B-17 jetzt aber vertrauenswürdig: Dry Run → `--apply --target=…` vor dem ersten Live-Lauf ausführen. |
| B-3 60-Sekunden-Limit | Mittel | im Kern behoben → Rest als B-7 |
| B-4 kein Test für `sync.ts` | Niedrig | behoben |
| B-5 kein Test erzwingt `CRON_SECRET` | Niedrig | **offen** — 0 Testdateien unter `src/app/api/` |
| B-6 HTTP 400 verwirft Teil-Erfolg | Kritisch | behoben |
| B-7 Bubble-Timeouts sprengen `maxDuration` | Mittel | **offen** — `maxDuration = 60`, `REQUEST_TIMEOUT_MS = 30_000`, `MAX_ARTICLES_PER_RUN = 1000` unverändert |
| B-8 positionelle Zuordnung ungeprüft | Kritisch | behoben |
| B-9 flaches Fehler-Envelope | Niedrig | **offen (Restrisiko nur bei Batchgröße 1)** |
| B-10 Summe geht bei Stempelfehlern nicht auf | Niedrig | **offen** — `stampSynced()` zählt einen Stempelfehler weder in `articles_synced` noch `articles_failed` |
| B-11 zwei Zählweisen | Kritisch | behoben |
| B-12 Backfill-Ziel nicht bestätigt | Hoch | behoben — alle drei Abbrüche erneut verifiziert |
| B-13 unvollständiger/leerer Index | Mittel | behoben — zusammen mit B-16/B-17 jetzt vollständig |
| B-14 `npm run … --apply` wirkt nicht | Niedrig | behoben (Skript-Header) |
| B-15 `normaliseUrl()`-Catch-Zweig, kein Test für `scripts/` | Niedrig | **offen** — 0 Testdateien unter `scripts/`; das Skript ist inzwischen ~23 KB Logik mit mehreren datenkritischen Entscheidungen und weiterhin nur manuell geprüft. Zusätzlich: ein Bubble-Record ohne `_id` wird als Treffer mit `bubble_id: null` gestempelt. |
| B-16 Backfill stempelt bei unbrauchbarem Index | Hoch | **behoben**, unabhängig verifiziert |
| B-17 fehlendes `remaining` beendet Paginierung | Mittel | **behoben**, unabhängig verifiziert |
| B-18 Middleware-Präfix-Match | Niedrig | **offen** — `middleware.ts:41` weiterhin `!pathname.startsWith('/api/cron')` ohne abschliessenden Slash |

### Security-Audit (Red Team)
- **Auth-Bypass:** kein Delta. `/api/cron/bubble-sync` ist nur durch die eigene `CRON_SECRET`-Prüfung
  geschützt; sie sitzt vor jeder Verarbeitung, prüft zuerst auf ein gesetztes Secret (sonst 500 —
  kein `Bearer undefined`-Bypass) und vergleicht dann exakt. GET delegiert an POST. Kein Bypass gefunden.
- **Präfix-Match in der Middleware:** B-18 unverändert, kein aktuell ausnutzbarer Pfad (Next liefert
  404 für `/api/cronjobs`), aber eine künftige Route mit diesem Präfix wäre ohne Session-Prüfung.
- **Informationsleck:** ohne Token `401 {"error":"Nicht autorisiert"}`, unerwartete Fehler
  `500 {"error":"Interner Serverfehler"}`. Keine Angaben zu Konfiguration oder Datenbestand.
- **Secrets:** per Probe bestätigt — ein 500er von Bubble erzeugt eine Fehlermeldung **ohne**
  `BUBBLE_API_TOKEN`. Keine Hardcodes, alle vier `BUBBLE_*` in `.env.local.example`, kein
  `NEXT_PUBLIC_`-Präfix. Das Backfill-Skript trägt den Token nur im `Authorization`-Header.
- **Injection:** NDJSON entsteht per `JSON.stringify` pro Datensatz; ein Zeilenumbruch im
  Artikeltitel wird escaped — eine Zeilen-Injection, die die positionelle Zuordnung verschieben
  könnte, ist nicht möglich.
- **SSRF:** `BUBBLE_API_BASE_URL` serverseitig konfiguriert, kein Nutzereinfluss auf das Fetch-Ziel.
  `toPublisher()` parst die Artikel-URL, ruft sie nicht ab.
- **Neue Spalten:** `/api/articles` und `/api/articles/[id]` selektieren explizite Spaltenlisten,
  kein `select('*')` — `bubble_id`/`bubble_synced_at` werden von keiner Route ausgeliefert.
- **Backfill-Skript:** nutzt den Supabase Service-Role-Key und umgeht RLS. Lokales Einmal-Skript,
  nicht im Deployment-Pfad, in keiner Route importiert — korrekt. Journal-Dateien sind gitignored
  und enthalten nur IDs, keine Secrets.
- **Rate Limiting / Nebenläufigkeit:** unverändert keines auf `/api/cron/*`. Mit gültigem Secret sind
  zwei parallele Läufe möglich, die dieselbe ungestempelte Menge lesen und doppelt nach Bubble
  schreiben. `stampSynced()` in `sync.ts` hat weiterhin **keinen** `.is('bubble_synced_at', null)`-Guard,
  anders als `stamp()` im Backfill-Skript. Praktisch nur bei manuellem Zusatz-Trigger relevant.

### Regression
- `test` 169/169 grün, darunter die vollständigen Suiten zu NEWS-3/4/5 (Scraping), NEWS-6
  (Artikel-Validierung), NEWS-9 (Kategorien) und `env`.
- Migration rein additiv, ohne `not null` und ohne Default — die Inserts der Scraping-Engine
  (NEWS-3/4/5) sind nicht betroffen.
- Middleware unverändert gegenüber `1e038e1`: `/dashboard`-Schutz, `/api`-Schutz und die
  Login-Weiterleitung intakt, ausgenommen ist ausschliesslich `/api/cron/*`. Keine Auswirkung auf NEWS-1.
- Keine UI-Datei und keine gemeinsam genutzte Komponente berührt → keine visuellen Regressionen
  auf NEWS-7/8/15/16/17/18 möglich.
- Gegenüber dem Vorlauf geändert wurde ausschliesslich `scripts/backfill-bubble-synced.mjs`, das in
  keiner Route und keinem Build-Schritt importiert wird — kein Risiko für die laufende Anwendung.

### Produktionsreife: **JA, mit einer Auflage**
Kein kritischer und kein hoher Bug mehr im Code offen. B-16 und B-17 — die Blocker des Vorlaufs —
sind behoben und unabhängig verifiziert; damit ist das Backfill-Werkzeug vertrauenswürdig.

**Auflage (B-2, operativ):** Vor dem ersten Lauf gegen die **Live**-Datenbank muss
`scripts/backfill-bubble-synced.mjs` tatsächlich ausgeführt werden (erst Dry Run prüfen, dann
`--apply --target=live`). Ohne diesen Schritt dupliziert der erste Live-Lauf den gesamten
Altbestand. Gegen `/version-test` kann der Sync ohne Auflage laufen.

Nicht blockierend offen: B-7 (mittel), B-5/B-9/B-10/B-15/B-18 (niedrig).

---

## QA-Ergebnis (2026-09-24, Re-Test Nr. 6 — unabhängige Gegenprüfung)

**Testumfang:** vollständige Gegenprüfung aller 15 Akzeptanzkriterien am Code, eigene
Angriffs-Probes gegen `bulkCreate()` (neu geschrieben, **nicht** aus der bestehenden Suite
abgeleitet), Kurzstatus aller offenen Punkte, Security-Audit, Regression.
**Stand:** Arbeitsverzeichnis, nicht committet. **Gegenüber Re-Test Nr. 5 hat sich am Code
nichts geändert** — `client.ts`/`sync.ts`/`client.test.ts`/`sync.test.ts` datieren auf 12:00–12:01,
`scripts/backfill-bubble-synced.mjs` auf 13:47, alle vom Vorlauf. Dieser Lauf ist daher eine
unabhängige Verifikation, keine Fix-Abnahme.
**Automatisierte Checks:** `typecheck` sauber · `lint` 0 Fehler / 13 Warnungen (alle vorbestehend,
keine in `src/lib/bubble/` oder `scripts/`) · `test` **169/169** grün.
**Browser/Responsive:** nicht anwendbar — reine Backend-/Cron-Funktionalität, kein UI
(Dashboard-Button ist explizit Out of Scope).

### Eigene Probes gegen `bulkCreate()` (11 Probes, 10 bestanden, 1 Fund)

| # | Probe (Body → eingereichte Datensätze) | Erwartung | Ergebnis |
|---|---|---|---|
| P1 | CRLF-Zeilenenden, 2 Verdikte / 2 Datensätze | korrekt geparst | PASS |
| P2 | JSON-**Array**-Zeile `[1,2]` + 1 Verdikt / 2 | Throw (unzuordenbar) | PASS |
| P3 | flaches Envelope `{"status":"ERROR","message":…}` / **1** | siehe B-9 | als Ablehnung gewertet, kein Throw — B-9 bestätigt |
| P4 | Zeile aus reinem Whitespace zwischen 2 Verdikten / 2 | ignoriert | PASS |
| P5 | `{"status":"success"}` **ohne** `id` / 2 | Misserfolg, kein Stempel | PASS |
| P6 | `{"status":"success","id":123}` (Zahl statt String) / 2 | Throw oder Misserfolg | **FAIL → B-19** |
| P7 | leerer Body / 2 | Throw | PASS |
| P8 | 500 mit HTML-Body | Throw, Token nicht in der Meldung | PASS |
| P9 | `fetch` wirft `ECONNRESET` | propagiert | PASS |
| P10 | 400 mit genau 3 Verdikten, mittleres abgelehnt | `[true,false,true]` | PASS — Teil-Erfolg korrekt ausgewertet |
| P11 | Ziel-URL bei `useTestVersion` | `…/version-test/api/1.1/obj/<type>/bulk` | PASS |

Damit sind B-6, B-8 und B-11 unabhängig als geschlossen bestätigt: jede Antwort — 2xx wie
non-2xx — wird nur ausgewertet, wenn die Zahl der **nicht-leeren** Zeilen und die Zahl der
**parsebaren** Statuszeilen beide exakt der Zahl der eingereichten Datensätze entsprechen
(`client.ts:112-142`). Beide Zählungen gehen über dieselbe Quelle `splitResponseLines()`.

### B-19 — Niedrig (neu): nicht-stringige `id` wird ungeprüft als `bubble_id` gestempelt
`parseStatusLine()` verlangt nur, dass **eines** der Felder `status`/`id`/`message` ein String ist.
Bei `{"status":"success","id":123}` greift die Prüfung über `status`, anschliessend wird
`parsed.id` per Cast als `string` behandelt und ungeprüft durchgereicht.

Reproduziert (2 Datensätze, HTTP 200):
```
Body:   {"status":"success","id":123}\n{"status":"success","id":"b"}
Ergebnis: [ { success: true, id: 123 }, { success: true, id: "b" } ]
                                 ^ number, obwohl BubbleCreateResult.id: string
```
**Auswirkung gering:** Bubble liefert `_id` real immer als String; der Wert würde von PostgREST
in die `text`-Spalte serialisiert oder mit einem Stempelfehler abgelehnt (dann greift B-10).
Kein Datenverlust, aber der Typ-Vertrag von `BubbleCreateResult` ist nicht durchgesetzt.
**Fix-Richtung:** in `parseStatusLine()` nicht-stringige `id`/`status`/`message` verwerfen
(Zeile gilt dann als unlesbar → Batch schlägt fehl, nichts wird gestempelt).

### Akzeptanzkriterien — 15/15 bestanden

**Erkennung neuer Artikel — 4/4** · Migration additiv (`add column if not exists`), beide Spalten
nullable · `loadUnsyncedArticles()` `.is('bubble_synced_at', null).order('created_at', asc).limit(1000)`
· Stempel ausschliesslich über `accepted`, das `outcome.success === true` **und** eine vorhandene
`id` voraussetzt (P5 belegt: kein `bubble_id: null` auf diesem Weg) · Partieller Index
`articles_bubble_unsynced_idx on (created_at) where bubble_synced_at is null`.

**Übertragung — 5/5** · Bulk-URL inkl. `/version-test` (P11) · NDJSON, `text/plain`, Bearer ·
`BATCH_SIZE = 100`, `MAX_ARTICLES_PER_RUN = 1000` · `BUBBLE_USE_TEST_VERSION === 'true'`
(strikter Vergleich, jeder andere Wert = live) · `toBubbleRecord()` lässt leere optionale Felder weg.

**Fehlerbehandlung — 4/4** · Transportfehler → ganzer Batch ungestempelt (P9) · Einzelablehnungen
stoppen Folgebatches nicht (P10) · abgeschnittene Antwort gilt nie als Erfolg — jetzt **ohne** die
Einschränkung des Vorlaufs, weil der Zeilenzahl-Check für jede Antwort gilt (P2, P7) · fehlende
Konfiguration → `skipped_reason`, Exit ohne Fehler.

**Zeitplan & Zugriff — 2/2** · `GET|POST /api/cron/bubble-sync`, `CRON_SECRET` vor jeder
Verarbeitung geprüft, fehlendes Secret → 500 (kein `Bearer undefined`-Bypass), GET delegiert an
POST · `vercel.json`: `0 6 * * *`, nach Retention (03:00) und den 15-Minuten-Scrapes.

### Status aller Punkte (Delta zu Re-Test Nr. 5: nur B-19 neu)

| Bug | Schwere | Status |
|---|---|---|
| B-1 · B-3 · B-4 · B-6 · B-8 · B-11 · B-12 · B-13 · B-14 · B-16 · B-17 | — | behoben, in diesem Lauf stichprobenartig nachgeprüft |
| B-2 Altbestand wird komplett übertragen | Hoch | **offen (operativ)** — keine Backfill-Migration; das Skript ist nachweislich nicht produktiv gelaufen. Bleibt die Auflage vor dem ersten Live-Lauf. |
| B-7 Bubble-Timeouts sprengen `maxDuration` | Mittel | **offen** — `maxDuration = 60` vs. 10 Calls × `REQUEST_TIMEOUT_MS = 30_000` unverändert |
| B-5 kein Test erzwingt `CRON_SECRET` | Niedrig | **offen** — 0 Testdateien unter `src/app/api/` (verifiziert) |
| B-9 flaches Fehler-Envelope | Niedrig | **offen** — durch P3 erneut reproduziert; Restrisiko nur bei Batchgrösse 1, Verhalten bleibt fehlersicher (nichts gestempelt, Retry am Folgetag), betroffen ist nur die Diagnose |
| B-10 Summe geht bei Stempelfehlern nicht auf | Niedrig | **offen** — `sync.ts:195-207` zählt einen Stempelfehler weder in `articles_synced` noch `articles_failed` |
| B-15 kein Test für `scripts/` | Niedrig | **offen** — 0 Testdateien unter `scripts/` (verifiziert); zusätzlich `backfill:389` `index.set(key, record?._id ?? null)` → ein Bubble-Record ohne `_id` wird als Treffer mit `bubble_id: null` gestempelt |
| B-18 Middleware-Präfix-Match | Niedrig | **offen** — `middleware.ts:41` `!pathname.startsWith('/api/cron')` ohne abschliessenden Slash |
| B-19 nicht-stringige `id` | Niedrig | **neu, offen** |

### Security-Audit (Red Team)
- **Auth-Bypass:** kein Delta, kein Bypass gefunden. `/api/cron/bubble-sync` prüft `CRON_SECRET`
  vor jeder Verarbeitung; fehlendes Secret → 500 statt Vergleich gegen `Bearer undefined`.
  GET delegiert an POST, es gibt keinen dritten Einstieg. Middleware nimmt ausschliesslich
  `/api/cron` aus der Session-Prüfung — B-18 bleibt als künftiges Risiko bestehen (eine Route
  `/api/cron-admin` wäre ohne Session-Schutz), heute nicht ausnutzbar (404).
- **Secrets:** per Probe P8 bestätigt — ein 500er von Bubble erzeugt eine Fehlermeldung, die den
  `BUBBLE_API_TOKEN` nicht enthält; der Token fliesst ausschliesslich in den `Authorization`-Header.
  Keine Hardcodes in `src/lib/bubble/` oder `scripts/`. Alle vier `BUBBLE_*` sowie `CRON_SECRET`
  sind in `.env.local.example` mit Dummy-Werten dokumentiert, kein `NEXT_PUBLIC_`-Präfix.
- **Injection:** NDJSON entsteht per `JSON.stringify` **pro Datensatz**; ein Zeilenumbruch im
  gescrapten Artikeltitel wird zu `\n` escaped. Eine Zeilen-Injection, die die positionelle
  Zuordnung verschieben könnte, ist damit ausgeschlossen. Gegen die Antwortseite schützt zusätzlich
  der Zeilenzahl-Check.
- **Informationsleck:** ohne Token `401 {"error":"Nicht autorisiert"}`, unerwartete Fehler
  `500 {"error":"Interner Serverfehler"}`. Keine Angaben zu Konfiguration oder Datenbestand.
  Der 200er-Body enthält `errors[]` mit Artikeltiteln — nur mit gültigem Secret erreichbar,
  Titel sind ohnehin öffentliche News.
- **SSRF:** `BUBBLE_API_BASE_URL` serverseitig konfiguriert, kein Nutzereinfluss auf das Fetch-Ziel.
  `toPublisher()` parst die Artikel-URL, ruft sie nicht ab.
- **Neue Spalten:** `/api/articles` und `/api/articles/[id]` selektieren explizite Spaltenlisten,
  kein `select('*')` — `bubble_id`/`bubble_synced_at` werden von keiner Route ausgeliefert.
- **Datenabfluss Richtung Bubble:** `toBubbleRecord()` überträgt nur die sieben gemappten Felder,
  keine Supabase-IDs, keine Nutzer- oder Quellen-Metadaten.
- **Backfill-Skript:** nutzt den Service-Role-Key und umgeht RLS — lokales Einmal-Skript, in keiner
  Route und keinem Build-Schritt importiert, korrekt ausserhalb des Deployment-Pfads. Journal-Dateien
  sind gitignored (`scripts/.backfill-journal-*.json`) und enthalten nur IDs. Das `UPDATE` trägt
  `.is('bubble_synced_at', null)` und kann einen Sync-Stempel nicht überschreiben — verifiziert.
- **Rate Limiting / Nebenläufigkeit:** unverändert keines auf `/api/cron/*`. Mit gültigem Secret sind
  zwei parallele Läufe möglich, die dieselbe ungestempelte Menge lesen und doppelt nach Bubble
  schreiben; `stampSynced()` in `sync.ts` hat — anders als `stamp()` im Backfill-Skript — **keinen**
  `.is('bubble_synced_at', null)`-Guard. Praktisch nur bei manuellem Zusatz-Trigger relevant,
  als Hinweis geführt.

### Regression
- `test` 169/169 grün, darunter die vollständigen Suiten zu NEWS-3/4/5 (Scraping), NEWS-6
  (Artikel-Validierung), NEWS-9 (Kategorien), NEWS-14 (Feed-Detection) und `env`.
- Migration rein additiv, ohne `not null` und ohne Default — die Inserts der Scraping-Engine
  (NEWS-3/4/5) sind nicht betroffen.
- Middleware unverändert gegenüber `1e038e1`: `/dashboard`-Schutz, `/api`-Schutz und die
  Login-Weiterleitung intakt, ausgenommen ist ausschliesslich `/api/cron/*`. Keine Auswirkung auf NEWS-1.
- Keine UI-Datei und keine gemeinsam genutzte Komponente berührt → keine visuellen Regressionen
  auf NEWS-7/8/15/16/17/18 möglich.
- Gegenüber Re-Test Nr. 5 wurde keine Produktivdatei geändert — kein neues Regressionsrisiko.

### Ende-zu-Ende: weiterhin ausstehend (nicht blockierend)
Ein Lauf gegen `/version-test` mit einem bewusst ungültigen Datensatz **in der Mitte** des Batches
steht nach wie vor aus. Der Code ist in beiden möglichen Ausgängen sicher (Zeilenzahl passt →
Teil-Erfolg korrekt ausgewertet, P10; Zeilenzahl passt nicht → Throw, nichts gestempelt, P2/P7).
Offen bleibt damit nur die Frage, ob Teil-Erfolge in der Praxis auswertbar sind oder immer in den
Retry laufen — und warum am 2026-09-23 rund 20 von 96 Zeilen abgelehnt wurden.

### Produktionsreife: **JA, mit einer Auflage** (unverändert gegenüber Re-Test Nr. 5)
Kein kritischer und kein hoher Bug im Code offen. Der einzige Neufund dieses Laufs, B-19, ist
niedrig und nicht blockierend.

**Auflage (B-2, operativ):** Vor dem ersten Lauf gegen die **Live**-Datenbank muss
`scripts/backfill-bubble-synced.mjs` tatsächlich ausgeführt werden — erst Dry Run prüfen, dann
`--apply --target=live`. Ohne diesen Schritt dupliziert der erste Live-Lauf den gesamten Altbestand.
Gegen `/version-test` kann der Sync ohne Auflage laufen.

Nicht blockierend offen: B-7 (mittel), B-5/B-9/B-10/B-15/B-18/B-19 (niedrig).
