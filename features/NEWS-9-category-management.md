# NEWS-9: Kategorie-Verwaltung

**Status:** In Review
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

---

## Tech Design (Solution Architect)

**Tabelle:** `categories` (id, name, description, created_at, updated_at)

**API-Routen:** `GET/POST /api/categories`, `PUT/DELETE /api/categories/[id]`

**Frontend:** `/dashboard/categories` — shadcn `Table` mit inline Edit-/Löschen-Buttons (nur Admin). Formular als shadcn `Dialog` oder eigene Seite.

**Artikel-Zählung:** `SELECT COUNT(*) FROM article_categories WHERE category_id = ?` — wird im Kategorien-Listing als berechnete Spalte angezeigt.

**RLS:** Lesen für alle eingeloggten User. Schreiben nur für `admin`.

**Neue Packages:** Keine

---

## QA Test Results

**Tested:** 2026-03-06
**App URL:** http://localhost:3000
**Tester:** QA Engineer (AI)
**Build Status:** PASS (production build compiles without errors)

### Acceptance Criteria Status

#### AC-1: Formular - Name (Pflichtfeld), Beschreibung (Pflichtfeld, Freitext, min. 20 Zeichen)
- [x] Name field present with required indicator (*)
- [x] Description field present with required indicator (*)
- [x] Zod validation enforces `name.min(1)` and `description.min(20)` server-side
- [x] Client-side character counter shows current description length
- [x] Client-side warning when description < 20 chars ("Mindestens 20 Zeichen erforderlich")
- [x] Name maxLength capped at 100 characters in both HTML attribute and Zod schema
- [x] Trim applied to both fields in Zod schema

#### AC-2: Name muss projektweit eindeutig sein (case-insensitive)
- [x] Database has `CREATE UNIQUE INDEX idx_categories_name_lower ON categories (LOWER(name))` -- enforces case-insensitive uniqueness
- [x] API POST returns 409 with message containing the duplicate name on unique constraint violation (error code 23505)
- [x] API PUT also handles 23505 for update conflicts

#### AC-3: Kategorien-Uebersicht zeigt Name, Beschreibung (gekuerzt), Anzahl zugeordneter Artikel, Aktionen
- [x] Table columns: Name, Beschreibung, Artikel (count badge), Aktionen (edit/delete) -- all present
- [x] Description truncated at 80 characters with "..." and tooltip for full text
- [ ] BUG: Article count always shows 0 (see BUG-1)
- [x] Edit button with pencil icon, delete button with trash icon
- [x] Aktionen column only rendered when isAdmin=true

#### AC-4: Loeschen mit zugeordneten Artikeln zeigt Warnung
- [x] Delete dialog shows article count warning: "X Artikel sind dieser Kategorie zugeordnet"
- [x] Warning explains articles will not be deleted, only lose the category assignment
- [x] DB schema uses ON DELETE SET NULL for articles.category_id and ON DELETE CASCADE for article_categories
- [ ] BUG: Warning count always shows 0 due to BUG-1, so users never see the warning even when articles are assigned

#### AC-5: Nur Admin kann anlegen/bearbeiten/loeschen
- [x] POST /api/categories uses `requireAdmin()` -- returns 403 for non-admin
- [x] PUT /api/categories/[id] uses `requireAdmin()` -- returns 403 for non-admin
- [x] DELETE /api/categories/[id] uses `requireAdmin()` -- returns 403 for non-admin
- [x] RLS policies enforce admin-only INSERT, UPDATE, DELETE at database level (defense in depth)
- [x] Frontend conditionally renders "Neue Kategorie" button only when isAdmin=true
- [x] Frontend conditionally renders edit/delete action buttons only when isAdmin=true

#### AC-6: Normale User sehen Kategorien read-only
- [x] GET /api/categories uses `requireAuth()` (not requireAdmin) -- available to all authenticated users
- [x] RLS SELECT policy allows all authenticated users
- [x] UI hides form dialogs and action buttons when isAdmin=false
- [x] Empty state shows different message for non-admin ("Es wurden noch keine Kategorien definiert.")

