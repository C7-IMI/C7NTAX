/**
 * Where the Outlook add-in's taskpane files live.
 *
 * Its own module because two callers need the same answer — the server that mounts `/addin` and
 * the deployment report that says whether the taskpane can be served at all — and the first
 * attempt at writing it twice got the depth wrong from one of them, which is exactly the kind of
 * bug a single definition prevents.
 *
 * `OUTLOOK_ADDIN_DIR` wins, so a deployment can ship the pane somewhere else. The default is the
 * directory beside the API package, which is where the manifest and the taskpane are built.
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** The configured directory, whether or not it exists. */
export function addinDirectory(): string {
  return process.env.OUTLOOK_ADDIN_DIR || path.resolve(__dirname, "..", "..", "..", "outlook-addin");
}

/** Whether the taskpane's files are actually on disk. A switch cannot serve a missing directory. */
export function addinAssetsPresent(): boolean {
  return existsSync(addinDirectory());
}
