# Working in this repository

C7NTAX is a PSA/ITSM platform. Most of it is hand-built, so a change that ignores the conventions below will
look like it came from another product — and will be built for one interface, one theme and one colour
scheme while users are looking at all of them.

**Read in this order before you change anything:**

1. **`DESIGN.md` — the design language.** Mandatory before *any* interface change: a page, a component, a
   dialog, a badge, a colour, a flag. It names the four axes every change must survive, the tokens and
   shared components to use, the two-interface pattern with markup, and the definition of done.
2. **`.github/copilot-instructions.md` — the house rules** for logging a change, the API document, and the
   in-app Help. Every one of them is part of the change rather than a follow-up to it.
3. The **rollback documents** at the root (`INTERFACE-ROLLBACK.md`, `UI-PALETTE-ROLLBACK.md`,
   `NAV-PANE-ROLLBACK.md`, `UI-P1-ROLLBACK.md`, `KUMO-*-ROLLBACK.md`, `CONTEXT-MENUS-ROLLBACK.md`) when you
   touch one of those layers. They say how to turn it off, which is the test of whether you understand it.

## The five things a model most often gets wrong

1. **Building for one interface.** Every screen has a **modern** and a **classic** arrangement — two designs,
   not a class toggle (`useModernInterface()`). 75 files already do this. See `DESIGN.md` §3.
2. **A colour literal.** Tokens are CSS variables so the two themes and **eight colour schemes** can move
   them (`DESIGN.md` §2). `node scripts/lint-design-tokens.mjs` must pass.
3. **A modern branch that is the classic one restyled.** If you cannot say what the modern arrangement does
   *differently*, it is not designed yet — or it belongs in `components/ui/` as a shared component instead.
4. **Inventing a component.** Check `apps/web/src/components/ui/` and the component classes in
   `apps/web/src/index.css` first: `.card`, `.chip`, `.btn-*`, `.input-field`, `.badge-status` and the rest
   already exist, and re-writing one of them forks the design system.
5. **Skipping the records.** Every prompt goes in `Retrace.md`; every completed change gets a
   `BuildNotes.md` entry (`node scripts/next-version.mjs`) and regenerated fallbacks
   (`node scripts/generate-buildnotes.mjs`). Nothing is "done" while those disagree with the code.

## Before you report a change as finished

```
npx tsc --noEmit -p tsconfig.json        # in apps/web (and apps/api if you touched it)
node scripts/lint-design-tokens.mjs      # no new colour literals
node scripts/check-route-guards.mjs      # every route keeps a permission
node scripts/check-api-docs.mjs          # the API document matches the routes
node scripts/check-help-links.mjs        # every Help link resolves, every walkthrough is in the Index
node scripts/check-encoding.mjs          # no double-encoded text
```

A UI change also owes a look at **both interfaces** and a **non-default colour scheme** — the method is in
`DESIGN.md` §1 and §9. Never round-trip a UTF-8 file through PowerShell; that is what `check-encoding.mjs`
exists to catch.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