#### AC-7: Navigation - Eigener Menuepunkt "Kategorien" im Dashboard-Sidebar
- [x] "Kategorien" link present in header navigation (`navLinks` array) with Tags icon
- [x] Links to /dashboard/categories
- [x] Visible to all users (in navLinks, not adminLinks)
- [x] Admin-only edit functions only appear in the page itself, not in navigation

### Edge Cases Status

#### EC-1: Name bereits vergeben
- [x] Server returns 409 with "Eine Kategorie mit dem Namen 'X' existiert bereits"
- [x] Error displayed in form dialog via Alert component

#### EC-2: Beschreibung zu kurz (< 20 Zeichen)
- [x] Server Zod validation rejects with "Beschreibung muss mindestens 20 Zeichen haben"
- [x] Client shows amber warning with counter (X/20) before submission
- [x] Tip text explains importance for KI-Kategorisierung

#### EC-3: Letzte verbleibende Kategorie loeschen
- [x] No special prevention logic -- delete always allowed regardless of remaining count
- [x] Empty state renders correctly after all categories deleted

#### EC-4: Kategorie geloescht waehrend Scraping-Job laeuft
- [x] DB uses ON DELETE SET NULL for articles.category_id -- no crash if category disappears mid-scrape
- [x] article_categories uses ON DELETE CASCADE -- junction rows cleaned up automatically

#### EC-5: Sehr viele Kategorien (> 50)
- [x] Table is inside overflow-x-auto container, so it scrolls horizontally on small screens
- [ ] BUG: No vertical scroll limitation or virtualization, but spec says "scrollbar, kein Pager noetig in v1" -- acceptable for v1

### Security Audit Results

#### Authentication
- [x] All API endpoints require authentication (requireAuth/requireAdmin)
- [x] Dashboard page redirects to /login if no user session
- [x] Unauthenticated GET /api/categories returns 401

#### Authorization
- [x] Non-admin users cannot create categories (403 from requireAdmin + RLS)
- [x] Non-admin users cannot update categories (403 from requireAdmin + RLS)
- [x] Non-admin users cannot delete categories (403 from requireAdmin + RLS)
- [x] RLS provides defense-in-depth even if API auth is bypassed
- [ ] BUG: No UUID format validation on [id] parameter (see BUG-3)

#### Input Validation
- [x] All inputs validated server-side with Zod before processing
- [x] XSS via name/description: React auto-escapes JSX output -- no dangerouslySetInnerHTML used
- [x] SQL injection: Supabase client uses parameterized queries

#### Rate Limiting
- [ ] BUG: No rate limiting on any category API endpoints (see BUG-4)

#### Data Exposure
- [x] API responses contain only category fields (id, name, description, article_count, created_at, updated_at) -- no sensitive data leaked
- [x] Error messages do not expose internal details (stack traces, SQL errors)

#### Security Headers
- [x] X-Frame-Options: DENY configured in next.config.ts
- [x] X-Content-Type-Options: nosniff configured
- [x] Referrer-Policy: origin-when-cross-origin configured
- [x] Strict-Transport-Security with includeSubDomains configured

### Bugs Found

#### BUG-1: Article count always returns 0 (Critical)
- **Severity:** Critical
- **Steps to Reproduce:**
  1. Go to /dashboard/categories
  2. Observe the "Artikel" column in the table
  3. Expected: Shows the actual count of articles assigned to each category
  4. Actual: Always shows 0 for every category
- **Root Cause:** In `src/app/api/categories/route.ts` line 27, the code destructures `{ count, error: countError }` from `supabase.rpc()`. However, `supabase.rpc()` returns `{ data, error }`, not `{ count, error }`. The variable `count` is always `undefined`, and the fallback `count ?? 0` always evaluates to `0`. The destructuring should use `{ data: count, error: countError }` instead.
- **Impact:** Article counts are never displayed. The delete warning dialog (AC-4) never shows the "X Artikel sind dieser Kategorie zugeordnet" warning because article_count is always 0. Users can delete categories with assigned articles without any warning.
- **Priority:** Fix before deployment

