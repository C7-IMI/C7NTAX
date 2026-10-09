import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { BookOpen, HelpCircle, Settings2, ListOrdered, ChevronRight, Lightbulb, AlertTriangle, Wrench } from "lucide-react";
import { useRedesign } from "../hooks/useNavigationStyle";

// ── PSA-style documentation frame (structure modeled on Autotask / ConnectWise Asio / HaloPSA docs) ──
// Sections are grouped: "core" (the four Help subsections) and "walkthroughs" (step-by-step
// feature guides).
//
// MAINTENANCE RULE — this file is part of the change, not a follow-up to it. Whenever a feature is
// added, updated, changed or removed:
//   1. update that feature's walkthrough below (or add one if it has none);
//   2. update its rows in the "index" section, and the relevant rows in "configuration";
//   3. add the question to "faq" if a user would plausibly ask it;
//   4. link the walkthrough from the sections it belongs beside.
// A walkthrough is reachable as soon as it is in this array (the route is /help/walkthroughs/:slug),
// so a new section needs no route or menu change — but it must be listed in the Index, because that
// is where people look for something they cannot name.

export type HelpSection = {
  id: string;
  path: string;
  group: "core" | "walkthroughs";
  title: string;
  description: string;
  blocks: HelpBlock[];
  related: Array<{ label: string; to: string; external?: boolean }>;
};

type HelpBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "note"; text: string }
  | { kind: "tip"; text: string }
  | { kind: "warn"; text: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "figure"; src: string; alt: string; caption: string };

