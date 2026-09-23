# Design Tokens

Every color, size, radius, and font size in the UI comes from a token. **Never inline
a raw hex, pixel, or radius** — reference a token so the whole app moves together and
stays on-language. The values below are the production set; they are platform-agnostic
(the normalizers are the only React-Native-specific piece).

---

## Color

Semantic names, not raw hues. One accent (`primary`); status colors are for state
only, never decoration. For the full palette grouped by role — with per-color usage and
a foreground-on-background pairing guide — see **`colors.md`**. The code block below is
the copy-paste source of truth.

```ts
// constants/colors.ts
import { normalizeColor as n } from '@/lib/normalize-color';

export const colors = {
  // Accent — the ONLY interactive color
  primary:         n('#0066cc'), // Action Blue — links, primary CTAs, active states
  primaryFocus:    n('#0071e3'), // focus ring / selected border
  primaryOnDark:   n('#2997ff'), // links on dark surfaces (Action Blue vanishes there)

  // Text
  ink:             n('#1d1d1f'), // near-black — headlines + body (not pure black)
  body:            n('#1d1d1f'),
  bodyOnDark:      n('#ffffff'),
  bodyMuted:       n('#cccccc'), // secondary copy on dark
  inkMuted80:      n('#333333'), // softer body
  inkMuted48:      n('#7a7a7a'), // captions, disabled, fine print

  // Hairlines
  dividerSoft:     n('#f0f0f0'), // softest separator (reads as a ring, not a line)
  hairline:        n('#e0e0e0'), // 1px separators, card edges

  // Surfaces
  canvas:          n('#ffffff'), // dominant background
  canvasParchment: n('#f5f5f7'), // signature off-white — alternating tiles, filled fields
  surfacePearl:    n('#fafafc'), // near-white ghost-button fill
  surfaceTile1:    n('#272729'), // primary dark tile
  surfaceTile2:    n('#2a2a2c'), // dark tile a micro-step lighter
  surfaceTile3:    n('#252527'), // dark tile a micro-step darker
  surfaceBlack:    n('#000000'), // true void — nav bar, video
  chipTranslucent: n('#d2d2d7'), // translucent chip over photography

  // On-color + overlays
  onPrimary:       n('#ffffff'),
  onDark:          n('#ffffff'),
  onDark60:        n('#ffffff', 0.6), // translucent white on photographic backgrounds
  scrim:           n('#000000', 0.45), // dim behind sheets / modals

  // Status — for state ONLY, never for brand/style
  danger:          n('#ff3b30'),
  success:         n('#34c759'),
  warning:         n('#ff9500'),
} as const;

export type ColorToken = keyof typeof colors;
```

**Surface rhythm:** divide sections by alternating `canvas` → `canvasParchment` →
`surfaceTile*`, not by borders or shadows. On a dark surface, links use
`primaryOnDark`, not `primary`.

---

## Spacing

8pt-ish base with a couple of sub-steps for tight typographic adjustments. Structural
layout snaps to `sm`/`base`/`lg`/`xl`.

```ts
// constants/spacing.ts
import { normalizeSize as s } from '@/lib/normalize-size';

export const spacing = {
  xxs:  s(2),
  xs:   s(4),
  sm:   s(8),
  md:   s(12),
  base: s(16),
  lg:   s(20),
  xl:   s(24),
  xxl:  s(32),
  xxxl: s(48),
  huge: s(64),
} as const;

export const radius = {
  sm:   s(6),
  md:   s(10),
  lg:   s(14),  // cards, dialogs, sheets
  xl:   s(20),  // large hero surfaces
  pill: 999,    // CTAs, search, filter chips — the signature Apple pill
} as const;
```

