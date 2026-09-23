# Screen Blueprints

How whole screens are composed from the tokens (`tokens.md`) and components
(`components.md`). These are the repeatable skeletons — match them so new screens feel
native to the app.

---

## The plain-screen skeleton (auth & simple flows)

Screens outside the collapsing-header system (the whole login flow) share one shape:

```tsx
<KeyboardAvoidingView behavior={ios ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: colors.canvas }}>
  <View style={{
    flex: 1,
    paddingHorizontal: spacing.xl,          // 24 gutter
    paddingBottom: spacing.xl,
    paddingTop: insets.top + spacing.xl,    // clear the notch
    gap: spacing.lg,                        // 20 rhythm
  }}>
    <ThemedText font={fonts.bold} size="title2" color="ink">Screen question</ThemedText>
    <ThemedText font={fonts.regular} size="body" color="inkMuted48">One-line subtitle.</ThemedText>
    {/* …fields / content… */}
    <View style={{ flex: 1 }} />           {/* spacer pushes the CTA to the bottom */}
    <Button label="Primary action" onPress={…} loading={…} disabled={…} fullWidth />
  </View>
</KeyboardAvoidingView>
```

**Rules:** big `bold title2` headline, `inkMuted48` subtitle, a flex spacer, one
`fullWidth` primary pill at the bottom. Canvas background. Nothing centered vertically —
content hangs from the top, CTA sits at the bottom.

---

## Login / onboarding flow (exact)

The full unauthenticated journey: **splash → onboarding → account-type → email → OTP →
(profile-setup) → dashboard.**

### 1. Splash (`(auth)/index`)
Centered `bold size="title2"` wordmark ("QueenSkiilia") on `canvas`, `padding: spacing.xl`.
Auto-advances to onboarding after **1500ms**. No buttons.

### 2. Onboarding (`(auth)/onboarding`)
Horizontal paged `FlatList` of 3 slides. **Skip** link top-right (`callout inkMuted48`,
`paddingTop: insets.top + spacing.base`). Each slide (`paddingHorizontal: spacing.xl`,
vertically centered, `gap: spacing.xl`):
- **Image** on top: `width: '100%'`, `height: '58%'`, `borderRadius: radius.xl`,
  `backgroundColor: canvasParchment`, `contentFit: 'cover'`, `transition: 200`.
- Title `bold size="title2"` `ink`; body `regular size="headline"` `inkMuted48`.
Pager dots: active `20×8` `primary` pill, inactive `8×8` `hairline`, `gap: spacing.sm`.
Bottom `fullWidth` Button: "Next" → "Get Started" on the last slide.

### 3. Account type (`(auth)/account-type`)
Plain skeleton. `bold title2` "Choose your account" + `inkMuted48` "You can switch later".
Two selectable cards (`gap: spacing.base`):
- `borderWidth: 1` `hairline` → **`2px` `primaryFocus` when selected**; `radius.lg`,
  `padding: spacing.lg`, row, `gap: spacing.base`, press `scale 0.98`.
- Left `Icon` size 28 (`ink` → `primary` when selected); title `semiBold size="headline"`;
  body `regular size="callout"` `inkMuted48`.
Flex spacer, then `fullWidth` "Continue" (disabled until one is picked).

### 4. Email (`(auth)/email`)
Plain skeleton. `bold title2` "What's your email?" + subtitle "We'll send you a 6-digit
code". One `Input` (label "Email", `leftIcon="envelope"`, email keyboard, `returnKeyType`
send). Spacer. `fullWidth` "Send code" (loading while requesting).

### 5. OTP (`(auth)/otp`)
Plain skeleton. `bold title2` "Enter the code" + subtitle naming the email. `OtpInput`
(6 boxes; shakes on error). A `space-between` row: "Expires in m:ss" (`caption inkMuted48`,
`fontVariant: ['tabular-nums']`) and a **Resend** link — `inkMuted48` "Resend in Ns" while
counting down (60s), `primary` "Resend code" when ready. Spacer. `fullWidth` "Verify".
Auto-submits when 6 digits are entered.

