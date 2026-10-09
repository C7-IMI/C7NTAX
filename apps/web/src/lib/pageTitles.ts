/**
 * Pages with no row in the navigation tree, because they are reached from somewhere else: the account
 * menu, the header toolbar, or a link inside another page.
 *
 * They still need a name. The navigation cannot supply one, and the fallbacks are worse than they look:
 * the header used to fall back to `Today` for any path it could not place, and the breadcrumb trail
 * inherited the same word through the Today node's `to: "/"`, which matches every path — so a path that
 * addresses nothing claimed to be the dashboard. A page gets its title here instead — one place, read by
 * the header (`getPageTitle`), the trail (`buildBreadcrumbs`) and therefore by the Recent menu's visit
 * labels, which are built from the trail. A path in neither this map nor the tree is not a page at all,
 * and the header says `Not found` for it.
 */
export const STANDALONE_PAGE_TITLES: Record<string, string> = {
  "/activity": "My Activity",
  "/console": "Console",
  "/settings": "Settings",
  "/settings/ai": "AI Inference",
  "/mfa-setup": "Two-Factor Authentication",
  // `/admin` is the same Configuration hub as `/admin/configuration`, kept as an address of its own
  // because links were made to it. The navigation row points at the longer path, so only that one
  // matches in the tree — without this the header says "Today" on its own settings screen.
  "/admin": "Configuration",
};
