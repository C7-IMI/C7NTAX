# P1 & P2 UI modernization — rollback guide

**P1** adds: a **command palette** (⌘K/Ctrl-K), a **Search** trigger in the
header, a **density toggle** (comfortable/compact), and an **active-nav accent
rail**.

**P2** adds: **card elevation** (soft shadows + a gentle hover lift on
interactive cards), **typography polish** (Inter alternates, balanced headings,
tabular digits in tables), **sticky table headers** with row hover, and a
**1600px content container** so pages don't stretch edge-to-edge on ultra-wide
displays.

Both tiers are additive and gated by independent flags, so you can turn either
one off without touching code. Choose the level you need.

---

## Level 1 — Instant (browser only, no rebuild)

Open the browser console and run:

```js
c7UiP1.disable(); location.reload();   // disable P1 -> original UI
c7UiP1.enable();  location.reload();   // force-enable P1
c7UiP1.enabled;                        // current state

c7UiP2.disable(); location.reload();   // disable P2 -> pre-P2 look
c7UiP2.enable();  location.reload();   // force-enable P2
c7UiP2.enabled;                        // current state
```

Equivalent without the helpers:

```js
localStorage.setItem("c7_ui_p1", "0"); location.reload();  // P1 off
localStorage.setItem("c7_ui_p2", "0"); location.reload();  // P2 off
localStorage.setItem("c7_ui_p2", "1"); location.reload();  // P2 on
localStorage.removeItem("c7_ui_p2");   location.reload();  // back to default
```

While P1 is on, the command palette itself has **"Turn off modern UI (P1)"** and
**"Turn off look-and-feel polish (P2)"** actions.

This takes effect on reload and requires no server restart.

## Level 2 — Deployment-wide (env flag)

Set the build flag and restart the web server:

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts/rollback-ui-p1.ps1 -Restart              # P1 off
powershell -ExecutionPolicy Bypass -File scripts/rollback-ui-p1.ps1 -Part P2 -Restart    # P2 off
powershell -ExecutionPolicy Bypass -File scripts/rollback-ui-p1.ps1 -Part All -Restart   # both off
```

Or manually add to `apps/web/.env.local`:

```
VITE_UI_P1=false
VITE_UI_P2=false
```

then restart the web server (`startup/c7ntax-boot.ps1 -SkipSeed`). Re-enable with
`scripts/rollback-ui-p1.ps1 -Enable -Restart` or by removing the lines.

## Level 3 — Remove the code entirely

```powershell
git log --oneline -- apps/web/src/components/CommandPalette.tsx   # find the commit
git revert <commit>                                               # or revert the range
```

Files added/changed by P1 (all safe to delete/revert):

- `apps/web/src/lib/uiFlags.ts` (flag)
- `apps/web/src/lib/density.ts` (density)
- `apps/web/src/components/CommandPalette.tsx` (palette)
- `apps/web/src/components/Layout.tsx` (wiring: imports, palette + density state, ⌘K listener, header buttons, `nav-item` classes, `data-ui-p1`, palette render)
- `apps/web/src/main.tsx` (density on boot + `c7UiP1` helper)
- `apps/web/src/index.css` (the `── P1 modernization ──` block)
- `scripts/rollback-ui-p1.ps1`, `UI-P1-ROLLBACK.md`

Files added/changed by P2:

- `apps/web/src/lib/uiFlags.ts` (`UI_P2` flag + `setUiP2`)
- `apps/web/src/components/Layout.tsx` (`data-ui-p2` attribute + the P2 palette action)
- `apps/web/src/main.tsx` (`c7UiP2` helper)
- `apps/web/src/index.css` (the `── P2 modernization ──` block at the end)
- `apps/web/src/components/ui/PageHeader.tsx` (page-title typography)

If you only want part of it, the flags and the CSS blocks are independent — you
can keep the palette and drop the density/nav styling (or vice versa), or keep
P1 and drop P2 entirely.

---

## Notes

- **Default is ON** for both flags. With a flag off, the app renders exactly as
  it did before that tier: with P1 off the header keeps its original Search
  placeholder and the nav has its original active styling; with P2 off cards are
  flat, tables are non-sticky, and content is full width.
- The `data-ui-p1` / `data-ui-p2` attributes on the layout root plus the CSS
  gating mean each tier's styling is inert (not just hidden) when disabled.
- Order of operations is safe in any combination: P1 off + P2 on, or the
  reverse. To disable P2 when P1 is already off, use the console helper or the
  env flag (the palette requires P1).
- P1/P2 do **not** touch data, APIs, or routing — presentation and interaction
  only, so a rollback cannot affect stored data.
- Hover/transition effects respect `prefers-reduced-motion` via the global rule
  in `apps/web/src/index.css`.
- Colour schemes are a separate tier with their own flag — see
  [UI-PALETTE-ROLLBACK.md](./UI-PALETTE-ROLLBACK.md).
