# Newsgrap3r Style Guide

> Design-Tokens und UI-Vorgaben basierend auf dem IDS.online CI & Style Guide (Version 1.0, Februar 2026).
> Vollständiger Guide: `docs/ci-styleguide/index.html`

---

## Farben

### Akzentfarben

| Token | Hex | Verwendung |
|-------|-----|------------|
| `--orange` | `#FEB13D` | Primärer Akzent: Buttons, Links, Highlights, Icons, Borders |
| `--orange-real` | `#F39200` | Hover-Zustand von Orange |
| `--pink` | `#FE4768` | Fehler, Warnungen, Don'ts, destruktive Aktionen |

### Neutrale Farben

| Token | Hex | Verwendung |
|-------|-----|------------|
| `--dark` | `#2E3538` | Headlines, primärer Text, Dark-Backgrounds |
| `--navy` | `#193C4D` | Dunkle Sections, sekundäre Dark-Hintergründe |
| `--slate` | `#5D737E` | Body-Text, Labels, Navigation-Links |
| `--grey` | `#8F9CA3` | Platzhalter, deaktivierte Elemente, Meta-Text |
| `--light` | `#D8E1E5` | Borders, Trennlinien, Divider |
| `--ice` | `#EEF4F6` | Section-Hintergründe, Table-Stripes, Input-BG |
| `--off-white` | `#F9FBFC` | Seitenbackground-Variante |
| `--white` | `#FFFFFF` | Standard-Hintergrund, Card-BG |

### Tailwind CSS Custom Colors (in `tailwind.config.ts` konfigurieren)

```ts
colors: {
  brand: {
    orange:      '#FEB13D',
    'orange-hover': '#F39200',
    pink:        '#FE4768',
    dark:        '#2E3538',
    navy:        '#193C4D',
    slate:       '#5D737E',
    grey:        '#8F9CA3',
    light:       '#D8E1E5',
    ice:         '#EEF4F6',
    'off-white': '#F9FBFC',
  }
}
```

---

## Typografie

### Schriften

| Einsatz | Schrift |
|---------|---------|
| Primär (lokal/lizenziert) | **Soleil** (TypeTogether) |
| Web-Fallback (Google Fonts) | **Nunito Sans** |
| Stack | `'Nunito Sans', 'Trebuchet MS', Arial, sans-serif` |

**Google Fonts Einbindung:**
```html
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,opsz,wght@0,6..12,300;0,6..12,400;0,6..12,500;0,6..12,600;0,6..12,700;0,6..12,800;1,6..12,400&display=swap" rel="stylesheet">
```

### Hierarchie

| Element | Größe | Gewicht | Zeilenhöhe |
|---------|-------|---------|------------|
| H1 | `clamp(2rem, 4vw, 3rem)` | 800 | 1.15 |
| H2 | `clamp(1.5rem, 3vw, 2.2rem)` | 800 | 1.2 |
| H3 | `1.1rem` | 700 | — |
| Lead / Intro | `1.1rem` | 400 | — |
| Body | `1rem` | 400 | 1.6 |
| Label / Meta | `0.85rem` | 600 | — |
| Caption / Tag | `0.75rem` | 700 | — |

**Gewicht-Regeln:**
- 800 → Headlines
- 700 → Subheadlines, Buttons, CTAs
- 600 → Labels, Navigation
- 400 → Fließtext

---

## Border Radius

| Element | Radius |
|---------|--------|
| Cards | `12px` |
| Buttons | `8px` |
| Inputs | `8px` |
| Tags / Badges | `20px` (Pill) |
| Avatare | `50%` (Kreis) |

---

## Abstände & Grid

**Basis: 8px** — alle Abstände als Vielfache von 8.

| Schritt | Wert |
|---------|------|
| XS | 8px |
| S | 16px |
| M | 24px |
| L | 32px |
| XL | 48px |
| 2XL | 64px |
| 3XL | 80px |

**Max. Content-Breite:** `1100px`

| Breakpoint | Seitenrand |
|------------|------------|
| Mobile | 24px |
| Tablet | 32px |
| Desktop | 48px |

---

## UI-Komponenten

### Buttons

| Variante | Hintergrund | Text | Hover |
|----------|-------------|------|-------|
| Primary | `#FEB13D` | `#2E3538` (dark) | `#F39200` + leichter Schatten, translateY(-2px) |
| Secondary | `#FFFFFF` | `#2E3538` | Border → Orange, Text → Orange |
| Dark | `#2E3538` | `#FFFFFF` | `#193C4D` (navy), translateY(-2px) |

Padding: `12px 24px` · Font-weight: 700 · Radius: 8px · Border: `2px solid transparent`

### Cards

| Variante | Stil |
|----------|------|
| Standard | Weißer BG, 12px Radius, `box-shadow: 0 2px 12px rgba(0,0,0,0.06)` |
| Feature | Wie Standard + `border-top: 3px solid #FEB13D` |
| Dark | BG `#2E3538`, Text `#FFFFFF`, Orange-Akzente |

### Tabellen

- Header: BG `#2E3538`, Text `#FFFFFF`, font-weight 700
- Rows: Zebra-Striping mit `--ice` (#EEF4F6) auf geraden Zeilen
- Border-bottom: `1px solid #D8E1E5`

### Section-Hintergründe

| Klasse | Hintergrund | Verwendung |
|--------|-------------|------------|
| Standard | `#FFFFFF` | Default |
| Ice | `#EEF4F6` | Formulare, Filterleisten |
| Dark | `#2E3538` | Hero, Highlights |
| Navy | `#193C4D` | Sekundäre dunkle Sections |

---

## Tonalität & Sprachstil

**Charakter:** Professionell aber nicht steif · Kompetent aber nicht belehrend · Nahbar aber nicht kumpelhaft

| Do | Don't |
|----|-------|
| Klare, aktive Sprache | Keine Anglizismen ohne Grund |
| Konkreten Nutzen vor Features stellen | Keine Superlative ohne Beleg |
| Zahlen und Fakten für Vertrauen | Kein Fachjargon für Nicht-Techniker |
| **Sie-Ansprache** im B2B-Kontext | Nicht duzen in der Kundenkommunikation |

---

## Anwendungsregeln im Newsgrap3r

- Orange (`#FEB13D`) als primärer Akzent: Buttons, aktive Navigation-Items, Badges, Focus-Ringe
- Dark (`#2E3538`) für alle Headlines und primären Text-Elemente
- Pink (`#FE4768`) ausschließlich für Fehler-, Warn- und Danger-Zustände
- Ice (`#EEF4F6`) als Hintergrund für Filter-Leisten, Tabellen-Rows, Sidebar
- Keine custom Farben außerhalb dieser Palette
- `shadcn/ui`-Komponenten via CSS-Variablen mit dieser Palette überschreiben
