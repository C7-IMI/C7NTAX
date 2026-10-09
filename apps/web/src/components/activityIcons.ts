import {
  BarChart3,
  Bot,
  Building2,
  FileText,
  KeyRound,
  LayoutGrid,
  LifeBuoy,
  Lock,
  Package,
  Plug,
  Receipt,
  Server,
  Settings2,
  Ticket,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { RecentIcon } from "../lib/recentActivity";

/**
 * One icon per kind of activity.
 *
 * Shared rather than declared beside the menu, because the same change is shown in two places — the
 * header's Recent menu and the My Activity page — and a ticket that is a ticket glyph in one list and
 * something else in the other would read as two different kinds of thing.
 */
export const ACTIVITY_ICONS: Record<RecentIcon, LucideIcon> = {
  ticket: Ticket,
  client: Building2,
  billing: Receipt,
  asset: Package,
  kumo: Lock,
  integration: Plug,
  ai: Bot,
  admin: KeyRound,
  alert: LifeBuoy,
  board: LayoutGrid,
  kb: FileText,
  report: BarChart3,
  settings: Settings2,
  page: Server,
};

/**
 * The icon for one activity. The fallback is reachable only if the API ever names a kind this build does
 * not know — the type says that cannot happen, and a value arriving from outside the type's reach still
 * should not be a component that fails to render.
 */
export function activityIcon(icon: RecentIcon): LucideIcon {
  return ACTIVITY_ICONS[icon] ?? Workflow;
}
