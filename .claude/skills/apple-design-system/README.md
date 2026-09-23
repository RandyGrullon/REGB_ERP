# Apple Design System — Claude Skill

A portable [Claude](https://claude.com/claude-code) **skill** that teaches an agent the
Apple-inspired UI/UX design language used across the QueenSkiilia app, so any other
project can build and review UI in the same quiet, photography-first, single-accent
style.

## What's inside

```
SKILL.md                          Entry point — the 8 non-negotiable rules + how to apply them
references/
  apple-design-source.md          The canonical getdesign.md/apple DESIGN.md (verbatim) — the "why"
  colors.md                       The full color palette — every token grouped by role, with
                                  hex, usage, and a foreground-on-background pairing guide
  tokens.md                       Color / spacing / radius / type tokens, border widths,
                                  margin+padding conventions, elevation + responsive normalizers
  components.md                   Exact spec for every component — font, Button, Input, OTP,
                                  Card, chips & status badges, EmptyState, Toast, Alert, Sheet,
                                  Icon, collapsing header, tab bar, avatar, rating stars, gauges
  screens.md                      Whole-screen blueprints — the full login/onboarding flow,
                                  list, dashboard, detail, form-sheet, and chat screens
  checklist.md                    Do / Don't compliance list for reviewing UI
```

## Origin

The base design language was installed with **[getdesign](https://getdesign.md)**:

```bash
npx getdesign@latest add apple
```

That drops the canonical Apple `DESIGN.md` (preserved here at
`references/apple-design-source.md`). This skill captures how that language was hardened
into a shipping app — semantic tokens, responsive normalizers, and component recipes
that already passed design review. The reference implementation is Expo / React Native,
but the tokens and rules translate directly to web.

## The gist

1. One accent — Action Blue `#0066cc`. No second brand color.
2. Pill CTAs. The pill radius is the "action" signal.
3. No chrome shadows — elevation is surface-color change + hairlines. The only shadow
   is under hero/product imagery.
4. Weight ladder 400 / 600 / 700. **500 is banned.**
5. Hairlines, not heavy borders. Continuous (squircle) corners.
6. Air is the pedestal; large titles collapse on scroll; respect the gutter.
7. Custom Apple-styled alerts & sheets, never the OS default.

## Using it

**Claude Code / agent SDK:** drop this folder into your project's skills directory
(e.g. `.agents/skills/apple-design-system/` or `.claude/skills/…`). Claude loads it
automatically when a task matches the `description` in `SKILL.md` — building or
reviewing UI.

**Manually:** point your agent at `SKILL.md` and tell it to follow the design system
when building or reviewing screens.

## License

MIT
