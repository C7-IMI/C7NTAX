# P1 UI modernization — rollback guide

P1 adds: a **command palette** (⌘K/Ctrl-K), a **Search** trigger in the header, a
**density toggle** (comfortable/compact), and an **active-nav accent rail**.

Everything is additive and gated by a single flag, so you can turn it off
without touching code. Choose the level you need.

---

## Level 1 — Instant (browser only, no rebuild)

Open the browser console and run:

```js
c7UiP1.disable(); location.reload();   // disable P1 -> original UI
c7UiP1.enable();  location.reload();   // force-enable P1
c7UiP1.enabled;                        // current state
```

Equivalent without the helper:

```js
localStorage.setItem("c7_ui_p1", "0"); location.reload();  // off
localStorage.setItem("c7_ui_p1", "1"); location.reload();  // on
localStorage.removeItem("c7_ui_p1");   location.reload();  // back to default
```

While P1 is on, the command palette itself has a **"Turn off modern UI (P1)"**
action.

This takes effect on reload and requires no server restart.

## Level 2 — Deployment-wide (env flag)

Set the build flag and restart the web server:

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts/rollback-ui-p1.ps1 -Restart
```

Or manually add to `apps/web/.env.local`:

```
VITE_UI_P1=false
```

then restart the web server (`startup/c7ntax-boot.ps1 -SkipSeed`). Re-enable with
`scripts/rollback-ui-p1.ps1 -Enable -Restart` or by removing the line.

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
- `apps/web/src/index.css` (the `── P1 modernization ──` block at the end)
- `scripts/rollback-ui-p1.ps1`, `UI-P1-ROLLBACK.md`

If you only want part of it, the flag and the CSS block are independent — you can
keep the palette and drop the density/nav styling (or vice versa).

---

## Notes

- **Default is ON.** With the flag off, the app renders exactly as before P1:
  the header keeps its original Search placeholder, the nav has its original
  active styling, and nothing else changes.
- The `data-ui-p1="false"` attribute on the layout root plus the CSS gating mean
  the P1 styling is inert (not just hidden) when disabled.
- P1 does **not** touch data, APIs, or routing — it is presentation and
  interaction only, so a rollback cannot affect stored data.
