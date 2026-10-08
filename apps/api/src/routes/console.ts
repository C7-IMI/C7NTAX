/**
 * The console's catalogue, served.
 *
 * PLAN-028 §6 rejects a general-purpose `POST /api/console` that takes a line and executes it, and the
 * reason is worth repeating where the code is: an execute endpoint is a class of endpoint that grows
 * its own authorization logic. **The console parses in the front end and runs the real route as the
 * caller**, so this file is the only thing the console adds to the API — two reads, permission-filtered
 * at call time.
 *
 * They exist so the CLI is not a second catalogue (a binary that claims 250 commands and refuses 200 of
 * them is worse than one that knows what its key can do), and so `help` in a terminal and `help` in the
 * browser answer the same question: **what can *I* run**.
 */
import { Router, type Response } from "express";
import {
  CONSOLE_COMMANDS,
  CONSOLE_GROUPS,
  CONSOLE_OWN_VERBS,
  CONSOLE_UNIVERSAL_FLAGS,
  describeCommand,
  permittedCommands,
} from "@C7NTAX/shared";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { configFlag } from "../services/appSettings";

export const consoleRouter = Router();
consoleRouter.use(authenticate);

/**
 * The catalogue is switched off with the console itself (Workspace → Command console, or
 * `CONSOLE_ENABLED=false`), and answers 404 rather than 403 — the same decision the Outlook add-in
 * routes make: a feature that is not offered should not look like a permission problem.
 */
function consoleDisabled(res: Response): boolean {
  if (configFlag("workspace", "console")) return false;
  res.status(404).json({ error: "The console is disabled on this deployment" });
  return true;
}

/** The caller's permission strings, as the session or the API key carries them. */
function callerPermissions(req: AuthRequest): string[] {
  const permissions = req.user?.permissions;
  return Array.isArray(permissions) ? permissions : [];
}

/**
 * Everything this caller may run, grouped the way `help` prints it.
 *
 * `counts.total` is deliberately reported beside `counts.available`: "42 of 78" tells a person what
 * their account is missing without telling them what it contains.
 */
consoleRouter.get("/catalog", (req: AuthRequest, res) => {
  if (consoleDisabled(res)) return;

  const permitted = permittedCommands(callerPermissions(req));

  res.json({
    groups: CONSOLE_GROUPS
      .map((group) => ({
        id: group.id,
        label: group.label,
        summary: group.summary,
        commands: permitted.filter((c) => c.group === group.id).map(describeCommand),
      }))
      .filter((group) => group.commands.length > 0),
    /** The console's own verbs: client-side, listed so help is complete on both front ends. */
    verbs: CONSOLE_OWN_VERBS,
    /** The flags every command accepts (PLAN-028 §9). */
    universalFlags: CONSOLE_UNIVERSAL_FLAGS,
    counts: { available: permitted.length, total: CONSOLE_COMMANDS.length },
  });
});

/** One command, with its flags, tier and — for the model and the CLI — the route it runs. */
consoleRouter.get("/catalog/:name", (req: AuthRequest, res) => {
  if (consoleDisabled(res)) return;

  // `ticket show` is typed with a space and named with one; a URL cannot carry it unescaped, so both
  // forms are accepted rather than making the caller remember which one the wire wants.
  const name = String(req.params.name ?? "").replace(/\+/g, " ");
  const command = permittedCommands(callerPermissions(req)).find((c) => c.name === name);
  if (!command) {
    res.status(404).json({ error: `No command \`${name}\` is available to you` });
    return;
  }
  res.json(describeCommand(command));
});
