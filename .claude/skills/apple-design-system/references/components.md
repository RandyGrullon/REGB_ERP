# Component Catalog

Every component in the reference app (Expo / React Native, New Architecture), with the
**exact** tokens it uses. Each encodes the rules in `SKILL.md`. Copy the intent; if
you're not on React Native, translate the primitives (`View`→`div`, etc.) but keep the
tokens, radii, weights, and border widths.

> Conventions used below: `spacing.*` and `radius.*` are from `tokens.md`; `fonts.*` are
> `regular` (400) / `semiBold` (600) / `bold` (700); `size` values are `fontSize` keys.

---

## Text — `ThemedText`

The only text primitive. Never style a raw `<Text>`; funnel every string through this so
the weight ladder and palette stay honest.

- Props: `font` (regular/semiBold/bold **only**), `size` (fontSize key), `color`
  (ColorToken), `opacity`.
- Defaults: `font=regular`, `size=body` (17), `color=ink`.
- Example: `<ThemedText font={fonts.bold} size="title2" color="ink">Projects</ThemedText>`

---

## Button — the pill CTA

- **Shape:** `paddingVertical: spacing.md` (12), `paddingHorizontal: spacing.xl` (24),
  `borderRadius: radius.pill`, `borderCurve: 'continuous'`, row layout, `gap: spacing.sm`.
- **Label:** `ThemedText size="body"` (17/400) in the variant's foreground color. The
  pill radius carries emphasis — do **not** bump the weight.
- **Variants** (`bg` / `fg` / `border`):
  - `primary` → `primary` / `onPrimary` (filled Action Blue) — the default.
  - `outline` → `canvas` / `primary` / 1px `primary` border (ghost pill, the 2nd CTA).
  - `ghost` → `canvas` / `primary` (no border).
  - `danger` → `danger` / `onPrimary` (destructive).
- **Press:** `scale → 0.95` via spring `{ damping: 18, stiffness: 320, mass: 0.6 }`;
  light haptic on iOS (`Haptics.impactAsync(Light)`).
- **Disabled/loading:** `opacity: 0.5`; loading swaps the label for an `ActivityIndicator`
  in the `fg` color. `fullWidth` → `alignSelf: 'stretch'`.
- **Never** a shadow.

---

## Text input — `Input`

- **Wrapper:** `gap: spacing.xs`, `alignSelf: 'stretch'`.
- **Label** (optional): `ThemedText font=semiBold size="callout"` (15/600) `color="ink"`.
- **Field box:** row, `borderWidth: 1`, `borderRadius: radius.md` (10),
  `borderCurve: 'continuous'`, `paddingHorizontal: spacing.base` (16),
  `backgroundColor: canvas`, `gap: spacing.sm`.
  - Border color: `hairline` default → `primary` when focused → `danger` on error.
- **TextInput:** `flex: 1`, `paddingVertical: spacing.md` (12), `fontFamily: regular`,
  `fontSize: body`, `color: ink`, `placeholderTextColor: inkMuted48`.
- **Icons:** optional left/right `Icon` at size 18, `color: inkMuted48`.
- **Helper line:** error → `caption` `danger`; else hint → `caption` `inkMuted48`.

---

## OTP input — `OtpInput`

- 6 boxes in a row, `gap: spacing.sm`. Each box: `flex: 1`, `aspectRatio: 1` (square),
  `borderWidth: 1`, `borderRadius: radius.md`, `borderCurve: 'continuous'`, `canvas` bg.
  - Border: `hairline` → `primary` on the active slot → `danger` on error.
- Digit glyph: `fontFamily: semiBold`, `fontSize: title3` (28), `color: ink`.
- A single transparent `TextInput` overlays the row (opacity 0, `oneTimeCode` autofill).
- **Error = horizontal shake:** reanimated sequence `-8, 8, -6, 6, 0` (50ms each).

---

## Cards & containers

The universal card:

- `borderRadius: radius.lg` (14), `borderCurve: 'continuous'`, `borderWidth: 1`,
  `borderColor: hairline`, `backgroundColor: canvas`, `padding: spacing.lg` (20),
  `gap: spacing.sm`. **No shadow.**
- **Press feedback:** `transform: [{ scale: pressed ? 0.98–0.99 : 1 }]`.
- **Grouped rows** (settings, delete-account lists): `surfacePearl` fill, `radius.lg`,
  `overflow: 'hidden'`, rows separated by a 1px `dividerSoft` top border (skip on row 0).
- **Selected card** (e.g. account-type choice): border upgrades to `2px primaryFocus`
  and the icon tint goes `ink → primary`. Nothing else changes — no glow, no shadow.
- Title `semiBold size="headline"` (20/600); supporting copy `regular` `callout`/`caption`
  in `inkMuted48`/`inkMuted80`; a footer row (budget/meta) with `space-between`.

---

## Chips & badges

- **Skill/tag chip:** `paddingHorizontal: spacing.sm`, `paddingVertical: spacing.xxs`,
  `borderRadius: radius.pill`, `backgroundColor: canvasParchment`,
  text `regular size="caption"` `inkMuted80`. Overflow shown as a `+N` chip. Cap visible
  at 3.
