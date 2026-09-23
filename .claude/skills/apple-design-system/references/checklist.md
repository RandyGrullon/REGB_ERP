# Compliance Checklist

Use this when **reviewing** UI. Report each violation as
`file:line — rule broken → concrete fix`. Ordered by how badly a miss reads.

## Color
- [ ] Every interactive element (link, primary CTA, active tab, focus) uses `primary`
      (Action Blue `#0066cc`) — and **nothing else** is used as an accent.
- [ ] `danger` / `success` / `warning` appear only for **status**, never as decoration
      or a second brand color.
- [ ] Text is `ink` / `inkMuted80` / `inkMuted48` on light; `onDark` / `bodyMuted` on
      dark. No raw hex anywhere — only `colors.*` tokens.
- [ ] Links on a **dark** surface use `primaryOnDark`, not `primary`.

## Type
- [ ] Only weights **400 / 600 / 700** are used. **No 500 / medium** anywhere.
- [ ] Body copy is `body` (17px / 400). Headlines are `bold` (700). Labels/emphasis are
      `semiBold` (600).
- [ ] Text is rendered through the shared `ThemedText` primitive, not raw `<Text>` with
      inline styles.
- [ ] Large headlines carry slightly tight tracking; small text does not.

## Shape & elevation
- [ ] **No shadow** on any card, button, sheet, input, or text. (Only hero/product
      imagery may carry the single soft drop-shadow.)
- [ ] Every rounded surface sets `borderCurve: 'continuous'`.
- [ ] Radii come from the scale (`sm/md/lg/xl/pill`) — no in-between values.
- [ ] Primary CTAs, search inputs, and filter chips are **pills** (`radius.pill`).
- [ ] Separators are 1px `hairline` / `dividerSoft`; selection may go to 2px
      `primaryFocus`. No heavy borders otherwise.

## Layout
- [ ] Content respects the gutter (`spacing.xl` horizontal) — lists/cards never touch
      the device edge.
- [ ] Spacing values are `spacing.*` tokens, not raw numbers.
- [ ] Sections are divided by **surface color change** (canvas ↔ parchment ↔ dark tile),
      not by borders or shadows.
- [ ] Screens use the collapsing large-title scaffold (or the fixed header on
      home/hero screens), not the platform default header.

## Components & interaction
- [ ] Confirmations/menus use the custom Apple `alert()` / `sheet()` — **never**
      react-native `Alert` or `ActionSheetIOS`.
- [ ] Icons are named as SF Symbols and rendered via the one cross-platform `Icon`
      component (Android glyph mapped), never `<Image source="sf:…">` inline.
- [ ] Buttons press to `scale(0.95)` (spring) with a light iOS haptic; larger tappables
      press to `0.97–0.99` or swap to a `canvasParchment` pressed background.
- [ ] Forms wrap in `KeyboardAvoidingView` with `behavior="height"` on Android
      (`"padding"` is an iOS-only no-op).
- [ ] Motion is quiet: 150–240ms ease-out, subtle spring, no bounce.

## The instinct test
- [ ] When emphasis was needed, the fix changed **surface or weight** — not added a
      shadow or a second color. If a shadow or new hue crept in, it's almost certainly
      off-language.
