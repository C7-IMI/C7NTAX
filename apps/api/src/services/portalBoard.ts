/**
 * Which service board a ticket raised in the customer portal lands on.
 *
 * Its own module because two callers need the same answer — the portal, and the configuration
 * screen that has to report which board is actually in force — and because "the client's own
 * board, else the configured one, else the oldest active one" is a rule worth being able to read in
 * one place.
 *
 * The client's board wins: a provider with one client whose tickets belong on a different queue
 * should not have to move everybody. Then the setting, which wins over the environment:
 * `PORTAL_DEFAULT_BOARD_ID` was the only way to choose this before the portal had a configuration
 * screen, and a deployment that set it must keep working, but an administrator moving the board
 * should not have to redeploy.
 */
import { prisma } from "../index";
import { AppError } from "../middleware/errorHandler";
import { logger } from "./logger";
import { configText } from "./appSettings";
import { clientPortalOverrides } from "./portalPolicy";

export async function resolvePortalBoardId(companyId?: string): Promise<string> {
  const configured = (companyId ? await clientPortalOverrides(companyId) : null)?.boardId ?? configText("portal", "defaultBoardId").trim();
  if (configured) {
    const board = await prisma.serviceBoard.findUnique({ where: { id: configured }, select: { id: true } });
    if (board) return board.id;
    logger.warn("portal.board", "The configured portal board does not exist — falling back to the oldest active board", { configured, companyId });
  }
  const fallback = await prisma.serviceBoard.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!fallback) throw new AppError("There is no service board to raise tickets on — ask your provider to configure one", 503);
  return fallback.id;
}
