# Claude — read this first

This file is a pointer, not a second rulebook. The rules live in two places and both are part of any change:

1. **[`DESIGN.md`](./DESIGN.md) — the design language.** Mandatory before any interface change: a page, a
   component, a dialog, a badge, a colour, a flag. It sets out the four axes a change must survive (two
   interfaces, two themes, eight colour schemes, two densities), the tokens and shared components to use
   instead of inventing new ones, the two-interface pattern with markup, and the definition of done.
2. **[`.github/copilot-instructions.md`](./.github/copilot-instructions.md) — the house rules.** Change
   logging (`Retrace.md`, `BuildNotes.md`), the API document (`docs/openapi.yaml`, `docs/API.md`), and the
   in-app Help (`apps/web/src/pages/HelpDoc.tsx`). Each is part of the change, never a follow-up.

[`AGENTS.md`](./AGENTS.md) has the short version of both, and the list of commands to run before reporting
a change as finished.

## The two mistakes worth repeating here

- **Two interfaces, two designs.** `useModernInterface()` from `apps/web/src/hooks/useNavigationStyle` decides
  which. The Modern arrangement is built from its own furniture (rails, chips you press, sheets,
  a status track, sentences beside the control that acts) and the classic one is a **form** (labelled fields
  in a grid, a dialog with a heading and Save/Cancel). The shared part is the state, the API call and the
  words — never the layout. Verify both before calling it done.
- **No colour literals.** Colours are CSS custom properties wrapped for Tailwind so the themes and the eight
  schemes can move them; a hex is the one colour on the screen the theme cannot reach.
  `node scripts/lint-design-tokens.mjs` must pass.

Working notes for this repository are also kept in `Retrace.md` (every prompt, in order) and `BuildNotes.md`
(the changelog, which the in-app What's New page reads) — read the tail of `Retrace.md` if you want the
history of a decision and the reason it was made.