#### BUG-2: N+1 query pattern for article counts (Medium)
- **Severity:** Medium
- **Steps to Reproduce:**
  1. Have 50+ categories in the database
  2. Call GET /api/categories
  3. Expected: Efficient query execution
  4. Actual: The API fires 1 SELECT for categories + N individual RPC calls (one per category) for article counts
- **Root Cause:** `src/app/api/categories/route.ts` lines 25-37 use `Promise.all` with per-category RPC calls
- **Impact:** With many categories, this causes N+1 database round-trips. For 50 categories, that is 51 queries. Performance degrades linearly.
- **Recommendation:** Consider a single SQL query that joins categories with a grouped count, or a single RPC that returns all counts at once.
- **Priority:** Fix in next sprint

#### BUG-3: No UUID validation on [id] path parameter (Low)
- **Severity:** Low
- **Steps to Reproduce:**
  1. Send PUT /api/categories/not-a-uuid with a valid body
  2. Expected: 400 Bad Request with "Invalid category ID format"
  3. Actual: Request reaches Supabase which returns a Postgres error (likely PGRST116 or a type cast error), resulting in a 404 or 500
- **Root Cause:** `src/app/api/categories/[id]/route.ts` does not validate that the `id` parameter is a valid UUID before passing it to Supabase
- **Impact:** Minor -- Supabase handles invalid UUIDs gracefully (returns error), but the error message is not user-friendly and the request wastes a database round-trip
- **Priority:** Nice to have

#### BUG-4: No rate limiting on category API endpoints (Medium)
- **Severity:** Medium
- **Steps to Reproduce:**
  1. Send rapid repeated POST requests to /api/categories
  2. Expected: Rate limiting after N requests (per security rules)
  3. Actual: All requests are processed without throttling
- **Root Cause:** The rate-limit utility exists in `src/lib/rate-limit.ts` but is not imported or used in any of the category API routes
- **Impact:** An authenticated admin could flood the system with category creation requests. An authenticated non-admin could spam GET /api/categories causing N+1 query load.
- **Priority:** Fix in next sprint

#### BUG-5: GET /api/categories has no .limit() on the query (Low)
- **Severity:** Low
- **Steps to Reproduce:**
  1. Insert a very large number of categories
  2. Call GET /api/categories
  3. Expected: Query has a reasonable limit per backend rules
  4. Actual: No .limit() applied -- returns all categories
- **Root Cause:** Backend rules state "Use `.limit()` on all list queries", but `src/app/api/categories/route.ts` line 17 has no limit
- **Impact:** For v1 with < 50 categories (as stated in edge cases), this is not a practical problem. However it violates the project's backend conventions.
- **Priority:** Nice to have

### Cross-Browser Assessment (Code Review)

The UI components use standard shadcn/ui primitives (Table, Dialog, AlertDialog, Button, Badge, Tooltip, Input, Textarea, Card) which are built on Radix UI. These are well-tested across browsers.

- **Chrome:** Expected to work -- standard React/Radix components
- **Firefox:** Expected to work -- no browser-specific APIs used
- **Safari:** Expected to work -- no CSS features used that are Safari-problematic

No browser-specific code or APIs detected. Manual browser testing recommended after BUG-1 is fixed.

### Responsive Assessment (Code Review)

- [x] Header uses `flex-col sm:flex-row` for mobile stacking
- [x] Table wrapped in `overflow-x-auto` for horizontal scrolling on small screens
- [x] Dialog uses `max-w-lg` which adapts to viewport
- [x] Card-based layout adapts well to different widths
- **375px (Mobile):** Table columns may be cramped; horizontal scroll enabled. Dialog should fill most of the viewport width.
- **768px (Tablet):** Header layout switches to row. Table fits comfortably.
- **1440px (Desktop):** Full layout with ample space.

### Summary
- **Acceptance Criteria:** 5/7 passed (AC-3 and AC-4 partially failed due to BUG-1)
- **Bugs Found:** 5 total (1 critical, 2 medium, 2 low)
- **Security:** Rate limiting missing on category endpoints (medium). No other critical security issues.
- **Production Ready:** NO
- **Recommendation:** Fix BUG-1 (critical -- article count always 0) before deployment. BUG-4 (rate limiting) should also be addressed. BUG-2, BUG-3, and BUG-5 can be deferred.
