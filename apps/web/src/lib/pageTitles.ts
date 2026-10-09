/**
 * Pages with no row in the navigation tree, because they are reached from somewhere else: the account
 * menu, the header toolbar, or a link inside another page.
 *
 * They still need a name. The navigation cannot supply one, and the fallbacks are worse than they look:
 * the header falls back to `Today` for any path it cannot place, and the breadcrumb trail used to
 * inherit the same word through the Today node's `to: "/"`, which matches every path. So a page gets
 * its title here — one place, read by the header (`getPageTitle`), the trail (`buildBreadcrumbs`) and
 * therefore by the Recent menu's visit labels, which are built from the trail.
 */
export const STANDALONE_PAGE_TITLES: Record<string, string> = {
  "/activity": "My Activity",
  "/console": "Console",
  "/settings": "Settings",
  "/settings/ai": "AI Inference",
  "/mfa-setup": "Two-Factor Authentication",
};