### 6. Profile setup (`(auth)/profile-setup`)
A `ScreenScaffold` form (title "Set up your profile"): an **AvatarPicker** at top, then
name / country / role-specific fields, and a `fullWidth` save CTA. Gated by the root
AuthGate until the profile is complete.

---

## Tab-root screen (e.g. Projects, Dashboard list)

Use `ListScreenScaffold` with `showBack={false}`,
`left={<HeaderSettingsButton/>}`, `right={<NotificationBell/>}`:

- **`ListHeaderComponent`:** a search `Input` (`leftIcon="magnifyingglass"`) + a horizontal
  scroll row of filter **chips** (Sort / Skill level / Budget), `gap: spacing.sm`.
- **Rows:** cards (`padded` so they respect the gutter), `gap: spacing.base`.
- **`refreshControl`:** `RefreshControl` tinted `primary`.
- **Infinite scroll:** `onEndReached` + a footer `ActivityIndicator`; a "That's everything"
  `caption inkMuted48` line when done.
- **`ListEmptyComponent`:** an `ActivityIndicator` while loading, else an `EmptyState`
  (error variant vs "nothing matches" variant).

---

## Dashboard / home (fixed hero)

The **exception** to the collapsing header. A pinned welcome hero that does *not* scroll
away, over a scrolling body:

- **Fixed hero bar:** `paddingTop: insets.top + spacing.sm`, greeting (`bold title3`) on
  the left, `HeaderSettingsButton` + `NotificationBell` on the right.
- **Body (scroll):** a row of **`StatGauge`** tiles visualizing the key metrics
  (rating /5, skill level, counts, earnings — earnings gauge uses `color="success"`),
  then section headers and lists. Stats are gauges/loaders, never plain number cards.

---

## Detail screen

`ScreenScaffold` with a `title` (+ optional `subtitle`) and `right` actions. Body is
stacked sections separated by surface color or `spacing.xl` gaps; grouped facts sit in a
card. A primary action is a `fullWidth` Button near the bottom of the scroll (or a
status-driven CTA — e.g. "Release funds" on an escrow card, which itself opens an
`alert()` confirm). Status shown via a **status-palette badge**.

---

## Form-sheet screen (create / edit / rate / dispute)

Presented as a native form sheet, not a full push:

```tsx
<Stack.Screen options={{ presentation: 'formSheet', headerShown: false, sheetGrabberVisible: true, sheetAllowedDetents: [0.99] }} />
<KeyboardAvoidingView behavior={ios ? 'padding' : 'height'} style={{ flex: 1 }}>
  <ScreenScaffold sheet title="New project" contentContainerStyle={{ gap: spacing.lg }}>
    …fields…
    <Button label="Review" onPress={…} fullWidth />
  </ScreenScaffold>
</KeyboardAvoidingView>
```

Pass `sheet` to the scaffold so it drops the safe-area top inset (a sheet is already inset
from the top). Hoist the `Stack.Screen` options object to a module constant so its
reference is stable (an inline object re-runs the layout effect and can loop). Root-level
sheets that must survive cross-tab navigation (pickers) live at the app root, not inside a
tab.

---

## Chat screen (special case)

`FixedHeader` (not collapsing) because the message list is **inverted**. Messages use
`ChatBubble` (own = `primary` bg / `onPrimary` text, other = `canvasParchment` / `ink`,
`radius.lg`); multiple images group WhatsApp-style via `ChatImageGrid` (1 full, 2 row, 3
stacked, 4+ a 2×2 with a `+N` cover) and open a full-screen paging `ImageViewer`. Input bar
is `ChatInput` (attach `paperclip` + pill text field + circular `primary` send button).
Wrap in KAV with `behavior="height"` on Android and `keyboardVerticalOffset: insets.top +
BAR_HEIGHT` on iOS. A closed conversation replaces the input with a muted notice.