- **Filter chip:** pill; `canvasParchment` inactive / `primary` active; text `caption`,
  `ink` inactive / `onPrimary` active; press `scale 0.96`.
- **Status badge:** pill, `paddingHorizontal: spacing.sm`, `paddingVertical: spacing.xxs`,
  colored by a **status palette** (below).

### Status palettes (single source of truth)

Type these as `Record<Status, { bg; fg; label }>` so a new API status forces every screen
to handle it. Held/open states get the filled `primary` badge; terminal/neutral states
get a `canvasParchment` badge with a semantic `fg`.

```ts
PROJECT_STATUS_PALETTE = {
  open:         { bg: 'primary',         fg: 'onPrimary',  label: 'Open' },
  in_progress:  { bg: 'canvasParchment', fg: 'primary',    label: 'In progress' },
  under_review: { bg: 'canvasParchment', fg: 'warning',    label: 'Under review' },
  completed:    { bg: 'canvasParchment', fg: 'inkMuted80', label: 'Completed' },
  disputed:     { bg: 'canvasParchment', fg: 'danger',     label: 'Disputed' },
  cancelled:    { bg: 'canvasParchment', fg: 'inkMuted48', label: 'Cancelled' },
};
ESCROW_STATUS_PALETTE = {
  pending:  { bg: 'canvasParchment', fg: 'warning',    label: 'Awaiting payment' },
  held:     { bg: 'primary',         fg: 'onPrimary',  label: 'Held' },
  released: { bg: 'canvasParchment', fg: 'primary',    label: 'Released' },
  refunded: { bg: 'canvasParchment', fg: 'inkMuted80', label: 'Refunded' },
  disputed: { bg: 'canvasParchment', fg: 'danger',     label: 'Disputed' },
};
```

Skill-level chip has its own palette: beginner `parchment/inkMuted80`, intermediate
`parchment/primary`, advanced+expert filled `primary/onPrimary`.

---

## Avatar

- Circle: `width=height`, `borderRadius: half`, `backgroundColor: canvasParchment`,
  `overflow: 'hidden'`. Sizes seen: 20 (inline), 48 (list card), 112 (profile).
- Image fills at `contentFit: 'cover'`; **fallback** is the name's first initial in
  `semiBold` `inkMuted48`.
- Verified users get a `checkmark.seal.fill` `primary` glyph (14) next to the name.

---

## Empty state — `EmptyState`

- Centered; `paddingVertical: spacing.huge` (64), `paddingHorizontal: spacing.xl`,
  `gap: spacing.base`.
- `Icon` size 44 `inkMuted48` → title `semiBold size="title3"` `ink` → body
  `regular size="body"` `inkMuted48` centered, `maxWidth: 320` → optional CTA
  (`marginTop: spacing.sm`).
- Reused for loading-error and "nothing here yet" states across every list.

---

## Toast — `Toaster`

App-wide transient feedback (backed by a small store: `showToast(message, variant)`).

- **Position:** pinned top, `top: insets.top + spacing.sm`, centered, `maxWidth: '92%'`.
- **Pill:** `paddingVertical: spacing.md`, `paddingHorizontal: spacing.lg`,
  `borderRadius: radius.lg`, `borderCurve: 'continuous'`. **No shadow.**
- **Variant background:** `info → surfaceTile1` (near-black), `error → danger`,
  `success → primary`. Text is always `onPrimary` `regular size="callout"`.
- **Motion:** enter fade `0→1` (180ms) + slide `translateY -12→0` (220ms), ease-out cubic.
  Auto-dismiss after **3500ms**; tap to dismiss early.
- Use a toast for confirmations and recoverable errors; use an **alert** only when the
  user must make a choice.

---

## Alert & action sheet — `useAlert()`

Never import react-native `Alert` / `ActionSheetIOS` — the gray OS dialogs break the
language. One `AlertProvider` at the root exposes `alert()` and `sheet()`.

**`alert({ title, message?, buttons? })` — centered dialog.**
- Backdrop `colors.scrim`; card `maxWidth: 280`, `canvas`, `radius.lg`,
  `borderCurve: 'continuous'`, `overflow: hidden`. **No shadow.**
- Title `semiBold size="headline"` centered; message `regular size="callout"` `inkMuted80`
  centered. 1px `hairline` divider above the button row.
- Buttons: 2 render **side-by-side** (1px vertical `hairline` divider between), 1 or 3+
  stack. `cancel` → `semiBold` `primary`; `destructive` → `danger`; default → `primary`.
  Omit `buttons` for a single OK. Pressed row flashes `canvasParchment`.
- Enter: scale `0.94→1` (180ms) + fade.

**`sheet({ title?, message?, options })` — bottom action sheet.**
- Two stacked `canvas` `radius.lg` cards over the scrim: options card + a separate Cancel
  card (Cancel is appended **automatically** — never add your own). Rows: `minHeight 52`,
  centered `regular size="body"` `primary` (destructive → `danger`), 1px `hairline`
  between rows. `title`/`message` only on filter menus, as a `caption` `inkMuted48` header.
