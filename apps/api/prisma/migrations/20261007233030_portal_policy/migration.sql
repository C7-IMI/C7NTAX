-- Per-client and per-contact portal policy.
--
-- The portal's own rules were instance-wide only, so every customer saw the same thing: the
-- same ticket visibility, the same ability to raise and reply. A provider serving a
-- one-mailbox small business and a three-hundred-person client needs to treat them
-- differently, and Autotask, ConnectWise and Scoro all keep that on the client record (with a
-- per-contact overrule for the person who runs the account).
--
-- A NULL on any of these columns means "use the level above", which is what lets a deployment
-- configure the portal once and only the customers that differ carry values of their own.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "portalVisibility" TEXT,
ADD COLUMN     "portalAllowTicketCreation" BOOLEAN,
ADD COLUMN     "portalAllowReplies" BOOLEAN,
ADD COLUMN     "portalBoardId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "portalAccess" BOOLEAN,
ADD COLUMN     "portalVisibility" TEXT;
