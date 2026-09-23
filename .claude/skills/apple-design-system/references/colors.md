# Color Palette

The complete palette, grouped by role. It's a **single-accent** Apple system: one blue
carries every interactive element; everything else is text, surface, hairline, or status.

Every value is a **semantic token** (from `constants/colors.ts`). In UI code, reference
the token name — never a raw hex. The `colors` code block in `tokens.md` is the
copy-paste source of truth; this file is the at-a-glance palette with roles and pairings.

> GitHub renders these hex codes as plain text (no swatch). Paste any value into a color
> picker to preview. `onDark60` and `scrim` are the only tokens defined with alpha.

---

## Accent — the only interactive color

| Swatch | Token | Hex | Role |
|---|---|---|---|
| 🔵 | `primary` | `#0066cc` | **Action Blue.** Every interactive element on light surfaces — links, primary CTAs, active tab, selected chip, focus root, progress fills. |
| 🔵 | `primaryFocus` | `#0071e3` | A hair brighter. The 2px border on a **selected** card / chosen option, and the keyboard focus ring. |
| 🔵 | `primaryOnDark` | `#2997ff` | Sky-link blue for interactive text **on dark surfaces**, where Action Blue would disappear. |

There is **no second brand color.** If you reach for another accent, you've left the
language.

---

## Text / ink

| Swatch | Token | Hex | Role |
|---|---|---|---|
| ⬛ | `ink` | `#1d1d1f` | Near-black. Every headline and body string on light surfaces. Not pure black. |
| ⬛ | `body` | `#1d1d1f` | Same tone as `ink` — one near-black for all light-surface text. |
| ⬜ | `bodyOnDark` | `#ffffff` | All text on dark tiles and the nav bar. |
| ◽ | `bodyMuted` | `#cccccc` | Secondary copy on dark surfaces (pure white would be too loud). |
| ▪️ | `inkMuted80` | `#333333` | Softer body — supporting copy, chip labels. |
| ▫️ | `inkMuted48` | `#7a7a7a` | Captions, placeholders, disabled text, muted icons, fine print. |

---

## Surfaces

| Swatch | Token | Hex | Role |
|---|---|---|---|
| ⬜ | `canvas` | `#ffffff` | The dominant background. Cards, inputs, sheets, most screens. |
| ◻️ | `canvasParchment` | `#f5f5f7` | Signature off-white. Alternating tiles, filled fields, chips, gauge tiles, pressed states. |
| ◻️ | `surfacePearl` | `#fafafc` | Near-white grouped-row / ghost-button fill (reads as a surface against parchment). |
| ⬛ | `surfaceTile1` | `#272729` | Primary dark tile; also the `info` toast background. |
| ⬛ | `surfaceTile2` | `#2a2a2c` | A micro-step lighter — a dark tile next to Tile 1. |
| ⬛ | `surfaceTile3` | `#252527` | A micro-step darker — bottom of a dark stack, video frames. |
| ⬛ | `surfaceBlack` | `#000000` | True void only — nav bar, video, full-bleed photo overlays. |
| ◽ | `chipTranslucent` | `#d2d2d7` | Base for translucent gray control chips over photography (used ~64% alpha). |

Divide sections by **alternating surfaces** (`canvas` ↔ `canvasParchment` ↔ `surfaceTile*`),
not by borders or shadows — the color change is the divider.

---

## Hairlines & dividers

| Swatch | Token | Hex | Role |
|---|---|---|---|
| ◽ | `dividerSoft` | `#f0f0f0` | Softest separator — reads as a ring, not a line. Between grouped rows. |
| ◽ | `hairline` | `#e0e0e0` | The default 1px border/separator — card edges, input borders, list dividers. |

---

## On-color & overlays

| Swatch | Token | Hex / alpha | Role |
|---|---|---|---|
| ⬜ | `onPrimary` | `#ffffff` | Text/icon on a filled `primary` (or `danger`) surface — buttons, badges. |
| ⬜ | `onDark` | `#ffffff` | Text/icon on any dark surface. |
| 🔲 | `onDark60` | `rgba(255,255,255,0.6)` | Translucent white for controls over photography. |
| 🔲 | `scrim` | `rgba(0,0,0,0.45)` | The dim behind modals, alerts, and action sheets (there is no shadow — the scrim is the depth). |

---

## Status — state only, never brand or decoration

| Swatch | Token | Hex | Role |
|---|---|---|---|
| 🔴 | `danger` | `#ff3b30` | Destructive actions, errors, disputed/error states, error input border. |
| 🟢 | `success` | `#34c759` | Positive money/earnings, success toasts. |
| 🟠 | `warning` | `#ff9500` | Caution states — "under review", "awaiting payment". |

Status colors express **state**, never style. Never use one as an accent or a background
fill outside a status badge / semantic label.

---

## Pairing guide (foreground on background)

| Background | Text | Muted text | Accent / interactive |
|---|---|---|---|
| `canvas` / `canvasParchment` / `surfacePearl` | `ink` | `inkMuted80` → `inkMuted48` | `primary` |
| `surfaceTile*` / `surfaceBlack` | `onDark` / `bodyOnDark` | `bodyMuted` | `primaryOnDark` |
| filled `primary` or `danger` (button / badge) | `onPrimary` | — | — |
| over photography (scrim/dark) | `onDark` | `onDark60` | `primaryOnDark` |

**Status badge coloring** (see the palettes in `components.md`): an *active / open / held*
state is a **filled** badge (`bg: primary`, `fg: onPrimary`); every terminal or neutral
state is a **`canvasParchment` badge** with a semantic `fg` (`warning` / `danger` /
`primary` / `inkMuted80` / `inkMuted48`).

---

## Rules recap

- **One accent** — `primary` (`#0066cc`). No second brand color anywhere.
- Links/interactive on a **dark** surface use `primaryOnDark`, not `primary`.
- `ink` is near-black (`#1d1d1f`), *not* pure black. Pure black (`surfaceBlack`) is reserved
  for the nav bar, video, and true void.
- Status hues are for **state only**.
- Depth is **surface color + hairline + scrim** — never a shadow.