- Enter: slide up `translateY 60→0` (240ms) + fade. Respects `insets.bottom`.

**Critical:** the pressed handler runs **~240ms after the modal dismisses** so a follow-up
native picker (camera/library/document) presents cleanly. This one UI replaces all
`Platform.OS === 'ios' ? ActionSheetIOS : Alert.alert` branching.

---

## Icon — cross-platform SF Symbols

Name every icon with an Apple SF Symbol string (`"chevron.left"`). One `Icon` component
renders it — natively on iOS (`expo-image` `sf:` scheme, `tintColor`), mapped to a
`MaterialCommunityIcons` glyph on Android (SF Symbols are blank there; keep an
`ANDROID_GLYPH` map, fallback `help-circle-outline`). **Never** write
`<Image source="sf:…">` inline. Default size 20.

---

## App header — collapsing large title (`screen-scaffold`)

Replace the platform's default navigation header **everywhere** (`headerShown: false` on
every `Stack.Screen`). Content wraps in one of three scaffolds:

- **`ScreenScaffold`** — scroll view; forms & detail pages.
- **`ListScreenScaffold<T>`** — list; feeds. `padded` insets rows to the gutter; otherwise
  rows are full-bleed but the large title keeps the gutter.
- **`FixedHeader`** — non-collapsing bar for bodies that can't drive scroll (WebView, or a
  chat with an inverted list).

**Metrics:** `BAR_HEIGHT = 44`, `COLLAPSE_DISTANCE = 44`, `FADE_START = 12`.
A pinned bar sits `absolute` at top (`canvas` bg, `paddingTop: safe-area top`). The large
title (`bold size="title2"`, 40/700) lives at the top of the content and scrolls away; as
`scrollY` crosses `FADE_START→COLLAPSE_DISTANCE` the inline title (`semiBold size="body"`)
fades in and a 1px `hairline` appears under the bar. Back chevron is `chevron.left`
`primary` size 26.

**Header props:** `title`, `subtitle?`, `right?` (actions), `left?` (slot when no back
button), `showBack?`, `onBack?`, `sheet?` (drops the safe-area top inset on form sheets).
**Tab roots** set `showBack={false}`, `left={<HeaderSettingsButton/>}` (a `gearshape`
button), `right={<NotificationBell/>}` (+ a compose/filter button where relevant).

**Home/dashboard exception:** a **fixed** (non-collapsing) welcome hero — greeting +
settings + bell, `paddingTop: insets.top + spacing.sm` — that does *not* scroll away.

---

## Bottom tabs — `NativeTabs`

Native tab bar via `expo-router/unstable-native-tabs`. Each trigger gives both an iOS SF
symbol and an Android drawable + a label:

```tsx
<NativeTabs.Trigger name="dashboard">
  <NativeTabs.Trigger.Icon sf="house" drawable="ic_menu_home" />
  <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
</NativeTabs.Trigger>
```

Student tabs: Dashboard/Projects/Certify/Portfolio/Chat. Business tabs mirror the shape
(Dashboard/Projects/Talent/Payments/Chat). Each tab's Stack sets `headerShown: false`
(via `TabSection`) so screens draw their own collapsing header.

---

## Small components

- **`NotificationBell`:** `bell` `primary` size 22; unread → `danger` dot badge
  (`minWidth 16`, `height 16`, `radius.pill`, `micro` `onPrimary` count, `99+` cap) pinned
  `top: -4, right: -8`.
- **`RatingStars`:** `star`/`star.fill`, `primary` filled / `inkMuted48` empty; sizes
  `sm 14 / md 20 / lg 28`; interactive stars press to `scale 0.85`.
- **`StatGauge`** (dashboard metric-as-loader): `canvasParchment` tile, `radius.lg`,
  `padding: spacing.base`, `gap: spacing.sm`. Value `semiBold size="headline"`, label
  `caption inkMuted48`, then a **6px** track (`hairline`, `borderRadius: 3`,
  `overflow:hidden`) with a `primary` (or `success`) fill at `${pct*100}%`. No SVG — plain
  Views so it survives a JS reload.

---

## Keyboard-avoiding inputs (the Android gotcha)

`behavior="padding"` is an **iOS-only** no-op on Android — inputs hide behind the
keyboard. Use `height` on Android:

```tsx
<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + BAR_HEIGHT : 0}
  style={{ flex: 1 }}
>
```

KAV is the **outer** wrapper; the scaffold goes inside. Form-sheet screens keep
`presentation: 'formSheet'` and pass `sheet` to the scaffold.

---

## Motion (system-wide)

Quiet and quick. Entrances 150–240ms ease-out cubic; a subtle spring is fine, no bounce.
Press = `scale(0.95)` for buttons, `0.85` for star taps, `0.96–0.99` for cards/chips, or a
`pressed ? canvasParchment : transparent` background swap. Dialogs scale in from `0.94`;
sheets slide up 60px; toasts fade+slide from the top; OTP errors shake. The single
drop-shadow is for hero imagery only — never for UI motion or elevation.
