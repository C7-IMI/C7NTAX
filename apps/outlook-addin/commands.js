/**
 * The command file Office insists on having for a command surface (PLAN-012).
 *
 * The ribbon button's action is `ShowTaskpane`, so nothing here runs on click. It exists because the
 * manifest must name a function file, and it stays empty of behaviour on purpose: creating tickets
 * without showing the board or reporting the result is the kind of one-click action that is
 * regretted later.
 */
/* global Office */

if (typeof Office !== "undefined" && Office.onReady) {
  Office.onReady(() => {
    Office.actions?.associate?.({
      /** No-op: the manifest opens the taskpane directly. */
      showTaskpane: () => { /* intentionally empty */ },
    });
  });
}
