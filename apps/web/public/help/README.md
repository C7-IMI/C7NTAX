# Help screenshots

The pictures the walkthroughs point at. They are **part of the change that alters the screen**, in the
same way the walkthrough text is: a screenshot of a control that no longer exists is worse than no
screenshot, because a reader trusts it and then cannot find the thing.

## How they were taken

- From the **running application** (`http://localhost:3010`) against the dev instance, signed in as the
  administrator, in the **dark scheme** — the scheme the product ships as its default. Where a screen
  reads differently in light mode it is because of a colour token, not a different layout, so one shot
  per screen is enough.
- At a **1440-wide viewport, device scale factor 2** (so the files are ~2500px wide and stay crisp when
  the Help column renders them at ~700–900px), then clipped to the region the caption talks about. (The
  Branding, Reporting and Shortcuts figures added later were taken at a 1700-wide viewport, device scale
  factor 2 — ~3400px wide — to match the width of the pictures already here; the two documents,
  `branding-invoice.png` and `ticket-sheet.png`, are captured as the **sheet** the product produces and
  so are portrait rather than screen-shaped.)
- **PNG, unedited.** No arrows, no highlights, no browser chrome removed by hand: the caption carries the
  pointing in words ("the switch is the second row from the bottom"), which keeps the image honest and
  the annotation translatable.

## What each one is for

| File | Screen | Used by |
|---|---|---|
| `rail.png` | The navigation rail with a domain open | Navigation |
| `tickets-list.png` | The ticket list: board tabs, views, the column header row | Workspace, Shortcuts & Batch Actions |
| `close-dialog.png` | The close dialog on a NOC Alerts ticket, defaulted to *Close silently* | Workspace, Shortcuts & Batch Actions — *Closing a ticket* |
| `service-boards.png` | Service Boards, one board open, the close-notification switch visible | Configuration — *Service Boards* |
| `settings-hub.png` | The configuration hub with its search and area cards | Configuration |
| `email-connectors.png` | C7NC → Email: the watched mailboxes, each with the board it files into | Email-to-Ticket Setup |
| `email-apps.png` | The Microsoft 365 app panel: addresses, their boards, and the Exchange scoping commands | Email-to-Ticket Setup |
| `sign-in-audit.png` | Administration → Sign-in Audit: tiles, filters, the log | Sign-in Audit, Sessions & Devices |
| `security-sessions.png` | The Active sessions tab | Sign-in Audit, Sessions & Devices |
| `security-devices.png` | The Devices tab | Sign-in Audit, Sessions & Devices |
| `api-access.png` | API Access: keys, scopes, the event intake board | API Access & the Event Gateway |
| `cloudconnect.png` | C7NC overview | C7NC — connecting services |
| `service-alerts.png` | The Service Alerts outage board | Service Alerts & the Outage Board |
| `uptime-monitors.png` | Uptime monitors | Uptime Monitors |
| `branding-identity.png` | Branding → Identity: the marks, the two colours, and the specimen sheet beside the form | Branding — the logo, the letterhead and the paper |
| `branding-identity-classic.png` | The same page in the classic interface: labelled fields in a grid, a thumbnail per image | Branding — the logo, the letterhead and the paper — *In the classic interface* |
| `branding-documents.png` | Document Branding, one family open: the letterhead, paper, orientation and basis choices | Branding — the logo, the letterhead and the paper; Report Branding |
| `branding-reports.png` | Report Branding: the report rows, the family each inherits from, the sheets that differ | Branding — the logo, the letterhead and the paper |
| `branding-clients.png` | Client Branding: one client's own brand, every box inheriting the instance's | Branding — the logo, the letterhead and the paper |
| `branding-invoice.png` | A produced document: the invoice sheet, letterhead to footer | Branding; Quotes & Convert to Invoice |
| `report-export.png` | The report output chooser: the four ways out, the paper, the basis block | Reporting & Business Reviews |
| `ticket-sheet.png` | A ticket printed as a sheet, with the letterhead, the record and its resolution | Workspace, Shortcuts & Batch Actions — *Printing a ticket sheet* |

## Taking them again

1. Start the API and the web app (see the root README), sign in, and put the screen into the state the
   caption describes — an **empty** table or a closed dialog makes a poor illustration, which is why
   `close-dialog.png` shows a ticket being closed on the board whose default is the interesting one.
2. Set the viewport to 1440 wide (device scale factor 2 if you are capturing through Playwright), and
   clip to the region the figure is about rather than the whole page: the caption says what to look at,
   so the image should not contain three other things competing with it.
3. Replace the file in place — the name is the reference — and check the walkthrough still only claims
   what the new picture shows. If a control moved, the caption moves with it, in the same commit.
