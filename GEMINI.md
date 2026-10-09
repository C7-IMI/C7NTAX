# Gemini / other models — read this first

This file is a pointer, not a second rulebook. Two documents govern a change, and both are part of it:

1. **[`DESIGN.md`](./DESIGN.md) — the design language.** Mandatory before any interface change. It sets out
   the four axes a change must survive (two interfaces, two themes, eight colour schemes, two densities),
   the tokens and shared components to use instead of inventing new ones, the two-interface pattern with
   markup, and the definition of done.
2. **[`.github/copilot-instructions.md`](./.github/copilot-instructions.md) — the house rules.** Change
   logging (`Retrace.md`, `BuildNotes.md`), the API document (`docs/openapi.yaml`, `docs/API.md`), and the
   in-app Help (`apps/web/src/pages/HelpDoc.tsx`).

[`AGENTS.md`](./AGENTS.md) holds the short version of both, plus the commands to run before reporting a
change as finished. [`CLAUDE.md`](./CLAUDE.md) is the same pointer for Claude.

If you read only one line of this: **a screen is finished when it has been designed twice — once for the
modern interface and once for the classic one — and verified on a colour scheme that is not the default.**
