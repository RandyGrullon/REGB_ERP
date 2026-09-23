---
name: apple-design-system
description: >-
  Apple-inspired UI/UX design language (from getdesign.md/apple) as adapted into a
  production app. Use when building, restyling, or reviewing any UI — screens,
  components, buttons, headers, alerts, sheets, cards, forms, typography, color, or
  spacing — so the result matches this Apple design language: photography-first,
  a single blue accent, pill CTAs, no chrome shadows, and a strict weight ladder.
  Trigger on "design a screen", "style this component", "make it look Apple / like
  QueenSkiilia", "build the UI", or "review my UI for design consistency".
metadata:
  author: rukkiecodes
  version: "1.0.0"
  origin: getdesign.md/apple
  reference-platform: react-native-expo
license: MIT
---

# Apple Design System

An Apple Human-Interface-inspired design language, distilled from the canonical
[getdesign.md/apple](https://getdesign.md/apple/design-md) spec and hardened into a
shipping product. Use it to build and review UI so everything reads as one quiet,
photography-first, single-accent Apple system — not a pile of one-off styles.

## Foundation — where this design comes from

The base language was installed with **getdesign**:

```bash
npx getdesign@latest add apple
```

That command drops a canonical `DESIGN.md` (Apple's web design language: product
tiles, SF Pro type ramp, one Action Blue accent, the single product drop-shadow).
That file is preserved verbatim at **`references/apple-design-source.md`** — it is the
source of truth for *why* every rule below exists. When a decision isn't covered
here, defer to that document.

This skill then captures how that language was **adapted into a real app** (an
Expo / React Native client): semantic design tokens, responsive normalizers, and a
set of component recipes that already passed design review. The values are
platform-agnostic; the code samples are React Native but translate directly to web
(swap `View`→`div`, `StyleSheet`→CSS, keep the tokens and rules).

## The 8 non-negotiable rules

Read these first. They are what make the system feel Apple; breaking one is the
fastest way to look off-brand.

1. **One accent, ever.** Every interactive element — links, primary CTAs, focus,
   active tab — is Action Blue `#0066cc` (`primary`). There is no second brand color.
   Semantic colors (danger/success/warning) exist only for status, never for style.
2. **Pill CTAs.** The primary button is a full pill (`radius.pill`). The pill radius
   *is* the "this is an action" signal. Search inputs and filter chips are pills too.
3. **No chrome shadows.** Never put a shadow on a card, button, sheet, or text.
   Elevation comes from surface-color change (light ↔ dark/parchment) and hairlines.
   The *only* shadow in the whole system is the soft drop under product/hero imagery.
4. **Weight ladder = 400 / 600 / 700. 500 is banned.** Body is 400 (`regular`),
   emphasis/labels are 600 (`semiBold`), headlines are 700 (`bold`). Never use a
   medium/500 weight — it muddies the Apple cadence.
5. **Hairlines, not borders.** Separators are 1px in `hairline` (`#e0e0e0`) or
   `dividerSoft` (`#f0f0f0`). No heavy 2px+ borders except a focused input/selection.
6. **Continuous corners.** Every rounded surface sets `borderCurve: 'continuous'`
   (iOS squircle). Radii come from the scale — don't invent in-between values.
7. **Air is the pedestal.** Generous whitespace around content; a large title that
   collapses on scroll; content never touches the screen edge (respect the gutter).
8. **Alerts & sheets follow Apple too.** Use the custom Apple-styled alert/sheet, not
   the OS default gray `Alert`. Centered dialog for confirms; bottom sheet for menus.

## References — load what the task needs

```
references/
  apple-design-source.md   The canonical getdesign.md/apple DESIGN.md (verbatim). The "why".
  colors.md                The full color PALETTE — every token grouped by role (accent,
                           text, surfaces, hairlines, overlays, status) with hex, usage,
                           and a foreground-on-background pairing guide.
  tokens.md                Color, spacing, radius, type, BORDER WIDTHS, margin/padding
                           conventions, and elevation + the responsive normalizers.
                           Copy-paste-ready. Start here for any new project.
  components.md            Exact spec for every component: font, Button, Input, OTP, Card,
                           chips & status badges, EmptyState, Toast, Alert, Sheet, Icon,
                           collapsing header, tab bar, avatar, rating stars, StatGauge,
                           NotificationBell, keyboard-avoiding rules, motion.
  screens.md               Whole-screen blueprints: the login/onboarding flow (splash →
                           onboarding → account-type → email → OTP → profile-setup),
                           tab-root list screen, dashboard hero, detail, form-sheet, chat.
  checklist.md             The full Do / Don't compliance list to review UI against.
```

- **Building a new screen?** Read `screens.md` for the skeleton, `components.md` for the
  parts, `tokens.md` for the values. Never inline a hex, size, radius, or border width —
  always a token.
- **Building or restyling a single component?** Read its entry in `components.md`; every
  padding, border width, radius, weight, and color token is spelled out.
- **Reviewing existing UI?** Read `checklist.md` and report violations as
  `file:line — rule broken → fix`.
- **Unsure why a rule exists?** Read `references/apple-design-source.md`.

## Applying it to a non-Apple / cross-platform target

- **Type:** Apple platforms get SF Pro for free (`system-ui, -apple-system`). Off
  Apple, the canonical substitute is **Inter**; this project bundled **Poppins**.
  Whatever the face, keep the **400 / 600 / 700 ladder** and the tight tracking on
  large headlines — that carries more of the "Apple" feel than the exact font.
- **Color/spacing/radius tokens transfer 1:1.** They're just values.
- **Interactions:** press = scale to `0.95` (spring), light haptic on iOS. Keep motion
  quiet — 150–240ms ease-out, no bounce on entrances beyond a subtle spring.

## Golden rule

When you reach for emphasis, **change the surface or the weight before you add
chrome.** Light tile → parchment → dark tile is the Apple way to divide and
elevate. A shadow or a second color almost always means you've left the language.