export const HELP_SECTIONS: HelpSection[] = [
  // ════════════════════════════ CORE ════════════════════════════
  {
    id: "getting-started", group: "core",
    path: "/help/getting-started",
    title: "Getting Started",
    description: "Set up your workspace, create your first ticket, and learn the core workflow.",
    blocks: [
      { kind: "h", text: "First login & profile" },
      { kind: "p", text: "Sign in with your email or username. Sign-in creates a **session** that stays alive while you work and ends after 30 minutes of inactivity — a minute before that, a warning appears with a countdown and a **Stay signed in** button, so a timeout never costs you an unsaved edit. Administrators are exempt. Multi-factor authentication (TOTP, with an emailed fallback) and passkeys are available where your administrator has enabled them; see Identity, Sessions & Sign-in." },
      { kind: "steps", items: [
        "Sign in and complete MFA if you have it.",
        "Open My Account (top right) to review your profile.",
        "Browse the navigation pane once, so you know where things are — right-clicking a section offers its own menu, including **Pin to Favorites**.",
        "Press **⌘K** (or Ctrl+K) and type a page name — the quickest way to reach anywhere.",
      ] },
      { kind: "tip", text: "Press T anywhere outside a text field to jump straight to Tickets." },
      { kind: "h", text: "The core ticket workflow" },
      { kind: "p", text: "C7NTAX is built around the ticket lifecycle: create → triage → work → resolve → invoice." },
      { kind: "steps", items: [
        "Open Tickets and select New Ticket (or press T to open the list first). The list is organised by **board tabs** across the top — one tab per board with its ticket count, plus **All Boards** — and the band underneath names the board you are viewing and how many tickets are on it.",
        "Pick the client, board, category, and priority. Priority is deduced automatically if you leave it unset.",
        "Add time entries as you work, and file any out-of-pocket cost on the ticket's **Expenses** tab — billable time and approved expenses flow into invoices.",
        "Resolve the ticket when work is complete. A resolved ticket can be drafted into a knowledge base article so the fix does not leave with you.",
        "Follow-ups and auto-close rules are configured per board.",
      ] },
      { kind: "h", text: "Finding your way around" },
      { kind: "table", headers: ["Area", "Holds"], rows: [
        ["Home & Today", "The landing page, and the dashboard you arrange yourself"],
        ["Service Alerts", "Vendor status feeds, your own uptime checks, and the outage board"],
        ["Tickets", "Every ticket, organised by board tab, with saved columns, filters and batch actions"],
        ["Service Boards", "Board layouts, SLA policies and email connectors"],
        ["Pipeline", "Opportunities and deals"],
        ["Clients", "Client records, contacts, and each client's portal access"],
        ["Assets & Procurement", "The asset inventory, purchase orders, and each vendor's details"],
        ["Projects", "Projects, the shared Calendar, and Time Off"],
        ["Knowledge Base", "Articles, categories and drafts"],
        ["Kumo", "Passwords, configurations, documents, checklists, assets and domains"],
        ["Billing", "Invoices, agreements, payments, time and expenses, and finance reports"],
        ["Reporting", "Dashboards, standard reports, business reviews and designed reports"],
        ["Administration", "Settings, boards, service alerts, the product catalog, audit logs, integrations and What's New"],
      ] },
      { kind: "note", text: "The navigation only offers what your role is allowed to open, so a missing area is a permission rather than a fault — ask an administrator to check your role." },
      { kind: "h", text: "What hovering tells you" },
      { kind: "p", text: "Every button, link and field explains itself on hover. The label is taken from the control itself wherever it can be: its own words first, then an accessible label, then a `title`, and only for a control that shows nothing but an icon does the icon answer — and then only with the action it performs (\"Refresh\", \"Delete\", \"Sign out\"). An icon whose picture does not name an action (a key, a shield, a gear, a chevron) never speaks for itself, because \"Keyround\" tells you nothing useful: the control is labelled by the feature it belongs to instead, and where even that is unknown, no tooltip appears rather than a wrong one. A long paragraph on a card is not repeated as a tooltip either — but a name the page has cut off with an ellipsis is shown in full." },
      { kind: "h", text: "Team & boards setup" },
      { kind: "p", text: "Administrators configure service boards, SLA policies, and team permissions under Administration → Service Boards." },
      { kind: "steps", items: [
        "Create a service board for each team or client group.",
        "Attach an email connector so inbound mail becomes tickets automatically (see Email-to-Ticket Setup).",
        "Assign technicians via Users & Roles → Manage Users and Manage Roles.",
        "Add the items you sell to Administration → Product Catalog, so quoting and billing price from one place.",
      ] },
      { kind: "note", text: "Board layouts, batch ticket actions, the dashboard and keyboard shortcuts are covered in the Workspace, Shortcuts & Batch Actions walkthrough." },
    ],
    related: [
      { label: "Workspace, Shortcuts & Batch Actions", to: "/help/walkthroughs/shortcuts" },
      { label: "Email-to-Ticket Setup", to: "/help/walkthroughs/email-tickets" },
      { label: "Identity, Sessions & Sign-in", to: "/help/walkthroughs/identity-security" },
      { label: "Billing, Agreements & Overtime", to: "/help/walkthroughs/billing-agreements" },
      { label: "FAQ", to: "/help/faq" },
      { label: "Help Index", to: "/help/index" },
      { label: "Tickets", to: "/tickets" },
    ],
  },
  {
    id: "faq", group: "core",
    path: "/help/faq",
    title: "FAQ",
    description: "Answers to the most common questions about tickets, billing, integrations, and Kumo.",
    blocks: [
      { kind: "h", text: "Navigation & workspace" },
      { kind: "p", text: "Q: Can I keep the sections I use most at the top? — A: Yes. Right-click any section or subsection in the navigation and choose **Pin to Favorites**. It is a copy rather than a move — the section stays where it is, and a second copy of it appears under Favorites at the top of the pane, in an order you drag into place." },
      { kind: "p", text: "Q: What else is in the navigation's right-click menu? — A: Whatever you right-clicked. A page offers Open, Open in new tab, Open in new window and Copy link; a section adds its own expand and collapse; a pinned copy adds Move up, Move down and Remove from Favorites; and right-clicking empty space gives Expand all, Collapse all and Remove all favorites." },
      { kind: "p", text: "Q: I lost my place — how do I get back? — A: Press **Recent** in the header. It lists the last five things you changed and the pages you stayed on, and clicking one returns you to that exact place, flashing the spot you were working in. **Show All** opens the same history at length on your own **My Activity** page — also in the account menu, under **My Account → My Activity**." },
      { kind: "p", text: "Q: Can I see what somebody else was doing? — A: Only with the audit permission, and only under **Administration → Audit Logs**, which records every change across the instance whoever made it. **My Activity** is deliberately only ever your own; it is not a filtered view of that page." },
      { kind: "p", text: "Q: My navigation looks different from a colleague's — is something wrong? — A: Probably not. The pane has two shapes, **rail and sections** and the **single tree**, and both are supported; the instance's default is set at Administration → Configuration → Workspace → **Navigation pane**. You can also disagree with it for your own browser, which is the quicker way: **My Account → Appearance → Navigation** switches the pane where you are standing, or the same thing from a console is `localStorage.setItem(\"c7_ui_nav\", \"0\"); location.reload()`, and `\"1\"` puts the rail back. Nothing about a page changes either way." },
      { kind: "p", text: "Q: Why has a section moved, or gone missing, in the navigation? — A: Two different things, and the pane tells you which. Rows you have never opened can fold into **Everything else** inside a section — counted, and one click away. A section that has moved is in another domain, and the filter at the top of the panel searches the whole application and shows where each hit lives. Nothing is ever removed: a destination the pane has not been told about appears under **Other** on the rail rather than disappearing." },
      { kind: "p", text: "Q: My colleague's screens look different from mine — is something wrong? — A: Probably not. The screens have two layouts, **Redesign** and **Classic**, and both are supported; the instance's default is set at Administration → Configuration → Workspace → **Interface**. **My Account → Appearance → Interface** switches them where you are standing, in either direction, and nothing about a page changes either way — the same tabs hold the same panels. Your colour scheme and spacing are unaffected by the switch." },
      { kind: "p", text: "Q: Where did the Configurations and Products tabs go? — A: They are still there, one click deeper: **Configurations** under *Finance*, and **Products** under *Work*, in the redesigned screens. **My Account → Appearance → Interface → Classic** returns the single strip of twelve tabs. In both layouts a ticket's own tab is unchanged." },
      { kind: "p", text: "Q: The client list is showing cards rather than a table — can I have the table back? — A: Yes, and you do not have to change layout for it. **Clients** has a **Cards / Table** switch in its toolbar; Table is the six-column list you had before, Cards is the grid of client cards, and the switch remembers nothing, so either is one click away. Classic shows the table." },
      { kind: "p", text: "Q: How do I stop scrolling so much on a ticket? — A: The redesigned detail screen already spends less height on chrome: the header is one row rather than two, the actions sit on the same line as the tabs, and the sub-tabs sit under them — about 70px less before the panel begins — and the tab strip **stays pinned** while the panel scrolls, so the twelve panels are always one click away without going back to the top. Above that, the bar every page shares is one line instead of three, which is another **44px on every screen in the application**. **My Account → Appearance → Interface → Classic** returns the taller layout if you would rather have it, and **Preferences → Use compact spacing** tightens every table in the application." },
      { kind: "p", text: "Q: Where has the breadcrumb in the top bar gone? — A: In the redesigned interface it is not repeated there. The rail already shows where you are — the row for the section you are in stays lit — and a record that has somewhere to go back to carries its own trail on the page (a ticket reads *Tickets › its board › its number*). The bar above every page has room for either the trail or the description of the section, and at 1280px the description is the one worth spending the line on. **My Account → Appearance → Interface → Classic** puts the trail back where it was." },
      { kind: "h", text: "Tickets" },
      { kind: "p", text: "Q: Why was a ticket's priority changed automatically? — A: The priority deduction engine adjusts priority from keywords and SLA rules; you can override it manually." },
      { kind: "p", text: "Q: Can I acknowledge or close many tickets at once? — A: Yes. Select the checkboxes on the left of the ticket list, then apply a batch action from the bulk bar." },
      { kind: "p", text: "Q: What are the counts above the ticket list? — A: The **views**: All, Workable, Escalated, Waiting, On Hold and New. Each one is a filter you press rather than a dialog you fill in, and the number beside it says how many tickets it would show *before* you press it — so \"Waiting 17\" is a reason to look and \"Waiting\" is not. The counts are for the board and client you are looking at, not the whole instance. A view is held in the address, so the list can be linked to and it survives a reload, and **Filtered by** underneath still names every filter in force, including the ones a view set." },
      { kind: "p", text: "Q: How do I see a ticket's priority without a column for it? — A: Tickets carry a thin coloured bar in front of the summary — grey for low, amber for medium, orange for high, red for critical — so priority is something you notice while reading the list rather than another column competing for width. Hovering it names the priority. Choose Columns still offers the priority column for anybody who sorts by it." },
      { kind: "p", text: "Q: What is the Age and SLA column? — A: **Age** is how long the ticket has been open, in the compact form the queue is read in (34m, 4h, 2d). **SLA** is the clock: the board's SLA target — or the ticket's due date, if that is what your instance sets — as *\"3d to SLA\"* while there is time, amber inside four hours, and red as *\"SLA breached · 2d ago\"* once it has gone. Hovering either one shows the exact timestamp, and a ticket with neither a due date nor an SLA target shows a dash rather than a guess. **Age** is on by default; **SLA** ships hidden — **Choose Columns** adds it, and removes either, like any other column." },
      { kind: "p", text: "Q: Why do the rows in the ticket list no longer wrap? — A: Because a queue is read by scanning it, and a row three lines high cannot be scanned. The columns are measured against the tickets on screen and set to the width their content asks for, so a client name or a timestamp is shown whole on one line; whatever does not fit is trimmed with an ellipsis and the full value is in the tooltip. The text is a size smaller than it used to be for the same reason — the same columns fit in less width. If a column is still not the size you want, drag its right edge; if you would rather have fewer columns than narrower ones, Choose Columns turns them off." },
      { kind: "p", text: "Q: Can I change a ticket's status without opening the Edit form? — A: Yes. In the redesigned screens the ticket's states are **pills beside its title** — status, priority, assignee, source and the SLA clock. Press one and pick a value; it saves immediately, through the same route the Edit form uses, and everything it affects (the queue, the SLA, the audit trail) is updated the same way it always was. Use **Edit** when you want to change several fields at once or work with the full form." },
      { kind: "p", text: "Q: Can emails create tickets automatically? — A: Yes. Configure a monitored mailbox or M365 Graph connector under Administration → Service Boards → Email connectors." },
      { kind: "p", text: "Q: How do I set up the Microsoft 365 app the connector needs? — A: Open the connector, choose **Microsoft 365 / Exchange Online** and **App-only (client secret)**, then press **Deploy OAuth app**. The wizard signs you in with a code, creates or reuses the registration, grants the Mail.ReadWrite application permission with admin consent, mints the secret, prints the Exchange Online scoping commands, and fills the connector's fields. You need Application Administrator (or Global Administrator) on the tenant, and you must run the Exchange commands — until they are run the app can read every mailbox in the tenant." },
      { kind: "p", text: "Q: Can one Microsoft 365 app watch several mailboxes? — A: Yes, and that is the normal shape: one registration consenting once, with an address per board (`alerts@` → NOC Alerts, `servicedesk@` → MSP Service Desk). Add the first one through **Deploy OAuth app**, then add each further address by choosing **Reuse …** under **Which Microsoft 365 app** and supplying only the mailbox and its board. Exchange has to be told about each address separately — open **Exchange scoping** on the app and run the commands it prints, which cover every address on it, or the new mailbox stays unreadable to the app." },
      { kind: "p", text: "Q: Why does the app need Mail.ReadWrite and not Mail.Read? — A: Because the connector marks a message read once it has become a ticket. A read-only registration connects happily, reads the mailbox, and then fails on the first message it tries to mark — which is why the wizard refuses a registration that was granted Mail.Read." },
      { kind: "p", text: "Q: Consent was granted but the connector still says AccessDenied — A: Consent takes 30–60 minutes to reach the mailbox layer. An immediate `ErrorAccessDenied` is expected rather than a misconfiguration; wait and test again before changing anything." },
      { kind: "p", text: "Q: Can I use the script instead of the wizard? — A: Yes, and both are supported. `O365/New-C7NTAXMailboxApp.ps1` does the same work from a terminal and writes `out/c7ntax-m365-app.json`; paste that file into the wizard and it fills the same fields. The script is the reference if you want to see exactly which Graph calls are made." },
      { kind: "p", text: "Q: Somebody cannot sign in and I need to know why — A: Open **Administration → Sign-in Audit**. Every attempt is there with its outcome, the reason, the device and the address: a wrong password, a locked account, a failed second factor, or an address that is not an account here. If the account is locked, five failures did it and the counter is cleared by unlocking the user." },
      { kind: "p", text: "Q: How do I sign somebody out everywhere? — A: **Administration → Sign-in Audit → Active sessions**, then **Sign out everywhere** on any of their rows. To end one browser only, use **Revoke** on that row. Changing a password or disabling the account already ends every session as well; these buttons are for when you have not done either and need it now." },
      { kind: "p", text: "Q: How do I remove a lost phone's passkey? — A: **Administration → Sign-in Audit → Devices** lists every passkey and notification subscription with the account it belongs to; the bin beside it removes it. A person can also do it themselves under **My Settings → Security** — the screen an administrator needs is the one for a device they cannot reach." },
      { kind: "p", text: "Q: Does the customer get told when their ticket changes? — A: Yes. A customer note, a time entry or a status change emails the ticket's customer contact — an internal note does not. Closing is the one notification with an instruction in it rather than a report: see **Closing a ticket** below." },
      { kind: "p", text: "Q: I closed a ticket but the client replied — what happens? — A: It reopens by itself. A reply from one of the client's own contacts on a closed, resolved or cancelled ticket puts it back in the queue with the status **Customer reopened**, records the reply on the ticket, and leaves a line in the thread saying why. The status is deliberately not *In Progress*: a ticket that was declared finished and came back is not the same as one that was never finished, and folding them together hides the tickets that were closed too early. A reply from anyone who is not a client contact — a vendor, a colleague, one of our own technicians — is recorded without reopening." },
      { kind: "p", text: "Q: Why would I close a ticket without emailing the client? — A: Because the email is not always the right thing: the contact may have left, the ticket may be a duplicate, or it may have been opened by mistake. Close it with the **Close silently** choice (untick *Email the client* in the classic screens) and the ticket settles with nothing sent — the closing note is still recorded on the ticket either way, so the record of why does not depend on whether anybody was told." },
      { kind: "p", text: "Q: Why did a ticket close without emailing my client? — A: Because its **board** is set not to, and the dialog offered **Close silently** as the default. That setting exists for the NOC Alerts board: those tickets arrive from monitoring systems, and a closure email to a no-reply address is a message to nobody that looks like a notification. Turn it back on per board under Administration → Service Boards, or pick **Email the client** in the dialog for a single closure." },
      { kind: "p", text: "Q: Which boards close a ticket without emailing the client? — A: Open **Service Boards** and read the rail: each board says it in words — **emails the client on close**, or **closes without emailing the client** — and the selected board's own page repeats the answer beside the two choices the close dialog offers, with the table beneath comparing the closing email, the SLA clocks, auto-close and follow-up across every board at once. See the Service Boards walkthrough." },
      { kind: "p", text: "Q: Our RMM raises the same alert every minute — will that be sixty tickets? — A: No. Send it to the event gateway (POST /api/events) with your own stable id for the condition and the first one opens a ticket while the rest are added to it as notes with an occurrence count. Send `kind: \"recovery\"` and the ticket resolves. See API Access & the Event Gateway." },
      { kind: "p", text: "Q: Can our SIEM (or monitoring platform) create tickets? — A: Yes — issue it an API key on Administration → API Access with just **ticket:create** and **ticket:view**, and have it POST to /api/events. The key can do nothing else, and it loses even that the moment the account behind it does." },
      { kind: "p", text: "Q: Can I use the API from a script of my own? — A: Yes. Anything the application does is a documented operation: issue a key, send it as `Authorization: Bearer …`, and the reference is docs/API.md with the generated specification at docs/openapi.yaml. For a person at a keyboard, a session token from sign-in works on the same header." },
      { kind: "p", text: "Q: What happens if an API key leaks? — A: Rotate it. Rotation issues a new secret and invalidates the old one immediately, and both are in the audit log. The leaked value is worthless before the rotation finishes only if you are unlucky; the point of rotation is that it never needs to be recovered, because the stored hash cannot be reversed." },
      { kind: "p", text: "Q: Can a solved ticket write the knowledge base article? — A: It can draft one. Open a resolved ticket and ask for a draft; it is filed unpublished, with the ticket number attached, for a person to review." },
      { kind: "h", text: "Clients & contacts" },
      { kind: "p", text: "Q: Where do I find everybody at a client, and what they have raised? — A: **Clients → Contacts**, the address book by client. The rail narrows the list to one view or one client, every row carries the person and their client with how many tickets they have raised and how many are still open, and selecting somebody opens the sheet: their client's weight, what they have raised with the newest tickets linking through, whether they can sign in to the portal, the last thing recorded against them, and the four things you do from here." },
      { kind: "p", text: "Q: Somebody has left — how do I stop them signing in to the portal? — A: **Clients → Contacts**, select the person, and turn on **Refuse the portal to this person** under **Signing in to the portal**. It refuses that person alone: it holds whether or not their client's portal is on, and it would still refuse them if the client's portal were switched on tomorrow. **What they would see** beside it overrules the client's own answer for one person. Both controls are offered to whoever may change the portal's settings; turning the client's own portal off is the blunter answer, because it takes the portal away from everybody at that client." },
      { kind: "h", text: "Console" },
      { kind: "p", text: "Q: Why can't I see the Console button? — A: One of three switches is closed. Your account must hold `console:use` (Administration → Users & Roles → Console), your client must not have the console turned off (its own record has the switch), and the deployment must have it on (Configuration → Workspace → Command console). All three answers are the same to the interface: no button, and a `/console` link lands on a refusal rather than a console." },
      { kind: "p", text: "Q: If somebody has the permission, can they run everything? — A: No. `console:use` decides whether they get a console at all; each command is then filtered by the permission it needs, so a technician types `help` and sees the commands their account may use. The API answers the same way — a command a key or a person may not run is refused rather than hidden." },
      { kind: "p", text: "Q: Can we turn the console off for one client without touching everyone else? — A: Yes. Open the client, and on its Console card tick **Disable the console for every member of this client**. Only people who belong to that client lose it; your own staff are unaffected. It needs `system:config`." },
      { kind: "p", text: "Q: Can the console change data? — A: Not yet. Every command reads today; write commands arrive with PLAN-026's action manifest, and they will appear in the same catalogue with the permission each one needs." },
      { kind: "p", text: "Q: I preferred the console's old output — can I get it back? — A: Yes. **Advanced** in the console's header prints the route's field names in the route's own order, one per line, with every declared column and the values exactly as they arrived (raw timestamps, `true`/`false`). Basic lays the same result out to be read; Advanced shows what the route actually said. The choice is remembered for this browser, and switching it redraws output that is already on screen." },
      { kind: "p", text: "Q: The table is missing a column I expected — A: A column that holds nothing in every row is left out and the footer says how many were: three em dashes down a whole table is noise, not information. The data is untouched, `--json` prints the route's response exactly as it was sent, and **Advanced** shows the column." },
      { kind: "p", text: "Q: Can the console pop-up be made bigger? — A: Yes. Drag its right edge, its bottom edge or the bottom-right corner, and the size is remembered for that browser. Double-click the corner for the default size, or focus it and press the arrow keys (Shift for bigger steps). The `/console` page fills its column instead." },
      { kind: "h", text: "Sign-in & sessions" },
      { kind: "p", text: "Q: Why was I signed out? — A: The session ended after 30 minutes of inactivity. The sign-in page says the session timed out rather than showing a generic error, and in future a countdown warning appears a minute before it does." },
      { kind: "p", text: "Q: Can I stay signed in longer? — A: Yes, but not per person: an administrator can change the timeout under Settings (5–480 minutes). No session lives longer than 12 hours whatever the setting." },
      { kind: "p", text: "Q: Why does my colleague never get timed out? — A: Administrators and super-admins are exempt from the inactivity timeout. It is a role, not a personal preference." },
      { kind: "p", text: "Q: I am locked out and need to get back in. — A: AUTH_HARDENING_ENABLED locks an account after 5 failed sign-ins. For diagnosis there is a single named test-exemption account (AUTH_TEST_BYPASS) that skips the lockout, the timeout and the password-change gate; it refuses to run in production and should be unset everywhere real." },
      { kind: "h", text: "Billing, expenses & catalog" },
      { kind: "p", text: "Q: How do I invoice unbilled ticket time? — A: Either the Finance Dashboard's **Generate draft invoice** for one client, or the bill-through batch, which previews a whole period across clients before creating anything." },
      { kind: "p", text: "Q: Can the batch double-bill somebody? — A: No. The preview only considers time and expenses that are not already on an invoice, and creating the batch marks them. Rejecting the batch clears the marks and deletes the drafts, so the work is picked up again next time." },
      { kind: "p", text: "Q: How does a technician claim back a cost they paid for? — A: On the ticket's Expenses tab. It is filed as pending, and somebody with billing-manage approves or rejects it — and a rejection has to say why." },
      { kind: "p", text: "Q: Where does a quote's price come from? — A: The Product Catalog. Search a line item by name or SKU and the description and sell price are copied in, so the price quoted and the price invoiced are the same number." },
      { kind: "p", text: "Q: Why can't my technician see what an item cost us? — A: Cost and margin are only returned to accounts holding the catalog's manage permission — the sell price is what someone attaching an item needs. It is enforced on the server, not hidden in the interface." },
      { kind: "p", text: "Q: Why can't I delete a product? — A: Because it has been quoted, ordered or billed. Deleting it would leave a record pointing at an SKU that no longer exists, so retire it instead — it leaves the pickers and every existing record keeps its numbers." },
      { kind: "h", text: "Reporting" },
      { kind: "p", text: "Q: Why does a report say a figure is unknown instead of showing a number? — A: Because it genuinely cannot be known from the data, and estimating it would be inventing a number. Where a figure is incomplete the report says what is missing — how many hours carry no cost rate, for example." },
      { kind: "p", text: "Q: Which period does a business review use? — A: The last **finished** one, and it compares like for like: a period still in progress is measured against the same number of days of its predecessor, never against the whole of it." },
      { kind: "p", text: "Q: Can I build my own report? — A: Yes — Reporting → Custom Reports → New designed report. Bands, expressions, totals, charts and sub-reports, exported as Print, PDF, Excel or CSV, or scheduled as a PDF." },
      { kind: "h", text: "Companion clients (C7NC)" },
      { kind: "p", text: "Q: How do I get the Outlook add-in? — A: C7NC → Outlook Add-in, and press Download the installer. It is per-user and needs no administrator rights. Close and reopen Outlook afterwards — the add-in list is read once at start-up, so a running Outlook will not show the button." },
      { kind: "p", text: "Q: Can I see the add-in before installing it? — A: Yes. Administration → Configuration → Client Apps & Notifications → **Open the simulator** shows the add-in's own pane in a separate window with example emails, so the questions, the review and the result can be walked through with nothing created, sent or saved. It needs the add-in switched on, because it is served from the add-in's own address." },
      { kind: "p", text: "Q: What does “Bundle into one ticket” do? — A: It makes one ticket from a whole conversation: you choose which message the ticket is written from, and the others are saved on it as `.eml` files you can open later. The alternative, **One ticket each**, makes a separate ticket for every message." },
      { kind: "p", text: "Q: An add-in update caused trouble — how do I go back? — A: C7NC → Outlook Add-in keeps every installer version, each with its own Download: the release in use leads under **Latest Release**, and everything it replaced is kept together below it under **Previous Versions**. Install the earlier package over the current one and restart Outlook. Entries marked **Older plugin files** were built from a different set of add-in files, so they are the candidates when a recent change is at fault." },
      { kind: "p", text: "Q: The add-in installed but shows an empty pane — A: Almost always an installer built for a different server, which registers a manifest pointing somewhere the taskpane does not exist. C7NC → Outlook Add-in compares the address the installer was built for against this server's and shows the rebuild command when they differ." },
      { kind: "p", text: "Q: Why can't I download the manifest from the repository? — A: Because the file on disk still holds the `__ADDIN_HOST__`, `__ADDIN_GUID__` and `__ADDIN_VERSION__` placeholders, and Office rejects a manifest whose URLs are not absolute — silently. Download it from the page instead, where the server has already replaced the placeholders with its own address and plugin version." },
      { kind: "h", text: "Integrations & alerts" },
      { kind: "p", text: "Q: Where do I fix a broken integration? — A: C7NC shows live connection status; fix credentials inline and re-test without leaving the page. With live status on, a chip means \"last verified\", not \"last saved\"." },
      { kind: "p", text: "Q: Can outages open tickets automatically? — A: Alert webhooks POST each alert as it opens and closes, signed with the endpoint's own secret, so your automation can raise the ticket — or do anything else — the moment it happens." },
      { kind: "p", text: "Q: A single poll failed — will the alert flap? — A: No. Auto-resolution needs two consecutive all-clear polls and a minimum alert age, so one transient fetch gap cannot open and close an alert." },
      { kind: "p", text: "Q: Can social chatter raise an outage? — A: No. Chatter can only ever raise an informational notice, never an outage — it is a signal, not proof. And a post has to name the service to count for it, so a post about something else cannot raise a notice or retire one." },
      { kind: "h", text: "Customer Portal" },
      { kind: "p", text: "Q: How does a customer sign in? — A: They enter their email address at /portal and we email a six-digit code. It works once and expires in ten minutes, so there is no customer password to manage." },
      { kind: "p", text: "Q: A customer says the portal does not recognise them. — A: Their company needs **Portal access** switched on under Clients, and their email address must be one of that company's contacts." },
      { kind: "p", text: "Q: Can a customer see anything they should not? — A: No. The restriction is applied on the server from the signed-in contact's company, after anything the request asked for. A ticket that is not theirs answers 404 rather than 403, because whether it exists is itself information." },
      { kind: "p", text: "Q: Does a customer see internal notes? — A: No. Internal notes are never sent to the portal." },
      { kind: "h", text: "Kumo & security" },
      { kind: "p", text: "Q: Are passwords encrypted? — A: Yes — Kumo stores passwords AES-256 encrypted, with TOTP and access logs." },
      { kind: "p", text: "Q: Who changed a shared document? — A: Each Kumo item shows an audit trail with the action, the user who made the change, and the last modified date." },
      { kind: "p", text: "Q: Does the product disable a departed user's Microsoft 365 account? — A: No, deliberately. The inactivity report finds dormant accounts and an offboarding raises an ordered checklist with an owner and a record; a human still does the disabling, in the tenant, where the consequence of a mistake is visible." },
    ],
    related: [
      { label: "Getting Started", to: "/help/getting-started" },
      { label: "Configuration", to: "/help/configuration" },
      { label: "Help Index", to: "/help/index" },
      { label: "C7NC", to: "/c7nc/services" },
      { label: "Finance Dashboard", to: "/billing/dashboard" },
      { label: "Kumo", to: "/kumo" },
    ],
  },
  {
    id: "configuration", group: "core",
    path: "/help/configuration",
    title: "Configuration",
    description: "Reference for the settings, dialogs, and options available in C7NTAX.",
    blocks: [
      { kind: "h", text: "Service Boards" },
      { kind: "figure", src: "/help/service-boards.png", alt: "The Service Boards page with one board open for editing and the close-notification switch visible", caption: "**Service Boards.** Each board's settings in one place — ticket code, SLAs, auto-close, follow-up — including **Email the client when a ticket on this board is closed**, which is what the close dialog defaults to. **NOC Alerts** carries *closes without emailing the client* on its summary line, because its tickets arrive from monitoring systems at no-reply addresses." },
      { kind: "p", text: "**Administration → Service Boards** is where a board is set up — the code its ticket numbers carry, the SLA response and resolution minutes, auto-close, the follow-up interval, and whether closing one of its tickets emails the client — and where the email connectors that file mail onto a board are reached. The **Service Boards** page itself (`/boards`) is the other half: what each board is holding, and what it promises. **Arrange these tiles** there reorders and pins the six figures on one board, and that arrangement is saved against the board. See the walkthrough **Service Boards (what each holds, and what it promises)**." },
      { kind: "table", headers: ["Setting", "What it decides"], rows: [
        ["Name / description", "What the board is called and what it is for; the name is what the close dialog reads back when it explains a default."],
        ["Ticket code", "The first part of every number raised on the board (`MSP-04-1005`), and the prefix the board's ticket list filters by."],
        ["SLA response / resolution (min)", "The clocks the board's tickets are measured against."],
        ["Auto-close / days", "Whether tickets nobody touches settle themselves, and after how long."],
        ["Follow-up / interval", "Whether the board chases a ticket that is waiting on somebody, and how often."],
        ["Email the client when a ticket is closed", "**On for a board that has not been told otherwise**, and the boards set the other way say so on the **Service Boards** page. Turn it off for a board whose tickets arrive from monitoring systems — a NOC feed, an alerting mailbox — because their addresses are no-reply and the closing email reaches nobody. It is the default the close dialog offers for that board's tickets, not a rule: an operator can still send one, and a board created without saying keeps the previous behaviour."],
      ] },
      { kind: "h", text: "Service Alerts & uptime" },
      { kind: "p", text: "Service Alerts monitors vendor status feeds (RSS + DownDetector), 24/7 staffed NOC feeds, and — when the social source is enabled — public chatter. Uptime Monitors adds website, SSL-expiry, and DNS checks — each with expected status codes and SSL warning thresholds." },
      { kind: "table", headers: ["Monitor kind", "Checks", "Config"], rows: [
        ["website", "HTTP status against expectStatus", "expectStatus (default 200)"],
        ["ssl", "Certificate expiry in days", "sslWarnDays (default 30)"],
        ["dns", "A-record resolution", "target hostname in monitorUrl"],
      ] },
      { kind: "h", text: "C7NC connectors" },
      { kind: "p", text: "C7NC hosts the connector types the product ships (Microsoft 365, ConnectWise PSA, AutoTask PSA, HaloPSA, Kantata, Scoro, FlexPoint Payment Solutions, QuickBooks Online, Pax8, Harmony Email, Proofpoint, SentinelOne, IT Glue, Azure, AWS, Azure AD SSO). The page opens on what is connected and whether it is healthy; the catalogue lives under **Add a connector** and the per-connection work under **Configuration**. Each connector has a Test connection action; status chips update live and credentials can be fixed and re-tested inline. With live status on, the server verifies connections on a throttle and reports what it last observed, so a chip means \"last checked\" rather than \"last saved\". Connector data carries a source note naming the system it came from." },
      { kind: "h", text: "Deploying the Microsoft 365 OAuth app" },
      { kind: "p", text: "The Microsoft 365 email connector reads a mailbox with an **app-only** registration carrying the application permission **Mail.ReadWrite** with admin consent, scoped to one mailbox by Exchange Online RBAC for Applications. **Deploy OAuth app** in the connector walks through all of it — sign in as a tenant administrator with a device code, create or reuse the registration, grant consent, mint the secret, print the Exchange Online commands — and then fills the connector's fields with the result. The other path takes the output of `O365/New-C7NTAXMailboxApp.ps1` for a registration that already exists, or a tenant this instance cannot reach Microsoft from." },
      { kind: "table", headers: ["Setting", "What it decides"], rows: [
        ["Registration name", "The key an existing registration is matched on. `C7NTAX Email Connector` is reused rather than duplicated — it is consented again and given a further secret."],
        ["Which identity", "App-only (a shared mailbox, needs the Exchange scoping), delegated (the mailbox of whoever signs in, no scoping, no secret), or both on one registration."],
        ["Mailbox to watch", "The address this connector reads, and the board it files into. One registration can watch **several**: add the first here, then add the rest by reusing the app, and scope each in Exchange — the app's panel lists the addresses and prints the commands for all of them."],
        ["Client secret", "Created for 12 months on an app-only deployment, with the expiry shown at the end so it can be diarised; never created for delegated, which uses PKCE."],
        ["Redirect URI", "Registered automatically on a delegated deployment, from this instance's own callback — it must match exactly or sign-in fails with AADSTS500113."],
      ] },
      { kind: "h", text: "API Access" },
      { kind: "p", text: "**Administration → API Access** issues the API keys other systems use to call this instance, and sets the board the event gateway files alerts on. A key is a bearer credential with an explicit list of scopes, acting as the account it belongs to — the API intersects those scopes with the account's current permissions on every request, so a key never has more power than its owner and loses power the moment the owner does. The secret is shown once; afterwards the key can be rotated (new secret, old one dead) or revoked (stopped immediately, record kept). Both are written to the audit log." },
      { kind: "table", headers: ["Setting", "What it decides"], rows: [
        ["Event intake board", "Where an alert sent to `POST /api/events` opens its ticket when the sender names no board. Unset, the oldest board in the instance is used."],
        ["Key scopes", "Which of this instance's permissions the key may use. Presets cover an RMM, a SIEM and an accounting integration."],
        ["Key expiry", "Optional. An expired key behaves exactly like a revoked one — 401, and nothing else changes."],
      ] },
      { kind: "h", text: "Identity & sessions" },
      { kind: "p", text: "Sign-in is a cookie session by default. The idle timeout is set under **Administration → Configuration → Sessions & Security** (5–480 minutes; the deployment's own default is 30), and no session lives longer than the configured ceiling whatever the setting — 12 hours by default. **Administrators, and the exempt test account where one is configured, never idle out** unless an administrator turns that off. A warning with a countdown appears one minute before a timeout, with **Stay signed in** to extend." },
      { kind: "p", text: "MFA adds a TOTP authenticator (with emailed-code fallback and one-time backup codes). SSO over OIDC — Entra ID, Keycloak, Okta, Auth0 — is configured on **Administration → Single Sign-On** and switched on under Sessions & Security. Passkeys give passwordless sign-in and are listed, renameable and removable under Settings → Passkeys; a password always remains a way in." },
      { kind: "h", text: "Product Catalog" },
      { kind: "p", text: "One entry per thing you sell or reorder, so a ticket, a quote, a purchase order and an invoice all copy the same numbers. Cost price and margin are only returned to accounts holding the catalog's manage permission — a technician attaching an item needs the sell price, not what it cost you." },
      { kind: "h", text: "Customer Portal" },
      { kind: "p", text: "Configured under **Administration → Customer Portal**. Off, every portal route answers 404, so a deployment that has not enabled it does not advertise a customer sign-in page. On, a client's contacts can use it only after **Portal access** is turned on for that client — and the whole instance's policy (which tickets they see, whether they may raise and reply, how long a sign-in code lives, how long a session lasts, and how the portal looks) is on that one screen." },
      { kind: "h", text: "Command console" },
      { kind: "p", text: "The console is the command surface for this instance: the **Console** button in the header (left of Search), the `/console` page behind it, and the `c7ntax` command-line client. All three run the same catalogue, so a command behaves identically wherever it is typed. Writes are not built yet — today every command reads — and the manifest that defines them is PLAN-026's." },
      { kind: "p", text: "Whether a person sees it is decided by **three switches, and all three have to be open**: they must hold `console:use`; their client must not have the console turned off; and the workspace switch below must be on. Nothing is offered and then refused — a person without the permission is not shown a greyed-out button, because a control somebody may not use is not a control to show them." },
      { kind: "table", headers: ["Where", "What it decides"], rows: [
        ["Administration → Configuration → Workspace → Command console", "Whether this deployment offers the console at all. Off, the header icon is hidden, the catalogue answers 404, and the `c7ntax` CLI cannot run a command."],
        ["Administration → Users & Roles → Permissions → Console", "Whether one person may use it. Uncheck it to withdraw `console:use` from that person, or from a whole role; a role's default is changed on the role, one person's on their own record."],
        ["Administration → Clients → open a client → Console", "Whether anyone belonging to one client may use it. Tick **Disable the console for every member of this client** and the permission is withheld from that client's people only — staff outside it are unaffected. It needs `system:config` to change."],
        ["`VITE_UI_CONSOLE`", "The per-browser kill switch: someone whose account is fine can build or load an interface without the console at all."],
      ] },
      { kind: "note", text: "The client's switch is applied where permissions are computed, not checked again in the interface, so a client with the console off is indistinguishable — to every screen and every route — from a person who was never granted it. It also means the two switches and the permission all take effect on the **next request**: withdraw it and the next click is already refused, with no sign-out needed." },
      { kind: "h", text: "Navigation pane" },
      { kind: "p", text: "The left pane has two shapes, generated from the same navigation tree, so every page, route and permission behaves identically in both. **Rail and sections** is the default: a rail of domains that does not grow as the feature list does, whose destinations fly out over the page when a domain is opened and are ordered by what the person opens. It is 200px wide against the classic tree's 256px, because the list of destinations floats above the content rather than taking width from it. **Single tree** is the pane the application had before — every section and every nested row in one list." },
      { kind: "table", headers: ["Where", "What it decides"], rows: [
        ["Administration → Configuration → Workspace → **Navigation pane**", "Which pane this deployment offers. It applies to everyone and takes effect immediately, without a sign-out and without moving any data. An individual can override it for themselves from **My Account → Appearance → Navigation**, in either direction, without changing what anyone else sees."],
        ["Administration → Configuration → Workspace → **Assistant in the navigation rail**", "Whether the Assistant is a rail row or a utility at the foot of the rail. Only the rail-and-sections pane has a rail, so this has no effect while the pane is set to the single tree — the Assistant is always in the sidebar there."],
        ["The `c7_ui_nav` browser flag", "Overrides the setting for one browser **in either direction**, which is what makes it safe to try the rail on an instance that has not adopted it, or to keep the classic tree on one that has."],
        ["`VITE_UI_NAV`", "A build that should not offer the rail at all. It beats the setting."],
      ] },
      { kind: "note", text: "Switching the pane changes nothing about a page. The rail's ordering, its folding of rows you have never opened, and its previews are all behaviour of the pane; the destinations, the permissions and the routes come from the navigation tree in both." },
      { kind: "h", text: "Interface" },
      { kind: "p", text: "Separately from the pane, the **screens** have two layouts, and the choice is made in the same menu. **Redesign** is the default: a record is arranged around tabs and a compact single-row header, and pages use the full width of the window. **Classic** is the layout the application had before. The two are independent — someone can have the rail with classic screens, or the tree with redesigned ones — and neither changes a route, a permission or a piece of data." },
      { kind: "table", headers: ["Where", "What it decides"], rows: [
        ["Administration → Configuration → Workspace → **Interface**", "Which screen layout this deployment offers. It applies to everyone and takes effect on the next screen, with no sign-out and no data migration. An individual can override it for themselves from **My Account → Appearance → Interface**, in either direction."],
        ["The `c7_ui_redesign` browser flag", "What that switch writes. `localStorage.setItem(\"c7_ui_redesign\", \"0\")` returns one browser to the classic screens, and `\"1\"` restores the redesign on an instance that has been set to classic."],
        ["`VITE_UI_REDESIGN`", "A build that should not offer the redesigned screens at all. It beats the setting, and because it is not a preference it is not offered in the menu."],
      ] },
      { kind: "note", text: "Colour scheme, light/dark and density are **not** part of this switch: they are held in the same two layouts and carry across the change unchanged." },
      { kind: "h", text: "Where settings live" },
      { kind: "p", text: "Every setting the application reads is declared in one place and shown under **Administration → Configuration**, grouped into eight areas. Each field states what it changes, what the deployment's own value is, and whether a restart is needed. A value is decided in this order: **a saved setting, then the deployment's environment variable, then the documented default** — so a deployment configured the old way keeps behaving exactly as it did." },
      { kind: "table", headers: ["Area", "What it governs"], rows: [
        ["Workspace", "The instance's name, the default landing page, and the interface options that apply to everyone"],
        ["Sessions & Security", "Idle timeout, the session ceiling, and which sign-in methods this deployment offers"],
        ["Customer Portal", "The customer-facing sign-in, what a customer may see and do, and how it looks — and, on the Client access tab, what each customer is given individually"],
        ["Service Alerts & Monitoring", "Uptime monitors, outbound alert webhooks, the social source and the poll interval"],
        ["Knowledge Base & AI", "Drafting articles from resolved tickets, the drafting model, and AI action proposals"],
        ["C7NC & Email", "Connector verification, the mail connectors, Graph delivery and M365 offboarding"],
        ["Billing & Invoicing", "Bill-through batches, the time rules and their defaults, quotes, bill-from-tickets"],
        ["Client Apps & Notifications", "The **Outlook add-in** — one switch serving its taskpane and accepting a filed message — and push notification devices"],
      ] },
      { kind: "note", text: "Some values belong to the deployment and are shown rather than editable — an outbound credential, a connection string, or a switch that decides whether authentication is enforced. They are reported with the environment variable that owns them, under **Set by the deployment**." },
      { kind: "h", text: "Deployment facts" },
      { kind: "p", text: "**Administration → System Settings** reports the operational state of the instance — the self-healing poller, its recovery history, the outbound mail relay, the database it is running on, and where the Outlook add-in is served from — and then points at the configuration areas. It has nothing to save; everything that changes behaviour lives under Configuration." },
      { kind: "h", text: "Feature flags" },
      { kind: "p", text: "Most features are switches under Configuration and take effect immediately. The rest are read once at process start, and their fields say **Needs a restart**. Two conventions still matter in the environment: some flags **ship on and are turned off with false**, and a few **ship off and are turned on with true**. A saved setting always wins over the variable." },
      { kind: "table", headers: ["Flag", "Enables", "Ships"], rows: [
        ["AUTH_HARDENING_ENABLED", "15-minute tokens, lockout after 5 failed sign-ins, forced password change, hash upgrade on next sign-in", "off — deployment only"],
        ["SESSION_AUTH_ENABLED", "The cookie session (false falls back to token-only auth)", "ON — deployment only"],
        ["PASSKEY_ENABLED", "WebAuthn passkeys (needs WEBAUTHN_RP_ID set to the app host)", "off"],
        ["SSO_ENABLED", "OIDC single sign-on — the provider is configured at Administration → Single Sign-On (or SSO_ISSUER, SSO_CLIENT_ID, SSO_CLIENT_SECRET)", "off"],
        ["EMAIL_CONNECTORS_ENABLED", "Inbound mailbox polling at all", "ON"],
        ["EMAIL_CONNECTORS_CLOUD_ENABLED", "Cloud (Graph) mail transports", "ON"],
        ["EMAIL_GRAPH_ENABLED", "The M365 Graph transport itself", "ON"],
        ["QUOTES_ENABLED", "Quotes and convert-to-invoice", "ON"],
        ["BILLING_FROM_TICKETS_ENABLED", "Generate an invoice draft from unbilled ticket time", "ON"],
        ["INVOICE_BATCH_ENABLED", "Bill-through batch invoicing (preview, hold, approve)", "off"],
        ["TIME_RULES_ENABLED", "The agreement time engine: overtime weighting and the midnight split", "off"],
        ["UPTIME_MONITORS_ENABLED", "Website, SSL and DNS checks", "ON"],
        ["ALERT_WEBHOOKS_ENABLED", "Signed alert deliveries to registered endpoints, and their delivery log", "ON"],
        ["SERVICE_ALERTS_SOCIAL_ENABLED", "Social reports (needs X_BEARER_TOKEN; can only ever raise a notice)", "ON"],
        ["CLOUDCONNECT_LIVE_STATUS_ENABLED", "Server-side verification of connectors on a throttle", "ON"],
        ["KB_AUTOGEN_ENABLED", "Drafting a knowledge base article from a resolved ticket", "ON"],
        ["M365_OFFBOARD_ENABLED", "Raising an offboarding checklist for an inactive M365 account", "ON"],
        ["OUTLOOK_ADDIN_ENABLED", "The Outlook add-in: the taskpane the mailbox loads **and** the endpoint it calls (switch it under Client Apps & Notifications)", "ON"],
        ["AI_ACTIONS_ENABLED", "Risk-classified AI action proposals", "ON"],
        ["PUSH_ENABLED", "Push device registration", "ON"],
        ["PORTAL_ENABLED", "The customer portal (off unless set to true, or switched on under Customer Portal)", "off"],
        ["CONSOLE_ENABLED", "The command console: the header button, `/console`, the catalogue endpoints and the `c7ntax` CLI (also accepted per person as `console:use`, and per client on the client's record)", "ON"],
      ] },
      { kind: "p", text: "**Testing only.** `AUTH_TEST_BYPASS` exempts a single named account from the login interruptions so a locked-out administrator can still get in while something is being diagnosed. It refuses to run in production, and it must be left unset anywhere real." },
      { kind: "warn", text: "A switch with **Needs a restart** on its field is sampled once when the service that uses it starts — the alert poll interval and the stale ceiling are the two. Everything else applies to the next action that reads it." },
    ],
    related: [
      { label: "Getting Started", to: "/help/getting-started" },
      { label: "Identity, Sessions & Sign-in", to: "/help/walkthroughs/identity-security" },
      { label: "Help Index", to: "/help/index" },
      { label: "Service Alerts", to: "/service-alerts" },
      { label: "Product Catalog", to: "/admin/products" },
      { label: "C7NC", to: "/c7nc/services" },
      { label: "Console & the Command Line", to: "/help/walkthroughs/console-shell" },
      { label: "Settings", to: "/settings" },
    ],
  },
  {
    id: "index", group: "core",
    path: "/help/index",
    title: "Index",
    description: "Every help topic, walkthrough, and product area — grouped by feature set.",
    blocks: [
      { kind: "h", text: "Getting started & workspace" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["First login, profile and the core workflow", "/help/getting-started"],
        ["Finding your way around the navigation", "/help/getting-started"],
        ["Your dashboard: reorder, resize, hide, reset", "/help/walkthroughs/shortcuts"],
        ["Command palette (⌘K) and keyboard shortcuts", "/help/walkthroughs/shortcuts"],
        ["Ticket list columns — visibility, order, widths, Date Created/Last Updated", "/help/walkthroughs/shortcuts"],
        ["Batch ticket operations", "/help/walkthroughs/shortcuts"],
        ["Recent activity: the last five, and the My Activity page", "/help/walkthroughs/my-activity"],
        ["The navigation pane: the rail, the column, and going back to the tree", "/help/walkthroughs/navigation"],
        ["The redesigned screens: the tab groups on a record, and going back to classic", "/help/walkthroughs/interface"],
        ["Service Boards, SLA policies and layout", "/help/configuration"],
      ] },
      { kind: "h", text: "Ticketing & email" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["Email-to-Ticket Setup (IMAP / M365 Graph)", "/help/walkthroughs/email-tickets"],
        ["Deploying the Microsoft 365 OAuth app (the wizard)", "/help/walkthroughs/email-tickets"],
        ["Outlook Add-in: install, sideload and centralized deployment", "/help/walkthroughs/outlook-addin"],
        ["Outlook Add-in: the ticket flow, saved preferences and installer rollback", "/help/walkthroughs/outlook-addin"],
        ["C7NC: the companion clients, and where to install them", "/c7nc/outlook-addin"],
        ["Customer notifications on notes, time and status", "/help/faq"],
        ["Closing a ticket: telling the client, and the reply that reopens it", "/help/walkthroughs/shortcuts"],
        ["Procurement: raising a purchase order, moving it along, fixing the lines", "/help/walkthroughs/procurement"],
        ["Ticket numbers: what the three parts mean, and renumbering old ones", "/help/walkthroughs/shortcuts"],
        ["Service Boards: what each board is holding, and what it promises", "/help/walkthroughs/service-boards"],
        ["Which boards email the client when a ticket closes", "/help/walkthroughs/service-boards"],
      ] },
      { kind: "h", text: "Clients & contacts" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["Contacts: the views, the clients and the person sheet", "/help/walkthroughs/contacts"],
        ["What a person has raised, and the tickets the sheet links to", "/help/walkthroughs/contacts"],
        ["Allowing or refusing the portal for one person", "/help/walkthroughs/contacts"],
      ] },
      { kind: "h", text: "Billing, expenses & catalog" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["Product Catalog (hardware, software, licences, services)", "/help/walkthroughs/product-catalog"],
        ["Quotes & convert to invoice, priced from the catalog", "/help/walkthroughs/quotes-invoices"],
        ["Agreement types and the time engine (overtime, midnight split)", "/help/walkthroughs/billing-agreements"],
        ["Generate a draft invoice from ticket time", "/help/walkthroughs/billing-agreements"],
        ["Bill-through batch invoicing (preview, hold, approve)", "/help/walkthroughs/billing-agreements"],
        ["Expenses: filing, approval, and the accounting push", "/help/walkthroughs/expenses"],
      ] },
      { kind: "h", text: "Reporting & reviews" },      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["The five reporting areas, and every standard report", "/help/walkthroughs/reporting"],
        ["Business Reviews: weekly, monthly and quarterly", "/help/walkthroughs/reporting"],
        ["Designing a report: bands, expressions, totals", "/help/walkthroughs/custom-reports"],
        ["Charts, sub-reports and running totals", "/help/walkthroughs/custom-reports"],
        ["Print, PDF, Excel, CSV and scheduling", "/help/walkthroughs/custom-reports"],
      ] },
      { kind: "h", text: "Monitoring & alerts" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["Service Alerts, the nav indicator and the Outage Board", "/help/walkthroughs/service-alerts"],
        ["Uptime Monitors (website / SSL / DNS)", "/help/walkthroughs/uptime-monitors"],
        ["Alert Webhooks", "/help/walkthroughs/alert-webhooks"],
      ] },
      { kind: "h", text: "Integrations & automation" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["C7NC connectors, live verification and QuickBooks", "/help/walkthroughs/cloudconnect"],
        ["FlexPoint billing, client matching and pushed invoices", "/help/walkthroughs/flexpoint"],
        ["API keys: issuing, scopes, rotating and revoking", "/help/walkthroughs/api-access"],
        ["The event gateway: RMM, SIEM and monitoring alerts", "/help/walkthroughs/api-access"],
        ["Event intake board", "/help/walkthroughs/api-access"],
        ["M365 inactivity report and offboarding checklists", "/help/walkthroughs/m365-offboarding"],
        ["Email connectors", "/help/walkthroughs/email-tickets"],
      ] },
      { kind: "h", text: "AI" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["The Assistant: prompting the model, and what it may look up", "/help/walkthroughs/assistant"],
        ["Connecting a model (Claude, GPT, Gemini, DeepSeek, Grok, local)", "/help/walkthroughs/cloudconnect"],
        ["AI Actions (risk-classified)", "/help/walkthroughs/ai-actions"],
        ["Drafting a knowledge base article from a ticket", "/help/walkthroughs/knowledge-base"],
      ] },
      { kind: "h", text: "Identity & security" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["Sessions and the inactivity timeout", "/help/walkthroughs/identity-security"],
        ["MFA and passkeys", "/help/walkthroughs/identity-security"],
        ["Sign-in audit: successes, failures, lockouts and who tried", "/help/walkthroughs/sign-in-audit"],
        ["Active sessions, revoking one, and signing an account out everywhere", "/help/walkthroughs/sign-in-audit"],
        ["Registered devices (passkeys and notifications) and removing one", "/help/walkthroughs/sign-in-audit"],
        ["Single Sign-On: registering the provider, and who may sign in", "/help/walkthroughs/sso-oidc"],
        ["Hardening, lockout and the test-exemption account", "/help/walkthroughs/identity-security"],
        ["Every feature flag, and what it gates", "/help/configuration"],
      ] },
      { kind: "h", text: "Configuration" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["The eight configuration areas, and how a value is decided", "/help/walkthroughs/configuration"],
        ["Changing a setting, and putting one back", "/help/walkthroughs/configuration"],
        ["What belongs to the deployment rather than the screen", "/help/walkthroughs/configuration"],
        ["The instance's operational state and deployment facts", "/help/walkthroughs/configuration"],
      ] },
      { kind: "h", text: "Console & command line" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["The console: the header button, the pop-up and the /console page", "/help/walkthroughs/console-shell"],
        ["Resizing the pop-up, and where its size is remembered", "/help/walkthroughs/console-shell"],
        ["Reading a table, a record and the fields that are folded away", "/help/walkthroughs/console-shell"],
        ["Basic and Advanced output, and switching between them", "/help/walkthroughs/console-shell"],
        ["Autocomplete, history and Ctrl+R search", "/help/walkthroughs/console-shell"],
        ["Who may use the console, and switching it off per person or per client", "/help/walkthroughs/console-shell"],
        ["The command catalogue, grouped by area", "/help/walkthroughs/console-shell"],
        ["The `c7ntax` command-line client and its profiles", "/help/walkthroughs/console-shell"],
        ["The console permission and the workspace switch", "/help/configuration"],
      ] },
      { kind: "h", text: "Customer Portal" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["Turning the portal on and granting a client access", "/help/walkthroughs/customer-portal"],
        ["How a customer signs in, and what they can see", "/help/walkthroughs/customer-portal"],
        ["Portal policy: visibility, permissions, sign-in limits and branding", "/help/walkthroughs/customer-portal"],
      ] },
      { kind: "h", text: "Kumo & knowledge" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["Kumo: passwords, configurations, documents, checklists and audit", "/help/walkthroughs/kumo"],
        ["Knowledge Base articles, categories and AI drafts", "/help/walkthroughs/knowledge-base"],
        ["Knowledge Base", "/kb"],
      ] },
      { kind: "note", text: "MAINTENANCE RULE: whenever a feature is added, updated, changed, or removed, update its walkthrough here and in the Index rows in the same change. Every walkthrough in this file is also linked from the Help home page, so a new one is reachable without editing the menu." },
    ],
    related: [
      { label: "Getting Started", to: "/help/getting-started" },
      { label: "FAQ", to: "/help/faq" },
      { label: "Configuration", to: "/help/configuration" },
      { label: "What's New", to: "/admin/changelog" },
    ],
  },

  // ════════════════════════════ WALKTHROUGHS ════════════════════════════
  {
    id: "email-tickets", group: "walkthroughs",
    path: "/help/walkthroughs/email-tickets",
    title: "Email-to-Ticket Setup (IMAP / M365 Graph)",
    description: "Configure monitored mailboxes so inbound email becomes tickets automatically.",
    blocks: [
      { kind: "h", text: "IMAP connector" },
      { kind: "steps", items: [
        "Open Administration → Service Boards → Email connectors.",
        "Select Add connector and pick the target service board.",
        "Enter the mailbox host, port (993), username, and password; folder defaults to INBOX.",
        "Set the poll interval (seconds) and save. Inbound mail is polled and deduplicated by Message-ID.",
      ] },
      { kind: "h", text: "Microsoft 365 mailboxes (Graph, app-only)" },
      { kind: "p", text: "Microsoft has disabled Basic authentication for Exchange Online in **every** tenant, so a Microsoft 365 mailbox can only be read with an OAuth app. The app needs the **application** permission **Mail.ReadWrite** — not **Mail.Read**: the connector marks a message read once it has become a ticket, and a read-only app connects, reads, and then fails on the first message it tries to mark." },
      { kind: "steps", items: [
        "Check **Microsoft Graph delivery** is on under Administration → Configuration → C7NC & Email.",
        "Open **C7NC → Email**, choose **Microsoft 365 / Exchange Online**, then **App-only (client secret)**.",
        "Press **Deploy OAuth app** and work through the wizard: sign in as a tenant administrator with the code it shows (Application Administrator or Global Administrator is required), and it creates or reuses the registration, grants admin consent and mints the secret.",
        "Run the **Exchange Online** commands the wizard prints. Graph has no route to them, and until they are run an app-only registration can read **every** mailbox in the tenant.",
        "Back in the connector, the tenant id, client id, secret and mailbox are already filled in — press **Add Email Connector**, then **Test connection**, then switch it on.",
      ] },
      { kind: "note", text: "Prefer a terminal, or already have the app? The wizard's second path takes the output of `O365/New-C7NTAXMailboxApp.ps1` (or the four values typed by hand) and fills the same fields. Either way the mailbox is polled for unread mail and messages are marked read once they have become tickets." },
      { kind: "h", text: "Watching several addresses on one app" },
      { kind: "p", text: "One registration usually watches **several addresses** — `alerts@` filing to the NOC board, `servicedesk@` to the service desk — and each watched address is one row in this list. The row is the mapping: the address, an arrow, the board it files into. Exchange scopes an application **per mailbox** rather than per app, so a second address needs its own scope even though it uses the app that already exists." },
      { kind: "figure", src: "/help/email-connectors.png", alt: "The Email tab under C7NC, listing four watched mailboxes each with an arrow to the service board it files into", caption: "**C7NC → Email.** Each row is one watched address and the board it files into — `support@example.com → Infrastructure Desk`, `alerts@cyber7group.com → NOC Alerts`. The buttons on the right are the row's own: stop or start watching, test the connection, poll now, delete." },
      { kind: "steps", items: [
        "Choose **Microsoft 365 / Exchange Online** and **App-only (client secret)**, then pick the app under **Which Microsoft 365 app**: **Reuse …** copies the tenant, application id and client secret from the app already configured, so a second address needs one click rather than the secret typed again — which matters, because Entra will not show it twice.",
        "Fill in the two things that are new: **the mailbox to watch** and the **service board** it files into. Press **Add Email Connector**.",
        "Open **Exchange scoping** on the app and run the commands it prints — one management scope and one role assignment **per address**, so the app can read the mailboxes listed and no others.",
        "Press **Test connection** on the new row, then switch it on.",
      ] },
      { kind: "figure", src: "/help/email-apps.png", alt: "The Microsoft 365 apps panel showing one app, two mailboxes and the Exchange Online scoping commands", caption: "**One app, several addresses.** The panel lists every address on the app and the board each files into, and **Exchange scoping** prints the commands that cover all of them at once — numbered per address, because that is how Exchange scopes an application. The app's addresses are also why the picker can offer *Reuse* for the next one." },
      { kind: "note", text: "**Which app does a mailbox belong to?** Two rows belong to the same app when the tenant and the client id match, which is what the grouping above uses. Nothing else is shared: each address has its own folder, poll interval, board and ingestion rules, so `alerts@` can be polled every minute into the NOC board while `servicedesk@` is polled every five into the service desk." },
      { kind: "h", text: "Connect to Microsoft (delegated)" },
      { kind: "p", text: "The delegated flow reads the mailbox of whoever signs in, so no shared-mailbox scoping is needed and no client secret is created (it is a public client using PKCE). Register the app with the **delegated** permissions Mail.ReadWrite and User.Read plus offline_access, save the tenant and client id, then press the link button on the connector to sign in." },
      { kind: "note", text: "Both transports share the same dedup store, so switching a mailbox from IMAP to Graph will not re-create old tickets." },
      { kind: "h", text: "Usage" },
      { kind: "p", text: "New mail creates a ticket with priority deduced from content; replies update the original ticket by matching the conversation. Auto-replies are ignored." },
    ],
    related: [
      { label: "Outlook Add-in", to: "/help/walkthroughs/outlook-addin" },
      { label: "C7NC Integrations", to: "/help/walkthroughs/cloudconnect" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "sign-in-audit", group: "walkthroughs",
    path: "/help/walkthroughs/sign-in-audit",
    title: "Sign-in Audit, Sessions & Devices",
    description: "Who signed in, who was refused, what is signed in right now, and the devices on each account.",
    blocks: [
      { kind: "p", text: "**Administration → Sign-in Audit** answers three questions in the order they are asked when something looks wrong: *did anybody try to get in*, *who is signed in now*, and *on what*. It is the local shape of the sign-in log Entra shows you for a Microsoft tenant — the same columns, for the accounts this application signs in itself." },
      { kind: "figure", src: "/help/sign-in-audit.png", alt: "The sign-in audit: four summary tiles above a filterable table of sign-in attempts", caption: "**The sign-in log.** The tiles count the **filtered** window, not the page — so choosing *Locked out* shows how many of them there were in that window rather than in the twenty rows on screen. The search covers the address, the device, the IP and the reason." },
      { kind: "table", headers: ["Outcome", "What it means"], rows: [
        ["**Signed in**", "It worked. The method column says how: a password, an authenticator app, an emailed code, a passkey, or single sign-on."],
        ["**Failed**", "The password was wrong, the code was wrong, or the address is not an account here. The reason names which, and the attempt count is beside it."],
        ["**Locked out**", "The account is locked after too many failures (five, when hardening is on), or a sign-in was refused because it already was. An administrator unlocks it on the user's record."],
        ["**MFA failed**", "The first factor was right and the second was not — the row that says a password alone did not get in."],
        ["**Signed out**", "The session ended deliberately. Worth having beside the failures: a burst of wrong passwords an hour after a sign-out is a person mistyping, and the same burst without one is worth a second look."],
      ] },
      { kind: "note", text: "**Every way in writes a row, successes included** — the password form, both MFA steps, passkeys, single sign-on, the portal's emailed code, and signing out. A failure is never a silent 401: the device, the address and the reason are recorded whether or not the person got in, which is the whole point of an audit." },
      { kind: "h", text: "Active sessions, and ending one" },
      { kind: "steps", items: [
        "Open the **Active sessions** tab. Each row is one signed-in browser: the person, the device, how they signed in, the address they arrived from, when it started and when it was last seen.",
        "**Revoke** ends that one session. It stops working immediately — the cookie it was using no longer resolves, so the next click in that browser asks for a password again.",
        "**Sign out everywhere** ends every session that person has, which is what a stolen laptop or a leaked password needs.",
        "Switch between **Signed in**, **Ended** and **All** to see what has finished as well as what has not. A revoked row keeps its record: the row is stamped, not deleted.",
      ] },
      { kind: "figure", src: "/help/security-sessions.png", alt: "The active sessions tab, listing sessions with person, device, sign-in method, IP address and last activity", caption: "**Who is signed in.** The *Signed in with* column comes from the audit log rather than the session, so it can say *Passkey* rather than only *signed in* — the fact that matters when a session is unexplained." },
      { kind: "h", text: "Registered devices" },
      { kind: "p", text: "The **Devices** tab lists what each account has registered: **passkeys**, which sign in, and **browser notification subscriptions**, which receive. Both are added by the person they belong to — a passkey can only be created on the device it lives on, in **My Settings → Security** — so the administrator's half is the other one: seeing a device nobody recognises, and removing it." },
      { kind: "figure", src: "/help/security-devices.png", alt: "The devices tab, listing a registered passkey and browser notification subscription with the account they belong to", caption: "**Devices.** Removing a passkey here is the recovery path for a lost phone as well as the response to a device that should not be there; removing a notification subscription stops the alerts going to that browser." },
      { kind: "note", text: "**These screens need `security:manage`** — the same permission as the Sessions & Security settings and single sign-on — because an address, a device and a failed attempt are facts about people. The failure reasons are also written to the server log, which is where they are read when the database is the thing that is broken." },
    ],
    related: [
      { label: "Identity, Sessions & Sign-in", to: "/help/walkthroughs/identity-security" },
      { label: "Single Sign-On (OIDC)", to: "/help/walkthroughs/sso-oidc" },
      { label: "Sign-in Audit", to: "/admin/security" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "quotes-invoices", group: "walkthroughs",
    path: "/help/walkthroughs/quotes-invoices",
    title: "Quotes & Convert to Invoice",
    description: "Build a quote from the catalog and turn an accepted one into a draft invoice.",
    blocks: [
      { kind: "h", text: "Create a quote" },
      { kind: "steps", items: [
        "Open Quotes from the navigation.",
        "Enter the title, select the client, and add one or more line items.",
        "Save — the quote is created in draft status with totals computed.",
      ] },
      { kind: "h", text: "Price it from the catalog" },
      { kind: "steps", items: [
        "In a line's description field, type to search the **Product Catalog** by name or SKU.",
        "Pick the item: its description and **sell price** are copied into the line, and the line keeps a link to the SKU.",
        "Adjust the quantity or the price on the line if this quote is a special — the catalog is not changed by quoting it.",
      ] },
      { kind: "tip", text: "Quoting from the catalog is what keeps a price quoted today and the price invoiced next month the same number, without anybody retyping it." },
      { kind: "h", text: "Convert to invoice" },
      { kind: "steps", items: [
        "Open the quote and select Convert to invoice.",
        "A draft invoice is created from the quote's line items with a new invoice number.",
        "Review the invoice under Billing → Invoices before sending.",
      ] },
      { kind: "note", text: "Quotes never email clients automatically — conversion only creates a draft invoice." },
    ],
    related: [
      { label: "Product Catalog", to: "/help/walkthroughs/product-catalog" },
      { label: "Billing, Agreements & Overtime", to: "/help/walkthroughs/billing-agreements" },
      { label: "Help Index", to: "/help/index" },
      { label: "Billing", to: "/billing" },
    ],
  },
  {
    id: "billing-agreements", group: "walkthroughs",
    path: "/help/walkthroughs/billing-agreements",
    title: "Billing, Agreements & Overtime",
    description: "Agreement types, the time engine, generating from tickets, and bill-through batch invoicing.",
    blocks: [
      { kind: "h", text: "Agreement types" },
      { kind: "table", headers: ["Type", "Behaviour"], rows: [
        ["Service", "Ordinary hourly or fixed work, billed as agreed on the contract"],
        ["Block hours", "Prepaid hours; work draws the allowance down rather than being invoiced per hour"],
        ["All-you-can-eat (Cyber Care)", "Flat coverage; no per-hour billing, but the allowance still records what was consumed"],
        ["Variable hourly (spot)", "Per-hour tiers — Standard $100, Advanced $250, Specialist $275, Emergency $400"],
      ] },
      { kind: "p", text: "Block and Cyber Care agreements **draw from an allowance**; Service and spot agreements are billed per hour. Every rate, cut-off and multiplier below is settable per agreement, so one client's evening rate does not become everybody's." },
      { kind: "h", text: "The time engine" },
      { kind: "p", text: "TIME_RULES_ENABLED turns on three rules that are decided in one place rather than by whoever types the timesheet. **With it off, a time entry is stored exactly as it is typed** — which is why it ships off and is a billing sign-off decision rather than a technical one." },
      { kind: "table", headers: ["Rule", "What it does"], rows: [
        ["Midnight split", "Work that crosses midnight becomes two entries, the second linked to the first — \"23:00–01:00 Tuesday\" hides two different days of labour, and every report wants them apart"],
        ["Overtime", "Minutes after the agreement's cut-off (18:00 by default) are overtime"],
        ["Weighting", "Overtime counts at the agreement's multiplier (1.5 by default) towards billing and, for block and Cyber Care, towards the allowance — the 1.5:1 rule: two hours of evening work consume three"],
      ] },
      { kind: "steps", items: [
        "Switch on **Time rules** under Administration → Configuration → Billing & Invoicing.",
        "Open the agreement and set its overtime cut-off, multiplier, and whether overtime applies at all.",
        "Log time as usual. Where a rule changed the entry, the invoice charges the **weighted** minutes rather than the typed ones.",
      ] },
      { kind: "note", text: "Where a figure was not computed, it is stored as null rather than zero — so \"not computed\" stays distinguishable from \"computed as nothing\"." },
      { kind: "h", text: "Generate from tickets" },
      { kind: "steps", items: [
        "Open the Finance Dashboard.",
        "Choose the client and select **Generate draft invoice**.",
        "Unbilled billable time entries become draft invoice line items and are linked to the invoice.",
      ] },
      { kind: "warn", text: "Generated invoices are drafts only — they are never emailed or synced until you send them." },
      { kind: "h", text: "Bill-through batch invoicing" },
      { kind: "p", text: "For billing a whole period at once, the batch is a deliberate three-step artefact: money earned — time and **approved** expenses — becomes invoices, but nothing reaches a client without a human looking at it first. Switched on under Administration → Configuration → Billing & Invoicing, as **Bill-through batch invoicing**." },
      { kind: "steps", items: [
        "**Preview** works out what would be billed per client — hours, expenses, every line, and the total — and writes nothing at all.",
        "**Create** turns the preview into Draft invoices, held by the batch.",
        "**Approve** issues them and pushes them to the accounting system. **Reject** throws the drafts away and leaves the time and expenses unbilled for the next run.",
      ] },
      { kind: "p", text: "Rates are taken in order: the time entry's own rate, then the agreement's hourly rate, then the agreement's recurring amount as a day rate." },
      { kind: "note", text: "**It cannot double-bill.** The preview only ever considers time entries and expenses that are not already on an invoice, and creating the batch marks them as billed. Rejecting clears the marks and deletes the drafts, so the next run picks the same work up again." },
    ],
    related: [
      { label: "Quotes & Convert to Invoice", to: "/help/walkthroughs/quotes-invoices" },
      { label: "Expenses & Accounting Sync", to: "/help/walkthroughs/expenses" },
      { label: "Help Index", to: "/help/index" },
      { label: "Finance Dashboard", to: "/billing/dashboard" },
      { label: "Agreements", to: "/billing/agreements" },
    ],
  },
  {
    id: "uptime-monitors", group: "walkthroughs",
    path: "/help/walkthroughs/uptime-monitors",
    title: "Uptime Monitors (Website / SSL / DNS)",
    description: "Configure website, SSL-expiry, and DNS checks with alerting.",
    blocks: [
      { kind: "h", text: "Add a monitor" },
      { kind: "figure", src: "/help/uptime-monitors.png", alt: "The uptime monitors page listing website, SSL and DNS checks with their state", caption: "**Uptime monitors.** Website, SSL-expiry and DNS checks side by side, each with its target, its interval and the state it is in. A monitor that fails raises an alert on the Service Alerts board rather than a ticket of its own, so the board stays the one place incidents live." },
      { kind: "steps", items: [
        "Switch on **Uptime monitors** under Administration → Configuration → Service Alerts & Monitoring.",
        "Open Service Alerts → Uptime Monitors.",
        "Enter a name, choose the kind (Website / SSL expiry / DNS), and enter the target URL.",
        "Website: set the expected status (default 200). SSL: set the warning threshold in days (default 30).",
        "Select Add monitor.",
      ] },
      { kind: "h", text: "Behavior" },
      { kind: "p", text: "Checks run on the 5-minute monitor tick. Failures open an active alert; alerts auto-resolve after two consecutive successful polls (anti-flap streak), mirroring the vendor feed rules." },
      { kind: "note", text: "Targets must be reachable from the internet. The checks go through the same egress policy as every other outbound request, so a private or link-local address is refused and the refusal is written on the alert — with the reason, rather than as a silent pass. The SSL and DNS checks read the host in the address, so a path on the end of the URL is ignored." },
      { kind: "note", text: "Manual alerts are never auto-resolved by monitor checks." },
    ],
    related: [
      { label: "Service Alerts", to: "/help/walkthroughs/service-alerts" },
      { label: "Alert Webhooks", to: "/help/walkthroughs/alert-webhooks" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "service-alerts", group: "walkthroughs",
    path: "/help/walkthroughs/service-alerts",
    title: "Service Alerts & the Outage Board",
    description: "Monitor vendor status feeds, work the outage board, and know what a status actually means.",
    blocks: [
      { kind: "h", text: "The nav indicator" },
      { kind: "p", text: "Service Alerts sits at the top of the navigation pane and turns **crimson with a count** whenever something is wrong, so an outage is visible from anywhere in the product without opening the page. An all-clear hides the indicator rather than showing a zero." },
      { kind: "h", text: "Add a monitored service" },
      { kind: "steps", items: [
        "Open Service Alerts → Settings (Administration → Service Alerts).",
        "Add a service with its category, status page URL, DownDetector URL, and/or RSS feed URL.",
        "Keep monitorEnabled on and set a sort order.",
        "The monitor polls on the interval shown on the page and classifies outage, degraded and restored keywords.",
      ] },
      { kind: "h", text: "The Outage Board" },
      { kind: "figure", src: "/help/service-alerts.png", alt: "The Service Alerts board: summary tiles, a source filter and the list of active alerts", caption: "**The outage board.** Four tiles (Outages, Degraded, Operational, Monitored services), the **Active / Resolved / Source** filters, then one row per alert with its **degraded** chip, how long ago it was detected and where it was read from. **Live** and **Outage Board** switch between working an incident and watching the feed." },
      { kind: "p", text: "The second tab is a **triage board**: one row per monitored service, the problems sorted to the top, each with its most recent observation and the time it was seen. It counts outages and degradations at the top, refreshes on the same poll as the rest of the page, and only while the tab is visible — so a board left open in a background tab is not quietly polling." },
      { kind: "steps", items: [
        "Scan the outage and degraded counts first; they are the only numbers that need a decision.",
        "Read a row's last observation to see what was actually fetched, not just that it failed.",
        "Use the service's own status page link when a feed and a vendor disagree.",
      ] },
      { kind: "h", text: "Recently Resolved" },
      { kind: "p", text: "The first thing on the page is what **just cleared**, because that is what somebody coming back to an outage wants to see. Each row shows the service and the incident, **when it was first reported** and when it resolved, and the incident title is a link to the vendor's advisory — the page that explains what the outage actually was. A hover names the destination before you click it." },
      { kind: "h", text: "Alert lifecycle" },
      { kind: "p", text: "A problem opens an active alert (severity outage, degraded, or a mere notice). Auto-resolution requires two consecutive all-clear polls **and** a minimum alert age, so a single transient fetch gap cannot flap an alert open and shut. Manual alerts are never auto-resolved by monitor checks." },
      { kind: "h", text: "Social reports" },
      { kind: "p", text: "When the social source is enabled and a token is configured, public chatter is read as a signal — and it can **only ever raise an informational notice**, never an outage. A post also has to name the service to count for it: chatter about something else can neither raise a notice nor retire one. Chatter is not proof, and the product refuses to treat it as such; turning the source off leaves everything else unchanged." },
    ],
    related: [
      { label: "Uptime Monitors", to: "/help/walkthroughs/uptime-monitors" },
      { label: "Alert Webhooks", to: "/help/walkthroughs/alert-webhooks" },
      { label: "Help Index", to: "/help/index" },
      { label: "Service Alerts", to: "/service-alerts" },
    ],
  },
  {
    id: "alert-webhooks", group: "walkthroughs",
    path: "/help/walkthroughs/alert-webhooks",
    title: "Alert Webhooks",
    description: "Send alert events to another system as signed HTTPS POSTs, and read the delivery log.",
    blocks: [
      { kind: "h", text: "Register an endpoint" },
      { kind: "steps", items: [
        "Switch on **Alert webhooks** under Administration → Configuration → Service Alerts & Monitoring.",
        "Open Alert Webhooks (Administration → Alert Webhooks).",
        "Enter a name — or leave it blank and the host name is used — and the endpoint URL.",
        "Choose the events it should receive: **Alert raised**, **Alert resolved**, or both. An endpoint subscribed to nothing is refused, because a registration that never fires reads as a broken integration.",
        "Set **Retries per event** (1–5, default 3) and select **Register endpoint**.",
        "Copy the **signing secret** that appears and store it with the endpoint — it is shown once and never again.",
      ] },
      { kind: "h", text: "What arrives" },
      { kind: "p", text: "One POST per event, JSON body. Three headers are the whole contract: **X-C7-Event** (the event name), **X-C7-Delivery** (this delivery's id, which matches a row in the log) and **X-C7-Signature: sha256=<hmac>** — an HMAC-SHA256 of the exact request body, computed with that endpoint's signing secret. Verify the signature before acting on the payload, and answer any 2xx to mark the delivery done." },
      { kind: "p", text: "The body carries **event**, **sentAt**, and a **data** object holding the service and the alert: title, severity, status, source, source URL and the timestamps. A resolved alert is the same shape with status resolved and a resolvedAt, so one handler can do both." },
      { kind: "h", text: "Retries and failures" },
      { kind: "p", text: "Delivery is fire-and-forget: a slow or unreachable endpoint never holds up the alert it is about. A failure is retried with a widening gap — 1s, 5s, 15s, then 30s — up to that endpoint's own retry limit, and then recorded as failed." },
      { kind: "h", text: "Delivery log" },
      { kind: "p", text: "Every delivery is recorded with its event, status (**pending** / **delivered** / **failed**), attempt count, time, and the exact body that was sent. **Send test** puts a webhook.test delivery in the log on demand — one attempt, reporting the endpoint's own answer — so a receiver can be proved without waiting for an incident." },
      { kind: "note", text: "**Park** stops deliveries and keeps the history. **Remove** deletes the endpoint and its delivery log together, because an endpoint that no longer exists cannot be fixed." },
      { kind: "note", text: "Endpoint URLs go through the same egress policy as every other outbound request, so a private or link-local address is refused both when it is saved and again before each delivery." },
      { kind: "tip", text: "Pair webhooks with ticket automation so outages open tickets automatically." },
    ],
    related: [
      { label: "Service Alerts", to: "/help/walkthroughs/service-alerts" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "assistant", group: "walkthroughs",
    path: "/help/walkthroughs/assistant",
    title: "The Assistant",
    description: "Ask the connected model a question, and see which of the application's own functions it used to answer it.",
    blocks: [
      { kind: "p", text: "The Assistant answers questions about what is in C7NTAX — a client's week, the tickets behind a complaint, which service is having an incident, what the knowledge base already says about a problem. The model does not know any of that by itself: it looks it up through this application's own functions, which is why the answer can be checked." },
      { kind: "h", text: "It runs as you" },
      { kind: "p", text: "Every function runs under your session and needs the same permission its screen does, so a question can never return something you could not have opened yourself. If the assistant is asked for something you may not see, the function is refused and the refusal is shown in the trace — the model is told, so it says so rather than guessing. The connection itself has a switch, **May perform app functions**: with it off, the model answers only from what you type." },
      { kind: "h", text: "Nothing is changed by asking" },
      { kind: "p", text: "Functions that would change data are **proposals**. Ask for a note to be added and the assistant raises a risk-classified proposal under **AI Actions** — nothing is written until a person approves it, and the note on the ticket has not changed in the meantime. Reads run immediately; writes wait for a decision, always." },
      { kind: "h", text: "The receipt under the answer" },
      { kind: "steps", items: [
        "Connect a model in C7NC → AI Models, and make it the model the application uses.",
        "Open Assistant and ask a question. ⌘/Ctrl + Enter sends it.",
        "Read the answer, then read **What it looked up**: each function it called, what it was asked, whether it was allowed, and how long it took.",
        "Open a function's row to see the exact arguments. A refused or failed call is shown because it tells you what the answer could not have known.",
        "Anything proposed is waiting under AI Actions. Nothing has been changed by asking.",
      ] },
      { kind: "note", text: "The question, the model, and the functions that ran are written to the audit trail — not what they returned, because copying client data into a log table would be a second copy of it under weaker rules. Prompts leave your network for whichever vendor the connection names, which is why the connection says so: it is the model vendor's terms, not this application's, that apply to what you type. A question is answered in at most a fixed number of rounds of looking things up, and the answer says so when it hits that ceiling." },
    ],
    related: [
      { label: "C7NC integrations", to: "/help/walkthroughs/cloudconnect" },
      { label: "AI Actions (risk-classified)", to: "/help/walkthroughs/ai-actions" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "ai-actions", group: "walkthroughs",
    path: "/help/walkthroughs/ai-actions",
    title: "AI Actions (Risk-Classified)",
    description: "Propose, review, and audit AI-suggested actions with risk-tier controls.",
    blocks: [
      { kind: "h", text: "Risk tiers" },
      { kind: "table", headers: ["Tier", "Behavior"], rows: [
        ["low / medium", "Execute on approval"],
        ["high", "Requires approval before execution"],
        ["critical", "Blocked automatically — cannot be approved"],
      ] },
      { kind: "h", text: "Approve or reject" },
      { kind: "steps", items: [
        "Switch on **AI action proposals** under Administration → Configuration → Knowledge Base & AI.",
        "Open AI Actions to see pending proposals with their risk tier and summary.",
        "Select Approve or Reject; high-risk actions stay in approved state until executed.",
        "Every decision and proposal is written to the audit trail.",
      ] },
    ],
    related: [
      { label: "Help Index", to: "/help/index" },
      { label: "Configuration", to: "/help/configuration" },
    ],
  },
  {
    id: "identity-security", group: "walkthroughs",
    path: "/help/walkthroughs/identity-security",
    title: "Identity, Sessions & Sign-in",
    description: "How sign-in works, the inactivity timeout, multi-factor authentication, SSO and passkeys.",
    blocks: [
      { kind: "h", text: "The sign-in page" },
      { kind: "p", text: "The sign-in page asks one question and then gets out of the way: the mark, why you are here, how you want to prove it, and the field. In the **redesigned** interface it is arranged around the credential rather than around the form." },
      { kind: "steps", items: [
        "**A passkey is offered first**, wherever the browser and the device have one; **Password** is one press away on the same account field, so switching between the two keeps what you typed. On a browser without WebAuthn the choice is not drawn at all — a dead option is worse than no option.",
        "**A failure is stated at the field it belongs to** rather than in a message that disappears: a wrong password, a locked account, a code that did not work. A password that does not match is said in words, and a locked account names the only remedy that exists — an administrator unlocks it.",
        "**The second factor is a step of the same page.** The six-digit field takes your authenticator code or one of your backup codes, and **Email me a code** has one sent to your address instead; it is six digits and it expires in 15 minutes.",
        "**A password an administrator set** is where the page says why. You signed in with a temporary password, so you choose your own to continue — the current one is not asked for twice, and the temporary one stops working straight away.",
        "**Adding a passkey is offered once**, immediately after you sign in with a password, because that is the only moment it can be registered: the registration endpoint needs the session you have just created. Decline it and it is not asked again in that browser.",
        "**One sentence says whether the instance can serve a sign-in**, above the footer. *All systems ready* means the API answered **and** the database answered — the second of those is a separate probe, because a process that is listening is not the same claim as a database that answers. When something is down the sentence says that signing in cannot complete and the act is switched off rather than left to fail, and one press shows the four services, the probe answers and what to do about it.",
      ] },
      { kind: "note", text: "**The classic interface keeps the page it had** — the same fields, the same separate second-factor screen and the same four service tiles — and **My Account → Appearance → Interface** switches between the two. Nothing about signing in changes with it: the same routes, the same lockout and the same session behind either arrangement." },
      { kind: "h", text: "Sessions & the inactivity timeout" },
      { kind: "p", text: "Signing in creates a **session**, held in an httpOnly cookie and paired with a CSRF token. Every request the browser makes slides the session forward, so ordinary work never interrupts you." },
      { kind: "steps", items: [
        "Idle for 30 minutes (the default) and the session ends; you are returned to the sign-in page, which says the session timed out rather than showing a generic error.",
        "One minute before that, a warning appears with a countdown and a **Stay signed in** button. Pressing it extends the session without losing what you were doing.",
        "Administrators are exempt: an admin or super-admin session never ends from inactivity, so a long-running piece of work is never cut off.",
        "Change the timeout under Settings (between 5 and 480 minutes). The setting is enforced by the server, so it applies to every signed-in browser immediately.",
        "No session lives longer than 12 hours regardless of the setting.",
      ] },
      { kind: "note", text: "The desktop shell and the Outlook add-in use a bearer token rather than the cookie, and therefore have no inactivity clock — the warning only appears where it means something." },
      { kind: "h", text: "Multi-factor authentication" },
      { kind: "steps", items: [
        "Open MFA Setup from Settings and scan the QR code with your authenticator app.",
        "Enter the 6-digit code to verify. The enrolment is accepted only for the secret it issued — a code from a different QR code, or a screenshot of somebody else's, is refused.",
        "Store the one-time backup codes you are shown; they are the way in if the device is lost.",
        "At sign-in, complete MFA with the app code or the emailed fallback code.",
      ] },
      { kind: "h", text: "Single sign-on (OIDC)" },
      { kind: "steps", items: [
        "Register an application at your identity provider and give it the redirect URI shown on **Administration → Single Sign-On**.",
        "Enter the issuer URL, client id and client secret there, and use **Check the provider** to read its discovery document before saving.",
        "Decide who may sign in: the email domains to accept, whether an unknown identity gets an account, whether that account may be used straight away, and the role it starts with.",
        "Then switch on **Single sign-on (OIDC)** — on that screen or under Sessions & Security; it is the same setting.",
        "The sign-in page shows Sign in with SSO once it is on, and nothing changes for anyone until then.",
        "Password and MFA sign-in remain available as a fallback. The full procedure, and what each field does, is in the Single Sign-On (OIDC) walkthrough.",
      ] },
      { kind: "h", text: "Passkeys" },
      { kind: "steps", items: [
        "Ask the deployment to set WEBAUTHN_RP_ID to the app's hostname; that is a deployment value, because it identifies the origin a passkey is bound to.",
        "Then switch on **Passkeys (WebAuthn)** under Administration → Configuration → Sessions & Security.",
        "Sign in with your password once, then add a passkey from Settings → Passkeys or from the sign-in page.",
        "Each registered device is listed with its name and last use. Rename one to something you will recognise, or remove a device you no longer hold.",
        "A removed credential stops working immediately, and your password always remains a way in.",
      ] },
      { kind: "h", text: "Hardening & lockout" },
      { kind: "p", text: "AUTH_HARDENING_ENABLED is the production posture, and it does four things at once: tokens drop to a 15-minute expiry, a failed sign-in is counted and the account locks after 5 attempts, an administrator-issued password must be changed at next sign-in, and an older password hash is upgraded to the current cost on the next successful sign-in — **rehash on login, never a forced reset**. It is off in development so nobody locks themselves out of their own desk." },
      { kind: "h", text: "The test-exemption account" },
      { kind: "p", text: "For diagnosing a lockout, a single named account can be exempted from the login interruptions — the lockout, the timeout and the password-change gate — with AUTH_TEST_BYPASS. It **refuses to run in production**, and it should be unset everywhere real; it exists so an administrator can get back in while the cause is being found, not as a convenience." },
    ],
    related: [
      { label: "Configuration", to: "/help/configuration" },
      { label: "Getting Started", to: "/help/getting-started" },
      { label: "Help Index", to: "/help/index" },
      { label: "Settings", to: "/settings" },
    ],
  },
  {
    id: "sso-oidc", group: "walkthroughs",
    path: "/help/walkthroughs/sso-oidc",
    title: "Single Sign-On (OIDC)",
    description: "Point sign-in at an identity provider: register the application, configure it here, and decide who it may sign in.",
    blocks: [
      { kind: "p", text: "Single sign-on sends the browser to your identity provider — Entra ID, Keycloak, Okta, Auth0, anything that publishes an OIDC discovery document — and accepts the identity it comes back with. It is **additive**: passwords keep working, which is also the way back in if the provider becomes unreachable." },
      { kind: "p", text: "Two things are configured separately, on purpose: **the provider** (issuer, client credentials, redirect URI, and who may sign in) on **Administration → Single Sign-On**, and **the switch** on **Sessions & Security**. The switch decides whether sign-in is offered; the provider is what it points at. The Single Sign-On screen writes that same switch, so the two can never disagree." },
      { kind: "h", text: "Register the application at the provider" },
      { kind: "steps", items: [
        "Create an OIDC (or web) application at the provider — in Entra ID that is an App Registration, in Keycloak a client.",
        "Register the **redirect URI** as an allowed redirect. Open Administration → Single Sign-On and copy it from the Redirect URI field; it is the address the provider sends the browser back to. A mismatch here is the most common reason a handshake is refused, and the provider is usually the one that says so.",
        "Make a note of the **issuer URL** (the base URL that publishes `/.well-known/openid-configuration`), the **client id**, and the **client secret**.",
      ] },
      { kind: "h", text: "Configure it here" },
      { kind: "steps", items: [
        "Open **Administration → Single Sign-On** (requires the security management permission).",
        "Paste the **issuer URL** and select **Check the provider**: its discovery document is read and the authorization, token and JWKS endpoints it publishes are listed, so nothing else has to be typed by hand.",
        "Enter the **client ID** and the **client secret**. The secret is write-only — it is never shown again, and leaving the field blank when saving keeps the one already stored.",
        "Leave the **scopes** as `openid email profile` unless the provider needs otherwise; `openid` is required, and `email` is what gives us the address to match a person to.",
        "Check the **redirect URI** is the address you registered at the provider.",
        "Select **Save the provider**.",
      ] },
      { kind: "h", text: "Who may sign in" },
      { kind: "p", text: "The provider vouches for an identity; the deployment decides whether that identity is welcome. **Email domains** narrows it: only addresses in those domains are accepted, whatever the provider knows about. Left empty, every domain the provider will vouch for is accepted — which, for a provider shared with a client, is usually not what you want." },
      { kind: "table", headers: ["Setting", "On", "Off"], rows: [
        ["Create an account on first sign-in", "An identity the provider vouches for gets an account, with the role below", "Only people who already have an account here can sign in this way"],
        ["Use it straight away", "That account signs in immediately, with the role below", "It waits, inactive, for an administrator to enable it — the safer default"],
        ["Role for a new account", "What a provisioned account may do before anybody has looked at it", "The least privilege available (read-only)"],
      ] },
      { kind: "note", text: "A new account is **never** created as an administrator: administrator roles are not offered for provisioning, and a configuration naming one is ignored. Grant an administrator role afterwards, once you have looked at the account." },
      { kind: "h", text: "Turn it on" },
      { kind: "p", text: "Tick **Offer single sign-on on the sign-in page** (or switch on **Single sign-on (OIDC)** under Sessions & Security — it is the same setting) and save. The sign-in page then shows **Sign in with SSO**; nothing changes for anyone until it is on, and an issuer and a client id are required before it can be." },
      { kind: "p", text: "The status card at the top of the screen answers the two questions separately: whether sign-in is offered, and whether the provider is complete. **Check the saved provider** re-reads the discovery document and counts the signing keys it publishes — the step a handshake would otherwise fail on last, rather than first." },
      { kind: "h", text: "What a first sign-in does" },
      { kind: "steps", items: [
        "The browser is sent to the provider's authorization endpoint with a single-use nonce; the callback is accepted only for the sign-in we started, and only for ten minutes.",
        "The identity token is verified against the provider's published signing keys, and its audience is checked against the client id — a token minted for a different application is refused.",
        "The email claim is matched to an account. An address outside the accepted domains is refused there and then.",
        "A known, active account gets a session. An unknown one is provisioned if that is allowed, and an inactive one is told to ask an administrator.",
      ] },
      { kind: "h", text: "Troubleshooting" },
      { kind: "table", headers: ["What you see", "What it means"], rows: [
        ["The provider says the redirect URI is invalid", "The address registered at the provider does not match the one configured here, character for character — including scheme, host, port and path"],
        ["Sign in with SSO is missing on the sign-in page", "The switch is off, or the requirement banner on Sessions & Security reports that no provider is configured yet"],
        ["This sign-in link is invalid or has expired", "More than ten minutes passed between starting sign-in and coming back, or the callback was reloaded — start again"],
        ["Not in a domain this deployment accepts", "The address is outside the configured email domains"],
        ["Your account was created but is not active yet", "Provisioning is on but **Use it straight away** is off; an administrator has to enable the account"],
        ["No account exists for that address", "Create-an-account-on-first-sign-in is off, and nobody here has that address"],
        ["No client secret has been saved", "The provider is a confidential client and needs one; a public client using PKCE does not"],
      ] },
      { kind: "note", text: "A deployment may instead supply the provider through the environment — SSO_ISSUER, SSO_CLIENT_ID, SSO_CLIENT_SECRET and SSO_REDIRECT_URI. Saving a provider here takes precedence over it, so a deployment configured either way keeps working and one configured both ways behaves predictably rather than by chance." },
    ],
    related: [
      { label: "Identity, Sessions & Sign-in", to: "/help/walkthroughs/identity-security" },
      { label: "Configuration", to: "/help/walkthroughs/configuration" },
      { label: "Help Index", to: "/help/index" },
      { label: "Single Sign-On", to: "/admin/sso" },
    ],
  },
  {
    id: "outlook-addin", group: "walkthroughs",
    path: "/help/walkthroughs/outlook-addin",
    title: "Outlook Add-in",
    description: "Convert selected Outlook messages into C7NTAX tickets from the mailbox.",
    blocks: [
      { kind: "h", text: "Switch it on" },
      { kind: "steps", items: [
        "Open **Administration → Configuration → Client Apps & Notifications** and switch on **Outlook add-in**. Both halves of the feature follow it: the taskpane the mailbox loads, the endpoint it calls, and the installer download.",
      ] },
      { kind: "h", text: "Install it" },
      { kind: "steps", items: [
        "Open **C7NC → Outlook Add-in**. That page is the install point for every user, and it offers three routes.",
        "**Download the installer** — a small per-user package that copies the manifest into your own profile and registers it with Outlook. No administrator rights, and it uninstalls cleanly from Installed apps.",
        "**Download the manifest** and sideload it by hand: Outlook → **Get Add-ins → My add-ins → Add a custom add-in → Add from file**. Nothing is written to the registry, which makes this the fastest way to test a change.",
        "Or have a Microsoft 365 administrator publish the manifest URL through centralized deployment, so the whole organisation gets it with no user action.",
        "Close Outlook and open it again. Office reads its add-in list once at start-up, so a running Outlook will not show the button until it is reopened.",
      ] },
      { kind: "h", text: "The installer versions" },
      { kind: "p", text: "**C7NC → Outlook Add-in** lists every installer version that has been built, each with its own **Download**. The release in use leads under **Latest Release**; everything it replaced is kept together below it under **Previous Versions**. Every release is kept, so a version that turns out badly can be replaced by an earlier one rather than waited out: install the older package over the current one, then restart Outlook. The current build is labelled **Newest**, and an entry is marked **Older plugin files** when it was built from a different set of add-in files than the newest one — those are the candidates if a recent change is misbehaving." },
      { kind: "p", text: "The add-in's version (`26.10.7034`) is what Office reports and what the installer filename carries, and it is derived automatically from the application release — every version you can download has a release beside it, so it is always clear which change it belongs to." },
      { kind: "note", text: "Download the manifest **from the page**, not from the repository. The file on disk still contains placeholders — `__ADDIN_HOST__`, `__ADDIN_GUID__` and `__ADDIN_VERSION__` — and Office rejects a manifest whose URLs are not absolute, which it reports by simply not showing the add-in. The server replaces all three when it serves it, so the download always points at the server you took it from and reports that server's plugin version." },
      { kind: "note", text: "If the deployment's web address changes, the installer must be rebuilt against the new address: an installer built for another server registers a manifest that opens an empty pane. Both C7NC → Outlook Add-in and Administration → System Settings compare the two addresses and say so when they differ, with the rebuild command." },
      { kind: "note", text: "Changing the add-in's own files does not take effect in a built installer until it is rebuilt and committed — the page says so when the two have drifted. The rebuild is `pnpm installer:build`, and `pnpm guard:plugin` reports the same problem without building." },
      { kind: "h", text: "Use" },
      { kind: "steps", items: [
        "Sign in to the add-in with your C7NTAX credentials.",
        "Select one message — or several — in Outlook, then choose **Create ticket**.",
        "With several selected you are asked first whether to create **One ticket each** or **Bundle into one ticket**. Bundling then asks which message the ticket is written from; the rest are saved on it as `.eml` originals you can open later.",
        "Answer whether to **see a preview**. The preview shows every field that will be filled in — board, client, contact, subject, description, priority — and any of them can be edited before submitting. It also tells you which messages already have a ticket.",
        "Tick **Remember this answer** on either question to stop being asked it. **Preferences** (in the pane header) is where a saved answer is seen and undone — with both saved, a later selection files the ticket with one click and no questions at all.",
        "Duplicate messages are skipped using the Message-ID dedup store, so re-running the action never creates duplicates.",
      ] },
      { kind: "h", text: "See it before installing anything" },
      { kind: "p", text: "Open **Administration → Configuration → Client Apps & Notifications** and press **Open the simulator**. It opens the add-in's own pane in a separate window with a few example emails, so the questions, the review and the result can be walked through without installing the add-in, signing in, or filing anything. Switch the example selection between **One email**, **Three** and **Five, two unmatched** to see each path — a single message, several, and the case where two senders match no client. Nothing is created, sent or saved." },
      { kind: "note", text: "The simulator **is** the add-in's pane, not a copy of it, so what it shows is what the add-in does. It is reachable only while the Outlook add-in is switched on, because it is served from the add-in's own address." },
    ],
    related: [
      { label: "Outlook Add-in (install page)", to: "/c7nc/outlook-addin" },
      { label: "Client Apps & Notifications", to: "/admin/configuration/apps" },
      { label: "Email-to-Ticket Setup", to: "/help/walkthroughs/email-tickets" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "cloudconnect", group: "walkthroughs",
    path: "/help/walkthroughs/cloudconnect",
    title: "C7NC — connecting services",
    description: "Connect third-party services, test connections, and fix credentials inline.",
    blocks: [
      { kind: "h", text: "The five tabs" },
      { kind: "figure", src: "/help/cloudconnect.png", alt: "The C7NC overview page with its connection health summary and the five tabs", caption: "**C7NC in one screen.** The summary line says how many services are connected, which model is in use and how many need attention; the tiles below count what is connected, what answers and what does not. The tab is in the address, so any of the five can be linked to." },
      { kind: "p", text: "C7NC answers several different questions, so it is split up, and the tab is in the address so any of them can be linked to. **Overview** is the summary: whether anything needs attention, and the fix for it. **Services** is the connectors — what is configured, whether each connection is healthy, where its data comes from — and it carries the configure view for one connection, so *Connected* and *Configuration* are the same tab now. **AI Models** is where a model is connected so the application can use one. **Email** holds the mailbox connectors, which are configured differently from the API connectors. **Companion apps** is what a person installs on their own machine." },
      { kind: "h", text: "Add a connector" },
      { kind: "steps", items: [
        "Open C7NC → Services and press Connect a service.",
        "Pick a connector type (Microsoft 365, ConnectWise PSA, AutoTask PSA, HaloPSA, Kantata, Scoro, FlexPoint Payment Solutions, QuickBooks Online, Pax8, Harmony Email, Proofpoint, SentinelOne, IT Glue, Azure, AWS, Azure AD SSO).",
        "Every field says what it is and where to find it in the vendor's own product, and the panel links to that vendor's API documentation. Fill them in and save.",
      ] },
      { kind: "note", text: "The field hints are written against each vendor's API documentation, including the parts that are easy to get wrong: the host that is not the vendor's (AutoTask's zone, SentinelOne's console, HaloPSA's auth host), the authentication that is not an API key (Harmony Email signs an application id and secret into a token; Proofpoint and ConnectWise use HTTP Basic; AWS signs every request), and the credential that expires (QuickBooks access tokens last an hour, so the refresh token is what gets stored)." },
      { kind: "h", text: "Test & fix inline" },
      { kind: "steps", items: [
        "Select Test connection — the result appears for that connection.",
        "Fix failing fields in the dialog and re-test without leaving the page.",
        "Connection status chips refresh live so broken integrations are visible immediately.",
        "The Test connection button keeps the same glyph whether the last test passed or failed — the button is the action, the chip beside it is the status. Read the chip, not the picture on the button.",
      ] },
      { kind: "note", text: "With live status on, the server re-verifies connections on a throttle and reports what it last observed — so a chip means \"last verified at\", not \"the last time somebody saved the form\". Switch it off and only the stored status is returned, with no calls made at all." },
      { kind: "h", text: "Configuration" },
      { kind: "p", text: "The Configuration tab has a connection list on the left and three panels on the right: **Credentials** (the same fields the catalogue describes, pre-filled), **Options** (only the settings that connector actually honours), and **Records brought in** with the connection's sync history. Saving stores the configuration but tests nothing — press Test connection afterwards, which is said on the tab because it is the mistake people make. A Microsoft 365 connection also carries that tenant's **account panel**: the age bands, the accounts and their last sign-in, the offboarding action, and a link to the cross-client report under Reporting." },
      { kind: "h", text: "AI Models" },
      { kind: "p", text: "**AI Models** connects a model provider — Claude, GPT, Gemini, DeepSeek, Grok, Mistral, a local Ollama server, or anything that speaks the OpenAI API — so the application can use one: ticket suggestions come from it instead of keyword search, and it is the model the assistant answers with. Each provider's dialog asks only for what that vendor needs, says where to create the key, and links to that vendor's own API documentation." },
      { kind: "steps", items: [
        "Open C7NC → AI Models and pick a provider.",
        "Paste the API key. Only providers whose address cannot be guessed (Azure, a local server, a gateway) also ask for one.",
        "Choose the model. The suggested names are a starting point — save, then use the model list on the row to read the names the vendor is serving today.",
        "Press Test connection: it asks the vendor, and shows what the vendor answered. The result is remembered on the connection.",
        "Press the power button to make it the model the application uses. Both flags move together, so a connection cannot be half-used.",
        "Tick May perform app functions if you want the model to be able to call this application's own functions when you ask it something.",
      ] },
      { kind: "note", text: "Keys stay on the server and are never returned to a browser: the field is write-only, and a connection only ever says whether it holds one. Prompts leave your network for whichever vendor you connect, so anything the model is asked to read is sent to them — a local model is the only option that keeps it in-house. A connection cannot be made the application's model until it has a key, testing happens on every new connection, and the address a self-hosted endpoint is given is used exactly as entered, which is why a wrong address looks like a wrong key." },

      { kind: "h", text: "Where the data came from" },
      { kind: "p", text: "Anything read from a connector rather than entered in C7NTAX carries a small **source note** naming the system it came from — on a connection's heading, beside an integration panel's heading, and under the records list. A FlexPoint invoice and a C7NTAX-native invoice look alike otherwise, and \"who owns this number\" is the first question anybody asks." },
      { kind: "h", text: "QuickBooks Online" },
      { kind: "p", text: "QuickBooks stores a Client ID, Client Secret, **Refresh Token** and Realm ID. The refresh token is the credential that matters: access tokens expire after an hour and are exchanged for at the Intuit OAuth host rather than at the API host, so a connection holding only an access token works once and then reports itself broken. The Environment option decides production or sandbox, and must match the keys you entered. Approved expenses are pushed the same way invoices are." },
    ],
    related: [
      { label: "Expenses & Accounting Sync", to: "/help/walkthroughs/expenses" },
      { label: "M365 Inactivity & Offboarding", to: "/help/walkthroughs/m365-offboarding" },
      { label: "Email-to-Ticket Setup", to: "/help/walkthroughs/email-tickets" },
      { label: "Help Index", to: "/help/index" },
      { label: "C7NC", to: "/c7nc/services" },
    ],
  },
  {
    id: "kumo", group: "walkthroughs",
    path: "/help/walkthroughs/kumo",
    title: "Kumo: Passwords, Documents & Audit",
    description: "Store passwords and documents, and audit who changed what and when.",
    blocks: [
      { kind: "h", text: "Passwords" },
      { kind: "steps", items: [
        "Open Kumo → Passwords and select Add.",
        "Enter the credential details; values are stored AES-256 encrypted.",
        "Attach TOTP where available for rotating codes.",
      ] },
      { kind: "h", text: "Documents & files" },
      { kind: "steps", items: [
        "Open Kumo → Documents and select Upload.",
        "Choose the file (PDFs supported); it is stored and listed with metadata.",
        "Organize with folders and template fields for consistent SOPs.",
      ] },
      { kind: "h", text: "Audit trail" },
      { kind: "p", text: "Every Kumo item shows an audit log with the action, the user who made the change, and the last modified date." },
    ],
    related: [
      { label: "Help Index", to: "/help/index" },
      { label: "Kumo", to: "/kumo" },
      { label: "Knowledge Base", to: "/kb" },
    ],
  },
  {
    id: "custom-reports", group: "walkthroughs",
    path: "/help/walkthroughs/custom-reports",
    title: "Designing a Report (bands, charts, sub-reports)",
    description: "Build a designed report band by band, add charts and sub-reports, then export or schedule it.",
    blocks: [
      { kind: "h", text: "Start a designed report" },
      { kind: "steps", items: [
        "Open Reporting → Custom Reports and select **New designed report**.",
        "Choose what to report on (Tickets, Invoices, Time entries, Expenses, Assets, Contacts, Clients) and a layout to start from: blank page, simple list, grouped list with totals, or summary with grand totals.",
        "Select **Open the designer**. The report is a draft until you save it, and a name is suggested from your choices.",
      ] },
      { kind: "note", text: "A designed report is stored as an ordinary saved report, so it lists, runs, exports, schedules, duplicates and deletes beside every other report you have." },
      { kind: "h", text: "Bands and elements" },
      { kind: "p", text: "A report is a stack of **bands**, each printed at a defined moment: Report Title once at the top, Page Header and Column Header on every page, Group Header and Group Footer around each group, Data once per row, Column Footer and Page Footer at the bottom, and Report Summary once after the last row." },
      { kind: "steps", items: [
        "Select a band to set its height, whether it repeats after a page break, and whether it starts a new page.",
        "Add an element from the palette: **Text, Field, Total, Chart, Sub-report, Line, Box** or **Image**.",
        "Drag an element to move it and its handles to resize — in millimetres, snapped to a millimetre (hold **Alt** for a quarter). Arrows nudge, **Shift+arrows** move 5mm, **Delete** removes, **Ctrl+D** duplicates.",
        "**Ctrl+Z** and **Ctrl+Shift+Z** undo and redo; **Ctrl+S** saves.",
      ] },
      { kind: "tip", text: "The canvas shows each element with its real value from the preview, so a column that will not fit is obvious before you print it." },
      { kind: "h", text: "Expressions, totals and running totals" },
      { kind: "p", text: "A field prints an expression over the current row — `Fields.status`, or `UPPER(Fields.client)` — and text elements can mix literal words with values using `{{ … }}`, so a caption reads \"Client: {{Fields.client}}\". The palette inserts a field, a built-in (`Page.number`, `Page.totalPages`, `Report.name`, `Group.value`) or any of the forty functions **into the expression you were last typing in**, with the caret landing inside the brackets." },
      { kind: "table", headers: ["Element", "What it does"], rows: [
        ["Total", "SUM, AVG, MIN, MAX, COUNT or COUNTD over one of three scopes: the whole report, the current group, or the current page. A page total is resolved after pagination, so it is the total of the rows actually on that page."],
        ["Running total", "RUNNINGSUM, RUNNINGAVG or RUNNINGCOUNT keep adding up as the rows print and carry over a page break by construction. Scoped to a group (RUNNINGSUM(Fields.amount, 'status'), or 'group' for the innermost) it restarts the moment that group opens. 'page' is not a valid scope for a running total."],
      ] },
      { kind: "h", text: "Charts" },
      { kind: "steps", items: [
        "Add a **Chart** element. It draws a column, bar, line, pie or donut from the report's own rows.",
        "Choose the **category field** that groups the rows and the **value field** to fold inside them, then how to fold it — SUM, COUNT, AVG, MIN, MAX or COUNTD — over the report, the current group or the current page.",
        "Optionally set a title, print values on the bars, and show the legend.",
        "**Categories** is a cut-off: beyond it the tail folds into one bar labelled Other (n) so the axis stays readable, and the folded values are kept rather than dropped.",
      ] },
      { kind: "note", text: "A chart needs room. Below roughly 40×30mm there is nowhere for the axis labels and the legend to go, and the designer says so while you are still laying it out." },
      { kind: "h", text: "Sub-reports" },
      { kind: "steps", items: [
        "Add a **Sub-report** element and choose the saved designed report it should print, from the list of every report you have designed.",
        "Bind any parameter the chosen report declares — one expression box each, with the required ones marked. A binding is worked out from *this* report's parameters, such as `Parameters.status`.",
        "The sub-report prints **inside this report's pages**: it brings its own title and column captions, runs its own data source, and does not change this report's page count, page numbering or row count.",
      ] },
      { kind: "warn", text: "A binding cannot read Fields — the sub-report's rows are fetched once, before this report's rows are read, so there is no row to read yet. Sub-reports nest up to three deep, and a report that would print itself is skipped with a note instead of looping." },
      { kind: "h", text: "Design, Preview and Data" },
      { kind: "table", headers: ["Tab", "Shows"], rows: [
        ["Design", "The bands with live values, where you place elements."],
        ["Preview", "The paginated pages exactly as they will print, including charts and sub-reports."],
        ["Data", "The rows the report selected, with the parameters and the date range."],
      ] },
      { kind: "p", text: "Anything the designer cannot work out is listed at the top as a problem or a warning rather than silently printing wrong. Nothing that fails validation can be saved or run." },
      { kind: "p", text: "The toolbar states the report's own identity — *banded · A4 portrait · 3 data sources · 8 bands* — beside its name, and the line under the canvas answers the four questions a layout tool usually leaves to a tooltip: **what is selected**, **how tall that band is**, **how many rows the last run returned** and **how many pages it lays out to**, followed by the page setup and whether the document has anything wrong with it. The designer keeps its own full-bleed layout rather than the page chrome, because it is a tool: three panes and one document." },
      { kind: "p", text: "In the redesigned interface the toolbar is **one row of pills in the order the work is done**: which report this is, how you are looking at it (**Design**, **Preview**, **Data**), how big it is (**−**, the percentage, **+**, **Fit width**), what the sheet draws (**Grid** for the millimetre grid the snapping follows, **Bands** for the band names and heights — turn both off to see the page as the reader will), **undo and redo**, and the two writes: **Save** and **Run**. A **ruler** along the top of the sheet measures it in its own millimetres at the current zoom, so a position on the page can be read rather than eyeballed. The left pane is the six things a report is made of, one at a time — **Bands** in print order, **Data**, **Parameters**, **Fields**, **Expressions** and **Schedule**. The classic interface keeps the single scrolling palette and the older toolbar." },
      { kind: "h", text: "Its own window, and autosave" },
      { kind: "p", text: "**Pop out** opens the designer in a window of its own — no rail, no bar, the whole height for the sheet — so you can lay a report out and keep working in the application at the same time. The window you popped from steps back and says so, rather than letting two windows edit one document: **Bring it forward** returns to the other window, **Return it to this window** closes it and carries on here." },
      { kind: "p", text: "It saves as you go, in two layers. A **draft is written to this device** a second after you stop changing something, so nothing you type waits on the network, and the toolbar says *Draft saved 22:27*. The **report itself is saved** a few seconds later, quietly, once it validates and it exists — until then it says *Not saved yet*, because a report nobody has created has nowhere to go yet. When it has saved: *All changes saved 22:27*." },
      { kind: "p", text: "If a draft on this device is different from the report, the designer **offers** it rather than applying it — *This device has a draft of … from 8 Oct 2026, 22:27* with **Restore it** and **Discard the draft**. Autosave that silently replaces your work would be the one thing it must never do." },
      { kind: "p", text: "**Looking away with unsaved changes asks once** — *You looked away with unsaved changes* with **Save it now**, **Save a draft** and **Keep editing** — and **closing or reloading the window** gets the browser's own question. The draft is already on the device by the time either can appear." },
      { kind: "h", text: "Print, PDF, Excel, CSV" },
      { kind: "p", text: "All four read the same laid-out pages, so a page break in the preview is the page break in the PDF. **Print** and **PDF** reproduce the design, including charts. **Excel** and **CSV** take one row per data row with the group each row belongs to, because a spreadsheet of positioned text boxes would be useless." },
      { kind: "h", text: "Scheduling" },
      { kind: "steps", items: [
        "From the Custom Reports list, open a report's schedule options.",
        "Choose the cadence and the recipients, then save.",
        "Schedules are stored per report and delivered as a PDF.",
      ] },
    ],
    related: [
      { label: "Reporting & Business Reviews", to: "/help/walkthroughs/reporting" },
      { label: "Help Index", to: "/help/index" },
      { label: "Custom Reports", to: "/reports/custom" },
      { label: "Standard Reports", to: "/reports/standard" },
    ],
  },
  {
    id: "shortcuts", group: "walkthroughs",
    path: "/help/walkthroughs/shortcuts",
    title: "Workspace, Shortcuts & Batch Actions",
    description: "Arrange your dashboard, use the command palette and keyboard shortcuts, and work many tickets at once.",
    blocks: [
      { kind: "h", text: "Your dashboard" },
      { kind: "p", text: "The dashboard is assembled from widgets, and its arrangement **follows your account rather than the browser** — so it is the same on any machine you sign in from." },
      { kind: "steps", items: [
        "Select **Customise** to open the widget list.",
        "Drag a widget by its handle to reorder it, or use the arrows if you prefer keys.",
        "Pick **S**, **M** or **L** for its width in the grid.",
        "Hide the widgets you do not use — a hidden widget is remembered, and the header says how many are hidden.",
        "Select **Reset** to go back to the standard layout.",
      ] },
      { kind: "note", text: "A widget that was hidden or renamed in an earlier version degrades quietly rather than breaking the page: an unknown widget is simply skipped." },
      { kind: "h", text: "Command palette (⌘K)" },
      { kind: "steps", items: [
        "Press **⌘K** (or **Ctrl+K**) anywhere to open the palette.",
        "Type to search pages, actions and settings; the arrow keys move and Enter runs the highlighted entry.",
        "Use it for jumping to a page, creating a ticket, switching the theme, or turning a UI feature on and off.",
      ] },
      { kind: "h", text: "Keyboard shortcuts" },
      { kind: "table", headers: ["Key", "Action"], rows: [
        ["T", "Jump to Tickets (when you are not typing in a field)"],
        ["⌘K / Ctrl+K", "Open the command palette"],
        ["⌘S / Ctrl+S", "Save, inside the report designer"],
        ["⌘Z / Ctrl+Z", "Undo, inside the report designer (add Shift to redo)"],
        ["⌘D / Ctrl+D", "Duplicate the selected report element"],
        ["Alt", "Hold while dragging a report element to place it on a quarter of a millimetre"],
      ] },
      { kind: "h", text: "Favorites and the navigation's right-click menu" },
      { kind: "p", text: "The navigation can keep the sections you use most at the top of the pane. Pinning is a **copy, not a move**: the section stays exactly where it is, and a second copy of it is drawn under **Favorites** — so nothing you already know about the navigation changes." },
      { kind: "steps", items: [
        "Right-click any section or subsection. The menu is about what you right-clicked: a page offers **Open**, **Open in new tab**, **Open in new window** and **Copy link**, and a section adds its own expand and collapse.",
        "Choose **Pin to Favorites**. It appears at the top of the pane, and a small star marks it where it already lives, so a copy is visibly a copy.",
        "Put the pinned copies in your own order: drag one by its handle, or right-click it and use **Move up** and **Move down**.",
        "Right-click a pinned copy and choose **Remove from Favorites** to take it out. The section itself is untouched.",
        "Right-click empty space in the pane for the whole-navigation actions: **Expand all**, **Collapse all** and **Remove all favorites**.",
      ] },
      { kind: "note", text: "Favorites follows the browser, like the section order and the sidebar width — another machine has its own. A section your role cannot open never appears there, even if it was pinned before your permissions changed, and a pinned section opens and closes on its own, so pinning a large area does not unfold it." },
      { kind: "h", text: "Batch actions" },
      { kind: "steps", items: [
        "Open Tickets and tick the checkboxes on the left of the rows.",
        "Choose the batch action (acknowledge, close, and more) from the bulk bar.",
        "Confirm — results are applied to all selected tickets with a summary toast. A failed row is reported rather than silently skipped.",
        "If **Close** is one of the ticked actions, the other actions run and the same closing dialog opens for the selection: closing always asks whether the client is told, whether it is one ticket or thirty.",
      ] },
      { kind: "h", text: "Closing a ticket" },
      { kind: "figure", src: "/help/close-dialog.png", alt: "The close dialog over the ticket list, with Close silently chosen and a line explaining why", caption: "**Closing a ticket.** One dialog, four decisions: who is told, how it is closed, the reason, and the button that says what will happen. Here it is a NOC Alerts ticket, so the board has set **Close silently** as the default and the line under the choices says why — **Email the client** is one click away when that default is wrong." },
      { kind: "p", text: "Closing is two actions in one — the ticket settles, and somebody tells the client — so it asks which of the two you mean rather than assuming. The same dialog appears from the list's right-click **Close ticket**, the row's own menu, the bulk **Quick Actions** choice, and the record's **Status** pill, in both interfaces." },
      { kind: "steps", items: [
        "Choose **Close** (or set the record's Status pill to Closed or Resolved). The dialog opens with the ticket it is about.",
        "Say who is told: **Email the client** or **Close silently**. Your answer is remembered for next time, and the line under each choice says what it does — the email invites a reply, and silence sends nothing.",
        "Choose **Closed** or **Resolved**. Resolved is the honest answer when the work is done but a confirmation is still outstanding; both settle the ticket.",
        "Write the **closing note** — the reason it is being closed. It is the body of the email and it is recorded in the thread the client can see, so it is one sentence asked for once rather than a memo nobody reads.",
        "The button says what will happen (**Close and email the client**, or **Close silently**), so the last thing before the action is what the action does.",
      ] },
      { kind: "note", text: "Where the dialog starts depends on the **board**. Most boards begin at *Email the client* — the remembered answer, or email if you have not closed anything yet. A board set to **not** email on closure (Administration → Service Boards) begins at **Close silently**, and says so under the choices, because its tickets arrive from monitoring systems at no-reply addresses. You can still choose **Email** — it is a default, not a rule. A bulk selection that spans boards starts at *Email the client* unless every ticket in it is from a silent board, so a mixed batch still tells the real clients." },
      { kind: "note", text: "The closing email ends by telling the client that a reply reopens the ticket, and the email connector acts on it: a reply from one of that client's contacts restores the ticket to **Customer reopened** and it reappears in the queue with the reply on it. The ticket's **owner is emailed** at the same time — the assignee, or whoever raised the ticket when nobody owns it — with who replied and what they said, because a ticket that has come back is work again and a queue is not something everybody watches. Ticket closed by mistake, contact has left, duplicate — those are the cases **Close silently** exists for." },
      { kind: "h", text: "How a ticket number reads" },
      { kind: "p", text: "Every ticket's number is three parts joined by dashes — **`MSP-04-1005`** — and each part answers a different question:" },
      { kind: "table", headers: ["Part", "What it is"], rows: [
        ["`MSP`", "The **board's ticket code**, set on Administration → Service Boards. It is the queue the ticket was raised on. A board with no code falls back to the client's type, which is what every number was built from before this scheme."],
        ["`04`", "The **client**, as a short number. Client 1004 reads `04`, the tenth client `10`, the hundredth `100`."],
        ["`1005`", "The **sequence**, counted **per board and per client together** — so one queue's growth never moves another queue's numbers."],
      ] },
      { kind: "note", text: "The sequence is a count, not a guarantee of order: numbers are reused for nothing and never go backwards, but a gap appears whenever a ticket is deleted. That is deliberate — reusing a number after a delete would hand two tickets the same reference." },
      { kind: "p", text: "Numbers written before this scheme are left exactly as they are — they are the threading key in every email already sent and the reference a client may quote back — unless you run the renumbering script deliberately (see below). Because of that, an instance that has been running a while shows both conventions side by side." },
      { kind: "h", text: "Renumbering what is already there" },
      { kind: "steps", items: [
        "`npx tsx src/renumber-tickets.ts` in `apps/api` is a **dry run**: it prints what would change and writes nothing.",
        "`npx tsx src/renumber-tickets.ts --apply` performs it and writes a map of every number that moved to `out/ticket-renumber-map-<timestamp>.json`.",
        "It keeps each ticket's own sequence, so a ticket people know as `…-1008` stays `…-1008`; only the board code and the client's octet are added or rewritten.",
        "Two old numbers can land on the same target. The earliest ticket keeps it and the others are given the next free sequence, and each of those is listed in the output — a number that moved for that reason is one whose history will not match what was printed last month.",
      ] },
      { kind: "tip", text: "A client's reply finds its ticket by the number in the subject, so renumbering changes the reference in any email still in somebody's inbox. The map the script writes is what you would reconcile against if a client ever asks about an old number." },
      { kind: "h", text: "Ticket list columns" },
      { kind: "figure", src: "/help/tickets-list.png", alt: "The ticket list: board tabs, filter controls and the column header row", caption: "**The ticket list.** Board tabs across the top of the table, the view strip and search above it, and **Choose Columns** beside **Filter** on the right. The header row is the list's own: every column can be reordered, resized and hidden, and the two timestamps — **Date Created** and **Last Updated** — are shown by default because \"when was it raised\" and \"when did anything last happen to it\" are different questions." },
      { kind: "steps", items: [
        "Select Choose Columns above the ticket card to open the column picker.",
        "Check or uncheck any column (Ticket #, Summary, Status, Board, Client, Technician, Age, SLA, Priority, Date Created, Last Updated) — Priority, Board and SLA are available but unchecked by default.",
        "Drag any column header to reorder; click a header to sort. Visibility and order are saved per user.",
        "Columns are measured against the tickets on screen and sized to fit their content, so a row is one line high rather than a wrapped paragraph. Summary is the exception: it takes whatever width is left over.",
        "Drag the right edge of any header to set that column's width yourself, and double-click the edge to go back to the measured width. **Fit columns to content**, in the same picker, forgets every width you have set.",
        "**Date Created** and **Last Updated** are two columns rather than one: the first is when the ticket was raised and never changes, the second is when it was last touched. Both read to the **minute** (`9/30/2026, 12:59 PM`) — nobody triages a queue by the second, and the room the seconds cost is room the Summary beside them uses. Hovering either one gives the **exact** timestamp with its seconds, and the second also in the relative form the queue uses (3d ago).",
      ] },
      { kind: "tip", text: "Lists use skeleton loaders while fetching; animations respect reduced-motion preferences." },
    ],
    related: [
      { label: "Getting Started", to: "/help/getting-started" },
      { label: "Recent Activity & My Activity", to: "/help/walkthroughs/my-activity" },
      { label: "Help Index", to: "/help/index" },
      { label: "Today", to: "/" },
      { label: "Tickets", to: "/tickets" },
    ],
  },
  {
    id: "my-activity", group: "walkthroughs",
    path: "/help/walkthroughs/my-activity",
    title: "Recent Activity & My Activity",
    description: "The header's Recent menu, the My Activity page, and the difference between your history and the audit trail.",
    blocks: [
      { kind: "p", text: "**Recent** in the header toolbar answers the question you ask after an interruption: *where was I, and what did I just change?* It shows the five most recent things, newest first, and clicking one puts you back in front of it rather than at the top of a section. **Show All** opens **My Activity** — the same list at length, on `/activity`. It is also in the account menu, under **My Account → My Activity**, which is where it lives rather than in the navigation: it is your own history, not a section of the product." },
      { kind: "h", text: "What counts as an activity" },
      { kind: "p", text: "Two kinds, and they are told apart by their icon and their wording, because \"I changed this\" and \"I was reading this\" are different reasons to click:" },
      { kind: "table", headers: ["Kind", "What it is", "Where it takes you"], rows: [
        ["**A change**", "Work you did: a ticket updated, a client created, a note added, time logged, a setting changed, a record deleted. Every successful write is already recorded by the audit trail — this list is a reader for it, not a new source of data.", "The record itself, when the entry names one. A deletion has no record left to open, so it goes to the section where you would confirm the deletion happened."],
        ["**A visit**", "A page that held you for **two minutes** without navigating away. Passing through a section is not an activity; reading it is.", "The page, scrolled to its heading."],
      ] },
      { kind: "note", text: "Rearranging your own dashboard or the order of your favorites is written to the audit trail but is not shown here. It is real, and it is deliberately out of the way: \"you moved a sidebar item\" is not somewhere anybody wants to be taken back to, and it would push the five entries that matter off the menu." },
      { kind: "h", text: "The link lands on the exact place" },
      { kind: "p", text: "An entry is a link to the thing it names, not to a section: \"Ticket → Updated — SLAs\" opens **that** ticket at the activity region, and the region **scrolls into view and flashes** so you can see what the menu meant. A change to a setting lands on the field itself, in the configuration section that owns it." },
      { kind: "tip", text: "That arrival highlight is the point of the feature rather than a decoration — the menu already told you *what* and *when*; the highlight is what answers *where*." },
      { kind: "h", text: "My Activity, and the audit trail — which one am I looking for?" },
      { kind: "table", headers: ["", "My Activity (`/activity`)", "Audit trail (Administration → Audit Logs)"], rows: [
        ["Whose changes", "**Yours only.** Nobody else's activity is in this list, however senior you are.", "**Everyone's** — every change across the instance, whoever made it."],
        ["Who may open it", "Anyone signed in. It is your own record, so it needs no special permission and there is no greyed-out version of it.", "Requires the audit permission, because it names who did what to whom."],
        ["Repeated changes", "Kept, each at its own time — two deletions of two different clients are two entries.", "Kept, in full detail."],
        ["Pages you stayed on", "Included, from this browser.", "Not included: an audit trail records changes, not attention."],
        ["How far back", "Your 200 most recent changes.", "The retention window the deployment is configured for."],
      ] },
      { kind: "note", text: "**The trail records the second; the ticket queue shows the minute.** The queue's **Date Created** and **Last Updated** columns read to the minute because that is the unit a queue is triaged by — hovering either gives the exact time — but every entry in **Administration → Audit Logs** carries its seconds, because that is what decides which of two changes to the same field came first." },
      { kind: "note", text: "**A visit is kept in this browser, not on the server.** The act of looking at a page is not written into the audit trail, deliberately — so visits do not follow you to another machine, and clearing your browser data clears them. Your changes are unaffected by either, because those live in the audit trail." },
      { kind: "h", text: "When the list is empty" },
      { kind: "p", text: "A brand-new account sees **Nothing yet**, because it is true: the list is your history, and you have not made one. It fills as you work — the first change you save appears within a second, without a reload." },
    ],
    related: [
      { label: "Workspace, Shortcuts & Batch Actions", to: "/help/walkthroughs/shortcuts" },
      { label: "FAQ", to: "/help/faq" },
      { label: "My Activity", to: "/activity" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "navigation", group: "walkthroughs",
    path: "/help/walkthroughs/navigation",
    title: "The Navigation Pane",
    description: "The rail of sections, the destinations beside it, favourites, what adapts by itself, and how to go back to the single tree.",
    blocks: [
      { kind: "p", text: "The left pane exists to answer two questions: **what is in this application**, and **where am I**. It has two shapes and the same contents — every page, route and permission is identical in both, so changing the pane never changes what a page does." },
      { kind: "table", headers: ["", "Rail and sections (default)", "Single tree (classic)"], rows: [
        ["What you see", "A rail of domains down the left. Choosing one flies its destinations out **over the page**, anchored to the rail, and the panel closes as soon as you pick something.", "Every section and every nested row in one list, expanded as you go. One scroll region."],
        ["Why", "The rail's length is a design decision rather than a consequence of the feature list, and the list of destinations appears when you ask for it instead of holding a permanent column open.", "It is the pane the application had before, unchanged."],
        ["What it costs the page", "Nothing. The rail is 200px — narrower than the 256px the tree occupied — and the panel floats above the content rather than taking width from it.", "256px by default, resizable, and the pages lay out around it."],
        ["Choose it", "The default.", "Administration → Configuration → Workspace → **Navigation pane** → *Single tree (classic)* for everyone, or **My Account → Appearance → Navigation** for just you."],
      ] },
      { kind: "h", text: "The rail" },
      { kind: "figure", src: "/help/rail.png", alt: "The navigation rail with the Service Desk domain open beside it", caption: "**The rail and the panel beside it.** The rail is the spine — one row per domain, Favorites first, Kumo at the foot above the utilities — and clicking a row opens its destinations in the column beside it. The row you are on stays highlighted while the panel is open, so the rail answers *where am I* without anything being opened." },
      { kind: "p", text: "The first row is **Favorites** — everything you have pinned, in your own order — and below it each row is a **domain**: a group of destinations that belong to the same job rather than to the same part of the database. **Clicking one opens its destinations; clicking it again closes them.** Clicking a different row moves the panel to that domain — one gesture, one meaning, so browsing several domains is quick — and while the panel is closed the rail costs a click and nothing else. The row for the page you are on stays highlighted, so the rail still answers *where am I* without opening anything. **Home** and **Today** are the two rows that navigate instead of opening, because each is a single page rather than a group." },
      { kind: "table", headers: ["Rail row", "What is in it"], rows: [
        ["**Favorites**", "What you have pinned, at length and in your order — see below. Always the first row, whether or not anything is pinned, because a row you only find after you have pinned something is a row nobody finds."],
        ["**Home**", "The landing page — what this instance is and where to start. A row that *is* a page: clicking it goes there rather than opening a list of one."],
        ["**Today**", "Your day at a glance, and the dashboard you arrange yourself. It was called Dashboard; the row and the page now carry the name the rest of the product already used for them, and like Home it is a row that goes straight to the page."],
        ["**Service Desk**", "Tickets, the boards they sit on, and the knowledge base you answer from."],
        ["**Clients**", "The client list, contacts, asset inventory, procurement, and the customer portal's settings."],
        ["**Delivery**", "Projects, the calendar, and time off."],
        ["**Revenue**", "The pipeline, quotes, invoices, agreements, payments, time and expenses, the finance dashboard, billing reports, and the product catalogue."],
        ["**Insight**", "The reporting areas — dashboards, standard reports, business reviews, analytics, custom reports — and the AI actions waiting for review."],
        ["**Administration**", "How the instance is wired: the C7NC connections and models, users and roles, API access, single sign-on, the audit trail, system settings, and the settings hub. The hub is one row rather than fourteen — the page it opens already presents those as sections."],
        ["**Service Alerts**", "The alert board, the uptime monitors that raise alerts, and the webhook endpoints they are sent to. It keeps a rail row of its own, and the live count on it, because it is the only part of the pane that reports the state of the instance rather than its shape — a count you have to open a section to see is a count nobody sees."],
        ["**Kumo**", "Everything in Kumo: organizations, assets, passwords, configurations, documents, checklists and domains. It carries a logotype rather than a label and sits at the **foot** of the spine, just above the utilities, because it is a product inside this one rather than a step in the service-desk flow — and because a wordmark the height of a heading used to make the rows beneath it look like its contents, which they never were."],
      ] },
      { kind: "note", text: "**Home and Today are rows that navigate rather than open, and My Activity has moved into the account menu.** Home and Today are pages, not groups of pages, so clicking them goes there — there is no list of one behind them to open. **My Activity** (`/activity`) left the navigation for **My Account → My Activity**, under Preferences: it is a person's own history rather than a place in the product, so it belongs with your profile and your settings. Its route, its page title and its breadcrumb are unchanged, and the header's **Recent** menu still opens it." },
      { kind: "p", text: "Underneath the domains are the **utilities**: Assistant, Help, My Settings and Console. They are somewhere you go for something rather than somewhere you work. The **Assistant** can be moved into the rail itself — Administration → Configuration → Workspace → **Assistant in the navigation rail** — for a team that starts its day in it; the switch only has an effect while the pane is set to rail and sections." },
      { kind: "h", text: "The panel" },
      { kind: "p", text: "The destinations of the opened domain, in three groups. It closes when you choose something, when you click outside it, and on **Esc** — it is a thing you are looking at, not a place you are in." },
      { kind: "steps", items: [
        "**Pinned** — anything you have added to Favourites, at the top. Right-click a row to pin or unpin it, exactly as in the classic pane; the list is the same one, stored against your account so it follows you to another machine.",
        "**In use** — the rows **you** open, most-used first. This is the pane adapting by itself rather than asking you to maintain it.",
        "**Everything else** — rows you have not opened yet, counted and one click away. Nothing is ever hidden from you; it is folded, and the count says how many.",
      ] },
      { kind: "note", text: "**When nothing has been recorded yet, nothing is ordered and nothing is folded.** The pane only starts adapting in a section once you have opened something in it, and only folds rows in a section long enough to need it. A first run is therefore never worse than the tree it replaced." },
      { kind: "table", headers: ["Control", "What it does"], rows: [
        ["The filter at the top of the panel", "Narrows the **whole application** to what matches, showing where each hit lives — which is how you find something when you cannot remember which section owns it."],
        ["The order toggle beside the filter", "Switches between **ordered by what you open** and **A–Z**. A–Z is there for anybody who navigates by position and wants the list to sit still."],
        ["Right-clicking a row", "Its own menu, including pin and unpin. Every row in the rail has one too, so a whole section can be pinned as well as a page."],
      ] },
      { kind: "h", text: "Favorites" },
      { kind: "p", text: "Favorites is the one part of the rail that is yours rather than the application's. **Right-click anything and choose *Pin to Favorites*** — a section on the rail, or a page inside one — and it appears in the **Favorites** row at the top, in the order you put it in and nothing else's. **Remove from Favorites**, **Move up** and **Move down** are in the same menu, so the list is arranged where you are looking at it." },
      { kind: "table", headers: ["What you pinned", "What the row does"], rows: [
        ["A page", "Goes there. The line on the right names the section it lives in when that says something the label does not, because labels repeat across the application — there is more than one *Dashboard*, so it is worth knowing which one you pinned."],
        ["A whole section", "Opens that section's destinations, which is what clicking the section on the rail does — a section is a place with contents rather than a page. A section that holds exactly one page goes straight there instead, because a list of one is not a list."],
      ] },
      { kind: "note", text: "**It is the same Favorites list as the classic pane's.** One list, stored against your account, so pinning in one pane shows up in the other and follows you to another machine. Pinned rows also appear at the top of their own section's panel, so the pages you use are where you already are as well as where you keep them." },
      { kind: "h", text: "Keyboard" },
      { kind: "p", text: "These work while the pane has focus, so they never compete with the application's own shortcuts:" },
      { kind: "table", headers: ["Key", "What it does"], rows: [
        ["<span>1</span>–<span>9</span>", "Open that rail row, counting from the top — so **1** is Favorites, **2** is Home, **3** is Today, and so on."],
        ["<span>→</span>", "Open the domain you are on. Favorites is not a domain, so this never opens it."],
        ["<span>/</span>", "Focus the filter, while the panel is open. **Esc** clears it."],
        ["<span>Tab</span>", "Move along the rail. The rows are ordinary buttons, so the browser's own focus order applies and nothing here traps the keyboard."],
        ["<span>Esc</span>", "Close the panel — the filter first, then the panel itself."],
      ] },
      { kind: "h", text: "Going back to the classic tree" },
      { kind: "p", text: "Nothing about the modern pane is load-bearing, so the way back is one switch and takes effect immediately, without a sign-out and without moving any data:" },
      { kind: "table", headers: ["Where", "What it does"], rows: [
        ["**My Account → Appearance → Navigation**", "Switches the pane for **you**, in place and without a reload. Everyone is offered this, including somebody who has already chosen the classic tree — the control is there whenever the pane is available, so the choice is never a one-way door. The row beneath it, **Interface**, is a different switch: it chooses between the redesigned and classic **screens**, and the two are independent."],
        ["Administration → Configuration → Workspace → **Navigation pane**", "Switches the pane for **everyone**. *Rail and sections* is the default; *Single tree (classic)* restores the previous pane exactly."],
        ["The `c7_ui_nav` flag, for one browser", "`localStorage.setItem(\"c7_ui_nav\", \"0\"); location.reload()` on an instance that has adopted the rail, or `\"1\"` to try the rail on an instance that has not — it overrides the setting in either direction. The Interface switch above writes exactly this flag, so the two can never disagree."],
        ["`VITE_UI_NAV=false`", "A deployment-wide off, for a build that should not offer the pane at all. Beats the setting and is not a preference, so it is not offered in the menu."],
      ] },
      { kind: "note", text: "Your own choice is kept **in this browser**, like the theme and the density beside it in the menu — so it survives a reload on this machine and your account's default is whatever the instance says when you sign in somewhere else." },
      { kind: "note", text: "Both panes are generated from the same navigation tree, so a section added to the application is in both or in neither. The only way a destination can fail to appear is if the pane has not been told which domain it belongs to — and when that happens it appears under **Other** on the rail, on its own row, rather than going missing." },
    ],
    related: [
      { label: "Workspace, Shortcuts & Batch Actions", to: "/help/walkthroughs/shortcuts" },
      { label: "Configuration Reference", to: "/help/configuration" },
      { label: "Recent Activity & My Activity", to: "/help/walkthroughs/my-activity" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "interface", group: "walkthroughs",
    path: "/help/walkthroughs/interface",
    title: "The Interface",
    description: "The redesigned screens, the tab groups on a record, and how to go back to the classic layout.",
    blocks: [
      { kind: "p", text: "The application has two layouts. **Redesign** is the default: screens arranged around tabs and a compact single-row header, so a record shows more of itself before you scroll. **Classic** is the layout the application had before — unchanged, and one click away rather than gone. Both are the same application, with the same pages, routes, permissions and data, so switching changes how a screen is arranged and nothing about what it does." },
      { kind: "table", headers: ["", "Redesign (default)", "Classic"], rows: [
        ["The header of a record", "One row: where it sits, what it is called, the two states that matter, and **Edit**.", "A title row with the summary beneath it, and the actions beside it."],
        ["**Every** page's header", "One row: the page's name, what it is for, and its actions on the same line — on every page in the application, not only on a ticket.", "A title and its description above the actions, which take a row of their own."],
        ["The bar above every page", "The section's name and its description on **one** line — about **44px less chrome on every screen**, which is content you no longer scroll to reach. The trail is not repeated there: the rail already shows where you are, and the pages that have somewhere to go back to carry their own breadcrumb.", "A title row with the description beside it, then the trail on a line beneath."],
        ["The panels of a ticket", "**Five tabs** — Overview, Activity, Work, Files & Links and Finance — with the panels inside a tab as sub-tabs, one click away.", "All twelve panels as one strip."],
        ["The chrome around a panel", "Tabs, with the actions on the same line as them and the sub-tabs beneath — two rows, pinned as you scroll. A ticket's own panel starts about 70px higher.", "The twelve-tab strip, then the actions on their own row beneath it."],
        ["Choose it", "The default.", "Administration → Configuration → Workspace → **Interface** for everyone, or **My Account → Appearance → Interface** for just you."],
      ] },
      { kind: "h", text: "The ticket's tabs" },
      { kind: "p", text: "Twelve panels in a row is a strip you read rather than recognise. They are grouped by the question they answer, and every one of them is still here:" },
      { kind: "table", headers: ["Tab", "What is in it"], rows: [
        ["**Overview**", "The ticket itself: description, dates and times, notes and the people on it."],
        ["**Activity**", "Three depths of one story — the conversation and its notes, the field-by-field history, and the audit trail."],
        ["**Work**", "What the ticket has used and cost: time entries, expenses, products it was billed for, and any scheduled visit."],
        ["**Files & Links**", "Attachments, and the records this ticket is linked to."],
        ["**Finance**", "The billable side of the ticket, and the client's configurations."],
      ] },
      { kind: "note", text: "**A tab remembers which sub-tab you were on.** Come back to *Work* after looking at *Activity* and you are on Time rather than the first panel in the group. The tab strip and the icon row beneath it stay pinned as you scroll, and the icons themselves are unchanged." },
      { kind: "h", text: "What does not move" },
      { kind: "p", text: "Colour scheme, light/dark and density belong to neither layout and carry across the switch untouched; **My Account** holds all three in both. The navigation pane has its own separate switch — see *The Navigation Pane* — so the rail can be paired with classic screens, and the tree with redesigned ones." },
      { kind: "h", text: "Which pages" },
      { kind: "p", text: "Every standard page draws its header the redesigned way: Clients, Contacts, Assets, Tickets, Boards, Billing, Quotes, Reports, Custom Reports, the product catalog, Users, Roles, Kumo, Service Alerts, Monitors, the configuration hub, Assistant, AI Actions, What's New and the rest. **Sign-in is redesigned too**, in its own right rather than with a compact header — what it shows now is in *Identity, Sessions & Sign-in*. Two kinds of surface deliberately keep their own layout, because a compact header is not what they are for: **two-factor setup and help**, which are not part of the working interface, and the **console and the report designer**, which are full-bleed tools rather than pages." },
      { kind: "h", text: "The ticket screens" },
      { kind: "p", text: "The two screens a service desk lives in are built around what you do with them rather than around the database. The **list** puts its title and its controls on one row, offers **views** with live counts above the search box, and — because a queue is triaged by how long something has waited and whether the clock is still on your side — carries **Age** and **SLA** columns as part of the standard set. Tickets show a coloured priority bar in front of the summary, so priority is noticed rather than looked up." },
      { kind: "p", text: "The **detail** leads with the record: where it sits, what it is, and then **the states themselves as pills you press** — status, priority, assignee, the SLA clock, the source and the agreement. Changing one is a click, not a dialog with a form and a save; every pill writes through the same route the Edit form uses, and **Edit** is still there for everything at once. The SLA chip reads whichever clock the ticket carries — the board's SLA target, or the due date — and says so in its tooltip." },
      { kind: "p", text: "Three things sit beside the record rather than behind a tab, because they are what you read *while* working: the **CONTEXT rail** (the client with **its own brief**, its open tickets, service level and agreement; the contact with **Reply** and **Log a call**; and **Configurations** — what the client runs), the **client's other open work**, and the **composer**, where a note, a reply to the client and a time entry all start in the same place. Its tabs are Note, Reply to client and Log time, the note's internal-or-emailed choice sits beside them, and **Work type**, **Role**, **Hours** and **Billable** are on the composer itself — so **Save and log** records what you did and how long it took in one action." },
      { kind: "h", text: "The client screens" },
      { kind: "p", text: "**Clients** reads as a grid of cards rather than a table, because a client is a relationship and what you want about one rarely fits in columns: each card carries the name and where it is, what it is (city, type, service level), its state, then **Tickets**, **Contacts** and **MRR** — the monthly value of its active agreements, with weekly, quarterly, semi-annual and annual amounts normalised to a month and one-off amounts left out — then the primary contact and **the client brief** from the record's notes. Click a card to open the client; right-click for the same actions the table offered." },
      { kind: "p", text: "Columns still answer some questions better, so the **Cards / Table** switch beside the type filter turns the grid back into the six-column table, with the client's own search, type filter and sort order either way. The line beside the switch states the working set — how many clients you are looking at, and how much ticket work is open against them." },
      { kind: "p", text: "Opening a client gives the same record shape as a ticket: a single row carrying the client's key (`CLIENT-…`), where it is, and its name, then **New ticket**, **Copy brief** and **Edit**; a row of state — how many tickets it has ever raised, **MRR**, its service level, whether it is active, its industry and whether the console and portal are on; and the sections as a strip beneath. The sections are **Overview**, **Contacts**, **Configurations**, **Agreements**, **Tickets** and **Invoices**." },
      { kind: "p", text: "**Overview** reads as *The account* — the identity facts as label and value (client number, location, type, service level, agreement, recurring value, primary contact, industry, territory, region, currency, and when it joined) — beside **Brief**, **Recent work** and **At a glance**. Nothing there is a dead end: **Edit** turns the same rows into inputs and leaves every field reachable, and **Edit the brief** takes you straight to the one paragraph the next technician reads. **Configurations** lists the client's assets — tag, name, type, state, detail and warranty — and is read only when you open it, so a client you are only looking up costs one request." },
      { kind: "h", text: "Today" },
      { kind: "p", text: "**Today** — the dashboard, under the name the rest of the product already used for it — opens with four bands and then the widgets you arranged. The **figures** are one row of tiles — open tickets, waiting on the client, service alerts, overdue invoices, active clients and your own time this week — read by scanning the numbers rather than the labels." },
      { kind: "p", text: "**Needs a person** is the queue that is about to hurt: every ticket within four hours of the target it carries, or already past it, soonest first, with its client, its technician, its age and how much of the clock is left. **Board load** puts each board's open work on a bar, tinted when the board is carrying work nobody has touched for a week. **Service Alerts** is the loudest thing on the page whenever there is something to say: its header takes the colour of the worst alert, it states how many services are reporting a problem in words as well as in the count, and every row carries that severity as a stripe — so an outage is noticed while you are reading the numbers rather than after you have finished. With nothing wrong it goes quiet rather than shouting a zero. **What changed** is your own trail — the same list the header's Recent menu folds to five, pointing at the records it mentions." },
      { kind: "h", text: "How a list reads" },
      { kind: "p", text: "Every list answers the same three questions in the same order: **which slice of it you are looking at** gets its views with their counts — a strip above the table on most lists, a rail beside it on Contacts — because the count is what tells you whether a view is worth pressing; **what you have narrowed it to** is a search box and filters you can read as controls rather than a dialog you have to reopen; and **how much of it there is** is a line under the table — *1–50 of 109* — because a list you cannot count is a list you cannot trust. Where a list has figures worth stating, they join that line: **Assets** says *10 assets · 1 needs attention*, and **Clients** says *5 clients · 22 tickets*." },
      { kind: "p", text: "**Assets** is the shape the rest follow: **All**, **Needs attention**, **Warranty expiring** and **Retired** as views with counts, a warranty column that turns amber inside ninety days, an **Open** action on every row, and a footer stating the range and the sort. **Contacts** is the list that moves its choices out of the toolbar: the views — **All**, **Primary**, **Inactive**, **No email** — and the clients are a **rail** beside the list, each view with its count and a line saying what it holds, each client with its contact count, its ticket count and whether its portal is on, and the list's own header carries the count (**21 people · 5 clients · 5 primary**). Selecting a person opens a **sheet** rather than a panel that repeats the row, and the sheet does the work: what they have raised, whether they can sign in, and the four things you do from here. There is more of it in **Contacts & the Address Book**." },
      { kind: "table", headers: ["Where", "What it decides"], rows: [
        ["Administration → Configuration → Workspace → **Interface**", "Which layout this deployment offers. It applies to everyone and takes effect on the next screen, with no sign-out and nothing to migrate."],
        ["My Account → Appearance → **Interface**", "The same choice for one browser, in **either** direction — including back to the redesign on an instance that has been set to classic."],
        ["The `c7_ui_redesign` browser flag", "What that switch writes: `localStorage.setItem(\"c7_ui_redesign\", \"0\")` returns one browser to the classic screens, and `\"1\"` restores the redesign."],
        ["`VITE_UI_REDESIGN`", "A deployment-wide off for the redesigned screens. It beats the setting, and because it is not a preference it is not offered in the menu."],
      ] },
    ],
    related: [
      { label: "The Navigation Pane", to: "/help/walkthroughs/navigation" },
      { label: "Contacts & the Address Book", to: "/help/walkthroughs/contacts" },
      { label: "Service Boards (what each holds, and what it promises)", to: "/help/walkthroughs/service-boards" },
      { label: "Configuration Reference", to: "/help/configuration" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "contacts", group: "walkthroughs",
    path: "/help/walkthroughs/contacts",
    title: "Contacts & the Address Book",
    description: "Everyone at every client in one list: the rail that holds both choices, what a row carries, and the sheet that does the work.",
    blocks: [
      { kind: "p", text: "**Clients → Contacts** is the address book by client — every person at every client, and what they have raised rather than only how to reach them. The redesigned screen is three parts: a **rail** holding both choices the page is made of, a **list** of people, and a **sheet** for the person you selected." },
      { kind: "h", text: "The rail holds both choices" },
      { kind: "p", text: "The rail answers the two questions before the list is read. **Views** — **All**, **Primary**, **Inactive**, **No email** — carries the count in each and a line saying what the view holds, because **Primary 5** is a number and **one per client: Acme Corporation, Globex Industries…** is an answer; a view that holds nothing says so rather than offering a zero to be puzzled over. **Clients** lists every client with its own weight beside its name — how many contacts it has, how many tickets it has ever raised, and whether its portal is on — which is the question a list of five names cannot answer." },
      { kind: "p", text: "They are the same kind of choice, so one pair of controls narrows both: pick a view, pick a client, and the list is both at once. The list's header states the working set — **21 people · 5 clients · 5 primary** — and the footnote under the clients says what the two lists are for." },
      { kind: "h", text: "The list" },
      { kind: "p", text: "Every row is the person and their client, with the title, the address and the number, and — because a contact list that cannot say whether somebody is a customer is only a phone book — how many tickets they have **raised** and how many of those are **still open**. A person who has raised none says **never raised** rather than showing a zero." },
      { kind: "p", text: "The list is read by scanning and by key: the arrow keys move the selection and the sheet follows, Enter opens the sheet for the row under the cursor, and the row menu — ☰, or a right-click — keeps what the row cannot fit: Show details, Edit contact, Create ticket, Open client, View client's tickets, Filter by this company, Make primary, Deactivate, and Copy name/email/phone. The footer counts the page (**1–21 of 21**), states the figures behind it (**5 primary · 5 clients · 104 tickets between them**) and offers **Export as CSV** — the address book arrives in one read, so that footer counts rather than pages." },
      { kind: "h", text: "The sheet" },
      { kind: "p", text: "Selecting a person opens the sheet, which is what the row cannot say and what you do next. It opens on **their client and its weight**: how many people the client has, how many tickets it has raised, whether its portal is on, and who its primary contact is, with **Open the client** beneath. The sentence under those figures is the one a column of numbers cannot write for itself — how many of the client's people have no title on record, and how many have never raised a ticket." },
      { kind: "h", text: "What they have raised" },
      { kind: "p", text: "Four figures — **raised**, **still open**, **resolved**, and the number of **boards** they have raised on — then their newest tickets, newest first, each with its number, its board, its date and its status, and each one a link to the ticket. **Open** is not closed and not resolved, and **resolved** is the product's own finished pair, so the two numbers do not overlap. It is a way in rather than a second ticket list: the last line hands over the whole queue for their client — **Umbrella Corp's 18 tickets** — because the ticket list filters by client, not by person, and a sheet that promised one person's tickets would be promising something the queue cannot do." },
      { kind: "h", text: "Signing in to the portal" },
      { kind: "p", text: "Whether this person can sign in, in words, and the reason: their client's portal may be off, in which case nobody at that client has one; they may be refused on their own record; or they may simply follow the client. The line under it says what they would see — following the client's setting, or set on this person to only their own tickets, or to every ticket at the client." },
      { kind: "p", text: "Where you hold the permission the portal's settings need, the sheet carries the controls as well: **Refuse the portal to this person** refuses that person alone, holds whether or not the client's portal is on, and would still refuse them if the client's portal were switched on tomorrow. **What they would see** beside it overrules the client's own answer for one person — **Follows the client**, **Only their own tickets**, or **Every ticket at the client**." },
      { kind: "h", text: "The last contact" },
      { kind: "p", text: "The newest thing recorded against the person — here the newest ticket they raised, named and linking through — and the date their record was last changed. There is no per-person activity log in the product, so the sheet names the ticket rather than implying a call nobody logged; somebody who has never raised one says so." },
      { kind: "h", text: "What you do from here" },
      { kind: "p", text: "Four things, each beside the sentence that says what it does: **Raise a ticket**, which opens the new-ticket form with the client and this person already filled in — the contact, not just the client; **Send a mail** to their address, the same address a closing email goes to; **Call** their number; and the primary contact button, which reads **Primary** where they already hold it and **Make primary** where they do not, because a client's primary is only ever one person. Where the person is deactivated, that fourth answer is **Reactivate**." },
      { kind: "note", text: "**The classic interface keeps the screen it had** — the column of cards, with the search and the client list on one row above them, and the selected person's record in a card beside them. Both are the same address book: the same people, the same actions, and the same permission behind the portal switch." },
    ],
    related: [
      { label: "Customer Portal", to: "/help/walkthroughs/customer-portal" },
      { label: "Clients", to: "/clients" },
      { label: "Contacts", to: "/clients/contacts" },
      { label: "Tickets", to: "/tickets" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "service-boards", group: "walkthroughs",
    path: "/help/walkthroughs/service-boards",
    title: "Service Boards (what each holds, and what it promises)",
    description: "The rail of boards, the board's own page, and the promise each one is judged against.",
    blocks: [
      { kind: "p", text: "**Service Boards** (`/boards`) is what each board is holding and what it promises. It is not where a board is configured — that is **Administration → Service Boards** — it is the page that states the answers and hands you over to change them, so nobody has to remember which screen knows them." },
      { kind: "h", text: "The rail of boards" },
      { kind: "p", text: "Each board in the rail is a thing you press, and it carries three things: how much is open on it, how many tickets it has ever raised (**INF · 32 of 33 raised**), and **what the board does when a ticket on it closes, in words** — **emails the client on close**, or, on the board whose tickets arrive from monitoring systems, **closes without emailing the client**. That last line is the point: the policy that decides how a close behaves is stated on the board it belongs to rather than left in a dialog to be found at the moment somebody closes a ticket. Under the rail is the sum of the whole list — **98 open across 4 boards · 104 raised in all** — with the reason it is written there." },
      { kind: "h", text: "The board's own page" },
      { kind: "p", text: "Selecting a board gives it the page the rail has no room for: what it is for, the code its ticket numbers carry, when the figures were last read (the page refreshes itself every 15 seconds), and **Edit this board** beside them." },
      { kind: "p", text: "**What is on it** states the board's weight in three lines — how much is open out of everything ever raised, how much has gone untouched for more than three days, and how many critical tickets are open — and then the six figures the board is read by: **New** (nobody has picked up), **Workable**, **On hold**, **Waiting** (on the client or a third party), **Escalated**, and **Average age**. Each one is a way into the tickets it counts, and the line above them says whether anybody has arranged them yet." },
      { kind: "h", text: "Average age, against the promise" },
      { kind: "p", text: "The average age of the tickets open here is set beside the resolution the board promises, in one sentence: **the tickets open here average 54 days old, against a board that promises a resolution in 24 hours**. Both figures come from the same read, because printing only the promise is how a page flatters a board." },
      { kind: "h", text: "What this board promises, in the order it happens" },
      { kind: "p", text: "The policy as four steps a person can read: **First response** — the clock starts when the ticket is raised, and this is how long the board says it will be before somebody picks it up; **Resolved** — a resolution does not close the ticket, because it waits for the client's word and stays open on this page until that word arrives; **Follow-up mail** — how often a waiting ticket is chased rather than piling up unremarked; and **Closed by itself** — how long without a reply before it settles, and whether the client is emailed as it closes." },
      { kind: "h", text: "How a ticket on this board ends" },
      { kind: "p", text: "The closing policy in one sentence — **MSP Service Desk emails the client when a ticket on it closes** — and then the two answers it stands for, **Close silently** and **Email the client**, with the line under each saying what it does. It is the answer the close dialog starts from, so nobody has to remember it at the moment they close something, and the choices are shown here rather than left implied for the same reason." },
      { kind: "h", text: "What each board does" },
      { kind: "p", text: "One table with every board in it — what it responds in, what it resolves in, when it auto-closes, how often it follows up, and whether closing it emails the client — so a board can be read against its neighbours without opening four pages. Nothing is averaged: the differences are the point." },
      { kind: "h", text: "Editing a board" },
      { kind: "steps", items: [
        "**Edit this board** opens that board on **Administration → Service Boards** — the deep link carries the board with it — so the page that states a policy is one click from the place it is changed.",
        "**Open Service Boards settings** at the foot goes to the same screen with no board chosen, for the times you want the whole list.",
        "The SLA minutes, the ticket code, auto-close days, the follow-up interval and the closing policy are edited there, one board at a time.",
        "A board is **made** with two fields and one decision — what it is called, what it is for, and whether closing one of its tickets emails the client. Everything else is a later decision, made by editing the board rather than from the form that creates it.",
      ] },
      { kind: "note", text: "**The classic interface keeps the screen it had** — one card per board, each carrying the same six tiles. The same figures, and the same hand-over to the settings screen; the rail and the board's own page are the redesign's arrangement of them." },
    ],
    related: [
      { label: "Administration: Service Boards", to: "/admin/boards" },
      { label: "Workspace, Shortcuts & Batch Actions", to: "/help/walkthroughs/shortcuts" },
      { label: "Email-to-Ticket Setup", to: "/help/walkthroughs/email-tickets" },
      { label: "Tickets", to: "/tickets" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "product-catalog", group: "walkthroughs",
    path: "/help/walkthroughs/product-catalog",
    title: "Product Catalog (hardware, software, licences, services)",
    description: "One entry per thing you sell or reorder, so four surfaces price from the same numbers.",
    blocks: [
      { kind: "h", text: "Add an item" },
      { kind: "steps", items: [
        "Open Administration → Product Catalog.",
        "Select **New item** and pick the type: hardware, software, licence, subscription, service or bundle.",
        "Give it a name and an SKU, then set the prices and, if you stock it, the stock levels.",
        "Save. The item is immediately available to every surface that prices from the catalog.",
      ] },
      { kind: "h", text: "What an item holds" },
      { kind: "table", headers: ["Group", "Fields"], rows: [
        ["Identity", "Type, category, subcategory, manufacturer, name, description, SKU"],
        ["Commercial", "Unit, cost price, sell price, recurring billing period, taxable"],
        ["Stock", "Stocked, quantity on hand, reorder point, reorder quantity"],
        ["Supply", "Supplier, supplier part number, purchase link, warranty in months"],
        ["Notes", "Internal notes, kept out of anything a customer sees"],
      ] },
      { kind: "h", text: "Cost, sell price and margin" },
      { kind: "p", text: "Cost and margin are **commercial data**: they are returned only to accounts that hold the catalog's manage permission. A technician attaching an item to a ticket sees the sell price and not what it cost — which is deliberate, not a gap, and it is enforced on the server rather than by hiding a column. The list also shows a recurring price's annualised value, so a per-month figure is comparable with a one-off." },
      { kind: "h", text: "Stock & reordering" },
      { kind: "steps", items: [
        "Tick **Stocked** and set on hand, reorder point and reorder quantity.",
        "Use **stock in** and **stock out** as parts arrive and are used. Each write is recorded with who made it and when.",
        "Filter by **Low stock only** to see everything at or below its reorder point.",
      ] },
      { kind: "note", text: "Stock is a counter plus the audit trail rather than a per-warehouse ledger — it answers \"do we have any left\", not \"which shelf\"." },
      { kind: "h", text: "Where the catalog is used" },
      { kind: "table", headers: ["Surface", "Which price it takes"], rows: [
        ["Quotes", "Sell price — a quote line searches the catalog as you type"],
        ["Tickets", "Sell price — an item attached to a ticket"],
        ["Procurement / purchase orders", "Cost price"],
        ["Invoices", "Sell price, copied when the line is created"],
      ] },
      { kind: "p", text: "Search any of those pickers by name or SKU. Choosing a catalog item copies its description and price into the line, so the numbers are typed once." },
      { kind: "h", text: "Retiring an item" },
      { kind: "p", text: "A product that has been quoted, ordered or billed is **retired** rather than deleted — deleting it would leave an order or an invoice pointing at an SKU that no longer exists, so the delete is refused and says which record holds it. A retired item disappears from the pickers but every existing record keeps its numbers. Use **Retire from the catalog** and **Put back in the catalog** to move an item in and out." },
    ],
    related: [
      { label: "Quotes & Convert to Invoice", to: "/help/walkthroughs/quotes-invoices" },
      { label: "Expenses & Accounting Sync", to: "/help/walkthroughs/expenses" },
      { label: "Help Index", to: "/help/index" },
      { label: "Product Catalog", to: "/admin/products" },
    ],
  },
  {
    id: "reporting", group: "walkthroughs",
    path: "/help/walkthroughs/reporting",
    title: "Reporting & Business Reviews",
    description: "The dashboard, the standard reports, the business review packs, and analytics.",
    blocks: [
      { kind: "h", text: "The five reporting areas" },
      { kind: "table", headers: ["Area", "What it is"], rows: [
        ["Dashboards", "The at-a-glance reporting home: the numbers a desk looks at first."],
        ["Standard Reports", "The reports built into the product — tickets, SLA, time, commercials, receivables, client value and Microsoft 365 account hygiene — each with its own filters."],
        ["Business Reviews", "One review pack at three cadences — weekly, monthly and quarterly."],
        ["Custom Reports", "Designed reports you build yourself (see Designing a Report)."],
        ["Analytics", "Ad-hoc analysis over the same data."],
      ] },
      { kind: "h", text: "Standard Reports" },
      { kind: "table", headers: ["Report", "Answers"], rows: [
        ["Ticket Volume", "How much is coming in, by status, priority, board and technician, over time"],
        ["SLA Performance", "Are we meeting the promises, and where are the misses"],
        ["Technician Productivity", "Hours, utilisation and throughput per person"],
        ["Revenue", "What has been billed and what is outstanding"],
        ["Aging Report", "Receivables by age band, with each client's oldest debt and the largest unpaid invoices. **Ticket Aging** is the other one — that ages tickets, not money."],
        ["Tax Summary", "Tax collected by rate, jurisdiction and client, and where the figures disagree with themselves"],
        ["Billing Forecast", "What the agreements and recurring invoices already in place will bill, month by month, and the assumptions it rests on"],
        ["Ticket Aging", "What has been open too long, by age band"],
        ["Time Tracking", "Where the hours actually went"],
        ["Client Satisfaction", "Survey responses and trends, from the responses that exist"],
        ["Contract Profitability", "Revenue against labour cost, approved expenses and catalogue cost"],
        ["Client Value", "What each client is worth, and what they cost to serve"],
        ["Inactive Microsoft 365 Accounts", "Which synced accounts nobody signs in to, per client and per tenant, with your own threshold and the option to include or exclude disabled and unknown accounts"],
      ] },
      { kind: "h", text: "Reading a report" },
      { kind: "steps", items: [
        "Set the period and any client or board filter at the top; the report re-runs when you change them.",
        "Some reports bring questions of their own — how long counts as inactive, what to include — and they sit in the same bar, next to the client, and are applied to the screen, the print-out and the export alike.",
        "Read the tiles first — they carry the headline figures and their direction of travel.",
        "Charts and tables underneath break the tiles down.",
        "Select **Print**, **PDF**, **Excel** or **CSV** to take it away.",
      ] },
      { kind: "note", text: "Where a figure genuinely cannot be known, the report **says so and tells you why** rather than estimating it — for example how many delivered hours carry no cost rate, so a margin that reads well can be seen to be incomplete." },
      { kind: "h", text: "The same reports, reached from Billing" },
      { kind: "p", text: "**Billing → Reports** lists six of these by the question a biller asks — Revenue, Aging Report, Tax Summary, Billing Forecast, Contract Profitability and Technician Productivity — and opening one runs it **in place**, with the same filters, the same **Print** and the same **Export** as Reporting → Standard Reports. It is the same report, not a second copy of the figures, so a number cannot be right in one place and stale in the other. Three of the six are billing's own and are worth knowing:" },
      { kind: "steps", items: [
        "**Aging Report** — money owed, by age band, measured from each invoice's own due date; the largest unpaid invoices are listed underneath so the total has names against it.",
        "**Tax Summary** — what was collected, by rate, jurisdiction and client, plus the questions the figures cannot answer: invoices with no rate, a missing jurisdiction, a subtotal that does not match its rate. Drafts are excluded, and it says how much that excluded.",
        "**Billing Forecast** — what the agreements and recurring invoices already in place will bill, month by month, with what expires inside the horizon and the assumptions the projection rests on.",
      ] },
      { kind: "h", text: "Business Reviews (weekly, monthly, quarterly)" },
      { kind: "p", text: "A business review is a **pack** rather than a table: service delivery, targets, commercials, the estate and risk — the same sections at all three cadences, only the window changes. It opens on the last **finished** period, so a review is never mid-flight." },
      { kind: "steps", items: [
        "Open Reporting → Business Reviews and choose the cadence: Weekly, Monthly or Quarterly.",
        "Pick the period from the list, which the report itself supplies — so the picker and the pack always agree on which periods exist.",
        "Compare like for like: a period still in progress is measured against the same number of days of its predecessor, not against the whole previous period.",
        "Follow the quick links at the bottom for the quarterly and weekly views directly.",
      ] },
      { kind: "tip", text: "The **Quarterly Business Review** is the customer-facing pack: hand it to a client as the record of what changed, what it cost and what is at risk." },
      { kind: "h", text: "Filters and the period" },
      { kind: "p", text: "Every report takes a date range, a client and a board, and tells you the period it actually applied — so \"All time\" and a named range are never confused. A client-scoped account's reports are narrowed to its own client automatically and cannot be widened by a filter." },
    ],
    related: [
      { label: "Designing a Report", to: "/help/walkthroughs/custom-reports" },
      { label: "Help Index", to: "/help/index" },
      { label: "Dashboards", to: "/reports" },
      { label: "Standard Reports", to: "/reports/standard" },
      { label: "Business Reviews", to: "/reports/reviews" },
    ],
  },
  {
    id: "customer-portal", group: "walkthroughs",
    path: "/help/walkthroughs/customer-portal",
    title: "Customer Portal",
    description: "Give each customer the access they need, and see exactly what they will see before they do.",
    blocks: [
      { kind: "p", text: "The screen is split into three tabs — **Portal settings**, **Client access** and **Recent portal sessions** — so the long list of settings is not in the way of the client table, or the table in the way of the sign-in history. The tab you are on is in the address (`?tab=access`), so a link can point at one of them and reopening the page comes back to the same one." },
      { kind: "h", text: "Turn the portal on" },
      { kind: "steps", items: [
        "Open **Administration → Customer Portal** and switch on **Customer portal enabled**.",
        "The **Portal** card at the top of that screen shows the address to give your customers, with a copy button beside it, and says underneath where that address came from.",
        "Unless you say otherwise it is this application's own web address, so it is the same link whoever is looking at the screen. If customers reach the portal on a hostname of its own, set **Portal address** in the settings below — for example `https://portal.example.com` — and that becomes the address the card shows, the copy button hands over, and the sign-in email quotes.",
        "Outbound email must be configured, because sign-in is an emailed code — the screen reports whether a relay answers.",
        "Choose the board portal-raised tickets land on. Unset means the oldest active service board.",
      ] },
      { kind: "warn", text: "Off is genuinely off: every portal route answers 404, so a deployment that has not switched it on does not advertise a customer sign-in page at all." },
      { kind: "h", text: "Grant a client access" },
      { kind: "steps", items: [
        "Either switch **Portal access** on in the **Client access** tab on the same screen, or open the client under Clients and use its own Portal access toggle — the client record stays authoritative.",
        "That client's contacts can now use the portal. A contact of a client without it cannot, whatever email address they use.",
        "Optionally give one client its own accent colour or logo; both override the instance defaults.",
      ] },
      { kind: "h", text: "Portal policy" },
      { kind: "p", text: "These settings are the deployment's answer, and apply to every customer that has not been given an answer of its own. Three levels decide them, each one overruling the last: **the person**, **the client**, then **the deployment**. A level only counts where somebody actually set something, so most clients carry no values at all and follow the deployment." },
      { kind: "table", headers: ["Setting", "What it decides"], rows: [
        ["Ticket visibility", "**Only their own tickets** (default) or **every ticket at their client**. The default is deliberately narrow: a client with three hundred employees should not have each of them reading the others' tickets."],
        ["Customers may raise tickets", "Whether the new-ticket form is offered and accepted"],
        ["Customers may reply", "Whether a customer can add a public note. Internal notes never cross into the portal either way."],
        ["Board for portal-raised tickets", "Where a ticket raised in the portal lands. Unset means the oldest active service board."],
        ["Sign-in code lifetime", "How long an emailed code stays usable"],
        ["Sign-in attempts per code", "Wrong guesses allowed before the code is burned"],
        ["Codes per customer per window", "The ceiling that stops the portal being used as a mail relay"],
        ["Portal session lifetime", "How long a customer stays signed in before asking for a new code"],
        ["Signed-in devices per customer", "How many browsers one customer may hold at once; the oldest is retired first"],
        ["Accent colour, logo, welcome message, support address", "How the portal looks, and where a customer who cannot sign in is pointed"],
        ["Portal address", "Where customers are told to go, for a deployment that serves the portal on a hostname of its own. Blank means this application's own address."],
      ] },
      { kind: "h", text: "Give one customer a different level of access" },
      { kind: "steps", items: [
        "Open **Administration → Customer Portal** and find the client in the **Client access** tab. The **What they see** column shows what that customer currently gets, and whether it is the deployment's answer or their own.",
        "Select **Portal access** to open the client's policy. Every control offers the deployment's answer first, so leaving one alone means it keeps following the deployment if that is later changed.",
        "**Which tickets they see** — their own, or every ticket at that client. This is the setting that matters most: it decides the list and the ticket detail together, and a narrower scope is applied on the server, not in the page.",
        "**Raising tickets** and **Replying to tickets** can each be allowed or refused for that client alone — the client who should go through the phone, and the one who should not.",
        "**Where their tickets land** routes only that client's portal tickets to another board, which is how a client whose work belongs to a different queue is handled.",
        "Each change saves as it is made and the row updates to show the new answer and where it now comes from.",
      ] },
      { kind: "h", text: "Overrule one person" },
      { kind: "p", text: "Portal visitors are **contacts, not user accounts**, so there is no role to attach this to: what a customer sees is decided by the policy above, and by a per-person overrule for the people who differ from their colleagues." },
      { kind: "steps", items: [
        "The **People at this client** list in the same dialog names each contact with what they currently get.",
        "**May use the portal** — *Follows the client*, *Allowed*, or *No portal*. The contractor or former employee who should not have a login, without switching the whole client off.",
        "**Which tickets they see** — the office manager who runs the account can be given the client's whole ticket list while their colleagues see only their own.",
      ] },
      { kind: "h", text: "See it before the customer does" },
      { kind: "p", text: "**Preview** in the Client access table — or **Preview what they see** in the policy dialog — opens the portal as that customer, with nothing switched on behind it." },
      { kind: "steps", items: [
        "Choose which contact to be: the list says what each of them would get, including the people with no portal access at all.",
        "**Sign-in page** is what their first visit looks like, wearing the client's colour and logo when they have them. The button is simulated — no code is sent — and pressing it carries on into the portal.",
        "**The portal** is the ticket list the portal's own scoping query returns for that person, filtered by status. The buttons that are not there are not there because the policy in force would refuse them.",
        "Open a ticket to see its public conversation. Internal notes never appear, and a ticket outside their scope answers exactly as it would to them: as if it did not exist.",
        "**What decided this** names the level behind each answer — this person, this client, the deployment, or the default — and how many tickets at the client the current visibility is holding back.",
      ] },
      { kind: "note", text: "The preview changes nothing: no session is created, no sign-in code is sent, and a \"reply\" or a \"new ticket\" inside it is marked as not saved and never written. Tickets shown in it are real, and read-only." },
      { kind: "h", text: "How a customer signs in" },
      { kind: "steps", items: [
        "A customer visits `/portal` and enters their email address.",
        "**We email a six-digit code.** It works once, and expires after the configured lifetime.",
        "Entering it signs them in. There is no password for a customer to choose, forget or reuse.",
      ] },
      { kind: "note", text: "An email address that is not a contact of a portal-enabled client is refused in the same way as one that is — the reply does not reveal whether the address exists." },
      { kind: "h", text: "What a customer can see" },
      { kind: "table", headers: ["They can", "They cannot"], rows: [
        ["See the tickets belonging to their own company", "See any other client's tickets, or that other clients exist"],
        ["Raise a new ticket and read the replies on their own", "See internal notes — those are never sent to a portal"],
        ["Follow a ticket's status and history", "Browse the catalog, billing, Kumo, reports or any staff area"],
      ] },
      { kind: "h", text: "Why they can only see their own" },
      { kind: "p", text: "The restriction is applied on the server from the signed-in contact's company, after anything the request asked for — so it cannot be widened by a URL, a query parameter or a crafted request. A ticket that is not theirs answers **404 rather than 403**, because whether a ticket exists is itself information a customer should not be given." },
      { kind: "p", text: "**Recent portal sessions**, on its own tab, lists the last 25 sign-ins with the customer, their client, when they started, when they were last active and which are still live — which is how you answer \"is anyone actually using this?\"" },
    ],
    related: [
      { label: "Configuration", to: "/help/configuration" },
      { label: "Configuration Walkthrough", to: "/help/walkthroughs/configuration" },
      { label: "Email-to-Ticket Setup", to: "/help/walkthroughs/email-tickets" },
      { label: "Contacts & the Address Book", to: "/help/walkthroughs/contacts" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "configuration", group: "walkthroughs",
    path: "/help/walkthroughs/configuration",
    title: "Configuration",
    description: "Every setting the application reads, where its value comes from, and how to change one.",
    blocks: [
      { kind: "figure", src: "/help/settings-hub.png", alt: "The Configuration hub: a search over every setting, tiles counting areas and settings, and one card per area", caption: "**The settings hub.** The search covers every setting by name, the tiles say how many areas your role can read and how many settings you can change, and each card is one area with its count and its badges — **restart required**, or **unmet requirement**. **Administration → Configuration** is the whole of it." },
      { kind: "p", text: "**Administration → Configuration** is the one screen for application settings. Its areas are generated from the same declaration the server enforces, so a field can only appear if something reads it — the reason the older screens, on which most controls did nothing, are gone." },
      { kind: "h", text: "How a value is decided" },
      { kind: "p", text: "In this order: **a saved setting, then the deployment's environment variable, then the documented default.** A deployment configured the old way therefore keeps behaving exactly as it did, and a saved value always wins over the variable." },
      { kind: "h", text: "The eight areas" },
      { kind: "table", headers: ["Area", "What it governs"], rows: [
        ["Workspace", "The instance's name (what a customer sees on the portal), the default landing page, and the interface options that apply to everyone"],
        ["Sessions & Security", "Idle timeout, the session ceiling, whether administrators are exempt, and which sign-in methods this deployment offers"],
        ["Customer Portal", "The whole customer portal — see the Customer Portal walkthrough"],
        ["Service Alerts & Monitoring", "Uptime monitors, alert webhooks, the social source, the poll interval and the stale ceiling"],
        ["Knowledge Base & AI", "Drafting articles from resolved tickets, the model used for drafting, and AI action proposals"],
        ["C7NC & Email", "Connector verification and its throttle, the mail connectors, Graph delivery and M365 offboarding"],
        ["Billing & Invoicing", "Bill-through batches, the time rules and their defaults, quotes, and generate-from-tickets"],
        ["Client Apps & Notifications", "The Outlook add-in, and push notification devices"],
      ] },
      { kind: "h", text: "Change a setting" },
      { kind: "steps", items: [
        "Open the area from the hub.",
        "Change the control. **There is no Save button** — a switch applies on click, and a text, number or colour field applies when you leave it or press Enter.",
        "The field shows its **Default when nothing is saved**, so you can always see what the deployment intended.",
        "If a value is overriding the deployment's own, the field says so and offers **Use the deployment's value** to let it go.",
      ] },
      { kind: "note", text: "The save is validated on the server, so a value outside the permitted range — a 900-minute idle timeout, a colour that is not hex, a clock time that cannot exist — is refused with the reason rather than stored." },
      { kind: "h", text: "What belongs to the deployment" },
      { kind: "p", text: "Some values are real and relevant but are not editable from a browser session: an outbound credential, a database connection string, or a switch that decides whether authentication is enforced at all. They appear under **Set by the deployment**, with the environment variable that owns them, so they can be confirmed rather than guessed at. Secrets are never returned, so the screen can say a variable is set without ever showing its value." },
      { kind: "h", text: "Administering other people's settings" },
      { kind: "table", headers: ["Where", "What it does"], rows: [
        ["My Account → Settings", "Your **own** landing page. Personal: it does not affect anyone else. The instance default is under Workspace."],
        ["My Account → Settings → Session Timeout", "Shown read-only unless you hold the configuration permission; it applies to the whole organisation, so administrators change it in Sessions & Security."],
        ["Administration → System Settings", "The instance's operational state — the self-healing poller, its recovery history, the mail relay, the database and where the Outlook add-in is served from — and a signpost to every setting. There is nothing to save there."],
      ] },
      { kind: "h", text: "Restart-required settings" },
      { kind: "p", text: "A field marked **Needs a restart** is sampled once by the long-running service that uses it. Two are: the alert poll interval and the give-up-on-an-unreadable-alert ceiling. Everything else applies to the next action that reads it." },
      { kind: "h", text: "If a value will not save" },
      { kind: "steps", items: [
        "Check the message in the toast: it names the field and the rule it broke.",
        "Sessions and Billing settings need their managing permission as well as the configuration one.",
        "If the page says the saved settings have not been read yet, the API is still starting — the screen is showing the deployment's own values and resolves itself within half a minute.",
      ] },
    ],
    related: [
      { label: "Configuration Reference", to: "/help/configuration" },
      { label: "Customer Portal", to: "/help/walkthroughs/customer-portal" },
      { label: "Identity, Sessions & Sign-in", to: "/help/walkthroughs/identity-security" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "console-shell",
    group: "walkthroughs",
    path: "/help/walkthroughs/console-shell",
    title: "Console & the Command Line",
    description: "Run commands against this instance from the header console, the /console page, or the c7ntax CLI.",
    blocks: [
      { kind: "p", text: "The console is one command surface in three frames: a **pop-up** from the header, a **page** at `/console` that can be linked to, and the **`c7ntax` CLI** for a terminal or a script. All three run the same catalogue with the same permissions, so a command learned in one works in the others." },
      { kind: "h", text: "Open it" },
      { kind: "table", headers: ["Way in", "What it is for"], rows: [
        ["**Console** in the header toolbar (left of Search), or **Ctrl/⌘ .**", "The quick look: run something without leaving the screen you are on. **Esc** closes it."],
        ["`/console`, or **Open as page** inside the pop-up", "The same console with a URL. A link like `/console?c=ticket+list+--status+new` opens with that command already run, which is how a command becomes something a colleague can click."],
        ["`c7ntax` in a terminal", "Scripting, a runbook, or a machine with no browser session. It authenticates with an API key rather than a cookie."],
      ] },
      { kind: "h", text: "Running a command" },
      { kind: "p", text: "A command reads like a sentence: a noun, a verb, then flags — `ticket list --status new --limit 10`, `client show northwind`, `report run ticket-volume`. Type `help` for the ones your account may use, or `help <noun>` for one area." },
      { kind: "steps", items: [
        "Type the command and press Enter. The output is drawn as a table, a record or a note rather than raw JSON.",
        "Press **Tab** to complete the word you are on, and **Tab** again to cycle the possibilities. **Ctrl+Space** lists every candidate where the cursor is.",
        "Press **↑** and **↓** to walk what you have already run, and **Ctrl+R** to search that history.",
        "Press **Ctrl+L** to clear the screen without losing the history.",
        "A command that fails says why and, when the reason is a permission, names the permission — a typo and a refusal are different answers.",
      ] },
      { kind: "h", text: "Reading the output" },
      { kind: "p", text: "A **list** is a table, with the columns the command declares. A **single record** is a labelled list rather than a column dump: the fields the command names come first, spelled the way you would say them (`companyType` is *Company type*), timestamps read as dates, and yes/no answers are answered. Every other field the route returned is one click down under **n other fields**, with the count of the empty ones beside it — so nothing is hidden, and nothing that holds nothing is in your way. A field with no value prints as `—`." },
      { kind: "note", text: "**A column that holds nothing in any row is not shown**, and the footer says how many were left out. Some routes return fields the console's own description does not name, and three em dashes across every row is noise rather than information. `--json` still prints the route's response verbatim, which is the way to see everything exactly as the API sent it." },
      { kind: "p", text: "**Basic and Advanced, in the console's header.** *Basic* is everything described above — labelled fields, columns that carry nothing left out. *Advanced* is the console as it printed before it learned any of that: the route's own field names in the route's own order, one per line, every declared column whatever it holds, raw timestamps and `true`/`false` rather than a date and an answer. Neither is more correct: basic is for reading a result, advanced is for reading the *route* — and it is the one to reach for when you suspect the console is hiding something from you, because it hides nothing. The choice is remembered for this browser, applies to the whole scrollback (switching redraws what is already on screen, so you can compare the two readings of one result), and does not change what a command does or what the API returns." },
      { kind: "tip", text: "**The pop-up can be resized.** Drag its right edge, its bottom edge or the bottom-right corner; the size is remembered for this browser, so it opens the way you left it. **Double-click the corner** for the default size, or focus it and use the **arrow keys** (hold **Shift** for bigger steps) if you would rather not use a mouse. The `/console` page fills its column instead — it is a page, not a window." },
      { kind: "tip", text: "On the page, the last command you ran is in the URL, so your browser history is a list of commands rather than a list of pages. **Copy link** puts the current one on your clipboard." },
      { kind: "h", text: "Who may use it" },
      { kind: "p", text: "**Three switches, and all three have to be open.** Nothing is offered and then refused: a person without the permission is not shown a greyed-out button." },
      { kind: "table", headers: ["Where", "What it decides"], rows: [
        ["Administration → Configuration → Workspace → **Command console**", "Whether this deployment offers the console at all. Off, the button is gone, the catalogue answers 404 and the CLI cannot run a command."],
        ["Administration → Users & Roles → Permissions → **Console**", "Whether one person may use it. Uncheck the row to withdraw `console:use` from that person; the role's own default is edited on the role."],
        ["Administration → Clients → open the client → **Console**", "Whether one client's people may use it, leaving staff outside that client untouched. Tick **Disable the console for every member of this client**; it needs `system:config`."],
      ] },
      { kind: "note", text: "Withdrawing it takes effect on the **next request** — no sign-out, no restart, and no waiting for a session to expire. The client's switch is applied where permissions are computed rather than re-checked by each screen, so a client with the console off looks exactly like a person who was never granted it." },
      { kind: "p", text: "A person who reaches `/console` without the permission sees an explanation rather than an empty console — a pasted link outlives the permission that made it, which is the ordinary way someone arrives at a surface they may not use." },
      { kind: "h", text: "What can be run" },
      { kind: "p", text: "The catalogue is grouped by area — tickets, clients, time, billing, reports, integrations, administration and the console's own verbs — and the page shows the whole list under **What is available**, so you can read it without typing anything." },
      { kind: "p", text: "**Writes are not built yet.** Every command reads today. Write commands arrive with PLAN-026's action manifest, and each one appears in the same catalogue carrying the permission it needs; there is no separate write surface to secure." },
      { kind: "warn", text: "The console adds no route of its own to the write surface: it runs the same operations the screens do, with the same permissions. A command somebody may not run is refused by the API, not merely hidden by the interface." },
      { kind: "h", text: "The c7ntax CLI" },
      { kind: "steps", items: [
        "Issue a key under Administration → API Access with the scopes you want the CLI to have. The key can never do more than the account it belongs to.",
        "Register it once: `c7ntax login --server https://psa.example.com --key c7k_…`. The profile is stored per user, so `C7NTAX_SERVER` and `C7NTAX_KEY` in the environment are an alternative.",
        "Check what the CLI is pointed at with `c7ntax context`, and read the catalogue with `c7ntax help`.",
        "Run commands exactly as they are typed in the console: `c7ntax ticket list --status new`.",
        "Shell completion is generated from the same engine, so `c7ntax ticket l` completes in Bash, Zsh, Fish and PowerShell.",
      ] },
      { kind: "note", text: "Revoke the key on Administration → API Access and the CLI stops working immediately — the same rotation and revocation as any other integration, and both are in the audit log." },
    ],
    related: [
      { label: "Configuration Reference", to: "/help/configuration" },
      { label: "API Access & the Event Gateway", to: "/help/walkthroughs/api-access" },
      { label: "Identity, Sessions & Sign-in", to: "/help/walkthroughs/identity-security" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "expenses", group: "walkthroughs",
    path: "/help/walkthroughs/expenses",
    title: "Expenses & Accounting Sync",
    description: "File an out-of-pocket cost against a ticket, approve it, and push it to accounting.",
    blocks: [
      { kind: "h", text: "File an expense" },
      { kind: "p", text: "The technician who spent the money files it, against the ticket it belongs to — which is what makes the cost traceable to the work rather than to a monthly total nobody can explain." },
      { kind: "steps", items: [
        "Open the ticket and go to its **Expenses** tab.",
        "Select the add button and fill in the description, amount, category, vendor, miles (if you drove) and the date.",
        "Save. The toast says the expense was **submitted for approval** — filing one never approves it.",
      ] },
      { kind: "h", text: "Approve or reject" },
      { kind: "steps", items: [
        "Someone holding the billing-manage permission reviews the pending expense.",
        "**Approve** records who approved it and when.",
        "**Reject** requires a reason — the product refuses a rejection with no explanation, because \"no\" without a why is not something a technician can act on.",
        "A technician can still edit their own expense until it has been decided.",
      ] },
      { kind: "h", text: "How an expense reaches an invoice" },
      { kind: "steps", items: [
        "Open Billing → Time & Expenses to see every expense, filterable, with the ticket each one came from and a CSV export.",
        "Approved expenses are picked up by bill-through invoicing: the batch preview counts them before anything is created.",
        "The invoice records which tickets — and therefore which expenses — it came from.",
      ] },
      { kind: "h", text: "Push to accounting" },
      { kind: "p", text: "An approved expense can be pushed to the connected accounting system, which is the QuickBooks connector under C7NC. The push is refused unless the expense is approved first, so nothing reaches the ledger that nobody has signed off." },
    ],
    related: [
      { label: "Billing, Agreements & Overtime", to: "/help/walkthroughs/billing-agreements" },
      { label: "Product Catalog", to: "/help/walkthroughs/product-catalog" },
      { label: "Help Index", to: "/help/index" },
      { label: "Time & Expenses", to: "/billing/time" },
    ],
  },
  {
    id: "procurement", group: "walkthroughs",
    path: "/help/walkthroughs/procurement",
    title: "Procurement & Purchase Orders",
    description: "Raise a purchase order, follow it to the door, and keep the vendor's details correct.",
    blocks: [
      { kind: "h", text: "The list" },
      { kind: "p", text: "Procurement is the queue of orders you have raised. The views across the top are the four states — **draft**, **ordered**, **shipped**, **received** — with a count each, and the figure in the header is what is **outstanding**: everything ordered and not yet received. That is the number a buyer is tracking, so it is the one at the top rather than the total spend." },
      { kind: "h", text: "Opening an order" },
      { kind: "steps", items: [
        "**Click any row** (or put the cursor on it and press **Enter**) to open the order. A row is a door rather than a label: the Actions column keeps its own one-click **Receive**, and clicks there do not open the order.",
        "The detail shows what was ordered — each line with its catalog SKU where it came from the catalog — the totals, the vendor's own details, who raised it and who approved it, and the four dates: created, ordered, expected, received.",
      ] },
      { kind: "h", text: "Moving an order along" },
      { kind: "p", text: "The two interfaces ask this differently, which is the point of having two. In the modern interface the status is a **track you step along**: press **Ordered**, **Shipped** or **Received** and it is written immediately, the way a ticket's pills are, with the steps behind you ticked. In the classic interface it is the **Status** field of a form, changed with the rest of the form's edits." },
      { kind: "steps", items: [
        "Marking an order **ordered** stamps the ordered date; marking it **received** stamps the received date. Sending a date explicitly wins, so a delivery that arrived on Tuesday is recorded as Tuesday rather than as the day somebody typed it in.",
        "**Received** is final in one respect: the lines lock. Everything else on the order — the expected date, the notes, the vendor — can still be edited.",
        "**Receiving an order writes the asset inventory.** One record per unit, named from the line and tagged with the order, priced at what the line cost and dated the day it arrived, sitting unassigned until somebody puts it at a client — so the hardware stops being an intention and becomes something you can hand out. A line of more than 25 units records 25 and says so in the order's notes rather than inventing a thousand tags; receiving the same order twice does not double it.",
      ] },
      { kind: "h", text: "Fixing the lines" },
      { kind: "p", text: "**Edit lines** turns the table into inputs: change a quantity or a price, add a line, remove one, then **Save lines**. The subtotal and the total are recomputed from the lines rather than typed, so a header can never disagree with the body. A received order refuses this, because a receipt is a record of what actually arrived." },
      { kind: "h", text: "Vendor details" },
      { kind: "p", text: "**Edit** beside the vendor opens their record: who to contact, email, phone, payment terms, tax id, website, address and notes. These are the fields a purchase order gets wrong when they are wrong — the contact nobody answers, the terms that decide when the invoice is due, the tax id the invoice has to match — which is why they are editable from the order they are printed on." },
      { kind: "note", text: "Raising an order for a vendor that is not in the list yet does not need a detour: the **New PO** form has *…or add a new vendor by name* under the vendor picker. The vendor is created and selected, and its details can be filled in from the order afterwards." },
    ],
    related: [
      { label: "Product Catalog", to: "/help/walkthroughs/product-catalog" },
      { label: "Billing, Agreements & Overtime", to: "/help/walkthroughs/billing-agreements" },
      { label: "Help Index", to: "/help/index" },
      { label: "Procurement", to: "/procurement" },
    ],
  },
  {
    id: "knowledge-base", group: "walkthroughs",
    path: "/help/walkthroughs/knowledge-base",
    title: "Knowledge Base & AI Drafts",
    description: "Write articles, and turn a solved ticket into a draft that a person still has to publish.",
    blocks: [
      { kind: "h", text: "Articles & categories" },
      { kind: "p", text: "The Knowledge Base holds articles in categories, each with a draft or published state. Only published articles are visible to anyone who is looking for an answer." },
      { kind: "h", text: "Draft an article from a ticket" },
      { kind: "p", text: "The expensive knowledge is the kind that leaves with the person who solved the ticket, and those tickets are already in the product. A resolved ticket can be drafted into an article that says what it was, what it looked like, and how it was fixed." },
      { kind: "steps", items: [
        "Open a **resolved** ticket and use the knowledge-base draft action.",
        "The draft is built from the ticket's own resolution material — the internal notes the technician wrote *after* solving it.",
        "The article is filed as a **draft** with the ticket number attached and a line saying it needs a human review.",
      ] },
      { kind: "note", text: "One article per ticket: asking twice returns the article already drafted rather than a second copy. The whole feature is switched from Administration → Configuration → Knowledge Base & AI, as **Draft articles from resolved tickets**." },
      { kind: "h", text: "Review before it is published" },
      { kind: "warn", text: "Nothing is ever published directly. An AI-authored article is a claim on the reader's time, so a person publishes, edits or discards it — and the draft says it was machine-written and which ticket it came from, so the claim can be checked." },
    ],
    related: [
      { label: "Kumo", to: "/help/walkthroughs/kumo" },
      { label: "Help Index", to: "/help/index" },
      { label: "Knowledge Base", to: "/kb" },
    ],
  },
  {
    id: "m365-offboarding", group: "walkthroughs",
    path: "/help/walkthroughs/m365-offboarding",
    title: "M365 Inactivity & Offboarding",
    description: "Find the Microsoft 365 accounts nobody is using, and give a departure an order and a record.",
    blocks: [
      { kind: "h", text: "The inactive accounts report" },
      { kind: "p", text: "The accounts arrive with the Microsoft 365 sync; the **Inactive Microsoft 365 Accounts** report turns them into the licence-cleanup question: which accounts nobody signs in to, whose they are, and how long it has been. It lives in **Reporting → Standard Reports**, because it answers across every client and every connected tenant rather than describing one connection." },
      { kind: "steps", items: [
        "Connect Microsoft 365 under C7NC and grant the audit permission the connector asks for.",
        "Open **Reporting → Standard Reports → Inactive Microsoft 365 Accounts**.",
        "Set **Inactive after** to how long counts as idle — 30 days catches lapsed users early, 90 finds the ones nobody will miss.",
        "Narrow it to **one client** for a review with them, or leave it on all clients for the cleanup list, and pick a single connected tenant when a group has more than one.",
        "Include or exclude **disabled accounts** (already handled) and **unknown sign-in** accounts (nothing recorded) as the question needs.",
        "Print or export it — PDF, Excel or CSV — with the same options applied to the file as to the screen.",
      ] },
      { kind: "note", text: "Without the audit permission every account reads **unknown** rather than \"active\". That is deliberate: an unanswerable question is reported as unanswerable, not guessed at — and unknown accounts are counted separately from inactive ones, so nothing funds a cleanup by guessing." },
      { kind: "h", text: "Raise an offboarding checklist" },
      { kind: "steps", items: [
        "Open **C7NC → Services**, open the Microsoft 365 connection, and press **Show accounts** — the accounts of that tenant, with their age bands.",
        "Start an offboarding for an inactive account.",
        "The checklist lists the work in order, and can be assigned to a person with a due date.",
        "Each step is ticked off as it is done, so the departure has a record rather than a memory.",
      ] },
      { kind: "note", text: "The tenant's own account list sits with the tenant it belongs to, on the connection that syncs it, and links straight to the full report when the question is company-wide rather than about one tenant." },
      { kind: "h", text: "What it deliberately does not do" },
      { kind: "warn", text: "**It disables nothing.** The checklist is a piece of work with an owner and a record — a human still does the disabling, in the tenant, where the consequence of a mistake is visible. Switching **Microsoft 365 offboarding** off under Administration → Configuration → C7NC &amp; Email leaves the report working and raises no checklists." },
    ],
    related: [
      { label: "C7NC Integrations", to: "/help/walkthroughs/cloudconnect" },
      { label: "Help Index", to: "/help/index" },
      { label: "C7NC", to: "/c7nc/services" },
    ],
  },
  {
    id: "flexpoint", group: "walkthroughs",
    path: "/help/walkthroughs/flexpoint",
    title: "FlexPoint Billing & Receivables",
    description: "Link FlexPoint customers to clients, see what each client owes, and push invoices through FlexPoint's merchant API.",
    blocks: [
      { kind: "h", text: "What this is for" },
      { kind: "p", text: "FlexPoint is the billing and accounts-receivable system many service providers already invoice through: it holds the invoices that were really issued to a client, and whether they have been paid. **C7NC → FlexPoint** is where that data is brought in, tied to your clients, and — if you want it — written back to." },
      { kind: "p", text: "Nothing on the page writes anything until you switch it on, and each switch says what it will do." },
      { kind: "h", text: "Connect it" },
      { kind: "steps", items: [
        "In FlexPoint, open **Settings → WebAPI**, choose **New API Credentials**, create the token and copy the credential it gives you. API access is part of the FlexPoint product, so it has to be created there — it cannot be generated from here.",
        "In C7NTAX, open **C7NC → Services** and press **Connect a service**, pick **FlexPoint** and paste the credential as the **Merchant API secret**. The base URL is already right unless FlexPoint tells you otherwise.",
        "Press **Test** on the connection. A green **Verified** means FlexPoint accepted the secret and the merchant is entitled to read its own data — the test reads one customer, not just the sign-in.",
        "Switch the connection **on** if you want batch approvals to push invoices to it automatically. Syncing and pushing from the FlexPoint page work either way.",
      ] },
      { kind: "note", text: "One connection reads one merchant. FlexPoint's API carries no account or tenant id — the API secret **is** what identifies the merchant — so two businesses need two connections, and this page configures the most recent one." },
      { kind: "h", text: "Run a sync" },
      { kind: "p", text: "**Sync now** reads whatever **What to pull** allows: customers, invoices, and deposits settled to the merchant's bank account. FlexPoint publishes no webhooks, so nothing arrives on its own — a sync is what reads the current state, and it can be run as often as you like. The counter beside each client is refreshed by the same run." },
      { kind: "h", text: "Link customers to clients" },
      { kind: "p", text: "A FlexPoint customer becomes a client's receivable only once it is linked, and the **Client matching** option decides how that happens: by the customer's external reference (the client's id, written into FlexPoint), by a unique exact name, or both — the default tries the reference and then falls back to a name that exactly one client carries. A name that matches two clients is left alone rather than guessed at." },
      { kind: "table", headers: ["Option", "What it does"], rows: [
        ["Create clients for unmatched customers", "Off: an unmatched customer waits in the list below the clients table until you link it. On: a client is created from the customer's name and address. Off by default, because it writes to your client list."],
        ["Write the client id back to FlexPoint", "Puts the client's id in the customer's external reference, so the link survives a rename on either side. Only the reference is written; nothing else about the customer is changed."],
      ] },
      { kind: "steps", items: [
        "Anything FlexPoint has that no client matches appears under **FlexPoint customers not linked to a client**.",
        "Choose a client from the list beside it and press **Link**. Linking replaces any previous customer for that client, because a client's receivable has to be one account rather than two.",
        "**Unlink** beside a client in the table clears it again. Nothing is deleted in FlexPoint — only this application's opinion changes.",
      ] },
      { kind: "h", text: "Push an invoice, and take the payment back" },
      { kind: "steps", items: [
        "Switch on **Push invoices to FlexPoint**, choose the **Status for pushed invoices** (Draft is the safe choice: nothing is issued to a customer until you say so), and save.",
        "In the invoices list, press **Push** on an invoice. It is created in FlexPoint against the client's customer, with its lines, its due date and this application's invoice id as the external reference — which is how the two are kept in step. Pressing it again updates the same FlexPoint invoice rather than creating a second one.",
        "If the client has no FlexPoint customer yet, one is created from the client's name and billing email. A client with no email address is refused with that reason, because FlexPoint requires one.",
        "Mark **Record settled payments on pushed invoices** when you want FlexPoint's payments to come back: a paid invoice becomes a payment here (method flexpoint, reference `flexpoint:<id>`) and the invoice is marked paid, or partial if only part has been received. It is recorded once — the reference stops a second run adding it twice.",
      ] },
      { kind: "note", text: "Approving a bill-through batch offers each invoice to the accounting system, and a FlexPoint connection that is **enabled and allowed to push** takes that path through the API instead of a configured URL. With pushing off, the batch approval still issues the invoices and says why the push did not happen." },
      { kind: "h", text: "On the client's own record" },
      { kind: "p", text: "A client that is linked shows its FlexPoint receivable on **Clients → (a client) → Invoices**: the open balance, anything overdue, what has been received, and the invoices FlexPoint holds — including which of them came from here. It is read-only: the writing lives in one place, so there is one screen where a financial write can be started." },
      { kind: "warn", text: "FlexPoint's API has **no webhooks, no product catalogue and no subscriptions**, so none of those are offered. Deposits are payouts to the merchant's bank account and FlexPoint does not attach one to a customer, so they are shown as a merchant total rather than per client." },
    ],
    related: [
      { label: "C7NC Integrations", to: "/help/walkthroughs/cloudconnect" },
      { label: "FlexPoint (C7NC)", to: "/c7nc/flexpoint" },
      { label: "C7NC", to: "/c7nc/services" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "api-access", group: "walkthroughs",
    path: "/help/walkthroughs/api-access",
    title: "API Access & the Event Gateway",
    description: "Issue an API key for an RMM, a SIEM, a monitoring platform or your own script, and choose where the alerts it sends are filed.",
    blocks: [
      { kind: "h", text: "What this is for" },
      { kind: "figure", src: "/help/api-access.png", alt: "The API Access page: key list, scopes and the event intake board", caption: "**API Access.** Keys on the left with the scopes each was issued, **Issue a key** above them, and the **event intake board** at the foot — where an alert that names no board of its own lands. The secret is shown once, at issue; afterwards there is only Rotate and Revoke." },
      { kind: "p", text: "Every screen in C7NTAX is backed by the same REST API, so another system can do anything the application can — raise tickets, log time, read invoices — if it has a credential. **Administration → API Access** is where those credentials are issued and where the one setting the event gateway needs is kept. C7NC is the other direction: that is where *this* instance reads from other systems." },
      { kind: "p", text: "The recommended path for anything that reports incidents — an RMM, an SIEM, an uptime monitor, a status-page bridge — is the **event gateway**: one endpoint they all post to, which opens one ticket per condition and closes it when the recovery arrives." },
      { kind: "h", text: "Issue a key" },
      { kind: "steps", items: [
        "Open **Administration → API Access** and press **New API key**.",
        "Give it a name and a source kind — the source kind is a label for the inventory, so name the key after the system *and* the tenant it serves: \"RMM — Acme tenant\" rather than \"RMM\".",
        "Choose the scopes. The three presets cover an RMM, a SIEM and an accounting integration; the list below them is every permission this instance has, so a narrower key is only a search away. An RMM that only raises tickets needs **ticket:create** and **ticket:view** and nothing else.",
        "Optionally set an expiry. An unattended integration is exactly the one that should have one, and an expired key behaves like a revoked one.",
        "Press **Issue key** and copy the secret. It is shown **once** — only a hash is stored, so it cannot be recovered afterwards, and the only answer to a lost key is to rotate it.",
      ] },
      { kind: "warn", text: "A key acts as the account it belongs to, narrowed to its scopes. The scopes can never add power, only take it away: the account's permissions are re-read on every request, so removing a permission from the account removes it from every key that account owns, immediately." },
      { kind: "h", text: "Using the key" },
      { kind: "p", text: "Send it as a bearer token on any call. The base URL is this instance's address with `/api` on the end — the page shows it ready to copy." },
      { kind: "table", headers: ["What you want", "Call"], rows: [
        ["Report an incident (RMM, SIEM, monitor)", "POST /api/events — needs ticket:create"],
        ["What has arrived, and what it became", "GET /api/events — needs ticket:view"],
        ["Which systems have reported, and when", "GET /api/events/sources — needs ticket:view"],
        ["Create a ticket directly", "POST /api/tickets — needs ticket:create"],
        ["Every available operation", "docs/openapi.yaml in the repository, generated from the routes"],
      ] },
      { kind: "h", text: "Report an alert, and its recovery" },
      { kind: "p", text: "The gateway keys on the sender's own id for a condition — `source` plus `externalId` — which is what stops one alert polled every minute from becoming sixty tickets. The first event opens a ticket; each repeat attaches to it as an internal note with an occurrence count; a `kind` of `recovery` closes it." },
      { kind: "table", headers: ["Field", "Why it matters"], rows: [
        ["source", "Who is sending — \"rmm\", \"sentinelone\", anything. It tags the ticket and shows up on the sources report."],
        ["externalId", "Your stable id for the condition (an alert id, or `device:check`). The one field to get right: change it every poll and every poll becomes a ticket."],
        ["title", "The ticket's title."],
        ["severity", "critical / high / medium / low / info — becomes the ticket's priority."],
        ["client", "`{ \"companyId\": \"…\" }`, or a name that exactly one client carries. A ticket has to belong to somebody, so an event that names nobody is refused."],
        ["boardId", "Optional. Without it, the event goes to the intake board chosen on the API Access page, or the oldest board."],
        ["data", "Anything else you have. It is kept whole on the ticket's internal note and in its custom fields — usually where the actual reason is."],
      ] },
      { kind: "steps", items: [
        "Choose the **Event intake board** on the API Access page and save it: that is where alerts land when the sender does not name a board.",
        "Send one alert by hand with `curl` and read the answer. `\"created\": true` means a ticket was opened.",
        "Send the same alert again: the answer becomes `\"merged\": true` with `occurrences: 2`, and the second one is a note on the same ticket rather than a second ticket.",
        "Send the recovery (`kind: \"recovery\"` with the same `externalId`) — the ticket is resolved, and a recovery with no ticket to close is recorded and answered `202`.",
      ] },
      { kind: "tip", text: "Check **GET /api/events/sources** a day after a new integration goes live: a source with a recent last-seen time is a working integration, and one that never appears is a key or a URL problem, not a mystery." },
      { kind: "h", text: "Rotating and revoking" },
      { kind: "p", text: "**Rotate** issues a new secret and invalidates the old one — the answer to a leaked key, and the reason a stored secret is worth so little. **Revoke** stops a key immediately and keeps its row, so the list stays a record of what was ever issued; add a reason and it goes to the audit trail with the revocation itself. Every issuance, rotation and revocation appears in **Administration → Audit Logs**." },
      { kind: "note", text: "Issuing a key can hand an outsider the ability to create tickets or read billing, so the whole page is gated on **user:manage** — the same permission as creating a user. The intake board setting needs **system:config**." },
    ],
    related: [
      { label: "API Access", to: "/admin/api" },
      { label: "C7NC Integrations", to: "/help/walkthroughs/cloudconnect" },
      { label: "Alert Webhooks", to: "/help/walkthroughs/alert-webhooks" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
];

function Block({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case "h": return <h2 id={slugify(block.text)} className="text-base font-semibold text-white mt-6 mb-2">{block.text}</h2>;
    case "p": return <p className="text-sm text-gray-300 leading-relaxed mb-3">{inline(block.text)}</p>;
    case "steps": return (
      <ol className="list-decimal list-inside space-y-2 mb-3">
        {block.items.map((s, i) => <li key={i} className="text-sm text-gray-300 leading-relaxed">{inline(s)}</li>)}
      </ol>
    );
    case "note": return <div className="bg-cyber-600/10 rounded-md px-3 py-2 my-3 text-sm text-gray-300"><span className="font-semibold text-cyber-400">Note: </span>{inline(block.text)}</div>;
    case "tip": return <div className="bg-green-600/10 rounded-md px-3 py-2 my-3 text-sm text-gray-300 flex gap-2"><Lightbulb size={16} className="text-green-400 shrink-0 mt-0.5" /><span>{inline(block.text)}</span></div>;
    case "warn": return <div className="bg-amber-600/10 rounded-md px-3 py-2 my-3 text-sm text-gray-300 flex gap-2"><AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" /><span>{inline(block.text)}</span></div>;
    case "table": return (
      <div className="overflow-x-auto my-3">
        <table className="w-full text-sm border-collapse">
          <thead><tr>{block.headers.map((h, i) => <th key={i} className="text-left text-gray-400 font-semibold border-b border-surface-border px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {block.rows.map((r, ri) => <tr key={ri} className="border-b border-surface-border/50">{r.map((c, ci) => <td key={ci} className="text-gray-300 px-3 py-2">{inline(c)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    );
    /*
     * A picture of the screen a step is talking about. The caption carries the pointing — "the switch is
     * the second row" — because a screenshot without an arrow is a second rendering of the same
     * paragraph; the picture shows where to look and the caption says what to look at.
     *
     * Captured dark, at 1440 wide, from the running application: see `apps/web/public/help/README.md`
     * for how they were taken and when to take them again.
     */
    case "figure": return (
      <figure className="my-4">
        <img
          src={block.src}
          alt={block.alt}
          loading="lazy"
          className="w-full rounded-lg border border-surface-border bg-surface-lighter"
        />
        <figcaption className="mt-2 text-xs text-gray-400 leading-relaxed">
          <span className="font-semibold text-gray-300">Screenshot: </span>{inline(block.caption)}
        </figcaption>
      </figure>
    );
    default: return null;
  }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * Inline emphasis inside a block's text: `**bold**` and `` `code` ``.
 *
 * The walkthroughs name buttons, flags and paths, and a sentence that cannot say which words are the
 * button is harder to follow than one that can. Headings are left alone — an `<h2>` is already the
 * emphasis — so a heading's text is rendered as written and its slug stays stable.
 */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  if (parts.length === 1) return text;
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={index} className="font-mono text-[11px] px-1 py-0.5 rounded bg-surface-lighter text-cyber-300">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function SectionIcon({ id }: { id: string }) {
  if (id === "getting-started") return <BookOpen size={14} />;
  if (id === "faq") return <HelpCircle size={14} />;
  if (id === "configuration") return <Settings2 size={14} />;
  if (id === "index") return <ListOrdered size={14} />;
  return <Wrench size={14} />;
}

function HelpDocPage({ section }: { section: HelpSection }) {
  const redesign = useRedesign();
  const pageAnchors = section.blocks.filter((b): b is Extract<HelpBlock, { kind: "h" }> => b.kind === "h").map((h) => ({ id: slugify(h.text), label: h.text }));
  const core = HELP_SECTIONS.filter((s) => s.group === "core");
  const walkthroughs = HELP_SECTIONS.filter((s) => s.group === "walkthroughs");
  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <aside className="lg:w-56 shrink-0">
        <div className="card p-3 sticky top-20 max-h-[calc(100vh-120px)] overflow-y-auto">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Help sections</p>
          {core.map((s) => (
            <Link key={s.id} to={s.path} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${s.id === section.id ? "bg-cyber-600/20 text-cyber-400" : "text-gray-300 hover:text-white hover:bg-surface-lighter"}`}>
              <SectionIcon id={s.id} />{s.title}
            </Link>
          ))}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 mb-2">Walkthroughs</p>
          {walkthroughs.map((s) => (
            <Link key={s.id} to={s.path} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${s.id === section.id ? "bg-cyber-600/20 text-cyber-400" : "text-gray-300 hover:text-white hover:bg-surface-lighter"}`}>
              <SectionIcon id={s.id} />{s.title}
            </Link>
          ))}
          <div className="border-t border-surface-border/50 mt-2 pt-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">On this page</p>
            {pageAnchors.map((a) => (
              <a key={a.id} href={`#${a.id}`} className="block px-2 py-1 text-xs text-gray-400 hover:text-white rounded">{a.label}</a>
            ))}
          </div>
        </div>
      </aside>
      <article className="flex-1 card p-6">
        <h1 className={redesign ? "text-base font-semibold text-white" : "text-xl font-bold text-white"}>{section.title}</h1>
        <p className={redesign ? "text-xs text-gray-500 mt-1 mb-3" : "text-sm text-gray-400 mt-1 mb-4"}>{section.description}</p>
        {section.blocks.map((b, i) => <Block key={i} block={b} />)}
        <div className="border-t border-surface-border/50 mt-6 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Related topics</p>
          <div className="flex flex-wrap gap-2">
            {section.related.map((r) => (
              <Link key={r.to + r.label} to={r.to} className="text-xs px-2.5 py-1 rounded-full bg-surface-lighter text-gray-300 hover:text-white hover:bg-cyber-600/20 inline-flex items-center gap-1">
                {r.label} <ChevronRight size={12} />
              </Link>
            ))}
          </div>
        </div>
      </article>
    </div>
  );
}

export function HelpGettingStarted() { return <HelpCore id="getting-started" />; }
export function HelpFaq() { return <HelpCore id="faq" />; }
export function HelpConfiguration() { return <HelpCore id="configuration" />; }
export function HelpIndex() { return <HelpCore id="index" />; }

/** Looks the section up by id rather than by position, so reordering the array cannot swap a page. */
function HelpCore({ id }: { id: string }) {
  const section = HELP_SECTIONS.find(candidate => candidate.id === id);
  if (!section) return null;
  return <HelpDocPage section={section} />;
}

export function HelpWalkthrough() {
  const { pathname } = useLocation();
  const section = HELP_SECTIONS.find(candidate => candidate.path === pathname);
  if (!section) {
    return (
      <div className="card p-6">
        <h1 className="text-xl font-bold text-white">That walkthrough has moved</h1>
        <p className="text-sm text-gray-400 mt-2">
          It is no longer part of the documentation. The <Link className="text-cyber-400 hover:text-cyber-300" to="/help/index">Help Index</Link> lists
          every topic, and <Link className="text-cyber-400 hover:text-cyber-300" to="/help">Help Home</Link> lists every walkthrough.
        </p>
      </div>
    );
  }
  return <HelpDocPage section={section} />;
}