**Radius grammar (don't mix in-between values):** `sm` inline/compact · `md` small
tiles · `lg` cards / dialogs / action sheets · `xl` large surfaces · `pill` anything
that reads as an *action*. Always pair a radius with `borderCurve: 'continuous'`.

**Gutter:** screen content sits inside `spacing.xl` horizontal padding — lists and
cards must never touch the device edge.

---

## Borders & dividers

There are exactly **two** border widths. Nothing is ever thicker than 2px.

| Width | Color token | Use |
|---|---|---|
| **1px** | `hairline` (`#e0e0e0`) | Default border on cards, inputs, list-row separators |
| **1px** | `dividerSoft` (`#f0f0f0`) | The softest separator — reads as a ring, not a line |
| **1px** | `danger` | Input in an error state |
| **1px** | `primary` | Input while focused |
| **2px** | `primaryFocus` (`#0071e3`) | Selected card / chosen option — the *only* place 2px appears |

Rules: default state is a 1px `hairline`. A control becomes 2px `primaryFocus`
**only** when selected. Every bordered or rounded surface sets
`borderCurve: 'continuous'` (iOS squircle). Never use a shadow in place of a border.

---

## Margins & padding conventions

Prefer **`gap` on a flex container** over per-child margins — it keeps rhythm even.
Reserve `marginTop` / `marginBottom` for one-off nudges (e.g. a CTA pushed down).

| Context | Value |
|---|---|
| Screen gutter (horizontal) | `spacing.xl` (24) |
| Screen top padding (below safe area) | `insets.top + spacing.xl` on plain screens; scaffold handles it otherwise |
| Card / dialog interior padding | `spacing.lg` (20) |
| Compact tile / gauge / field padding | `spacing.base` (16) |
| Text-input vertical padding | `spacing.md` (12) |
| Chip / badge padding | `spacing.sm` (8) horizontal × `spacing.xxs` (2) vertical |
| Gap between stacked form fields / list rows | `spacing.lg` (20) or `spacing.base` (16) |
| Gap between a label and its control | `spacing.xs` (4) |
| Gap between chips in a row | `spacing.xs` (4) |
| Space between major sections | `spacing.xl` (24) → `spacing.xxl` (32) |
| Empty-state vertical padding | `spacing.huge` (64) |

---

## Elevation

There is **no shadow system.** UI depth comes from:
1. **Surface color change** — `canvas` ↔ `canvasParchment` ↔ `surfaceTile*`.
2. **1px hairlines** between grouped rows / around cards.
3. **A scrim** (`colors.scrim`, black @ 45%) behind modals, alerts, and sheets.

The single soft drop-shadow in the whole language is reserved for hero / product
imagery resting on a surface — never on a card, button, sheet, input, chip, or text.

---

## Typography

A tight size ramp. The **weight ladder is 400 / 600 / 700 — 500 is banned.** Body runs
at 17px (Apple's reading pace), not 16.

```ts
// constants/typography.ts
import { normalizeFontSize as f } from '@/lib/normalize-font-size';

// This project bundles Poppins as its face. The canonical Apple language calls for
// SF Pro (free on Apple platforms via system-ui) or Inter off-platform. Whatever the
// family, only ever use these three weights.
export const fonts = {
  regular:  'Poppins-Regular',   // 400 — body, default
  semiBold: 'Poppins-SemiBold',  // 600 — labels, emphasis, cancel actions
  bold:     'Poppins-Bold',      // 700 — headlines, large titles
  // NOTE: a Medium (500) file may exist in the family — do NOT use it.
} as const;

export const fontSize = {
  heroDisplay: f(80),
  title1:      f(56),
  title2:      f(40), // large collapsing screen title
  title3:      f(28),
  headline:    f(20), // dialog titles, section heads
  body:        f(17), // default paragraph + button labels
  callout:     f(15),
  caption:     f(13), // secondary captions, sheet headers
  micro:       f(11), // timestamps, legal
} as const;
```

**Rules:** headlines are `bold` (700) at `title*`/`headline`; body is `regular` (400)
at `body`; emphasis/labels are `semiBold` (600). Tighten letter-spacing slightly on
large headlines for the "Apple tight" cadence; never on small text.

---

## Responsive normalizers (React Native)

These keep tokens visually consistent across device sizes. `375 × 812` is the base
(iPhone). On web, drop these and use the raw values / `rem`.

```ts
// lib/normalize-size.ts — scale layout by screen width
import { Dimensions, PixelRatio } from 'react-native';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BASE_WIDTH = 375;
export const normalizeSize = (size: number) =>
  Math.round(PixelRatio.roundToNearestPixel((SCREEN_WIDTH / BASE_WIDTH) * size));
```

```ts
// lib/normalize-font-size.ts — scale type by the smaller axis, damped by 1.5
import { Dimensions, PixelRatio } from 'react-native';
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BASE_WIDTH = 375;
const BASE_HEIGHT = 812;
export const normalizeFontSize = (size: number) => {
  const scale = Math.min(SCREEN_WIDTH / BASE_WIDTH, SCREEN_HEIGHT / BASE_HEIGHT);
  return Math.round(PixelRatio.roundToNearestPixel((size * scale) / 1.5));
};
```

```ts
// lib/normalize-color.ts — parse hex/rgba, optionally override alpha, emit rgba()
export const normalizeColor = (input: string, alpha?: number): string => {
  let r = 0, g = 0, b = 0, a = 1;
  if (input.startsWith('#')) {
    let hex = input.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length === 6) hex += 'ff';
    if (hex.length !== 8) throw new Error(`Invalid hex color: ${input}`);
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
    a = parseInt(hex.slice(6, 8), 16) / 255;
  } else {
    const m = input.match(/rgba?\(([^)]+)\)/i);
    if (!m) throw new Error(`Unsupported color: ${input}`);
    const parts = m[1].split(',').map((s) => s.trim());
    r = +parts[0]; g = +parts[1]; b = +parts[2];
    a = parts[3] !== undefined ? +parts[3] : 1;
  }
  if (alpha !== undefined) a = alpha;
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
};
```

Why `fontSize` divides by 1.5: the source ramp uses large web-style numbers
(`title2` = 40); the `/1.5` damping maps them to comfortable on-device point sizes
while preserving the *ratios* between steps.
