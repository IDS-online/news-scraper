# NEWS-1: User Authentication & Rollen

**Status:** Planned
**Priority:** P0 (MVP)
**Created:** 2026-03-05

## Dependencies
Keine (Basis-Feature)

## Overview
Nutzer können sich registrieren, einloggen und ausloggen. Es gibt zwei Rollen: `admin` (verwaltet Quellen, sieht alle Einstellungen) und `user` (liest News, nutzt die API). Admins werden manuell über die Datenbank zugewiesen.

## User Stories

1. Als **neuer Nutzer** möchte ich mich mit E-Mail und Passwort registrieren können, damit ich Zugang zur Plattform erhalte.
2. Als **bestehender Nutzer** möchte ich mich einloggen können, damit ich auf das Dashboard und die API zugreifen kann.
3. Als **eingeloggter Nutzer** möchte ich mich ausloggen können, damit meine Session sicher beendet wird.
4. Als **Admin** möchte ich sehen, welche Nutzer registriert sind, damit ich die Plattform verwalten kann.
5. Als **nicht authentifizierter Nutzer** möchte ich auf keine geschützten Seiten oder API-Endpunkte zugreifen können.

## Acceptance Criteria

- [ ] Registrierungsformular mit E-Mail + Passwort + Passwort-Bestätigung
- [ ] Login-Formular mit E-Mail + Passwort
- [ ] Nach erfolgreichem Login: Weiterleitung zum Dashboard
- [ ] Logout-Button im Header führt zur Login-Seite
- [ ] Nicht eingeloggte Nutzer werden von `/dashboard` und `/api/*` auf `/login` weitergeleitet
- [ ] Nutzerrollen `admin` und `user` sind in der Datenbank als `profiles.role` gespeichert
- [ ] Admins sehen zusätzliche Navigationspunkte (Quellen-Verwaltung)
- [ ] Passwort muss mindestens 8 Zeichen lang sein
- [ ] Fehlermeldungen bei falschen Credentials sind benutzerfreundlich (kein Stack-Trace)

## Edge Cases

- Registrierung mit bereits genutzter E-Mail → klare Fehlermeldung "E-Mail bereits registriert"
- Login mit falschem Passwort → Fehlermeldung ohne Angabe welches Feld falsch ist (Security)
- Session läuft ab während User aktiv ist → automatische Weiterleitung zu Login
- Passwort-Bestätigung stimmt nicht überein → clientseitige Fehlermeldung vor Submit
- E-Mail-Format ungültig → clientseitige Validierung
- Brute-Force-Schutz: Supabase Auth Rate Limiting greift nach mehreren Fehlversuchen

## Out of Scope
- Password Reset via E-Mail (v2)
- OAuth / Social Login (v2)
- Zwei-Faktor-Authentifizierung (v2)
- Nutzer können eigene Rollen ändern (niemals)

---

## Tech Design (Solution Architect)

**Tabellen:** `profiles` (id, email, role, created_at) — erweitert `auth.users`

**Authentifizierung:** Supabase Auth (Email/Passwort). Nach Login liefert Supabase einen JWT, der bei allen API-Aufrufen im `Authorization`-Header mitgesendet wird.

**Rollen:** `profiles.role` = `admin` | `user`. Admin-Zuweisung manuell via Supabase Dashboard oder SQL.

**Schutz:** Next.js Middleware liest JWT und leitet unautorisierte Requests auf `/login` um. Admin-Routen prüfen zusätzlich die Rolle aus `profiles`.

**Seiten:** `/login`, `/register` (öffentlich) — alle anderen Seiten unter `/dashboard/*` (geschützt)

**Neue Packages:** Keine (Supabase SDK bereits im Starter-Kit)
