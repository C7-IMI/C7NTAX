# C7NTAX — Feature List Summary
## Version: 2026.10.10.015 | Last Updated: 2026-10-10

---

### Versioning Scheme
- Date-based: `Year.Month.Day.Build` (e.g., `2026.8.10.001`)
- First three octets set to the release date
- Build number starts at `001` each day, increments sequentially for same-day entries
- **The date octets MUST be the actual current date when the entry is written** (derived, never typed). Use `node scripts/next-version.mjs` to compute the next version; the build number resets to `001` on a new day.
- This file is the authoritative source for the What's New changelog
- Each entry uses type indicators: `[New]`, `[Update]`, `[Fix]`
- **Definition of done for every change:** update all three records — `BuildNotes.md` (this file), `Retrace.md` (prompt log), and What's New. What's New is served live by `GET /api/system/changelog`, which reads this file and re-reads it only when the file changes, so no manual copy is required for it to refresh; the static fallbacks (`apps/web/public/BuildNotes.md`, `apps/api/src/BuildNotes.json`) are regenerated automatically by `scripts/generate-buildnotes.mjs` (run by the pre-commit git hook and by `verify-post-change.ts`).

---

## 2026.10.10.015 — The review is closed, and a check the deploy needs first

The PLAN-030 static review is closed at round 9. Nine rounds took the Azure package from "cannot complete
a deployment" to "no further findings"; the reviewer independently verified the round-9 credential fix on
`origin/main`, ran its logic against the five credential cases, and agreed to stop.

- **[Update]** **The plan's status line and the go-live checklist record the close**, and the checklist
  gained one item it was missing: **confirm at least one active account is on the Super Admin role** before
  a first production deploy.
- **[New]** **That item is the consequence of the instance tier**, and it is worth stating plainly. The
  `20261010140000_instance_permission_tier` migration takes three instance-level permissions away from
  `admin` on purpose — the ability to change the MFA policy, the session settings, the Workspace and portal
  defaults and the instance maintenance operations now belongs to Super Admin. An administrator keeps
  everything to do with people, including resetting one person's second factor, and can still *read* those
  settings. But a deployment with no Super Admin would find that **nobody can change the instance's
  authentication policy at all, including to switch it off**. The seed ships one, so this is a check rather
  than a fix — the same shape as the four lockouts found inside the feature, one layer out: organisational
  rather than technical.
- **[Update]** **The 503 the reviewer flagged is the health gate working, and the ordering is what makes it
  safe.** A revision carrying migrations the job has not yet run fails its deep readiness check and stays
  out of service; without that it could take traffic against a schema it does not match, and the failures
  would read as application bugs rather than an unrun migration. The workflow runs the job before the
  revision update, so the 503 is transient.

No code changed in this round. The three migrations that ride along are unchanged and additive, the deploy
surface is untouched (`git diff --name-only 209195c0..HEAD -- infra scripts/azure .github/workflows
Dockerfile` returns 0 files), and preflight is 0 failures.

---

## 2026.10.10.014 — A relay that had no password, asked for one

The mail transport was told to **authenticate** even when the deployment had no credentials to
authenticate with. `EmailService` built its transport with

```ts
auth: { user: process.env.SMTP_USER ?? "", pass: process.env.SMTP_PASS ?? "" }
```

and an `auth` object that is *present* is an instruction to authenticate, not a statement that there is
nothing to authenticate with. So a relay that needs no credentials — an internal relay, an
address-allowlisted one, or the local one a developer runs — was handed an AUTH attempt with a blank
username. Some relays answer that with an authentication failure rather than skipping authentication, so
a deployment with no credentials could not send, and the error read like a wrong password rather than a
configuration that never had one.

- **[Fix]** **`auth` is omitted entirely when there is nothing to authenticate with**, and the "is there
  anything" question is asked once, in one place (`resolveSmtpCredentials`). Proved by reading the
  transport's own options rather than asserting the path: absent with no credentials and with explicitly
  empty ones; `{user, pass}` when both are set; and **not dropped** when only one half is — a relay that
  wants a username and no password is unusual but real, and discarding a configured username would be a
  worse bug than the one being fixed. `secure` still reads `SMTP_SECURE`, so the round-8 fix is intact,
  and `probe:email` is 35/35 afterwards, so no message body moved with it.

Found by the PLAN-030 reviewer as the one item they deliberately left out of round 9 — "the mail sender
passes empty credentials when none are set; that predates this work and I didn't test how it behaves."
They were right to leave it and right that it was worth saying, and it is the third time in this series
that the defect was in the gap between what a setting *says* and what the code *does*.

---

## 2026.10.10.013 — The last five passwords, and a development account

Two changes that are not really related, landing together because they were asked for together: a
password policy that remembers what was used, and the local development account put back the way it was.

- **[New]** **An account may not reuse its last five passwords.** A minimum length and a complexity
  floor stop a password being *guessable*; they do nothing about one being *reused*, and reuse is what
  actually defeats a policy that wants passwords changed — an account alternating between two favourites
  satisfies every complexity rule forever while never really changing anything. The history is stored as
  **bcrypt hashes**, most recent first, capped at five, and compared with bcrypt: a history is a list of
  credentials that used to work, so the only question ever asked of it is "is this one of them", which
  bcrypt answers without the database holding the password.
- **[Update]** **The rule applies to an administrator's reset as well as to a self-service change**, and
  that is deliberate: "reset it back to what it was" is the exact instruction that would otherwise undo a
  change somebody made because a password had been exposed, and the administrator has no way to know which
  of the account's earlier passwords that was. A **generated** reset password skips the check — it is
  random, so it cannot be a reuse, and refusing it would leave an administrator unable to reset an account
  at all.
- **[Fix]** **Five credential fields were being returned on a user record.** `GET /api/users/:id` stripped
  only `passwordHash` and `mfaSecret`, so it handed back `mfaBackupCodes`, the **plaintext** pending
  `mfaEmailCode`, and would have handed back the new history — a list of every credential an account had
  ever had, given to anybody holding `user:manage`, from a route whose whole purpose is to show one
  person's record. All five are now stripped by **one helper** at every call site, which is the fix rather
  than five fixes: the reason the leak existed was that each site remembered a different subset.
- **[Update]** **`admin@C7NTAX.com` is the local development account again** — Super Admin, password
  `admin`, no forced change, MFA enrolment not required, and exempt from the gate and the session
  timeout by way of `AUTH_TEST_BYPASS`. The password is written **directly**, because the product's own
  policy refuses a five-character password and that policy was not weakened for it: signing in works,
  and changing it through the interface still requires twelve characters.

Verified against the running API: a short password, a one-class password and a common word are each
refused with their own message; a valid one is accepted; returning to a previous password is refused;
seven changes in a row leave the history at **exactly five**, and the oldest then becomes reusable, which
is what "the last five" means. `admin/admin` signs in with no MFA challenge and reaches the MFA policy,
Workspace, the instance pollers and the developer surface.

---

## 2026.10.10.012 — An instance tier above Admin

`Admin` and `Super Admin` differed by two developer permissions and nothing else, so an ordinary
administrator could turn multi-factor authentication on **and enforce it for the whole instance**, raise
the session ceiling, switch authentication hardening off, enable the test-bypass exemption, change what
every client sees in the portal, and pause the instance's background workers. Every one of those is a
decision about the deployment itself.

- **[New]** **Three instance permissions, held by the Super Admin alone.** `instance:security` — who may
  sign in and how (the MFA policy, sessions and the sign-in methods) · `instance:config` — what the
  application is for everybody (Workspace, the Customer Portal, client apps) · `instance:maintenance` —
  operations that pause, force or reset instance-wide processes. The split is by *kind of decision*, so a
  reviewer can see why each is protected; one role holds all three today.
- **[Update]** **The per-account half of MFA stays with administrators.** `mfa:enforce` and
  `security:manage` are untouched, because resetting one person's second factor is ordinary support while
  deciding that everybody must have one is policy — which is exactly the line the request drew.
- **[New]** **The tier cannot be granted by anyone below it, enforced in three places rather than one.**
  Hiding a permission in a picker is presentation, not a control: `ROLE_PERMISSIONS` withholds it from
  `Admin`; `computePermissions` subtracts it from any role whose own declared set does not include it, so
  a stored or hand-edited role row cannot smuggle one in; and the role and user routes **refuse it by
  name**, on create, on edit, and through both halves of a user's permission lists. An API key needs no
  special case — its scopes are intersected with its owner's permissions on every request.
- **[Update]** **Reads are unchanged; only writes moved.** An administrator can still see the values —
  which is how they answer "why was I signed out" — and the screens already render a read-only section.
- **[Fix]** **The tier would have locked the instance out of fixing itself.** Once enforcement bites, the
  switches that turn it off sit behind `instance:security`, so the one person who could correct a mistake
  was the one person the gate would have stopped. An account holding that permission is now exempt from
  the enrolment **gate** while still owing the enrolment, so the reminder stands. Proven as a pair with
  the requirement biting: an ordinary unenrolled account answers `403 MFA_ENROLMENT_REQUIRED` while the
  Super Admin answers `200`, both reporting `mustEnrolNow: true`.

A migration carries the data half: `super_admin` and `developer_admin` were given the three keys (they
held everything before), `admin` deliberately was not, and any tier key found on an admin role is removed
rather than trusted. Verified by running: an Admin writing the MFA section, the Workspace section or the
instance pollers gets `403`; creating a role carrying `instance:security` gets `403` naming the key; and
`admin/admin` — now a Super Admin — holds all three.

---

## 2026.10.10.011 — The two interfaces are called Modern and Classic

The menu has always offered **Modern** and **Classic**; the code and the design notes around the
second one called it "Redesign". That other name is gone — same screens, same switch, same
behaviour, one word for each layout.

- **[Update]** **One word per layout, everywhere.** `useRedesign()` is `useModernInterface()`,
  `redesignOverride()` is `modernScreensOverride()`, `setUiRedesign()` is `setUiModernScreens()`,
  `UI_REDESIGN`, `UI_REDESIGN_AVAILABLE` and `UI_REDESIGN_STORAGE_KEY` are `UI_MODERN_SCREENS*`,
  `VITE_UI_REDESIGN` is `VITE_UI_MODERN`, the browser flag `c7_ui_redesign` is `c7_ui_modern`, the
  attribute `data-ui-redesign` is `data-ui-modern`, the local `redesign` is `modern`, and the
  `InterfaceStyle` value `"redesign"` is `"modern"`. The page-scoped stylesheet in `index.css` is
  scoped to the new attribute, the setting's choices read **Modern (default)** and *Classic*, and
  every comment, Help reference and mockup says Modern.
- **[Update]** **The old names are still read, and nothing writes them.** A browser that chose before
  the rename still holds `c7_ui_redesign`, and a deployment that built with `VITE_UI_REDESIGN=false`
  still means it, so both are honoured — the new name first, the old one only as a fallback — while
  the new pair is the one written. A stored `interfaceStyle` of `"redesign"` also still resolves to
  the Modern interface, because anything that is not an explicit `classic` does. Both aliases can be
  retired in a later release, once no browser and no build can be carrying them.
- **[Fix]** **Two mockups were renamed** — `docs/mockups/login-redesign.html` and
  `docs/mockups/contacts-boards-redesign.html` are now `login-modern.html` and
  `contacts-boards-modern.html`, with the four files that copied the second one's tokens updated.
  `INTERFACE-ROLLBACK.md` carries the rename, the aliases and the rule for retiring them.

**Behaviour is unchanged in both layouts:** no screen, route, permission, setting or default moved
except the words. **Verification:** `pnpm exec tsc --noEmit` clean in `apps/web` and `apps/api`;
`check-encoding`, `lint-design-tokens`, `check-help-links`, `check-api-docs` and `check-route-guards`
pass; in the browser `c7_ui_modern=0` gives the classic layout with `data-ui-modern="false"`, `"1"`
gives the Modern one and `removeItem` gives the instance default, the legacy `c7_ui_redesign=0` on
its own still gives the classic layout, and the switch still names its choices Modern and Classic —
with no console errors in either.

## 2026.10.10.010 — A rehearsal of the second factor

A support call about MFA is hard because the person on the phone is describing a screen the support person
cannot see. This is the screen they can both look at: what the instance actually does, read live from the
policy endpoint, beside a scripted rehearsal of the eight states a person can be in — so somebody on a call
can see what the person should be looking at, know what to check when they are not, and know what to say.

- **[New]** **An end-to-end MFA setup simulator** (`apps/web/src/components/MfaSetupSimulator.tsx`),
  offered as **Simulate a setup** on `Administration → Configuration → Multi-factor authentication` — the
  feature's own screen, which is where an administrator is standing when users start reporting trouble. It
  opens a real window (`window.open`) holding the two widths side by side, and falls back to an in-app
  overlay when a pop-up is blocked: a sheet in the modern interface, a dialog with a heading and a Close
  button in the classic one. It is **read-only** — no enrolment, no secret, no setting, no change to
  anybody's account — and it says so on the screen as well as in the code: a rehearsal that could alter the
  instance is a footgun aimed at the person most likely to press the wrong thing while distracted.
- **[New]** **The live half is the API's own answer, not a mock.** The one call it makes is
  `GET /api/auth/mfa/policy`, printed plainly: whether a second factor is available, whether it is required
  of *this* account, the deadline and the whole days left (or that it has passed), the account's state in
  the product's own words from `MFA_STATES`, and the method catalogue — each method marked offered or not,
  with the configuration area that governs it named (passkeys belong to `sessions.passkeys`, not to the MFA
  section). `enforcementPossible` is shown when the settings would require a factor while offering none. If
  the read fails it prints the API's own sentence, names the endpoint and offers a retry — **never a blank
  frame** — and the script half still works, because a rehearsal does not depend on the read.
- **[New]** **The script half walks the states that actually differ**, and the picker starts on the one the
  live read says the account is in: switched off; optional; required inside the grace period; required with
  the grace expired (the gate has every screen); signing in with an authenticator code; signing in with an
  emailed code; a lost phone and a recovery code; and "don't ask me again on this browser". Every step says
  what the person is doing, what they should be seeing, what to check when they are not, and the one line to
  say. The method names come from the deployment's catalogue and the account states from `MFA_STATES` — no
  method list is hard-coded anywhere.
- **[New]** **The failures support actually gets are in the notes**, at the step they belong to: a
  time-based code refused is almost always a **device clock** that is not set automatically; an emailed code
  needs a working **mail relay**, and the relay's own refusal is what the API answers with; a **passkey
  cannot be the first method** because registering one needs a signed-in session, so it is listed with that
  reason; a **recovery code works once** and a reset replaces all ten; and the gate follows the **session**,
  so "it works in one tab and not another" means one tab has a session and the other does not.
- **[New]** **Both widths, side by side** — a 900 px desktop frame and a 375 px phone frame, in their own
  scroll regions, at the same height: the phone is not a smaller copy, it is the same screen with the rail
  gone and one column of method cards, which is where "it looked fine on my desktop" usually breaks. The
  frames are a **rehearsal of what the person sees**, drawn rather than imported, and the header comment says
  so and says that the real screens are the authority if the two ever differ.
- **[Update]** **Two arrangements for every surface, designed individually**, as the repository's rule
  requires: the action is a strip with the sentence beside the control that acts in the modern interface and
  a headed card with a control row in the classic one; the blocked-pop-up fallback is a sheet against a
  dialog; and the content is a scenario rail of pills you press with a step track you step along — the widths
  side by side — against a labelled `select` and numbered fieldsets read top to bottom with the widths
  stacked. `apps/web/src/pages/Configuration.tsx` places the action for the **mfa** section only, with an
  explicit commented conditional in both branches rather than a new registry field.

`pnpm exec tsc --noEmit` — zero errors. `check-encoding`, `lint-design-tokens` and `check-help-links` —
all pass. Driven in a browser, in both interfaces: the live read matched the endpoint's own JSON (200 on
`/api/auth/mfa/policy`), all eight scenarios rendered, the stepper walked forward and back, both widths drew
side by side, the blocked-pop-up fallback showed the sheet and then the classic dialog, a forced read failure
showed the API's own sentence with a retry that recovered, and no console errors were logged.

Three observations, reported rather than changed (the API is out of scope). The policy endpoint carries the
**deadline** (`graceUntil`, `daysLeft`) but not the settings that produced it, so the live half shows the
deadline and names the **Grace period** setting rather than the length; `rememberDays` is likewise only on
the sign-in response. With the instance switch **off**, `mfaPolicyFor` resolves `methods: []`, so every entry
in `catalogue` reads `offered: false` and the wizard's own refusal sentence blames the individual method's
setting rather than the master switch — the simulator's step says plainly which of the two it is. And on this
instance the admin account is the `AUTH_TEST_BYPASS` account, so `required` is false even with enforcement on
and `graceDays: 0`: the exempt account is stopped by nothing, which is correct behaviour and worth knowing
before reading the live half as evidence that enforcement is not working.

---

## 2026.10.10.009 — The second factor, on screen

The policy landed on the wire first: `mfaPolicy` rides on every sign-in response and on `/auth/me`, and the
enrolment gate answers `403 MFA_ENROLMENT_REQUIRED` to everything outside a short exempt list. This is the
interface that makes it usable — the wizard somebody meets at first touch, the door that holds them until
they finish it, the countdown that tells them before the door does, and a sign-in challenge that asks for
what the account actually has.

- **[New]** **The first-touch enrolment wizard.** One component for both moments a second factor is set up:
  the gate that holds the whole application, and My Account where somebody changes a method they already
  have. The steps are a track you step along — choose a method, prove it works, save your recovery codes —
  and the method list is the **server's catalogue** rather than anything hard-coded here. A method the
  deployment does not offer is shown greyed with the reason and the configuration area that governs it
  (passkeys belong to `sessions.passkeys`, not to the `mfa` section), because "why can I not use my passkey"
  is the question the screen exists to answer; and a passkey is listed but refused as a *first* method,
  since registering one needs a session and a session needs a second factor once one is required.
- **[New]** **The gate**, beside and **after** the password gate — a person can owe both, and the password is
  what proves the account is theirs. It is not dismissable, it replaces the routed tree exactly as the
  password gate does, and it offers signing out and nothing else.
- **[New]** **Recovery codes are acknowledged, not just displayed.** Ten codes, a copy and a download, and a
  Finish that stays disabled until the person confirms they are stored. The policy is deliberately not
  refreshed when the enrolment succeeds — only on acknowledgement — because refreshing would make the gate
  unmount the wizard and throw the codes away before they were written down.
- **[New]** **A countdown instead of a cliff.** Somebody inside the grace period gets a banner on every
  screen, above the page, saying how long is left in words ("6 days left") and going straight to the wizard.
  It is dismissable for the session only: a deadline nobody is reminded of is a cliff with paperwork.
- **[New]** **A truthful refusal from the mail relay.** If the SMTP server refuses the enrolment code, the
  API's own message is shown — "the code could not be emailed, check the SMTP configuration or choose
  another method" — and the screen keeps the way past it rather than waiting for a code that is not coming.
- **[Update]** **The sign-in challenge now asks for what the account has.** `mfaMethod` decides the field, so
  an emailed-code account is never shown an authenticator prompt (and the code is sent for it, rather than
  leaving a field no screen has filled). A **recovery code** can be typed into the same field — the API
  accepts one there and answers identically — and the page says so, which is why the field no longer strips
  anything but digits. "Don't ask again on this browser for N days" appears only when the deployment
  remembers browsers at all, and clearing it sends `remember: false` rather than leaving the API's own
  default in place.
- **[Update]** **My Account → Two-Factor Authentication** is now the change/re-enrol screen: what the
  account has now, and the shared wizard to change it. It keeps the QR-screenshot reader that lets somebody
  recover the manual key from an image of the code, decoded in the browser.
- **[New]** **The per-account policy on Users**, which is where "everyone except this one" finally has a
  home. The three states are pills you press in the modern interface and a labelled select in the classic
  one, each with the sentence that says what it means; beside them, what the account has enrolled, when,
  and the deadline as a countdown or plainly overdue. A reset opens in place and lists what will be lost
  (the authenticator, the recovery codes) and what happens next, rather than asking "are you sure". The
  user list gained a column and a badge for the same facts, and the controls are gated on the permissions
  that apply to them — `mfa:enforce` to change the requirement, `security:manage` to reset — disabled with
  the reason rather than failing on press.
- **[Fix]** **"Without 2FA" counted passkey holders as having none.** The count, the CSV column and the
  context-menu reset all keyed on `mfaEnabled`, which is false for a passkey — because a passkey *is* the
  sign-in rather than a step after it — so an account with the strongest second factor there is was
  reported as having none, and the reset refused to touch it. All three now key on the **enrolment**
  (`mfaEnrolledAt`), which is what "has a second factor" actually means.

Both interfaces are designed separately for every one of these surfaces — the modern screen is a sheet with a
pressed-method list and sentences beside the control that acts, the classic one is a labelled form with a
method select (refusals kept as disabled options), a checkbox and Save/Cancel. Verified by driving both:
the wizard, the banner, the gate and the challenge were each exercised in the browser, and the gate was
completed end-to-end so that the door actually opened.

---

## 2026.10.10.008 — Multi-factor authentication as a policy

Until now an account either had MFA or did not: `mfaEnabled` was set the moment somebody verified their
first authenticator code, and the sign-in asked for a second factor from those accounts and nobody else.
There was no way to **require** one, no way to exempt an account from a requirement, no way to say which
methods a deployment accepts, and no wizard — an account either stumbled onto the setup screen or did
without.

The feature is a **policy** on top of the enrolment that already existed. `Administration → Configuration
→ Multi-factor authentication` decides whether a second factor is available, whether it is required, how
long people get, which methods are offered, and how long a browser may be remembered. Each account then
carries its own answer — `default`, `disabled` (exempt) or `enforced` (required whatever the instance
says) — on the Users screen, which is where "everyone except this one" finally has a home.

- **[New]** **A grace period instead of a cliff.** Switching enforcement on does not stop anybody: every
  account that has not enrolled is given a deadline (7 days by default) rather than being turned away at
  its next request. Re-saving the grace period re-stamps it, so shortening the period means what it says;
  a deliberate switch-off and on again gives a real period rather than none. The interface that counts it
  down is described in **2026.10.10.009**.
- **[New]** **A browser may be remembered.** After a second factor is proved, a browser can be trusted for
  a configured number of days. The trust is bound to the account **and to the enrolment that proved it**,
  so an administrator's reset revokes it — the enrolment *is* the version, and there is no second record
  to keep in step.
- **[New]** **Three methods, and one place that decides.** Authenticator app, passkey and emailed code,
  each resolving whether it is offered from the setting that governs it — passkeys from the existing
  Sessions & Security switch, so there is not a second switch to forget.
- **[Fix]** **Recovery codes work, for the first time.** They were documented as hashed, compared as plain
  text with `indexOf`, and never generated by anything — so recovery was unreachable and an account whose
  phone was lost needed an administrator. Enrolment now issues them, they are stored hashed, they are
  compared with bcrypt, and they are spent by the attempt. The sign-in row says when one was used.
- **[Fix]** **The emailed code is compared in constant time.** A plain `===` on a six-digit secret leaks
  how many leading digits were right, which is enough to guess the rest inside the window.
- **[New]** **Two safeguards against locking an instance out of itself.** A saved setting that would
  require a second factor while offering none is refused, and the value it replaced is restored exactly; a
  required account with no method left to choose is never stopped, so a misconfigured deployment degrades
  to a warning. Both were found by running the thing rather than by reading it — the first version of the
  refusal restored the field's *default* rather than its previous value, and switching enforcement off had
  moved every deadline into the past so that switching it back on blocked everyone instantly.
- **[New]** **`mfa:enforce` finally does something.** The permission was declared and granted to
  administrators but no route read it; changing whether an account must have a second factor is what it
  is for. Resetting an account's MFA stays on `security:manage`, because destroying a credential is a
  security-management act.
- **[Update]** **API keys are not stopped by the gate.** A key is a credential issued to a system that
  cannot open a browser, so requiring it to complete an interactive wizard would break the integration
  rather than protect it. An unattended integration needs no change; a user token is stopped, because the
  person behind it can be asked.
- **[Fix]** **The emailed fallback at sign-in ignored whether the deployment offers it.** `POST
  /api/auth/send-mfa-email` had no method check while the *enrolment* endpoint had one, so an administrator
  who switched emailed codes off — which they do because the second factor must not travel on the same
  channel as a password reset — still had codes sent there. Both doors now refuse alike. Found by the work
  that built the sign-in challenge, and only findable by reading the two endpoints against each other.
- **[Fix]** **`GET /api/users/me` no longer returns the second factor's secrets.** It returned
  `mfaBackupCodes` and, worse, the **plaintext** pending `mfaEmailCode` — a live second factor for as long
  as its window is open. Both are stripped; nothing on the client has a use for either, since the codes are
  shown once when issued and the pending code is meant to be read out of an email. The same route now also
  carries `mfaPolicy`, so the account screen and the reminder do not have to make a second call — which is
  how two screens come to disagree about a deadline.
- **[Update]** **`POST /api/users/:id/reset-mfa` answers with the resolved policy**, matching the `PATCH`.
  A reset is the change whose consequence is hardest to guess (the account is unenrolled, so whether it is
  about to be stopped depends on the instance's setting and the deadline just stamped), so the caller is
  told rather than left to re-read the record and infer it.
- **[Update]** The API guide (§2.1) and the generated specification carry the gate, the policy object and
  the method catalogue, and every new operation has curated prose.

**Verified against a running server**, not by reading: the policy resolves for an instance with MFA off
and changes nothing for it; the lockout guard refuses the last method and restores the previous value; an
enforcement off/on cycle gives a 7-day period where it used to give none; a non-exempt route answers `403
MFA_ENROLMENT_REQUIRED` while `GET /api/auth/me`, `GET /api/users/me` and the enrolment endpoints answer
`200`; enrolment issues ten codes and opens the gate; a recovery code is accepted once, refused the second
time, and a wrong one is refused. `tsc` clean for the API and the shared package, `check-api-docs` and
`check-route-guards` (476 routes) pass, `guard:config` confirms all six new settings are read.

---


Three places had to agree about one setting and only two did: the production template documented
`SMTP_SECURE`, the configuration screens reported it, and the mail transport hard-coded `secure: false`
and never read it. A deployment on port 465 could show *"secure: true"* while every message was attempted
in clear text — a connection that hangs, with a screen saying everything is fine.

- **[Fix]** **The transport honours `SMTP_SECURE`.** `secure: config?.secure ?? process.env.SMTP_SECURE
  === "true"` — a caller's own config wins when there is one, only the exact string `true` counts, and the
  default is unchanged because the variable is set nowhere in this repository. Proved by constructing the
  service four ways and reading the transporter's own options: unset, `"false"` and `"TRUE"` are false;
  `"true"` on port 465 is true.
- **[Update]** **The template says which value is which.** `false` is port 587 with STARTTLS, `true` is
  465 where TLS *is* the connection, and only the exact string counts — so the placeholder stays `false`
  for a relay on 587 and is changed only for one on 465.
- **[Update]** **The env scan's last blind spot is bounded rather than described.** The one computed read,
  `process.env[name]` in `routes/configuration.ts`, takes its names from requirement declarations in
  `packages/shared/src/appConfiguration.ts` — five of them, all already documented. The scan reads those
  declarations, so the section's last line is coverage rather than a warning: *"the one computed read is
  bounded by … which is 5 of the names above"*. A computed read in any other file still warns, because
  that is a new fact rather than a known pair. Preflight returns to **0 failures, 2 warnings**.

---

## 2026.10.10.007 — A screen that contradicts the wire

Three places had to agree about one setting and only two did: the production template documented
`SMTP_SECURE`, the configuration screens reported it, and the mail transport hard-coded `secure: false`
and never read it. A deployment on port 465 could show *"secure: true"* while every message was attempted
in clear text — a connection that hangs, with a screen saying everything is fine.

- **[Fix]** **The transport honours `SMTP_SECURE`.** `secure: config?.secure ?? process.env.SMTP_SECURE
  === "true"` — a caller's own config wins when there is one, only the exact string `true` counts, and the
  default is unchanged because the variable is set nowhere in this repository. Proved by constructing the
  service four ways and reading the transporter's own options: unset, `"false"` and `"TRUE"` are false;
  `"true"` on port 465 is true.
- **[Update]** **The template says which value is which.** `false` is port 587 with STARTTLS, `true` is
  465 where TLS *is* the connection, and only the exact string counts — so the placeholder stays `false`
  for a relay on 587 and is changed only for one on 465.
- **[Update]** **The env scan's last blind spot is bounded rather than described.** The one computed read,
  `process.env[name]` in `routes/configuration.ts`, takes its names from requirement declarations in
  `packages/shared/src/appConfiguration.ts` — five of them, all already documented. The scan reads those
  declarations, so the section's last line is coverage rather than a warning: *"the one computed read is
  bounded by … which is 5 of the names above"*. A computed read in any other file still warns, because
  that is a new fact rather than a known pair. Preflight returns to **0 failures, 2 warnings**.

---

## 2026.10.10.006 — The scan says what it does not cover

The deployment preflight's environment-contract check reported that "all N variables the source reads are
documented". It could not see a read written through a local alias — `const env = process.env`, then
`env.SMTP_PORT` — and a scan that does not see a read cannot promise it is documented. Describing that
limit would have been honest; closing it found something.

- **[Fix]** **`SMTP_SECURE` was reading through an alias and was in no environment file.** A real
  outbound-mail setting: whether the relay wants TLS from the first byte, which is the difference between
  port 587 and port 465, and a wrong answer is a connection that hangs rather than one that fails. It is
  in the production template now with that consequence written beside it, and the count went from 54 to 56.
- **[Update]** **The scan follows the alias, and states what it still cannot see.** `process.env[name]` —
  one file, `routes/configuration.ts` — can read anything, so the check reports those files on a line of
  their own rather than letting the line above claim to have covered them. The comment stripper's `//`
  rule is a line heuristic that does not know a string from a comment; that is noted beside it, with the
  comparison that shows it hides nothing today (three names across four source trees, all of them
  comments).
- **[Update]** **The reply's own claim about re-runs is now marked unobserved.** The round-6 response
  asserted that `containerapp update --image` with the same tag creates a new revision; nothing here has
  been run against a subscription, so that is reasoning from the shape of the API rather than something
  anybody has watched. The paragraph carries the correction, and the dev deploy is nominated as the thing
  that observes it — run one commit twice and record which revision takes the traffic. The scripts were
  already conditional and needed no change.

---

## 2026.10.10.005 — A card scrolled to is no longer scrolled under the bar

The ticket detail's toolbar is pinned, so anything the browser scrolls to — an anchor, a focus, a
`scrollIntoView` — arrived with its top 70-odd pixels behind the bar. Measured on the composer: the bar's
bottom sat 73px *below* the card's top.

- **[Fix]** **`scroll-margin-top` on the ticket pane's cards.** It is the right tool rather than a
  spacer, because it applies only to scrolling and never to layout, so it costs nothing when nothing is
  being scrolled to. After it, the composer lands 23px clear of the bar and its own Note / Reply to
  client / Log time tabs are visible — measured, not eyeballed: `scroll-margin-top: 96px`, card top 219,
  bar bottom 196. Every card in the pane carries it, because whichever card is scrolled to is the one that
  needs it.
- **[Update]** **Scoped to the redesigned interface**, where the bar is actually pinned. The classic
  toolbar scrolls away with everything else, so a margin there would only open a gap above the card —
  checked in both: 96px and clear in the modern interface, 0px and unchanged in the classic one.

---

## 2026.10.10.004 — The composer comes before the list

On a ticket's Overview, the composer — where a note, a reply to the client and a time entry all start —
sat below the client's other open work. That is a list of other tickets between you and the thing you
opened the panel to do.

- **[Update]** **The composer now comes first, and the client's other open work sits beneath it.** The
  order is the client's own brief in the rail, then the composer, then the other tickets, then Activity.
  The list is still there and still read *while* working — it is context for the work rather than the
  work, which is what the order now says.
- **[Update]** **The Help sentence that listed those three in the old order was corrected with it**, and
  now says why the composer comes first. Nothing else moved: the card is the same card, with the same
  five-per-page slice and the same links, and the classic interface never had it — there the composer
  still follows Dates & Times.

---

## 2026.10.10.003 — A gate that is always red

Deployment preflight reported two failures on a clean tree, and a check that is always red stops being
read — the next real finding arrives looking like the fourth reading of an old one. Both are now
finished: one was two critical advisories that nobody had looked at, the other was the check reporting a
variable that does not exist.

- **[Fix]** **Two critical and one moderate advisory against `handlebars@4.7.9`, all in production.** The
  package comes in through `packages/email`, whose range (`^4.7.8`) was never the problem — the lockfile
  had simply resolved to the newest version at the time. 4.7.10 exists, so it is a floor like the others:
  declared in `pnpm.overrides` **and** in `pnpm-workspace.yaml`, because both pnpm 9 and pnpm 10 read the
  list and an override only one of them sees is a floor that stops applying. `guard:deps` caught the first
  attempt for exactly that. The audit is now `4 advisories, 0 in production`, and the renderer was
  exercised rather than assumed: `probe:email` is still 35/35.
- **[Fix]** **The environment-contract check was reporting a variable that does not exist.** The name `X`
  came from two *comment* lines in `packages/shared/src/appConfiguration.ts` that document a flag test by
  naming `process.env.X` — the scan reads source for a pattern and a comment is not source. Comments are
  stripped before the scan now, which is the part worth keeping: the false positive was one name, but the
  habit of a gate that reports things that are not there is what makes people stop reading it.
- **[Update]** **Every variable the source reads is documented, or on a list with a reason.** Six were
  added to the production template — `PUBLIC_BASE_URL` above all, because behind the App Gateway an unset
  one serves an add-in manifest naming an internal host no user's Outlook can reach — and six are on a
  list that carries *why* each is not a production setting (the two aliases of `WEB_ORIGIN`, the three
  probe knobs and the developer-admin seed's password). The list is a `Map` rather than a set of names
  because the reason is the reviewable part, the failure message says what to do about a new name, and the
  pass line reports how many are on it so its size stays visible.
- **[Fix]** **The deploy script's image check failed open.** `if ($runningImage -and …)` meant a query that
  returned nothing — which is also what a CLI error looks like, because the call is `2>$null` — skipped
  the check and promoted the revision unchecked. The workflow version has always stopped on an empty read;
  the script now does too, with its own message, since "could not read it" and "it is the wrong one" are
  different failures. Two gates that disagree about the same condition are worse than either answer.
- **[Fix]** **`preflight.mjs` reports `0 failure(s)`** after all of the above, so a red preflight is a new
  fact again.

---

## 2026.10.10.002 — The revision that was already there

A revision's suffix is `<environment>-<tag>`, so re-deploying the same commit asks for a suffix that
already names a revision. The deploy then found the new revision by filtering the revision list for that
suffix — and the filter would match the one the *previous* run created. Its health passed, traffic moved
to the image that was already serving, and the pipeline went green: a deploy that deployed nothing.

- **[Fix]** **The revision comes from the call that created it.** `az containerapp update` answers with
  the app, whose `properties.latestRevisionName` is the revision this update made, so the suffix filter —
  the thing that could match the wrong revision — is gone rather than guarded. A name that does not end in
  the suffix asked for now stops the deploy with both names printed instead of proceeding quietly.
- **[Fix]** **And the revision is checked to be running the image this run built**, before the health
  gate. The comparison is the image *tag* on the end of the reference, not whole-string equality: the
  service returns the image, and a normalised registry host would make an exact comparison fail on a
  perfectly good deploy — a false failure that would look exactly like the thing it guards. Proved with
  stubs in three cases: a clean update passes, a renamed revision fails, a wrong image fails.
- **[Update]** **The workflow-shell check is in both gates.** It was on the README checklist and in
  `package.json`, and nothing ran it — a check nobody runs would not have caught what it was written for.
  `preflight.mjs` now runs it in its existing workflow section, so a local deploy refuses a tree whose CI
  shell is broken, and `security.yml`'s guards job runs it in CI, which is where the file it guards
  actually executes. It fails rather than skips when there is no bash, and says how to point at one.
- **[Fix]** **The deploy log no longer claims the what-if was reviewed.** Both `what-if` calls discarded
  their output and the script printed "what-if reviewed; applying" — nobody had reviewed anything, and the
  verification checklist asks for the preview to be reviewed *and saved*. The output now goes to
  `out/deploy/what-if-<environment>-<timestamp>.txt`, one file per attempt, and the line says where it is.
  Whether `prod` should stop for a second confirmation is left as the operator's call, because the script
  already stops once.
- **[Fix]** **`TRUST_PROXY` was missing from the production environment template** — my own omission from
  round 3, found by running preflight after wiring the check in. It is documented there now, with the
  reason it is a hop count rather than `true`.

---

## 2026.10.10.001 — A comment is not always a comment

The command that runs `prisma migrate deploy` in CI was rewritten from one string into four tokens, and the
explanation of *why* was written where it seemed to belong: between the continued arguments of the `az`
call. In shell a trailing `\` joins the next line, so the `#` turned the rest of that joined line into a
comment and ended the command there. The invocation arrived with `--image` and nothing else — no command,
no registry, no identity, no secrets — while the flag lines below ran as a command of their own.

- **[Fix]** **The comment moved above the command, and says why it has to stay there.** Nothing else
  changed about the call. Before: the create was invoked with `--image` alone and the step printed
  `--command: command not found`. After: the whole argv reaches `az` and the step reports
  `migration applied`. It would have failed exactly once — in the environment being created — because
  every later run takes the `update` branch and never reaches the line.
- **[Fix]** **The migration gate waits on the execution it started, by name.** `job execution list
  --query "[0]"` is not documented as newest-first, so on a second deploy the newest row is still the
  *previous* run — which succeeded — and the gate could report success before the migration had begun.
  `job start` returns the execution it started, so both the script and the workflow poll
  `job execution show --job-execution-name` instead. `Succeeded` is now the only reading that counts as
  success, and `Failed`, `Degraded` and `Stopped` fail immediately rather than spinning to a timeout —
  the status list read out of the CLI's own enum rather than its documentation.
- **[New]** **A check for the whole class, because nothing else could see it.** `deploy:workflow`
  (`scripts/azure/check-workflow-shell.mjs`) runs every workflow `run:` block through bash: it must
  parse; no `#` line may sit inside a backslash-continued command; no group of flags may have lost its
  command; and, with a stub `az` in place, nothing in the block may try to execute a flag. Proved both
  ways — it fails on the defect with two independent detectors and passes on the fix. What it does not
  prove is written at the top of the file: that `az` *accepts* the arguments is a different question
  with a different method.
- **[Fix]** **The two comments that still named a command that does not exist.** `main.bicep` said
  `az containerapp update --target-port`; it is `az containerapp ingress update --target-port`. The
  other one named the right command but credited it with installing the image, which is the
  `containerapp update`'s job — a sentence that needed tightening rather than deleting, because the
  point it makes (a probe's port lives in the revision template, so an ingress-only change cannot move
  it) is true and load-bearing.
- **[Update]** **The review series is answered.** `PlanDocs/PLAN-030-Review-Round-4.md` is on `main` with
  its answer beside it, and the round-3 review points forward to it. Three findings from round 3 that
  were never answered — the revision suffix on a re-run, the discarded `what-if`, and the prod-only paths
  a dev run cannot prove — are answered in `PLAN-030-Response-to-Review-Round-4.md` §5 instead of being
  carried forward silently. The `infra/README.md` verification checklist gained the new check.

---

## 2026.10.9.036 — The deployment package, run rather than read

The Azure round-3 review had been passed twice by checks that could not have caught what it was checking:
the Bicep compiled and the PowerShell parsed, so every command in the deploy script was "confirmed" by
reading it. Running them changed the answer — five of them cannot complete a deployment as written.

- **[Fix]** **`az containerapp update --target-port` is not a flag.** The deploy script stopped at the
  revision step on every run; the CLI rejects the argument outright. The port belongs to the ingress, so
  the script now makes its own `az containerapp ingress update --target-port` call, which parses and is
  the only place the setting has ever lived.
- **[Fix]** **The health check waited on a property that does not exist.** The loop polled
  `properties.revisionSuffix` on a revision, which Azure never returns — the field belongs to the
  *template*, not the revision — so no revision could ever be seen to become healthy and the step timed
  out on a deployment that had worked. It now resolves the newest revision's **name** and reads
  `properties.healthState`, whose real vocabulary (`Healthy`, `Unhealthy`, `None`) is what it waits on.
- **[Fix]** **`az containerapp revision show --revision` takes the revision's name**, `app--suffix`,
  not the suffix. The workflow was passing the suffix and would have failed on the first deployment that
  got that far.
- **[Fix]** **A new revision was never promoted, and the rollback it printed did the same wrong thing.**
  `ingress traffic set` has no `--revision` and no `--weight`; the weight is written on
  `--revision-weight`. Worse, `--revision` alone is silently absorbed by the CLI as an unambiguous
  abbreviation of `--revision-weight`, so the corrected call would have read `--revision-weight probe` and
  been accepted. Both the shift and the printed rollback now name the revision and the weight explicitly,
  and the workflow publishes the resolved revision name as an output the later steps consume rather than
  re-deriving it.
- **[Fix]** **The migration job ran a program that does not exist.** `job create --command` takes
  space-separated values, and the one-string form is *accepted* by the CLI — it only fails at container
  runtime, which is the one failure mode no amount of argument checking sees. The command is now four
  tokens.
- **[Fix]** **`/api/ready` refused every rollback.** Its deep check required the newest migration in the
  image to equal the newest one applied, which is false after any forward migration — so a rollback
  reported `503` and both promotion gates declined to shift traffic to a perfectly healthy revision. The
  check is now a subset test: every migration *shipped* must appear *applied*, which is what "this
  revision can serve" actually means and what allows a rollback to serve an older schema.
- **[New]** **`TRUST_PROXY` — how many proxies to believe.** Behind Container Apps every request arrives
  from the front door, so with the setting unset the whole instance shared one rate-limit bucket and the
  audit trail recorded the proxy's address as the client's. It defaults to `0` (the behaviour that was
  already there) and is set to `1` by the Bicep — `2` when the ingress is locked to the front door —
  because a hop *count* cannot be chosen by the caller, while `true` can. The address the API resolves is
  exposed at `GET /api/auth/client-ip` and is documented in the API guide.
- **[Update]** **The review is a document in the repository**, `PlanDocs/PLAN-030-Review-Round-3.md`,
  with each defect beside the command that was executed to establish it, the two claims of the previous
  round that were wrong, and the four items left as decisions. `infra/README.md` no longer says the
  `--target-port` flag was confirmed. Its reply,
  `PlanDocs/PLAN-030-Response-to-Review-Round-3.md`, records what happened to every finding — and the two
  places the review's own wording needed sharpening: `--revision` is *silently absorbed* as an
  abbreviation of `--revision-weight` rather than rejected, so a fix that kept it would have set a weight
  from a revision's name; and the one-word migration command **parses cleanly**, which is the one defect
  the parse-level method cannot see. The Bicep templates also compile without warnings now, through the
  standalone `bicep-win-x64.exe` — `az bicep install` truncates at 6.9 MB of ~124 MB.

---

## 2026.10.9.035 — The message a client actually reads, and a window to see it in

The ticket emails were the one thing this product sends that nobody had looked at as a document. The
preview was honest — it renders the API's own HTML, so it showed the real message — and the real message
was shapeless: text against the left edge of the reading pane, facts squeezed into two columns until
they broke mid-phrase, a quoted note indented forty pixels by the browser's own `blockquote` rule.

- **[Fix]** **The mail body had no geometry because the sanitiser would not allow any.** `EMAIL_STYLE_PROPS`
  listed eleven properties — colours, type, `margin-left`, `padding-left`, `line-height` — and not
  `padding`, `margin` or `max-width`. An inline style is the only styling a mail client must honour (a
  `<style>` block is dropped with its content, and Outlook's Word engine ignores one anyway), so a
  property missing from that list is not a safer message, it is a message that arrives shapeless. The
  list is now 34 properties, and the renderer was extended in the same change so the two cannot drift:
  `renderEmail` sanitises its own output, which is why the preview and the delivered mail are the same
  document by construction rather than by hope.
- **[New]** **A mail card, at both widths a reader opens it at.** The page carries a centred, 600 px card
  with an inset body, the masthead a full-bleed bar in the brand's primary, facts stacked as a dim
  upper-case label over a white value instead of pairs in columns, a quote as a tinted box with a brand
  accent rather than an indented paragraph, tables ruled with hairlines and no fixed widths, and the call
  to action an inline pill that never stretches. **Spacing is padding, never margin**, and that is a
  compatibility decision rather than a preference: Outlook renders with Word's engine, which drops
  margins, so a margin is a gap that arrives closed.
- **[Update]** **One column at 375 px, with no media query and no second layout.** Because a `<style>`
  block is dropped, there is no channel for a media query — so the message had to be built to reflow, and
  it is: the card narrows to the screen and each line wraps into it. The markup at 375 px is the markup at
  600 px, which is what stops a phone-shaped second design from drifting away from the first.
- **[New]** **Simulate — the message at both widths in a window of its own.** The Preview panel is
  narrower than the desktop frame and the phone frame together, so at least one of them was always being
  scrolled past. A **Simulate** button on the Preview tab and in the send sheet opens a real window
  (`window.open`) holding both, side by side and resizeable, through the *same* frame component the panel
  draws — so the window cannot show a different message from the panel. It names the message, the record
  the fields resolved against and the subject, so a screenshot of it explains itself in a ticket, and it
  draws the **plain-text part** on the same footing rather than only the pretty half. Nothing is sent from
  it and nothing in it changes the template. When a browser blocks the window the same content is drawn
  over the panel instead — a sheet in the modern interface, a dialog with a heading and a Close in the
  classic one, sharing the state, the frames and the words.
- **[Update]** **The paste panel now tells the truth about what it keeps.** `emailStrip.ts` is the
  editor's copy of the sanitiser's rules, kept so the canvas can show a decision while somebody is typing.
  It still held the old eleven, so it would have promised an author that `padding`, `margin` and
  `max-width` were stripped at the moment the send path started keeping them — a canvas lying about the
  message, which is the exact failure its own header warns against. It carries the same 34.
- **[Update]** **The Help walkthrough was corrected, not just extended.** Its Preview section claimed the
  phone frame was a *different arrangement* in which facts stack — true of the design it was written
  against and untrue of this one, where the message is one column at both widths. The walkthrough now
  says that, explains why there is no media query, documents **Simulate** and carries a screenshot of the
  window.

---

## 2026.10.9.034 — Administration grouped into subjects, and a section that stops moving

Thirteen rows in one flat list, ranked by what you had opened last, with the tail folded into "Everything else".
It worked row by row and failed as a whole: there was no way to learn what the section *contained*, and the list
reordered itself underneath the reader, so "the third one down" was a different page every week.

- **[New]** **A section can declare subjects**, and Administration now does: **Connections** (the C7NC
  connections and models, in the product's own tab order), **Access** (users, roles, API access, single
  sign-on, the sign-in audit), **Identity & messages** (System Branding with its three views, and the Email
  Studio), **Settings** (the settings hub with its two pages, system settings, the audit trail) and
  **Monitoring** (uptime monitors and alert webhooks). Each subject gets its own heading, its count and a
  hairline above it, so the section reads as a table of contents rather than a list.
- **[New]** **A row can lead its section.** Overview is always first in Administration: never reordered,
  never folded, whatever anybody has been opening. It is how the section is entered, and the one row whose
  movement costs somebody their bearings.
- **[Update]** **Ordering and folding are now subject-aware.** Ranking happens **inside** a subject rather
  than across the whole section, so use can still bring a page up without the subjects moving under your
  hand — the list adapts while staying recognisable, which was the actual complaint. A section that declares
  subjects is **not folded**: a heading is a promise that the rows beneath it are that subject's rows, and
  hiding some of them in a bucket at the foot of the panel breaks it. Sections with no subjects behave
  exactly as before, fold included.
- **[Update]** **The ordering note says how to stop it.** "Ordered by what you open" now sits on a line of
  its own under the filter — where it has room to say *the button above keeps it still* — instead of being
  squeezed into the first heading, where it wrapped to two lines against the subject's name. The A–Z button
  was already there; it is now discoverable at the moment somebody wonders why the list moved.
- **[Update]** **Alert Webhooks and Uptime Monitors moved to Administration → Monitoring.** A monitor, the
  endpoint an alert posts to and the board an alert lands on are one story, but they answer two different
  questions: *what is wrong right now* is the board, and *what is watching, and where does it post* is a
  setting. The board kept the rail; the settings now live with the rest of the settings.
- **[Update]** **Service Alerts is a page, like Today.** Its rail row navigates instead of opening a
  three-row panel — a click to reach a list of one destination you had already decided to look at. The live
  count still rides the row, which is why `NavDomain.badgeId` now exists: a domain that is a page has no rows
  to sum, and a count computed from nothing would have quietly become zero at exactly the moment the section
  mattered most.

---

## 2026.10.9.033 — Branding gets a section, and the rail stops saying "Other"

The Branding pages had been added to the navigation tree but never claimed by a domain, so the pane — which
is deliberately honest about being told nothing — collected all four under **Other**, on the rail, below Kumo.
That panel's own copy calls itself "a prompt, not a resting place", and it was right: the rows were not
misplaced, they had simply never been placed.

- **[New]** **System Branding is a section inside Administration**, with the same shape **Configuration**
  already has: a parent row that *is* the Identity page, and the other three views indented beneath it with
  their scope beside them — *each family's own*, *one client's*, *one report's*. The child hints are new: the
  pane's nested rows had one phrase for every group ("in the hub"), which is honest for Configuration's two
  settings rows and would have been wrong for three different scopes of one record.
- **[Update]** **"Other" is gone from the rail** — because nothing is orphaned any more, which is how that
  bucket is meant to disappear. It is deliberately **not** deleted as a mechanism: a section added to the
  tree and not yet claimed by a domain still appears there rather than going silently missing, and the two
  sentences in the Help that explain it are still true. An empty bucket draws no rail row.
- **[Update]** **The three children are named by scope in the pane** — *Documents*, *Clients*, *Reports* —
  through the pane's existing label overrides, so the row above them is not repeated three times. The tree
  keeps the descriptive names ("Document Branding"), which is what the classic sidebar and the breadcrumbs
  read, so the panes differ in wording rather than in structure and both are true.
- **[Fix]** **Every Administration page announced itself as "Configuration".** The redesigned interface's
  working-set bar labelled its first crumb with `getPageTitle("/admin")`, and `/admin` is a real page — the
  Configuration hub — so the section crumb above Service Boards, Service Alerts, the Email Studio, the audit
  log and System Branding all read "Configuration". The bar's own comment says it shows "the section you are
  in", so it now reads the section from the breadcrumb trail, which already knew it. The trail is computed
  once and shared by the three things that draw it.
- **[Update]** The Help names the new structure: the branding walkthrough explains the section and why the
  parent row is the identity page, the Getting Started navigation table names **System Branding**, and the
  twelve places that said "Administration → Branding" now say "Administration → System Branding".

---

## 2026.10.9.032 — One document language, and a brand you can actually change

Five families of document left this application through four different mechanisms in two visual languages, and
none of them agreed with the others: the report kit drew one letterhead, the banded designer drew another, the
invoice was a **dark screen** printed to PDF, the ticket sheet had a heading and no letterhead, and a quote had
no printable output at all. Everything a document said about the company — the wordmark, `Cyber 7 Group, LLC`,
the shield, the contact line — was a literal in a file, so changing a logo meant finding every copy.

- **[New]** **One document language, drawn at true paper size.** A4 (210 × 297 mm) and US Letter, in
  millimetres, always **white paper with dark ink whatever interface theme is in use**, one instance accent
  carried in the *weight* of a stroke as well as its colour so a greyscale photocopy keeps the signal, type in
  points with **nothing below 8.5 pt**, tabular numerals in every money column, hairlines instead of cards, a
  masthead of key figures with their values written beside them, a **running head** and a **footer on every page
  carrying page *n* of *m***, and the closing **basis block** saying where the figures came from. The report
  kit, the banded designer, the invoice, the statement, the quote and the ticket sheet all draw it from one
  module rather than six copies.
- **[New]** **The Branding section** (Administration → Branding, `branding:view` / `branding:manage`): **Identity**
  (upload a logo, an icon and a dark-mode lockup, the wordmark, the company name and tagline, the contact line
  and postal address, the two colours, the document footer and the legal text, the email sender), **Document
  Branding** (what each of eight families wears — letterhead, paper, orientation, footer, page numbers, the
  basis block, title and subtitle, each with Reset), **Client Branding** (a client billed under its own legal
  entity gets its own name, address, logo and colours, and inherits everything it does not override), and
  **Report Branding** (the reports whose appearance differs from their family's default). Every page carries a
  live preview drawn by the real renderer, so what is approved on screen is what prints.
- **[New]** **One brand record, worn by everything.** `EmailBrandKit` is renamed **`BrandKit`** because it had
  stopped being an email setting, and the logo, colours, footer and sender now come from it in every document
  *and* every email, resolved on demand so there is no second copy to drift. A field that is absent from a save
  is left alone and a field sent blank clears, so one screen's save cannot empty another screen's field.
- **[New]** **Uploaded logos** are stored as bytes in `BrandAsset` and served from `GET /api/brand/asset/:id`,
  which is deliberately **public** — a logo has to be fetchable by a mail client that holds no session here. It
  is safe because the asset is addressed by an opaque id and served from the database, so there is no filename
  to trust and no directory to traverse; PNG, JPEG and WebP only, 2 MB, and **SVG is refused** because an
  uploaded SVG is a script with an image's extension.
- **[New]** **A printable quote and a statement.** `quotes.ts` had four handlers and no document output, so a
  quote could not leave the product; it now prints as a proposal. A statement (what a client owes, aged by
  band) did not exist and is what the overdue reminder was missing.
- **[Fix]** **The invoice printed its tax rate 100× too high.** `taxRate` is written two ways in this database —
  invoices carry a percentage (`8.5`), service agreements a fraction (`0.085`) — and the PDF route multiplied by
  100 unconditionally, so `INV-2026-002` printed **"Tax (850.0%)"** beside a correct $680.00 on the one document
  a customer keeps. `reportData.ts` already recorded the convention; the document now uses it and names the rate
  and its jurisdiction: *Sales tax · 8.5% · US · IL*.
- **[Fix]** **The ticket sheet printed internal notes.** It mapped the first ten comments with no `isInternal`
  filter and labelled them, so a hidden internal note was printed — and printed on the copy sent to the client.
  Internal notes are now **built out of the list rather than blanked**, so there is nothing to redact, and the
  sheet gained the ticket's time entries, its attachments, the resolution and pagination.
- **[Fix]** **Every generated PDF was landscape A4** whatever the screen showed, and the print window wrote no
  `@page` size at all so the browser decided. Paper size and orientation are now the document's own properties,
  offered in the output chooser as a per-export choice and settable per family in Document Branding. The dead
  landscape `tablesToPdf` renderer is deleted.
- **[Fix]** **The designed report engine, four defects.** Its group rule was `#22d3ee` at low contrast on white —
  the one line a reader navigates by; its layout was content-box-relative, so **the report printed in the paper's
  corner** instead of inside its 12 mm margins; an unescaped `font-family` in an inline style truncated the
  attribute and the print window drew 16 px black text; and `LaidOutBand.groupValue` was typed and documented
  but never set, so the Excel and CSV **Group column was always blank**. The cyan is gone, the margins are
  right, the type is the report's own, and the Group column has its value.
- **[Fix]** **An invoice that records no line items no longer prints "No line items"** above a real $8,000.00
  subtotal — it states the agreement basis it is actually charging from. Dates are unambiguous (`7 August 2026`),
  and a **part-paid** invoice shows what is outstanding rather than the gross total.
- **[Update]** The invoice document was a dark screen with a `border-radius` card inside it, which is precisely
  what makes a document read as "a screen printed out". It is now paper, with the amount due stated once, a
  **pay block** (how to pay, the reference to quote, what happens next) and a footer on every page.

---

## 2026.10.9.031 — The Email Studio: every message, visible and editable

Every email this product sent was a string literal in `packages/email/src/EmailService.ts`. There was no way to
see what a client would receive, no way to change a word of it, and **no record of a send at all** — so "we
changed the template" had no evidence and "the invoice never arrived" had no answer. Two senders
(`sendInvoice`, `sendTicketAutoClose`) had existed for months with **no caller anywhere**.

- **[New]** **The message registry and renderer** — twelve message keys (eight live, four named with no sender
  behind them and shown as such), one renderer reached over `POST /api/email/preview` so the preview a person
  approves is literally the message that goes out, and a probe that diffs each default against the sender it
  replaced: **35 of 35 identical**, the only normalised difference being `$13,050.00` against the sender's
  `$13050.00`.
- **[New]** **Plain text, always.** Every send is `multipart/alternative` with a text part derived from the same
  blocks as the HTML, so a mail system that strips HTML still delivers a readable message and the two parts
  cannot carry different facts. Links are written out in full, a button becomes `Label: <url>`, tables and fact
  lists become `Label: value`, and an image carries its alt text. The editor shows the text part beside the HTML
  and warns when the two disagree on a figure or a URL.
- **[New]** **The Studio** (`/admin/email`): the twelve messages with their trigger, reader, audience and state;
  a block editor over thirteen block kinds with a live canvas, the fields each block resolves to *for a chosen
  record*, conditional blocks, and reset-to-default with version history; a preview against a real ticket or
  invoice at two widths; and the delivery log with template version, outcome and the reason a send failed.
- **[New]** **Sending a document from the product** — a send sheet with the resolved subject, the recipients,
  the attachments and a Before → During → After account of exactly what was handed to the mailer; and a
  document import that reads a pasted document or a `.docx` (out of its zip, with no dependency added) into
  blocks, with an honest list of what cannot survive conversion.
- **[New]** **`EmailMessageLog`** — one row per attempt, whatever the outcome, carrying the template version
  used. **Deliberately not related to `User` by foreign key**: an account outlives a person's membership, and a
  delivery log that loses its rows when somebody leaves is worse than one that keeps a name it can no longer
  resolve.
- **[Fix]** **The ticket composer appended a hard-coded footer paragraph** to every note it sent; the footer now
  comes from the template and the brand kit.
- **[Update]** **A security-class message is locked by class, not by trust**: a one-time code's body cannot be
  edited at all and the message cannot be saved without its code token, because a decorated sign-in code is how
  a legitimate message comes to look like a phishing attempt.

---

## 2026.10.9.030 — The design language, written down where a model will find it

Three files told a model almost nothing. `AGENTS.md` held only the block Turborepo writes; `DESIGN.md` was a
hand-copied token table that had drifted (it listed the accent as `#00c0f4`, which is *not* what the shipped
colour schemes use, and said nothing about the eight schemes or the two interfaces); and the house rules
lived only in `.github/copilot-instructions.md`, which no model reads unless it is Copilot. So a model adding
a screen had a one-in-four chance of it surviving the interface, theme, scheme and density the user was
actually looking at.

- **[New]** **`DESIGN.md` is now the authoritative design language** — 12 sections, derived from the code
  rather than written beside it. It states the **four axes a change must survive** (2 interfaces × 2 themes ×
  8 colour schemes × 2 densities) and how to switch each while testing; why a colour literal is *the one
  colour the theme cannot reach* (`tailwind.config.js` wraps every token in `color-mix` so an opacity
  modifier works); the token, type, spacing, radius, elevation and motion vocabulary; the two-interface
  pattern with markup for both arrangements; the shared kit (`components/ui/*` props) and the CSS component
  classes with the rule behind each; page anatomy; status and tone; the contrast rules the stylesheet
  records; documents and print as a third surface; a **definition of done**; real anti-patterns; and a map of
  which file is the truth for each question.
- **[New]** **`CLAUDE.md`, `GEMINI.md` and a rewritten `AGENTS.md`** — entry points for the tools that look
  for them, each pointing at `DESIGN.md` and the house rules rather than restating them, so there is one
  source of truth. `AGENTS.md` also lists the five mistakes a model most often makes here and the command
  line to run before reporting a change as finished.
- **[Update]** **`.github/copilot-instructions.md`** gained the design rule as its first section, next to the
  logging, API-document and Help rules it already carried.
- **[Fix]** **The design-token guard now passes, which is what makes it usable.** It was failing on five
  files, and **a guard that always fails teaches a model to ignore it**. It now separates the two cases it
  had been conflating: `LEGACY_ALLOWLIST` is debt to shrink (19 occurrences in 8 files), and
  `STRUCTURAL_EXEMPT` is *not* debt — four files with a written reason each, because there is genuinely no
  theme where they render: the print/PDF document (`reportKit.tsx`), the report page's own paper defaults
  (`PageRenderer.tsx`), the document style fields a person edits (`Inspector.tsx`), and a client's own portal
  accent colour (`ClientDetail.tsx`). One **real** drift was fixed rather than exempted: the report designer's
  selection ring was a literal `#22d3ee`, and is now the accent token.

**Verification:** `check-encoding.mjs` passes over all 753 files; the token guard exits 0 and reports what it
allowed and why; `DESIGN.md`'s every claim was read out of `tailwind.config.js`, `index.css`, `lib/palette.ts`,
`lib/uiFlags.ts`, `hooks/useNavigationStyle.ts`, `components/ui/` and the two canonical dialog components —
no component, class or token is named that does not exist in this repository.

---

## 2026.10.9.029 — Developer → the three screens: the catalogue, the purge and the danger zone

The mockups drawn earlier today are now the section. It sits at the foot of the spine under Kumo, drawn in the
alert colour with a warning mark beside its label, and it is invisible to every role that has not been given
`developer:view` — no rail row, no palette entry, no page behind a typed URL, no Help walkthrough.

- **[New]** **Developer Hub** (`/developer`) — the proposal, not a set of buttons: **34 capabilities in 6
  groups** (data & database · environment & configuration · integrations & outbound · identity & access ·
  diagnostics & repo health · danger zone), each entry answering the same three questions in the same three
  words — what it **Does**, what it **Can destroy**, and the **Safeguard** that makes it acceptable to ship —
  with where it lives today. An entry whose capability has no screen says which command owns it instead
  ("no screen yet — this lives in `pnpm db:seed-coverage`") and carries a `command only` or `proposed` chip,
  because a catalogue that pretends is a wish list.
- **[New]** **Purge Data** (`/developer/purge`) — `db:sample-off` with a surface. The five-step track (snapshot,
  dry run, typed confirmation, purge, receipt), the dry run's real counts, the removed list **beside** the
  preserved list, and the third list that is the reason this screen exists: the **21 models neither list names,
  which therefore survive a purge** — clients, contacts and the product catalogue among them. The confirmation
  arms only on the exact phrase the API publishes plus a written reason, and the receipt names where the record
  was written.
- **[New]** **Danger Zone** (`/developer/danger`) — three irreversible operations, each stating in countable
  terms what it destroys and requiring its own typed confirmation, and each **refusing to arm on a production
  instance** (drawn in the armed-but-refused state, with the sentence explaining the refusal). A read-only card
  records what the audit entry for a developer action carries.
- **[Update]** **A refusal is drawn, not discovered.** A role holding `developer:view` without
  `developer:purge` sees the dry run and the counts and finds the destructive control disabled with the
  permission it would need named beside it — a control that refuses after the click is worse than one that
  never arms.
- **[Update]** **Nothing is rendered as a zero when it could not be read.** Every read has an unavailable
  panel naming the failure ("This could not be read … (404)"), so a dead endpoint cannot masquerade as an empty
  instance.
- **[Update]** **Both interfaces, designed twice.** Modern: a rail you filter, a status track, sentences that
  are themselves the guard, cards you press. Classic: a sortable five-column table, a form with a read-only
  summary grid, a confirmation dialog with a heading and Save/Cancel whose reason field is visible on open, and
  a four-row table whose Action column opens the same dialog.

**Verification:** `tsc --noEmit` exit 0 in both apps; `guard:encoding` and `check-help-links` pass. Against the
live API as a Developer Admin: **8,119 rows across 85 tables** removed, **58 across 13** preserved, **450 rows
across 21 models** left behind, **4,951 audit rows** inside the figure; the health panel reporting 6 pass /
3 fail with each check's own output; the typed phrase matching and the receipt returned. Stubbed to 404 and 502
the panels say what they could not read and show no zeros. A `developer:view`-only account can read the dry run
and cannot arm the purge. Production badge: every card refuses.

---

## 2026.10.9.028 — The Developer Admin role, its two permissions and the people wearing it are a Super Admin's alone

Two permissions, `developer:view` and `developer:purge`, are the only ones whose worst case is removing what
this instance holds, and **Developer Admin** is the role that carries them. The rule settled here is that a
Super Admin is the only person who may see or set either the role or the keys **or the account wearing it**:
every other caller — Admin, Client Admin, any administrator — is shown neither, and is refused by name if
they ask. It holds in four places, because hiding a control is not a gate: the role list, the role write, the
user directory and the security screens. A **Developer Admin is deliberately not a Super Admin for this
purpose**: it holds `role:manage`, and a role that can widen itself is not a role.

- **[New]** **The rule, in one place.** `packages/shared/src/developerAccess.ts` holds the two keys, the
  predicates (`isSuperAdminRole`, `isDeveloperRole`, `wearsDeveloperRole`, `developerPermissionsIn`,
  `withoutDeveloperPermissions`) and the two refusal sentences the API answers with and the interface shows —
  so the words a person reads and the words the API would have said cannot drift. `apps/api/src/services/developerAccounts.ts`
  reads the Developer Admin role ids and the ids and addresses of its holders, so an exclusion is inside the
  *query* rather than a filter over a page of results.
- **[Update]** **`GET /api/roles`** omits the Developer Admin row entirely for anybody but a Super Admin
  (a blanked row reading "0 permissions" would be a lie about the role that holds everything) and strips
  `developer:*` from every *other* role's list, including a custom role that was deliberately given one.
- **[Update]** **`GET /api/roles/:id` answers `404`** for that role rather than returning it, so a single
  fetch is not a way around the list.
- **[Update]** **A role write is refused, not stripped**, when the caller is not a Super Admin and the
  submitted permission list contains a developer key, the target *is* the Developer Admin role, the edit
  would move a role onto `developer_admin`, or the role already holds one of the keys — the last because
  those keys are not returned to that caller, so honouring the edit would quietly withdraw a permission they
  were never shown. Deleting the role is refused the same way. The refusal names the offending key:
  `Refused: developer:view. Only a Super Admin may see or set the Developer Admin role and the developer permissions.`
- **[Update]** **The accounts on that role do not exist for anybody else.** They are excluded inside
  `GET /api/users`'s query, so `total` counts only what the caller can see and `?search=` and `?role=` cannot
  reach one; every picker built on that endpoint — assignees, approvers, managers — inherits the same answer.
  `GET /api/users/:id` answers `404`, and **every write on such an account is refused by name** — profile,
  activation, deactivation, password reset, MFA reset, role and permission override alike: `Refused:
  devadmin@…. Only a Super Admin may see or change an account on the Developer Admin role.`
- **[Update]** **The security screen keeps the same promise.** Sign-in events, live sessions and registered
  devices belonging to such an account are excluded for anybody else — the sign-in log by account *and* by
  address, because a row records what was typed and can be written with no `userId` at all — and their totals
  and group-bys are computed over the same filtered set, so a tile cannot count what the list will not show.
  Revoking a session, revoking every session of an account and removing a registered device are all refused.
- **[Update]** **Manage Roles and Manage Users, in both interfaces.** The Developer permission category, the
  Developer Admin system role in the two role pickers, the role filter, the role-template list and "Select
  all" are all withheld from a non-Super-Admin, and a Super Admin sees the category with a sentence saying
  *why* it stands alone — drawn as a sentence beside the control in the modern interface and as a form note
  under the label in classic. The API is the gate; these exist so the screen never offers a choice that would
  be refused. A refusal from the API is now surfaced in the toast in the API's own words rather than as
  "Failed to save".
- **[Update]** **Documented where an integrator will look**: curated entries for `GET/PATCH /api/roles`,
  `GET/PATCH /api/users` and short notes on the five `/api/security` operations, in `docs/openapi.yaml` via
  the generator; and one FAQ question in the in-app Help.
- **[Fix]** A copy-from-existing-user path (`NewUserDialog`, and the copy dialog on Manage Users) no longer
  prefills the Developer Admin role for a caller who may not hold it, which was one request away from a
  guaranteed refusal.

**Verification:** `npx tsc --noEmit -p tsconfig.json` — exit 0 in both `apps/web` and `apps/api`;
`check-route-guards`, `check-api-docs`, `check-encoding` and `check-help-links` all pass. Against a second API
instance on `:4010`: as **`admin@c7ntax.com`** (Admin) — 6 roles with the Developer Admin row absent and no
`developer:*` in any role, `404` on the role and on the account, 17 users where the Super Admin sees 18, a
search for the address returning `total: 0`, and **13 of 13 writes refused with the offending key named**;
as **`persona.superadmin@c7ntax.local`** — 7 roles including Developer Admin, 18 users including
`devadmin@c7ntax.com`, 25 permission categories including Developer with its explanation, and role create,
update and delete on a role holding `developer:view` all succeeding. In the browser, both interfaces were
screenshotted. The probe role and its writes were cleaned up; the database is back to 7 roles and 18 users.

---

## 2026.10.9.027 — The Developer section's Help, and a gate that keeps it from everyone else

The in-app Help is hand-written in one file, and the Developer section is the one part of it that must not
exist for most people: the rule kept here is that a reader who cannot reach the section finds **no trace** of
it in the Help — not in the sidebar, not in the walkthrough list, not in the Index, not in the configuration
reference, not in the FAQ, and not behind a typed URL. Deleting the words would have satisfied that and rotted
the documentation, so the gate is a permission on the content and the content stays in the array where the
guards can still see it.

- **[New]** **A permission gate on Help content.** `HelpSection`, any block and any table row may carry
  `permission`, and `helpVisible(permission, held)` is the one test — held is the signed-in person's
  effective permissions, the same list the navigation is drawn from, so a walkthrough hidden here and a
  section hidden in the rail are hidden by one decision. Every place that enumerates the sections applies
  it: the sidebar on each Help page, the "On this page" anchors, the four core pages and the Help home list.
  A table whose rows are all gated is not drawn at all, because a heading over an empty body discloses
  exactly what the gate withholds, and a gated walkthrough's route falls to the not-found screen rather than
  rendering. `scripts/check-help-links.mjs` is deliberately still satisfied: it reads the source, so the
  walkthrough is still *listed in the Index* (as a gated row) and still derived on the Help home from
  `HELP_SECTIONS` — the gate is a filter, not a deletion.
- **[New]** **The Developer walkthrough** (`/help/walkthroughs/developer`, gated on `developer:view`): what
  the section is and who can see it (the two permissions, held by Super Admin and Developer Admin and
  deliberately not by Admin, with only a Super Admin able to see or set the role and its holders); the
  Developer Hub as a **catalogue** where every entry answers **Does / Can destroy / Safeguard**; Purge Data —
  the fixed snapshot → wipe → marker order, the 13 `KEEP_MODELS` that survive, the 85 `WIPE_MODELS` that go,
  and the honest part: **21 of the 119 models `schema.prisma` declares are named by neither list and
  therefore survive** (Company, Contact, Product, Quote, QuoteLineItem, ApiKey, SignInEvent, PushDevice among
  them), the typed phrase `purge sample data`, the mandatory reason, and the receipt kept in `SystemConfig`
  under `sample_data:purge:` because the purge deletes `auditLog`; Prepare for Live Deployment — the eight
  steps and the **five states**, with *could not verify* never drawn as a pass; the Danger Zone refusing to
  arm on a production instance; and the closing note that every action, reads included, is written to the
  audit log with actor, IP, operation and reason.
- **[Update]** The walkthrough is listed in the **Index** under a gated Developer heading and in the
  **configuration** reference's access model, and asks the two FAQ questions a holder would ask (why somebody
  cannot see the section; whether the purge is the same operation as `pnpm db:sample-off` — it is).
- **[Fix]** Two pieces of Developer content already in the Help were **ungated** — the "Users, roles &
  permissions" FAQ answer about the Developer Admin role and its Index row under Identity & security — and
  are now gated with the rest, heading included.

**Verified** in both interfaces by signing in to the dev instance: as `admin@c7ntax.com` (Admin) the Help
home, `/help/index`, `/help/faq` and `/help/configuration` contain **zero** occurrences of "developer" and no
empty table bodies, and `/help/walkthroughs/developer` renders the not-found screen; as
`devadmin@c7ntax.com` (Developer Admin) the walkthrough renders with its six headings and sidebar row, the
Index shows the Developer heading with its rows, and the FAQ and configuration show their gated entries.
`npx tsc --noEmit` in `apps/web` exit 0, `node scripts/check-help-links.mjs` passes (93 routes, 33
walkthroughs, 63 links) and `node scripts/check-encoding.mjs` reports no double-encoded text.

---

## 2026.10.9.026 — Prepare for Live Deployment: the plan as a wizard, with `could not verify` as a state

PLAN-030 is a plan on paper — a template that compiles, a script, a workflow, a table of findings and a
go-live bar. What it did not have is a *screen*, so a deployment meant reading **§7** and **§8** and
remembering which of the eight Phase 1 blockers landed, that **2.3** is *deferred by decision* rather than
open, and finding out on the first real run that nothing in the package has ever reached ARM. `/developer/deployment`
is that material with a surface around it.

- **[New]** **The eight-step track**, drawn from the plan's own items: target and naming, parameters and
  secrets, infrastructure (§1, §7), database (§8.1, §8.12), the readiness gate (§8.14), network and ingress
  (§2.1, §8.4, §8.6), sanitisation, and validate-and-hand-off (§3, §8.11, §8.13). Each card carries its
  scope (shared or Azure), a summary, and the one sentence the state came from — `Evidence:`, `Blocked by:`,
  `Owed to:`, `Could not verify:`.
- **[New]** **Five states, not two** — `done`, `attention`, `blocked`, `decision` and `unverified`, with a
  legend that explains each once. **`Could not verify` is a distinct state and is never drawn as a pass**:
  the plan's own second review found a gate that could not see the database, so an unrecognised or missing
  state degrades to unverified rather than to green, and a check that cannot run offers *Mark as could not
  verify* — which records the reason and carries it into the hand-off instead of being pressed into a pass.
- **[New]** **A step in detail** — the checklist with each item's state, the evidence it was checked
  against, its "Skip it:" sentence, and — on the right — where the step comes from, what was read for it,
  and what is still outstanding.
- **[New]** **The sanitisation step PLAN-030 does not cover**, with the two removals kept visibly apart:
  removing **sample data** is the reversible `db:sample-off` purge, behind a snapshot, and links to its own
  screen at `/developer/purge` rather than duplicating it (the destructive controls there arm only for
  `developer:purge`); removing a **customer's real data** is a locked, out-of-band operation with a different
  owner and authority, whose confirmation field is disabled and whose button is never armed. Beside them,
  the surfaces that must not travel — sample and seed data, demo accounts, the outbound-mail sandbox,
  integration credentials, placeholder origins, issued API keys and the authentication conveniences — each
  read from the destination and each reported as `could not verify` when the answers belong to the target.
- **[New]** **The hand-off is a report, not a tick** — what was checked with its evidence, what remains the
  operator's decision with an owner and a place to record the answer, the report read from
  `GET /api/system/deployment`, the §8.11 bar in the order it is held, and **Export report** which writes the
  same document as text. A check that could not run is printed as such, so the exported file is never
  greener than the screen it came from.
- **[New]** **Two designs, one set of handlers** — the modern arrangement is the approved mockup (a step
  track you press, pills, a sheet, a countable sticky footer); the classic arrangement is a form (a numbered
  table of contents with a State column, a `<select>` for the destination, a dialog per step with labelled
  fields and Save / Save draft / Cancel, a **remarks field per unverifiable check**, the sanitisation step as
  two panels with their own headings and their own action, and counts as a labelled row under the table
  rather than a sticky bar).
- **[Fix]** When `GET /api/developer/deployment` does not answer, the page **says what it could not read**
  and draws all eight steps as `could not verify` — no step is shown as done and no check as having run.
  This was verified in the browser: the not-found screen for an account without `developer:view` (a Super
  Admin and an Admin both see it), the four modern states and the classic form against a fixture, and the
  unreadable panel against the endpoint answering `404`.

Verified with `npx tsc --noEmit` in `apps/web` (clean for every file this change adds), and both
`node scripts/lint-design-tokens.mjs` and `node scripts/check-encoding.mjs` pass.

---

## 2026.10.9.025 — The Developer section has an API: the environment it is, the purge it performs, the guards it runs

The Developer section's pages call five endpoints that did not exist, and one of them is irreversible. All of
them need `developer:view`, which is held by **Super Admin** and by **Developer Admin** and subtracted from
**Admin** on purpose, so an ordinary administrator's session is not a purge. The purge needs
**`developer:purge`** *chained on top* rather than listed beside it, because `requirePermission` admits a
caller holding *any* of the permissions it is given.

- **[New]** **`GET /api/developer/environment`** — every name the application declares (the configuration
  registry's `env` declarations, and the API's own direct reads) reported as set or falling back to the
  declared default. **A secret is never returned**: a credential-looking name reports `set`, `withheld: true`
  and a `hint` (the last characters of a long value; a truncated digest for a short one), and the payload says
  so in `secretsWithheld`. Beside it: the environment badge (`NODE_ENV`, production or not, host, port, app
  version, git commit), the flag registry as read-only rows, and the effective `app_settings` per section.
- **[New]** **`GET /api/developer/purge/preview`** — a dry run with real counts in three lists. `removed` is
  the 85 tables `db:sample-off` deletes, in the child-before-parent order it uses; `preserved` is the 13 that
  keep the instance usable; and `unlisted` is the reason the endpoint exists — the **21 models the schema
  declares that neither list names, and which therefore survive a purge** (measured here: 21 contacts, 8
  products, 5 companies, 3 quotes, 5 quote lines, 10 AI actions, 168 sessions, 112 sign-in events). Same
  response: the snapshot a purge would replace, the 4,939 `auditLog` rows inside the removed figure, whether
  the sample dataset is already off, and `requiredPhrase` — the exact string the POST accepts, returned rather
  than hard-coded on the screen.
- **[New]** **`POST /api/developer/purge`** — `{ phrase, reason }`, refused with **400** naming the field that
  failed unless the phrase matches exactly and the reason is a sentence, and with **409** when the sample data
  is already disabled or a purge is already running. What it performs is `db:sample-off`'s own code path,
  called rather than re-implemented. The receipt is the record and it is written where the act cannot reach
  it: the purge deletes `auditLog`, so the audit row goes in *after* the wipe and the durable copy is a
  `SystemConfig` row under the reserved `sample_data:` prefix, named in the response's `receiptPath`.
- **[New]** **`GET /api/developer/health`** — the repository's nine guards, run as child processes from the
  repository root, reported individually with their own output and their duration. Status is three words:
  `pass`, `fail`, `skip`, and a check that could not run is `skip` with the reason — never a pass. A failing
  check never fails the request. On this tree: `guard:plugin` fails, `guard:deps` cannot run without `pnpm`,
  and the design-token lint reports the report-designer's raw hexes.
- **[New]** **`GET /api/developer/deployment`** — PLAN-030 with a surface: eight steps and a checklist whose
  every item names the evidence its state was decided from and what happens if it is skipped. States are five
  values — `done`, `attention`, `blocked`, `decision`, `unverified` — and the run above returns **2 done,
  2 blocked, 2 decisions owed, 2 could not verify**. Items whose answer is in this repository (the migrations
  that exist, `lockIngressToFrontDoor`, `sslmode`, `databaseName`, the readiness endpoint and whether both
  promotion gates ask it) are decided by reading it; everything that needs an Azure subscription is
  `unverified` with the reason, and the two open items come back red: `webOrigin` still a placeholder, and the
  app still connecting as the server administrator.
- **[Update]** **`sample-data-toggle.ts` now calls `services/sampleDataOperations.ts`**, which is also what the
  route calls — one definition of what a purge removes, not two. The CLI's behaviour and log lines are
  unchanged; the shared function `spawn`s the snapshot child (the script's `execSync` would have blocked the
  event loop inside a request) and takes the caller's Prisma client, so a request reuses the server's pool
  instead of opening a second one.
- **[Update]** **`docs/openapi.yaml`, `docs/api-operations.json` and `docs/API.md`** — five curated entries,
  including the purge's refusal rules and what it preserves, and a new subsection in §12 for the surface.
- **[New]** **`POST /api/developer/deployment/records`** — where the operator writes the answer the plan
  cannot: `{ kind, id, note }`, refused with **400** naming the field for an unknown `kind`, an `id` this
  report does not name under that kind (a checklist id sent as a decision is refused rather than filed
  against the wrong list), or an empty `note`. Needs `developer:view` and deliberately **not**
  `developer:purge` — writing down what was decided is not the same act as emptying the database. One
  record per subject, kept in `SystemConfig` under the reserved `deployment:record:<kind>:<id>` prefix
  (`deployment:` joined `RESERVED_CONFIG_PREFIXES` beside `sample_data:`), which no HTTP caller can read or
  rewrite and **which a purge never touches**; recording again replaces the answer (`201` created, `200`
  replaced), and the reply is the whole deployment payload plus `saved`. `GET /api/developer/deployment`
  now returns every answer in `records` and attaches it to its own decision or checklist item as `record`,
  so the screen shows what was decided without a second read.

---

## 2026.10.9.024 — The six Billing report cards generate, and the two reports they were missing

**Billing → Reports** offered six cards that looked like buttons and were not: `ReportCard` was a presentational
`div` with no handler, so nothing happened on any of them. Three of the six named a report that did not exist —
*AR ageing*, *Tax Summary* and *Billing Forecast* were promised by the card copy and absent from the catalogue.

- **[New]** **Aging Report** (`/api/reports/data/billing-aging`) — receivables by age band, measured from each
  invoice's own due date, with a per-client matrix, the largest unpaid invoices and a `basis` block stating the
  bucket rule (`min < days ≤ max`, so an invoice due today is current) and the statuses counted.
- **[New]** **Tax Summary** (`/api/reports/data/billing-tax-summary`) — tax collected and taxable revenue by
  rate, jurisdiction and client, with a `dataQuality` block that names what the figures cannot answer: invoices
  with no rate, a missing jurisdiction, a subtotal that disagrees with its rate, and how much tax the excluded
  drafts carried.
- **[New]** **Billing Forecast** (`/api/reports/data/billing-forecast?months=1–24`) — the months the agreements
  and recurring invoices already in place will bill, each agreement's contributions and occurrence dates, what
  expires inside the horizon, and a seven-item `assumptions` list.
- **[Fix]** **The six cards now generate.** Each card resolves its report through the catalogue
  (`REPORT_BY_ID`) and opens it in place, using **the same viewer as Reporting → Standard Reports** — so filters,
  **Print**, **Export** and the period picker come with it rather than being a second copy that can drift. A card
  with no catalogue entry says so instead of offering an action. The modern interface shows a row-per-report sheet
  with a Generate chip and a **← All reports** way back; the classic interface keeps its card grid, with the whole
  card now a control.
- **[Update]** **`ReportViewer` moved out of `Reports.tsx`** into `components/reports/ReportViewer.tsx`, moved
  rather than rewritten — the extracted code is byte-identical to what it replaced. `Reports.tsx` loses 452 lines
  and keeps unchanged behaviour.
- **[Update]** **The ageing buckets are one implementation.** `revenueReport`'s inline ageing became a shared
  `ageingBuckets` helper, so the Revenue report and the Aging Report cannot disagree about a bucket boundary.
  Verified against the database: both produce 3,518.13 / 0 / 8,680 / 0 / 0, summing to the 12,198.13 outstanding
  total that Revenue reports.
- **[Fix]** **Two reports printed `$NaN`.** A pre-formatted string was being handed to a column that formats
  again — Billing Forecast's *Cumulative* column and Contract Profitability's *Effective rate* column (the latter
  pre-existing, and visible on `/reports/standard`). Both now pass the number through: cumulative reads
  $26,000 → $165,000, matching the horizon total, and the effective rate reads $148.13 for Umbrella Silver
  ($3,518.13 ÷ 23.75h). Every one of the sixteen standard reports was swept for the same defect; none remain.
- **[Update]** **Help** lists the three new reports, disambiguates **Aging Report** from **Ticket Aging**, and
  explains that Billing → Reports runs the same reports in place.
- **[Update]** **`docs/openapi.yaml`, `docs/API.md` and `docs/api-operations.json`** carry the three new
  endpoints, their `report:view` permission and their filters.

**Verification:** both apps type-check clean; `guard:routes`, `guard:api-docs`, `guard:help-links` and
`guard:encoding` pass; the three endpoints return 200 with an admin token and 401 unauthenticated; a fixed-scope
caller asking for a client outside its scope is not widened; the tax groupings each sum to the 1,449.38 collected
(2,499.38 across all invoices less the 1,050 on the excluded draft); all six cards driven in the browser with real
figures and no `NaN`.

---

## 2026.10.9.023 — The report designer's modern interface is the mockup's, and the classic one is untouched

The previous version said the designer's modern arrangement "now matches the mockup". It did not. Three of the
mockup's six pieces had been built — the pane tabs, Fit width and the status bar — and they had been *added to*
the designer rather than replacing its chrome, so the screen still read as the old designer with tabs bolted on.
This is the arrangement itself.

- **[Update]** **One toolbar row of pills, in the order the work is done** — the report's name and its identity
  (*banded · A4 portrait · N data sources · M bands*), how you are looking at it (Design · Preview · Data), how
  big it is (− · the percentage · + · **Fit width**), what the sheet draws (**Grid** · **Bands**), undo and redo,
  and the two writes: **Save** and **Run**. The output actions (Print · PDF · Excel · CSV · Pop out) and the
  autosave state sit at the other end of the same row rather than on a second line.
- **[New]** **A ruler along the top of the sheet**, measured in the sheet's own millimetres at the current zoom —
  so a position on the page can be read rather than eyeballed, which is the difference between a designer and a
  drawing surface.
- **[New]** **Grid and Bands as views you can turn off.** The grid is the millimetre one the snapping follows;
  the band names and heights are the tool's own scaffolding. Turning both off shows the page as the reader will
  get it, which is the check a layout tool owes you and usually charges a preview for.
- **[New]** **Run.** The preview also runs by itself a moment after you stop changing something, so Run is not
  the only way to see data — it is the way to *ask* for it, and both paths call one function, so what Run
  produces and what the debounce produces cannot become two different things.
- **[Update]** **Help** describes the redesigned chrome, the ruler, the two views and the six panes, and says
  plainly that the classic interface keeps the older toolbar and the single scrolling palette.

**The classic interface is untouched**, and that is checked rather than asserted: with
`localStorage.setItem("c7_ui_redesign","0")` the designer renders its previous toolbar ("← Custom Reports", the
mode tab strip, the outputs on their own row), **no pill chips at all**, no pane tabs and no ruler. `Grid` and
`Bands` default to on inside the canvas, so the classic designer — which does not pass them — draws exactly
what it always drew.

**Verification:** `tsc` clean; `guard:help-links` and `guard:encoding` pass. The toggles were proved by
counting what they draw: two gradient layers before (the ruler and the grid) and one after Grid is off; six
band labels before and none after Bands is off; the ruler unaffected by either. The whole screen was
screenshotted and read in the modern interface, and the classic one checked the same way.

---

## 2026.10.9.022 — Two screens rebuilt from their mockups, a sign-in page replaced, documents that look like documents, and the pages that reported "Today"

A day of reimagining: three designs that had been drawn as mockups and approved are now the product, a fourth
screen that had no mockup is now a real page instead of a blank one, and every document this application
generates has been given a letterhead. The classic interface keeps its own design on all of it — that is the
rule, and each one was checked in both.

### The screens that were redesigned
- **[New]** **Contacts (`/clients/contacts`) is a rail, a list and a sheet.** The rail holds both choices the
  page is asked — the view (all, primary, inactive, no email, each with its count and a line saying what it
  means) and the client, whose own weight now sits beside its name (people, tickets, portal on or off).
  Rows carry the person **and** their client, and how many tickets they have raised and still have open. The
  sheet does the work the row cannot: the client and its weight, what they have raised with the newest
  tickets linking through, whether they can sign in to the portal (with the switch, for those who may change
  it), the last contact, and the four things a technician does from here.
- **[New]** **Service Boards (`/boards`) leads with the answer a technician is judged by.** A rail of the
  four boards, each showing what is open, how many were raised and **what the board does when a ticket
  closes, in words** — NOC Alerts reads "closes without emailing the client" from the navigation itself.
  The selected board gets its own page: what it is for, what is on it, the six figures the API returns in the
  board's saved order, the average age set against the promise it makes, a policy track a person can read
  (first response, resolved, follow-up, closed by itself) instead of `30 / 240 min`, and the whole policy
  compared across all four boards. *Edit this board* deep-links to `/admin/boards?board=<id>`.
- **[New]** **The report designer's modern arrangement** now matches the mockup that was built for it: the
  six things a report is made of as six panes (bands in print order, the data sources, parameters, fields,
  expressions, schedule), **Fit width**, and the status bar across the whole width beneath the three panels
  rather than as a caption inside the canvas.
- **[New]** **The sign-in page is replaced in the modern interface.** The way in is now a choice —
  **passkey or password** — above a shared account field, so switching never loses what you typed; passkey is
  offered first where the device has one and the control is not drawn where it does not. Errors sit at the
  field, say how many attempts are left, and move focus. The status of the four services is **one sentence**
  ("All systems ready — the API answered, and so did the database") with the four probes behind a disclosure,
  and it now asks `/api/ready` rather than inferring "Database — Connected" from a liveness probe that never
  touches one.

### Documents
- **[New]** **Every generated document wears the shield.** The icon variation from the brand composite sheet
  (the shield and 7 on its tile, the source of the app icons) opens the page, with the wordmark beside it and
  the 7 in brand crimson — drawn in the PDF as three text runs because the 7 is a different colour, and as an
  image in the print window. **A custom report designed in the banded designer keeps its own header bands**:
  its author placed them, and overruling that is not this feature's business.
- **[Update]** **Generated reports are laid out from their sections instead of being flattened into tables.**
  A KPI block prints as tiles in the tones the screen uses, a bar list prints as **bars** with their values,
  a fact list as a two-column definition grid, and a table with a dark header, hairline rules, right-aligned
  numeric columns and its note under it. Every page carries a footer with the product line and **Page N of M**,
  written after the pages exist so it can count them.
- **[Update]** **A printed ticket wears the same letterhead** (`components/PrintLetterhead.tsx`), so the paper
  a ticket produces and the PDF a report produces cannot drift apart — one set of brand constants in
  `lib/documentBrand.ts` for both.

### The pages that were lying about where you were
- **[New]** **A Not Found screen.** A path the application does not address used to render the shell with an
  **empty `<main>`** — a blank page that reads as a broken build, which cost three debugging sessions in this
  project and is what a stale bookmark or a renamed route leaves a user. It now says what happened, shows the
  address in mono, offers search (⌘K) and a row of real destinations **filtered by the reader's own
  permissions**, taken from the navigation tree so the suggestions cannot drift from it.
- **[Fix]** **`/admin` no longer reports itself as "Today".** The Configuration hub has two addresses and only
  the longer one matches a row in the navigation, so the shorter fell through to the header's fallback.
- **[Fix]** **`/section/<domain>` no longer reports itself as "Today"** either — the section's own name is the
  answer, and it is read from the tree.
- **[Fix]** **A path that addresses nothing now says `Not found`** in the header rather than naming a page the
  reader is not on. Every real route was checked first: the only other paths that reach the fallback are
  `/login` and the two legacy redirects, none of which render inside the shell.

### Fixes found while doing it
- **[Fix]** **A board's follow-up interval could not be saved at all.** `PATCH /api/boards/:id` wrote
  `followUpIntervalMinutes`, which no model has, so the update was refused the moment the field was included —
  and the screens that printed the interval each fell back to their own default and disagreed. The route now
  writes `followUpIntervalHours`, the column the record actually has, and converts a caller that still sends
  minutes rather than dropping it silently. The editor's field is hours too.
- **[Fix]** **The count on the rail.** Collapsed, the navigation pane showed the **Favorites** count and not
  the alert count — the one number on the rail that is about something being *wrong*. Service Alerts now
  keeps its badge when the pane is collapsed and wears it on the icon's own top-right corner, where a rail
  with no labels has room for it; Favorites keeps its count only when the labels are there to read it against.
- **[Fix]** **Signing in failed with the address typed in the wrong case.** `email` is a unique text column, so
  the lookup compared it byte for byte: an account stored as `admin@C7NTAX.com` refused `admin@c7ntax.com`
  with "Invalid credentials" — which reads as a wrong password, and sent somebody looking for a password that
  had never changed. The sign-in lookup is now case-insensitive, as `clients.ts`, `emailToTicket.ts` and
  `portalAuth.ts` already were; the password is still compared exactly. **Two more sign-in paths had the same
  defect and were worse**: passkey sign-in asked for the address in lower case and then matched it exactly, so
  a passkey was unusable for any account with a capital in its address; and single sign-on did the same, where
  a miss with just-in-time provisioning on does not merely refuse the sign-in but creates a *second* account
  for somebody who already has one.
- **[Fix]** **`/kumo/checklists` rendered a `<th>` inside a `<th>`.** `SortableHeader` *is* a `th`, and the
  checklist table wrapped it in another one, which React warns about on every render. The wrapper is gone and
  its padding moved onto the component.
- **[Fix]** **The Customer Portal's address is back on the modern screen.** The tile was rebuilt during the
  redesign and lost the link, the copy button and the line saying where the address comes from — so the one
  card that tells you a portal exists had stopped telling you where it is. `StatCard` grew an optional `foot`
  for exactly this: a figure whose next question belongs on the tile.

**Verification:** `tsc` clean on both apps; `guard:encoding`, `guard:routes`, `guard:api-docs` and
`guard:help-links` pass. The redesigned screens were checked at 1440 **and** 1280 wide with no horizontal
overflow, and every figure on them was read from the running API rather than drawn. The classic interface was
loaded for each redesigned screen (`c7_ui_redesign=0`) and renders its previous design. The board interval fix
was proved against the live API (write, legacy conversion, and the value restored); the checklist fix by the
console warning going and staying away; the Not Found screen by walking a path that does not exist; the
letterhead by capturing the document the code produces and looking at it. The sign-in fix was proved by
signing in as the documented account in four spellings — all four now reach the same record — while a wrong
password is still refused; the rail badge by measuring it against its icon in both pane states.

---

## 2026.10.9.021 — Two files carried three-times-encoded text, and there is now a guard for it

Windows PowerShell 5.1 reads a BOM-less UTF-8 file as CP1252 and writes it back as UTF-8, which turns one
character into three. The mojibake is unmistakable once you know it: an em dash becomes `â€”`, an arrow
becomes `â†’`, a section sign `Â§`. It is invisible in the console (PowerShell prints UTF-8 as mojibake
either way), so it survives review and shows up much later, as a broken parse or a sentence a user reads
twice.

- **[Fix]** **26 lines across `auth.ts` and `console.ts` were repaired**: em dashes, arrows, the box
  characters in the section dividers, and one **user-facing string** the mojibake had reached — a user
  with a lapsed session was told `Session expired â€” sign in again`, three characters of mojibake in a
  sentence they read.
- **[New]** **`node scripts/check-encoding.mjs`** (`pnpm guard:encoding`, wired into the security
  workflow). The test is the **inverse conversion**, not a list of suspicious characters: a line is
  damaged if CP1252-encoding it and decoding the result as UTF-8 succeeds and differs — which is what
  double-encoding *means*, and cannot be true of a correctly encoded line. `--fix` repairs in place,
  UTF-8 with no BOM and the file's own line endings, because a tool about encoding must not cause the
  next incident.
- **[Update]** **Prose that quotes the damage is reported, not "fixed".** `Retrace.md`, `BuildNotes.md`
  and `PLAN-029` each describe this trap by showing an example of it, and repairing a quotation would
  delete the warning — so a line that names the defect it is quoting is left alone and listed separately,
  with its line number, and the guard still exits 0. Every other round-trippable line is assumed to be
  wreckage. `--list` prints the same report without failing.

**Verification:** the repair is 26 changed lines, 25 of them comments, and the dividers in `auth.ts` are
all 71 characters again (they had been three times that). The guard was then proved both ways against a
purpose-built damaged file: it **failed** on it, `--fix` restored the em dash and the arrow **exactly**
(asserted byte-for-byte, including that the file's one already-correct em dash came back untouched and its
line endings survived), and the same proof was repeated after the quotation rule went in — because a rule
that suppresses repairs is exactly the kind that quietly suppresses too many. The repo now reports
**0 damaged lines across 707 files**, listing the lines that quote the damage on purpose — with their line
numbers, because a count is useless when the point is to go and look at one.
`tsc` clean; `guard:routes`, `guard:api-docs`, `guard:help-links` and the new `guard:encoding` all pass.

---

## 2026.10.9.020 — Screenshots in the walkthroughs, where a picture answers faster than a sentence

The Help is written prose, and prose is how you describe a decision — but not how you find a control.
Fourteen of the walkthroughs now carry a picture of the screen they are about, with a caption that does
the pointing the picture cannot.

- **[New]** **A `figure` block** in the Help renderer: the image, then a caption line, themed by the same
  tokens as everything else (so it reads in both schemes) and lazy-loaded, because a walkthrough with
  four figures should not fetch all of them to show one.
- **[Update]** **Fourteen walkthroughs gained a picture**: the navigation rail, the ticket list, the close
  dialog (on the NOC Alerts board, where the default is the interesting part), Service Boards with the
  close-notification switch in view, the configuration hub, the email connector mapping and the Microsoft
  365 app panel, the three sign-in-audit screens, API Access, C7NC, the outage board and uptime monitors.
- **[Update]** **`apps/web/public/help/README.md`** records how they were taken — the running application,
  the dark scheme, 1440 wide at device scale 2, clipped to the region the caption is about — and what to
  do when a screen changes, so the next person re-taking one does not have to guess the recipe.

**Verification:** `check-help-links` passes (88 routes, 30 walkthroughs, 57 internal links — every figure's
path included). Every existing Help text block was diffed against the previous commit and comes out
identical: the change adds lines and alters none, which matters because inserting a figure next to a
paragraph is exactly the kind of edit that quietly eats the end of a sentence — and did, twice, before
the diff caught it.

---


## 2026.10.9.019 — A sign-in audit, live sessions you can end, and the devices on each account

Nothing in the product recorded *who tried to sign in*. A wrong password was a `401` and a counter on the
account's own row, a lockout was a flag on the same row, and the audit trail skips `/api/auth/` entirely
(it would otherwise file a password change as a write) — so "an account was attacked last night" was
answerable only by the person who had been watching the log at the time.

- **[New]** **`SignInEvent`**: one row per attempt, written by **every** way in — the password form, both
  MFA steps, a passkey, single sign-on, and signing out — successes and failures alike. The row carries
  the address typed, the result, the **method** (password, authenticator app, emailed code, passkey, SSO),
  the reason a failure failed, the device parsed from the user agent, the IP address, and the session it
  opened. `userId` is null when the address was not an account: the attempt still happened.
- **[New]** **Administration → Sign-in Audit** (three tabs, all needing `security:manage`).
  *Sign-in audit* is the Entra-shaped log — summary tiles that count the **filtered** window rather than
  the page, a search across address/device/IP/reason, and outcomes of Signed in, Failed, Locked out, MFA
  failed and Signed out. *Active sessions* lists what is signed in now with the person, device, method, IP
  address and last activity, with **Revoke** for one session and **Sign out everywhere** for an account.
  *Devices* lists the passkeys and notification subscriptions each account has registered, and removes
  them.
- **[New]** **`/api/security/*`** — sign-ins with filters and a summary, sessions with a state filter,
  session revocation (one or all for a user), and the device list with two delete routes. `result` is
  validated against the known outcomes, so a typo answers `400` rather than looking like "no failures".
- **[Update]** **A revoked session stops working immediately** — the row is stamped, not deleted, and the
  cookie stops resolving on the next request. The session list reports the method that opened each one, so
  "signed in with a passkey" is visible rather than only "signed in".
- **[Update]** **The audit write is best-effort on purpose**: a sign-in must never fail because its audit
  row could not be written, and a gap is reported in the server log instead of locking people out.

**Verification:** through the running API, not by reading the branch — a wrong password wrote a `failure`
row carrying `Wrong password (attempt 1 of 5)` and `Chrome on Windows`; the right password wrote
`success` with a session id; that session appeared in the session list with its method and device;
**revoking it worked** (`{"revoked":true}` and it left the active list, which also signed the browser out
of the session I had used to test it); signing out wrote a `signed_out` row; and the devices endpoint
returned the registered subscription. The screen was checked in the browser: tabs with counts, tiles
`Signed in 2 / Failed 1 / Locked out 0 / People-devices 1-1`, four rows, and the Devices tab listing its
row with the account and a working Remove. `tsc` clean in both apps; `check-route-guards` (443 routes),
`check-help-links` (30 walkthroughs), `generate-openapi` + `check-api-docs` (440 operations, 79 curated)
all pass. The probe rows were deliberately **kept**: they are the first entries of the audit trail, and
deleting the evidence an audit exists to hold would be the wrong sort of tidy.

---


## 2026.10.9.018 — C7NC wears the same mark as C7NTAX, crimson 7 and all

C7NC was drawn as plain text next to a C7NTAX wordmark that has the 7 in brand crimson — the one
signature the logotype has. A companion product inside the same application reading as a lookalike rather
than a sibling is the kind of drift that is invisible until the two are side by side.

- **[Update]** **C7NC's header is the logotype, not the word.** Same face, same tracking, same crimson
  7, because it is not new artwork: the masks are **composed from the C7NTAX ones** —
  `scripts/brand/build-c7nc-wordmark.py` finds the glyph slots in the existing masks (`C`, the `7` on its
  own crimson layer, `N`, and `TA`/`X` where T and A touch) and lays `C7NC` onto the first four of them.
  The slot columns come from the artwork, so the spacing is the mark's own rhythm rather than a guess;
  an earlier version of that script derived advances arithmetically and produced an uneven, over-wide
  mark.
- **[Update]** **The Outlook add-in's heading got the same treatment** (`C**7**NTAX`, with the 7 in the
  add-in's own `--brand`), because it was the other place the product's name is drawn rather than written.
- **[Update]** `PageHeader`'s `title` accepts a node, so a header that *is* a mark can say so; every other
  page still passes a string.

**Verification:** in the browser, the C7NC header measures 54×19 at `aspect-ratio: 214 / 75`, carries
`aria-label="C7NC"`, and its two layers resolve to `wordmark-c7nc-mask.png` and
`wordmark-c7nc-7-mask.png` — with the 7 painted from the crimson layer, checked by rendering the composed
masks to a preview and looking at them rather than trusting the arithmetic. `tsc` clean; `check-help-links`
passes. The trim was initially taken from the letters layer alone, which clipped the bottom of the 7 — the
preview is what caught it, and the ink is now the union of both layers (214×75 rather than 214×50).

---


## 2026.10.9.017 — A readiness check that can see the database, and a second push that no longer fails

Two findings from `PlanDocs/PLAN-030-Review-Round-2.md`, both about the same thing: a deployment that
reports success, or fails, for a reason nobody could see from the outside.

- **[Fix]** **The second push to `main` would have failed at the migration step.** `az containerapp job
  update` accepts `--image` and **not** `--mi-user-assigned` or `--registry-identity` — those are
  `job create` arguments, and identity and the registry have their own commands. The first push took the
  `create` branch and worked; every push after it took the update branch and died on `unrecognized
  arguments`. Both the workflow and `deploy-env.ps1` now move only the image, which is all that needs to
  move: identity, the registry pull identity, the Key Vault secret reference and the env var are set at
  creation and persist.
- **[New]** **`GET /api/ready`** — readiness as a different question from liveness. It runs a `SELECT 1`
  with a two-second budget and answers `{ "status": "ready" }` or `{ "status": "not-ready" }`, and it is
  what the **readiness probe**, the deploy script's gate and the workflow's gate now ask. `?deep=1` adds
  "the newest migration this image ships has been applied", which only the two gates ask, because on a
  first run the app is created before the migration job.
- **[Update]** **The liveness probe stays on `/api/health`**, deliberately: a liveness check that queries
  the database restarts every replica in a loop and turns a database outage into a crash storm. The
  promotion design rests on a revision proving itself before it takes traffic, and "Node is listening"
  was not that proof — a wrong `DATABASE_URL`, an unreachable server, a rotated password or a failed
  migration all passed it.
- **[Fix]** **The deep check could not fail, and was fixed after it was made to try.** Its first version
  resolved *whether the work finished* instead of *what it answered*, so the migration comparison
  computed `false` correctly and the gate read `true`. It was caught by shipping a fake migration
  directory so the newest migration was definitely unapplied and expecting `503` — the endpoint answered
  `200`. The helper now returns the answer (or `null` on timeout), and the three states are verified:
  healthy `200/200`, unapplied migration shipped `200` shallow / **`503` deep**, probe removed `200/200`.
- **[Update]** `infra/env/.env.production.example` records the `c7_overwatch` → `c7ntax` rename, its date
  and the `ALTER DATABASE … RENAME TO` for a machine that still says the old name — the note the review
  asked for, because the local rename left every other machine and script pointing at a database that no
  longer exists.

**Verification:** `npx tsc --noEmit` clean in `apps/api` and `apps/web`; `check-route-guards.mjs` passes
(436 routes); `validate-bicep.mjs` compiles `main.bicep` and both param files with **0 warnings**;
`deploy-env.ps1` parses with **0 errors**; the workflow YAML parses and its gates use `/api/ready?deep=1`;
`preflight.mjs` reports only its two known pre-existing failures. The endpoint was exercised live against
the dev API in all three states above. **Not run:** the runner's own `az` version, and any real
deployment — both are recorded as compiled-and-exercised, not proven.

---


## 2026.10.9.016 — One Microsoft 365 app, many mailboxes, each filing to its own board

The email connector watched **one** mailbox per row, and the row did not say the one thing an operator
needs when adding the next address: which app it belongs to, and which addresses that app already reads.
Scoping in Exchange is **per mailbox**, not per app, so the second address was never a copy of the first
either — and the client secret, which Entra will not show twice, had to be pasted again for every row.

- **[New]** **`GET /api/email-connectors/m365-apps`** is the map: the registrations this instance
  watches with, every address on each, the board each one files into, and the **Exchange Online**
  commands covering all of them at once — one management scope and one role assignment per address,
  which is how Exchange scopes an application.
- **[New]** **`reuseAppFromConnectorId`** on create. Naming a connector to copy the app from moves the
  tenant, application id and **stored** secret to the new row, so a second mailbox is two fields — the
  address and the board — instead of four values, one of which cannot be recovered. The ciphertext
  travels as it is; a `clientSecret` sent alongside a reuse is ignored rather than stored.
- **[Update]** **The connector list reads as the mapping it is**: `alerts@cyber7group.com → NOC Alerts`,
  rather than an address with *"Board: NOC Alerts"* underneath it. The health line keeps the folder, the
  poll interval, the last poll and the last error.
- **[Update]** **The panel grew an app section** listing each registration with its addresses and their
  boards, an **Exchange scoping** button that shows the commands for all of them, and a copy button. The
  add form gained **Which Microsoft 365 app** — *Reuse …* copies the app already configured and hides
  the credential fields, so the deploy wizard is only needed for the first mailbox.
- **[Fix]** **A reused app no longer skips the mailbox check.** The reuse path passed the app to the
  validator in place of the row, which made "the row exists" true and let a Graph connector be created
  with **no mailbox at all** — a connector that can never read anything. Validation now distinguishes
  "the row exists" from "a secret is stored", and the refusal is the normal one: `user (mailbox)`.

**Verification:** against the running API, not by reading the branch — a second mailbox was created on an
existing app with only `user` + `boardId`, and the stored `tenantId`, `clientId` and **secret ciphertext**
matched the first row exactly; the apps endpoint then reported **one app with two mailboxes**, each on
its board, with two `New-ManagementScope` commands named `C7NTAX-…` and `C7NTAX-…-2`. The refusals were
exercised too: an unknown `reuseAppFromConnectorId` answers **404**, and a reuse with no mailbox answers
**400 … needs: user (mailbox)**. Every probe row was deleted afterwards (5 connectors, including the one
the bug had let through). In the browser: the rows read *address → board*, *Reuse …* hides the
credential fields, and the scoping panel prints both addresses' commands. `tsc` clean in web and API;
`generate-openapi` + `check-api-docs` (433 operations, 72 curated) and `check-help-links` pass.

---

## 2026.10.9.015 — The settings domain is called Administration

The rail called it **Platform**, and everything else called it Administration: the Help ("issue a key on
**Administration → API access**"), `docs/API.md` four times, and the walkthroughs that send a reader to
**Administration → Service Boards**. A label that disagrees with the prose a product ships is a label
that sends people looking for a section that is not on screen.

- **[Update]** **The rail row reads Administration**, and the description under it is unchanged — *"how
  this instance is wired: connections, access, and every setting behind them"* — because that part was
  always right.
- **[Update]** The Help's own **rail row table** now names it the same way, so the walkthrough that
  documents the navigation agrees with the navigation.

**Verification:** the row's `id` is deliberately still `platform` — it is the key the stored row order
and every favorite are filed under, so renaming it would move the row and drop the pins of anyone who
has used the pane. Confirmed in the browser: the rail reads **Administration**, keeps its position, and
`check-help-links` still passes.

---

## 2026.10.9.014 — A board can say that closing a ticket does not email the client

Closing a ticket on **NOC Alerts** emailed the client's contact, and the contact on a NOC ticket is
usually not a person: the tickets arrive from monitoring systems, so the address is a no-reply one and
the closure mail is a message to nobody that still looks like a notification. The board now carries the
answer, and the close dialog starts from it.

- **[New]** **`ServiceBoard.notifyCustomerOnClose`**, on for every board and off for NOC Alerts. Every
  board keeps the behaviour it had, and the one board whose contacts are machines stops mailing them.
- **[New]** **The close dialog opens on the board's answer.** A ticket on a silent board starts at
  **Close silently**, with the reason beside the choices — *"NOC Alerts closes without emailing the
  client, because its tickets usually arrive from monitoring systems at no-reply addresses"* — and the
  primary button reads **Close silently**. It is a default, not a rule: **Email the client** is one click
  away, and taking it overrides the board for that closure.
- **[New]** **The switch is on the board form**, in **Create** (on by default, with the reason it exists
  written underneath) and in **Edit**, and the board's summary line in Administration says when it is off.
- **[Update]** **An absent `notifyCustomer` now means "ask the board"** rather than "email". `PATCH
  /api/tickets/:id` reads the ticket's board when the caller has no opinion; a batch close decides
  **per ticket**, because one selection can span boards; and an explicit `true` or `false` always wins.
  Every caller that sends a value — which is the close dialog, always — behaves exactly as before.
- **[Update]** **A mixed bulk selection still tells the real clients.** The dialog only starts silent when
  *every* selected ticket is on a silent board, so ticking a NOC ticket and a client ticket together
  emails the client ticket rather than quietly closing both.
- **[Update]** The seeded snapshot carries the field, so a database rebuilt from snapshots keeps NOC
  Alerts silent; Help (the close walkthrough, the Service Boards reference, and a new FAQ), `docs/API.md`
  and the curated OpenAPI description of both close routes say what the default does.

**Verification:** through the running API rather than by reading the branch — a probe ticket on **NOC
Alerts** closed with no `notifyCustomer` produced **no email attempt** (nothing in the log for it), the
same close on **MSP Service Desk** produced one, and the NOC ticket closed with `notifyCustomer: true`
produced one, so the override works in the direction that matters. The three probe tickets were then
deleted, with their comments and audit rows (6 comments, 3 audit rows, 3 tickets), and the snapshot files
the poller had captured them into were reverted. In the browser: a NOC ticket's dialog reports
`Close silently=true` with the explanatory line, an MSP ticket's reports `Email the client=true` with no
line, and the buttons read accordingly. `tsc` clean in web and API; `check-route-guards`,
`check-help-links`, `generate-openapi` + `check-api-docs` all pass.

---


## 2026.10.9.013 — The Workable tile is outlined again, and a pin is a ring rather than a border

The orange outline around **Workable** on the board cards had disappeared from every board. It was not a
styling accident and not a data problem: the outline had been *reassigned*.

- **[Fix]** **Workable has its outline back.** The tile arrangement feature — pins, so a tile can lead the
  card — changed that tile's border to `pinned ? orange : transparent`, which removes it from every board
  that has not pinned Workable, which is every board, because a pin only exists once somebody has saved an
  arrangement. **Escalated kept its unconditional outline**, so the page had also become inconsistent with
  itself: two queues that were outlined on purpose, one of them now outlined only by coincidence.
- **[Fix]** **A pin is a ring, and the border means something again.** The two statements are different —
  the border says *what the tile is* (an urgent queue is outlined), the ring says *this one is yours* (you
  pinned it to lead the card) — so they no longer compete for the same pixel. The ring style had been
  written at the time for exactly this and then never used: it was computed on every render and passed
  nowhere, which is what the original code looked like when this was diagnosed.
- **[Update]** **The pinned marker now works on every tile**, including **Avg Age**, which could always be
  pinned and never showed anything for it.

**Verification:** measured on the rendered page rather than read off the class — all four boards report
`border: 1px rgb(234, 88, 12)`, the same as Escalated, where before the change all four were
`1px rgba(0, 0, 0, 0)`. The pin was exercised too: with a tile pinned, the element carries both
`border-orange-600` and `ring-1 ring-orange-500/40` (`box-shadow: rgba(249, 115, 22, 0.4) 0px 0px 0px 1px`).
The diagnostic pin was then removed through **Reset arrangement**, so the database is as it was found —
no board carries a saved layout, and every Workable tile is outlined without one.

---

## 2026.10.9.012 — The first deployment from empty can finish, and the database is named for the product

Two things the deployment package needed before it could be run for the first time, plus a correction to the
plan that would have broken the application's own database access if it had been followed.

- **[Fix]** **A first deployment into an empty environment no longer fails at the image hand-off.** The app
  used to be created against a placeholder image, and the probes could not follow it to the real one: a
  probe's `port` lives in the **revision template**, while `az containerapp update --target-port` moves only
  the ingress. `infra/main.bicep` gained `param createApp bool = true` and a conditional app resource, and
  `deploy-env.ps1` now makes **two passes** on a first run — pass 1 creates everything except the app (the
  registry above all), the image is built into it, and pass 2 creates the app with the real tag, so it is
  only ever created on port 4000 with probes on 4000. A normal redeploy is the single pass it always was.
- **[Update]** **The database is created as `c7ntax`, not `c7_overwatch`** — a stale product name. The name
  now has one home (`param databaseName`), used by both the database resource and the `DATABASE-URL` secret,
  so the two cannot drift. The local development instance was renamed too, with data intact (119 tables,
  104 tickets, 17 users) — a metadata-only rename that needed the dev API stopped for the minute it took.
- **[Fix]** **A wrong instruction in the plan's §8.1, corrected before anyone followed it.** It said to
  create the least-privilege role with `CREATE SCHEMA c7_overwatch AUTHORIZATION app_c7ntax`. That is a
  database, not a schema, and the app's tables are in `public` — following it would have left the
  application with no rights to its own data, presenting as a permissions mystery the day the role was
  switched on. The plan now says to own the `public` schema of the database, with the error kept beside the
  correction.
- **[Update]** **The go-live briefing carries what production will actually be created with** — read from
  the parameter file and the template's defaults — including two values that are placeholders rather than
  choices: the region is inherited from the resource group, and `webOrigin` is still
  `https://app.c7ntax.example.com`, which is passed as `CORS_ORIGIN` and gates every redirect the
  application builds.

**Verification:** Bicep CLI 0.48.1 compiles all three templates with **0 warnings**; `deploy-env.ps1` parses
with **0 errors** and its `-WhatIf` path describes both passes in order; the three cases (first run,
redeploy, dry run) were read back from the code, and a bug in the first version — pass 2 silently never
firing — was caught by the dry run and fixed. The database rename was rehearsed locally rather than
assumed: the API was stopped, the rename ran, and the API answered `/api/health` and served the ticket
queue from the new name afterwards.

**Not proven, and stated as such everywhere it matters:** nothing in this package has been executed against
Azure. The two-pass create, pass 2's first revision and the first `what-if` are compiled, parsed and
reviewed — the dev resource group run is what proves them.

---

## 2026.10.9.011 — A search field keeps its clearance

Every search field in the application drew its magnifier over the first letter of its own placeholder —
*"S🔍arch articles or tags…"*. One line of CSS caused all nineteen of them, and the line was not about
search fields at all.

- **[Fix]** **The redesign's `.input-field` rule no longer sets horizontal padding.** It set a `padding`
  shorthand at a specificity that outranks the utilities, so the `pl-9` that every icon-bearing field
  carries to clear its magnifier was silently replaced by 10px — less than the 28px the icon occupies. The
  rule now sets the vertical padding and the radius, which is what it was for; the horizontal padding
  belongs to the field's own `px-3`, and a `pl-*` beside it is a decision a theme rule should not be able
  to override.
- **[Update]** Plain fields are 2px wider on the left in the redesigned screens as a result — the rule was
  the only thing making them 10px — and every field carrying an icon moves from 10px to the 36px or 32px it
  asked for.

**Verification:** measured on the rendered page rather than read off the class: the icon's right edge sits
at 28px and the text now begins at 36px, an 8px clearance where the overlap was 18px. Swept across twenty
pages — including the classic interface, whose fields were never affected — every field with an absolutely
positioned icon reports a negative clearance, and **zero** overlap. The command palette's search was
already correct: its icon is a flex sibling rather than an absolutely positioned overlay.

---

## 2026.10.9.010 — The light theme's third voice, and the alert panel's loud one

Two things were unreadable in the light theme, and both had the same cause: colours authored for a dark
surface, where near-black around them does the contrast work, left unchanged on white.

- **[Fix]** **The Service Alerts panel's count line** — *"3 services reporting a problem"* — was
  `text-amber-200/75`: **1.25:1** on the panel's pale amber, which is not a faint label but an invisible
  one. It and its critical counterpart now use shades the light theme already maps (7:1 and up), and the
  panel keeps its tone.
- **[Fix]** **The tone chips** — a served SLA, a stale one, a breached one, an active client — measured
  **1.9:1 or worse** on white. They keep their family on the dark theme and move to the 800 shade on the
  light one, the same move the rest of that block makes, with the tint and border left as authored because
  under a dark label a pale tint is the point.

**Verification:** contrast was computed on the running pages — walking each text node's colour against the
first opaque background above it — rather than judged by eye, before and after. The page reported four
failures at 11px-ish (`1.25`, `2.77`, `2.77`, `2.77`); after the change a sweep of fifteen pages in the
light theme reports **zero** below 4.5:1, including the two that were failing. The first sweep also taught
me my own instrument was wrong: it read themed colours as white-on-white because Chromium prints
`color-mix()` results as `color(srgb …)`, which the parser did not know, and it reported every filled
button in the app as a failure until that was fixed.

---

## 2026.10.9.009 — The alert count on Today wears the rail's badge

The count in the Service Alerts panel's header sat on a tinted rectangle of the panel's own colour —
neither the badge the same number wears on the rail, nor a shape the design uses anywhere else, and the
kind of thing you cannot unsee once it has been pointed out.

- **[Update]** **It is the rail's badge now** — a crimson circle with the number in it, the same
  `badge-count` the **Service Alerts** rail row has carried all along. It is the same number on both
  surfaces, so it is now the same object, and the tinted rectangle is gone rather than restyled. The panel
  keeps its severity tone in the header, where the tone is doing the work.

**Verification:** measured on the running page rather than eyeballed — the count renders 18×18px with
`border-radius: 9999px`, `background: rgb(220, 38, 38)` and white text, which is the rail badge's own
geometry and colour.

---

## 2026.10.9.008 — The theme context cannot be read from the wrong copy either

The same latent trap the auth context had, in the theme: `createContext<ThemeState>(null!)` with a bare
`useContext`, and two callers — the header and the account menu — that destructure the result. A consumer
reading a context nothing provides would therefore fail inside its own destructuring, naming a property
rather than the mistake, which is exactly the blank screen the auth fix was written for.

- **[Fix]** **One theme context per tab**, reused across module evaluations, so a hot reload or a duplicated
  copy of the module cannot hand a consumer a context the mounted provider does not provide.
- **[Fix]** **A missing provider names itself**: `useTheme()` throws
  *"useTheme() was called outside `<ThemeProvider>`"*, and the context is typed `ThemeState | null` rather
  than non-null by assertion.

**Verification:** `tsc --noEmit` clean; the app loads with the theme applied (dark, from the stored
preference) and the account menu's appearance controls work; the pinned context is present in the tab
(`__c7ThemeContext`).

---

## 2026.10.9.007 — The auth context cannot be read from the wrong copy

`useAuth()` handed back whatever `useContext` returned, and the context's default was `null!` — a type
assertion standing in for a value. Anything that read it outside the provider therefore failed inside the
caller's own destructuring, as *"Cannot destructure property 'user' of 'useAuth(...)' as it is null"*: a
blank screen, and a message naming a local variable rather than the mistake. This is the fix for the
different-copy case, which is how it reproduced while the auth module was being edited.

- **[Fix]** **One context object per tab.** `createContext` returns a new object every time the module is
  evaluated, and in development the module is evaluated again on every edit — so a re-rendered consumer
  could resolve its import to the new copy while the provider mounted in the tree still belonged to the
  old one, reading a context nothing provides. The context is now kept on the tab and reused, which also
  covers the production shape of the same bug: two copies of the module in one bundle.
- **[Fix]** **A missing provider now names itself.** `useAuth()` throws
  *"useAuth() was called outside `<AuthProvider>`"* instead of returning `null` for the caller to trip
  over, and the context is typed `AuthState | null` rather than non-null by assertion.

The application's own session-expiry path was checked before and after, and is **not** this: a 401 or 440
clears the token and replaces the tab with `/login?reason=expired`, which is what the sign-in page's *"Your
session ended"* is. That path was driven twice and redirects correctly.

**Verification:** `tsc --noEmit` clean, and the app signed in and rendered its protected routes afterwards.
Evaluating the module a second time in a live browser — the thing a hot reload does — leaves the tab's
context object **identical** (`secondEvaluationExportsUseAuth: true, sameContextObject: true,
stillHasProvider: true`), so a consumer from the second copy reads the context the mounted provider
provides rather than an empty one.

---

## 2026.10.9.006 — The recent list says why a page is in it

A visit appeared in **Recent activity** as *Viewed — stayed over two minutes*: a true statement about how
the entry was recorded, and no answer at all to the question the list is asking. It now reads *Viewed —
read at length*, which is the same fact told from the reader's side.

- **[Update]** **"stayed over two minutes" → "read at length"** in the recent-activity list, on the header
  menu and on **My Activity**, which share one entry. The two-minute rule itself is unchanged and is still
  where somebody would go to understand it: the Help's activity table and the My Activity page both
  explain it.

**Verification:** the header menu was opened in a browser and read back — `Tickets · 1m ago · Viewed —
read at length` — with the older entries unchanged.

---

## 2026.10.9.005 — The queue counts in minutes, and the ticket has two dates

One column called **Timestamp** was doing two jobs badly: it showed whichever time was newer, so a
ticket's creation date moved every time the ticket was touched, and the fact that it had been touched
at all was invisible. It is now two columns — **Date Created**, which never changes, and **Last
Updated**, which is the one that moves — both on by default.

- **[Update]** **Timestamp is now Date Created**, reading the ticket's own creation time.
- **[New]** **A Last Updated column beside it**, showing when the ticket was last touched, with the
  relative age in its tooltip beside the exact time (`3d ago`). The CSV export gains the same column.
- **[Update]** **Board and SLA start hidden.** They are still in **Choose Columns**, and the queue's
  columns are the ones a person triages by: who it is, what it is, where it has got to, who has it, how
  long it has waited, and when it was raised and last touched.
- **[Update]** **Both date columns read to the minute** — `9/30/2026, 12:59 PM`. Nobody triages a queue
  by the second, and with two dates side by side the four characters the seconds cost are four
  characters the Summary column can use: the columns narrowed from 176px to 162px each, giving 28px of
  the table back to the summary beside them, with no cell clipped or wrapped at either width. The
  **exact** time is still one hover away — the tooltip keeps the seconds — and **the audit trail is
  untouched**: `Administration → Audit Logs` still records every entry to the second, because that is
  what decides which of two changes to the same field came first.
- **[Update]** **A saved column choice is corrected once, not reset.** A list saved before this change
  has no Last Updated and still carries Board and SLA, so a one-time migration appends the new column
  and removes the two — after which the choice is the reader's again, including putting them back.

**Verification:** `tsc --noEmit` clean in `apps/web`; `node scripts/check-help-links.mjs` passes with the
Help updated. Measured in the browser at the table's own font: `9/30/2026, 12:59 PM` is 126px of text and
the longest plausible stamp (`12/31/2026, 11:59 PM`) 133px, against a 163px cell — **zero cells with
`scrollWidth > clientWidth`** across the visible rows, in **both** interfaces. The migration was run
against a seeded list in both shapes (a default list, and one reordered by hand): the reader's order is
kept, Board and SLA are removed once, Last Updated is appended, and a second load changes nothing. The
audit trail was opened and read back: `12:33:43 AM`, `11:55:05 PM` — seconds intact.

---

## 2026.10.9.004 — Home and Today stand on their own, and the alerts stop whispering

The navigation had a section called **Today** whose contents were Home, the dashboard and My Activity —
three unrelated things held together only by being personal. Home is the landing page, Today is the day's
work, and My Activity is a history rather than a place, so the group was a wrapper around nothing. It is
gone. **Home** and **Today** are now rows on the rail that go straight to their page, and My Activity lives
where the rest of your own things live.

- **[Update]** **Home and Today are sibling rows, and clicking either one navigates.** They are pages rather
  than groups of pages, so their rail rows are links that carry `aria-current="page"` instead of buttons
  that expand a panel — a list of one was a click nobody should have had to make. This is a new shape for a
  rail row (`NavDomain.to`) rather than a special case for two rows: a domain that *is* a page is described
  as one, and the row is drawn and behaves accordingly.
- **[Update]** **Dashboard is now Today**, everywhere it is named: the rail row, the page header, the
  breadcrumb, the page title, the classic tree, and the navigation's own Help. The product already called it
  Today in the places people read most; the rename removes the second name rather than adding one. Its
  settings, references and walkthrough follow the same name.
- **[Update]** **My Activity moved to My Account → My Activity**, under Preferences. It is a person's own
  history rather than a section of the product, so it belongs with your profile and your settings. Its route
  (`/activity`), its page title and its breadcrumb are unchanged, the account menu is one click from
  anywhere, and the header's **Recent** menu still opens it at length with **Show All**.
- **[Fix]** **A rail row that is a page no longer leaves its node unclaimed.** Today stands for the
  *dashboard* node, and the pane's honest-by-default rule ("anything no domain claims turns up under
  *Other*") was dutifully reporting that node — so the rail grew an **Other** row whose single destination
  was the page you were already on, and it took the active highlight while it was there. A page-domain now
  claims the node behind its route, and keeps that node's id so the row's right-click menu — the one that
  pins it — has something to offer.
- **[Update]** **Service Alerts is the loudest thing on Today.** The panel takes the colour of its worst
  alert in its header rather than a neutral one, states **how many services are reporting a problem** in
  words beside the count, carries each alert's severity as a stripe and a tint down its rows, and offers
  **All alerts** at the top. With nothing wrong it goes quiet rather than shouting a zero — the point is
  that an outage is noticed while you are reading the figures, not after you have finished.

**Verification:** the rail was driven in a browser and read back from the DOM — `home` and `today` render as
anchors with `aria-current="page"` on the right one, **Other** is gone entirely (`unsorted` is empty), and
right-clicking the Today row opens its menu as *Today — /*. `/home` highlights Home and nothing else.
Checked in **both** interfaces: the classic tree shows Home and Today with no *Dashboard* and no My Activity,
and the account menu lists My Activity directly under Preferences. `tsc --noEmit` clean, and
`node scripts/check-help-links.mjs` passes with the Help rewritten for all four changes.

---

## 2026.10.9.003 — The auto-sync waits for you to stop typing

The scheduled job that commits the working tree fired on a timer and `git add -A`'d whatever it found — so
it could commit a change halfway through being written. It did: a single feature arrived as an
`auto-sync: <timestamp>` commit plus a real one. A timer cannot know whether anybody is still working, so
the script now asks the filesystem.

- **[Update]** **`scripts/auto-sync.ps1` waits for a quiet tree.** It commits only when no changed file has
  been written in the last four minutes, and logs which files made it wait. The interval is now **5 min**
  instead of 15 — the interval is the *poll*, not the commit, so the effect is a push roughly 4–9 minutes
  after work stops, never during it.
- **[Update]** **The snapshot poller is excluded from that test.** It rewrites `apps/api/src/snapshots/*`
  every few minutes by design, so counting it as "somebody is working" would block the sync forever and
  counting it as "the tree has settled" would commit a half-finished file. It is ignored for the quiet test
  and still committed when the tree really does settle.
- **[New]** **`.git/AUTO_SYNC_HOLD` stops the sync entirely**, for a sequence of changes that must land as
  one commit. It lives in `.git/`, so it can never be committed and never shows in a status, and it
  deliberately does not expire — a guard that silently gives up is worse than one that waits.
- **[New]** **`scripts/register-auto-sync-task.ps1`** registers the task, so the schedule and the reason for
  it are in the repository rather than in one machine's Task Scheduler.
- **[Fix]** **A PowerShell parsing hazard, found by walking into it.** A `.ps1` saved as UTF-8 without a
  BOM is read as ANSI by Windows PowerShell, and the em dash written into a log message became a character
  that ended the string early — taking the whole script with it, with a parse error pointing at a line that
  looked fine. Both scripts are now ASCII, which is the safe form for anything the task runner executes with
  a hidden console.

**Verification:** parse-checked with the PowerShell parser (0 errors) and run for real: the hold marker
stopped it, and a live run reported `skip: 7 file(s) written within 4m, still working — …` against another
agent's in-flight edits, which is exactly the interruption it was written to avoid.

---

## 2026.10.9.002 — The PLAN-030 review, answered: two one-way doors closed the other way

A second review of the applied PLAN-030 hardening found seven issues. Six are fixed here, one is deferred
with its reason written down, and one is pushed back on with evidence.

- **[Fix]** **Geo-redundant database backups are ON in production again.** Azure permits the setting only
  when the server is **created**, so the previous change — off, to save ~$10–30/mo — was a one-way door:
  ever turning it on again would mean a new server and a data migration. The reasoning behind it ("nothing
  to restore to" in the paired region) had the scarcity backwards: the VNet, environment, vault and registry
  are all Bicep, so the compute is reproducible in an afternoon and **the data is the only irreplaceable
  thing this package owns**. Off in dev, on in prod.
- **[Fix]** **The "`SameZone` halves the compute" claim is corrected everywhere it appeared** — the
  parameter's description and five places in the plan. `SameZone` still provisions a billed standby, so its
  compute cost equals `ZoneRedundant`'s; only `Disabled` halves it. The reservation guidance is rewritten to
  match: **×2 the SKU for either HA mode, ×1 only when HA is disabled**. The invented saving was wrong and
  it fed a purchase-sizing figure, which is the worst place for an unverified number.
- **[Fix]** **The CI migration step worked again.** It authenticated as a fresh system-assigned identity with
  no registry pull and no vault access, so **every push to `main` would have failed** before the deploy job
  ran. It now mirrors `deploy-env.ps1`: the app's user-assigned identity, `--mi-user-assigned` and
  `--registry-identity`, `DATABASE_URL` as a `keyvaultref:` secret with `identityref:`, and create-or-update
  rather than create-only.
- **[Fix]** **The first `-Create` run's port mismatch.** The placeholder image used on a brand-new
  environment serves on port 80 while the app is probed on 4000, so the app is now created on the port the
  image it is given actually uses.
- **[Fix]** **The deployment no longer relies on an omitted field.** `traffic` was removed to stop every
  Bicep run handing 100% to a brand-new revision before the health gate saw it; the field is now **restated
  explicitly** from `activeRevision`, which the script reads from the serving revision *before* creating the
  next one. An omitted field is an assumption; this is a decision.
- **[Update]** `preflight.mjs`'s infrastructure-contract guards follow the new intent, and the DNS-zone
  comment states the actual rule (the zone name must *end in* `.postgres.database.azure.com`; a
  VNet-injected server cannot take a private endpoint, so nothing competes for the name).
- **[Update]** `PlanDocs/PLAN-030-Response-to-Review.md` — the point-by-point reply, including where the
  earlier reasoning was wrong and why — and `PlanDocs/PLAN-030-Go-Live-Briefing.md`, a self-contained
  briefing for anyone accountable for the deployment.

**Not done, deliberately:** the least-privilege Postgres role needs a server to create the role on, so it is
the first task after the first deployment and before production data. See the briefing.

**Known and documented, not fixed:** the port change is **not sufficient for a deployment from empty**.
Health-probe settings belong to the container revision, so the swap to the real image leaves the probes on
the placeholder's port and the run still fails its own health gate. The recommended fix — create the app
only against the real image — is a flow change that wants a throwaway resource group, and it is the first
item in the briefing's pre-deployment list.

**Verification:** `node scripts/azure/validate-bicep.mjs` with the real Bicep CLI 0.48.1 → *all three
templates compile without warnings*, exit 0. `node scripts/azure/preflight.mjs` → every
infrastructure-contract check ok, including the new ones; its two remaining failures (the dependency audit
baseline and undocumented environment variables) were reproduced on a pristine checkout at `HEAD` and are
pre-existing. `deploy-env.ps1` parses with 0 errors, and the workflow's extracted shell block passes
`bash -n`.

---

## 2026.10.9.001 — Ticket numbers now name the queue, the client and the ticket — in eleven characters

`INF-1004-1005` was thirteen characters of which the middle four were the client's internal id, and the
first three were the **client's type** — so the prefix read like the board and was not. It is now
`MSP-04-1005`: the board's own code, the client as a short octet, and the ticket.

- **[New]** **A number is `{board code}-{client}-{sequence}`.** The first octet is the board's
  `ticketCode` (already editable at Administration → Service Boards), so the prefix names the queue the
  work was raised on; a board with no code falls back to the client's type, which is what every previous
  number was built from, so an un-coded board keeps working rather than failing. The middle octet is
  `clientId − 1000`, padded to two digits — client 1004 reads `04`, the tenth client `10`, the hundredth
  `100`. It is deliberately not "the last two digits" of the id, which would collide client 1104 with
  client 1004; subtracting the base cannot collide, because `clientId` is unique.
- **[New]** **The sequence is per board *and* client**, so one queue's growth no longer moves another
  queue's numbers, and it continues from the highest number that pair already has rather than from a row
  count — a count goes backwards when a ticket is deleted and hands the same number out twice.
- **[Fix]** **A reply can no longer land on the wrong ticket.** The email connector resolved a quoted
  number with a `contains` lookup, and once numbers are short enough to be substrings of each other
  (`MSP-04-1005` inside a longer one) that would file a client's answer against whichever ticket matched
  first. It now tries an exact match on the number, then on the id, and only then a substring match with
  the longest candidate winning.
- **[New]** **`apps/api/src/renumber-tickets.ts`** brings existing tickets into the scheme, keeping each
  ticket's own sequence so a ticket people know as `…-1008` stays `…-1008`. It is a **dry run unless you
  pass `--apply`**, because a ticket number is the threading key in every email already sent; it resolves
  collisions rather than failing on the unique constraint (earliest ticket keeps the number, the rest move
  along and are reported), and `--apply` writes a map of every number that moved to
  `out/ticket-renumber-map-<timestamp>.json`. Applied to this instance: 109 tickets, no collisions.
- **[Update]** The formatter lives in `services/ticketNumberFormat.ts`, away from the Prisma import, so
  the maintenance script can read the format without starting the API server as a side effect.
- **[Update]** `seed-ticket-samples.ts` writes the same shape, and the board editor's Ticket Code caption
  now explains what the code does ("The first part of every number raised on this board") instead of
  quoting the old two-octet example.
- **[Update]** `HelpDoc.tsx`: a **How a ticket number reads** section (the three parts as a table, why the
  sequence is per board and client, and both conventions showing side by side on an existing instance)
  and a **Renumbering what is already there** walkthrough with the dry-run/apply commands.
- **[Update]** `.gitignore` gains `out/`, which holds generated output from maintenance scripts.

**Verification:** API and web `tsc --noEmit` clean, `check-help-links` green. Driven against the running
instance: the dry run reported 109 tickets and 0 collisions; applying it left 109 tickets all in the new
shape with no duplicates; `INF-1004-1005` (Umbrella Corp, MSP Service Desk) became `MSP-04-1005` exactly as
designed; and every board-and-client pair has unique sequences. The reply-resolution change is verified
against the real `appendEmailToTicket` path, which still reopens a closed ticket and still refuses a reply
from a staff address.

---

## 2026.10.8.080 — Every close asks, the owner hears about a reopen, and receiving fills the inventory

Three answers to "the rest of the ticket-and-purchase-order story": one gap in the closing dialog, one
notification nobody was sending, and one thing a receipt should have been doing all along.

- **[New]** **A batch that closes tickets asks too.** Ticking **Close** in the bulk bar used to close in
  the background and email every contact on the way past. The other ticked actions still run immediately,
  but the closure now waits for the same dialog with the selection on screen — one question, one list of
  names, one answer, whether it is one ticket or thirty.
- **[New]** **A reopened ticket emails its owner.** The client's reply was recorded and the status changed,
  and then nothing happened: a ticket that had come back sat in a queue nobody was told to look at. The
  assignee (or whoever raised it, when nobody owns it) now gets an internal email — who replied, what
  they said, and a link to the ticket rather than an invitation to reply by email. Email, because it is
  the only staff channel that delivers: the WebSocket push in `ws.ts` has no consumer in the interface,
  so a notification that only pushed would reach nobody. New `EmailService.sendTicketReopened` and
  `notifyTicketReopenedByClient`, best-effort like the customer notifications — the client's words are
  already on the ticket and must not be lost over a relay.
- **[New]** **Receiving a purchase order writes the asset inventory.** One asset per unit, named from the
  line and tagged `{poNumber}-{line}-{unit}`, priced at what the line cost, dated the day it arrived,
  carrying the order number and the vendor, and unassigned (`companyId` null, `status` available) until
  somebody puts it at a client. The line's own `assetId` records the first asset it produced. Idempotent
  by order number — receiving an order twice does not double the inventory — and a line of more than 25
  units records 25 and says so in the order's notes rather than inventing a thousand tags nobody will
  ever scan. The response carries `assets.created`, and the whole step is best-effort: the receipt is the
  fact somebody asked for and an inventory that failed to write must not undo it.
- **[Update]** `docs/API.md` §8 and the curated specification say both things an integrator needs to know:
  receiving an order changes the asset inventory even though `asset:create` was never involved, and the
  batch close endpoint is what the dialog sends rather than what a ticked checkbox sends on its own.
  `HelpDoc.tsx` gained the two lines in *Batch actions* and *Closing a ticket*, and a step in the
  Procurement walkthrough.

**Verification:** API, web and email package `tsc --noEmit` clean, `pnpm build` clean, `check-help-links`
and `check-api-docs` green. Driven for real: ticking **Close** in the bulk bar opened the dialog for the
two selected tickets; `PO-1001` was received and produced **12** assets (`PO-1001-01-01`…`-12`, correct
price, vendor, date and order number, line `assetId` set), re-receiving it left the count at 12, and the
12 records were then deleted with the line and the order put back; and a client reply on a closed ticket
reopened it as `customer_reopened` and sent the owner's email — captured by pointing SMTP at a local sink
for one run, which received it addressed to the ticket's owner with the subject
`[INF-1004-1005] Reopened by the client — …` and the client's reply quoted in the body.

---

## 2026.10.8.079 — The same names, spelled the same way, in both interfaces

The two navigation panes disagreed about capitalisation: the tree said **Service Alerts** and **Service
Boards** while the rail beside it said "Service desk" and "Service alerts". A label is a name, and two
names for one destination is a defect whether or not anybody reports it — this pass makes the app use one.

- **[Fix]** **The rail's domains and rows are Title Case**, which is what the tree, the page headers and
  the breadcrumbs already used: **Service Desk**, **Service Alerts**, **My Settings**, **My Activity**,
  **My Preferences**, **AI Inference**, **Two-Factor Authentication**, **Service Board Settings**,
  **Alert Settings**, **Configuration Reference**, **Billing Reports**.
- **[Fix]** **The tree's own stragglers**: "AI models" → **AI Models**, "Companion apps" → **Companion
  Apps**, so the C7NC rows agree with the pages they open.
- **[Fix]** **Everywhere the same name is shown**: the standalone page titles (`My Activity`, `AI
  Inference`, `Two-Factor Authentication`), the C7NC tabs and hub cards, the Assistant's link to the model
  catalogue, the Reports links, the API Access page title, the Settings tab, the system-settings shortcut
  rows, the Recent menu's section labels, the customer-portal fallback name, an API error that names the
  path to connect a model, and the Help walkthrough headings and Index rows for Service Boards, Product
  Catalog, Customer Portal, Standard Reports, Business Reviews, API Access and Single Sign-On.
- **[Update]** **The convention is now written down** rather than inferred: names of destinations and
  features are Title Case; actions, field labels, captions and sentences stay sentence case. That is why
  the dashboard's stat captions still read "Service alerts" beside "Open tickets" — they are a sentence-cased
  set of descriptive captions, not the name of the area — and why a setting registered as "Uptime monitors"
  keeps its own spelling where the page it turns on is **Uptime Monitors**.

**Verification:** web `tsc --noEmit` clean, `check-help-links` green, and both panes read back from the
running app: the rail now shows Favorites, Today, Service Desk, Clients, Delivery, Revenue, Insight,
Platform, Service Alerts, Assistant, Help, My Settings, Console, and the classic sidebar shows Tickets,
Service Alerts, Service Boards, Uptime Monitors, Alert Webhooks, Product Catalog, Audit Logs, API Access,
AI Actions and the rest in the same style.

---

## 2026.10.8.078 — A purchase order is a record, not a row

The Procurement list showed two orders and nothing to press: a row was a label, and the only action was a
**Receive** button on the one row that happened to be shipped. There is now a record behind the row.

- **[New]** **Clicking a purchase order opens it.** The row (and **Enter** on a focused row) opens the
  order: what was ordered with each line's catalog SKU, the totals, the vendor's details, who raised and
  who approved it, and the four dates — created, ordered, expected, received. The Actions column keeps its
  one-click **Receive** and stops the click from opening the record.
- **[New]** **`GET /api/procurement/orders/:id`** returns the record rather than the row, and
  **`PATCH /api/procurement/orders/:id`** gained real status semantics: `ordered` stamps `orderedAt`,
  `received` stamps `receivedAt` (an explicit date wins, so a Tuesday delivery is recorded as Tuesday),
  moving back out of `received` clears it, and the status is validated against the four it may be.
- **[New]** **The lines can be re-priced until the order arrives.** `lineItems` replaces the lines and
  recomputes `subtotal` and `total` from them, in one transaction, refused once the order is `received` —
  a receipt is a record of what arrived. The dialog's totals are computed from the lines rather than
  typed, so the header can never disagree with the body.
- **[New]** **Vendor details are editable from the order they are printed on.** `PATCH
  /api/procurement/vendors/:id` plus the fields a purchase order gets wrong when they are wrong: contact,
  email, phone, payment terms, tax id, website, address, notes. The **New PO** form also takes a vendor
  that is not in the list yet (*…or add a new vendor by name*) and selects it.
- **[New]** **Designed twice, on purpose.** `components/PurchaseOrderDialog.tsx` carries a modern sheet and
  a classic form: the modern one puts the identity on the top line with the total beside it, the status as
  a **track you step along** (pressed, not saved, like a ticket's pills), and the vendor, dates and notes
  in a column beside the lines; the classic one is a form — a status select, an expected-date field, a
  labelled field grid, the lines underneath, and Save. `VendorDialog` follows the same rule.
- **[Update]** **`.github/copilot-instructions.md` gained "Two Interfaces, Two Designs"**, so this is the
  standing rule rather than something to remember: every interface change is designed individually for the
  modern and the classic interface, with the pattern named and both to be screenshotted before it is called
  done.
- **[Update]** `HelpDoc.tsx`: a new **Procurement & Purchase Orders** walkthrough (the list, opening an
  order, moving it along, fixing the lines, vendor details), an Index row, and the assets row now names
  vendor details.

**Verification:** API and web `tsc --noEmit` clean, `pnpm build` clean, `check-help-links`,
`check-api-docs` and `check-route-guards` green. Driven in the browser in both interfaces: a row opens the
record, **Mark shipped** advanced the status and the list behind it, **Edit lines** re-priced 12 × $200 to
10 × $200 and the totals followed, a vendor's phone number was edited and saved through the record, and
every one of those changes was then put back so the demo data is as it was.

---

## 2026.10.8.077 — Closing a ticket tells the client, and a reply brings it back

Closing used to be one silent field change with a generic "Status updated" email attached. It is now the
two things it actually is — the ticket settles, and somebody tells the client — with the choice asked for
rather than assumed, and with a way back for the client who disagrees.

- **[New]** **A closing email that invites an answer.** `notifyTicketClosure` replaces the generic status
  notification for `closed`, `resolved` and `cancelled`: it carries the closing note and it ends by
  telling the client that a reply reopens the ticket. The auto-close worker uses it too, so a ticket
  closed for silence says *that* rather than claiming the work is finished.
- **[New]** **`customer_reopened`, and a client reply that sets it.** The email connector's reply path now
  reopens a settled ticket when the reply comes from one of **the client's own contacts** — and only then:
  a reply from a vendor, a colleague or one of our own staff is recorded without reopening, because a
  technician answering into a monitored mailbox is the most likely way for a closed ticket to reopen by
  itself. The reply is stored before the status changes, `closedAt`/`resolvedAt` are cleared, and an
  internal line records what happened. Kept as its own status rather than folded back into `in_progress`
  so the queue distinguishes work that was never finished from work that was declared finished and was not.
- **[New]** **Closing asks, in both interfaces.** `CloseTicketDialog` — from the list's right-click
  **Close ticket**, a row's menu, the bulk **Quick Actions**, or the record's **Status** pill — offers
  *Email the client* or *Close silently*, Closed or Resolved, and a closing note that becomes both the
  body of the email and a customer-visible comment in the thread. The choice is remembered per browser
  and the primary button says what it will do (**Close and email the client** / **Close silently**). The
  modern sheet is two decisions with their consequences beside them; the classic form is a labelled field
  list with a checkbox, as every other classic dialog is.
- **[New]** **`notifyCustomer: false` and `closeNotes` on the API**, on `PATCH /api/tickets/{id}` and on
  `POST /api/tickets/batch` (one note written to every ticket in the batch) — the same opt-out for an
  integration, and documented in `docs/API.md` §8: an integrator that closes tickets should expect them
  to come back on their own.
- **[Update]** Closing and resolving now stamp `closedAt`/`resolvedAt`, and reopening clears them — the
  same fields the event gateway and the auto-close worker already write, so "how often did this come
  back" is answerable from the record.
- **[Update]** `HelpDoc.tsx`: a **Closing a ticket** walkthrough, three FAQ answers, and the Index row.
  `lib/ticketStatus.ts` and `index.css` gained the new status's label and colour token in both themes.

**Verification:** API, shared and web `tsc --noEmit` clean; `pnpm build` clean; `check-help-links`,
`check-api-docs` and `check-route-guards` green. Driven in the browser: the dialog opens from the
right-click menu in both interfaces, a silent close wrote the customer-visible note and set `closedAt`
with no email attempted, and the reopen path was exercised against the real `appendEmailToTicket` — a
reply from the client's contact reopened the ticket as `customer_reopened` with `closedAt` cleared, a
reply from a staff address left it closed, and the test's own comments were removed afterwards.

---

## 2026.10.8.076 — The queue reads in one line, and its columns are yours to size

The ticket list was folding ticket numbers, board names, clients and timestamps over two and three
lines. A queue is read by scanning it, and a row three lines high cannot be scanned — so every cell is
now one line, and the widths are measured rather than guessed.

- **[Fix]** **No cell wraps.** The table is `table-fixed` with `whitespace-nowrap` and an ellipsis on
  every cell, so a long value is trimmed at the column edge instead of becoming a paragraph, and the
  full value is in the tooltip. `text-ellipsis` alone is not enough — the old table had no `table-fixed`,
  so the layout gave each column a share of the panel and let the text fold to fit it.
- **[New]** **Columns are fitted to their content.** Auto table layout is the only thing that knows how
  wide a rendered badge, an uppercase header or a 12px timestamp really is, so the list is laid out once
  at its natural width in a `useLayoutEffect`, each column is read back at the width its own content
  asked for, and those numbers become the baseline. The widest value wins, so paging into a page with a
  longer client name grows that column and paging back does not shrink it again.
- **[New]** **Columns are resizable.** Drag the right edge of any header to set a width; double-click the
  edge for that column to go back to the measured one. Widths are saved per user (`c7_ticket_column_widths`)
  beside the visibility and the order, and are clamped to 56–720px. The resize edge lives inside the
  header so it travels with the column when the order changes, and it swallows the pointer so a resize is
  never mistaken for the header's reorder drag or its sort click — which is why the reorder action needed
  a guard rather than a second hit target.
- **[New]** **"Fit columns to content"** in Choose Columns forgets every width the user has set, which is
  the only way back from a table sized entirely by hand.
- **[Update]** **Smaller type and tighter padding.** The list is a size down (`text-xs`) with 8px cell
  padding rather than 12px, which is most of what lets the same columns fit in less width; the header's
  drag grip is pinned to the inside of the header rather than sitting in the flow, so a column's width is
  decided by the data in it rather than by the size of the controls that live in its header.
- **[Update]** `HelpDoc.tsx`: the *Ticket list columns* walkthrough and its Index row now cover widths
  and the fit, and a FAQ answers why rows stopped wrapping.

**Verification:** `tsc --noEmit` clean, `pnpm build` 6/6; driven in the browser at `/tickets` in both
interfaces — rows one line high with no cell clipped (checked per cell, `scrollWidth` vs `clientWidth`),
a header-edge drag persisted through a reload, a double-click restored the measured width, a header click
still sorted, a header drag still reordered, widths stable across pages, and the help-links guard green.

---

## 2026.10.8.075 — Geo-redundant backups off, and the reservation list

Two review comments on PLAN-030, assessed in §9 of the plan — and one of them applied, because it is
complete on its own and saves money on the next deployment.

- **[Update]** **Geo-redundant Postgres backups are off by default** in both environments, exposed as
  `postgresGeoRedundantBackup` so it is one word to turn back on. The reasoning is written beside the
  parameter: the application runs in one region, and a geo-redundant backup buys a restore into the
  paired region — where this template puts no compute, no ingress origin and no vault, so the recovery
  would be a rebuild this package cannot perform. It is the second half of a disaster plan whose first
  half has not been written.
- **[Update]** **Zone redundancy is deliberately kept, and the parameter now says what it costs.**
  `postgresHaMode` documents that `SameZone` halves the compute (~$130/mo) and survives no
  availability-zone failure — a different thing from geo redundancy, and a failure this application
  does meet.
- **[Update]** `PlanDocs/PLAN-030` gained **§9**: the three things this template calls redundancy
  separated into a table with their real costs and verdicts; the caveat that geo-redundant backup may
  only be settable at server creation; the reservation shopping list with the instrument that applies to
  each SKU, the saving, and the trigger for buying it; and why none of it is encoded as code — a
  reservation is a purchase against a live subscription, priced per SKU and region, and the HA and
  ingress decisions that size it are still open. §4's storage-and-backup line now reflects local-only
  retention.

**Verification:** `node scripts/azure/validate-bicep.mjs` with Bicep CLI 0.48.1 → *all templates compile
without warnings*, exit 0, after the change. No application code touched.

---

## 2026.10.8.074 — PLAN-030 applied: the Azure deployment package, hardened

The plan was reviewed, then implemented against its own recommendations, with four deliberate
deviations recorded in the templates. The templates now **compile** against the real Bicep CLI.

- **[Fix]** Deployment blockers: a **Consumption workload profile** on the Container Apps environment
  (its subnet is delegated, so consumption-only would be rejected); a **user-assigned identity** that
  holds AcrPull and Key Vault Secrets User and is attached to the app and its `secretRef`s, removing an
  ordering cycle that made the first revision unable to start; every subnet declared **inline once**,
  so a redeploy no longer detaches and reattaches the Postgres NSG; the server now depends on its DNS
  link; and the ACR retention policy applies **prod only**, because it is a Premium feature and dev is
  Basic.
- **[Fix]** **Bicep no longer owns the running image.** `imageTag` is required with no default,
  `deploy-env.ps1` passes the tag the app is currently running (or a public placeholder when nothing
  is), and the template declares **no traffic rule at all** — `latestRevision: true` re-applied on
  every run would have made the script's 0%-traffic health gate fiction. Traffic belongs to the
  promotion path alone.
- **[Fix]** The migration job uses the user-assigned identity (`--mi-user-assigned`,
  `--registry-identity`), creates or updates idempotently, and takes `DATABASE_URL` from Key Vault
  through a secret reference rather than a plaintext password.
- **[Fix]** Security: `@minLength` on the three secrets and `readEnvironmentVariable` in the parameter
  files, so a missing value fails at compile time instead of writing an empty signing key into Key
  Vault; a Key Vault **private endpoint** with its own zone group and `publicNetworkAccess: Disabled`
  **in prod only**; the Postgres NSG admitting 5432 from the app subnet, allowing intra-subnet traffic
  and then denying `VirtualNetwork`; Key Vault and ACR audit events to Log Analytics with `pgaudit`
  enabled; Postgres and ACR on current API versions; zone redundancy on the prod environment; and a
  Front Door ingress restriction behind a switch.
- **[New]** `infra/README.md` gained the **secret rotation runbook**, the ingress checklist
  (`X-Azure-FDID`, the `GatewayManager` and `AzureLoadBalancer` rules App Gateway will need), and the
  cost line for the new dev private endpoint. `preflight.mjs` gained a regression guard for the two
  items most likely to come back: it fails if `imageTag` regains a default, if a `traffic` rule
  reappears, if `activeRevisionsMode` is not `Multiple`, or if a parameter file carries an empty
  secret.
- **[Update]** `PlanDocs/PLAN-030` records what landed, the four deviations, and a new **§8
  recommendations** section for the open items — the least-privilege database role, the deferred ACR
  endpoint, which secrets should expire, `verify-full`, the cost envelope, the ingress decision and the
  go-live bar.

**Deliberately not applied** (written up in the plan and the README): the least-privilege Postgres
role and Entra database auth (an application and SQL change), the prod ACR private endpoint, secret
expiry for the two secrets whose rotation is not automated, `sslmode=verify-full` (needs the CA bundle
in the image), NSGs on the remaining subnets, the migration job declared in Bicep, and the cost and
ingress decisions themselves.

**Verification:** `node scripts/azure/validate-bicep.mjs` with Bicep CLI 0.48.1 →
*all templates compile without warnings*, exit 0. `node scripts/azure/preflight.mjs` → the new
*infrastructure contract* section is green on all five checks; its two remaining failures are
pre-existing and environmental (undocumented variables already present at HEAD; the pnpm-dependent
checks). `deploy-env.ps1 -WhatIf` runs end to end for dev and for a prod promotion, the emitted ARM
shows 0 duplicate subnet resources and no traffic property, and no TypeScript was touched so the web
and API suites are unaffected.

---

## 2026.10.8.073 — The designer in its own window, and autosave

- **[New]** **Pop out** in the report designer opens it in a window of its own — the rail, the bar and
  the working set are left behind deliberately, and the height they occupied goes to the sheet. The
  window it was popped from steps back with an explanation rather than letting two windows edit one
  document: **Bring it forward** returns to the other window, **Return it to this window** closes it.
- **[New]** **Autosave, in two layers.** A draft is written to this device a second after the last
  change — no request, so nothing you type waits on the network — and the report itself saves a few
  seconds later, silently, once it validates and exists. The toolbar states which: *Draft saved 22:27*,
  *All changes saved 22:27*, *Not saved yet* for a report nobody has created, or *Fix N errors to save*.
- **[New]** A draft that differs from the report is **offered, never applied** — *This device has a
  draft of … from 8 Oct 2026, 22:27* with **Restore it** and **Discard the draft**. Silently replacing
  your work is the one thing autosave must not do.
- **[New]** **Leaving with unsaved changes asks.** Looking away raises *You looked away with unsaved
  changes* with **Save it now** / **Save a draft** / **Keep editing**, and closing or reloading the
  window gets the browser's own question — the draft is already on the device by then.
- **[Update]** Help: *Its own window, and autosave* added to the Designing a Report walkthrough.

**Verification:** `tsc --noEmit` clean. In the browser: **Pop out** is present and
`?popout=1` renders the designer with no rail, no brand and no working set (**rail: false**, **brand:
false**, **working set: false**, designer present); editing an element wrote
`c7_designer_draft:new` to `localStorage` and the toolbar changed to *Draft saved 10:27 PM*; reopening
the page offered *This device has a draft of Tickets — Simple list from 10/8/2026, 10:27:12 PM* with a
**Restore it** button; and navigating away with unsaved changes was stopped by the browser's own
beforeunload question. The status line reads *Selected the report · Band height 33 mm total*.

---

## 2026.10.8.072 — The rest of the application, and the report designer

Seven workstreams in parallel, written against one specification; then the designer itself, which is
the last page because it is the one that proves the model.

- **[New]** **Settings and configuration** read as hubs: a search over every section *and field label*,
  a chip stating how many settings there are, a left rail of the areas with the current one lit, and a
  row per setting — name and note on the left, control in the middle, an explicit **Save** on the right
  — with a figures band where the page already computed one. `data-hl` anchors, the save paths and the
  deployment's-value fallback are untouched.
- **[New]** **Kumo's nine pages** (hub, assets, asset detail, documents, passwords, domains,
  organizations, organization detail, configurations) gained a figures band, views with live counts,
  count lines, state chips and footers — inside Kumo's own branding, not the service-desk chrome. The
  credential reveal logic and the secrets are untouched.
- **[New]** **The utility surfaces** — checklists and a checklist record, an asset record, calendar,
  PTO, my activity, the console, the assistant, help, What's New, AI Actions, home, section landings,
  the finance dashboard, C7NC and C7 Flexpoint — took the same treatment at the depth each deserves:
  views and footers where they hold lists, figures where they hold numbers, chips for state, and for
  the console, the assistant and the help articles only a header and figures, because those are tools
  and reading surfaces rather than pages.
- **[New]** **Reporting, Custom Reports, the Product Catalog, the Knowledge Base and Service Alerts
  settings** gained views with counts, count lines, footers and — in Reports — the period as a strip
  (This month, Last month, This quarter, Last quarter, All time) that writes the same `from`/`to` the
  date fields do, with the way into the designer beside it.
- **[Update]** **The report designer** kept its layout — it is a tool, three panes and one document —
  and gained the identity line the mockup puts in the toolbar (*banded · A4 portrait · N data sources ·
  N bands*) and a **status line** under the canvas stating what is selected, how tall that band is, how
  many rows the last run returned, how many pages it lays out to, the page setup, and whether the
  document has anything wrong with it.
- **[New]** A **working WYSIWYG designer mockup** was built alongside it in the session workspace
  (`files/report-designer-mockup.html`): an A4 sheet with a ruler and a millimetre grid, eight bands you
  can select, drag and resize, a field palette you drop onto a band at the millimetre the pointer is at,
  a properties panel bound to the selection, inline retyping, arrow-key nudging, undo/redo, page setup
  and zoom — and a preview that unrolls the grouped bands over real rows, computes its aggregates
  (`count()`, `count(asset.state = "replace")`, `sum(asset.replacement_cost)` → *8 assets, 3 out of
  cover, $33,960*), repeats the page bands and paginates. It is the specification for the designer's
  behaviour, not a picture of it.

**Verification:** `tsc --noEmit` clean across `apps/web`; `pnpm build` all packages; in the browser,
in the redesigned interface: **Users** *All 17 · Active 17 · Inactive 0 · Without 2FA 17 · Locked 0*
with a footer, **Roles** *6 roles · 17 users assigned · 283 permission grants*, **Billing** (12 chips,
footer), **Service Alerts** (*3 alerts*), **Boards** *103 open · 88 stale · 7 escalated*, **Kumo assets**
*210 assets* with a footer, **Settings** *10 settings · each one says where its value comes from*,
**C7NC** *5 services · no model · 1 companion app — 5 need attention*, **Custom Reports** (4 chips,
footer), **Contacts** and **Assets** as in the previous entries. Classic renders its original markup in
every one of them.

---

## 2026.10.8.071 — The working surfaces, onto the design system

Six passes' worth of pages, written against the same specification the earlier pages were: views with
counts above a list, a count line, a countable footer, state as a chip, figures leading a band.

- **[New]** **Users** — views (All, Active, Inactive, Without two-factor, Locked) with live counts, a
  count line (*N users · N without two-factor*), a Locked chip, and a footer. **Roles** — a four-figure
  band (roles, users assigned, permission grants, roles with no members), five views (All, Default,
  Full access, No members, No permissions) and a Default chip on the row and the detail header.
- **[New]** **Billing** — each section now reads as its own list: invoices get a figures band, seven
  views, a search over number and client, a count line stating what is outstanding, chips by state and
  a footer stating what the view is worth; agreements, payments and time & expenses follow the same
  shape, with time reading *N shown · Xh logged*.
- **[New]** **Service Alerts** — views (Active, Resolved) with counts, a source filter, a count line
  (*N alerts · N outage · N degraded · last checked …*) and, underneath, a **Monitors** panel listing
  what raises those alerts with its state as a chip. There is no Acknowledged view because the model
  has no such state, and no ticket column because an alert carries no ticket link — an invented filter
  is worse than a missing one. **Boards** gained a four-figure band from `/boards/metrics` and a stale
  chip on each board card; **Monitors** gained views (All, Up, Warning, Down), a count line and a state
  chip, deriving each monitor's state from the poll's own verdict rather than inventing one.
- **[New]** **API access**, **Webhooks**, **Single sign-on** and the **Customer Portal** settings gained
  a figures band, views with counts where they hold rows (keys by state, webhooks by delivery health,
  sessions by state), chips, tabular figures and footers. The **Outlook add-in** page — a documented
  surface rather than an app page — took the header and panel treatment only.

**Verification:** `tsc --noEmit` clean for every file above; the page-by-page reports are in
`Retrace.md` under Prompt 314. Classic renders as before in all of them: every change sits inside a
`redesign` branch and the classic branch is the original markup, so no table, dialog, menu, export,
permission or request changed.

---

## 2026.10.8.070 — Quotes and the pipeline

- **[New]** **Quotes** gained views with counts for each state (**All 3 · draft 1 · sent 2 ·
  accepted 0 · declined 0 · converted 0** — five figures, because the state that matters is whether
  it has been invoiced), a line stating what is *not yet invoiced*, a status chip per row instead of
  bare text, tabular amounts and a footer range.
- **[New]** **Sales Pipeline** now states each column's **value** beside its count — *qualified 2 ·
  $46,600* — and puts the **client's name on every card**, joined from the client list the page
  already loads. A deals board whose cards do not say who the deal is with is a board of names and
  numbers, and the count line *8 deals · $70,030 weighted* now sits in the toolbar where the mockup
  puts it.

**Verification:** `tsc --noEmit` clean; in the browser Quotes reads *All 3 · draft 1 · sent 2* with
*3 shown · $11,892 not yet invoiced* and three rows, and the pipeline's six columns read *prospect 1 ·
$7,800*, *qualified 2 · $46,600*, *proposal 2 · $32,500*, *negotiation 1 · $45,000*, *won 1 ·
$9,600*, *lost 1 · $31,000* with *8 deals · $70,030 weighted* beside the board/table switch.

---

## 2026.10.8.069 — Projects and Procurement

The two lists that spend money now state it, in the chrome the other lists use.

- **[New]** **Projects** gained views with counts (**All**, **planning**, **in progress**, **completed**,
  **on hold**), a line stating *5 shown · 16% of budget spent*, a **budget bar** on every card that
  turns red when the spend is past the budget, and the totals in the page header — *5 projects ·
  $X budgeted · $Y spent*.
- **[New]** **Procurement** gained the same views for purchase orders (**All**, **draft**, **ordered**,
  **shipped**, **received**), a count line stating what is still outstanding, and a footer that pages
  the list and says how many orders have not been received. Amounts are now tabular figures so the
  column can be compared line by line.

**Verification:** `tsc --noEmit` clean; in the browser **Projects** reads *All 5 · planning 2 · in
progress 1 · completed 0 · on hold 0* with *5 shown · 16% of budget spent* and a bar on each card, and
**Procurement** reads *All 2 · ordered 1 · received 1* with *2 shown · $2,400 outstanding* and a
footer range. Both keep their existing cards, tables and dialogs, and Classic is untouched.

---

## 2026.10.8.068 — Contacts onto the same chrome

- **[Update]** **Contacts** gained the shared views strip — **All**, **Primary**, **Inactive** and
  **No email**, each with its live count — a count line (*21 contacts · 5 primary*), and the filter
  relabelled *Client: any* so it says what it filters by. The list-and-detail arrangement, the
  right-click menu, the deep-link selection and the editor are unchanged.

**Verification:** `tsc --noEmit` clean; at `/clients/contacts` the strip reads *All 21 · Primary 5 ·
Inactive 0 · No email 0*, the count line *21 contacts · 5 primary*, and the 21 contact cards and
detail panel render as before.

---

## 2026.10.8.067 — How a list reads

Every list in the application was its own invention: a table, a search box, sometimes a sort control,
and no statement of how many rows there were. The redesigned lists now share one chrome, which is
also how the mockup draws them — a strip of views above, filters you can read, and a count line
below.

- **[New]** `components/ui/ListChrome` — **`ListViews`** (the saved slices as chips, each with its
  count) and **`ListFooter`** (*1–25 of 109*, with paging when a list has pages, and room for the
  note a page would otherwise bury). One place, so nineteen lists cannot drift apart.
- **[New]** **Assets** uses it: **All**, **Needs attention**, **Warranty expiring** and **Retired**
  as views with live counts, a count line that says how many need attention, a **Warranty** column
  that turns amber inside ninety days, an **Open** action on every row, and a footer stating the
  range and the current sort.
- **[Update]** The views are worked out from the rows already in hand — a warranty ending in ninety
  days, a status of maintenance or lost — so no view costs a request and the counts cannot disagree
  with the table under them.

**Verification:** `tsc --noEmit` clean; in the browser Assets reads *All 10 · Needs attention 1 ·
Warranty expiring 0 · Retired 0*, the count line *10 assets · 1 needs attention*, the mockup's eight
columns including Warranty, the footer *1–10 of 10 · Sorted by Asset Name*, and pressing **Needs
attention** narrows the table to the one row. With `c7_ui_redesign=0` the page is the original six
columns, its own selects and no views strip.

---

## 2026.10.8.066 — The dashboard's four bands

The dashboard was your own arrangement of widgets and nothing else: no figures until you added the
right tiles, nothing about what was about to breach, and no sign of where the load was sitting. The
redesigned dashboard opens with the four questions a service desk asks in the morning and leaves the
widget grid underneath, intact and still yours.

- **[New]** A row of six figures: **Open tickets**, **Waiting on client**, **Service alerts**,
  **Overdue invoices**, **Active clients** and **My time this week** — the same numbers the widget
  tiles carry, in one band, so they are read rather than arranged.
- **[New]** **Needs a person** — every ticket inside four hours of its target or past it, soonest
  first, with its client, its technician, its age and a chip saying how much time is left (or how
  far over it is). Each row opens the ticket, and **Open the queue** goes to the list.
- **[New]** **Board load** — each board's open work as a bar, tinted once the board is carrying work
  nobody has touched for a week, with the count beside it and a line stating the stale total.
- **[New]** **Service alerts** — what is currently reporting a problem, worst first, each with when
  it started. **What changed** — your own trail, the same list the header's *Recent* menu folds to
  five, each row linking to the record it mentions.
- **[Update]** The bands are read only in the redesigned interface: Classic draws the widget grid
  with no extra requests, and the activity trail is its own component so a band that is not drawn
  costs nothing.

**Verification:** `tsc --noEmit` clean; `pnpm build`; in the browser the redesigned dashboard shows
Open tickets 28 · Waiting on client 11 · Service alerts 3 · Overdue invoices 1 · Active clients 5 ·
My time 0.8h, an at-risk table of real tickets (INF-1905 Globex 1365h over, INF-1904 Acme 1341h
over, MSP-1005 Stark 1269h over), four boards with bars, the two live DownDetector alerts, and eight
activity rows. With `c7_ui_redesign=0` the page is the widget grid and quick links as before, and
`/boards/metrics` is not requested.

---

## 2026.10.8.065 — The client record

Clients read as cards now, but a card was only the outside. Opening a client gave a breadcrumb, a
title and five tabs — no state, no figures and no brief. The record is now the same shape as a
ticket's: what it is, what it is worth, and what you would have to open it to find out.

- **[New]** The client's header is one row: `CLIENT-…`, where it is, its name, and **New ticket**,
  **Copy brief** and **Edit**. Beneath it a row of state — **tickets raised**, **MRR**, service
  level, active/inactive, industry, and whether the console and portal are on — and then the section
  strip.
- **[New]** **Overview** leads with **The account**, the identity facts as label-and-value rows
  (client number, location, type, service level, agreement, recurring value, primary contact,
  industry, territory, region, currency, joined). **Edit** turns the same rows into inputs, so the
  full field set is still editable — it is simply not what you read by default.
- **[New]** **Brief** — the client's own notes — sits beside **Recent work** (its latest tickets,
  each a link, with status and technician) and **At a glance** (contacts, agreements, tickets,
  invoices, configurations and the recurring figure). The client brief was reachable before only by
  scrolling the summary.
- **[New]** A **Configurations** section lists the client's assets — tag, name, type, state, detail,
  warranty — read on demand rather than with the record, and it says so in words if the inventory
  cannot be read rather than showing an empty list.
- **[Update]** The first tab is called **Overview** in the redesigned interface, as the ticket
  record's is; Classic keeps **Summary** and every card exactly as it was.
- **[Update]** `apps/web/src/lib/agreements.ts` now owns the monthly-value arithmetic the client list
  and the client record both need, so the two cannot drift apart.

**Verification:** `tsc --noEmit` clean; `pnpm build`; in the browser the Acme record shows
`CLIENT-964AAB06`, seven state chips, six sections and twelve account rows, **Configurations** loads
two real assets (ACM-FW-01, ACME-DC01) with warranty dates, **Edit** swaps the twelve rows for
28 inputs with Cancel/Save and the Notes editor, and with `c7_ui_redesign=0` the page is the
original Summary / General Information / Status / Quick Stats with no Configurations section and no
label-and-value rows.

---

## 2026.10.8.064 — Clients, as cards

The client list was a table and nothing else. A client is a *relationship*, and the four things you
want about one — what it is worth, how much work is open against it, who to ring, and what its brief
says — do not fit in columns. The redesigned interface reads the list as a grid of cards; the table
is still there, one chip away, for the questions columns answer better.

- **[New]** **Clients** carries a **Cards / Table** switch. Cards is the default in the redesigned
  interface, and each card states the name, `city · type · service level`, an Active/Inactive pill,
  **Tickets**, **Contacts**, **MRR**, the primary contact and the client brief. The card is a link,
  so a click anywhere opens the client, and right-click still raises the client's action menu.
- **[New]** The **Clients** toolbar states the working set — **N clients · M tickets** — beside the
  search box, the type filter and the view switch.
- **[New]** `GET /clients` returns each client's **active service-agreement amounts** and currency,
  so a card can state MRR without a request per row. One-off agreements are excluded because they
  are not a recurring commitment, and weekly, quarterly, semi-annual and annual amounts are
  normalised to a month before they are added.
- **[Update]** The client **brief** (`notes`) is now visible from the list — it was reachable only
  by opening the client.
- **[Update]** Help: the Interface walkthrough gained **The client screens** and a question about
  getting the table back.

The table, its filters, its sort order, its right-click menu and its CSV export are untouched, and
Classic still gets the table with no view switch at all.

**Verification:** `tsc --noEmit` clean for both `apps/web` and `apps/api`; `pnpm build` all packages;
`node scripts/generate-openapi.mjs` (430 operations) followed by `check-api-docs` (430 operations,
63 curated, 46 tags), `check-route-guards` (433 routes) and `check-help-links` (87 routes, 28
walkthroughs) all pass. In the browser, five client cards render with live figures — Tickets 29/19/
20/18/23, MRR $2,500 / $8,000 / $3,500 / $12,000 / $1,500 — and the toolbar reads *5 clients · 109
tickets*; the Table chip swaps to the original six-column table and back; and with
`c7_ui_redesign=0` the page is the original table, its original *All Types* / *Name* controls, and
no cards.

---

## 2026.10.8.063 — Configurations, by its own name

"Estate" was the mockup's word for the client's configuration records, and it is not a word this
product uses anywhere else. A rail that renames a thing the rest of the application calls
Configurations is a rail that makes the reader work out whether they are the same thing — so the
context column calls it **Configurations**, like the tab, the Kumo pages and the client record do.

- **[Fix]** **The context column's third card is *Configurations* again**, with *Open Configurations*
  as its action, and the description says what it holds rather than what it used to be called.
- **[Update]** **Help's *The ticket screens* section** uses the same word, so the walkthrough and the
  screen cannot disagree about the name of a feature.

## 2026.10.8.062 — The composer logs time, the context pane is a preference, and the working set

- **[New]** **The composer now does the whole job, not a third of it.** It carries **Work type**,
  **Role**, **Hours** and **Billable** inline, as the mockup does — so "Save and log" writes the note
  *and* the time entry in one action, and the fields are visible whether or not the time sheet is
  open. The API takes minutes directly, so a quarter of an hour is recorded as a quarter of an hour
  rather than as an invented start and end. The **Internal** toggle sits in the same row, and a reply
  still reveals the recipients.
- **[New]** **The context pane is a preference, and it is on by default.** It is what the redesigned
  record is — the client, the contact and the estate beside the work rather than behind a tab — so it
  starts shown and can be put away two ways: the **×** in its own CONTEXT header, or
  **My Account → Appearance → Layout → Context pane / Hide it**. The choice is per browser and
  per person; nothing about the record changes when it is hidden, the panel simply stops taking room.
- **[New]** **The working set**, above the page and below the header: the section you are in, the
  record you are in, and *⌘K to open something*. It is neither the application's header nor the
  record's page — it is the hand you are holding, kept in front of you as you move between a queue
  and the records in it.
- **[Update]** **The tab strip is the mockup's flat one** — underlined tabs with their counts on the
  same row as the record's actions, rather than a boxed segmented control.
- **[Update]** **The pill row says what it is for** — *"Click a pill to change it — no dialog, no
  form, no save"* — because a control that looks like a label is one nobody presses.

## 2026.10.8.061 — The modern theme, and the ticket record as the mockup lays it out

Two things landed together: the mechanism that carries the redesign to **every remaining page at
once**, and the rest of the ticket detail's structure.

- **[New]** **A modern theme, scoped to one attribute.** The redesigned interface is not only a
  different arrangement of pages, it is a *denser and flatter* one — 34px table rows, 13px card
  padding, 11px uppercase column headers, one type step down, controls sized to the new row height.
  All of that is now a stylesheet scoped to `html[data-ui-redesign="true"]`, which `Layout.tsx` sets
  from the same switch as everything else. **Every page in the application picks it up**, and the
  classic interface keeps the styling it has always had, down to the rule.
- **[Update]** **The palette is deliberately not part of it.** The mockup is a blue-accented design,
  and copying its colours would have thrown away the colour schemes this application ships — Brand
  Crimson, Crimson Rose, Deep Maroon, Plum Noir, True Black. The app's own Brand Crimson is already
  the near-black the mockup asks for, so the theme takes the mockup's *structure, density and type*
  and leaves colour where it belongs: with the person using it.
- **[Update]** **KPI tiles lead with the number.** The shared `StatCard` put a 40px icon where the
  figure belongs, which slows down the one thing a dashboard is read for. The redesigned tile leads
  with the figure and moves the glyph to the corner, as a label rather than an ornament. One
  component, so every dashboard, report and summary strip in the product follows.
- **[New]** **The ticket detail's record column is the mockup's.** *The record* is the ticket's facts
  in one list — Board, Status, Priority, Assigned to, Contact, Source, Category, Opened, Updated, the
  target — read top to bottom, with the dates folded into it rather than taking a card of their own.
  *What the client said* is the description on its own, because it is the one thing on a ticket that
  is the customer's words rather than ours. *The client's other open work* and the composer follow it.
  The classic interface still draws General, Dates & Times and Notes exactly as it did.
- **[New]** **Tabs carry counts** — Activity 1, and whatever Work and Files & Links hold — so the
  strip says how much is behind a tab rather than only where to look.

## 2026.10.8.060 — The ticket screens proper: a record header you press, a context rail, and a composer

The two commits before this one redesigned the *chrome* the ticket screens share with everything else
— the compact header, the grouped tabs. This is the screens themselves, built to the mockup: the two
places a service desk actually works. It is a noticeable change of shape, because the mockup's ticket
screens are not the application's ticket screens with smaller headings; they are a different
arrangement of the same facts.

- **[New]** **The ticket's states are pills you press.** The record header is where it sits, what it
  is, and then the states *themselves* — status, priority, assignee, the SLA clock, the source, the
  service agreement — with **Copy link** and **Acknowledge** on the right. Changing one is a click
  rather than a dialog with a form and a save button; every pill writes through the **same route the
  Edit form uses**, so there is still exactly one place in the application that changes a ticket, and
  Edit is still there for everything at once.
- **[New]** **The SLA clock is a chip, and it reads the clock the ticket actually carries** — the
  board's SLA resolution target, or the due date when that is what the instance set — as *"3d to
  SLA"*, *"4h to SLA"* (amber, inside four hours) or *"SLA breached · 2d ago"* in red, with the
  target and the timestamp in the tooltip. Tickets with neither show a dash rather than an invented
  promise.
- **[New]** **The right column is a CONTEXT rail.** **Client** — the name, its type, open tickets,
  service level, agreement, when it was opened, and **the client's own brief** in a callout, which is
  the note the client record already carries and the thing you need *while* reading, not something to
  go and look up — then **Contact** (name, email, phone, **Reply** and **Log a call**, plus everyone
  else on the ticket and how each of them is used), then **Estate**, which is what the
  Configurations panel is and now says so. It stays with you as the panel scrolls. It is read-only on
  purpose: a state you change is a pill in the header.
- **[New]** **The composer.** A note, a reply to the client and a time entry all start in the same
  place, because they are the same act of recording what you did: the tabs are the *existing*
  internal/emailed flag rather than a new one, so a reply shows the recipient editor and a note does
  not, and **Save and log** is the button that was always there. Log time opens the full time sheet —
  work type, role, rate and billable against the board's billing rules — because shrinking those into
  one inline row would have dropped the fields the API actually charges from.
- **[New]** **Counts on the tabs**, so the strip says how much is behind each one rather than only
  where to look, and **"The client's other open work"** in the record column: the ticket that explains
  this one is usually already open beside it.
- **[New]** **Age and SLA columns on the queue**, both on by default. Age is the compact relative
  figure the queue is triaged by (34m, 4h, 2d) and SLA is the same chip as the record header, so the
  two screens cannot disagree about the clock. A saved column selection from before them gets them
  added **once** — a redesign that leaves its two new columns hidden behind an old preference, with
  nothing on screen to say why, is not finished — and from then on the choice is the user's.
- **[Update]** **The views strip gained *Assigned to me* and renamed *All* to *Everything***, matching
  the mockup: the one view that is about *you* rather than about the ticket toggles, and the strip
  ends on the whole queue. Verified against the running instance: Workable 28, Escalated 0, Waiting
  17, On Hold 9, New 35, Assigned to me 8, Everything 109.

## 2026.10.8.059 — The ticket queue becomes an inbox, and the surfaces that were left

The ticket screens were converted in 2026.10.8.057 and the header every page draws in 2026.10.8.058.
This is the rest of it: the queue's own design, the record headers that keep their own shape, and the
handful of surfaces that had no chrome to compact — some of which turned out to need something else
entirely.

- **[New]** **The ticket list has views, with counts.** *All, Workable, Escalated, Waiting, On Hold,
  New* — the same five the Filter dialog offers, as a strip you **press** rather than a dialog you
  fill in, above the search box. Each one carries how many tickets it would show *before* you press
  it, which is the whole point: "Waiting 17" is a reason to look and "Waiting" is not. The counts are
  read from the board and client you are looking at, not from the whole instance, and the view lives
  in the address, so a filtered list is still a link somebody can send. Verified against the running
  instance: All 109, Workable 28, Waiting 17, On Hold 9, New 35, and pressing *Waiting* returned
  exactly the 17 the chip promised.
- **[New]** **Tickets carry a priority bar in front of the summary** — grey, amber, orange, red — so
  priority is something you notice while reading the list rather than a column competing for width.
  The priority column was already off by default; the bar is what carries the fact now, and hovering
  it names the priority for anybody who needs it said.
- **[Update]** **The ticket detail's context column follows you down the panel.** The state of the
  ticket, the client behind it and who to contact are facts you read *while* working, not a tab you
  visit — so on a wide window that column is sticky rather than scrolling away with the Overview. The
  grouped tabs, the pinned strip and the one-row record header stay as 2026.10.8.057 left them.
- **[Update]** **The record headers are compacted too.** A Kumo organization's name and its pills
  (status, location, industry, service level, counts) now share one line instead of stacking, while
  keeping the shape a record needs — a title and a description cannot express those states, which is
  why these keep their own header rather than using the page one. The same treatment went to the
  landing page's welcome, the Help article header and the console's title.
- **[New]** **A `.chip` component**, for a filter or a view you press: borderless chips with a count,
  the chosen one on the accent, themed from the palette rather than hard-coded — so it follows the
  colour scheme and reads on both themes.
- **[Update]** **The five multi-section pages use the application's own tab control.** Billing,
  Reporting, a client record, Checklists and a user record each drew their own underline strip —
  a second tab idiom, separate from the segmented control the settings screens and the board tabs
  already use. In the redesigned interface they use the shared `Tabs` one: the same shape, the same
  keyboard behaviour (arrow keys move the choice, one tab stop), and one place to fix it. What each
  page's tabs *are* has not changed, and the route still owns the choice on the pages where it did.
- **[Update]** **Help gained a *The ticket screens* section** in the Interface walkthrough and two
  answers in the FAQ — what the counts above the list are, and how priority is shown without a column
  — because both are things a person will see and wonder about.

## 2026.10.8.058 — The redesigned header, on every page

2026.10.8.057 converted the two screens the brief named. This converts the rest: the header
every page draws, the bar above every page, and the three pages that had never adopted the
design system at all. The classic interface is unchanged — that is the constraint the whole
conversion was built around, and it is why the shared header component reproduces the exact
markup a page had before rather than something better.

- **[New]** **`PageHeader` draws two shapes, and a page does not have to know which.** The
  same component renders **one row** — the page's name, its description and its actions on
  one line — in the redesigned interface, and the markup the page had before in the classic
  one: the same `h2` classes, the same `p`, and an `icon` prop for the headings that named
  their subject with a glyph. `variant="section"` is what a page passes when it used to
  hand-roll an `h2`; `variant="page"` is the `h1` shape the eleven pages already using this
  component had. Converting a page is therefore a change to the redesigned screens and
  *not* to the classic ones, which is what made it safe to do forty of them.
- **[Update]** **Every standard page now draws its header the redesigned way** — 40 files,
  including Clients, Contacts, Assets, Boards, Billing, Quotes, Reports, Custom Reports,
  the product catalog, Users, Roles, Kumo, Service Alerts, Uptime Monitors, the
  configuration hub, Assistant, AI Actions and What's New. Two kinds of surface
  deliberately keep their own layout, because a compact header is not what they are for:
  sign-in, two-factor setup and Help, and the console and the report designer, which are
  full-bleed tools rather than pages. A *record* header — a ticket, a Kumo organization —
  keeps its own too: those carry pills, states and actions a title and a description cannot
  express.
- **[Update]** **The bar above every page is one line instead of three.** Measured at
  1280px: **91px → 47px, on every screen in the application** — 44px of content that no
  longer has to be scrolled to. The trail is not repeated in it: at that width the header
  toolbar takes 644px of a 1080px row, a trail needs 272px of the 364px left and a
  description about 500px, and of the two the description is the one that is not available
  anywhere else on the screen. The rail already shows which section is lit, and a record
  carries its own trail — so the trail is what goes, and the reasoning is written down
  rather than left to whoever notices next.
- **[Update]** **Three pages that had never adopted the design system now use it.** Uptime
  Monitors, Quotes and AI Actions were built with inline colours (`#0f172a`, `#cbd5e1`)
  rather than the shared classes, which is why they were the only screens that ignored the
  colour scheme and the light theme. They now use `card`, `table`, `input-field`,
  `btn-primary` and the theme's greys, so they follow the palette like everything else.
- **[Update]** **Help's *The Interface* walkthrough** gained the two header rows, a *Which
  pages* section that names what is converted and what is deliberately not, and two new
  answers — where the breadcrumb in the top bar went, and how much the chrome now costs.
  [INTERFACE-ROLLBACK.md](INTERFACE-ROLLBACK.md) documents the conversion rule, the two
  things to know before converting another page, what the compact header costs, and the
  code-level revert.
- **[Fix]** **The redesigned header no longer overflows into the toolbar.** The first
  attempt at one row let the breadcrumb keep its width while the description was squeezed
  to zero and the row spilled under the buttons. It is one row that fits, verified on
  twelve pages, with the description truncating rather than colliding.

## 2026.10.8.057 — The redesigned ticket screens, with the classic layout one click away

The whole-application redesign has been mocked up and is now being built, one screen at a time. This
is the first of those commits and the one that makes the rest possible: the ticket list and the ticket
detail are redesigned, the **switch** that chooses between the two layouts exists, and every screen
that has not been converted yet renders exactly as it always did while the switch is set either way.

The default is **Redesign**. Nobody has to adopt it blind: the classic layout is a click away, in the
same My Account menu the navigation pane already uses, and the two switches are independent — the rail
can be paired with classic screens and the single tree with redesigned ones.

- **[New]** **The ticket detail's twelve panels are grouped into five tabs** — Overview, Activity,
  Work, Files & Links and Finance — with the panels inside a tab as **sub-tabs** one click away rather
  than a second click deep. *Configurations* left the strip for *Finance* and *Products* for *Work*:
  a client's estate is a fact about the client, and four different answers to "what has this used and
  cost" belong together. Nothing was removed — every one of the twelve is still reachable, and
  `activeTab` still holds a real panel id, so the per-tab loading and every panel guard are untouched.
- **[New]** **A tab remembers which sub-tab you were on.** Come back to *Work* after *Activity* and you
  are on Time, not on the first panel of the group. Nothing is persisted; a reload starts on Overview.
- **[Update]** **Less chrome above the panel.** The record's header is one row — where it sits, what it
  is called, status, priority, Edit — the actions sit on the same line as the tabs, and the whole card
  is **pinned to the top of the window**, so the twelve panels stay one click away however far down the
  panel you have scrolled. Measured on a 1280px window, a panel's content begins about **70px higher**
  on a ticket, and the ticket list begins about **90px higher** because its title and toolbar now share
  a row. Spacing was the fix for the scrolling the user reported; a vertical drag handle was the
  fallback and was not needed.
- **[New]** **The switch has three layers, narrowest first**, exactly as the navigation pane's does:
  the **Interface** field in *Administration → Configuration → Workspace* for everyone,
  **My Account → Appearance → Interface** for one browser in either direction, and `VITE_UI_REDESIGN`
  for a deployment that should not offer the redesigned screens at all. The browser's choice is what
  makes it safe to try: `localStorage.setItem("c7_ui_redesign", "0")` returns one browser to classic
  and `"1"` takes it back. Colour scheme, light/dark and density belong to neither layout and carry
  across the change untouched.
- **[Update]** **Help gained *The Interface* walkthrough**, with its Index row and the Configuration
  reference, and answers the two questions this will raise — a colleague's screens looking different,
  and where the Configurations and Products tabs went. [INTERFACE-ROLLBACK.md](INTERFACE-ROLLBACK.md)
  is the rollback guide, and is now listed with the others in the README.
- **[Update]** **The pane's own switch is now labelled *Navigation*.** What the navigation redesign
  called *Interface* in the My Account menu now reads **Navigation**, because *Interface* is the
  screens' switch: two rows, two subjects, and no ambiguity about which one a reader is changing. The
  Help text and [NAV-PANE-ROLLBACK.md](NAV-PANE-ROLLBACK.md) that named the old label were corrected
  in the same change.
- **[Fix]** **The Configuration hub redraws when the interface is changed.** Saving *Interface* — or
  resetting it to the deployment's value — now refreshes the settings the same way *Navigation pane*
  already did, so an administrator sees the change without reloading.

## 2026.10.8.056 — Kumo down to the foot of the rail, at the height of a row

The logotype added in 2026.10.8.054 was set two sizes larger than the labels around it, and it stood
between Platform and Service alerts. A wordmark that reads as a heading makes the rows beneath it look
like its contents, and those two are not part of Kumo — so it is now both smaller and somewhere else.

- **[Fix]** **The mark is set to the height of the row it lives in** — 16px where it was 21px — so it
  reads as a menu item rather than as a section divider. It is still a wordmark with its own red
  spider, so the branding survives the correction: what changed is its weight, not its identity.
- **[Update]** **Kumo sits last on the spine, just above the utilities.** It is a product inside this
  one rather than a step in the service-desk flow, and at the foot it abuts the labelled *Utilities*
  heading instead of sitting in the middle of the delivery rows — so there is nothing left for a
  reader to mistake for its contents.
- **[Update]** **Help's rail table lists the rows in the order they are now in**, and says why Kumo is
  last, so the documentation does not describe a pane the reader cannot see.

## 2026.10.8.055 — Favorites on the rail, and a right-click that can pin anything

The modern pane had pins but no place to keep them: a pinned section showed up nowhere, and a pinned
page only appeared inside its own section. There is now a **Favorites** row at the top of the rail —
always there, whether or not anything is pinned — and every row in both panes answers a right-click.

- **[New]** **Favorites is the first row on the rail, and it never moves.** It opens a panel listing
  everything you have pinned, in your order rather than the pane's: a page row goes there and names the
  section it lives in when that says something the label does not (labels repeat — there is more than
  one *Dashboard*), and a pinned *section* opens that section's destinations, which is what clicking it
  on the rail does. A section holding exactly one page goes straight to it, because a list of one is
  not a list.
- **[New]** **Right-click any row, in either pane, and pin it.** A section on the rail, or a page
  inside one: *Pin to Favorites*, *Remove from Favorites*, *Move up*, *Move down*, and *Remove all
  favorites* from the Favorites header — the same menu the classic tree offers, from the same builder,
  so the two panes cannot drift apart. A pinned row's own menu carries the order controls, because a
  pinned copy is the one place its position is yours to choose.
- **[Update]** **The rail's menus leave out the three entries that only describe a tree.** *Expand this
  section*, *Expand all* and *Collapse all* are dropped where there is nothing to expand: a rail row
  opens a panel, it does not unfold, so offering to expand it would be offering an action that changes
  nothing you can see. The classic pane's menus are untouched.
- **[Update]** **One list, two panes.** Favorites is the account's existing list, so pinning in the
  modern pane appears in the classic pane's Favorites section and in the pinned group at the top of
  the row's own section — and it still follows you to another machine, as it did before.
- **[Update]** **The number keys count the rail as it reads**, so `1` is Favorites, `2` is Today, and
  the rest follow. `→` still opens the domain you are on and never opens the pins, which are not
  somewhere you are.
- **[Fix]** **A Help row promised arrow keys the pane never had.** The keyboard table listed `↑` `↓`
  as moving along the rail; nothing implemented it, so it now names **Tab**, which is what actually
  moves through the rows and has always worked. The walkthrough also gained a *Favorites* section and
  a row in the rail table.

## 2026.10.8.054 — Kumo carries its own logotype

Kumo is an application inside this one — and may yet be shipped on its own — so it is now branded
rather than labelled: the wordmark with the spider over the M replaces both its icon and its name on
the rail, and heads its own panel.

- **[New]** **The logotype, keyed out of the Kumo brand sheet into two alpha masks.** The same method
  the C7NTAX wordmark uses, and for the same reason: there is no background plate behind it, the
  letters paint with the inherited `color` — so the mark is black on a light scheme, white on a dark
  one, and dims with the row it sits in — and the spider is overprinted at Kumo's own red. **One asset
  covers light and dark mode and every colour scheme**, rather than a pair of flat images that would
  have to be swapped by theme.
- **[New]** **The spider is intact.** Its coverage is read from its redness, which does not depend on
  what it sits against, so the legs and the soft edges where it crosses the M survive the extraction;
  the letters mask carries the M *minus* what the spider covers, and the two layers composite back to
  the original artwork. Verified against the source at both scales.
- **[Update]** **`--kumo-red` is Kumo's own constant**, sampled from the artwork (`#e3222b`) and
  deliberately not the C7NTAX crimson used by the 7: Kumo is a product inside this one rather than a
  part of it, so its colour travels with the mark — which is what a spin-out would need.
- **[Update]** **Collapsed, the rail keeps the icon.** A 64px rail has room for one glyph and not for a
  wordmark, and a shrunken wordmark is a smudge; the branded row returns as soon as the rail does.

## 2026.10.8.053 — Modern interface by default, and a switch to go back

Everyone now gets the rail pane unless the instance says otherwise, and anyone can make that
choice for themselves without an administrator — **My Account → Appearance → Interface** switches
between **Modern** and **Classic** where you are standing, with no reload.

- **[New]** **The switch, in the account menu beside theme and density.** It is the same
  `c7_ui_nav` flag the rollback notes name rather than a second mechanism, so the documented
  override and the visible control cannot drift apart — and it works in either direction, letting
  somebody keep the tree on an instance that has adopted the rail, or try the rail on one that
  has not.
- **[Fix]** **The switch would have hidden itself from the person who needed it.** It is shown
  whenever the *build* offers the modern pane — a new `UI_NAV_AVAILABLE` in `lib/uiFlags.ts` —
  because the flag it was first gated on reports the browser's own choice, so it was false for
  exactly the person who had switched to Classic: the one control that could take them back was
  the one that disappeared.
- **[Update]** **Modern is the default for all users.** The setting ships as `modern`, and only an
  explicit *Single tree (classic)* — instance-wide, or personal — reverts. A browser that has
  never expressed a preference gets the rail.
- **[Update]** **Help, and the rollback guide, say how to switch back.** NAV-PANE-ROLLBACK.md now
  names the menu switch as the friendly form of the browser flag, and the navigation walkthrough's
  "Going back to the classic tree" table gained it as the first row. A stale sentence there also
  promised that the panel follows the pointer along the rail; it follows a *click* now, and says so.

## 2026.10.8.052 — Header descriptions that fit

The one-line summary beside each page title was written for a column twice as wide as the one it
has, so on 31 of 67 pages it ran to three lines and on the worst to four. It was measured rather
than guessed: at 1280px the title block is **308px** — the header toolbar beside it is a fixed
644px — which is why the longest, *Services*, wrapped to four lines. All **67** descriptions were
measured, the **31** that ran past two lines were rewritten, and all 67 now fit in two.

- **[Fix]** **The worst offenders, in place.** *Services* went from "The connectors — directory,
  security, accounting, documentation, an RMM, a SIEM — what each has brought in, and whether it
  is healthy." (138 characters) to "What each connector brought in, and whether it is healthy."
  (56). The header on that page is now 91px instead of 139px, and shorter again on every other
  page that had grown to three lines.
- **[Update]** **Each was rewritten, not truncated.** Detail that had no business in a header
  moved out ("aggregate outage monitoring for Microsoft 365, Azure, AWS, GitHub, ISPs" became
  "outage monitoring for the services you watch"), and the specifics that make a description
  worth reading were kept. No description is now a restatement of its own title.
- **[Fix]** **A code comment still quoted the old wording** of the dashboard's description as its
  example; it now quotes what the file says.

## 2026.10.8.051 — A navigation pane that does not grow with the feature list

The left pane was one scroll region holding sixty-odd destinations, and it was going to keep
getting longer. It is now a **rail of nine domains** grouped by the job you are doing, and the
chosen domain's destinations **fly out over the content** instead of holding a column open. Both
panes are drawn from the same navigation tree, so nothing was dropped, renamed or moved in the
data — a destination cannot go missing because of which pane you are looking at, only because the
pane has not been told where it belongs.

- **[New]** **A rail of domains, derived from the tree rather than written out beside it.**
  Today, Service desk, Clients, Delivery, Revenue, Insight, Kumo and Platform, then **Service
  alerts** on a row of its own at the end, with Assistant, Help, My settings and Console as
  utilities underneath. Each domain is a *list of destinations*; the labels, routes, icons and
  permissions are read back from the navigation tree, so a new section cannot be described twice
  and drift. Anything the pane has not been told about appears under **Other** rather than
  vanishing — the pane can be incomplete, but it cannot silently hide a page.
- **[New]** **The destinations fly out over the page.** Clicking a domain opens its panel to the
  right of the rail, above the content and taking no width from it; clicking the same row again,
  clicking away, pressing **Esc** or choosing a destination closes it. The rail is 200px — 56px
  *narrower* than the 256px tree it replaces — so every page gained width rather than losing it.
  (An earlier shape with the list in a permanent second column was built, measured and discarded:
  at 1280px it pushed the header from 91px to 139px and the page title to four lines.)
- **[New]** **Order follows what you open.** The rows of a domain you actually use come first,
  weighted by recency, recorded per browser; rows you have not opened are folded under
  **Everything else** with a count, and nothing anywhere is hidden. A first run folds nothing at
  all, so the first impression is never worse than the tree it replaced. An A–Z toggle is there
  for anybody who navigates by position and wants the list to sit still.
- **[New]** **The filter searches the whole application, not just the open panel.** Typing in it
  shows every match with the section that owns it, which answers the question the tree made you
  answer by memory: *which part of the product is this in?*
- **[New]** **Keyboard:** `1`–`9` open a domain, `→` opens the one you are on, `/` focuses the
  filter, `Esc` closes the panel (the filter first, then the panel).
- **[Update]** **Favourites are the same list.** The pinned rows at the top of the panel are the
  account's existing favourites — the same ones the classic tree shows, stored against your
  account — so the two panes do not disagree about what you pinned.
- **[Update]** **It is a setting, and a personal switch, and a build flag.** Administrative:
  Administration → Configuration → Workspace → **Navigation pane**. Personal: **My Account →
  Appearance → Interface**. Deployment-wide off: `VITE_UI_NAV=false`. See
  [NAV-PANE-ROLLBACK.md](NAV-PANE-ROLLBACK.md) and Help → *The Navigation Pane*, which also gained
  the configuration-reference rows and the FAQ answer this raises.

## 2026.10.8.050 — Show All shows *your* activity, on a page of its own

"Show All" in the header's Recent menu used to open **Administration → Audit Logs** — every change made by
everybody in the instance, which is not what the list above it is, and which most accounts cannot open at
all. It now opens **My activity** (`/activity`): the same list, at length, and only ever your own.

- **[New]** **My activity (`/activity`) is your own history, not a filtered view of the audit trail.**
  It reads the audit trail for *your* rows (`?mine=true`) and adds the pages you stayed on for two minutes,
  which live in this browser. Grouped by day ("Today", "Yesterday", then the date), each entry at its own
  time, and each one links to the exact place with the same arrival highlight the menu uses. Reachable by
  anyone signed in — the page scopes itself to the caller, so there is no version of it that needs a
  permission or shows somebody else's work.
- **[New]** **Repeated changes are kept on the page where the menu folds them.** The five-entry menu
  collapses two identical changes into one line because it has no room to repeat itself; a history is the
  wrong place for that rule. Two deletions of two different clients summarize identically ("Deleted", no
  subject) and would have looked like one, so `activitiesFromAudit` takes a `dedupe` option and the page
  turns it off.
- **[Update]** **Administrators keep the way through to the whole trail.** A person holding `system:config`
  sees a **System-wide audit trail** button on the page — the same destination "Show All" used to go to,
  now named for what it is and offered only to somebody who can open it. Everyone else never sees it.
- **[Fix]** **Standalone pages were titled "Dashboard".** The header falls back to `Dashboard` for any path
  the navigation tree cannot place, so `/console`, `/settings`, `/mfa-setup` and the new `/activity` all
  announced themselves as the Dashboard. They now have names (`lib/pageTitles.ts`), read by both the header
  and the breadcrumb trail — which is also where the Recent menu's visit labels come from, so a page you
  stayed on reads "Console" rather than "Dashboard".
- **[Fix]** **The breadcrumb trail put "Dashboard" under Home on every page with no nav row.** The Dashboard
  node's own route is `/`, and the trail's prefix test treated a bare `/` as a prefix of every path in the
  application — so the one node whose `to` is the root quietly claimed every unclaimed page. `/` now matches
  only `/`.
- **[Fix]** **The header blurb fell back to the Dashboard's.** A one-segment path with no description of its
  own inherited the root's, so `/console` described itself as "key business metrics, open ticket volumes, and
  technician workloads". The parent walk no longer treats the root as a parent, and `/console` has its own
  line.
- **[Docs]** A **Recent Activity & My Activity** walkthrough (`/help/walkthroughs/my-activity`) — what counts
  as an activity, what the arrival highlight is for, and a side-by-side of My activity against the audit
  trail (whose changes, who may open it, repeated changes, visits, how far back). Two FAQ answers, and the
  Index row, in the same change.

**Recorded, not fixed — an authorization gap found while proving this works.** `GET /api/system/audit-logs`
carries no permission of its own: `mine=true` is an opt-in *filter*, so omitting it returns the instance's
audit rows to any signed-in caller. Measured against the dev API on 2026-10-08 as
`persona.tech@c7ntax.local` (a technician, no `system:config`): `?mine=true&limit=200` → 124 rows, **1**
distinct user; `?limit=200` → 200 rows, **9** distinct users. Narrowing the route would break the ticket
activity tab, which is the unfiltered read's legitimate caller, so it is written up as **PLAN-029 §6** with
the three ways to fix it rather than changed in the same commit as a UI feature.

**Verified:** `pnpm lint` 6/6 and `apps/web` builds; live in the dev app — the Recent menu's **Show All**
resolves to `/activity` and clicking it lands there; the page reads 200 activities for the signed-in account
(`admin@C7NTAX.com`) with day grouping, per-entry times and the truncation note; `/console` now reads
"Console — Run commands against this instance…" with the trail `Home › Console` and `/tickets` is unchanged;
the API returns exactly one `userId` for `mine=true` against nine for the unfiltered read; `check-help-links`
green (26 walkthroughs); `pnpm probes:sweep` reports no residue.

---

## 2026.10.8.049 — One path to production: build on dev, promote to prod, and never a second build

The Azure deployment package is now built around the path the work actually takes — **sync to GitHub → push to
dev → push to production** — with production created up front as a second, independent environment rather than
something assembled at cut-over. PLAN-016 §16 is the authoritative description; this is what changed in code.

- **[New]** **An environment is created, not just deployed to.** `deploy-env.ps1 -Create` creates the resource
  group and then the whole stack inside it. The resource group is the one thing Bicep cannot create — a
  deployment is *scoped to* a group — so the first run of an environment needs the flag and nothing else does.
  Both environments are created in order: `-Environment dev -Create`, then `-Environment prod -Create`.
- **[New]** **`-PromoteFrom dev` makes a promotion a promotion.** The script reads the image tag back from what
  dev is *running* (not from a branch or a sha in the working tree), so no commit dev has not run can reach
  production, and nothing is built a second time. `-Yes` answers the production confirmation; the pipeline gets
  the same guarantee from the `prod` GitHub environment's required reviewers.
- **[Fix]** **Promotion copies the artifact; it used to reference dev's registry.** Each environment has its own
  registry and a Container App can only pull a registry its own identity holds `AcrPull` on, so prod would have
  been handed an image it could not pull. Promotion now copies dev's image into prod's registry with
  `az acr import`, which moves the manifest and layers by digest — the same bytes, and prod stops depending on
  dev's registry staying in place to keep serving.
- **[Fix]** **The pipeline resolved dev's registry for prod.** `.github/workflows/deploy-azure.yml` asked
  `rg-c7ntax-dev` for the registry regardless of the target, so a prod deploy would have pushed prod's revision
  at an image in the wrong registry. The registry is now resolved per environment, and the job that used to be
  "build and push" is "prepare the image": it decides between **build** (a push to `main`), **promote** (a prod
  dispatch with no `image_tag` — the tag is read from dev's Container App) and **deploy a named tag** (a
  rollback), then proves the tag is present in the target registry before anything else runs.
- **[Fix]** **A deploy could silently rebuild and overwrite an existing tag.** `-ImageTag <old-tag>` without
  `-SkipBuild` rebuilt the current commit *under the old tag's name*, which would have broken the one thing a
  tag means: prod would be running something other than what was verified under that name. Naming a tag that
  exists in the registry and does not match `HEAD` now stops the script with the two ways forward. The
  documented rollback line carries `-SkipBuild`.
- **[Fix]** **Five PowerShell scripts in the repository could not run at all.** Windows PowerShell 5.1 reads a
  UTF-8 file with no BOM as CP1252, so an em dash inside a *double-quoted* string became `â€"` — and PowerShell
  accepts that trailing U+201D as a string delimiter, ending the string early and failing to parse the file.
  `deploy-env.ps1`, `startup/c7ntax-boot.ps1`, `startup/security-scanners.ps1`, `c7ntax-restart.ps1`,
  `scripts/rollback-ui-p1.ps1`, `installer/outlook-addin/build.ps1` and `O365/New-C7NTAXMailboxApp.ps1` now
  carry a UTF-8 BOM (honoured by both 5.1 and `pwsh`), and all ten scripts in the tree parse. Recorded in
  PLAN-029 §5 because the class is not guarded: a script that gains a curly quote later breaks the same way.
- **[Update]** **PLAN-016 brought in line with what was built.** §16 is new and is the environment model and
  promotion path — what gets created, in what order, why promotion beats a second build, what the second
  environment costs, and what is still to come (the sync-command classifier, the ingress module, DNS). §1's
  port-based framing, §3's "two subscriptions or one", §6/§7's `deploy-env.sh`, §9's pipeline and §14's
  subscription-topology decision were corrected to match, and `infra/README.md` now creates **both**
  environments and documents the three-step loop.

**Verified:** all ten `.ps1` files parse (`Parser::ParseFile`); `deploy-env.ps1 -WhatIf` runs end to end on
three paths — dev build, prod promotion (showing `az acr import` from dev's registry into prod's), and a prod
rollback with an explicit tag and `-SkipBuild` — each exiting 0; all four workflow files parse, with the build
job's steps confirmed as login → resolve registry → decide → build/promote → verify. No deployment was possible:
`az` is not installed on this machine, so the plan modes are the proof available locally.

---

## 2026.10.8.048 — The leftovers: a dead router, a tracked build artifact, three leaky probes, and a register of what was left on purpose

A sweep of everything the day's work had flagged and not finished, plus PLAN-029 — the register of what was
deliberately left alone because finishing it would break something or because it is a decision rather than a
task.

- **[Fix]** **The duplicate `rolesRouter` in `users.ts` is gone.** The file carried a second, never-mounted
  roles router whose own note said *"deleting it is a follow-up cleanup"*. Nothing imported it, the
  permissions catalogue is served to the SPA straight from `@C7NTAX/shared` anyway, and the mounted
  `routes/roles.ts` has served the same endpoints all along — `users.ts` lost 77 lines and one now-unused
  import. `guard:routes` reports 433 routes with 382 guarded, down from 439/388, which is the six guarded
  declarations that were unreachable.
- **[Fix]** **`apps/web/tsconfig.tsbuildinfo` was tracked.** TypeScript's incremental-build cache is machine
  state that changes on every compile, so every commit carried a diff of it and nobody could merge that file.
  Untracked, and `*.tsbuildinfo` added to `.gitignore` so it cannot come back.
- **[Fix]** **The three probes that cleaned up only on their happy path now clean up on every path.**
  `probe-time-rules.mjs`, `probe-time-rules-flag.mjs` and `probe-expenses.mjs` each ended with their tidy-up
  as the last statements of `main`, and `void main()` handed any exception straight to Node — which is how the
  dev database collected a "TimeRules Probe …" and an "Expense Probe …" client in the first place. Each now
  carries one run stamp in its client's name and one idempotent `sweep()`, called from the end of `main` and
  from `catch`. **Verified by forcing the failure**: a throw inserted after the client is created printed
  `probe failed: deliberate failure…` and left **zero** `TimeRules Probe` clients behind, which is the
  assertion the fix needed rather than a happy-path run that would have cleaned up anyway.
- **[Fix]** **PLAN-028's own text was stale.** Its header and §10 still described the header icon as an inert
  `Terminal` glyph reading "Console (coming soon)"; the registry in `PlanDocs/README.md` still claimed the
  console added **no new permission**, which stopped being true when `console:use` arrived. Both now say what
  exists, and the registry carries a row for PLAN-029.
- **[New]** **`PlanDocs/PLAN-029-Deferred-Work-and-Known-Risks.md`** — the register of what was found and left:
  the **committed snapshot's secrets** (plaintext connector credentials in `integrations.json`, the vault's
  ciphertext whose *development* key is a constant in the source, password hashes and MFA seeds in
  `users.json` — deferred because redacting the capture without teaching `seed-from-snapshots.ts` to
  substitute placeholders breaks the re-seed, and the real remediation is rotating what was exposed); the
  **API's emitted tree versus its `start` script**; the **unmounted `tenants.ts`** router; the **gap in
  `guard:console`** that let three wrong client column descriptors live until a screenshot found them; and
  five smaller things, each with its reason and its cost.

**Verification:** `pnpm lint` 6 of 6; API `tsc` clean; `guard:routes` and `check-help-links` green (the route
count moved and nothing else did). The two time-rules probes and the expenses probe were run against the live
API, and `pnpm probes:sweep` afterwards reports **no residue of any kind** — the check that this work exists
to pass. The caught-failure test above was run with a temporary copy of the probe and both temp files were
removed.

---

## 2026.10.8.047 — Basic and Advanced: two readings of one console result, and a switch between them

The presentation work made output readable by *interpreting* it — a record becomes labelled fields, a table
loses the columns that hold nothing, timestamps become dates. That is the right default and it is also a
layer between the route's answer and the reader, so the console now offers both: **Basic** for reading a
result, **Advanced** for reading the route.

- **[New]** **A Basic / Advanced switch in the console's header**, remembered for the browser. Basic is the
  formatted reading. Advanced is the console exactly as it printed before any of it: the route's own field
  names in the route's own order, one per line, every declared column whatever it holds, timestamps as the
  ISO strings they arrived as, and `true`/`false` rather than a date and an answer. Neither loses anything
  the other has.
- **[Update]** **The mode is a rendering decision, so it is applied when a result is drawn.** An entry keeps
  both what Basic needs (labelled fields, the visible columns) and what Advanced needs (the body, the
  declared columns), and the switch reformats the **whole scrollback** — so one result can be read both ways
  without running the command twice, which is the only way the two are genuinely comparable side by side.
- **[Update]** **The table's footer follows the mode.** Basic still says how many columns it left out;
  Advanced prints them, so it says the row count and nothing else. Rows are tinted only in Basic, and an
  empty cell is `—` only in Basic — the em dash is a reading, and Advanced does not read.

**Verification:** web `tsc` clean; `check-help-links` green. Live in the browser: `client show Globex` in
Advanced prints the original padded dump (`  createdAt          2026-08-12T06:04:15.103Z`, empty fields listed
in body order) and in Basic the labelled card, from the *same* entry; `ticket list --limit 3` in Advanced
shows the ASSIGNEE column with blank cells and a bare `3 rows` footer, in Basic five columns and
`3 rows · 1 column empty in every row, hidden`. Toggling back and forth reformats what is already on screen,
the choice survives a reload, and `/console` carries the same switch.

Help gained the switch in its output section, a new FAQ answer (*"I preferred the console's old output"*), an
Index row and an amendment to the existing column answer; PLAN-028 records the two readings and why the mode
is applied at draw time.

---

## 2026.10.8.046 — The dead billing package is gone, and both gates pass for the first time

`pnpm lint` failed on `@C7NTAX/email` and `@C7NTAX/billing` with `TS6059 — File … is not under 'rootDir'`, one
error per file of `@C7NTAX/shared`. Fixing that turned out to be the easy half: underneath it, one of the two
packages had never worked at all.

- **[Fix]** **The `rootDir` shape, in both packages.** The root config resolves `@C7NTAX/*` to the sibling
  packages' **source**, so typechecking `email` or `billing` pulls `packages/shared/src/**` into the program —
  and a `rootDir` of `./src` then makes every one of those files an error. The API already had the answer
  (no `rootDir`), so both packages now match it rather than introducing a second convention.
- **[Fix]** **`packages/billing` was dead code, and it is removed.** With the config error gone, the package
  reported **27 real type errors** — `ServiceAgreement.services`, `Invoice.number`, `taxTotal`, `clientName`,
  `EmailService.sendInvoiceEmail` — every one a name the schema or the email service no longer has. Nothing in
  the repository imported it: no file anywhere referenced `@C7NTAX/billing`, and it was listed as a dependency
  of `apps/api` where it was never used. It was also the **sole reason `pnpm build` failed**, so the build task
  has been broken for as long as it has existed in this shape. The 361 lines across `BillingEngine.ts`,
  `InvoicePdf.ts` and `index.ts` are in git if the decision is ever reversed.
- **[Update]** The unused dependency is gone from `apps/api`, the `@C7NTAX/billing` path mapping from the root
  `tsconfig.json`, and the lockfile no longer carries the package or its 124 transitive dependencies (pdfkit,
  handlebars and their trees). Nothing imports those either — checked before removing them.
- **[Update]** The API's own invoicing, billing and batch-billing routes are untouched: they are where the
  capability actually lives, they are covered by the billing probes, and they never depended on this package.

**Verification:** `pnpm lint` — **6 of 6 tasks successful** (it was 3 of 7, with both packages failing).
`pnpm build` — **6 of 6 successful** (it was failing on `@C7NTAX/billing#build` with 3 of 6 done).
`GET /api/health` answers `{"status":"ok","version":"1.0.0"}` and the web app returns 200 after the 124
packages were pruned, so nothing was depending on them transitively.

**Found and reported, not changed:** `apps/api` has the same source-resolution shape as the two packages
fixed here, so its build emits a mirrored tree (`apps/api/dist/apps/api/src/index.js`) while its
`"start": "node dist/index.js"` names a file that build does not produce. Nothing in the repository runs
`start` — production runs `src` through tsx — so it is latent rather than live, and correcting it is a
decision about how production starts (a real emit with project references, or a `start` that names what is
produced) rather than a lint fix.

---

## 2026.10.8.045 — The console's output reads like a record, and the pop-up can be sized

The console printed a single record as one field per line, in the order the database happened to return
them: `client show Acme` was seventeen lines of field name followed by nothing, with the four values that
existed buried in the middle. The operator's screenshot said it better than a sentence can. The pop-up was
also a fixed size — 896px wide, however long the output was.

- **[Update]** **A record is drawn as a record.** The fields the command declares come first, in the
  command's own order, spelled the way a person says them — `portalAllowTicketCreation` is *Portal allow
  ticket creation*, and `id`/`url` keep their capitals. Timestamps read as dates (with the raw value in the
  tooltip), booleans are answered rather than spelled, numbers are grouped, and a value that is not there
  prints as `—` instead of as nothing at all.
- **[New]** **The fields that hold nothing are folded away, not deleted.** Everything else the route sent
  sits one click down under **“n other fields, m of them empty”** — nested objects and arrays included, as
  counts. *We hid it* and *it is empty* are different answers, so the counting line says which one it is;
  `--json` is still there for the route's own body, verbatim.
- **[Update]** **A table hides a column that holds nothing in any row**, and the footer says how many were
  left out (`4 rows · 1 column empty in every row, hidden`). Rows are tinted on the odd line and empty
  cells print `—`, so a wide table can be read across.
- **[Fix]** **The client noun described fields a client does not have.** `client list` asked for
  `shortName`, `status` and `type`; a `Company` row carries `clientId`, `companyType` and `isActive`, so
  the table printed three em dashes in every row and `client show` reported a record as almost empty. The
  columns, and the subject lookup that matched on the same three names, now name the real ones — which is
  why `client list` shows six useful columns and `client show` resolves `Acme` with `→ client Acme
  Corporation · Client · yes`.
- **[New]** **The pop-up is resizeable.** Drag its right edge, its bottom edge or the bottom-right corner;
  the size is remembered per browser (a window preference, not a record to administer), a **double-click**
  on the corner restores the default, and the corner takes **arrow keys** (held **Shift** for bigger
  steps) because a console is a keyboard surface. The panel is capped by the viewport, so dragging cannot
  put the handle out of reach.
- **[Update]** **A wide panel earns two columns.** The record card splits in two once the panel passes
  1080px, measured with a `ResizeObserver` on the panel rather than a viewport breakpoint — the whole point
  of resizing is that the panel is no longer the window.

**Verification:** web and shared `tsc` clean; `guard:console` green (85 commands, every path and permission
still verified); `check-help-links` green. Live in the browser: `client show Acme` reads as a 17-field card
with *34 other fields, 29 of them empty* beneath it; `client list --limit 5` shows NAME / CLIENT ID / TYPE /
ACTIVE / PHONE / CITY with no hidden columns; the pop-up was dragged from 896×508 to 1148×709, came back at
1148×709 after a reload, moved 48px with two arrow presses, and returned to 896px on a double-click — with
the stored size removed. The `/console` page renders the same card and offers no handles, because it is a
page rather than a window.

---

## 2026.10.8.044 — The probe residue is gone, and three tools that were quietly doing nothing now work

The dev database had accumulated 21 fake clients — sixteen **Persona probe client …**, four **Probe KB
client …** and one **Expense Probe …** — carrying their tickets and comments, in a list that is supposed
to be the customer list. Every one of them came from a verification probe doing what probes do (writing
real rows through the real API) and then failing, crashing, or never cleaning up at all. The cleaner that
removes them already existed; nothing ran it, and it did not know two of the three shapes. Fixing that
turned up the same fault twice more: a probe whose cleanup sat below its own early exit, and a
verification script with two steps that had never run while the line beneath them said everything was
fine.

- **[New]** **`pnpm probes:sweep` and `pnpm probes:sweep:apply`** — the residue cleaner is now a script
  with a name, runnable from the root. A dry run by default, because a script that deletes clients should
  say which ones first.
- **[Update]** The cleaner learned the shapes it was missing, including the KB autogen probe's client and
  tickets — matched through the client's own name and then the records hanging off it, not by the drafted
  article's title, which is the model's, not ours.
- **[Fix]** **`probe-permissions.mjs` never cleaned up at all.** Nine kinds of row × six personas, six
  times a run: it is the source of every one of the sixteen **Persona probe client** rows, two per run.
  Each row is now named with one stamp for the whole run, and a single `sweepCreated()` runs from a
  `finally`, so a normal finish, a 500 and a thrown fetch all end the same way. The chat sessions it opens
  are matched by persona and run window, because `ChatSession` has no title to match on.
- **[Fix]** **`probe-kb-autogen.mjs` cleaned up only on its happy path.** Its own early exit — the one
  that reports *“no article was drafted — is the API running with EGRESS_ALLOW_PRIVATE…”* — called
  `process.exit()` two lines above the tidy-up, which is precisely how four failed runs left four clients
  behind. The cleanup is now one idempotent `sweepProbe()`, called from the normal end, from that early
  exit and from a `catch` on `main`.
- **[Fix]** **`verify-post-change.ts` had two steps that had never run, and said all checks passed anyway.**
  Both resolved their working directory one level short: `cwd: __dirname` is `apps/api/src`, so the
  snapshot capture looked for `apps/api/src/src/snapshot-capture.ts`, and `resolve(__dirname, "..", "..")`
  is `apps`, so the changelog generator looked for `apps/scripts/generate-buildnotes.mjs`. The two steps
  exist to keep the snapshots and the What's New fallbacks true, and each printed a `✗` followed by
  *“All checks passed”*. The paths are named once (`API_DIR`, `REPO_ROOT`) and a step that could not run is
  now reported in the closing line instead of being folded into a sentence about health. The exit code is
  deliberately unchanged: this script is also run beside a commit hook, and a fallback that could not be
  regenerated is worth reporting without blocking the commit that regenerates it.
- **[Update]** The residue itself is removed: 21 clients, 9 tickets, 12 comments and 154 invalidated
  sessions. Five real clients remain (Acme Corporation, Globex Industries, Initech Solutions, Umbrella
  Corp, Stark Enterprises). Users, products, connector services and the audit trail are untouched — the
  audit rows a probe wrote are history, and history is not clutter.

**Verification:** a second `pnpm probes:sweep` reports zero of every residue shape.
`probe-permissions.mjs` runs its full matrix and ends with `cleaned up: 2 articles, 2 categories, 2 rules,
2 surveys, 2 reports, 2 clients, 2 locales, 2 providers, 5 chatSessions, 6 sessions`.
`probe-kb-autogen.mjs` was run and **failed on exactly the early-exit path that used to leak** — and left
nothing behind, which is the test that matters. `pnpm --filter @C7NTAX/api verify` now completes all five
steps, including the two that had never run. Live in the browser: the Clients list shows five rows and no
probe names.

Help and the API documentation need no change here: no route, permission, setting or screen moved. This is
the removal of test residue and the repair of the two scripts that produced it.

---

## 2026.10.8.043 — The console is a permission, and it can be switched off per person and per client

The console shipped as something the deployment offered and every signed-in person could see. The
operator asked for the opposite, in one sentence that is the whole specification: *"add configuration
options and in Administration and permissions so that I can disable the console on a per user or per
client basis. The console icon shouldn't even be displayed, if they don't have permissions to it."*

- **[New]** **`console:use` — the console's own permission**, in a permission category of its own.
  Granted to Manager, Technician, Dispatcher and BillingManager; deliberately not to the client-facing
  or read-only roles. Both catalogue routes carry `requirePermission(Permission.ConsoleUse)`, so the
  route-guard exemption the two open routes needed is gone — 439 routes, 388 carrying a permission, no
  documented exemptions.
- **[New]** **Per person, subtractively.** `User.deniedPermissions` lets an administrator withdraw any
  permission a role grants, which is what makes "everybody in this role except them" expressible; the
  Users & Roles permission tab now sends both the grants *and* the removals, so unchecking a role
  permission finally does something. A guard refuses denying `user:manage` to yourself.
- **[New]** **Per client.** `Company.consoleEnabled` on the client's own record (a **Console** card
  beside Customer Portal) withholds `console:use` from that client's people and nobody else's. It needs
  `system:config` to change, and the card says so for anyone who may not.
- **[Update]** **One resolver, four gates.** `effectivePermissions` in the auth middleware is now the
  single answer to "what does this session hold": role + individual grants − individual removals −
  anything a client's switch withholds. Both catalogue routes, `GET /auth/session`, the sign-in
  responses and the header all read it, so a hidden icon and a refused request are the same answer.
- **[Fix]** **The sign-in paths published a more permissive set than the truth.** `login`, the MFA
  verify, the emailed-code verify and change-password computed the effective set from a user row loaded
  without its `company`, so the client's switch could not be applied and a fresh sign-in briefly showed
  the console to somebody the client had switched it off for (a reload corrected it, which is exactly how
  a permission bug hides). One shared `PERMISSION_SUBJECT_INCLUDE` now loads every subject the resolver is
  asked about.
- **[Update]** **The header control says what it is.** The bare prompt glyph became a labelled
  `SquareTerminal` reading **Console**, styled like Search and Recent beside it — the glyph read as
  decoration next to five labelled neighbours. It is not rendered at all without the permission: a control
  somebody may not use is not a control to show them greyed out.
- **[Update]** **`/console` refuses instead of pretending.** Reached by URL without the permission — a
  pasted link outlives the permission that made it — the page explains which of the three switches is
  closed rather than drawing an empty console.
- **[Update]** **Documented where it is decided.** Help gains a Command console reference with the three
  switches, four FAQ answers (why the button is missing; what the permission does and does not widen; the
  per-client switch; whether the console writes), six Index rows and a **Console & the Command Line**
  walkthrough; `docs/API.md` §12 explains `deniedPermissions`, `consoleEnabled` and why `permissions` and
  `user.permissions` are not the same list; PLAN-028's D4 and §19 are amended where they claimed the
  console would add no permission.

**Verification:** API and web `tsc` clean; `guard:console` green (85 commands); `guard:routes` 388 of 439
routes guarded, 0 violations; `guard:api-docs` and `check-help-links` green (25 walkthroughs).
`apps/api/probe-console-access.mts` **24/24** — the role's grant, an individual removal reaching the live
session without a re-login, the client's switch, and the deployment switch answering 404. Live in the
browser: as a technician the header showed **Console**; removing `console:use` through Users & Roles made
the icon disappear on the next sign-in, and switching the client's console off did the same for that
client's account only; `/console` showed the refusal. Every change was undone afterwards — the throwaway
account deleted, the client's switch returned to unset.

---

## 2026.10.8.042 — The Recent menu's footer says "Show All"

The link at the foot of the Recent activity menu read **Full audit trail**, which named the destination — an
administrator's screen with an audience and a vocabulary of its own — where the menu is about *this*
person's last five activities. **"Show All"** says what the click does from where the reader is standing,
which is the question the menu exists to answer.

- **[Update]** **Same destination, plainer words.** The link still opens `/admin/logs`; only the label
  changed. Nothing about what the page shows, who may open it or what it is called there has moved.

**Verification:** web `tsc` clean. Live in the browser: the menu's footer reads `Show All`, its `href` is
still `/admin/logs`, the five activities above it are unchanged, and the string `Full audit trail` no
longer appears anywhere in the menu.

---

## 2026.10.8.041 — `c7ntax`: the console, in a terminal, on an API key

`apps/cli` exists: a command line that authenticates with an API key and parses, completes and runs from **the same shared module as the in-app console**. That it works at all is the evidence that the grammar is genuinely shared rather than merely copied — `c7ntax _complete "ticket l"` and the popup's `Tab` answer from one engine.

- **[New]** **`c7ntax login --server <url> --key c7k_…`** verifies the key against the API before storing it, and writes `~/.c7ntax/config.json` with the file's mode set explicitly to `0600` (`writeFileSync`'s mode is subject to the umask and ignored for an existing file). **No password is ever stored** — a password is a credential for a person, and this file belongs to a program: the key is issued in the application, scoped to what its owner holds, attributed to them in the audit trail, and revocable on its own. `C7NTAX_SERVER`/`C7NTAX_KEY` override the file, which is what makes it usable in CI.
- **[New]** **`context`, `help [noun [verb]]`, `version`** — all generated from the served catalogue, so `help` answers "what may *this key* do" with exactly what the API said, and `help ticket list` prints the route, the permission and every flag the route reads.
- **[New]** **`_complete <line>`** and **`completion bash|zsh|pwsh`** — the generated scripts call back into the CLI rather than embedding a list, so completions come from the live catalogue, filtered by the key's scopes, and cannot go stale. The PowerShell completer builds a `CompletionResult` per candidate, so the menu shows the same descriptions the in-app console shows.
- **[New]** **Output that a person and a script can each read**: a right-aligned table sized to its content, `--json` for the raw route response, `--quiet` for identifiers one per line, and `--verbose` printing the method, path, permission and elapsed time to stderr so stdout stays pipeable. **Exit codes are the contract** — 1 usage, 2 refused, 3 not found, 5 policy, 6 the route failed — and every one is provoked by `probe-cli`.
- **[Fix]** **A command a key may not run reported itself as a typo.** The served catalogue is filtered to the key, so `user list` was absent from it and the parser said "no such command", exit 1 — and the hint read `user can:` **with nothing after the colon**. Now `CONSOLE_COMMANDS` (the same list the server serves from) tells "it exists, but not for this key" apart from "that is not a command", and the empty-verb-list case has its own sentence. The CLI still authorizes nothing; this is a message, and the comment says so, because the one thing that must not be built here is a second permission check.
- **[Update]** **Reads only.** The catalogue it parses from is the one the popup gets, so `ticket create` is refused by policy (exit 5) with the phase it arrives in — a hand-written write command in a CLI would be the second authorization list PLAN-028 §7 forbids.

**Verification:** `probe-cli` (new, `apps/cli`) **37 passed / 0 failed**. It runs the CLI as a **subprocess** against the running API, with an API key it issues and **revokes itself** (a scratch `HOME`, so the operator's real profile is untouched): login rejects a value that is not a key and accepts a real one; `context` reports the server and the command count; `help` and `help <noun> <verb>` name the route and the permission; a read prints a table with headings and a row count; `--json` parses; `--quiet` prints identifiers only; `--verbose` names the route on stderr; a subject resolves through the list route; **all five failure exits are provoked** (unknown noun 1, unknown flag 1, unknown subject 3, a command outside the key's scopes 2, a write 5); `_complete` offers nouns, verbs, a narrowed partial verb, a flag's real enum values, and **nothing this key may not run**; three completion scripts generate; the environment overrides the file; and after `logout` the CLI is not signed in. Also re-run: `probe-console-grammar` 55/55 after the parser change, `probe-console-catalog` 18/18. API, web and CLI `tsc` all clean; `guard:routes` 439/0; `guard:api-docs` 430/63; `guard:console` green.

---

## 2026.10.8.040 — The Recent menu now means *activity*: what you changed, where, and straight to it

The Recent button in the header was a placeholder with no handler. It is now the answer to "where was I?" — the last five things you **changed**, each naming the place and the action, each linking to the record it touched and **flashing the exact region** when you arrive. A page you merely passed through is not activity; a page that held you for two minutes is.

- **[New]** **Changes come from the audit trail, which was being written all along.** `GET /api/system/audit-logs?mine=true&limit=n` narrows the existing read to the caller's own rows — a *narrower* read than the route already served, so no new endpoint and no new permission. `nav` and `dashboard` rows are filtered out of the menu: real changes, kept in the trail, but "you moved a sidebar item" is not a place anyone wants to be taken back to.
- **[Fix]** **A creation now names the thing it created.** `POST /api/clients` stored the literal string `clients` as its audit row's entity id — there is no `:id` in that path — so nothing could link to the client that was just made. The audit middleware now captures the response body, and every creating route answers with the row it made, so `clients:create` rows carry the new client's id and the menu links straight to it. This is the audit trail's own quality improving, not just the menu's.
- **[New]** **Location first, then the action** — "Clients / Created new — Northwind Traders", "Administration → Configuration → Workspace / Changed setting — Command console". The location uses the **navigation's own words** (written down in one table, checked against the sidebar), because a menu that invents its own names for the same places is a second map of the application.
- **[New]** **Arriving points at the exact region.** A link carries `?hl=<target>`; the shell finds that region, scrolls it into view and flashes it with the brand ring for 2.6s, then removes the parameter so a reload does not re-flash stale news. Wired on three destinations that matter: a ticket's **Activity** card, a client's summary header, and **every control on the configuration screen** (each field is marked `data-hl="field:<id>"`, so a settings change lands on the switch you flipped). Anything else falls back to the page heading rather than doing nothing.
- **[New]** **The dwell exception, as specified.** `useDwellActivity` records a page only after it has been the current route for **two minutes without navigating away**, and a visit is stored in this browser rather than sent to the server — a dwell is a fact about the session, not an audit record, and the trail should not fill with the act of looking at things.
- **[Update]** **The list refreshes itself after a write.** A response interceptor re-reads the tail shortly after any successful non-`GET`, so a change appears in the menu without a reload — one place in `api.ts` rather than 200 call sites, and concurrent writes collapse into a single re-read. Signing out clears the cache, so one person's activity is never visible at the next person's first paint.

**Verification:** `probe-audit-mine` (new) **13 passed / 0 failed** — `mine=true` is served, capped, newest-first, and **every returned row names the caller** (the assertion that matters: "mine" answering with a colleague's rows would be a privacy defect, not a display bug), while the unfiltered read still contains other people's; and a created client's audit row **names the created record rather than the collection**. API and web `tsc` clean; `guard:routes` 439/0; `guard:api-docs` 430/63 (curated description extended for the two new parameters); `guard:console` green; help links clean. Live in the browser: the menu showed `Administration → Configuration → Workspace / Changed setting — Command console`, `Clients / Created new — Probe Audit Client …` and `Tickets / Created — Outlook keeps crashing`; clicking the first navigated to `/admin/configuration/workspace`, **flashed `field:console`** (measured: ring at 4px in the theme's crimson, region positioned in view at 355 of 797px), and left the URL clean; the same was confirmed for a ticket's Activity on a full page load.

**Two failures found by verifying rather than reading.** The flash first fell back to the page heading, because a single check one frame after mount runs before a page has loaded its contents from the API — the hook now keeps looking for the precise target for up to three seconds. Then it failed on a *full page load* while working on a click: React's development double-invoke re-runs the effect, and by then this effect's own URL cleanup had removed the instruction, so the second run did nothing. The instruction is now held in a ref that survives the re-run. Both symptoms were silent — a tidy URL and no flash — which is why the check was made by loading the page as well as by clicking to it.

---

## 2026.10.8.039 — The console as a page, and a URL worth sending to somebody

`/console` is the same console, with a URL that carries the command. `?c=ticket+list+--status+new` opens with that command already run — which is how a command becomes something a colleague can click, and how a run can be linked from a ticket or a runbook.

- **[New]** **`/console`** — `ConsoleDialog`'s body is now **`ConsolePanel`**, and the popup and the page are two frames around one component. That is what keeps their keys, grammar, completion and output identical: the difference between them is a border and a height. The popup gains **"Open as page"**; the page gains a **"Copy link"** button and a browsable catalogue panel, so the page says what it can do without anyone typing anything.
- **[Update]** **The URL tracks the last line run, not every keystroke** — a link is a command, not a transcript — and it is written with `replaceState` so a session does not fill the back button. The deep-linked command runs **once**, guarded by a ref rather than by state: React's development double-invoke would otherwise run a *write* twice the day writes exist, and a console whose shareable link fires twice is a console nobody should trust with one.
- **[Fix]** **`Esc` on the page no longer closes the console.** The popup and the page share one key handler, so `Esc` had to become "dismiss what is dismissible": on the page there is nothing to dismiss beyond the menu and the search, and closing the page would have taken the scrollback with it.
- **[Fix]** **The empty state's example was wrong.** It read `ticket list --status open --limit 10`, and `open` is not a ticket status in this application — the enum's values are `new`, `in_progress`, … So the first command a new user copies returned an empty table. It now says `--status new`, which is what the completion offers and what returns rows.

**Verification:** web `tsc` clean. Live: `/console?c=system+version` loaded with the command already run and its result on screen (the build `2026.10.8.038` it reports is the previous entry, which is correct while this one is being written), the URL read `/console?c=system+version` after the run, Copy link was enabled, the catalogue panel listed 85 commands, and the popup was re-checked for regression — it opens, the input takes focus, "Open as page" is present, and `Esc` closes it.

---

## 2026.10.8.038 — The console: PLAN-028 phases 0 and 1, and the header icon finally does something

The placeholder has been inert since 2026.10.8.029. It now opens a console that **runs real commands against the real API as the caller** — `ticket list --status new --limit 10`, `client show acme`, `report run ticket-volume` — with PowerShell-grade completion, and with **no new permission, no execution endpoint and no schema change**: a command is a name for a route, and the route authorizes the request.

- **[New]** **`packages/shared/src/console/`** — one grammar for every front end: `grammar.ts` (tokens, quoting, `;`, statement splitting, the word under the cursor), `catalogue.ts` (**85 read commands** across 15 groups, each naming its route and its permission), `parse.ts` (typed refusals with §9's exit codes), `completion.ts` (candidates by position, the longest common prefix, history prediction) and `execute.ts` (request building, `me` resolution, and subject resolution that **refuses an ambiguous match rather than picking one**).
- **[New]** **The console popup** — the header icon left of Search, now live (`Ctrl/⌘ .`), opening a themed dialog: `Tab`/`Shift+Tab` cycle candidates through their common prefix, `Ctrl+Space` opens the menu with a description per candidate, `→` accepts inline history prediction, `↑`/`↓` walk history, `Ctrl+R` searches it, `F1`/`?` help without losing the line, `Ctrl+L` clears, `Ctrl+C` abandons, `Esc` dismisses the menu before the panel. Output is a real table with column headings, or the raw body with `--json`, or identifiers with `--quiet`; `--verbose` prints the method, path, permission and elapsed time — **the line that teaches the API**.
- **[New]** **`GET /api/console/catalog` and `/catalog/:name`** — the same catalogue, **filtered by the caller's own permissions at call time**, so the CLI to come is not a second list and `help` answers "what can *I* run" on both front ends. 404 when the console is off, and a command the caller cannot run is 404 rather than 403, matching the record lookups.
- **[New]** **`guard:console`** — every command's path must resolve to a real route, its permission must be the permission **that route checks** (read from the generated specification), and every flag it offers must be a parameter that route actually reads. This is the check that stops the console becoming a weaker authorization layer than the API beside it. It runs in the Security Gate, and it found three real faults while being written.
- **[Fix]** **A flag the route would ignore is now impossible to type.** The universal flags are two kinds: `--json`/`--quiet`/`--verbose` belong to the console and always apply, while `--limit`/`--offset` are *route* parameters and are offered only by a command whose route reads them. Without that split, `board list --limit 5` would have been accepted and silently ignored.
- **[Update]** **Writes are refused with §7's message, not half-built.** `ticket create …` answers *"not available in the console yet — write commands arrive with PLAN-026's action manifest"*, exit 5, because a hand-written write command is exactly the second authorization list that section refuses. Reads land now; writes land behind the manifest.
- **[Update]** **`CONSOLE_ENABLED` (Workspace → Command console) turns the whole feature off** — the icon, the panel and the API's catalogue — and `c7_ui_console` is the per-browser override. Every existing screen, route and permission is untouched either way, which is the rollback PLAN-028 promised.

**Verification:** `probe-console-grammar` (new, `apps/api`) **55 passed / 0 failed** — the shape of a command line, quoting, `;`, comments, prefix resolution, the typed refusals (unknown / policy / usage / not-found), permission refusal, aliases, every completion position, and **ambiguity refusing instead of choosing**. `probe-console-catalog` (new) **18 passed / 0 failed** against the running API: the catalogue is served, filtered, described, fetchable by name, and a command it advertises runs. `guard:console` green (85 commands, 45 nouns, 15 groups, every path/permission/flag verified). `guard:routes` 439 routes / 0 violations; `guard:api-docs` 430 operations / 63 curated; `guard:config` 46 reads all declared; API and web `tsc` clean. Live in the browser: the dialog's border is the theme's (2px `cyber-600/50`, 12px radius), `help` prints the grouped catalogue, `ticket list` renders a table with the verbose line, `client show acme` resolved and named the record it chose, `ticket show <number>` resolved through the search route, every error path returned its §9 code, and with `c7_ui_console=0` the icon and panel disappear and the rest of the application is unchanged.

---

## 2026.10.8.037 — The copyright notice, and a build that says which build it is

Two facts the application now states about itself instead of leaving to whoever was looking: who owns it, and which release is running. Both are **derived rather than typed** — the year from the clock, the version from the newest entry of this file — so neither can drift.

- **[New]** **`© 2026 Cyber 7 Group, LLC`** — a footer in small type (11px) on the sign-in screen, on **every page of the staff application**, and in the customer portal (under the card before sign-in, and under its existing footer after). One `AppFooter` renders all of them: a notice that differed between surfaces would only raise the question of which one is correct, and the year is the current one because a notice frozen at the first release is wrong within a month. In the application shell it is **pinned to the bottom of the viewport rather than trailing the content** — a notice that needs a scroll to the end of a long page is absent from the page as the reader experiences it.
- **[New]** **The version, at the right of the logo in the account menu** — `v2026.10.8.037`, with the release's title and date as its tooltip. It is the same value What's New shows, read from the same file, so the two cannot disagree about what is running.
- **[New]** **`GET /api/system/version`** — the newest entry's `version`, `date` and `title` on their own, for a label that wants one string rather than 249 releases. A build whose notes cannot be read answers with `null`s rather than a 404: "unknown version" is a state a client renders, not an error worth logging on every page load. Documented in `docs/openapi.yaml` and in the curated operation list, and added to the route-guard exemption the changelog already holds — the same class of information, and not instance data.
- **[Update]** **BuildNotes.md is now parsed once and re-read only when the file changes** (keyed on mtime and size, not a TTL, so a deploy is picked up on the next request instead of up to a TTL later). The What's New page always tolerated reading the whole file per request; a menu label could not, and a TTL would serve a stale version after a deploy.

**Verification:** API and web `tsc` clean; `guard:routes` green (437 routes, 0 violations); `guard:api-docs` green (428 operations, 61 curated). Live: `GET /api/system/version` returns `2026.10.8.036` agreeing field-for-field with `changelog[0]`, and 401 without a token; the footer is present exactly once at 11px on `/login`, `/tickets`, `/settings` and `/portal`, and sits flush with the viewport bottom in the shell; the menu label measures 92×18 right-aligned in the brand row, its tooltip carrying the release title and date.

---

## 2026.10.8.036 — The first secret scan this repository has ever had, and what it found (no live credential, 144 false positives)

The scans are the fix; the finding is the interesting part. **103 findings locally, 144 in CI, every one a `generic-api-key` false positive** — and they are now accepted **with reasons** rather than suppressed by a blanket rule, in a `.gitleaks.toml` scoped as tightly as the scanner allows.

- **[New]** **`.gitleaks.toml`** — a reasoned allowlist, and the reasons were read before they were written. `.gitleaksignore` fingerprints were rejected as the instrument because the CI scan covers commits a local scan does not, so per-file reasons are what stay true across history.
- **[Update]** **What the 144 were, verified rather than assumed:**
  - **The fixture snapshots** — `users.json` is **bcrypt password hashes**, the Kumo access log is ids and timestamps, and the vault snapshot is `encryptedPassword`/`iv`/`authTag`, i.e. **AES-GCM ciphertext** that is worthless without the deployment's key (which is not in the repository).
  - **`cloudconnect.ts`** — the connector *field labels*: `secret: "Proofpoint API secret from your admin console"`. Help text telling an administrator where to find a value.
  - **`seed-full.ts`** — sample fixtures: `clientSecret: "xxx"`, `realmId: "1234567890"`.
  - **The two documents** — a route string (`GET /api/nav/favorites`) and a JSON `$ref` (`#/components/responses/BadRequest`); the generic rule matches both.
  - **`O365/New-C7NTAXMailboxApp.ps1`** — `14d82eec-204b-4c2f-b7e8-296a70dab67e`, which is **Microsoft's public Graph command-line client id**.
  - **No live credential was found.** That is the conclusion of reading each one, and it is the sentence a secret scan should produce once rather than a green tick that means nothing.
- **[Update]** **Scoped as narrowly as the scanner permits** — content matches (`regexes`) where the matched text *is* the reason, paths only where the whole file is fixtures. A future real secret in `docs/openapi.yaml` still fails the build, because the two documents are allowed by content rather than by path.
- **[Fix]** **The gitleaks step works** after the filename/checksum correction in 2026.10.8.035: **verified locally in both directions** — `gitleaks detect` against 718 commits reports **103 leaks, exit 1** with no config, and **no leaks, exit 0** with this one.

**One thing worth revisiting, and it is a posture decision rather than a bug:** the Kumo vault snapshot *is committed* — `apps/api/src/snapshots/kumo-passwords.json` carries the vault's ciphertext, because the snapshot poller captures that table like any other. Encryption is what makes it survivable; the honest fix is to stop capturing that table into a snapshot that lives in git, which is a product decision with a migration behind it (the file is in history). Flagged, allowed with a reason, and not forgotten.

**Verified — and this is the first time the workflow has ever concluded successfully.** Run [37819681866](https://github.com/C7-Intelligence/C7NTAX/actions/runs/37819681866) on `938879d`: **all four jobs pass** — Route guards and typechecks, Dependency baseline, Secret scan, Config and image scan. Before this arc, **164 runs had failed and none had succeeded**, so none of these four checks had ever gated anything: the guard was wrong about seven routes, the API typecheck was measuring a missing Prisma client, gitleaks needed a licence it could not have, and trivy's pinned release could not resolve its own installer.

---

## 2026.10.8.035 — The two CI fixes CI then told me were not fixed

The Security Gate ran against 2026.10.8.033's plumbing and produced two failures of its own — both mine, both fixable, and both now verified against the real release artifacts rather than assumed.

- **[Fix]** **The gitleaks step's checksum check could not find the file it had just downloaded.** `sha256sum -c` verifies the name **inside the checksums file**, and I had saved the tarball as `gitleaks.tar.gz` — so the verification failed on its own download. The step now keeps the release filename, works in `$RUNNER_TEMP`, and extracts the whole tarball. Verified locally against the actual release: the checksums file names `gitleaks_8.30.1_linux_x64.tar.gz`, the tarball holds `gitleaks` at its root, and the SHA-256 of the downloaded asset matches the published hash exactly.
- **[Fix]** **`aquasecurity/trivy-action@v0.28.0` cannot run at all, even with its `v`.** Adding the `v` (2026.10.8.033) resolved the action — and CI then reported the next layer: that release pins **`aquasecurity/setup-trivy@v0.2.1`, a tag that no longer exists** (the remaining ones are `v0.2.6`, `v0.3.0`, `v0.3.1`), so the action could never install its own scanner. Bumped to **`v0.36.0`**, which is the "deliberate bump of its own" the earlier entry said a bump should be — now required rather than optional, because the old release is unreachable rather than merely old. The job may still be red after this, and that would be the *right* red: severity CRITICAL,HIGH with `exit-code 1`, reporting real findings instead of failing to start.
- **[Update]** **What the same run confirms about the other two jobs:** "Route guards and typechecks" got past the guard, past the missing Prisma client (now generated), and failed only on the 47 API type errors that wave 1 then fixed — so that job should be green from 2026.10.8.034 onward. The dependency baseline and the secret scan are the remaining unknowns.

---

## 2026.10.8.034 — Wave 1 of the type debt: the API typecheck is clean, and two real defects fell out of it

**149 errors → 0.** Every one was in code that serves a request, and fixing them was not mechanical: two of them were defects the compiler was right about, and one of those meant a route could never work.

- **[Fix]** **`POST /api/system/calendar-sync` could never succeed.** The route creates a `CalendarSyncConfig` row from a provider and two sync flags, and the schema required **`accessToken`** — a token the route has no way to receive, so every call failed at Prisma with a required-field error. The column is now optional, because that is what the route always meant: the row records *which* calendar to sync, and the token arrives with an OAuth consent that does not exist yet. Dev seeding had been papering over it with `accessToken: "sample-placeholder-token"`. (`db push` applied, client regenerated.)
- **[New]** **`routeParam(req, name)`** ([middleware/routeParams.ts](../apps/api/src/middleware/routeParams.ts)) — a path parameter that is *guaranteed* to be a string, or a 400 naming it. `req.params.id` is always present at run time (Express only reaches a matched route) but its type is `string | undefined` under `noUncheckedIndexedAccess`, and every one of those reached Prisma as a maybe-undefined value in a required column. A cast would have removed the same errors and left the compiler blind at the next call site; this makes the guarantee real, and turns "the id is missing" into a 400 instead of a write with `undefined` in it.
- **[Fix]** **A half-written TOTP enrolment is now refused instead of decrypted with holes.** `kumo password totp verify` and the code display both destructured `[ciphertext, iv, authTag]` from a stored secret and passed the pieces straight to `decrypt()`; a record with a missing part (which the type system knew about) would have decrypted `undefined`. Both now 400 with a sentence that says what is wrong with the record.
- **[Fix]** **The audit trail's `entity` can no longer be empty.** `extractEntity` returned `parts[0]` from a split path — `undefined` by type, `""` in practice — and that value becomes the filterable `entity` column of every audit row.
- **[Update]** **The rest, honestly grouped:** 13 in `system.ts` (a Prisma create input, a config key resolved three different ways, and a changelog reader indexing regex matches — a header that does not yield both groups is now skipped rather than recorded half-read); 8 in `cloudconnect.ts`, where one handler resolved its own id **six times with non-null assertions** and now resolves it once; 5 in `tickets/index.ts`; and one or two each across `projects`, `boards` (an array index), `surveys`, `billing`, `chat`, `contracts`, `crm`, `inventory`, `kb`, `roles` (a `SystemRole` comparison the compiler was right about), and two Prisma JSON columns in the inference service, cast at the boundary the way `routes/inference.ts` already does.
- **[Fix]** **`onTicketStatusChange`'s `oldStatus` is a `string` again** — it is read from a column that holds the enum's vocabulary but not the enum's type, and the function only ever compares it to one member. Widening the parameter is more honest than the cast that was being asked for at the only call site.

**Verification (the part that matters after 47 call sites):** API `tsc` **0 errors**; **15 probes** run against the live API — `probe-connector-setup` 388/388, `probe-products` 82/82, `probe-billing-generate` 45/45, `probe-kb-autogen` 42/42, `probe-m365-inactivity` 36/36, `probe-kumo-audit` 34/34, `probe-cloudconnect-status` 34/34, `probe-board-layout` 33/33, `probe-expenses` 27/27, `probe-scoping` 26/26, `probe-time-rules` 24/24. Three of them (`expenses`, `kb-autogen`, `billing-generate`) failed on the first run and pass with the flags **their own headers document** (`EGRESS_ALLOW_PRIVATE=true`, `KB_AUTOGEN_ENABLED=true`) — which is how the failures were attributed to the environment rather than to the change.

**Still open, and its own decision:** `packages/billing` — 54 errors of its own, written against fields the schema does not have, called by nothing.

---

## 2026.10.8.033 — The Security Gate's other three failures, and a typecheck that now measures the code

The gate's route guard was fixed in 2026.10.8.032. The three failures behind it — the ones nobody had seen because the guard always failed first — are fixed here, and the API typecheck now counts **47 errors instead of 149**, every one of them in code that serves a request.

- **[Fix]** **The API typecheck in CI was measuring a missing Prisma client, not the code.** The generated client is not in the repository and nothing in the job produced it, so every model type was `any` — which is what `TS2347 "untyped function calls may not accept type arguments"` and `TS7006 "implicitly has an 'any' type"` are the signature of. CI reported **378** errors where the same command locally reported **149**. The job now runs `pnpm --filter @C7NTAX/api db:generate` first, for the same reason the container generates against its copied schema.
- **[Fix]** **The secret scan needed a licence that does not have to be bought.** `gitleaks-action@v2` requires a key for an organisation repository and the `GITLEAKS_LICENSE` secret does not exist, so the job could never pass. It now runs the **gitleaks CLI** — the scanner itself is MIT — pinned to 8.30.1 and verified against the release's published SHA-256 checksums, because a step whose job is to fail a build should not be able to change underneath us.
- **[Fix]** **The config and image scan could not resolve its own action.** The workflow pinned `aquasecurity/trivy-action@0.28.0`, but the action's tags are `v0.28.0` … `v0.36.0`: without the `v` the action is not found, which is why this job has never run at all. Restored to the version the pin intended; bumping to a current release is a deliberate change of its own, since it can surface new findings.
- **[Update]** **The API typecheck is now about shipped code.** Two things were inflating it: **73 of the 149 were `src/seed-*.ts` and `verify-post-change.ts`** — entry points run by hand with `tsx`, never imported by the server — and **27 more came from one unused import**. The seeds are excluded from `apps/api/tsconfig.json` with the reason written down (they still fail loudly when run, which is where a seeding script is run), and `routes/billing.ts` no longer imports `BillingEngine`, which it never used.
- **[Update]** **What that leaves is 47 errors, all in `apps/api/src`**: `system.ts` 13, `cloudconnect.ts` 8, `tickets/index.ts` 5, `kumo.ts` 4, `projects.ts` 3, then one or two each across ten more files — and they are no longer a single shape. They are a mix of `req.params`/`req.query` narrowing, regex-match indexing in the changelog reader, two Prisma JSON fields typed as `Record<string, unknown>`, and one role string the compiler is right about. Burned down in waves, starting with the next commit.

**Found, and its own decision: `packages/billing` has never compiled.** Its own typecheck reports **54 errors** and it is written against a schema that does not exist — `Invoice.number`, `Invoice.clientId`, `Invoice.taxTotal`, `ServiceAgreement.services`, `ServiceAgreement.customFields`, `EmailService.sendInvoiceEmail` — none of which are in the Prisma schema it is compiled against; its `index.ts` also re-exports two types the engine file does not export. Nothing in the application calls it: the only reference anywhere was the unused API import removed above. Repairing or removing it is a billing question, not a typecheck one, so it is reported rather than touched. (`pnpm build` at the root cannot pass while a `tsc` build for that package is in the graph; the container is unaffected because it builds only the web app.)

**Verification:** `guard:routes` green (436 routes, 0 violations); `guard:api-docs` green; API typecheck **47 errors, all under `apps/api/src`, none in the shared or billing packages**; web `tsc` clean.

---

## 2026.10.8.032 — `guard:routes` was wrong about seven routes that had a guard, and now it is green

The route-guard lint read each route's middleware for an inline `requirePermission(...)`. A file that guards a family of routes with one line — `const MANAGE = requirePermission(Permission.SecurityManage)` — states the same protection once, and the check could not see it, so it reported guarded routes as unguarded. Fixed by **resolving the name to its declaration**, never by trusting it.

- **[Fix]** **A named permission middleware is now recognised, provably.** The name must be declared in the same file, assigned an expression containing `requirePermission(`, used as a whole argument, and **not reassigned anywhere** — a `let` that is reassigned is not a guarantee and still fails. Names that cannot be resolved are not proof: the four `sso.ts` routes are now correctly reported as guarded, and a fake middleware name is still a violation.
- **[Fix]** **`nav.ts`'s three `/favorites` routes carry a documented exemption.** They are the signed-in user's own pins — no id in the path, every row keyed to the caller, the list normalised rather than trusted — which is exactly the `dashboard.ts` decision already in the list, so it gets the same treatment: an exemption with a reason, not a permission that would let one person read another's pins. The guard had been reporting them since the file was written; nothing was actually unguarded, nobody had written the reason down.
- **[Update]** **The summary line names the constants it resolved** — `436 routes, 386 carry a permission (4 through a named constant: MANAGE)` — so a resolution is visible in the output rather than silently widening the check.

**Verification:** `pnpm guard:routes` → **436 routes, 0 violations, exit 0** (was exit 1 with seven). The detection was proved in both directions with a temporary four-case probe — auth with no permission **fails**, a middleware that is not a permission **fails**, a name declared as `requirePermission(...)` **passes**, and a name declared as a permission but reassigned **fails** — then the probe file was removed and the tree re-checked green.

**Found while verifying, and not fixed here — the Security Gate has never passed.** All **164** runs of `.github/workflows/security.yml` have failed (`0` successful, `0` cancelled); the guard's seven false/undocumented violations were only the *first* step to fail, which is why nobody has seen what is behind it:

| Job | Why it fails | Owner |
|---|---|---|
| Route guards and typechecks | *This* fix. The next step, **Typecheck the API**, has **149 pre-existing TypeScript errors** (72 strict-null, 37 type mismatches, 18 missing properties — `auditLog.ts`, `billing.ts`, `boards.ts`, `chat.ts`, `cloudconnect.ts`, …) that CI has never reached | code — needs a decision about the strictness baseline |
| Secret scan | `gitleaks-action` requires a licence for an **organisation** repo; the `GITLEAKS_LICENSE` secret does not exist | yours — a licence and a secret |
| Config and image scan | The workflow pins `aquasecurity/trivy-action@0.28.0`, but the action's tags are `v0.28.0` (and up to `v0.36.0`) — the missing `v` means the action cannot be resolved at all | one character, offered |

---

## 2026.10.8.031 — The address you are connecting from, on the sign-in screen and in My Account

Two places now answer a question that previously required reading a log: **which address am I arriving as?** It is on the sign-in screen and under the identity block in the account menu, in the same small type as the line above it.

- **[New]** **`GET /api/auth/client-ip`** — the address the server sees this connection arriving from, unauthenticated on purpose because the sign-in screen asks before a session exists. It answers with the same value the session record and the audit trail carry, so what a person reads on screen matches what the trail says about them, and a support conversation about "sign-in fails from the office but works from home" can compare the two. Nothing here is instance data: the caller is handed their own address back.
- **[New]** **"Connecting from …" on the sign-in screen**, under the service-status panel at 11px, in the monospace the rest of the app uses for addresses. The sign-in screen is where the value earns its place: a VPN, a proxy or a client's network is the usual reason a sign-in behaves oddly, and this is the first fact worth having.
- **[New]** **"Connecting from …" in My Account**, on its own line below the identity block — a fact about the connection rather than about the person, so it is not stacked into the name and email. Same 11px as the email line above it, `title` explains what the value is.
- **[New]** **`useClientIp()`** — one request per page load shared by both surfaces, cached at module level so the menu and the sign-in screen cannot ask twice, and a failure is silence rather than an error: the line simply does not render.
- **[Update]** **The API's own documents** follow: `docs/openapi.yaml` regenerated from the routes (427 operations), a curated description added to `docs/api-operations.json`, and `docs/API.md` §2.1 records the endpoint and what it returns — including that behind a reverse proxy the address is the proxy's until `trust proxy` is configured.

**Verification (live):** the endpoint answers and it is genuinely the caller — `::ffff:127.0.0.1` when called directly over IPv4 and `::1` through the Vite proxy, which is how we know it is reading the connection and not a constant. Signed in: the account menu's rows are brand → identity → **Connecting from ::1** → profile rows, with the line *outside* the identity block, 11px against the email's 11px. Signed out: the sign-in screen shows the same line at 11px (against 14px body text). Web `tsc` clean; API `tsc` at its 149-error pre-existing baseline; `guard:api-docs` and `check-help-links` pass.

**On this machine you will see `::1`** — the browser, the dev server and the API are all on one host, so loopback is the honest answer. From a tunnel or another machine it reports where the request actually came from.

**Found, not fixed (pre-existing):** `npm run guard:routes` fails on four `sso.ts` routes (`GET`/`PUT /oidc`, `POST /oidc/discover`, `POST /oidc/test`). They *are* permission-checked — `const MANAGE = requirePermission(Permission.SecurityManage)` — but the guard's pattern only recognises `requirePermission(` written inline, so it cannot see a named middleware constant. Not a security hole; a guard false positive, introduced with the SSO work and unrelated to this change.

---

## 2026.10.8.030 — The Cancel button on "Select Service Type" now leaves the flow

Cancel in the connector add flow set a flag that nothing looked at, so the screen it was supposed to close stayed exactly where it was. Fixed, and the exits of that flow are now consistent.

- **[Fix]** **`C7NC → Services → Connect a service → Cancel`** did nothing. The add flow is a *view* of the Services tab (`add`, like `configure`, keeps Services lit in the tab strip), so what decides whether it is on screen is the tab — but Cancel only called `setShowAdd(false)`, and `showAdd` had been reduced to "scroll this into view when it opens". The click was real, the state change was real, and the view did not move. Cancel now leaves the flow the way the tab strip does — back to Services — which is also what fixes it when the flow is left by any other route.
- **[Fix]** **The two Cancels *inside* the flow** (the configuration form's header and its button row) had the same dead flag in them. They now step back one level to the type list, which is what "Cancel" means on a form — and the second one no longer implies it is leaving the whole flow when it is not.
- **[Update]** **The exits are now one rule instead of three variations**: the type list's Cancel ends the flow (Services), the form's Cancel returns to the type list. Nothing else about the flow changed — same fields, same wizard, same creation.

**Verification (reproduced first, then fixed, then re-walked):** before the change, clicking Cancel on the "Select Service Type" panel left the heading reading *Select Service Type* — asserted against the DOM, not by eye. After it: entering the flow (heading *Select Service Type*), cancelling out (heading gone, the Services list and its "Connect a service" button back), re-entering a **second** time (so this is not a first-click-only fix), choosing *Fill the form* (heading *Configure Microsoft 365*), cancelling there (back to *Select Service Type*, still inside the flow), and cancelling again (out to Services). Web `tsc` clean.

**Checked and not broken:** the connector wizard's own Cancel closes the modal (it calls the wizard's `onClose`, which clears the type), the connection fix dialog's Cancel clears the state it renders on, and a sweep of the other 55 Cancel/Close controls in `apps/web/src` found the same "single state write" shape — all of them writing the value their dialog actually renders on. This defect was the flow whose visibility had moved to the URL-driven tab while its Cancel was still talking to the old flag.

---

## 2026.10.8.029 — A Console in the header, and the plan for what it will do (401 commands, PowerShell-grade completion)

The Console's icon is in the header — **placed, labelled and deliberately inert**. No behaviour is wired to it; this buildnote is the plan for the behaviour, and the icon is there so the layout the plan describes is the layout you can already look at.

- **[New]** **A Console control in the header toolbar, immediately left of Search** — a `Terminal` glyph, icon-only, no action attached. Its two labels are honest about that: `aria-label` and `title` both read **"Console (coming soon)"**, so the tooltip says what the control is and that it does nothing yet. (It once would have read "Terminal" — the glyph's own name — which is exactly the generic labelling an earlier pass through every tooltip in the application removed.)
- **[New]** **`PlanDocs/PLAN-028-C7NTAX-Console-and-CLI.md`** — how a command line for C7NTAX is built: **one grammar in `packages/shared`, three front ends** (the in-app panel and `/console`, a standalone `c7ntax` CLI authenticating with an existing API key, and PLAN-025's MCP tools), where a command is a name for a route that already exists. Parsed where the person is, executed by re-entering the real route as the caller — so there is **no new permission, no new execution endpoint, no second authorization model, no schema change and no migration**, and the toggle is one config key.
- **[New]** **The command catalogue: 401 commands in sixteen groups**, each with the permission it needs and its risk tier — console basics (14), session and identity (10), tickets (32), boards and work (28), clients and pipeline (24), projects and time off (18), billing (35), products and assets (21), Kumo (36), knowledge, chat and surveys (18), reports and analytics (29), alerts and monitoring (18), AI and actions (17), integrations (39), administration (43), system and data (19). **Derived from the actual route surface rather than invented**: re-measured for the plan with the guard script's own enumeration, the API is **437 route declarations across 48 files — 187 reads and 250 writes**, behind **108 permissions**.
- **[New]** **Autocomplete, specified to PowerShell's standard** (§5.1, at the operator's request): `Tab` completes the word under the cursor and cycles (`Shift+Tab` walks back), `Ctrl+Space` opens a **menu with a one-line description per entry** (PSReadLine's menu-complete, including its tooltip), `→` accepts **inline prediction from your own history** with `Ctrl+→` taking a word and `F2` toggling inline/list view, and record-valued flags (`--client`, `--assignee`, `--board`, `--ticket`) complete from **the live API through a warm cache** — never a network call on a keystroke, with staleness labelled rather than hidden. All of it is one pure function, `complete.ts`, so the panel, the CLI and MCP share it; the CLI is its own completer (`c7ntax _complete`) so the three generated shell scripts cannot go stale.
- **[New]** **What the plan refuses**, written down because a console normally grows all of it: no pipes, variables or `eval`; no impersonation; no `critical` commands (PLAN-026 §8 keeps them proposal-only); no secrets in history or in a script; no frequency-ranked or model-inferred suggestions; and credential changes (password, MFA, passkeys), the customer portal and per-device push stay out of the catalogue entirely.
- **[New]** **Fifteen decisions (D1–D15)** and **seven phases** with the honest dependency stated first: the catalogue is a **projection of PLAN-026's manifest**, which is unbuilt, so **reads can land now and writes wait** rather than being hand-written into a second list that drifts.

**Verification (the icon, live):** signed in at `/c7nc` and asserted against the DOM, not by eye — the toolbar's first child is the Console control, its glyph class is `lucide-terminal`, it sits 28×28 at x=835 immediately left of the Search control, and hovering it renders **"Console (coming soon)"** in the application's own tooltip. Nothing is wired: the button has no handler and no route. Web `tsc` clean; the plan doc is documentation, so no build artefact changes.

**Not built, and said plainly:** the console itself does not exist yet. Phases 0–2 (the grammar, completion and a read-only console) are ~5 days, of which 2–3 days are work PLAN-026 owes independently.

---

## 2026.10.8.028 — PLAN-026 Phase 0: an approved AI action is carried out (and the sentence that could not be typed)

PLAN-026, started where it said to start. **Approving an AI action now does the thing.** Until today `POST /api/ai-actions/:id/decide` set a status and stopped — the proposals the assistant raised were recorded, reviewed, approved and never carried out, so the AI Actions screen's own promise ("nothing is written until a person approves it") was true only because nothing was written at all.

- **[New]** **The executor** (`apps/api/src/services/ai/apply.ts`). An approved action is applied by **calling the same route the screen calls, as the person who asked** — not by re-implementing the write beside it. The second implementation is the one that drifts: validation, company scoping, ticket numbering, automations, the customer-notification rules and the audit entry all live in the route. So the executor mints a 60-second single-use token for the requester and calls the API over loopback, which means the route's own `requirePermission` is still the authority and a payload the requester may not perform is refused by the route rather than by a check somebody remembered to add.
- **[New]** **A payload kind with no handler is refused, never silently done.** `applyAiAction` returns `failed` with a sentence naming what it can carry out — the one failure that must never look like success. `critical` actions are never applied at all.
- **[Fix]** **`decide` applies on approve.** Rejecting writes nothing; approving applies and records `executed` (or `failed` with the route's own words, verbatim). The status vocabulary gains `failed`, and `approved` is no longer a resting place: the tier decides *who may skip the click*, never *who may do it* (PLAN-026 §8) — and this is the click.
- **[New]** **The record of what happened**: `AiAction` gains `actionName`, `mode`, `before` (the rows as they were, for undo), `result` (the created ticket's id and number), `errorMessage`, `appliedAt` and `appliedById` (additive; `db push` synced). The audit entry says "Approved and applied — MSP-1001-1009" or names the reason it could not.
- **[New]** **`find_people` and `list_boards`**, and `propose_ticket` now carries a **contact and a board** through to the executor — which is what makes the operator's own sentence possible: *"create a ticket for David Chen"*. The probe caught the bug that would have broken it: a first name and a surname are two columns, so a single `contains` per column can never match a full name. Every word in the query must now appear in the name or the address, so a full name, a surname and an email all work — and an ambiguous name returns everyone who matches, with their client, and the instructions say to ask rather than choose.
- **[Fix]** **A note for a ticket that does not exist is a 404, not a 500.** The foreign key used to fail the insert and the caller was told "Internal server error"; anything applying a proposal written earlier needs to be told which of the two things was wrong.
- **[Update]** **The AI Actions screen says what approving does** ("Approving an action carries it out — through the same route the screen uses, as the person who raised it"), shows what an applied action produced ("Created ticket MSP-1001-1009", or that a note was internal so nobody was emailed) and shows a failure with its reason.

**Verification:** `apps/api/probe-ai-apply.mts` — **49 checks, all passing**, against the real API and database: an approved internal note becomes a note (and the ticket gains exactly one), a client-visible one is recorded as having notified the customer, an approved ticket proposal creates a real ticket with a number, a board resolved rather than refused, the contact attached and `source: assistant`; `critical` cannot be approved and stays pending; an unknown payload kind fails with a sentence; a missing ticket fails with the route's own reason; replaying an approval is refused; a rejection writes nothing — and the last section walks the operator's sentence end to end (`find_people` → `propose_ticket` → approve → the ticket is attached to the person the prompt named). `probe-ai-assistant.mts` **61/61** and `probe-ai-provider` API **55/55** still pass (two expectations updated for the two new functions). Walked live in the browser: approving a real proposal on the AI Actions screen showed **"Applied: Created ticket MSP-1001-1009"** and the row went to `executed`; the ticket and the test action were removed afterwards. API types unchanged at their 149-error pre-existing baseline; web `tsc` clean.

**What PLAN-026 still owes** (§9): the manifest and its build guard (Phase 1), the generic `list_actions` / `describe_action` / `perform_action` surface with the intent token (Phase 2), tiering the rest of the application (Phase 4), `act` mode with caps and undo (Phase 5), MCP parity (Phase 6) and docs (Phase 7).

---

## 2026.10.8.027 — The landing page that would have quietly reset, and the alias in one place

The rename in 2026.10.8.026 left one hole, and finding it needed the code rather than the plan: a landing page is stored as a **path** and validated against `LANDING_PAGES` on the way out, so once `/cloudconnect` stopped being in that list, **anybody who had chosen it would have been dropped onto the Dashboard at their next sign-in** — no message, no clue, exactly the outcome PLAN-027's D7 said to avoid.

- **[Fix]** **The alias lives in one place now, and both sides use it.** `packages/shared` gains `LANDING_PAGE_ALIASES` and **`resolveLandingPagePath()`** — the stored path, mapped through the aliases, or `null` when it names a page that no longer exists. The API's `resolveLandingPage` uses it for a person's preference *and* for the instance default, and `PATCH /api/auth/me/landing-page` accepts a pre-merge path instead of refusing it (an open tab is old, not wrong). The Settings screen uses the same function rather than its own copy of the map, so the two cannot disagree.
- **[Fix]** **The mapping is asserted rather than assumed: 11 checks**, all passing — the pre-merge path resolves to `/c7nc`, the new path resolves to itself, ordinary paths and the Dashboard still resolve, a path that no longer exists is refused (rather than silently becoming the Dashboard *inside* the resolver), empty/null/whitespace values are handled, every offered page resolves to itself, and the list no longer offers the retired path.

**Verification:** the assertions above; `tsc` clean on the web app and on the touched API files. The running dev API is started as `tsx src/index.ts` **without watch**, so this change — like the rest of the API-side work today — takes effect at its next restart; the web half is live through Vite.

---

## 2026.10.8.026 — C7NC: CloudConnect merged in, as a section of five tabs (and the mockup's spacing fixed)

PLAN-027, built. CloudConnect is gone as a name and as a page: everything that connects C7NTAX to something else is now one top-level section called **C7NC**, with a hub that answers "is anything broken?" before the catalogue answers "what could we connect?".

- **[New]** **`/c7nc` — a section of five tabs, and the tab is the address.** *Overview · Services · AI models · Email · Companion apps*, drawn with the product's own pronounced tab strip (`components/ui/Tabs` — the one the customer portal and ticket boards use) with counts as pills and arrow-key navigation. Each tab has its own route (`/c7nc/services`, `/c7nc/models`, `/c7nc/email`, `/c7nc/apps`), so every one can be linked to, survives a reload and comes back from the back button. The page was renamed `CloudConnect.tsx` → `pages/C7NC.tsx` and its export to `C7NCPage`.
- **[New]** **The Overview hub.** A sentence instead of four counters — *"5 services · no model · 1 companion app — 5 need attention"* — then a **needs-attention block that names the reason in words** ("switched off", "the last sync failed", "not responding", "credentials incomplete") with **Open** and **Walk me through it** beside each one, then four subsection cards that carry their own live counts, then three signposts (API Access, alert webhooks, the connecting walkthrough) with the reason they are links rather than tabs. It is empty of actions by design: every button on it is a door into the page that owns the work.
- **[Update]** **Services keeps everything it had.** The connected rows, their statuses, health tooltips, the test/sync/configure/logs/enable/delete actions, the Microsoft 365 inactivity panel and the whole add-a-connector flow are unmoved — adding a connection is now a *mode of Services* rather than a tab of its own, reached from **Connect a service**, and one connection's configuration is a mode of Services too (the section tab stays lit, because that is where the reader still is).
- **[Update]** **AI models and Email become their own tabs** (`AiModelsPanel`, `EmailConnectorsPanel` — both unchanged), and **Companion apps** hosts the Outlook add-in page as-is, so the installer, its versions table and its download routes are not duplicated.
- **[Update]** **The navigation was reorganised around it.** CloudConnect is removed from Administration (which keeps API Access, webhooks and everything else), and C7NC is a six-child group: *Overview, Services, AI models, Email, FlexPoint Payment Solutions, Companion apps*. Clicking the group opens it and lands on the hub.
- **[Fix]** **The nav no longer asks for more permission than the page needs.** CloudConnect's entry required `IntegrationManage` while **eleven of the fifteen** of its endpoints read at `IntegrationView` — so a technician who may watch connection health and press **Test** and **Sync** could not reach the page at all. The section's children are now gated on what each actually needs (`IntegrationView` to look, `IntegrationManage` to change, `InferenceView` for models), which matches what the API has been enforcing all along.
- **[Update]** **The rename, done where it is visible.** Every user-facing string says C7NC: the nav label and descriptions, the page, the dashboard card, the Help index, the connecting walkthrough (retitled, with its anchor and path kept), the AI model links on the Assistant page, the FlexPoint page's link back, and the `C7NC & Email` configuration section.
- **[Fix]** **`/cloudconnect` redirects rather than 404ing**, and so does `/section/c7nc` — bookmarks, Help links and whatever anybody had open keep working. A stored landing page of `/cloudconnect` is mapped to `/c7nc` in Settings rather than silently falling back to the Dashboard. The **API path stays `/api/cloudconnect`** and the **`CLOUDCONNECT_LIVE_STATUS_ENABLED` configuration key keeps its name**: renaming either breaks integrations, probes and deployments for no functional gain, and PLAN-027 §7 records that decision.
- **[Fix]** **The mockup's card spacing.** The complaint was exact — the overview's blocks were stacked with no vertical rhythm at all, because the section element carried no `space-y` and the signpost row used a `gap-x-5` class the app's stylesheet does not contain. Fixed with classes the product actually ships: **24 px between blocks, 16 px between cards, 12 px inside them**, and the three switch knobs now use the app's own toggle markup. Measured in the browser rather than eyeballed (the gap between every pair of blocks, both grid axes, card padding and row spacing), and every one of the mockup's 148 classes was checked against the inlined stylesheet — **zero unresolved**, which is what let a missing spacing class show up as a visual bug rather than as nothing at all.

**Verification:** `tsc` on the web app is clean. Walked live in the running application as an admin: the tab strip renders five tabs with counts, **each route selects its own tab** (`/c7nc/services` → Services 5, `/c7nc/models` → AI models, `/c7nc/email` → Email with the mailbox panel, `/c7nc/apps` → Companion apps with the installer), **`/cloudconnect` redirects to Services**, clicking the nav group expands it and lands on the hub, the hub renders its sentence, attention block, four cards and three signposts, the nav contains **no CloudConnect entry** and Administration is one item shorter, and **no console errors** across all seven paths. The mockup was re-measured and re-screenshotted after the spacing fix.

---

## 2026.10.8.025 — PLAN-027: CloudConnect merged into C7NC, with a mockup you can click through

A mockup and a plan, no application changes. The request was to fold CloudConnect into C7NC, rename it, and show what proper landing pages, subsections and tab-style pages would look like.

- **[New]** **`docs/mockups/c7nc-merged-hub.html` — seven screens, drawn with the application's own compiled stylesheet**, opened in a browser and checked (screens switch, no console errors, the tab strip computes to the shipped `Tabs` colours). Screens: the **Overview hub**, **Services**, a **service detail page (FlexPoint)**, **AI models**, **Email**, **Companion apps**, and a design-notes screen carrying the before/after nav tree, the full redirect table and the rename's two lists. It is drawn inside a real app frame — nav pane beside content — so the design is judged on the surfaces the product actually uses.
- **[New]** **`PlanDocs/PLAN-027-Merging-CloudConnect-into-C7NC.md`** — §1 the three problems with evidence, §2 the architecture (a hub, four subsections, a page per service), §3 the hub's anatomy, §4 the rules that keep the shape (a subsection is a question, a tab is a facet of one, five tabs maximum), §5 where every existing tab and panel ends up, §6 permissions, §7 the rename, §8 the mockup, §9 eight phases with an acceptance test and a probe each, §10–13 costs, decisions, verification and scope.
- **[Fix]** **The plan's real prize is FlexPoint, which is split in two today.** Its connection is configured in CloudConnect; its options, ledger and invoices live under C7NC → FlexPoint; and that page's first button links back to CloudConnect (the empty state even tells you to add the connection "in CloudConnect"). One service gets one page: *Overview · Configuration · Ledger · Invoices · Activity*.
- **[Update]** **The front door asks a better question.** The hub leads with a sentence ("6 services · 1 model · 2 mailboxes · 1 companion app — 2 things need attention") and a *needs attention* block with the fix beside each problem, before the catalogue. It also fixes a quiet mismatch: the nav entry requires `IntegrationManage` while the API answers all eleven of the page's read endpoints with `IntegrationView`, so a technician who may watch connector health and press **Test** cannot reach the page at all. The merge shows the hub at `IntegrationView` — no new permissions anywhere.
- **[Update]** **The rename is measured rather than guessed: 230 occurrences across 41 files** (web 99, docs 65, probes 31, api 25, shared 8, infra 2). Four things are deliberately **not** renamed, each with the failure it would cause: the **`/api/cloudconnect` path** (kept as a documented alias so integrations and probes keep working), **`CLOUDCONNECT_LIVE_STATUS_ENABLED`** (renaming an env key silently disables connector verification on any deployment whose `.env` was not updated), a **stored landing-page value of `/cloudconnect`** (`LANDING_PAGES` offers it as a saved preference, so the redirect must catch it and the picker must show the new label), and the **Help walkthrough anchor `/help/walkthroughs/cloudconnect`** (a published URL). History — BuildNotes, Retrace, PlanDocs, the captured audit-log snapshots — is not rewritten either. A guard script keeps the rename from decaying: no `CloudConnect` in `apps/**` or `packages/**` outside a two-entry allowlist.

**Verification:** the mockup was opened and exercised in a browser — all seven screens switch, exactly one is visible at a time, seven view sections are present, and there are no page errors; computed styles confirm the nav, cards, chips, buttons and tab strip all resolve from the app's own stylesheet rather than from mockup-only CSS. The plan's claims were read from the code: `CloudConnect.tsx` (five tabs, line 543), `Layout.tsx` (the nav entry at line 58 and the C7NC group at 129), `C7NCFlexpoint.tsx` (the link back at 207–209), the fifteen endpoints in `routes/cloudconnect.ts` (eleven reads at `IntegrationView`, four writes at `IntegrationManage`), the route table in `App.tsx` (147, 173, 174), and the landing-page option in `appConfiguration.ts` line 161. BuildNotes 2026.10.8.025 prepended and regenerated into both fallbacks.

---

## 2026.10.8.024 — PLAN-026: model control of the whole application — and the finding that nothing applies yet

A plan document, not a feature. The ask was "the models should be able to control all aspects of C7NTAX, not just ticket creation", bounded by "within the context of the logged in/connected user's permissions". Reading the code to plan it turned up two facts that decide the whole design.

- **[New]** **`PlanDocs/PLAN-026-Model-Control-of-C7NTAX.md`** — §1 the honest starting point, §2 what "all aspects" means plus **§2.1 the boundary** (authority is the session's, never the model's), §3 what stays exactly as it is, §4 the shape, §5 the manifest and its build guard, §6 the executor, §7 the three policy modes, §8 what each risk tier now means, §9 confirmation and the operator's own sentence traced end to end, §10 safety when reads feed writes, §11 the surfaces, §12 ten decisions to freeze, §13 eight phases with acceptance criteria and a probe each, §14–17 costs, verification, related work and what would make it wrong.
- **[Fix]** **Approving an AI action applies nothing, and nothing in the repository applies it.** `POST /api/ai-actions/:id/decide` sets a status — `"executed"` for low/medium, `"approved"` for high — and no code anywhere reads `payload.kind`, calls `generateTicketNumber` or writes the note. Both payloads the assistant raises (`ticket_note`, `create_ticket`) are recorded and never applied, so a proposal a person "approves" today changes nothing, and `docs/API.md` §10's "nothing is written until a person approves it" is true only because nothing is written at all. Making an approval real is the plan's **Phase 0**, and it is where the requested capability starts.
- **[New]** **The operator's own sentence is not expressible yet, and the plan says why.** "Create a ticket for David Chen" needs a person lookup (no tool searches contacts — only companies), a board (`POST /api/tickets` refuses without `boardId`, and `propose_ticket` has no board argument), and a contact attached to the ticket (the route accepts `contactId`; the tool cannot pass it). Phase 3 covers the service desk end to end.
- **[New]** **"All aspects" is planned as a manifest, not as tools.** The API is 435 route declarations — **185 reads, 250 writes** — of which 17 are excluded by name with a reason (the model's own credentials in `auth.ts`, the Contact-facing `portal.ts`, and `push.ts`), leaving **233 staff-facing actions**. Each gets a descriptor: permission, tier, model-facing description, parameter schema, a human-readable preview and an inverse. Coverage is enforced by a new `guard:actions` check in the style of `guard:routes` — a mutating route with no descriptor, or one whose permission disagrees with the route's own, fails the build. 233 descriptors do not fit in a context window (~16k tokens of schema), so the ten curated functions stay first and three discovery tools (`list_actions`, `describe_action`, `perform_action`) cover the long tail — filtered by the caller's permissions, so a model cannot even see an operation the person cannot perform.
- **[New]** **One executor, and it re-enters the real route as the caller.** Rather than extracting 233 write functions into services, the executor dispatches the actual route in-process with a 60-second single-use token for the caller's own identity, so scoping, validation, customer notifications, automations and audit are identical by construction — and the route's `requirePermission` remains the authority alongside the manifest's own check. It records `before`, the created entity and its number, and the inverse (or an explicit `irreversible`).
- **[New]** **Tier now means "who may skip the click", never "who may do it".** Three modes per model connection — read only / **ask** (the default, which is exactly today's behaviour) / **act** — with `act` opt-in and a tier allowlist. `low` and `medium` may apply without a click in `act` mode; `high` (anything that emails a customer, money, or configuration) always asks; `critical` (users, roles, API keys, secrets, raw deletes) is proposal-only at every setting. Deletes are not offered — archive/soft-delete equivalents stand in — and a taint rule downgrades an action to a card when its identifying arguments came from tool output rather than the operator's prompt, which is the answer to prompt injection through a ticket body.
- **[Update]** **`PlanDocs/README.md`** — PLAN-026 registered in the wave rows and the registry with the dependency notes (Phase 0 is a fix; the manifest becomes PLAN-025's MCP tool surface). **PLAN-011's header** and **PLAN-025 §6** now record the split: PLAN-011 phase 9 is three pieces — the action layer (shipped 2026.10.8.020), the MCP server (PLAN-025) and the executor plus manifest (PLAN-026) — and PLAN-025's "no approval tool" rule is restated precisely for the world where `act` mode exists.

**Verification:** documentation only — no code changed, so there is nothing to run. Every claim was checked against the repository rather than asserted: the missing executor (searched all of `apps/api/src` for anything reading `AiAction` payloads or status), the route counts (enumerated with the route-guard script's own regex: 435 declarations, 185 GET, 250 writes; 233 after the 17 exclusions), the board and contact requirements in `routes/tickets/index.ts`, the internal-dispatch mechanism (`signToken` in `middleware/auth.ts`), and the notification rules in `services/ticketNotifications.ts`. BuildNotes 2026.10.8.024 prepended and regenerated into both fallbacks (237 versions).

---

## 2026.10.8.023 — PLAN-025: an MCP server for C7NTAX (plan only, nothing built)

A plan document, not a feature. Every MSP technician now works inside an AI client of their own — Claude Desktop, VS Code with Copilot, Cursor, ChatGPT — and those clients speak a protocol for calling tools on a remote system. C7NTAX already has the hard half of that: **ten app functions** an AI model can call, with reads running as the caller and every write raised as a **proposal a human approves**. This plan exposes that registry over MCP so the same questions can be asked from the tool the technician is already in.

- **[New]** **`PlanDocs/PLAN-025-C7NTAX-MCP-Server.md`** — §1 why (with the four questions a technician actually asks and the functions that answer them), §2 the evidence table of what already exists and where, §3 the surface (tools mapped one-to-one onto the registry, resources, three prompts), §4 the protocol, §5 authorization, §6 write semantics, §7 security, §8 where it lives, §9 the eight decisions to freeze, §10 five phases with acceptance criteria and a probe each, §11 costs, §12 verification, §13 what would make it wrong, §14 related work.
- **[Update]** **It takes over PLAN-011 phase 9 and answers PLAN-013 #7.** PLAN-011's header and the registry now record the split: the risk-classified action layer half **shipped** with the assistant (2026.10.8.020), and its MCP half is PLAN-025, which depends on that action layer and the API-key model rather than on PLAN-011's Bedrock/RAG phases — so nothing schedules the same server twice.
- **[New]** **Two findings worth having written down.** *First*, the current MCP revision (`2026-07-28`) is **stateless** — the `initialize` handshake is gone, `server/discover` is mandatory, Streamable HTTP is POST-only, and the clients our users actually have are a mix of eras, so dual-era support is a requirement rather than a nicety. The specification was rewritten twice in the twelve months to 2026-10-08 and Claude still follows an *older* authorization revision than the current one, so §4 is stamped as a snapshot to re-verify before phase 2. *Second*, **phase 3 is the expensive half**: hosted assistants want OAuth 2.1 with RFC 9728 metadata and resource indicators, and C7NTAX issues API keys rather than OAuth grants today. §5 therefore recommends keys-as-bearer-tokens for phases 1–2 (≈4 days, which works with the local and static-credential clients) and OAuth only when a hosted client is genuinely wanted (≈5 days, schedulable separately).
- **[New]** **The safety design is stated as a rule, not an intention:** reads execute, writes only ever become proposals, the risk tier is set server-side, and there is deliberately **no `approve` tool** — a model that can approve its own proposal has outsourced the review to the thing being reviewed. §7 names prompt injection through our own ticket bodies as the live risk it is, and reuses the existing egress policy for the OAuth and client-metadata fetches the specification tells servers to be careful with.
- **[Update]** **`PlanDocs/README.md`** — PLAN-025 added to the wave table's unscheduled rows and the registry, with the dependency note (phases 3+ want PLAN-016's public origin; phases 0–2 do not). PLAN-024 was missing from the registry and is now recorded as built (2026.10.8.016), and PLAN-023 as filed-not-built.

**Verification:** documentation only — no code changed, so there is nothing to run. The plan's factual claims were checked against the repository (`services/ai/tools.ts`, the permission intersection in `middleware/auth.ts`, `services/apiKeys.ts`, `routes/aiActions.ts`, `services/egress.ts`, `docs/API.md`) rather than asserted, and the protocol section is a dated snapshot of the specification's own pages with its uncertainties marked.

---

## 2026.10.8.022 — Walk me through it: the setup plans became steps you can follow

Every connection in CloudConnect now offers a wizard — **Walk me through it** on all sixteen connector cards and all eleven model-provider cards, **Finish with the wizard** in the Configuration pane, and a wizard button on every connected model. The OAuth app deploy wizard's lesson was that a connection is finished when it has been *proved*, and that the steps before it are where people get stuck; this applies the same shape to everything else.

- **[New]** **One connector wizard, no per-connector code.** It renders the setup plan the API already serves, so adding a connector adds a wizard: **What this is** (what it reads, whether it writes, what it will not do, what the first sync brings), **Prepare** (what has to exist in the vendor's product first, each with a link to the vendor's own page), **Credentials** (grouped by which screen they come from, in the order to collect them), **Settings** (only for connectors that have any), and **Test & finish**.
- **[New]** **One model wizard**, for the same reason and with the same ending: what the provider is and what it does with your prompts, the vendor's own steps for creating a key, the fields that key needs, the model and the app-functions permission, and then a real call.
- **[New]** **The last step proves it rather than saving it.** One button saves, calls the vendor, and reports what the vendor said — with field-level fixes where the API could attribute the failure to a credential, the vendor's own words where it could not, and a *Test again* that does not make you walk back through the form. Only after it answers does it offer to switch the connection on and run the first sync, and only then does it show what to check next.
- **[New]** **The model wizard's ending is the useful part of a model connection:** it lists the models the key can actually see and lets you pick one from that list, then offers *Use this model for the application* — which is deliberately withheld while the test is failing, so a connection that cannot answer is never made the one the application and the assistant answer with.
- **[Update]** **The shell is shared**: the OAuth app wizard's overlay, step rail, error banner, footer, `Choice`, `Row`, `Label` and `Hint` are now one component (`components/wizard/WizardShell.tsx`), so every wizard is the same thing rather than a lookalike.
- **[Fix]** **A wizard cannot make a connection unfinishable.** A credential the plan does not group — a newer field, or one only some deployments need — is still reachable under *Other fields this connector has*, which is the difference between a guided path and a trap.
- **[Fix]** **A refusal on the test step reads as a diagnosis**, not a red box: field errors say which value the vendor rejected and what to put there, and the general case names the three things it usually is (a key copied incompletely, an account with no credit, an address that has the chat path in it).
- **Verified live:** the catalogue offers 16 wizards and 16 plain-form shortcuts; the Microsoft 365 wizard was walked through its rail and prerequisites; the DeepSeek wizard was walked to its end — saved, tested against the real vendor, and the vendor's own `401 — Authentication Fails` rendered with both recovery buttons and the *Use this model* action correctly withheld. The row that drill created was removed afterwards. Web typecheck clean; help links and the OpenAPI guard unaffected.

---

## 2026.10.8.021 — Every connection can be walked through: setup plans for sixteen integrations and eleven models

The connector catalogue told you which fields to fill in and what each one meant, which is enough to fill a form and not enough to finish the job: every one of these integrations needs something to exist in the vendor's own product first — an API member, a registered application, a service principal with the right role, a token minted in the right screen — and the order matters, because a missing prerequisite arrives as a rejected credential rather than as a missing one. Each connector and each model provider now carries a **setup plan**: what it is for, what has to exist first, which credentials come from where, what the first sync brings, and what to check afterwards.

- **[New]** **Sixteen connector plans** covering what it takes to get each one running, in the order it has to happen: an Entra app registration with admin consent and the sign-in permission's licence requirement (Microsoft 365), the ConnectWise client-id request form that takes days and rejects every call until it exists, Halo's API application and its hosted-versus-on-premise token host, AutoTask's API user and the zone that fails like a wrong password, Kantata's short-lived token, the IT Glue rate limit that makes its first full sync a multi-run affair, Azure's service principal plus a role assignment, AWS's read-only starting policy, and an SSO plan that says plainly it is authentication and that the real test is a sign-in.
- **[New]** **Eleven model-provider plans**: where the key is created, whether the account needs credit before the key works (DeepSeek, OpenRouter), what a workspace or team scopes (Anthropic, xAI, Mistral), Google's move from API keys to authorization keys, Groq's per-model tool support and its `/openai/v1` path, Azure's four-part address, the local server that has to be reachable from the server rather than from your desk, and the generic endpoint where C7NTAX deliberately guesses nothing.
- **[New]** **The plans are data, not screens.** A plan names the credential keys it collects and the probe holds it to the form beside it, so a plan cannot describe a field the dialog does not have, ask for one twice, or omit a required one. The same plan will drive the wizard's steps, the "what do I need before I start?" answer, and the coverage probe.
- **[New]** **`apps/api/probe-connector-setup.mjs` — 388 checks**: every connector and every provider has a plan; every plan names fields that exist and no field twice; every required credential is collected; prerequisites, overviews, first-sync notes and follow-ups are sentences rather than labels; every link is a real https address; connectors with settings explain them; and — because a plan can be technically complete and still wrong — that the claims match the connectors: SSO says there is nothing to sync, QuickBooks names the refresh token rather than the access token, M365 says it never writes to the tenant, AWS starts you on a read-only policy, and the local-model plan warns about reaching a server on somebody's desk.
- **[Update]** The probe found three plans that were thin the first time it ran — Pax8 and Proofpoint had a single prerequisite each, and a Groq step was a fragment — which is the point of holding content to a standard instead of reading it.

---

## 2026.10.8.020 — The Assistant: a model that can look things up, under your permissions

A connected model could answer from what it was told and nothing else. Now it can *use* the application: ask it what is going on with a client and it finds the client, reads their tickets, checks the service picture and answers — and underneath the answer is the receipt: every function it called, what it was asked, whether it was allowed, and how long it took.

- **[New]** **Assistant** in the navigation (`/assistant`, `inference:view`): one prompt box, one answer, and a collapsible trace of the application's own functions that produced it. ⌘/Ctrl + Enter sends; the page says which model is answering and what it is permitted to do *before* the prompt, not after.
- **[New]** **Ten app functions**, and the split between them is the design. **Reads** run immediately, under the caller's own session and gated on the same permission as the equivalent screen — find and inspect clients, search and open tickets, service status, connection health, the knowledge base, assets. **Proposals** do not write: `propose_ticket_note` and `propose_ticket` raise the risk-classified `AiAction` the AI Actions screen already reviews, so nothing changes until a person approves it. A model that can create a ticket directly is a model that can create a hundred while somebody reads the answer.
- **[New]** **The permission is the session's, not the model's.** The functions offered are filtered by the caller's permissions, and each call is checked again when it happens — models do ask for functions they were never given, and a prompt can suggest one. A refusal says which permission was missing, and the model is told, so it says it could not look rather than inventing an answer.
- **[New]** **Three limits, all load-bearing.** A fixed ceiling of six rounds of function calls (the answer says when it stopped early); a failed or refused function is returned to the model *as text* rather than thrown, so a question never ends in a 500 because one lookup was not allowed; and a database error inside a function becomes a failed step the model can see, not a crash.
- **[New]** **`POST /api/inference/assist` and `GET /api/inference/tools`**, with `409` when no model is connected (naming where to connect one), `400` for an empty or oversized prompt, and `inference:view` as the gate because it is a read of the same data the screens read.
- **[New]** **Every prompt is audited** — `ai_assist`, with the prompt, the model, whether functions were permitted, which functions ran and how the run ended. The functions' *results* are not recorded: copying client data into a log table would be a second copy of it under weaker rules.
- **[New]** **`apps/api/probe-ai-assistant.mts` — 61 checks** with a scripted model against the real database: a function that does not exist and a function that exists but is not the caller's are refused differently; a caller with no permissions is offered nothing; the loop stops at its ceiling; a vendor that fails and a database that goes away are both reported and survived; switching app functions off offers the model nothing; and — the assertion that matters most — **a proposed note leaves the ticket with exactly as many notes as it had**, with the proposal pending for approval.
- **[New]** **`apps/api/probe-ai-assistant-api.mts` — 32 checks** over HTTP: the gates (anonymous, and a persona without `inference:view`), the refusals (empty, oversized, nothing connected), the vendor's own failure carried through as a 200 with a failed outcome rather than a 500 — and the audit entry, which the probe then removes so it leaves no facts in the trail that nobody asked for.
- **[Update]** **Docs**: `openapi.yaml` regenerated (426 operations), `docs/API.md` §10 gained the assistant and the function contract, and Help has a walkthrough for it (how it runs as you, why nothing is changed by asking, and how to read the receipt).

---

## 2026.10.8.019 — A model can be connected: eleven providers, in CloudConnect

The application could already use a model — ticket suggestions, knowledge-base drafts — but only if you had hand-built a provider row through an API that knew about five providers, two of which were hard-coded branches in the request builder. Now a model is a **connection**: CloudConnect → **AI models** offers Claude, GPT, Gemini, DeepSeek, Grok, Mistral, OpenRouter, Groq, Azure OpenAI, a local Ollama server, and any endpoint that speaks the OpenAI API, and connecting one is the whole setup.

- **[New]** **CloudConnect → AI models.** A tab of its own, because a model connection is not a data connector: nothing is read on a schedule, and the credentials are the entire configuration. Each provider's dialog asks only for what that vendor needs, says where the key comes from, links to that vendor's own API reference, and explains what the connection will and will not do with your data.
- **[New]** **One catalogue, shared.** The provider catalogue lives in `@C7NTAX/shared` and drives both sides: the fields the dialog asks for, the addresses, the authentication styles, the request and reply shapes. A field the dialog offers is a field the engine reads, and adding a vendor is a catalogue entry rather than a branch — which is what the old code got wrong, twice, for two vendors.
- **[Update]** **Three dialects instead of two.** OpenAI-style chat completions, Anthropic's Messages API (content blocks, `tool_use`/`tool_result`, a required version header) and Gemini's `generateContent` (model in the address, `contents`/`parts`, `functionCall`/`functionResponse`) — and all three now speak tool calling, which is the seam the assistant needs. Authentication follows the vendor: `Authorization: Bearer`, `x-api-key`, `api-key` or `x-goog-api-key`, with the connection able to override it for a gateway.
- **[Fix]** **The stored address is a base URL, and always was meant to be.** The seeded OpenAI connection held `https://api.openai.com/v1`, and the old code posted *to that address* — a call that fails at the vendor with nothing that names the cause. Addresses are now resolved as base + chat path, leaving an address alone when it already contains the path, tolerating a trailing slash, and filling in Azure's resource/deployment/api-version template.
- **[New]** **Test connection now asks the vendor, and remembers the answer.** It reads the model list (one GET, which proves the key and reports how many models it can see) and falls back to the smallest possible completion for providers that cannot be listed. Failures carry the vendor's own words — `401 — Incorrect API key provided`, not "something went wrong" — and the result is stored on the connection, so the screen and the assistant's errors do not have to repeat the call to know it.
- **[New]** **The model list is the vendor's, and says so.** `GET /inference/providers/{id}/models` returns `{ models, source, detail, shortlist }`: `provider` when the vendor answered, `cached` for the last answer, and `shortlist`/`unavailable` when it could not be asked. The names this build knows are labelled as suggestions rather than presented as fact — model names age faster than anything else in this catalogue.
- **[New]** **Use this model for the application**, one power button: it sets *active* and *default* together, because a connection that can be tested and never called is a state nobody asks for, and it refuses a connection that has no key. `GET /inference/status` is what screens read to say which model is in use.
- **[New]** **`May perform app functions`, per connection and off by default.** The permission that lets a model call this application's own functions when you ask it something — read functions run as the person asking, and anything that would change data is proposed for approval rather than done.
- **[New]** **`apps/api/probe-ai-providers.mts` — 143 checks**, with every vendor stubbed: that each provider's key travels in the header its documentation names, that addresses are assembled the way each vendor documents them (including the ones that are easy to get wrong — Groq's `/openai/v1`, Gemini's model-in-the-path, Azure's three parts, a base that must not be doubled), that the three request dialects and their tool-call shapes are right, that replies from all three are read into one shape, and that a refused key, a missing address, a missing model and a loopback endpoint are each refused with a reason instead of a stack trace.
- **[New]** **`apps/api/probe-ai-providers-api.mjs` — 55 checks** over HTTP: the catalogue carries what the dialog renders, an unknown provider is a 400 that names the real ones, an address the egress policy refuses is not stored, a connection with no key cannot be made the application's model, a test stores what the vendor said, only one model is ever the default, and the whole surface is gated on `inference:view`/`inference:manage`. Its run against a deliberately invalid key came back with DeepSeek's own `401 — Authentication Fails`, which is the endpoint confirming itself.
- **[Update]** **Docs**: `openapi.yaml` regenerated (424 operations) and `docs/API.md` gained **§10 Models — connecting one, and what it may do**, with the later sections renumbered and their cross-references updated. The CloudConnect walkthrough in Help describes the five tabs and the new one.

---

## 2026.10.8.018 — Test connection looks like a test, not a signal

The button that tests a connection was drawn with a Wi-Fi glyph, on every surface it appears. A Wi-Fi arc is the universal picture of *you are connected*: on a quiet grey button it reads as a status light, so an action looked like an indicator. That is the wrong way round — somebody glancing at a card would see a signal and assume the connection was healthy without ever reading the health chip beside it, which is the only thing that actually knows.

- **[Fix]** **The action no longer claims an outcome.** The card's test button used to change glyph with the state — tick for passed, warning for failed, Wi-Fi for untested — so one button meant three things, two of which duplicated the status chip next to it (and a green tick on the button then competed with the green tick that means *Enabled* in the same row). It is now one glyph in every state: **`PlugZap`**, a plug meeting a bolt, which says "exercise this connection now" and nothing more.
- **[Update]** **The same glyph everywhere it is offered**, so "test this connection" looks identical wherever you meet it: the Connected card's action row, the Configuration pane's **Test connection** button (which previously had no icon at all), and the per-field **Test** buttons inside the Fix Connection Errors dialog.
- **[Fix]** **Email connectors gets it too.** The mailbox panel's icon-only test button carried a refresh arrow, which is what its **Poll now** neighbour means. It now uses the same plug glyph, so the icon-only row reads: start/stop, test, poll, delete.
- **[Update]** **Result reporting is unchanged and still explicit** — the tooltip reads *Test connection*, *Test connection — last test passed* or *Test connection — last test failed*, the button tints with the outcome, and the health chip stays the single place that states whether the connector is healthy. Colour and text carry the result; the picture carries the action.
- **[Update]** **Help** — the CloudConnect walkthrough's "Test & fix inline" section states the convention in one line: the button is the action, the chip is the status.
- **[Fix]** **Verification:** live browser check on all four surfaces — Connected card row, Configuration pane, fix dialog (reached from a genuinely failing AutoTask connection, its per-field `Test` button showing `plug-zap`), and the Email connectors rows (both `plug-zap`, matched by `title="Test connection"`); a failed test left the glyph unchanged while the tint went red and the tooltip changed to "last test failed"; **zero `lucide-wifi` icons remain on the CloudConnect screen**; web typecheck clean.

---

## 2026.10.8.017 — The Microsoft 365 accounts card moved, and became a report you can run per client

The inactive-accounts card sat on **CloudConnect → Connected**, the screen whose job is "what is connected, and is it healthy". It is not health: it is an action on the accounts of one tenant, and the question it was answering — whose seats are idle — is a reporting question about every client at once. It now lives where each half belongs: **the tenant's accounts with the tenant**, and **the report in Reporting**.

- **[New]** **Inactive Microsoft 365 Accounts is a standard report** (Reporting → Standard Reports), with the filters the question actually has:
  - **Inactive after** — your own threshold (1–730 days, default 90) instead of a fixed 90-day band.
  - **Client** — every client at once, or one client for a review with them.
  - **Tenant** — one connected tenant, or all of them.
  - **Disabled accounts** — include or exclude the ones already switched off, so the list can be "what still needs a decision" rather than "the whole estate".
  - **Unknown sign-in** — include or exclude accounts with no sign-in activity recorded.
- **[New]** **Sections a manager can read**: headline counts, a "what this covers" block (scope, tenants read, accounts synced, mapped and unmapped), a **by-client** table with the longest and average silence per client, a **by-tenant** table, and the account list itself — worst first, with last sign-in, state and job title. Print, PDF, Excel and CSV all apply the same options, and the export dialog lets them be changed at the moment of export.
- **[Fix]** **An account with no sign-in activity is never counted as dormant.** Reading sign-in needs Entra ID P1 and `AuditLog.Read.All`; without them the report says so in plain words, lists those accounts as **unknown** in their own column, and can exclude them entirely — a report that funds a licence cleanup by treating "we do not know" as "nobody signs in" is a report that gets live accounts disabled.
- **[Update]** **The panel moved to CloudConnect → Configuration**, on the Microsoft 365 connection it belongs to: the age bands, the accounts, their last sign-in and the **Offboard** action, with a link to the cross-client report. The Connected tab now only shows what is connected and whether it is healthy.
- **[New]** **Report-specific options, generally.** The report framework's filter bar can now render a report's own controls (number, boolean and tenant select), and they travel with the filters into the run, the print and the export — so this report is not a special case, and the next one that has questions of its own has somewhere to put them.
- **[New]** **`?report=<id>` opens a report directly** (and carries `clientId` with it), which is how the connection panel links to its report and how a saved link opens the exact report somebody meant.
- **[New]** **`/api/reports/data/m365-inactive-accounts`** documents its own options in the payload (`optionsLabel`, `period`, `coverage`, `notes`) so a screen can never imply a threshold it did not use. Requires **`report:view` and `integration:view`** — it names individual accounts across tenants — and the generated spec, `docs/API.md` and a curated operation summary were updated with it.
- **[New]** **`apps/api/probe-m365-inactivity-report.mjs` — 29 checks**: the options change the answer and are clamped (0 → 1 day, 9999 → 730), the totals agree with the rows and with every by-client column, every account is in exactly one state, no account is ever called inactive without a sign-in date, the client and tenant filters really scope, and the endpoint refuses an anonymous read and a persona without `integration:view`.
- **[Update]** **Help** — the M365 walkthrough describes the report, its options and where the accounts panel now is; the reporting walkthrough names the tenth report and explains report-specific options; the CloudConnect walkthrough mentions the account panel.

---

## 2026.10.8.016 — Boards are tabs on the Tickets screen, with the board in view named underneath

Choosing a board meant opening a dropdown. A dropdown shows nothing until it is opened: not how many boards exist, not what else is available, and not where you are without reading a small grey word. On a screen whose whole job is "the tickets for a board", the board was the least visible control on the page. It is now a tab strip with a **band naming the board on screen**.

- **[New]** **Board tabs** below the search box and above the list — one tab per board with its ticket count, plus **All Boards** — using the same tab component as the customer portal and configuration screens, so it is the tab style the product already has: a bordered group, the chosen tab on the primary fill, counts as pills, arrow-key navigation, and a proper `tablist` role for assistive technology. The strip scrolls sideways rather than squashing when a workspace has more boards than fit.
- **[New]** **The notation band** underneath says what you are looking at: "Viewing **MSP Service Desk** · MSP · General IT support · 34 tickets on this board", or "Viewing **All boards** — 113 tickets across 4 boards". The count is exact because every ticket belongs to a board (`Ticket.boardId` is required), so All Boards is the sum of the tabs rather than an estimate.
- **[New]** **The tab counts come from data the API already returned** (`_count.tickets` on `GET /boards`) — no endpoint, schema or migration change.
- **[Update]** **The board is still the URL.** Selecting a tab sets `?boardId=…` exactly as the dropdown did, so deep links select the right tab, a reload keeps you there, and every existing link into a board keeps working. The tab strip reads its selection from the URL rather than holding its own state.
- **[Update]** **Two things stopped being said twice**: the page subtitle no longer reads "Filtered by board" (the band says it properly), and the board no longer appears as a chip in the active-filters row, which is now only about filters.
- **[Update]** **`Tabs` no longer lets a tab label wrap** — a two-line tab made the strip taller than the content beside it at narrow widths. Labels stay on one line and the strip scrolls instead.
- **[Update]** **Help** — Getting Started describes the board tabs and the band; the Tickets entry in the navigation table names them.
- **[New]** **Built to be undone in one line.** `BOARD_TABS` in `apps/web/src/pages/Tickets.tsx` chooses between the tabs and the dropdown; setting it to `false` restores the previous screen exactly, with the dropdown markup still in the other branch. `PlanDocs/PLAN-024-Tickets-Board-Tabs.md` records the design, the measurements and both costs (when taken, and to revert), and the switch was flipped off and back on to prove the revert works.

---

## 2026.10.8.015 — Recently Resolved says when an incident started, and links to the advisory behind it

The Recently Resolved card on Service Alerts listed what had cleared and when it resolved, and stopped there. It now shows when each incident was **first reported** too, and every incident title links to the advisory — the vendor's own page explaining what the outage was.

- **[New]** **A first-reported column**, next to the resolved time, with the exact local timestamp on hover. "Resolved 14h ago" says when it ended; how long it lasted is the other half of the question, and it was not on the page.
- **[New]** **Each incident title is a link** to the page that explains it — the vendor's advisory for that incident (Statuspage/RSS source URL), falling back to the service's status page when an alert has no link of its own, in which case the hover says "status page" rather than "advisory", because they are not the same thing. Links open in a new tab.
- **[Update]** **The card is a small table now** — Incident, First reported, Resolved — with the heading row hidden on narrow screens and the time columns tightened, so the columns line up instead of being ragged right-aligned text.
- **[Update]** **The hover on a title carries the whole title and the destination**, because the row clips the title to one line: *"DeepSeek 网页/API 性能下降 … — open the advisory on status.deepseek.com"*. That is the same convention as the rest of the app after 2026.10.8.014 — a clipped name is what a tooltip is for.
- **[Update]** **Help** — the Service Alerts walkthrough describes the card, its two timestamps and the advisory link.

---

## 2026.10.8.014 — Hover tooltips name the thing, not the icon

Every control in the app explains itself on hover through one delegated tooltip. It resolved a label by looking at the control's **icon first** and its own words second, so a navigation link reading "Single Sign-On" was announced as **"Keyround"** — the name of the glyph. Where there was no text at all it invented one from the icon's name, which is how table checkboxes came to be labelled "Checkbox" and calendar chevrons "Chevronleft".

- **[Fix]** **The control's own words now come first**, before any icon. A link that says *Single Sign-On* is labelled *Single Sign-On*, whether the sidebar is expanded or collapsed into its icon rail. This was the reported case, and it was the same ordering mistake on every labelled control in the product.
- **[Fix]** **An icon is never allowed to answer for itself when its picture says nothing useful.** A key, a shield, a gear, a chevron, a tick box and a play triangle mean different things in different places — a key is Single Sign-On in the navigation, a password collection in Kumo and a licence in the product catalogue — so those icons no longer speak: the tooltip comes from the feature the control belongs to (its surrounding heading, section or labelled wrapper), and if even that is unknown, **no tooltip appears rather than a wrong one**.
- **[Fix]** **A tick box is no longer announced as "Checkbox".** It takes its wording from the label it sits in or with, and an unlabelled one stays silent.
- **[Update]** **The action table was rewritten and audited against every icon the app ships** (206 of them). Vague entries are gone — "Quick" for a lightning bolt, "Power", "Badge", "More options" for a chevron, "Actions" for a wrench, "Trending" — and the genuinely single-meaning ones are now action words: **Add** rather than "Plus", **Edit**, **Delete**, **Copy**, **Download**, **Refresh**, **Show**, **Hide**, **Sign out**, **Open in a new tab**. A glyph name that describes the drawing rather than the control ("Chevrons down up", "Columns 3") is refused.
- **[New]** **Controls that could not be inferred now name themselves**: the calendar's month arrows (*Previous month* / *Next month*, and the month button is *Go to this month*), a ticket row's selector (*Select ticket INF-1901*, *Select all tickets*), the sidebar's collapse/expand button and both mobile menu buttons.
- **[Fix]** **A paragraph is not a tooltip.** A control whose own words run past a short name is silent, unless the page has cut that text off with an ellipsis — in which case the full text is revealed, which is what a tooltip is for. Previously the eight configuration cards each offered a 166-character description on hover.
- **[New]** **`scripts/audit-tooltips.mjs`** — the audit that found this, kept so it can be repeated. It reads the tooltip tables out of the component (so it cannot drift from them), takes a dump of every icon-only control the running app renders, and prints what each one would be labelled: **554 controls across 20 routes**, now with no control labelled by an icon's own name.
- **[Update]** **Help** — Getting Started gained a "What hovering tells you" section describing the convention, so the behaviour is documented rather than folklore.

---

## 2026.10.8.013 — The connectors were audited against the vendors' own APIs, and CloudConnect now shows what is connected

Fifteen connectors were checked against their vendors' published documentation. Six could never have worked, several would have connected and then quietly returned nothing, and the ones that did work asked for credentials the vendor does not use. The findings are fixed, the form now describes every field it asks for, and anything read from a connector says so.

- **[Break]** **Six connectors could not have worked at all, and now can.** *Azure* stored a pasted access token — ARM tokens last about an hour and the client-credentials grant issues no refresh token, so it works exactly once; it now takes tenant, client id and secret and mints its own token. *AWS* sent an `Authorization` header with no signature in it, which AWS rejects by design; there is now a real **SigV4** implementation (`packages/integrations/src/sigv4.ts`) that signs every request, and the connectivity test is `sts:GetCallerIdentity`, which needs no permissions — 403 was previously treated as success, so a broken signature reported a healthy connection. *Scoro* called `/api/v2/getContactList`, put the API key in the query string and never sent the company account id; it now posts to the documented module route `/api/v2/{module}/list` with the key, account, paging and language in the JSON body. *Kantata* used the wrong host (`api.kantata.com`), omitted the `.json` every path needs, and expected a flat array where the API answers with `{key,id}` references into per-type maps. *Harmony Email (Avanan)* sent an API key to `/api/v1/…`; it now signs the application id and secret at `POST /v1.0/auth` for a JWT, sends that as `x-av-token`, unwraps `responseEnvelope`/`responseData`, follows `scrollId` and uses the region-specific host. *AutoTask* had no zone in the host (`webservices{N}.autotask.net` is mandatory), asked for an `Accounts` entity that does not exist (`Companies`), and re-posted page one forever instead of following `pageDetails.nextPageUrl` — and it now resolves the zone from the documented `zoneInformation` call so the number does not have to be known.
- **[Fix]** **Connectors that would have connected and then returned nothing.** *Pax8* now mints a token at `/v1/token` with `audience` in a JSON body and reads companies at `/v1/companies` (`/v1/identity` and `/v1/customers` are not endpoints). *QuickBooks* exchanges its **refresh token** at the Intuit OAuth host with Basic client-id:secret, because an access token lasts one hour and a connection holding only one works once. *IT Glue* stops sending the unsupported `include=organization` (a 400 on every call), pages with `page[size]`/`page[number]`, and reads documents through `/organizations/{id}/relationships/documents` since there is no top-level document list. *SentinelOne* takes the tenant's own console URL instead of a shared `usea1` host, authenticates with `ApiToken`, pages by `pagination.nextCursor`, and validates against `/system/info`. *Proofpoint* uses HTTP Basic rather than headers the SIEM API does not read, reads each endpoint's **named** array (`messagesBlocked`, `messagesDelivered`, `clicksPermitted`, `clicksBlocked`, `issues`), and takes multi-day history in hourly slices because `sinceSeconds` is capped at 3600. *Microsoft 365* no longer sends `$top` to `/subscribedSkus` (which rejects it), caps `signInActivity` reads at `$top=500`, and has dropped a refresh-token grant that the client-credentials flow cannot use. *HaloPSA* sends the `scope` its token request requires, authenticates hosted tenants at `auth.<domain>/token?tenant=…` (falling back to the tenant's own `/auth/token`), pages with `pageinate`/`page_size`/`page_no`, and no longer reads `/software`, which is not a resource.
- **[Update]** **Every connector now describes itself.** `GET /api/cloudconnect/types` serves a catalogue (`CONNECTOR_CATALOGUE` in `apps/api/src/routes/cloudconnect.ts`) in which all 16 kinds carry labelled credential fields with a hint saying where the value comes from in the vendor's own product, the options that connector actually honours with a hint for each, a guidance note about what tends to go wrong, and a link to the vendor's API documentation. Required credentials are derived from the catalogue rather than kept in a second list beside it — the two had drifted, which is how the form came to ask for an API key where the vendor wanted an application id and secret.
- **[Update]** **Options that did nothing have been removed, and options that were missing have been added.** Microsoft 365's advertised "sync interval" was read by nothing in the product, so it is gone and the guidance says syncing happens when you press Sync; its user, group and licence switches now gate real reads, and a **groups** switch was added. ConnectWise honours a page size, and each connector gained the paging and lookback settings its adapter reads, from AutoTask's `MaxRecords` to SentinelOne's history window.
- **[Fix]** **Synced records were being duplicated on every sync.** Any record without an `id` was stored under a freshly invented random one, so each sync inserted the whole set again as new rows. Identity is now the vendor's id where there is one, and a hash of the payload where there is not — stable across syncs — and the sync response reports how many records needed a derived id.
- **[New]** **Connector data says where it came from.** A source note (`DataSourceNote`) names the system on a connection's heading, on any panel showing data an integration brought in, and under a connection's records list: "Data from FlexPoint Payment Solutions · every record here was read from the vendor, not entered in C7NTAX". A FlexPoint invoice and a C7NTAX-native invoice look alike otherwise, and who owns a number is the first question anybody asks.
- **[Update]** **CloudConnect is split four ways** — **Connected** (what is configured, whether it is healthy, and where its data comes from), **Add a connector** (the catalogue), **Configuration** (pick a connection, then edit its credentials, options, sync history and the records it brought in) and **Email connectors**. It previously opened on a grid of every connector type, healthy or not, and the per-connection work was behind dialogs.
- **[Update]** **The FlexPoint connector is now FlexPoint Payment Solutions** everywhere it is named — the navigation, the connector type, the API-access labels and the page heading.
- **[New]** **Two verification harnesses.** `apps/api/probe-connector-catalogue.mjs` (47 checks) holds the catalogue to the vendors' authentication and to what the adapters actually read — a setting nothing reads fails the probe. `apps/api/probe-connector-adapters.mts` (91 checks) runs all fourteen adapters against a stub of each vendor and asserts the request that would have been sent: the host, the scheme, the paging, the headers and the unwrapping.

---

## 2026.10.8.012 — The Microsoft 365 OAuth app is deployed from the connector

Setting up the Microsoft 365 email connector meant leaving the product: run `O365/New-C7NTAXMailboxApp.ps1`, sign in with a device code at a Microsoft URL, then copy four values — one of which cannot be read a second time — into a form. **Deploy OAuth app** in the connector does the same work in place and fills the form with what comes back.

- **[New]** **The wizard** (`Deploy OAuth app`, beside the Microsoft 365 connector's App-only and delegated modes): six steps — how, which tenant, sign in, create & consent, scope the mailbox, finish — with the step rail showing where you are and what is left. It ends by writing the tenant id, client id, client secret and mailbox straight into the connector's fields, and it scrolls them into view, because a filled form nobody sees reads as nothing having happened.
- **[New]** **Two ways through, because the tenant decides which is possible.** *Deploy it from here* uses the OAuth device-code flow against Microsoft's public Graph command-line client: the administrator approves a code in their own browser, so this application never holds a credential for the tenant, and the token that comes back is used for this one task. *Run the script, or use an app you already have* shows the exact `New-C7NTAXMailboxApp.ps1` command for the tenant and mailbox chosen and takes its `out/c7ntax-m365-app.json` — for a registration that already exists, or a tenant this instance cannot reach Microsoft from.
- **[New]** **The deployment itself** (`POST /api/oauth-app/start`, `…/{id}/poll`, `…/{id}/deploy`): find or create the application by display name, record `requiredResourceAccess` with the **application** role id of `Mail.ReadWrite`, create the service principal consent is granted *to*, grant admin consent with all three ids (principal, resource, AppRole), and mint a 12-month client secret — or none at all for the delegated flow, which is a public client using PKCE. It registers this instance's own redirect URI on a delegated deployment, and returns the **Exchange Online** commands that scope an app-only registration to one mailbox, because Graph has no route to those and an unscoped app-only app can read every mailbox in the tenant.
- **[New]** **Idempotent by registration name**, exactly as the script is: a second run reuses `C7NTAX Email Connector`, consents again (an "already granted" answer is not a failure) and mints a further secret rather than duplicating the application.
- **[New]** **`POST /api/oauth-app/import`** — the script's JSON, or the four values typed by hand. It refuses a client id that is not a GUID, and it refuses a registration granted **`Mail.Read`** instead of `Mail.ReadWrite`: a read-only app connects, reads the mailbox and then fails on the first message it tries to mark, so the wizard says so instead of saving a connector that will fail on its first email.
- **[Fix]** **A client secret could reach the audit log.** The generic audit middleware records request bodies and redacts them by *key name*, and `POST /api/oauth-app/import` carries the secret inside a JSON **string** that check cannot see — so the whole credential set was stored in clear text. The wizard's routes are now skipped by the generic middleware and audited by the route instead (tenant, client id, secret **expiry**, never the value), and `scriptJson` is treated as a sensitive key in the generic path as well.
- **[Fix]** **"Start sign-in" appeared to do nothing.** It advanced one step from *Tenant* instead of jumping to the *Sign in* screen, so the code was never shown — found by driving the wizard in a browser rather than reading the code. Steps are addressed by name now, so a path that adds or drops a step cannot reintroduce it.
- **[Fix]** **The mailbox was dropped on the way into an import.** The wizard's own mailbox field was not sent with a pasted file, so it warned about a mailbox it had already been given.
- **[Update]** **Help caught up with the connector**: the Microsoft 365 walkthrough said the app needs `Mail.Read` — it needs `Mail.ReadWrite` — and now covers the app-only requirement, the wizard, the Exchange Online scoping and the delegated flow, with a configuration reference and four FAQ entries (setting it up, why not `Mail.Read`, consent taking 30–60 minutes, and using the script instead).
- **[Update]** `O365/README.md` and `docs/API.md` describe both routes to the same result, and the six new operations carry curated summaries so the generated specification explains them (`418 operations`, `58 curated`).

Verified in `apps/api/probe-oauth-app.mjs` — **71 checks** against a stub Microsoft that records every call: the device-code sign-in and its claims, the application **role** id of Mail.ReadWrite (`e2a3a72e-…`, not the delegated scope `024d486e-…`), the three-id consent, the service principal consent points at, the secret's twelve-month lifetime, the delegated path's redirect URI and PKCE-with-no-secret, reuse on a second run, every refusal (unknown tenant, declined sign-in, deploying before signing in, `Mail.Read`, a non-GUID client id, a paste that is not JSON) and the audit trail — including that no secret value reaches it. Then the wizard itself was driven in a browser through **both** paths against the same stub, ending with the connector's four fields filled from each.

---

## 2026.10.8.011 — The API is documented, and something other than a person can use it

The API served 412 operations and its specification described 25 of them. There was also no way to give an RMM, a SIEM or a script a credential of its own — a session token was the only key, and it belongs to a person. Both are fixed: the document is now generated from the routes, machine access exists, and there is a guide for whoever is connecting something.

- **[New]** **The specification is generated, not written.** `scripts/generate-openapi.mjs` reads every `<router>.<method>("path", requirePermission(…))` under `apps/api/src/routes/**`, joins it with the mount points in `index.ts` and the permission names in the shared enum, and writes `docs/openapi.yaml` — now **412 operations across 307 paths and 44 tags**, each carrying its required permissions as `x-required-permissions` and its source file as `x-source`. The prose a parser cannot invent (a summary, an example, a note about behaviour) lives in `docs/api-operations.json`, 52 entries keyed by `METHOD /path`.
- **[New]** **API keys — a credential for a program.** `ApiKey` with a prefix and a sha256 hash (the secret is never stored, and shown once), scopes, owner, expiry, revocation, usage counters and an audit row for every issuance, rotation and revocation. A key *acts as the account it belongs to*, narrowed to its scopes, and the account's permissions are re-read on every request, so removing a permission removes it from every key that account owns without touching the keys. Managed on **Administration → API access** (`/admin/api`) or through `GET/POST /api/api-keys`, `POST /api/api-keys/{id}/rotate`, `DELETE /api/api-keys/{id}`.
- **[New]** **The event gateway** — one endpoint for anything that reports incidents (`POST /api/events`, plus `GET /api/events` and `GET /api/events/sources`). Idempotent by `(source, externalId)`: the first event opens a ticket, a repeat attaches to it as an internal note with an occurrence count, `kind: "recovery"` resolves it, and the whole payload is kept on the ticket because the reason a ticket exists is usually in the part nobody mapped. Severity becomes priority; the client is resolved by id or by a name exactly one client carries; the board comes from `boardId`, then the intake board, then the oldest board — and an event that names no client is refused rather than guessed at.
- **[New]** **`docs/API.md`** — the guide: the two credentials with a worked key example, errors, rate limits (with the `X-RateLimit-*` headers and the 429 body), paging and filtering conventions, the event-gateway recipe with a field table and copy-ready examples for an RMM and a SIEM, the connectors and the accounting push, outbound webhooks with signature verification in JavaScript and Python, and how to enumerate the rest.
- **[New]** **Administration → API access** — the base URL and the two calls a connection needs, the event intake board, and the key inventory: presets for an RMM, a SIEM and an accounting integration, the full permission catalogue filtered by resource, the secret shown once with a ready-to-run `curl` beside it, and rotate/revoke inline.
- **[Fix]** **The document described routes that answer nothing.** The generator attributed every route in a file to the first router it found, so `users.ts`'s second, unmounted `rolesRouter` was documented under `/api/roles` — six routes that do not exist — while the five that do were reported as duplicates of them. Routes are now attributed by the file a router is *imported from*, an unmounted router is named in the output instead of being documented, and the tickets surface (`routes/tickets/**`), which was missing from the document entirely, is in it.
- **[Fix]** **A key's scopes were widened on its first request.** `refreshSessionContext` replaced the scopes with the owner's full permission set, so a key issued for `ticket:create` and `ticket:view` would have gained everything its owner holds. It now intersects with the key's scopes on every request.
- **[Update]** **Help gained an "API Access & the Event Gateway" walkthrough**, with index rows, a configuration reference for API access, and four FAQ entries (repeat alerts, an SIEM creating tickets, using the API from a script, and a leaked key) — the surface had none.
- **[Update]** **The rule is enforced.** `node scripts/check-api-docs.mjs` (`pnpm guard:api-docs`) fails when the document is behind the routes, when it documents an operation that no longer exists, or when a curated entry names a route that has been renamed — and it names the routes that moved rather than only that something did. The standing rule is in `.github/copilot-instructions.md` beside the Help rule.

Verified in `apps/api/probe-api-access.mjs`, **34 checks**, all passing: a key issued exactly as the page issues one can read tickets and is refused users; the intake board the page saves is where an event lands; the first event opens a ticket, the second merges into it with `occurrences: 2` and appears in the thread, the payload is kept, the recovery resolves it, and an event naming no client is refused; usage is counted against the key the table shows; rotating changes the secret and kills the old one; revoking stops it and keeps the reason. The page itself was driven in a browser: issue → copy → rotate → revoke → include-revoked, with the key's own calls returning 200/403/401 as they should. `docs/openapi.yaml` was validated independently with PyYAML, the guard is green, and both workspaces typecheck.

---

## 2026.10.8.010 — FlexPoint is used, not just read

The connector could read FlexPoint; nothing in the application did anything with what it read. It does now: a client's receivable comes from FlexPoint, and an invoice can be issued through it — with a page in C7NC to configure all of it.

- **[New]** **C7NC → FlexPoint** — a configuration section for the connector. It shows where the connection points and how it is doing, every figure that matters (linked clients, open balance, overdue, received, deposits), the options below, the clients table, and the invoices list.
- **[New]** **Ten options, each of which changes what happens** — what to pull (customers, invoices, deposits, page size), how a FlexPoint customer becomes a client (by external reference, by a unique exact name, or both), whether to create clients for unmatched customers, whether to write the client id back into FlexPoint, whether to record settled payments against pushed invoices, and whether invoices may be pushed at all. **Everything that writes to FlexPoint or to the ledger is off until it is switched on**, and the page says so.
- **[New]** **A client's receivable, from FlexPoint** — customers are matched to clients on every sync, by the reference written into FlexPoint first and then by a name only one client carries (a name that matches two clients is left alone rather than guessed at). The clients table shows each linked client's open balance and overdue amount; the client's own record shows the same, read-only, on its Invoices tab.
- **[New]** **Invoices can be issued through FlexPoint** — an invoice is created with its customer, its lines, its due date and this application's invoice id as the external reference, at the status you choose (`Draft` by default, because nothing should be issued to a customer by accident). Pressing Push again updates the same FlexPoint invoice rather than creating a second one. A client with no FlexPoint customer gets one, created from its name and billing email; a client with no email is refused with that reason, because FlexPoint requires one.
- **[New]** **The payment comes back** — with that switch on, a FlexPoint invoice that has been settled is recorded against the local invoice it was pushed as: a payment (method `flexpoint`, reference `flexpoint:<invoiceId>`) and a status of **paid**, or **partial** when only part has been received. Recorded once — the reference is what stops a second sync adding it twice.
- **[New]** **Approving a bill-through batch uses it too.** When the accounting connection is FlexPoint and pushing is allowed, the batch push creates the invoice through the merchant API instead of posting to a configured URL. With pushing off, the batch is still issued and says why the push did not happen.
- **[Fix]** **The generic sync persistence invented an id for records that do not carry one called `id`.** FlexPoint's are `customerId`, `invoiceId` and `payoutId`, so every sync stored a fresh duplicate row with a random key. The adapter now normalises each record's `id` and `displayName`, which is also what the linking and payment work above depends on.
- **[Update]** **Two columns on Invoice** — `flexpointInvoiceId` and `flexpointPushedAt`, with a migration. The id is what makes the push idempotent and what lets a settled payment find its invoice.
- **[Update]** **Help has a FlexPoint walkthrough** — connecting it, running a sync, linking customers, pushing an invoice and taking the payment back — listed in the Index with the other integrations.

Verified in two harnesses. The service, **32 checks** end to end against a stub merchant API: options saved and bad values refused (a page size past FlexPoint's 200, a status FlexPoint does not have), a sync that pulls and stores, links by name and writes the client id back with the name FlexPoint requires on an update, links by reference on the next run, lists the unmatched customer, pushes an invoice with the right customer, status from the options, the local id as its reference and `partNum` on every line, records the settled payment once and not twice, reports the client's receivable and its payments, unlinks again, and refuses to write at all when pushing is switched off. The page, **28 checks** in a browser: the nav entry, the connection card, the five figures, the grouped options with their explanations, an unsaved change that saves and reaches the API, a sync that links the matching customer while leaving the unmatched one waiting, linking that customer from the page with the reference written back, pushing disabled while the option is off and enabled when it is on, a pushed invoice reported on its row, the client record's own receivable card, and the API gating writes on the manage permission while the page is offered to exactly the roles CloudConnect is.

---

## 2026.10.8.009 — Add Connection works, and FlexPoint is a real connector

Two things were wrong with CloudConnect. The button that starts a new connection appeared to do nothing, and FlexPoint — one of the sixteen connectors — was configured against an API that does not exist.

- **[Fix]** **Add Connection now visibly opens.** The flow was rendering *after* the email-connectors panel, which is a full form: the type grid opened 104 px below the fold, so the only thing that changed on screen was the button disappearing. The flow now takes the page over — the grid, or the configuration form once a type is chosen, is the first thing under the header, the page scrolls to it, and the email connectors and the connection list step aside until it is finished or cancelled.
- **[Update]** **The connector count in the header is counted, not typed** — it said "16 connectors available" whatever the server actually offered, and now reports the list the API returned.
- **[New]** **A connector can describe its own configuration dialog.** Credentials and settings carry their own labels, one line saying where the value comes from, and the connector may add a paragraph of guidance plus a link to the vendor's own API reference. Sixteen connectors that say nothing beyond a field name still render exactly as they did.
- **[New]** **FlexPoint is now a real connector, built from FlexPoint's own API document.** They publish an OpenAPI 3.1.1 spec ("FlexPoint API" v1.0) at `apps.getflexpoint.com/core-api/swagger/v1/swagger.json`, and the adapter now follows it: one **merchant API secret** exchanged at `/api/v1/auth/login-merchant` for a short-lived bearer token (refreshed on a 401), then Customers, Invoices and Deposits under `/api/merchant/v1`, read with `offset` + `page_size` paging and stopped by the `record-count` header. The dialog asks for the merchant secret and the base URL, explains that one connection reads one merchant, offers only the three resource switches the adapter honours, and links the vendor's API reference. A failure says which resource and why — "the merchant API secret was rejected" rather than "connection failed".
- **[New]** **The dialog is honest about what FlexPoint cannot do**: their API has no webhooks, no product catalogue and no subscription resource, so nothing is offered for them, and there is no fake "sync interval" — nothing schedules a per-connection sync, so a setting that did nothing is not presented as if it worked.
- **[Fix]** **Two documents claimed FlexPoint uses an `x-api-key` header.** It does not; the merchant secret is exchanged for a bearer token. Corrected in `docs/SESSION_AUTH_PLAN.md` and `PlanDocs/PLAN-001-Session-Auth.md`, and the required-credential list the health check uses was updated with them.

Verified in four places. The adapter, against a stubbed network, **21 checks**: the sign-in route and body, one sign-in covering every request of a sync, bearer tokens on every resource call, offset paging, `record-count` ending an exact page boundary, a short page ending the walk, a 401 signing in again and retrying once, one failing resource not hiding the others, an empty secret refused before any request, settings honoured, and a custom base URL trimmed. The API, **20 checks** end to end: the connector's published fields and guidance, a connection created from the dialog's payload, a test and a sync that both report the refusal honestly and are logged, and the verification connection removed again. The dialog, in a browser, **17 checks**: the guidance, the masked and marked-required secret, the base URL placeholder, seven explanations, the API-reference link opening in a new tab, the three sync switches on by default, `page_size` at 50, creating a connection from the dialog with its confirmation toast, and a connector without any of this metadata still rendering as before. The Add Connection fix, **9 checks**: the list view on load, the grid opening on screen at the top of the page, the scroll, the panel stepping aside, and Cancel restoring the list.

---

## 2026.10.8.008 — The tab strips look like something you press

The tabs added yesterday were the size of a caption: small grey labels, a faint tint on the chosen one. At a glance they read as headings rather than as a control, so the screen's own navigation was easy to miss.

- **[Update]** **The tab strips are bigger and unmistakable.** The chosen tab now sits on the accent's solid fill with the scheme's own label colour — the same fill as a primary button, so it cannot be mistaken for text and stays legible on every colour scheme and on both themes. The strip itself is a bordered group, the labels are `text-sm` (14px) instead of 12px, and every tab is a 38px-tall target rather than a 30px one.
- **[Update]** **The unchosen tabs look pressable** — a hover fill, brighter labels, and the counts drawn as pills instead of loose numbers beside the label.
- **[New]** **The strips are keyboard-navigable.** Left/Right move the choice, Home/End jump to the ends, and focus follows the selection. Only the chosen tab carries a tab stop, so Tab still leaves the group instead of walking through every tab in it — which is what a `tablist` is expected to do.
- **[Update]** **A plan document was filed for the next step on the settings screens** — `PlanDocs/PLAN-023`, with a self-measuring mockup (`docs/mockups/portal-settings-why-toggle.html`) showing what folding each setting's explanation behind a "Why" control would look like. Nothing was built: the mockup measures **2,621 px → 695 px** on the Portal settings tab, and the decision is deliberately left open.

Verified in a browser with **22 checks plus 7 on the chosen tab's count**: the strip is 518 × 48 px with 38 px tabs, the chosen label reads **6.48:1** and the unchosen labels **11.52:1** in the dark theme (**10.58:1** on the light theme), a count on the chosen tab is **10.39:1**, clicking a tab still selects it and writes `?tab=` into the address, ArrowRight moves the choice and the address to `?tab=sessions` with focus following it, only one tab is in the tab order, every tab is the same height, and at 390 px wide the strip wraps to two rows inside the viewport rather than overflowing. Service Alerts' Live / Outage Board switch takes the same control unchanged.

---

## 2026.10.8.007 — The Customer Portal screen is three tabs, not one long page

Settings, who may use the portal, and who has were stacked one under the other, so answering "who has access?" meant scrolling past every setting on the way.

- **[Update]** **Portal settings, Client access and Recent portal sessions are now tabs** on Administration → Customer Portal. Only the chosen one is drawn, so the long list of settings is no longer in the way of the client table, or the table in the way of the sign-in history.
- **[Update]** **The tab is in the address** (`/admin/portal?tab=access`), so a tab can be linked to in a handover or a ticket, and reopening the page comes back to where you were rather than to the first tab.
- **[New]** **The tabs carry counts** — how many clients are listed and how many sessions there are — so the tab strip answers "is there anything in there?" without being clicked.
- **[Update]** **The tab strip is one component now** (`components/ui/Tabs`), used here and by Service Alerts' Live / Outage Board switch, instead of each screen writing its own. It is a `tablist` in the accessibility tree rather than a row of buttons, so a screen reader says which tab is chosen.

Verified in a browser with **20 checks**: the screen opens on its settings with neither table rendered at all, each tab brings its own card and writes itself into the address, a `?tab=access` link lands on the client table after a reload, the settings tab carries its sixteen fields and the client tab none of them, and Service Alerts still switches between its two views through the same control. Help updated where it called these cards sections of one page.

---

## 2026.10.8.006 — Favorites follow the account

Pins were per browser, so a section pinned on a desktop was missing on a laptop. They live in the account now — the same way the dashboard's own arrangement does.

- **[Update]** **Pinned sections travel with the person.** Favorites is stored per user (`UserNavConfig`, one row per account, cleaned the way the dashboard's layout is), so signing in anywhere brings the same pins, in the same order, including the order you last dragged them into.
- **[Update]** **The browser is only a cache.** localStorage still holds the last list it saw, so the navigation draws the pins it already knows before the API answers rather than flickering; the account's list replaces it a moment later.
- **[New]** **Anything pinned before this change is handed over once.** A browser whose list the account has never seen offers its pins up on the next load instead of losing them — and only while the account has nothing saved, so an account that already has pins always wins.
- **[New]** **A slow first read cannot undo a pin made while it was in flight.** Once you touch your pins, the answer to that first read is ignored.

Verified by probe and in a browser: **47/47** on the per-user preference suite (16 new checks — the list is cleaned to ids shaped like section ids, duplicates collapse, the list is capped at 40, a non-list is refused, another account sees nothing of it, and an unauthenticated read is refused) and **21/21** in a browser driving two "machines": a pin made in one appears in a fresh one with an empty cache, unpinning removes it everywhere, a browser's pre-existing pins are adopted once and not over an account that already has some, and a reorder is stored on the account.

---

## 2026.10.8.005 — Favorites at the top of the navigation, and a menu on every section

Pinning is a copy, not a move: the section keeps its place in the tree and appears again under a Favorites header at the top of the pane — and every section now answers a right-click with a menu about itself.

- **[New]** **Favorites sits at the top of the navigation, level with Home.** Right-click any section or subsection and choose **Pin to Favorites**; the pinned section appears under Favorites, drawn exactly as it is in the tree — heading, icon, children and all — and a small star is left behind where it already lives, so a copy is visibly a copy. Subsections can be pinned just as sections can.
- **[New]** **The pinned order is yours.** Drag a pinned row by its handle, exactly as the tree's top level is dragged, or right-click one for **Move up** and **Move down**. The order is kept with the other navigation layout preferences and comes back after a reload.
- **[New]** **A right-click menu on the navigation, aware of what was clicked.** A page offers **Open**, **Open in new tab**, **Open in new window** and **Copy link**; a section adds **Expand this section** / **Collapse this section**; a pinned copy adds its order and **Remove from Favorites**; and the pane itself offers **Expand all**, **Collapse all**, **Remove all favorites** and the sidebar toggle. Shift+F10 opens the same menu from the keyboard, and text fields keep the browser's own menu.
- **[Update]** **Favorites is open by default and says what it is for while it is empty**, so the feature is discoverable rather than hidden behind a collapsed header.
- **[Update]** **A collapsed sidebar keeps the pins in reach**: the star stays at the top and the pinned sections sit under it as icons.
- **[Update]** **A pinned copy opens and closes on its own.** Pinning a large area does not unfold it into Favorites, and closing it there leaves the section you were reading in the tree untouched.

Verified in a browser with **50 checks**, covering the section's position and level, both menus and their entries, pinning a section and a subsection, the pin mark left in the tree, independent open state, reordering by menu and by dragging, the stored order surviving a reload, the collapsed sidebar, and removing pins without disturbing the navigation. Targeted typecheck clean, and the help-link guard green with the new FAQ answers and walkthrough section in place.

---

## 2026.10.8.004 — Tints that were never painted, and the pale labels they were hiding

A class like `bg-cyber-600/20` asked for a subtle tint and got nothing at all, because a theme colour declared as a bare `var()` cannot take an opacity modifier in Tailwind — so the utility emitted no rule. The same colours, left as the Tailwind palette, then put pale labels on pale tints: a status badge measured **1.3:1** on the light theme.

- **[Fix]** **Theme colours now accept an opacity modifier.** Each one is wrapped in `color-mix` with the alpha handed to the colour, so `bg-cyber-600/20`, `bg-surface-lighter/40`, `divide-surface-border/60` and the rest paint what they say they paint — and still follow the theme, because the colour is still the theme's. This closes the trap in every place it appeared rather than one class at a time.
- **[Fix]** **The light theme reads the pale shades at the 800 shade of the same family.** `text-green-400` is #4ade80 whatever the theme, which is 1.4:1 on a white surface and worse on a tint of its own colour; the light theme now keeps the family and moves the shade, hover variants included, and maps the un-themed light end of `gray`/`slate` onto the text tokens. That is one block of CSS covering roughly 480 places that were written for a dark surface.
- **[Fix]** **The accent tints are lighter on the light theme.** A crimson tint on white carries far more weight than the same tint on a near-black surface: at the authored strength the crimson label on top measured 3.5:1 at `/30` and 4.4:1 at `/20`, and now measures 6:1 or better.
- **[Fix]** **The nav's alert count reads.** It was white on `bg-red-500` (3.5:1) in the dark theme and near-black on red in the light theme, because `text-white` follows the theme's text colour; it is now a `.badge-count`, white on a solid red in both.
- **[Update]** **The comments that described the trap were rewritten**, since they explained the old behaviour as though it were permanent.

Verified by measurement rather than by eye. A browser sweep walks every visible text run on a page, composites its real backdrop — through every translucent layer above it — and measures the contrast: **189 failing runs before, 0 after**, across 16 pages in both themes; 0 across the four colour schemes and the two base themes on a further 11 page-theme combinations; **31 checks** that the tints paint a real colour in both themes and still follow the theme; **8 checks** on the components and hover states the remap touches. Web typecheck clean, production build clean.

Three pages still fail, and are unchanged by this: Quotes, AI Actions and Calendar style themselves with **raw hex** rather than theme colours, which is exactly what the design-token lint's legacy allowlist records. Measured against the previous theme files, they report the identical 16 failing runs, because no theme change can reach a colour that is written into the page.

---

## 2026.10.8.003 — The portal can live at an address of its own

Until now the portal's address was always this application's address, which meant a deployment that serves the portal on its own hostname had nowhere to say so.

- **[New]** **Portal address, on Administration → Customer Portal.** Set it and that becomes the address customers are given: the one the Portal card shows and copies, the one the per-client "open the live portal" link follows, and the one the sign-in email quotes. Leave it blank — the usual case — and nothing changes: the address is worked out from the application's own address, exactly as before.
- **[New]** **The Portal card now says where its address came from** — set on this screen, set by the deployment, or the application's own address — so a surprising link can be traced to the setting that caused it instead of being guessed at.
- **[Update]** **`PORTAL_PUBLIC_URL` is the deployment's side of it.** A deployment that would rather configure it in the environment than on the screen sets that instead, and the screen says so; saving an address on the screen overrides it, as every other setting does.
- **[Update]** **The sign-in email now says where to sign in**, which the code on its own did not. It was the one message a customer receives that never named the portal.

Verified by probe and in a browser: **148/148** on the portal suite (13 new checks covering the setting's publication, that a saved address becomes the one customers are given, that a scheme is required, that changing it needs the configuration permission, and that clearing it restores the deployment's own), **15/15** in a browser driving the field and the card including the copy button and the per-client link, plus the environment layer checked against a restarted API, and **91/91** on the configuration suite.

---

## 2026.10.8.002 — Recently Resolved moved above the service cards

What just cleared is the reason to open the page, and it was the last thing on it.

- **[Update]** **On Service Alerts, Recently Resolved now sits above Monitored Services.** The page now reads: the counts, then Active Alerts (while anything is wrong), then the list of what has just cleared, then the monitored services and their feeds. Before, the resolved list sat under the services, so on a busier deployment it was the one section you had to scroll for.
- **[Update]** **The section itself is unchanged** — same heading, same eight most recent incidents, same relative timestamps. This is a move, not a redraw.

Verified in a browser: the rendered headings run Active Alerts → Recently Resolved → Monitored Services both vertically and in the document, with eight resolved incidents listed below the active ones and nothing else on the page disturbed.

---

## 2026.10.8.001 — The Portal card says where the portal is

The screen that decides whether customers have a portal never told you the address to give them.

- **[New]** **The Portal card on Administration → Customer Portal now carries the portal's address**, with a copy button beside it so it can go into a welcome mail or a document. While the portal is live the address is a link that opens it in a new tab; while it is off the address is still shown — as plain text, with a line saying every portal route answers 404 until it is switched on.
- **[Update]** **The address is the deployment's own web origin** rather than whatever the administrator happens to be browsing from, so the same link is shown wherever the screen is read — the same origin single sign-on hands back to. A deployment that has not set one falls back to the browser's own origin.
- **[Update]** **One place for the address.** The older "Open the portal" link beside the board card is gone: the Portal card is where the address belongs, and two links to the same route is one too many.

Verified in a browser in both states — **10 checks live, 8 with the portal switched off** — including that the link carries the address the API reports, opens in a new tab, is the only link to the portal on the page, and that the copy button hands over exactly that address.

---

## 2026.10.7.046 — The dashboard's recent tickets read like the rest of the product

The card listed eight tickets as one line of raw data each — a ticket number, a title and `in_progress` — with nothing to say which client it belonged to or when it last moved. It is now a table in the product's own language, with the two columns that were missing.

- **[New]** **A client column and a last-updated column.** Each row now says whose ticket it is and how long ago it last moved — "21m ago", "5h ago" — with the exact timestamp on hover. Both columns drop out on a narrow window before anything is cramped.
- **[Update]** **A column header, so the card explains itself**: Ticket, Subject, Client, Updated, Status.
- **[Fix]** **Statuses are written and coloured like statuses, not like database values.** `in_progress` was being printed raw; it now reads **In Progress** in a tinted badge that follows the product's badge language, and the same language is used in the customer portal's own ticket list and in the portal preview — one shared helper, so a status cannot be "In Progress" in one place and `in_progress` in another.
- **[Fix]** **The badge tints are visible in both themes, at last.** The status colours are theme tokens (`--status-*`) with their tint derived from the label colour, because the badge pattern used elsewhere — `bg-cyber-600/20 text-cyber-400` — relies on an opacity modifier over a colour declared as a bare `var()`, which emits no rule at all: those badges have no background, and the ones that do use a fixed palette shade are unreadable on the light theme (measured: 1.3:1). The new badges measure 5.3–6.4:1 in the light theme and 5.7–9.2:1 in the dark one.
- **[Update]** **The rest of the row is the product's, too:** monospace ticket numbers, the subject truncated with the full text on hover, a row that highlights as a whole and opens the ticket wherever it is clicked, dividers in the theme's own border colour, a **sticky header** so the columns stay named while the list scrolls, an **All tickets** link in the card's title, and an empty state that says what the card is for rather than "Nothing updated recently."

Verified in a browser at desktop width, in both themes: **21 checks** — the five columns are present and hold a ticket number, a subject, a client, a relative time and a readable status; no raw status value is left anywhere in the card; the dividers are the theme's border rather than Tailwind's default; clicking the far end of a row still opens that ticket; and the badges are filled and legible on both themes. The same badge was re-checked inside the customer portal preview — **9 checks**, 5.3:1 or better in both themes.

---

## 2026.10.7.045 — Each customer gets the portal access they need, and you can see it before they do

The portal's rules were one set for the whole deployment: the same ticket visibility, the same ability to raise and reply, for a one-mailbox small business and for a three-hundred-person client alike. They are now decided at three levels — the person, the client, the deployment — and the whole thing can be previewed as the customer before anybody sees it.

- **[New]** **A policy per customer.** Ticket visibility (**their own tickets** or **every ticket at their client**), whether they may **raise** tickets, whether they may **reply**, and **which board** their portal tickets land on can each be set for one client, from **Client access → Portal access** on Administration → Customer Portal. Every control offers the deployment's own answer first, so a field only carries a value where somebody decided — and the row says so, with the level each answer came from.
- **[New]** **An overrule per person.** Portal visitors are contacts, not user accounts, so there is no role to attach this to: each contact of a client can be **refused the portal altogether** (the contractor who should raise tickets by phone) or given a **different ticket visibility** from their colleagues (the office manager who runs the account and sees everything). Autotask, ConnectWise and Scoro all keep both of these on the client record with a per-contact overrule.
- **[New]** **See the portal as the customer, before they do.** **Preview** opens the portal for a chosen client and contact: their **sign-in page** wearing the client's colour and logo, the **ticket list** their scope actually returns, one ticket's **public conversation**, and the **new-ticket form** — with the buttons that the policy would refuse simply not drawn. The **What decided this** panel names the level behind each answer and says how many tickets at the client the visibility in force is holding back.
- **[New]** **The preview is the real thing, and changes nothing.** It runs the portal's own scoping query and the same public-notes-only rule rather than a second implementation, so it cannot flatter the configuration; and it creates no session, sends no code, and writes no ticket or note — a "reply" or a "raised ticket" inside it is marked *not saved*. Tickets shown are real and read-only.
- **[Update]** **The policy is resolved per request** from the contact, then the client, then the deployment's Portal settings — so a change takes effect on the customer's next page load, and a client with nothing set follows the deployment including when the deployment changes later. Every portal route reads the one resolver: the ticket list, the ticket detail, the account summary, raising, replying and the per-client board.
- **[Update]** **Help follows:** the Customer Portal walkthrough gains "Give one customer a different level of access", "Overrule one person" and "See it before the customer does"; the Customer Portal area's rows and the field descriptions in the configuration reference now say that a client — or a person — can be given a different answer.

Verified by `apps/api/probe-portal.mjs` — **135 checks, 0 failures** — including that widening one client's visibility widens both of its customers and narrowing one person does not touch their colleague, that a client refused the form is refused with the reason while the deployment's own setting is untouched, that clearing an overrule hands the answer back, that a client's tickets land on the board set for that client, that the preview shows the scope in force and never an internal note, and that previewing creates no session, no code and no ticket. The screen was then driven in a browser — **26 checks, 0 failures** — through opening a row's policy, changing it, watching the source change with it, and stepping the preview from the sign-in page to a ticket's conversation.

---

## 2026.10.7.044 — The dashboard's Recent tickets card stops dragging its row out of shape

The card was a list whose height was its content, placed at half width in a row with two small counters — so the row was as tall as eight tickets (326px), the counters sat at the top of it above 244px of empty space, and the row left a column unused at the right. The page now lays out in bands: every card fills the row it is in, and the list no longer shares a row with the counters in the standard arrangement.

- **[Fix]** **Recent tickets is a full-width panel in the standard layout.** At half width it made its row as tall as the list and left the counters beside it above a pool of empty space. Full width, it sits in a band of its own, and a hand-arranged layout that puts it at half width still works. Anyone who preferred it half width can set **M** in Customise.
- **[Fix]** **A card in a row with a taller one now fills the row.** The counters are `h-full` with their number vertically centred, so a row of cards reads as one band rather than one card and some empty space — including for a layout somebody arranged by hand, where the counters now measure exactly the height of the list beside them.
- **[Fix]** **The list scrolls inside the card instead of stretching it.** Its rows live in a scroll region that takes whatever height the row gives it, so the card can never again be the thing that decides how tall a row full of small cards is. In the standard arrangement all eight rows are visible and nothing is clipped.

Verified in a desktop-width browser: the standard layout renders four bands with every card in a row the same height (previously two rows were ragged — the worst being 82px beside 326px), the panel spans the full width, all eight ticket rows are visible with no clipping and the counter content is vertically centred; and with the panel arranged at half width by hand, the two counters beside it measure 326px — exactly the panel's height — so that row is one band too. `probe-dashboard.mjs` still passes 31/31, and the arranged layout used for the check was cleared afterwards.

---

## 2026.10.7.043 — Single sign-on is configured in the application, not only in the environment

**Single sign-on (OIDC)** was a switch in Sessions & Security with nothing behind it: the provider lived in environment variables only, `SSO_ENABLED` was read straight from the process, and the `SsoConfig` rows the API exposed were storage nothing consulted. Turning the switch on in the UI changed nothing, and there was nowhere to put an issuer, a client id or the redirect URI to register at the provider. There is now a screen for it, and the handshake obeys it.

- **[New]** **Administration → Single Sign-On.** One screen for the provider — the issuer URL, the client id and the write-only client secret, the scopes, the redirect URI to register at the provider (with a copy button) — and for who may sign in: the email domains to accept, whether an unknown identity gets an account on first sign-in, whether that account may be used straight away, and the role it starts with. **Check the provider** reads the issuer's discovery document and lists the endpoints it publishes, so nothing else has to be typed by hand; **Check the saved provider** re-reads it and counts the signing keys it publishes — the step a handshake fails on last, rather than first.
- **[New]** **The configuration is stored in the application, and wins over the deployment's environment.** `SSO_ISSUER`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET` and `SSO_REDIRECT_URI` still work, so a deployment configured the old way behaves exactly as it did; a provider saved on this screen takes precedence, so a deployment configured both ways is predictable rather than a coin toss. The client secret is never handed back to a browser — only whether one is saved.
- **[Update]** **Who may sign in is enforced, not merely stored.** Only addresses in the configured domains are accepted, whatever the provider vouches for; an unknown identity is created only when that is allowed, and an address nobody has vouched for is refused with what to do about it. A provisioned account stays inactive unless it is allowed to be used straight away. **An administrator role is never handed to an identity this deployment has never seen** — not automatically, and not as the role a new account is created with: such a configuration is ignored and the account waits at the least privilege for an administrator to look at it.
- **[Update]** **The switch and the provider are two separate questions, answered separately.** Sessions & Security owns *whether* sign-in is offered and the Single Sign-On screen writes that same stored setting — so the two can never disagree — while the screen reports whether the provider is *complete*, and says which of the two is missing rather than a single "off".
- **[Fix]** **The requirement banner on Sessions & Security is no longer wrong.** It claimed the requirement could only be met by the deployment's environment and offered no way to meet it. It now reports whether the requirement is satisfied by the environment or by this application's own configuration, and links straight to the screen that can satisfy it.
- **[Fix]** **The redirect URI is no longer judged as an outbound request.** It is where the provider sends the browser back — the server never fetches it — but it was validated against the egress address policy, which refused the application's own default on any development deployment (`http://localhost:3010/api/auth/sso/oidc/callback`), leaving the field unsaveable. Only its shape is checked now; the issuer, which *is* fetched, keeps the full policy.
- **[Update]** **Help follows:** a new **Single Sign-On (OIDC)** walkthrough covers registering the application at the provider, each field, who may sign in, what a first sign-in does step by step, and a troubleshooting table of the failures you actually meet; the identity walkthrough's SSO steps no longer tell you to ask the deployment to set environment variables, and the `SSO_ENABLED` row in the configuration reference points at the screen.

Verified by `apps/api/probe-sso-oidc.mjs` — a stub identity provider on loopback (discovery, authorization, token and JWKS endpoints, signing a real RS256 ID token) driving the handshake end to end: 50/50 checks, including that the stored provider beats the environment, that the secret is never returned, that an administrator role is refused by the route and ignored by provisioning, that domains are enforced case-insensitively, that provisioning off refuses an unknown identity without leaving an account behind, and that switching sign-in off stops the handshake being started. The screen itself was driven in a browser: 11/11 checks, and the saved provider row and toggle were removed afterwards.

---

## 2026.10.7.042 — Alert Webhooks deliver for real, and the page explains every field

The page registered endpoints and showed a delivery log, and nothing behind it ever sent anything: a registration stopped at the row, so an endpoint was never called and the log only ever held sample data — with a default subscription to `alert.opened` / `alert.resolved`, event names nothing in the application emits. The delivery half now exists, signed and retried, and the page describes every field, the wire contract and the log.

- **[New]** **Alert events are delivered.** When an alert opens or closes — from the monitor, from a status page, or raised by hand — every active endpoint subscribed to that event receives one HTTPS POST. The body carries `event`, `sentAt`, and the service and alert in a `data` object: title, severity, status, source, source URL and the timestamps. Delivery is fire-and-forget, so a slow or dead endpoint can never hold up the poll that raised the alert.
- **[New]** **Every delivery is signed.** `X-C7-Signature: sha256=<hmac>` is an HMAC-SHA256 of the exact request body, keyed with that endpoint's own secret, alongside `X-C7-Event` and `X-C7-Delivery` (the id of the row in the log). The secret is handed over once, when the endpoint is registered, and never listed again. Requests go through the same egress policy as every other outbound request, so a webhook URL pointed at a private or link-local address is refused — at registration and again before each delivery.
- **[Fix]** **The event list was fiction.** A registration defaulted to `alert.opened` and `alert.resolved`, which nothing emitted, so even a correctly configured endpoint would have received nothing. The page now offers the two events the application actually produces — **Alert raised** and **Alert resolved** — from the same list the dispatcher reads, with a sentence explaining each, and a subscription to nothing is refused rather than silently dead.
- **[New]** **Failures are retried and visible.** Up to the endpoint's own `retryCount` (1–5, default 3, a field the schema has always had and nothing used), with a widening gap — 1s, 5s, 15s, 30s — then recorded as failed. The pending row is written before the first attempt, so the log shows work in flight and a crash mid-delivery leaves a visible pending row rather than silence.
- **[New]** **Send test** puts a `webhook.test` delivery in the log on demand, in one attempt, reporting the endpoint's own answer — so a receiver can be proved, and a broken one diagnosed, without waiting for an incident to happen. **Edit** changes a name, URL, subscription or retry count without losing the endpoint's history, and **Park** stops deliveries while keeping it.
- **[Fix]** **The seeded sample endpoints are parked.** They point at `hooks.example.com`, which does not resolve; while they were active, every real alert produced a failed delivery, so a fresh install would open this page on a wall of failures nobody could act on. Their seeded delivery rows still show what a log row looks like.
- **[Update]** **The page is rewritten in the design system** rather than hand-styled, and describes each field where it is used: what a name is for, what the URL must be, what each event means, what retries do, what every column of the log says, and the exact request that arrives — method, the three headers, the body, and a short receiver-side example of verifying the signature. The page is off the design-token legacy allowlist as a result.
- **[Update]** **Help follows:** the Alert Webhooks walkthrough now covers registration, the wire contract, retries and the log; the companion FAQ answer no longer names events that do not exist; and the `ALERT_WEBHOOKS_ENABLED` row in the configuration reference describes what the switch actually governs.

---

## 2026.10.7.041 — The Uptime Monitors page explains what its three checks do, and why you would add one

The page offered a name field, a dropdown and a table, and no way to tell what any of the three kinds actually watches or what would happen if it failed. It now says so, with a worked example of the three monitors a client portal needs.

- **[New]** **The page describes itself under its own title.** A paragraph on what a monitor is — one target, watched on the same poll as Service Alerts, reporting as one of that service's sources, so it raises an alert, clears one, and notifies through the Alerting Mechanism already configured. Then one line per kind, written as the failure each one catches rather than what it fetches: **Website** compares the status code with the one you expect, **SSL expiry** warns a chosen number of days before the date and reports the outage once it has passed, **DNS** reports an outage when the name stops resolving.
- **[New]** **A worked example, in the same columns as the form.** For a client portal at `portal.client.com`: a website check for the portal answering with an error page, an SSL check for the certificate that expires over a weekend, and a DNS check for mail stopping because the name no longer resolves — the three ways one service goes dark, each typed exactly as it would be into the fields above.
- **[Fix]** **The page's one-line description in the header was not true.** It advertised "their own schedules, history and status": the checks run on the shared five-minute Service Alerts tick, and this page shows neither history nor status. It now reads "Website, SSL-expiry and DNS checks on targets you name: a failure raises a Service Alert."
- **[Update]** **The Help walkthrough gains the constraint the page now states** — checks go through the same egress policy as every other outbound request, so a target has to be reachable from the internet and a private or link-local address is refused with the reason written on the alert; and the SSL and DNS checks read the host in the address, so a path on the end is ignored.

---

## 2026.10.7.040 — Service Alerts: a post has to name the service before it can raise a notice

A social sweep pointed at the wrong X endpoint put **149 notices** on the board across nearly every service — Microsoft 365, Verizon, Gemini and Claude among them — every one of them quoting the same post about something else entirely. The monitor now refuses a post that never names the service, and the fabricated alerts are gone.

- **[Fix]** **A social post must name the service to count for it.** The observer searched X for the service's own name and accepted whatever came back, so a post about one product raised notices on every other service on the board — and, because a base URL can be pointed somewhere it should not be, the whole board once quoted a single unrelated post. A post that never names the service can now neither raise a notice nor retire one, and the observation's detail says how many of the posts read actually named it. The source still raises a notice when a post does name the service, which is the whole point of keeping it.
- **[Fix]** **The 149 fabricated notices and the five probe services that produced them are removed.** They were test residue twice over: a registration that died part-way left the services behind, and while they existed the sweep recorded a notice against every service it polled. The genuine alert on the board — a vendor status page reporting a degraded service — is untouched, and the seed snapshots were recaptured so a reseed cannot restore the rest.
- **[Fix]** **An alert card no longer carries an empty Sources block.** When a service's last poll read nothing at all, the active alert showed the divider and "No monitored sources configured" underneath it — contradicting the source chip on the same card, which names where the alert actually came from. The block now appears only when there is a source to list; the board's Sources column still says when nothing is watching a service, which is the point of that column.
- **[Fix]** **The divider above it was drawn in Tailwind's default grey, not the theme's border.** `border-surface-border/60` emits no rule at all — the colour is a bare `var()`, so there is nothing to put the alpha into — and the element falls back to the preflight border, a light `#e5e7eb` hairline on a dark card. Measured in the browser rather than reasoned about: the same fault, from the same cause, as the one fixed on the installer-versions card earlier today. The Service Alerts settings page had seven more of them — six panels whose `bg-surface-lighter/50` computed to fully transparent, and a table row divider in the same default grey.
- **[Update]** **The outage-board probe cleans up after itself even when it fails, and its cleanup assertion now runs in the `finally`.** The five residue services existed because the cleanup ran *after* the assertions: one thrown error and the service stayed on the board for good. The new phase covers the naming rule — a post about another product must read as clear for this service and raise nothing — so the rule cannot be relaxed without a red probe.
- **[Update]** **Help states the naming rule** where it describes the social source, in the walkthrough and in the companion FAQ answer about whether chatter can raise an outage.

---

## 2026.10.7.039 — The installer versions card leads with the release in use, and keeps the rest beneath it

The current installer and every version kept for rollback were one flat list, so the release people actually want sat at the top of a pile of the ones they do not. The card now leads with **Latest Release**, keeps what it replaced together under **Previous Versions**, and appears as soon as there is a single installer to download.

- **[New]** **C7NC → Outlook Add-in groups the installer history.** *Latest Release* labels the newest installer in its own card, and *Previous Versions* labels the ones kept for rollback in a card below it, each with a count of how many are kept. The card keeps its own **Installer versions** title and its `plugin 26.10.7036` fact, and every row keeps its release, size, build date and **Download**.
- **[New]** **The two group labels sit a step below the card's own title.** 11px semibold uppercase with `0.06em` tracking in the tertiary grey: the smaller size is carried by capitals and weight, so they still read as headers rather than as metadata. At the title's 14px a label competes with it; at 10px or below it reads as metadata.
- **[Update]** **Each group is one card with a hairline between its rows, instead of a bordered box per row.** The rows keep their padding, chips and download links but stop being individually boxed, so they read as members of a group rather than as unrelated rows that happen to sit next to each other. The latest group is left un-tinted: the *Newest* chip and the label above it already say which release is current, and a third signal is noise.
- **[Fix]** **A deployment with a single installer now offers it here.** The card was hidden unless two or more versions existed, so a fresh instance showed no installer download on this page at all — a wall that a *Latest Release* group no longer needs.
- **[Fix]** **Two classes that silently emitted nothing were replaced while building the grouping.** `bg-surface-lighter/40` computed to `rgba(0, 0, 0, 0)` and `divide-surface-border/60` fell back to Tailwind's default `#e5e7eb` — a light-grey hairline in a dark theme — because an opacity modifier on a theme colour defined as a bare `var()` emits no rule at all. Measured by reading computed styles back from the running application, not assumed; the card now uses the plain `bg-surface-light` and `divide-surface-border` tokens, which resolve to the theme's own values. The same pattern still appears elsewhere in the app and is left alone here — it is a token-definition change across every palette, and it is written down rather than smuggled into this one.
- **[Update]** **Help follows the change in both places it describes the card** — the companion-clients FAQ answer on rolling an add-in update back, and the "Installer versions" section of the Outlook Add-in walkthrough, which now name the two groups instead of describing one list.

---

## 2026.10.7.038 — A mockup of the installer versions card, split between the current release and the history behind it

The current installer and every older version kept for rollback were one flat list, so the release people actually want sat at the top of a pile of superseded ones. This is the design for separating them — drawn with the application's own colours, sizes and wording, and covering every state the card can be in. **No application code has changed**; this is for review before it is built.

- **[New]** **A mockup of the installer versions card on C7NC → Outlook Add-in, with the current release in its own card.** *Latest Release* sits above the newest installer, *Previous Versions* above the ones kept for rollback, and the card keeps its own **Installer versions** title and its `plugin 26.10.7036` fact. `docs/mockups/installer-versions-card.html` is self-contained — no build, no network, nothing wired up — and renders the real release/size/date line and the real closing note rather than approximations of them.
- **[New]** **The two group labels are a deliberate step below the card's title.** 11px semibold uppercase with `0.06em` tracking in the tertiary grey: the size goes down and the weight, capitals and tracking take over the job of reading as a header. At the title's 14px a label competes with it; at 10px or below it reads as metadata. The number is written into the mockup as a spec so it can be argued with.
- **[New]** **Each group is one card with a hairline between its rows, instead of a bordered box per row.** The rows keep their padding, chips and download links, but stop being individually boxed, so they read as members of a group. The latest group is left un-tinted: the *Newest* chip and the label above it already say which release is current. The mockup shows and rejects the tinted alternative.
- **[Update]** **Two decisions the regrouping creates are raised rather than decided quietly.** With a *Previous Versions* label over the old rows, the *Earlier* chip on each row says the same thing twice; and the card is currently hidden unless there are two or more versions, so a fresh deployment offers no installer download here at all — which one *Latest Release* group no longer justifies. The mockup recommends on both and shows the single-version state, since that one changes behaviour and not just layout.

---

## 2026.10.7.037 — A full security and bug audit: five holes closed, and the ones left are named

A repository-wide audit — every route, every permission, every web-to-API call — followed by a fresh run against the advisory database. Five genuine holes were found and are fixed; the ones that need a decision or a major upgrade are written down with the reason rather than left to be rediscovered.

- **[Fix]** **Any signed-in account could read any system-configuration row by name, including the SSO hand-off.** `GET /api/system/config/:key` had no gate while its `PATCH` twin did — and the row the SSO callback parks there holds the single-use code **and the signing-in user's whole token** for two minutes. Polling that key during somebody's sign-in was a full session takeover that never touched the exchange endpoint built to consume the code. Read and write now share one policy: service-owned rows (`sso:`, `email_connector:`, `oauth`, `sample_data`, and anything named like a secret) are refused to everyone, administrators included, and are left out of the `/system/configs` dump as well. The three genuinely self-service keys keep working, which is what the app's own screens read.
- **[Fix]** **The integration list handed every technician the password to every client's cloud.** `credentials` is stored in clear text and returned with the row; `IntegrationView` is held by technicians and `IntegrationManage` is not, so a technician could read the M365 client secret, the ConnectWise key pair and the AWS `secretAccessKey` for the whole provider — and could *use* them through the test and sync endpoints. A view-only caller now receives `hasCredentials` instead of the values, and the fix dialog that needs them is the manage-gated one.
- **[Fix]** **A letter from a client was enough to open a ticket against a different client.** The add-in took `companyId` from the review and `POST /projects`, `POST /quotes` and `POST /schedule` took a company from the body, all reachable by the client-facing roles. A scoped account now files only under its own client — the add-in refuses another up front with a 403 rather than reporting "the ticket could not be created" for a refusal the person could have avoided, its picker offers only their own client, and every write that names a company checks it.
- **[Fix]** **Six endpoints let a client-scoped account read the whole provider's data.** Projects, assets, the schedule and quotes — including quote line-item pricing — returned every company's rows, because the company filter was the caller's own query parameter and absent by default. Project and asset detail routes answered with another company's record. All six are scoped now, with detail routes answering 404 rather than 403 so an id that is not yours is indistinguishable from one that does not exist.
- **[Fix]** **Unpublished and internal knowledge-base articles were readable by client roles.** `KBView` is held by `client_admin` and `client_user`, and the article route ignored both `status` and `visibility`, so drafts — body, review note and the ticket they were drafted from — were readable by the customer they were written about. Scoped accounts now see published, non-internal articles only; staff are unaffected, including the draft queue.
- **[Fix]** **The security overrides were one toolchain away from being silently ignored.** `packageManager` pins pnpm 9.1.0, which reads them only from `package.json`; pnpm 10+ reads them only from `pnpm-workspace.yaml`. Measured rather than assumed: the same override in a project with no pin did nothing and `qs` fell back to a vulnerable version. All twelve floors are declared in both files, re-resolving produced a byte-identical lockfile, and `pnpm guard:deps` now **fails on drift** between the two lists — a floor only one package manager reads is not a floor.
- **[Update]** **The audit answered the "do the buttons work" question with three checks rather than by clicking.** Every API path the web app calls (332 of them) was matched against the routes that exist: **none broken**. The route-guard check reports 393 routes / 347 guarded / 0 unguarded. The probe suite — 28 suites — was run in full, and the three that failed were the three that document an environment precondition (`INVOICE_BATCH_ENABLED`, `TIME_RULES_ENABLED`, `EGRESS_ALLOW_PRIVATE`, `BILLING_FROM_TICKETS_ENABLED`); re-run with them set, all three pass 36/36, 6/6 and 27/27, which is a check that the kill switches work rather than a bug found.
- **Advisories:** 4 reported, **0 in production**, all four already accepted with reasons. The only two with a published fix are reachable through a **major** upgrade — Tailwind 4 (`postcss-selector-parser`) and Electron 35+ (`http-cache-semantics`, `sprintf-js`) — so they are listed rather than taken. Nothing a patch or minor bump could fix is outstanding.
- **Rollback:** every fix is a single-file edit except the override parity check, and each is covered by a probe assertion that fails if it comes back. No schema change, no API shape change, no plugin file touched (`pnpm guard:plugin` still reports 26.10.7036 matching its MSI).
- **Verification:** `probe-configuration` 87 → **91** (the read gate and the dump exclusion), `probe-cloudconnect-status` 28 → **34** (secrets present for a manager, withheld from a technician), `probe-scoping` 13 → **26** (projects, quotes, assets, schedule, the write refusals and the knowledge base), `probe-outlook-addin` 59 → **63** (the scoped account's picker and its refused filing). API typecheck 150, the pre-existing baseline, with no error in any changed file; web typecheck 0; all four guards green.

---

## 2026.10.7.036 — The add-in says "bundle", and can be tried without installing it

Two things: the wording the flow uses for its central choice, and a way to see the flow working before committing a machine to it.

- **[Update]** **"One ticket, the rest attached" is now "Bundle into one ticket".** The old label described the mechanism — what happens to the other messages — without saying what the choice *is*, and a reader had to work out that "bundle" was the word they were looking for. The option now leads with the outcome: *All 3 messages become a single ticket. You choose which one the ticket is written from; the other 2 are attached to it as files you can open later.* The question above it reads **"Which message should the ticket be written from?"** rather than "which becomes the ticket", because the ticket is written *from* a message rather than being one. Everywhere the choice is referred to — the preferences screen, the saved-answers notice, the result line, the help walkthrough and the FAQ — now says bundle.
- **[Update]** **The rest of the flow's wording was read for the first time as a reader rather than as its author.** The bundle question's explainer changed from *"Its subject, body and contact become the ticket's"* to *"The ticket takes this message's subject, body and contact, so pick the one that describes the work best"*; the attachment note no longer says messages "ride along as .eml attachments on the one ticket" but *"Each attached message is saved on the ticket as a file, so anyone reading it later can open the original."* The entry screen's promise for several messages is now *"You'll choose one ticket each or bundled, then whether to review"* instead of "you'll be asked how to handle them", which described a question without saying what it was about. The mockup, which is the design of record, says the same things.
- **[New]** **A simulator, on the configuration page.** *Administration → Configuration → Client Apps & Notifications* now offers **Open the simulator**, which opens the add-in's own pane in a window sized like it, with three example selections — one email, three, and five with two senders matching no client — and made-up answers behind it. The questions, the choice of message, the review and the result all behave as they do in Outlook, and **nothing is created, sent or saved**.
- **[New]** **The simulator is the shipped pane, not a copy of it.** `GET /addin/taskpane.html?demo=1` runs the real taskpane against canned answers; it is not a second interface written to look like the first. A separate demo screen drifts the moment the flow changes, and a demo that shows something the add-in does not do is worse than no demo. The canned answers are shaped like the server's own preview response, because the pane reads those fields.
- **[Update]** **The simulator is gated where it is served.** It lives on the add-in's own endpoint, so it is offered only while the Outlook add-in is switched on; with the setting off the button says why and stays disabled, rather than opening a page that answers 404.
- **Rollback:** the wording is text; the simulator is additive and reachable only through `?demo=1`. Turning the add-in setting off removes both the pane and the simulator (the simulator itself makes no request and writes nothing). The plugin version moved to `26.10.7036` because the pane's own files changed, so the previous installer remains available from the install page.
- **Verification:** the guard **failed on the change before it was versioned**, naming both the drifted hash and the stale installer, then passed after `pnpm plugin:bump` and `pnpm installer:build`. The simulator was driven end to end in a browser on both origins (the API's and through the Vite proxy): all three selections, the bundle path with a chosen parent, the individual path skipping an already-ticketed message, the review's matched and unmatched clients, and the one-click path with saved preferences — which filed with no sheet at all. The simulator's launcher was exercised on the configuration page: the handler fires with `/addin/taskpane.html?demo=1`. No horizontal overflow at the pane's 430px width. Web typecheck 0; API typecheck 150, the pre-existing baseline; `probe-outlook-addin` 59/0; route guards 393/347/0; help links 75 routes.

---

## 2026.10.7.035 — A picked client no longer swallows the contact, and the flow is under test

Verifying 2026.10.7.034 turned up a defect in the reviewed path, and the add-in's own probe covered the pane's assets but none of the flow the release had just added. Both are fixed here.

- **[Fix]** **Choosing a client in the review skipped contact creation, so the contact name the user had just confirmed was dropped.** When the review supplies a client, sender resolution returned that client and stopped — which was fine while the client was the only thing being overridden, but the contact lookup on that path was lookup-only. For a sender with no contact yet, the result was a ticket filed against **no contact at all**, while the review had shown a name and offered to edit it. A picked client now wins over *matching* rather than over the rest of resolution: the contact is created as usual under the chosen client, and the reviewed name is applied to it. *An editable field that quietly does nothing is worse than one that is not offered* — the rule the reviewed fields already follow elsewhere.
- **[Update]** **The add-in probe now covers the flow, not just the pane's files.** `/options` (with the 403 for an account that cannot create tickets), `/preview` naming the client and contact it resolved and creating nothing, reviewed priority and client winning over deduction, the contact rename and its move to the chosen client, the bundled path's one ticket with two `.eml` attachments and two attachment rows, and preferences round-tripping **per user** — a technician's account on the same machine still asks. 32 checks became **59**.
- **[Update]** **The probe cleans up its attachment files too.** Rows cascade away with the ticket, but the `.eml` files under `apps/api/data/ticket-attachments` do not, so a probe that bundles messages would have left them behind.
- **Rollback:** the fix is a handful of lines in one function, and the probe is additive. Neither changes an API shape, a schema or a plugin file — so no installer rebuild was needed, and `pnpm guard:plugin` still reports plugin 26.10.7034 matching its MSI.
- **Verification:** `probe-outlook-addin.mjs` **59 passed, 0 failed**, including the four checks that failed before the fix; `probe-configuration` 87, `probe-session` 34, `probe-portal` 90, each 0 failed; API typecheck 150, the pre-existing baseline, with no error in any changed file; web typecheck 0.

---

## 2026.10.7.034 — The add-in flow ships, the plugin gets a version, and every installer is kept

The mockup was the design. This is the flow in the pane, the server work it needed, a version numbering system for the plugin, and a downloadable history of installers so a bad plugin change can be rolled back rather than waited out.

- **[New]** **The plugin is a versioned artifact.** `apps/outlook-addin/plugin.json` records its identity, its version (`YY.M.PPPP`, derived from the release), and the **hash of the files that make it up**. `pnpm plugin:bump` recomputes that hash and takes the version from the current release; the manifest's `<Version>` is served from the same record, so the version Office reports, the version in the MSI filename, and the version on the install page cannot disagree. The add-in's identity moved out of the API and into the record with it.
- **[New]** **"If the plugin changes, the installer must be updated" is now enforced, not remembered.** `pnpm guard:plugin` fails when the plugin's files have changed since they were versioned, when the newest installer was built from a different payload, or when there is no installer at all — and `build.ps1` refuses outright rather than producing an installer for an unversioned plugin. Verified on a real change: the guard reported both problems and the build threw.
- **[New]** **Every installer is kept, and the install page lists them.** `installer/artifacts/index.json` is the history — version, release, origin, payload hash, build time and SHA-256 per artifact — and the page shows them newest first with a **Download** on each, so an earlier plugin can be reinstalled for troubleshooting or a last-known-good rollback. Only artifacts named in the history are served, so a download path never becomes a filesystem path.
- **[New]** **The flow, in the pane and on the server.** Several selected messages now ask *one ticket each* or *one ticket with the rest attached*; bundling asks which message is the ticket and which of the others ride along; a preview sheet offers the review; and the review shows every field the server will fill in, editable — board, client, contact, subject, description, priority.
- **[New]** **`POST /api/outlook-addin/preview`** is what makes the review real rather than decorative. A client is matched from the sender's domain and a contact from the sender's address, and the pane can see neither — so the server is asked what it *would* do, read-only, and reports which messages already have a ticket. The pane shows that on the row instead of finding out at the end.
- **[New]** **`GET /api/outlook-addin/options`** gives the pane boards and clients without demanding the permissions `/api/boards` and `/api/clients` enforce. Filing a ticket does not require `ClientView`, and a technician who could create a ticket but not list clients was being shown an empty picker.
- **[New]** **Bundled messages ride along as `.eml` attachments** — headers plus the plain-text body, so somebody can open the original later rather than reading a re-rendered summary. Whole-message attachments are size-checked and deliberately non-fatal: the ticket exists, and failing the whole submission because one message was too large would report failure for work that was done.
- **[New]** **Reviewed fields win over deduction.** A client the user picked, a corrected contact name, an edited subject, description or priority are applied rather than re-derived. The contact rename is real — an editable field that quietly does nothing is worse than one that is not offered — and it is logged.
- **[New]** **Saved preferences, per user.** Held on the `User` row (`addinPreferences`), not in the pane's `localStorage`, which is scoped to the add-in's origin and therefore shared by every C7NTAX account used on that machine. A preference that lets a ticket be filed without asking, inherited by the next person to use Outlook on that PC, is not a preference. *Remember this answer* sits on both questions, and a **Preferences** screen reachable from the pane header is the one place a saved answer can be seen and undone — because every one of them works by making a question stop appearing.
- **[New]** **Single-click filing**, when both answers are saved: the entry screen says so in its button label and in "filed immediately — no questions, per your saved preferences", with a **One-click** chip. Verified end to end: the second selection created tickets **with no sheet shown at all**. Bundling is deliberately not rememberable and the sheet says why — which message is the ticket changes per conversation, so "always bundle" would have to invent a parent.
- **[Fix]** **Writes from the pane were rejected with `403 CSRF token missing or invalid`, and every read worked.** The pane authenticates with its own bearer token, but a browser sends the origin's cookies with a same-origin fetch by default — so on a machine where the user was also signed in to the C7NTAX web app, the API saw a valid session cookie and demanded the CSRF header that goes with it. The pane now fetches with `credentials: "omit"`, which is what makes it a token client with no ambient session to confuse and no request that can ride on somebody's browser login.
- **[Fix]** **The unmatched-client hint said the wrong thing.** It read "the ticket is created without a client"; the server falls back to the oldest client, so it now names the client it will actually be filed under.
- **Rollback:** each preference is reversible in the pane's Preferences screen, and the whole plugin can be rolled back by installing an earlier version from the install page. The server-side column is nullable, so a downgrade ignores it. `pnpm guard:plugin` and `pnpm guard:config` are both additive.
- **Verification:** driven against the live API. Individual creation with a reviewed priority returned a ticket with `priority: High`; a reviewed contact name renamed the contact (`logged: renamed from "Jane Doe" to "Jane A. Doe"`); an explicit client overrode the domain match; re-sending the same messages returned `already has a ticket` for each; the bundled path created one ticket with **two `.eml` files on disk and two attachment rows**. The pane was then driven in a browser with a stubbed Office host through both branches — bundled (ask → bundle → preview → create, "1 ticket created, with 2 messages attached") and individual with saved preferences (**one click, no sheet, correct dedup**) — with no console errors. `guard:plugin` was checked against the real unversioned change (fails, naming both problems) and passes after the rebuild. API typecheck 150, the pre-existing baseline; web typecheck 0.

---

## 2026.10.7.033 — Save my preferences: the add-in flow can stop asking

The mockup's questions can now be answered permanently, which is what makes a selection a single click — and the preference is visible in three places, because a setting whose whole job is to stop a question appearing is invisible the moment it works.

- **[New]** **Preferences, saved on the device** (`localStorage`), reachable from a **⚙ in the pane header** and from the line on the entry screen that reports what is saved. They survive a reload and follow the mailbox rather than the browser session. Three answers:
  - **Several messages:** *Ask me each time* (default) or *One ticket per message* — no question.
  - **Before creating:** *Ask each time* (default), *Always show the review*, or **Never — create immediately**.
  - **Board:** remember the last board used, or always start on the first one.
- **[New]** **"Remember this answer" on both questions, so a preference is set where it is decided** rather than by going to a settings page first. On the preview question it means **whichever button is pressed** — remember "create without asking", or remember "always show me first" — because the answer is the answer either way.
- **[New]** **Bundling is deliberately not rememberable**, and the sheet says so rather than offering a checkbox that would have to invent an answer: which message is the ticket changes per conversation, so "always bundle" would mean guessing a parent. The checkbox appears for *One ticket each* and is replaced by that explanation for *One ticket, the rest attached*.
- **[New]** **The entry screen states what the saved preferences will do, before the button acts on them** — the label becomes **Create 2 tickets now**, the note reads "2 tickets filed immediately — no questions, per your saved preferences", and an **One-click** chip marks the state. Nothing changes behaviour silently.
- **[New]** **The Preferences screen states the consequence in prose** for the current combination, including the one case that files tickets with nothing shown first, and keeps *Ask each time* as a first-class option so turning the questions back on is one tap. **Reset** returns to asking.
- **[New]** **The rail gained "New selection (keeps preferences)"** — the demonstration that matters: the selection changes, the preferences do not, so the same button takes a different path. "Reset flow & clear preferences" is the reviewer's way back to a first run.
- **[Fix]** **Rows in the picker lists overflowed the pane.** `text-overflow: ellipsis` does not apply to an inline box, and those rows are built from `<span>`s while the message rows are built from `<div>`s — so a nowrap subject ran straight out of the 360px pane wherever a `<span>` was used. `msg-who` and `msg-sub` are now `display: block`, so the ellipsis works whichever tag builds the row. Found by measuring rather than by looking.
- **Not implemented.** This is the mockup only; no part of the flow or the preferences is in the add-in.
- **Rollback:** the mockup is a standalone file that nothing references at runtime, and preferences live only in that browser's `localStorage` under `c7ntax.addin.mockup.prefs` — clearing it, or pressing **Reset flow & clear preferences**, restores a first run.
- **Verification:** driven in the browser end to end — first run asks both questions; ticking *Remember this answer* on each and then pressing **New selection** produces `Create 2 tickets now` with the **One-click** chip, and pressing it files two tickets **with no sheet shown at all**; the preference survives a page reload; the Preferences screen renders the saved radio states and the correct outcome sentence, and **Reset** returns the entry screen to "You'll be asked whether to review it first." and "Nothing saved yet." No console errors, and **no screen overflows the pane** — measured across the entry screens for one, three and five messages, both sheets, the bundling step and the preferences screen, which is the check that found the ellipsis defect.

---

## 2026.10.7.032 — The add-in endpoint was dead, and a mockup for the flow that replaces it

Started on a design mockup and found, on the way in, that the endpoint the mockup is about had been returning 404 for every request since the switch moved areas.

- **[Fix]** **`POST /api/outlook-addin/tickets` answered `404 "Outlook add-in disabled"` unconditionally.** `routes/outlookAddin.ts` read `configFlag("integrations", "outlookAddin")`, and the field moved from `integrations` to `apps` (Client Apps & Notifications) in 2026.10.7.030. `configValue` answers `""` for a field the registry does not declare, `configFlag` reads that as `false`, and the gate therefore failed **closed** — the taskpane was served, every screen said the feature was on, and the only thing that could actually create a ticket was unreachable. Confirmed live: `404 {"error":"Outlook add-in disabled"}` before, `201 {"created":1, … "ticketNumber":"MSP-1001-1001"}` after.
- **[New]** **`scripts/check-config-reads.mts`** (`pnpm guard:config`) fails when any `configFlag`/`configText`/`configNumber` call names a field the registry does not declare, and names the area a missing field actually lives in. It reads the **real registry** rather than restating it — it runs through `tsx`, because `packages/shared` is TypeScript source with extensionless imports and plain `node` cannot load it. The sweep that found this bug found **exactly one** stale read across 43; the same sweep now passes, and re-introducing the stale area makes it fail.
- **[New]** **`docs/mockups/outlook-addin-ticket-flow.html`** — an interactive design mockup of the flow for creating tickets from one or several selected messages. Self-contained, no build step, no API calls: a simulation rail for the selection (1, 3, or 5 messages) and the Outlook theme, the taskpane at its real 360px width inside a suggestion of Outlook's chrome, and per-screen design notes for review. Covers:
  - **Several messages:** a sheet asking *one ticket each* or *one ticket with the rest attached*, each option stating its outcome in tickets rather than in prose, and nothing proceeding until the choice is actually made.
  - **Bundling:** pick which message becomes the ticket (its subject, body and contact become the ticket's) and which of the others ride along as attachments, independently of that choice.
  - **The preview question:** a sheet asking whether to review before anything is submitted, with "Create now" left one click away so the review is not a tax on speed.
  - **The review:** every field the server will fill in shown as an editable field — board, client, contact, subject, description, priority, read-only source — with matches stated in green and **unmatched senders in amber**, which is the failure the screen exists to catch. Several tickets collapse to summary rows with one open at a time, because a 360px pane cannot hold five forms.
  - **The result:** per-message outcomes, since "3 created" does not say which of the user's messages was already done — skipped rows carry their reason.
- **Not implemented.** The mockup is a design artifact; no part of the new flow is in the add-in yet.
- **Rollback:** the endpoint fix is one string, and `guard:config` is additive — removing its `package.json` line and the script leaves everything else untouched. The mockup is a standalone file nothing references at runtime.
- **Verification:** the endpoint was exercised live against the running API — 404 before the fix, 400 `boardId required` after the middleware passed, and **201 with a real ticket (`MSP-1001-1001`)** on a real board. `guard:config` reports 43 reads across 133 files with none stale, and was run against the unfixed code, where it reported exactly `integrations.outlookAddin` read by `src/routes/outlookAddin.ts`. The mockup was driven in the browser through all three scenarios and both branches: single-email (skips the bundle question), 3-message bundled, and 5-message individual with unmatched senders; Back was checked to return to the entry screen in individual mode and to the bundling step in bundled mode, "Create now" was checked to skip the review entirely, the dark theme was checked to apply, and **no screen overflows the pane** (measured, since a layout break is what a screenshot would have shown). No console errors. API typecheck 150, the pre-existing baseline.

---

## 2026.10.7.031 — The Outlook add-in becomes installable: a generated manifest, a Windows installer, and a C7NC section

The add-in's code was finished months ago. Measuring the distance between that and a technician being able to use it found three separate faults, and the first one meant the documented instructions could not work at all.

- **[Fix]** **The manifest the server handed out could never load.** `apps/outlook-addin/manifest.xml` carries two placeholders — `__ADDIN_HOST__` for the origin and `__ADDIN_GUID__` for the identity Office knows the add-in by — and nothing replaced them. `/addin` is served straight off disk by `express.static`, so `GET /addin/manifest.xml` returned the file **with the placeholders still in it**. Office requires absolute URLs, and it reports a manifest it cannot parse by simply not showing the add-in: anyone following the README got silence. The manifest is now **generated** for the origin in force, and the raw file can no longer reach a client.
- **[New]** **`services/addinPackage.ts`** decides both placeholders once — the origin from `PUBLIC_BASE_URL` or the request's own host, the identity from `OUTLOOK_ADDIN_GUID` or a fixed default — and is used by the served manifest, the installer build and the deployment report, so the three cannot describe different deployments. The identity is **fixed rather than generated**: Office treats a new GUID as a different add-in, so regenerating it would strand every mailbox that had already sideloaded the previous one.
- **[New]** **A per-user Windows installer.** `installer/outlook-addin/build.ps1` fetches the resolved manifest from a running server, reads the version from `BuildNotes.md`, and compiles a WiX MSI that copies the manifest into `%LOCALAPPDATA%\C7NTAX\OutlookAddIn` and writes the `HKCU` registration Office reads. It is **per-user and needs no administrator** — not a preference: the registration lives in the signed-in user's hive, so a machine-wide package writes a hive Office is not reading and appears to work only for whoever ran the install. The value is written as **`REG_SZ`**, because Office does not follow `REG_EXPAND_SZ` here and the wrong type registers an add-in that never appears.
- **[New]** **The manifest comes from the server when building, not from a substitution in the script.** The API is the only thing that knows both the deployment's origin and the add-in identity in force, so the installer and the manifest a user downloads by hand cannot disagree. The consequence is stated rather than hidden — the installer is valid for **one origin** — and the application detects the mismatch and shows the rebuild command instead of quietly offering a package that opens an empty pane.
- **[Update]** **Windows Installer cannot hold a four-digit year**, so the version is mapped: `2026.10.7.031` becomes `26.10.7031` (`YY.M.PPPP`). Every field stays in range and the order stays monotonic as the changelog advances; a version that ordered builds incorrectly would break the upgrade rule, and the symptom would be an upgrade that silently did nothing. The true version is kept in `build.json`, the artifact's filename, and the interface.
- **[New]** **Three public, flag-gated download routes** alongside the taskpane: the generated manifest, a JSON descriptor of the artifact, and the installer itself under its versioned name or the versionless alias `C7NTAX-OutlookAddIn.msi`. They are public because the taskpane already is and the install button should be a plain link, and they follow the same `apps.outlookAddin` switch — offering a package for a switched-off add-in would install a button that answers 404.
- **[New]** **A JSON descriptor rather than a HEAD probe.** The page first asked with `HEAD` and read the status. A probe that fails for any transient reason would have asserted that no installer exists — a false claim about a file sitting right there. Asking once for a description means the page can be wrong about *when*, never about *whether*.
- **[New]** **C7NC → Outlook Add-in**, a new top-level navigation section for the companion clients. The page offers all three installation routes — the installer, a manual sideload, and centralized deployment — with the conditions each one needs, the silent-install and uninstall commands, troubleshooting, and the deployment facts for an administrator including a **warning and the rebuild command when the installer was built for another server**. It carries **no permission** and degrades to a single explanatory card when the admin-only deployment report answers 403, so a technician who cannot read deployment detail can still install the add-in. It sits at the top level rather than under Administration because these are things a *user* installs on their own machine, and burying that behind a settings screen would make it an administrator's task by accident.
- **[New]** **`O365/New-C7NTAXMailboxApp.ps1`** — PLAN-017's runbook of portal clicks as Graph REST. Device-code sign-in with Microsoft's own Graph command-line client (no module, no `az`), create or reuse the registration, request `Mail.ReadWrite` as an application role and/or the delegated scopes, create the service principal, **grant admin consent** by app-role assignment and permission grant, create the client secret once into a git-ignored file, and print the Exchange Online RBAC commands that scope the app to one mailbox. That last step prints rather than runs, because those are Exchange cmdlets and not Graph, and because scoping is what turns a tenant-wide reader into a mailbox reader — it deserves to be deliberate. `O365/README.md` explains the two flows, the prerequisites and the failures worth naming.
- **[New]** **`PlanDocs/PLAN-022-Outlook-Add-in-Packaging-and-Distribution.md`** records the design, the thirteen decisions — including two rejections (`util:XmlFile` URL rewriting at install time, and a rebuild endpoint on the production API) — and what is left.
- **[Fix]** **A rebuilt installer could not reach anybody.** The service worker cached `/addin/*` in its cache-first branch, so a downloaded installer would come back out of a cache after being rebuilt. It now bypasses `/addin/` exactly as it bypasses `/api/`, and the cache name is bumped so an already-stored copy is retired. The Vite dev server also proxies `/addin` now, so the download link resolves same-origin in development as it does in a deployment.
- **[Update]** **The Help no longer describes the broken path.** The Outlook add-in walkthrough documented sideloading "the manifest that ships in the repository" — the file with the placeholder in it — and now covers the install page, the three routes, and the Outlook restart. Two FAQ entries warn about the two failures that look like breakage: an installer built for another server, and a manifest taken from the repository instead of from the page.
- **Rollback:** the add-in switch already turns the whole feature off, downloads included, and takes effect without a restart. Removing the installer is `msiexec /x`, which takes the manifest and the registration with it. The manifest route can be disabled independently by deleting `routes/addin.ts`'s mount and returning `/addin` to `express.static`.
- **Verification:** the MSI was **installed and uninstalled on this machine** — files landed in `%LOCALAPPDATA%`, the installed manifest contained zero placeholders, and the registry value existed with kind `String` (`REG_SZ`) and the correct path; uninstall exited 0 and removed the file, the value and the folder. `GET /addin/manifest.xml` returns 200 with **zero** placeholders and every URL on the request's origin. The installer downloads through the API and through the Vite proxy with a body matching `build.json`'s SHA-256, and unknown names plus `..%2f` and `%2e%2e%2f` traversal all return 404 — the route matches only the artifact name in `build.json`, so a path never reaches the filesystem. `/system/deployment` reports `matchesOrigin: true`. In the browser the C7NC nav entry, the page's live facts, the section landing card and both download links were checked. Web typecheck 0; API typecheck 150, the pre-existing baseline; route guards 389/343/0; help links 75/20/44.

---

## 2026.10.7.030 — The Outlook add-in switch is in the UI, and it governs the whole feature

Found on the way to a switch that already existed: it was buried in the wrong place, it only covered half the feature, and a service worker made it look broken.

- **[Fix]** **The add-in's taskpane ignored the setting.** `OUTLOOK_ADDIN_ENABLED` was read **once at module load** in `index.ts` to decide whether to mount the taskpane at `/addin`, while the setting governed only the endpoint. So switching the add-in off in the UI left the taskpane being served, and a restart was the only way to change it — which the Help then documented as the way to turn it on. The mount now checks the setting **per request**, so one switch governs both halves: off, the taskpane and the endpoint both answer 404, and a mailbox that already has the add-in sideloaded is told the server does not support it rather than failing halfway through filing a message.
- **[Update]** **The switch moved where it can be found.** It sat under *CloudConnect, Email & Microsoft 365*, where nobody looking for the Outlook add-in would think to look. It is now the first field under **Client Apps & Notifications**, the area for the companion clients a deployment serves, and that area's own summary names it. Administration → System Settings also gained a **shortcut row** naming the add-in, the customer portal, monitors, email connectors, sessions and billing, so the screen people go to first now points at them instead of leaving them to be found.
- **[Fix]** **System Settings claimed the add-in was fine when it was not.** The row was hardcoded to "configured" and read the raw environment variable, so it contradicted the switch it was supposed to be reporting. It now reports the **value in force**, whether the taskpane's files exist at all (the difference between "switched off" and "cannot be switched on"), and links straight to the switch — **Switch the add-in off / on**.
- **[Fix]** **A cached cross-origin error made a working feature look broken.** Verifying the switch by hand, the taskpane kept returning 404 in the browser after it was switched back on, while a command-line request to the same URL returned 200. The cause was the PWA service worker: it treated **any** GET as its own business, so a fetch of `http://…:4000/addin/taskpane.html` from a page it controls was cached **by URL alone** — including the 404 — and the cache-first branch replayed that 404 for ever after. A live feature looked dead because its error had been cached. The worker now ignores requests whose origin is not its own, and **never stores a response that was not successful**, so a transient error can no longer become permanent. Cache name bumped to `C7NTAX-v4` so an already-cached cross-origin response is retired.
- **[Fix]** **Nine Help instructions told people to set an environment variable and restart** for flags that have been settings since 2026.10.7.029 — the Outlook add-in, uptime monitors, alert webhooks, AI actions, time rules, Graph delivery, SSO and passkeys, plus two "turn it off with `X=false`" notes. Each now names the switch's own label and the area it lives under, and the two that genuinely still need a deployment value (the WebAuthn relying-party id, the SSO issuer) say so separately from the switch.
- **[New]** **`services/addinAssets.ts`** holds where the taskpane lives. The server that mounts `/addin` and the deployment report that says whether it *can* be served need the same answer, and the first attempt at writing it twice got the directory depth wrong from one of them — so `assetsPresent` reported `false` while the pane was being served.
- **[Fix]** **A setting's description was printing its own emphasis marks.** `detail` is rendered as plain text on the configuration cards, so the one field whose text used `**` showed the asterisks. The text is plain now, and the field's own doc comment says so — the Help renders those marks, a settings card does not, and putting them there is a defect rather than emphasis.
- **Rollback:** `OUTLOOK_ADDIN_ENABLED=false` in the environment remains the fallback for a deployment that cannot use the screen, and clearing the setting restores it. The service-worker change only narrows what is cached.
- **Verification:** `probe-configuration.mjs` **87 passed, 0 failed** (nine new assertions, including that switching the add-in off makes the **taskpane** answer 404 and switching it back on serves it again with no restart). API typecheck 150, below the 151 pre-existing baseline; web typecheck 0. Route guards 389/343/0; help links 74/20/43. In the browser, the switch toggled true → false → true with the taskpane at 200 → 404 → 200, the cache bucket read `C7NTAX-v4`, and all eight configuration areas were checked for a literal inline mark and had none.

---

## 2026.10.7.029 — Configuration stops being a form: one registry, one screen, and the customer portal's own section

The measurement came first, and it is the reason for the change. Of the roughly thirty controls on Administration → System Settings, **exactly one was read by anything** — the right-click-menu preference. The others wrote into an `app_settings` row nothing looked at, including a **Session Timeout** control whose value was never consulted: the idle timeout the server enforces lives in a different key entirely, set from My Settings. Eighteen features added during the implementation programme were switched on and off by environment variables with no screen anywhere, four shipped pages had routes and no navigation entry, and `/system/config/:key` was defined three times with the second and third copies — two of which omitted the write guard — unreachable dead code.

- **[New]** **One declaration, both ends.** `packages/shared/src/appConfiguration.ts` describes every configurable thing in the product once: its label and what it changes, whether it is a setting or a deployment fact, the environment variable it stands in for **and how that variable was read**, the value it falls back to, its range or choices, whether it needs a restart, and which screens it affects. The API validates writes against it and the screen draws itself from it, so **a field that does nothing cannot be drawn** — the drift that produced the old screens is no longer possible without deleting a declaration.
- **[New]** **A value is decided in one order, and the old one still wins.** A saved setting, then the deployment's environment variable, then the documented default. Every flag's original test is reproduced exactly — including whether it shipped on and was turned off with `false`, or shipped off and was turned on with `true` — so a deployment configured the old way behaves identically. The probe suite asserts both directions across all 21 boolean flags.
- **[New]** **Eighteen flags became settings, and take effect immediately.** The customer portal, uptime monitors, alert webhooks, the social outage source, knowledge-base drafting and its model, M365 offboarding, CloudConnect live verification and its throttle, the email connectors, Graph delivery, the Outlook add-in, AI actions, bill-through batch invoicing, the time rules, quotes, push notifications, bill-from-tickets and the session switch are all configurable from the screen — no restart. Two (the alert poll interval and the stale ceiling) are sampled once by the monitor as it starts and say **Needs a restart**.
- **[New]** **Administration → Configuration**, a hub over eight areas: Workspace, Sessions & Security, Customer Portal, Service Alerts & Monitoring, Knowledge Base & AI, CloudConnect/Email/Microsoft 365, Billing & Invoicing, and Client Apps. Each field shows its value, what the deployment's own value is, whether one is overriding the other, what it changes, and — where a saved value is shadowing the deployment — a **Use the deployment's value** control to let it go. There is no Save button; a switch applies on click and a field applies when it is left.
- **[New]** **Administration → Customer Portal**, the section the request was for. The portal's limits were module constants and its behaviour was fixed; each is now a setting — code lifetime, attempts per code, codes per customer per window and the window itself, session lifetime, signed-in devices — alongside **which tickets a customer sees** (only their own, or every ticket at their client), **whether they may raise and reply**, the board their tickets land on, and branding (accent, logo, welcome line, support address) **shown against a live preview**. Below it: a per-client access table with each client's usable-contact count, and the last 25 portal sessions with their state.
  - The narrow visibility default is kept, and the reason is stated on the field: a client with three hundred employees should not have each of them reading the others' tickets. Company-wide access exists because a one-mailbox small business is a real customer of this product, and the provider — not the code — should decide.
- **[New]** **`GET /api/portal/branding`**, unauthenticated and identical for every visitor, so the **sign-in page** wears the configured name and accent rather than the product's own. The portal's welcome line, support address, and the two permission switches travel with the customer's identity so a button that would be refused is never drawn.
- **[Fix]** **The personal landing page is personal again.** My Settings was writing the **instance-wide** `default_landing_page` key, so one person's preference silently became everyone's. `User.landingPage` is a new column, set through `PATCH /auth/me/landing-page`; sign-in resolves the person's own choice, then the instance default, then the dashboard. Choosing the dashboard clears the override rather than storing one, so a later change to the instance default still reaches everyone who never chose.
- **[Fix]** **The idle timeout is not a personal preference either.** My Settings now shows it read-only to anyone without the configuration permission, and routes administrators through the validated endpoint — the same 5–480 range the configuration screen enforces. The standalone self-service write to a global policy is gone.
- **[Fix]** **Administration → System Settings is honest.** Company name, time zone, date format, SMTP credentials, password policy, API keys, the connection string, the backup schedule and the retention policy — none of which anything read — are removed as controls. What replaced them is **`GET /api/system/deployment`**: whether a mail relay answers (host, port, TLS, whether credentials are set, the from address), the database host and name **with the credentials stripped**, the runtime, and where the Outlook add-in is served from. The screen reports the self-healing poller and its recovery history, and then points at every setting. It has nothing to save.
- **[Fix]** **Four shipped features were unreachable.** Quotes (under Billing), Uptime Monitors and Alert Webhooks (under Administration) and AI Actions had routes and no navigation entry, so they could only be reached by typing a URL. They are in the navigation now.
- **[Fix]** **A latent security hole removed with the duplication.** `/system/config/:key` was defined three times; Express takes the first match, so the second and third `PATCH` handlers never ran — and two of them did not call the write guard. Deleting the duplicates also closed that, and the survivor now refuses any registry-owned key so those rows have exactly one way in, through the endpoint that checks the section's permission and validates the value.
- **[New]** **Deployment-owned values are reported, never editable.** An outbound credential, a connection string, and the two switches that decide **whether authentication is enforced at all** (`SESSION_AUTH_ENABLED`, marked required, and `AUTH_HARDENING_ENABLED`, which controls lockout and token lifetime) appear under **Set by the deployment** with the variable that owns them. A configuration screen that could turn off account lockout from a browser session would be a privilege-escalation path with a friendly label.
- **[New]** **`apps/api/probe-configuration.mjs` — 78 assertions.** Resolution order, the polarity of every converted flag in both directions, validation (choices, ranges, colours, clock times, unknown fields, unknown areas, deployment-owned fields, required fields), the general key-value route refusing a registry row, per-client access and branding, permissions per area, and that nothing the suite changed is left behind.
- **Rollback:** each flag's environment variable is still the fallback, so setting one back — or clearing the setting with **Use the deployment's value** — restores the previous behaviour with no migration. The schema change is a single nullable column.
- **Verification:** probe **78 passed, 0 failed**. API typecheck 150 errors, **below the 151 pre-existing baseline**, none in a changed file; web typecheck 0. `check-route-guards.mjs` 388 routes / 342 guarded / 0 violations; `check-help-links.mjs` 74 routes / 20 walkthroughs / 42 links; the design-token guard lost four files and gained none. In the browser, 19 routes with zero console errors and no blank pages, and the accent colour set on the portal screen was observed on the customer-facing sign-in button (`rgb(185, 28, 28)`) before being cleared. Every setting changed during verification was returned to its found state.
- **Two decisions recorded, not taken:** the alert poll interval waits for a restart rather than rescheduling a running timer, because the interval also defines the shortest life an alert may have; and `app_settings` is shared rather than retired, because the SPA reads the right-click-menu preference from that exact address.

---

## 2026.10.7.028 — The Help section catches up with the product, and stops being able to drift
- **[New]** **Six walkthroughs the product had been shipping without.** The Help section documented two dozen shipped changes as if they had not happened. It now covers the **Product Catalog** (types, the fields, cost versus sell price and who is allowed to see which, stock and reordering, the four surfaces that price from it, and why an item is retired rather than deleted); **Reporting & Business Reviews** (the five reporting areas, all nine standard reports and what each answers, how to read one, and the review pack at three cadences); the **Customer Portal** (turning it on, granting a client access, the emailed six-digit code, exactly what a customer can and cannot see, and why a ticket that is not theirs answers 404); **Expenses & Accounting Sync** (filing against a ticket, approval and the required reason for a rejection, how an expense reaches an invoice, and the push to accounting); the **Knowledge Base & AI drafts** (a draft never publishes itself, and says it was machine-written and which ticket it came from); and **M365 Inactivity & Offboarding** (the report, the checklist, and the deliberate refusal to disable anything).
- **[Fix]** **The configuration reference was wrong about the feature flags — in both directions.** The old table said every flag defaulted off; most of them now **ship on and are turned off with `false`**, and a handful still ship off. Six flags the product reads were missing entirely (`INVOICE_BATCH_ENABLED`, `KB_AUTOGEN_ENABLED`, `M365_OFFBOARD_ENABLED`, `CLOUDCONNECT_LIVE_STATUS_ENABLED`, `SERVICE_ALERTS_SOCIAL_ENABLED`, `PORTAL_ENABLED`), and `AUTH_HARDENING_ENABLED` was described as "15-min JWT + rehash-on-login" when it also enables the **lockout after 5 failed sign-ins** and the forced password change. The table is rebuilt from the deployment's own environment template — 21 flags, each with what it gates and which way it defaults — and the two conventions are now stated instead of assumed.
- **[Fix]** **The custom-report walkthrough described a builder that no longer exists.** It still said to pick a type from `ticket_summary` / `revenue` / `custom` and paste a config object. It now documents the designed report: what a band is, the seven element types, dragging and resizing in millimetres, the expression language and the palette that inserts into the expression you are typing in, totals and their three scopes, **running totals that survive a page break**, **charts**, **sub-reports** (including that a binding cannot read `Fields`, and why), the Design/Preview/Data tabs, the four exports, and scheduling.
- **[Update]** **The identity walkthrough became a session walkthrough.** Sign-in is a cookie session, not a token, and the product's most visible behaviour — being signed out mid-task — was not documented at all. It now covers the **30-minute idle default** (editable 5–480 minutes under Settings), the 12-hour ceiling, the **one-minute countdown warning with "Stay signed in"**, the fact that **administrators never idle out**, why the desktop shell and add-in have no such clock, TOTP enrolment and the refusal of a code from a foreign QR, passkey management, what hardening actually does, and the single-account **test exemption** that refuses to run in production.
- **[Update]** **Service Alerts, billing and the workspace were brought up to date.** Service Alerts now documents the **crimson count in the navigation** an outage is visible from anywhere in the product through, and the **Outage Board** — problems sorted to the top, each with its most recent observation, refreshing only while the tab is visible — plus the anti-flap rule and the fact that social chatter can only ever raise a notice. Billing gained the correct overtime rule (minutes after the **agreement's** cut-off, at the agreement's multiplier, 1.5:1 towards block and Cyber Care allowances, all behind `TIME_RULES_ENABLED` which ships off) and the **bill-through batch**: preview, hold, approve, reject — and why it cannot double-bill. Quotes now documents pricing from the catalog, and the workspace walkthrough gained **dashboard personalisation** (reorder, S/M/L, hide, reset, saved to your account) and the **⌘K command palette**.
- **[Update]** **Getting started, the FAQ and the Index were rebuilt rather than patched.** Getting started has a table of what each navigation area holds — so "where would I find that" has an answer — plus the session behaviour on first sign-in. The FAQ doubled, with a question for each thing a user has actually asked about: why a session ended, why a colleague is never timed out, whether the batch can double-bill, why a product cannot be deleted, why a report says a figure is unknown, how a customer signs in, and whether a departure disables anything. The Index is regrouped around ten areas with a row per topic.
- **[Fix]** **A dead field that had already started lying.** Every help section carried an `anchors` array that nothing rendered — the "On this page" menu is derived from the headings — so the new sections' anchors named headings that did not exist and nobody could tell. Removed, along with the type that declared it; the sidebar is unchanged, because it was never reading it. The four core pages also looked themselves up by **array position** (`HELP_SECTIONS[0]`), which would have silently swapped pages if the array were ever reordered; they look themselves up by id now.
- **[Fix]** **Bold and inline code rendered as literal asterisks and backticks.** The block renderer printed text as written, so the newly written emphasis — 93 bold marks and 10 inline-code marks naming buttons, flags and paths — appeared as `**New item**` on screen. The renderer now understands `**bold**` and `` `code` `` in paragraphs, steps, notes, tips, warnings and table cells, so a sentence can say which words are the button.
- **[New]** **`scripts/check-help-links.mjs` — the rule, made checkable.** The maintenance rule ("update Help in the same change") was a comment nobody could enforce, and the help section had drifted two dozen releases behind precisely because of that. The script reads the source and fails when a help link points at a route the router does not serve, or a walkthrough is missing from the Index — the two ways hand-written documentation rots. It runs in about a second, and `.github/copilot-instructions.md` now carries the rule so a future change to a feature, a flag or a default is expected to carry its Help update with it.
- **Verification:** `scripts/check-help-links.mjs` — **71 routes, 19 walkthroughs, 38 internal links, 0 problems**. In the browser, all **25** help URLs (the home page, 23 sections, and a deliberately stale slug): zero console or page errors, zero routes rendering nothing, zero literal markdown left on screen, 93 bold runs, 10 inline-code runs and 24 tables rendering; every page's sidebar "On this page" list matched its heading count exactly; the Index showed all ten topic groups and 22 topic links; each of the 19 walkthroughs is listed on the help home page; and a stale `/help/walkthroughs/<gone>` link now says the walkthrough has moved and points at the Index instead of showing an empty page. Web typecheck 0. The session-timeout behaviour was also observed live — an expired session returned to sign-in with "Your session ended. Sign in to continue.", which is what the new walkthrough says it does.
- **Rollback:** revert the commit. **Documentation and one guard script** — no product behaviour changes except two renderer fixes (inline emphasis, and the stale-link message) and the removal of a field nothing read.

---

## 2026.10.7.027 — Charts, sub-reports and running totals: the last of the report designer
- **[New]** **Charts are elements a report can hold.** A **Chart** element draws a **column, bar, line, pie or donut** from the report's own rows: pick the field that groups the rows into categories, the field to fold inside them, and how to fold it (`SUM`, `COUNT`, `AVG`, `MIN`, `MAX`, `COUNTD`) over the **report**, the current **group** or the current **page**. A chart is designed against real numbers — the canvas draws it live from the preview's rows — and can carry a title, values on the bars, a legend, and a cut-off after which the tail is folded into one labelled `Other (n)` bar so the axis stays readable. A chart too small for an axis and a legend (below about 40×30mm) warns while it is still being designed rather than printing as a smudge.
- **[New]** **The chart's geometry is computed once, in millimetres, and everything reads it.** `layoutChart` turns labels and values into placed bars, points, grid lines, axes, slices and labels — including every piece of text, with its baseline — so the preview, the print window and the PDF cannot disagree about what the chart looks like. The screen draws that geometry as SVG (one `chartSvg` also used by the print document) and the PDF draws it with jsPDF's own primitives — rectangles, lines, triangles for the pie's arcs, and real text — so a printed chart stays vector-crisp rather than being a rasterised screenshot. Labels sit on the baseline the engine chose, which is what makes the screen and the PDF place text in the same spot.
- **[New]** **Sub-reports print a saved report inside another one.** A **Sub-report** element names another saved designed report and flows its bands **onto the parent's pages** — because that is what keeps the parent's page count, page numbering and row count intact. The child brings its own title and column captions inline once, repeats them after a page break, runs its own data source, and reads the parent's `Page.*` context, so the parent's page footer still says `Page 1 of 2` when the child is what made it two pages. Parameters are bound from the parent's own parameters (`Parameters.status`), worked out **once** before the child's rows are fetched — a binding cannot read `Fields`, and the validator refuses one that tries, because there would be no row to read yet. Sub-reports nest up to three deep, a report that prints itself is skipped with a note rather than looped, and the child's rows are fetched once rather than once per parent row. A reference that cannot resolve is refused on save with a message that names the report; and if the parent is laid out without a resolution at all — which is what the designer's own preview does while a child is being fixed — the engine prints a placeholder, not a refusal.
- **[New]** **Running totals that survive a page break.** `RUNNINGSUM`, `RUNNINGAVG` and `RUNNINGCOUNT` are aggregates the engine keeps as it walks the rows, so they carry over a page boundary by construction: the first row of page two continues where page one left off, and the last row equals the report's own total. Scoped to a group — by name (`'status'`) or as `'group'` for the innermost one — a running total restarts the moment that group opens, which is why a group footer reads its group's total through its last row. `'page'` is refused: a running total that restarted every page would not be one. Scope is checked while the report is being designed, with a warning when a running total is put where it can only read as nothing.
- **[Update]** **The engine flows one *section* at a time, so two documents can be in flight at once.** Pages, the deferred-value patch pass and the issue log are shared; the rows, grouping, sorted keys and running totals belong to the document being flowed. That is the whole mechanism behind a sub-report — it is a second document flowing into the pages that already exist, with a horizontal offset and no page of its own — and it is why the parent's numbers are untouched. A band that holds a sub-report grows to hold it, and a child that runs past the bottom of the page moves the flow onto a new one, which the parent sees as a page it used rather than one it lost count of.
- **[Update]** **The runner's catalog publishes what the designer now offers**: the five chart kinds, the six folding functions, and the saved designed reports a sub-report element may point at — with the parameters each needs, so a binding can be filled in by name. The reference list is cached for a few seconds and dropped whenever a report is written, so the picker is not stale but the designer's live validation is not a query per keystroke.
- **[Fix]** **`Page.totalPages` was wrong in a report containing a sub-report.** The footer is resolved after pagination from the pages that exist *at the end*, and a child that added pages used to be invisible to it — a footer could read "Page 1 of 2" on both pages. Every page's footer now counts every page, and the probe asserts it page by page rather than once.
- **[Update]** **The designer's palette and property grid cover both new elements.** Chart offers its kind with a one-line description, title, category and value fields with the same expression builder as everything else, the folding function, the scope, the category cut-off, values on the bars and the legend. Sub-report offers the saved report by name and one expression box per parameter the chosen report declares, with required ones marked — and the canvas shows the chart it will actually draw, and the sub-report's name where it will print.
- **[New]** **`apps/api/probe-report-designer.mjs` now carries 349 assertions, all green** — 124 of them new for this phase: that a chart's bars add up to the total of the rows and every bar is inside its box, that a pie's slices sweep exactly one turn and a negative value is drawn below the baseline rather than as a positive bar, that a chart's category expression cannot contain a set-based function, that a running total reaches the report's total at the last row and does not restart at the top of page two, that a group-scoped one restarts at each group, that a sub-report's rows print once each and carry their own section, that a child longer than the page adds pages and the parent's footer counts every one of them, that a report pointing at itself is skipped rather than looped, and that a five-deep chain of sub-reports stops at the cap with a note. The two neighbouring suites stay green (`probe-reports-standard.mjs` 131, `probe-reports.mjs` 29) and the API's type-check baseline is unchanged.
- **[Update]** `PlanDocs/PLAN-020-Custom-Report-Designer.md` marks **phase 6 complete**, which closes the plan — every phase of the custom report designer is now built, with multi-tenant the only item still outstanding elsewhere in the programme.
- **Verification:** `probe-report-designer.mjs` **349/349** (run with `npx tsx`); `probe-reports-standard.mjs` **131/131** and `probe-reports.mjs` **29/29** unchanged after the engine refactor, which is the evidence that flowing one section at a time did not change any existing report; API typecheck at its **151 pre-existing errors** with none in the changed files; web typecheck 0; shared typecheck 0. In the browser, on a fresh designed report: the palette offering **Chart** and **Sub-report** and a **Running (3)** function group; a chart added and configured (`Fields.category` by `SUM(Fields.amount)`) drawing **live in the canvas** from the real rows — axis ticks 0/37.5/75/113/150 and two bars — then switching to a **pie** and rendering two slices per chart in the **Preview** tab (3 charts, 6 slices, 1 page); the sub-report inspector listing the saved designed reports by name; a sub-report added and pointed at one, which the canvas showed by name with **"No problems"** and which moved the flow from 1 page to 2 with the footer reading **"Page 1 of 2"**; the **Print** document carrying the chart's SVG; and **PDF** exporting with no error toast and no console error. The report was then saved, run from Custom Reports, and the viewer laid it out as **2 pages / 3 charts / 6 slices** with the footers reading "Page 1 of 2" and "Page 2 of 2" — the exit condition of the phase, seen end to end.
- **Rollback:** revert the commit. **Nothing is migrated and no stored document changes meaning**: a chart and a sub-report are new element types that an older build's `normaliseElement` drops back to a text element rather than misreading, `RUNNINGSUM` and its two siblings are new functions that only appear if a report is written to use them, and a `LaidOutBand` gained an optional `section` field. Existing reports, custom reports and standard reports are untouched — which the two neighbouring probe suites re-assert at 131/131 and 29/29.


- **[New]** **The banded report designer is built here, as PLAN-020 recommended — not embedded.** A report is now a **document**: page setup, data sources, parameters, groups and **nine band kinds** (Report Title, Page Header, Column Header, Group Header, Data, Group Footer, Column Footer, Page Footer, Report Summary), each holding absolutely-positioned elements — text, field, total, line, box and image. It is stored as a normal `Report` of type `template`, so a designed report lists, runs, exports, schedules, duplicates and deletes beside every other saved report. Reachable from **Custom Reports → New designed report**, which offers four starter layouts (blank page, simple list, grouped list with totals, summary with grand totals) built from the chosen source's own catalog.
- **[New]** **An expression language, written here rather than borrowed.** Tokeniser → parser → fixed AST → interpreter: arithmetic, text, dates, comparisons, `AND`/`OR`/`NOT`, `IN`, `LIKE`, `IF`, `COALESCE`, and **40 functions** across Aggregate, Math, Text, Date, Logical, Format and Value. Six aggregates (`SUM`, `AVG`, `MIN`, `MAX`, `COUNT`, `COUNTD`) take a scope — **report**, **group** or **page** — and the page scope is resolved *after* pagination, which is why a page total is the total of the rows on that page rather than of the rows that happened to exist when it was drawn. Text elements interpolate `{{ … }}` holes, so a caption reads "Client: {{Fields.client}}".
- **[New]** **One layout engine, and every output reads its result.** `layoutReport` sorts and groups the rows, then flows the bands onto pages: repeated page and column headers, group headers that repeat after a break, `keepTogether` groups that move to a page with room for them, page breaks before a band, bottom-anchored footers, and text wrapped to the millimetre and clipped to its box. The screen, the print window and the **PDF** draw the same placed lines — jsPDF in millimetres, so a placed line needs no conversion — and **Excel/CSV** take one row per data band with the group each row belongs to. All four were verified: Excel 27.6 KB, CSV 5.0 KB, PDF 58.5 KB, and a print document with the report's own pages.
- **[New]** **A canvas, a palette and a property grid.** Bands are stacked in the order they print, at the page's real width and margins, so horizontal positions on the canvas are the positions on the page. Elements are dragged and resized in millimetres with millimetre snapping (Alt for a quarter), clamped to their band; arrows nudge, Shift+arrows move 5mm, Delete removes, Ctrl+D duplicates, Ctrl+Z/Ctrl+Shift+Z undo and redo, Ctrl+S saves. The palette inserts fields, parameters, built-ins (`Page.number`, `Page.totalPages`, `Report.name`, `Group.value`, …) and functions **into the expression you were last typing in** — with the caret landing inside a function's brackets — or appends to the selected element, or adds a new element to the selected band, and the line at the top says which. The Design tab shows each element with its **real value** from the preview; the Preview tab shows the paginated pages; the Data tab shows the rows and lets parameters and the period be set.
- **[Fix]** **"Is empty" and "is not empty" were a 500 on almost every field.** The custom-report runner translated both operators into a Prisma null comparison whatever the column was — and Prisma refuses a null filter on a column that cannot be null (`Argument must not be null`), which is most of them, and refuses `not` on a relation entirely. Each field now declares whether it can be empty and whether it is a relation: a nullable scalar filters `null`/`{ not: null }`, a nullable relation `{ is: null }`/`{ isNot: null }`, and a required column is *simplified* with a note instead of being sent — "is not empty" matches every row because every row satisfies it, and "is empty" matches none. The designer also stops offering the two operators on a column that cannot be empty. Found by the new probe, which now asserts all five cases.
- **[Fix]** **A `YYYY-MM-DD` value was a day early in the expression language.** `YEAR`, `MONTH`, `DAY`, `DAYNAME`, `MONTHNAME`, `DATEADD`, `DATEDIFF` and `FORMATDATE` parsed a plain date as UTC midnight, so west of Greenwich `MONTH("2026-08-01")` answered 7 and the weekday was a day out — the same class of defect the reporting overhaul fixed in the formatter, in the one place that had been missed. `TODAY()` returns a local calendar day for the same reason.
- **[Update]** **The runner's whitelist grew the fields a designed report actually wants** — a ticket's assignee, board, category, contact, source, first response, resolution and close dates and its overdue flag; a time entry's technician, invoice and rate; and a type on every field, so the designer can format and align a column as what it is. Additive: an existing custom report selects the same columns it always did.
- **[Update]** **The field:function catalog is the runner's own whitelist.** `GET /reports/designer/catalog` publishes the sources, their fields (with type and nullability), the ten filter operators with the kind of value each wants, the forty functions with signatures and descriptions, the nine band kinds, the page sizes, the eight value formats, the four starters and the built-in images. A field cannot be offered unless a report can read it, because there is no second list to drift — and `POST /reports/designer/validate` and `POST /reports/designer/preview` run against it.
- **[Update]** **A template is validated on write *and again on render*.** Saving refuses a document that cannot render, with the first problem in the message and every problem in `error.details`; running or previewing one re-validates it, so a document that was stored and later damaged is refused rather than drawn. Tests pin both halves, including a layout that is damaged in memory and then must refuse to produce pages.
- **[Update]** **The renderers are document-driven, as PLAN-020 §7 asked.** `reportKit`'s print, PDF, Excel and CSV paths were split into writers over plain tables, so the standard reports and the designed ones share one spreadsheet writer, one CSV writer and one PDF writer instead of two of each.
- **[Update]** **`@C7NTAX/shared` is no longer pre-bundled by Vite.** It is source in this repository, so `optimizeDeps` now excludes it: a new export used to be missing until someone remembered `--force`, and the symptom was a blank page with a module-export error — which is exactly what happened while building this and cost a debugging detour worth writing down.
- **[New]** **`apps/api/probe-report-designer.mjs` — 225 assertions, all green.** The expression language (39 cases), the escape attempts (`Math.max`, `constructor`, `globalThis`, `process`, a semicolon, a function literal, and a source-level check that no engine file contains `eval(` or `new Function(`), 27 validation rules, the four starters against three sources, pagination over 200 rows with every row printed exactly once, grouping and group totals checked against arithmetic done by hand, page totals proved equal to each page's own rows, text wrapping and clipping, parameters and the row limit, the API's catalog, the starter/validate/preview endpoints, the `isNotNull` fix in all five cases, a template's whole life as a saved report (create, list, run, rename, refuse an invalid edit, refuse to be damaged, duplicate, delete), and who may design: read-only accounts may preview but not save, and a client-scoped account's preview stays inside its own client even when the template tries to widen it.

## 2026.10.7.026 — The custom report designer: bands, an expression language, and a real layout engine
- **Verification:** `probe-report-designer.mjs` **225/225** (run with `npx tsx`, because it imports the shared TypeScript modules directly); `probe-reports-standard.mjs` **131/131** and `probe-reports.mjs` **29/29** unchanged after the runner change; `check-route-guards.mjs` 384 routes / 337 permission-guarded / 0 violations; `probe-permissions.mjs` clean; API typecheck at its 151 pre-existing errors with none in the new files; web typecheck 0; shared typecheck 0. In the browser: a starter opened in the designer (7 bands), a field added from the palette ("No problems", 16→17 elements), a field inserted into a focused expression (`Fields.assignee Fields.title`, correctly flagged as unreadable, then fixed), undo 17→16 and redo 16→17, arrows nudging a selected element, the Preview tab rendering **4 real pages** of a grouped ticket report with live values, the Data tab listing 96 rows with its period controls, Excel (27,644 bytes), CSV (5,024 bytes), PDF (58,460 bytes) and Print, and finally create → the URL becoming `/reports/custom/<id>/design` → reload → the same seven bands and the same name loaded back from storage.
- **Rollback:** revert the commit. **Nothing is migrated and nothing existing changes behaviour**: no schema change at all, a `template` is a new `Report.type` beside `custom` and the standard ones, and the runner's changes are additive (new fields, and null filters that used to be a 500). The designer is reachable only from Custom Reports.

---

## 2026.10.7.025 — Reporting, audited: two reports that invented their numbers, buttons that did nothing, and a review pack at three cadences
- **[Fix]** **Two reports were fabricating their own figures.** *Client Satisfaction* generated its NPS scores, response rates and trends with `Math.random()` — a client-facing number that changed on every refresh and corresponded to nothing — and *Contract Profitability* multiplied revenue by a random 0.4–0.7 and called the result a margin. Both are now computed from data that exists: satisfaction from the `SurveyResponse` rows the product actually stores, profitability from labour at each person's internal cost rate, approved expenses and catalogue cost on invoice lines. Where a figure still cannot be known it is **reported as unknown with the reason attached** rather than estimated — `costBasis.hoursWithoutCostRate` says how many delivered hours carry no cost rate, so a margin that reads well can be seen to be incomplete.
- **[Fix]** **The buttons did not do what they said.** *Print* called `window.print()` on the application, so it printed the sidebar, the header and whatever was on screen — and on each report card the Print button simply ran the report again. *Export* offered PDF, CSV, XLS and DOC where two of the four opened the print window, and its "Report by client" and date-range fields were never sent anywhere. Now: **Print** renders a real print document from the report itself (verified: 6,351 characters, 10 tables, no sidebar), **PDF** is a genuine 55 KB PDF, **Excel** is a **SpreadsheetML 2003 workbook** (`Revenue.xls`, `application/vnd.ms-excel`, 10 worksheets, typed cells — not an HTML table wearing an `.xls` extension), **CSV** writes every table with its heading, and the client/date/board filters in the export dialog are **applied to the export** with a live preview of exactly what the file will contain. DOC was removed rather than faked: a Word export of a data table is what PDF already is, and a renamed HTML file looks like it works until somebody opens it.
- **[Fix]** **Reports that answered an empty shell, and one that answered nothing at all.** `/data/client-value` had been written and had **no caller in the UI** — built, never surfaced. `/data/csat` and `/data/contract-profitability` guessed (above). The rest answered far less than their cards promised: *Ticket Volume* claimed "by assignee with date range filtering" and had neither, *SLA Performance* claimed "by board and technician", *Technician Productivity* claimed "ticket throughput", *Revenue* claimed "payments collected", *Time Tracking* claimed "project and billable status". Every report now delivers what it says, with the detail named in tables rather than a key-value grid — a report whose payload is "statuses and counts" used to render as *"3 items"*.
- **[Fix]** **A total was being taken from a page of rows.** *Time Tracking* summed the 200 rows it had fetched and presented that as the period total — silent under-reporting at any volume (the existing `TimeEntry` aggregate now supplies the totals and the row list is a separately capped sample, which it states). **A negative duration could reach an average:** one seeded ticket carries a resolution date a day *before* its creation date, and it produced an average of **-24 hours** in Technician Productivity. Impossible spans are now excluded from every average and counted once so the report can say so.
- **[Update]** **The SLA report learned the difference between a late answer and no answer.** A response that arrived late, a target that passed with nothing recorded, and a ticket still inside its target were all being called "breached", which meant 96 tickets with no `firstResponseAt` were reported as breaches. There are now four outcomes (met / answered late / missed / inside target), compliance counts every ticket with a verdict, and — because most of the data predates the stamp — **the first response is read from `firstResponseAt` when it exists and otherwise from our own earliest public reply on the ticket**, with the source counted on the report (`stamp` / `reply` / `none`) so the reader knows which it is. Replies dated before their ticket existed are excluded and counted too.
- **[Fix]** **A client-scoped account got a 500 from two reports.** *Revenue* and *Client Value* asked the `Company` table for a `companyId` column it does not have; internal accounts never noticed because the filter is empty for them. Caught by the new probe, fixed with a separate company-self filter, and now asserted across **all ten** reports for a scoped persona.
- **[Fix]** **Every report can be filtered, and a date means a date.** All reports answer `?from=&to=&clientId=&boardId=`, and the period they actually applied is returned and printed ("All time" when none was given) so a screen cannot imply a range it did not use. A date given as `2026-08-01` used to be parsed as UTC midnight — **every date-range filter was off by one day west of Greenwich** (`31 Jul 2026 – 30 Aug 2026` for an August request). Calendar days are now local days and the label matches the filter. A scoped account's own client is applied without being asked and **cannot be widened by a parameter**.
- **[New]** **Weekly and Monthly Business Reviews, sharing one pack with the Quarterly.** One implementation serves all three cadences, because a weekly and a quarterly review are the same document over a different window and copying it three times is how the three drift apart. Each reviews the **last finished period** — the naive "yesterday's period" resolved to the week and month *in progress*, which the probe caught — compares **like for like** (a period still in progress is measured against the same number of elapsed days of its predecessor, and the notes say so), and offers a period picker built from the report itself: 12 weeks, 12 months, 8 quarters. The Reports section is now **12 standard reports**; the QBR keeps its own tab as **Business Reviews** with a cadence switch, and `/reports/qbr` still works so a link somebody already has does not break.
- **[New]** **Custom Reports has a landing page.** It lists every saved report with its type, source, author, schedule and the actions that work — **run, print, export PDF, edit, duplicate, schedule, delete** — with search, type filter and a "scheduled only" toggle, summary counts, and a confirmation that names what a delete takes with it. Report management was missing: `PATCH`, `DELETE` (refusing a report that ships with the product, with the reason), `POST /:id/duplicate`, schedule deletion, and schedule validation that reports **why** it refused instead of closing the dialog as if it had saved. The config editor gained a guided form (source, columns, filter, group-by, sort, limit) with the raw JSON kept behind "edit the configuration directly", and the row-limit note now names the limit. **Two rendering defects were fixed with it:** a relation column arrived as `{ name: "Acme" }` and printed as **`[object Object]`**, and column headings read `ticket Number` / `title`.
- **[New]** **`PlanDocs/PLAN-020-Custom-Report-Designer.md`** answers the question the landing page raises — whether to embed **jsreport** or write the banded designer ourselves. Verified: jsreport's engine and templating engines are **LGPL** (the studio and PDF/Excel recipes are MIT) with a **commercial cap of five stored templates** and a paid tier for shipping inside another product, and it has **no banded WYSIWYG designer to adopt** — "banding" there is hand-written HTML plus Handlebars in a code editor. ReportBro is **AGPL-3.0 or paid with a Python-only renderer**, FastReport Open Source is **MIT but .NET-only**, JasperReports is Java (LGPL library / AGPL server), and every mature banded *JavaScript* designer is commercial. **Recommendation: build it here on a JSON template document** modelled on JRXML's bands, phased with an exit condition per phase, with the honest cost named — text measurement, pagination and cross-page aggregation are where self-built report engines fail, and that is most of the work.
- **Verification:** `probe-reports-standard.mjs` **131/131** (every report's sections and period, the three cadences and their period lists, the like-for-like window, filters narrowing and never widening, totals not from a page, no negative durations, saved reports agreeing with screens, report management, and every report surviving a client-scoped account) and the existing `probe-reports.mjs` **29/29** (the custom runner's whitelist and the client-value shape, updated for its new structured payload). API typecheck at its 151 pre-existing errors with none in the new files; web typecheck 0. **Browser-verified:** the 12-card grid, the review cadence switch (Weekly → "Week of 28 Sept 2026 against Week of 21 Sept 2026", Monthly → "September 2026 against August 2026", Quarterly → "Q3 2026 against Q2 2026"), a card's Run Report landing on its own cadence via `?period=week`, the print document (no sidebar, 10 tables), the Excel workbook (10 worksheets, real format), the CSV's 89 lines, the 55 KB PDF, the export dialog's applied filters, the schedule dialog refusing an empty recipient list and then saving, the edit dialog loading a report's own config, and the delete confirmation naming the schedules it removes.
- **Rollback:** revert the commit. Nothing is migrated: the only schema change is `User.costRate` (nullable), which the profitability report reads and every other code path ignores.

## 2026.10.7.024 — Product Catalog: one place a price is written down, and four places it is used
- **[New]** **Administration → Product Catalog** (`/admin/products`), modelled on how Autotask PSA, ConnectWise and Scoro treat a catalogue: a `Product` model carrying the identity (`sku` unique, `name`, `description`, `productType` across hardware / software / licence / subscription / service / bundle / other, `category`/`subcategory`, `manufacturer`), the commercial half (`costPrice`, `sellPrice`, `taxable`, `billingPeriod` one-off / monthly / quarterly / annual), the supply half (`vendorId` + `vendorSku`, `unit` across each / hour / day / user / seat / month / licence / GB, `purchaseUrl`, `warrantyMonths`) and the stock half (`trackStock`, `stockOnHand`, `reorderPoint`, `reorderQuantity`). Nothing new is invented about how the app charges: the page is the source, the existing billing path is the consumer.
- **[New]** **Cost and margin are permissioned, and the split is the point.** `product:manage` sees cost and margin and is the only permission that may change a cost price; the finance role (`billing:manage`) sees them too because it prices purchase orders at cost; a viewer gets the sell price and nothing else — the API removes the field rather than hiding it in the UI. New permissions `product:view/create/edit/manage/delete` with a **Product Catalog** group, granted to Manager (view/create/edit/manage), Technician, Dispatcher, BillingManager and ReadOnly (view); the client-facing roles get none — a client contact reading the internal catalogue is a 403, not an empty page. `seed-product-catalog.ts` backfills the role rows (permissions come from the row, not the enum) and seeds 8 starter items: 4 roles merged, 8 products.
- **[New]** **`apps/api/src/routes/products.ts`** — list (search, type, category, active, low-stock, paging), filters (counts by type, categories, manufacturers, the low-stock count), suppliers, detail including **where the item is used** (quote / purchase-order / invoice lines), create with an SKU derived from the name when none is given and a 409 when the SKU clashes, patch, duplicate-as-a-variation, stock adjustments, and a delete that **refuses with 409 and names the record holding it** — a product that has been quoted is retired, not deleted. Stock is a counter plus the audit trail the write middleware already keeps; a per-warehouse ledger is a bigger feature and is recorded as a follow-up rather than half-built.
- **[Update]** **The catalogue is wired into the four places a line is priced, and each line keeps the `productId` it came from.** A new `ProductPicker` (search-as-you-type over the catalogue, free text still allowed — the catalogue is a convenience, not a gate) is in the ticket **Products** tab (fills the sell price), the quote line (sell price, and the created line reports back as a quote line using the product) and the procurement line (**cost** price, because a purchase order is what we pay). On the billing side, hardware and licences sold on a ticket are now raised as **their own invoice lines** instead of being re-typed on the invoice: `customFields.ticketProducts` is read by the generate-from-tickets path, the preview reports the products waiting to be billed, and the ticket is marked `productsBilled` so the same laptop is not charged twice.
- **[Fix]** **The ticket Products tab called the charged price "Unit Cost".** The invoice line uses that figure as `unitPrice`, so the column and its dialog now say **Unit Price**; the picker defaulting from the catalogue's sell price is then coherent with the label rather than contradicting it.
- **[Update]** **The catalogue page's summary cards say what they count.** They total the rows on screen, so once a filter is applied they read **Matching** / **Active in view** / **Recurring in view** — the old wording claimed a whole-catalogue figure while showing a filtered one, and "Active 0" over a full catalogue reads as a fault.
- **[Fix]** **The Cost and Margin columns were invisible in the browser for a non-obvious reason:** Vite had pre-bundled an older copy of `@C7NTAX/shared` (`apps/web/node_modules/.vite/deps/@C7NTAX_shared.js`) with no `product:*` members, so `Permission.ProductManage` was `undefined` in the browser and `permissions.includes(undefined)` was false — while the API enforced correctly. Clearing `.vite`, rebuilding `packages/shared` and restarting Vite fixed it. Recorded because the same trap catches any new enum member.
- **Verification:** `probe-products.mjs` **82/82** (permission-split reads and refusals, validation, SKU derivation and uniqueness, recurring annual value, low stock, filters, duplicate, stock adjustment, the delete guard, and the quote / purchase-order / invoice wiring, plus three new assertions that `billing:manage` sees cost but cannot change it) — written for this feature and the pattern for verifying a permission-split surface. Billing regressions green: `billing-generate` 45/45, `billing-batch` 36/36 (with the API started with `EGRESS_ALLOW_PRIVATE=true`, which its accounting stub requires — the five failures without it were the environment, not the code). `guard:routes` **371 routes, 324 guarded, 0 violations**. API typecheck at its 152 pre-existing errors and none in the new files; web typecheck 0. Browser-verified end to end: create (SKU auto-derived, live margin line, toast, summary counts), edit, retire/un-retire, the low-stock filter, the delete guard refusing on a referenced product and naming the quote line, the quote picker filling rate 1250 and persisting `productId` (the catalogue then reporting **1 quote line**), the purchase-order picker filling **950 from cost**, and the ticket picker adding a row with its SKU that the billing preview picked up.
- **Rollback:** revert the commit and drop the `Product`, quote-line, purchase-order-line and invoice-line columns via the migration; no other feature reads them.

## 2026.10.7.023 — The remaining work, sequenced: what to decide before what gets built
- **[New]** **PLAN-019 — `PlanDocs/PLAN-019-Remaining-Work-and-Go-Live-Sequencing.md`.** An advisory overlay, not a new workstream: it orders the items the other plans already own into three tiers, gives each step an **exit condition**, and lists the ten decisions with the owner, what each unblocks and the cost of deciding late. It adds nothing to the backlog and changes nothing in the code.
- **[New]** **Tier 1 is the sequencing recommendation worth reading first.** 3.1 recommends a starting value for every production flag with its reason — including holding the three *billing* flags (`TIME_RULES_ENABLED`, `INVOICE_BATCH_ENABLED`, `BILLING_FROM_TICKETS_ENABLED`) until the spot rates are confirmed, because they change what a client is billed, and `M365_OFFBOARD_ENABLED=false` until the tenant grant exists. 3.2 lists the three pieces of console work that need no subscription (the PLAN-017 registration, DNS/TLS, the add-in host/GUID). 3.3 is the subscription handover, which is the largest single unblock available. 3.4 recommends **deploying dev first and running the battery against it**, and names the environment-specific surprises to expect there (CSP on the add-in path, cookie flags under a real hostname, absolute manifest URLs, `migrate deploy`, the service-worker cache).
- **[New]** **Two practices the session that produced it argues for.** §6.1: run the 19 suites (617 assertions) as one battery script, with the two caveats that they need their own database before CI and that each suite must ship in the same commit as the claim it proves. §6.2: a 30-minute click-through of the primary surfaces on a *fresh* environment — every defect found in this programme's last stretch (a duplicated route the finance dashboard had coded against, an auth guard re-hashing every password on every sign-in, a service worker retaining another user's cached API responses) was found by using the product, not by reading it.
- **[Update]** **The plan registry now carries PLAN-019 as an overlay row** in both the sequence table and the registry, marked *advice only — nothing applied*, so it cannot be mistaken for scheduled work.
- **Verification:** documentation only. The plan's seven tables were checked for internal consistency, the registry diff is two added lines with no row removed, and the generated What's New fallbacks were regenerated and matched.
- **Rollback:** delete the document and the two registry rows.

## 2026.10.7.022 — The ticket search box said "Search tickets…" and filtered nothing
- **[Fix]** **The Tickets list search box now searches.** It was a bare input with no `value`, no `onChange` and no reader — typing in it moved the cursor and nothing else, on the primary list surface. It is now bound to a `q` URL parameter, debounced at 300 ms so three keystrokes are one request, and passed to the API as `search` (which already matched ticket number and subject and had no caller). Verified: 25 rows → **0** for a nonsense term, the URL carries `?q=…`, and the box follows the URL so Back/Forward and a shared link both work.
- **[New]** **Active filters are shown as removable chips.** `Filtered by` renders one chip per active filter — search, status, priority, board, client, assignee, date range — each naming what it is (`Status: Escalated` uses the friendly name from the quick-filter list rather than the raw `open`+`critical` pair), with an ✕ that drops only that parameter and a **Clear all** beside them. A filtered list that cannot say why it is filtered is how somebody concludes the app is broken. Verified in the browser: removing the search chip restored all 25 rows, emptied the box and cleaned the URL; `?status=open&priority=critical` produced the `Status: Escalated` and `Priority: critical` chips over 7 rows.
- **[Update]** **`Clear all` and the per-chip removals preserve everything else in the URL**, which the newer code in this page did not always do — the clients page already had a working search (`search` state, `typeFilter`, "Clear filters"), so the Tickets box was the missing half of PLAN-013 #9's "advanced filter bar on Tickets/Clients".
- **Verification:** browser-verified in both directions (empty result and cleared result), web typecheck 0 errors, API typecheck at the 152 pre-existing.
- **Rollback:** revert the commit; the API already supported `search`, so nothing server-side changes.

## 2026.10.7.021 — The service worker was caching 209 API responses, including whoever was signed in
- **[Fix]** **Authenticated API responses are no longer cached in the browser.** `sw.js` cached every API `GET` under a URL-only key and served the cached copy back when the network failed. That key cannot express "as this person", so the last user's tickets, clients, invoices — and now the customer portal's tickets — could be handed to whoever used that browser next, most visibly after signing out or with the API unreachable. Measured on a working profile before the fix: **`C7NTAX-v2` held 351 entries, 209 of them `/api/`**. API requests now go to the network and nowhere else: no cache read, no cache write, so an unreachable API produces a failed request and a page that says so instead of yesterday's data.
- **[Fix]** **What was already cached is purged, on devices that have the old worker.** The cache name moves to `C7NTAX-v3` (activation retires the old bucket, dropping all 209 API entries) and activation additionally deletes any `/api/` entry in the current bucket. Verified in the browser: after the new worker activated, `C7NTAX-v3` held **4 shell entries and 0 API entries**, and a further full page load added none.
- **[New]** **Skeletons, finally used.** `components/ui/Skeleton.tsx` existed with `Skeleton` and `TableSkeleton` and **no call sites at all** — every page still rendered a bare "Loading…" line. `PageSkeleton` and `CardSkeleton` were added to it and the placeholders were replaced across **25 pages**: `TableSkeleton` where a table is coming (Clients, Tickets, Billing, Contacts, Assets, Projects, Procurement, Knowledge Base, PTO, Calendar, Roles, Kumo lists, Administration, the finance dashboard) and `PageSkeleton` where a table would be a lie (client/asset/Kumo asset detail, Cloud Connect, inference settings, and the ticket detail view).
- **[Update]** **Offline behaviour changed deliberately.** The PWA shell (`/`, `/index.html`, icons, manifest) is still cached so the app starts offline, but last-seen business data is not: showing a stale invoice to somebody who cannot reach the server is worse than showing that the server cannot be reached.
- **Verification:** browser-measured cache contents before and after (209 API entries → 0, old bucket deleted, no new API entries on reload); the loading state proved with a delayed API response — the Clients page renders **six skeleton rows** while waiting and no literal "Loading…" text remains anywhere in the app, then the nine-row table appears; web typecheck 0, API typecheck at the 152 pre-existing. The fix also removed the reason a page could not be tested with an intercepted request: the worker used to serve `/api/` calls out of its own cache, so nothing downstream of it ever saw them.
- **Rollback:** revert the commit; the SW change is self-contained and the skeleton swap is markup only. A device with the older worker simply keeps its cache until the next deploy, at which point `v3` retires it.

## 2026.10.7.020 — The hardening switch was re-hashing every password on every sign-in
- **[Fix]** **`AUTH_HARDENING_ENABLED` never recognised its own work.** The rehash-on-login guard tested `passwordHash.startsWith("$2b$12$")`, but this application hashes with **`bcryptjs`**, which writes `$2a$12$`. So a hash the hardening pass had just written still looked stale, and **every** sign-in re-hashed the password — a wasted ~300 ms on the hottest route in the product and a password row rewritten on every login. The guard now matches the algorithm and cost (`/^\$2[aby]\$12\$/`) rather than one vendor's letter, so an upgrade happens once and never again.
- **[New]** **`probe-auth-hardening.mjs` — the first thing to test what the hardening switch claims.** A throwaway account is created with a legacy cost-10 hash, signed in, and then observed: the stored hash becomes cost 12, still validates the same password, and is **left alone on the next sign-in** (the assertion that caught the bug above). With printouts for both settings, and a companion check that the switch off changes nothing.
- **[Update]** **`AUTH_HARDENING_ENABLED` verified in both directions.** With it on: a 15-minute token (read from the JWT's own `exp`, not from the config), five wrong passwords locking the account, and the correct password then refused as **423 locked** rather than as wrong credentials. With it off: a 12-hour token, no lockout, and the same password still working after five failures.
- **Verification:** 11/11 assertions with `AUTH_HARDENING_ENABLED=true` and 6/6 with it unset, API typecheck at the 152 pre-existing, and `probe-session` 34/34 unchanged. The defect was found by the probe's **second** sign-in check — the first run passed the "upgraded to cost 12" assertion while quietly re-hashing on every login.
- **Rollback:** revert the commit; the guard change only makes the existing upgrade idempotent.
- **Review outcome recorded (PLAN-013 #8), so it is not re-litigated:** (a) **JWT 15 minutes** — shipped behind the switch; **refresh-token rotation is deliberately not built**, because the browser credential is a server-side session cookie with a sliding idle timeout and the JWT is only a fallback for clients that cannot hold a cookie — rotating a token that is not the primary credential would add a second source of truth for "am I still signed in". (b) **Password hashing stays bcrypt cost 12** rather than Argon2id: `bcryptjs` is pure JavaScript (no native build in the Windows image or the container), cost 12 is inside the OWASP-accepted band, and the rehash-on-login path now genuinely upgrades every account. Adopting Argon2id would mean a native dependency and a second rehash migration for a marginal gain over a tuned bcrypt. (c) **CI scanners are already in place** (`security.yml`: gitleaks over tree and history, trivy config/secret/vuln with `exit-code: 1`, the route-guard check, both typechecks and `guard:deps` against an accepted-risk baseline). (d) **RLS enforcement remains blocked on PLAN-003** (multi-tenant), which is out of scope by instruction — the substitute in force is company scoping, which the portal and billing work both use.

## 2026.10.7.019 — The API's refusal is shown as words, not as "[object Object]"
- **[Fix]** **Every surface that reads the API's error envelope now understands both shapes.** The API answers two ways on purpose: middleware that refuses before a route runs sends `{ error: "…" }` (sign-in, rate limits, the session timeout), while a route calling `next(new AppError(…))` is rendered by the error handler as `{ error: { message, status } }`. Thirteen call sites read only the first shape, so a rule enforced *inside* a route — a bad monitor target, a ticket that cannot be deleted, a contact that will not accept the address — surfaced as a toast reading `[object Object]`. The new `lib/apiError.ts` reads both, preferring the API's own words and falling back to the caller's message when the API sent nothing readable, and the sites were switched to it: 6 in Service Alerts settings, 9 in Tickets (delete, field updates, contacts, schedule, assignment, attachments, sending email), 4 in Billing (batch preview/create/approve/discard), the Finance dashboard's generate panel, and the portal client's own helper.
- **[Update]** **The three fixes recorded in 2026.10.7.017 for Billing and the Finance dashboard are now the shared implementation** rather than two private copies of the same idea — which is what stopped the sweep from being a third.
- **Verification:** web typecheck 0 errors, API typecheck at its 152 pre-existing, and the object shape proved end to end in the browser: submitting a wrong portal code renders **"That code is not valid"** — an `AppError` message crossing the shared helper into the page — where a string-only read would have shown `[object Object]`. The three remaining reads (`api.ts`, `EmailConnectorsPanel`, `usePasskey`, `Checklists`) were already shape-agnostic and were left alone.
- **Rollback:** revert the commit; the helper is additive and the messages it produces are the ones the API already sent.

## 2026.10.7.018 — A customer portal, built so a customer can only ever see their own tickets
- **[New]** **The portal exists: `/portal`, signed in with an emailed six-digit code.** `/api/portal/auth/request` answers **202 whatever happens** — the same body for an address with a portal account and one without — so the endpoint cannot be used to list customers. A code lives ten minutes, works once, dies with the next code requested, and is stored **hashed**, because a database read should not recover a live credential. Three codes per contact per fifteen minutes, five attempts per code, and the attempt is counted against the code rather than the caller.
- **[New]** **A portal visitor is a Contact, not a User, and the separation is structural.** New `PortalSession` and `PortalLoginCode` models, their own `c7_portal` cookie (HttpOnly, SameSite=Strict, double-submit CSRF on writes) and their own `PortalPrincipal` — never a `UserSession` with a null user. The two credentials are mutually useless by construction, which the probe checks in both directions: a portal token on a staff route is 401, a staff token on the portal is 401.
- **[New]** **"My tickets" means the contact's own tickets, not their employer's.** A ticket is theirs when they are the ticket's contact or were added as an additional contact; company membership alone is deliberately not enough, because a client with three hundred staff should not have each of them reading the others' tickets. A colleague's ticket reads as **404, not 403** — whether a ticket exists is itself information. Internal notes are filtered in the query, and billing, time entries and the staff audit trail are not in the response at all.
- **[New]** **Raising a ticket, replying, and reopening.** A ticket raised from the portal carries `source: "portal"`, the contact's client, the contact as its contact, the priority the customer chose, and `status: "new"` so a person triages it; the customer's own words become the first non-internal comment with their address as its sender. The ticket is attributed to a dedicated `portal@c7ntax.local` actor rather than to the email connector, because "who created this" should be true. A reply to a **closed** ticket **reopens it** (`status: new`, `closedAt` cleared) — leaving it closed would hide the reply from the queue that has to answer it.
- **[New]** **Per-client portal access and branding.** `Company.portalEnabled`, `portalAccentColor` and `portalLogoUrl`, surfaced as a **Customer Portal** card on the client record with the portal address to share. The colour and logo are validated where they are set (`#rrggbb`, http(s) or an API path) because they render on a page customers look at. The API must also run with `PORTAL_ENABLED=true`; until it does, **every portal route answers 404**, so a deployment that has not switched the portal on does not advertise one.
- **[New]** **The portal is its own application inside the SPA**, mounted at `/portal/*` **outside** the staff auth provider: no staff session can leak into it and a portal 401 can never bounce the tab to the staff sign-in page. Sign-in, ticket list (open/all), ticket detail with the customer-visible thread, a new-ticket form and a reply box that says "Reply and reopen" when the ticket is closed. Branding is applied as an accent colour, with the product's own when the client has none.
- **Verification:** 90/90 assertions on the new `probe-portal.mjs` — identical 202 bodies for a known and an unknown address; no code issued to a contact of a client with the portal off; the code stored as a hash and recoverable only by brute force *in the probe*; a second request retiring the first code; expiry, attempt exhaustion (429) and reuse (401) each answered distinctly; branding returned on sign-in; the 404-not-403 boundary for a colleague's ticket **and** another client's; internal notes absent, visible notes present; a bearer write accepted without CSRF (nothing attaches a bearer header automatically) while a cookie write without it, or with the wrong token, is 403; the ticket's client/contact/source/status/priority/actor and its verbatim first comment; the reply reopening a closed ticket and clearing `closedAt`; switching `portalEnabled` off ending live sessions and switching it back on restoring them; a deactivated contact refused; six sign-ins leaving exactly five live sessions with the oldest signed out; logout killing the token; and the branding validators refusing `orange` and `javascript:alert(1)`. 10/10 on the new `probe-portal-off.mjs` with the flag unset (all four routes 404 with a reason, staff routes untouched). Browser-verified end to end: the sign-in screen, a real code from the database signing in, "1 open · 2 in total" with the closed ticket hidden by the Open filter, the ticket detail showing the visible note and **not** the internal one, a ticket raised from the form appearing as `New` with the high-priority badge, a reply turning `Closed` into `New` with the message shown as "You", the header accent in the client's `#f97316`, the client record's Customer Portal card, and the staff app still loading normally (nav, Billing, five invoices) after the router change. Regression: `guard:routes` 362 routes (8 new, all exemptions documented)/315 with permission/0 violations, `probe-session` 34/34, `probe-scoping` 13/13, six-persona matrix **identical to the W2-7 baseline**, API typecheck 152 (pre-existing only), web typecheck 0.
- **Rollback:** unset `PORTAL_ENABLED` (the whole surface 404s) or turn off the client's Portal access (live sessions die on their next request). No staff route, permission or schema field changed for existing behaviour.
- **Decision taken, recorded rather than left open:** the plan offered "email + portal token" *or* "SSO-lite". This is the first, because SSO needs the Entra registration that does not exist yet (PLAN-017), while a code needs only the SMTP path already used for ticket notifications and MFA. Swapping it later touches the sign-in route only.
- **Deliberately not built, recorded:** attachments on a portal ticket, an internal notification when a customer replies (the ticket already appears in the queue), a per-deployment portal settings page (the enable switch is an environment flag, the board is `PORTAL_DEFAULT_BOARD_ID`), and a password or profile screen — a portal identity is an email address, which is the whole point.

## 2026.10.7.017 — Billing from tickets: you see the money before you bill it, and the invoice remembers which tickets it came from
- **[New]** **`GET /billing/invoices/unbilled/:companyId`** answers what a client's unbilled time would add up to — entries, hours, amount, the tickets behind it, and the agreement whose rate will be used. It reads only. The Generate dialog now shows that summary as soon as a client is picked, because "Generate" that either writes an empty draft or fails with "no unbilled time" is a coin flip the operator cannot see coming.
- **[New]** **Every invoice list row now names its source tickets.** `GET /billing/invoices` carries `sourceTickets` (id + number, one grouped query for the page, not a lookup per invoice), the Billing table has a Tickets column of chips that open the ticket, the invoice view lists them under "Billed from", the right-click menu has "Open source ticket…", and the CSV export carries the column. Before this, an invoice gave no way back to the work it charged for.
- **[Fix]** **`POST /billing/invoices/generate-from-tickets` was registered twice.** Express serves the first match, so the second handler — a different response shape, sitting further down the file where it read as authoritative — was unreachable dead code. Removed. `FinanceDashboard`'s panel was reading *that* handler's field names, so it had been reporting "Draft invoice undefined generated (undefined line items)" against an endpoint that worked; it now reads `{ invoice, entriesIncluded }` and says what it created.
- **[Fix]** **The double rounding, the unnamed lines and the guessable rate are gone.** Both generate paths now share `resolveBillingAgreement`, `unbilledTimeEntries` and `ticketLineItems`, so the preview cannot promise a rate the invoice does not use. An untyped time entry is described as `Ticket TK-1042` instead of `Time entry 9f3c21ab`, entries come back in date order, and the exact subtotal the preview showed is the one written.
- **[Fix]** **Generating an invoice is now company-scoped.** `POST /invoices/generate` accepted any `companyId` without checking it, so a company-scoped account could bill a client it cannot see. Both generate paths and the preview now return 404 for a client outside the account's scope, matching the read paths that were already scoped.
- **[New]** **The kill switch covers the preview too.** With `BILLING_FROM_TICKETS_ENABLED=false` the dialog's preview 404s alongside the endpoint it serves — a feature that is off should not leave one endpoint hinting that it exists. Billing itself is untouched by the flag.
- **Verification:** 45/45 assertions on the new `probe-billing-generate.mjs` — the empty preview naming its agreement; the preview excluding non-billable and no-charge time while counting 120 minutes as **$425** (1.5 h at the agreement's $200 plus 0.5 h at the entry's own $250); the draft matching the preview exactly with both source tickets *with usable ids*, one typed description kept and one untyped line named after its ticket; the same time never billable twice (a second run is refused with a readable reason); the list showing each ticket once; another client's hour staying out of it; `billing:view`-only refused (403); a company-scoped account 404 on another client's preview **and** its generate while still billing its own; and the legacy `/invoices/generate` still writing its empty draft as it always did while no longer crossing the client boundary. 6/6 on the new `probe-billing-generate-flag.mjs` with the flag off (feature 404s, billing still answers 200). Browser-verified end to end: the dialog previewing "2 entries · 2.00 h, $425.00, UIV-A…, UIV-B…", the create toast naming both tickets, the invoice opening with its "Billed from" chips and the ticket-named line, the chip in the table row navigating to the right ticket, and the new column rendering "—" for older invoices. Regression: `guard:routes` 354 routes/315 with permission/0 violations, API typecheck 152 (pre-existing only), web typecheck 0.
- **Rollback:** `BILLING_FROM_TICKETS_ENABLED=false`, or revert the commit — the API contract only gained fields, and the legacy endpoint keeps its old behaviour.

## 2026.10.7.016 — Bookkeeping: what the waves changed in the plan registry, and the decisions collected for the Azure step
- **[Update]** **The plan registry now reflects what actually shipped.** `PlanDocs/README.md` had drifted from the code: PLAN-001 still read "infrastructure written, never wired" after session auth went live, PLAN-002 still read "roughly three quarters built" after credential management shipped, PLAN-015 read "Phase A untouched" after Phase A and most of Phase B landed, and PLAN-012 read "backend half of phase 1" after the add-in was built. Each row now states the version that closed it and names what genuinely remains. A registry that overstates the work left is as misleading as one that understates it — the next person to read it plans from it.
- **[Update]** **PLAN-016's status is now an explicit hard stop**, with the twelve decisions the implementation waves deferred collected in one table in the plan header: the SMS provider, Azure-vs-AWS, the production feature-flag values, the customer invoice email, the passkey challenge store and the CloudConnect health memory (both must move to a table before more than one replica), per-role passkey policy and SAML, the spot-rate tiers, the M365 sign-in permission, the add-in host/GUID and submission route, the PLAN-017 registration, and DNS/TLS.
- **Verification:** documentation only — `node scripts/azure/preflight.mjs` runs clean (0 failures), the plan registry's markdown tables render, and every version referenced in the rows exists in `BuildNotes.md`.

## 2026.10.7.015 — The Outlook add-in is a real add-in, and its pane is a real pane
- **[New]** **The add-in exists.** `apps/outlook-addin/` holds the manifest (a `MessageReadCommandSurface` ribbon button), the taskpane, the function file Office requires, its own styles, and 16/32/80 ribbon icons derived from the app icon. It is **served by the API at `/addin`** on the same origin as `/api`, so the pane calls the API with relative URLs and no CORS — and the manifest's HTTPS URLs point at the same host.
- **[New]** **The pane reads the selection the way the host allows.** `getSelectedItemsAsync` (Mailbox 1.13+) for a genuine multi-selection, falling back to `mailbox.item` for a single open message — and it says *which* of those it is instead of silently creating nothing when the host does not support multi-select.
- **[New]** **The same pipeline, not a second one.** Each message is converted into the same `ParsedEmail` shape the monitored-mailbox connector uses and posted to the existing endpoint, so contact/client matching, the `Re:`/`FW:` stripping, quoted-reply removal, priority deduction, dedup key and ticket numbering are all identical. An add-in that built tickets its own way would be a quiet second behaviour for the same email.
- **[New]** **Per-message results.** The endpoint now returns one line per message — ticket id and number, or the reason it was skipped — because "3 created" does not tell somebody which of their five messages was already handled. The pane lists each with a link to its ticket.
- **[New]** **A tailored Content-Security-Policy for the add-in path, discovered by actually loading it.** The global helmet policy (`script-src 'self'`) blocked the Office.js CDN — bundling it is not permitted, so the pane could never have worked — and would have refused the frame Office puts the pane in. `/addin` now sends its own policy: that one script origin, inline styles (Office.js styles its own injected elements), the Office telemetry frame by name, and `frame-ancestors` limited to the Office and Outlook hosts. Everything else stays as tight as the global policy.
- **[New]** **`apps/outlook-addin/README.md`** documents the two manifest placeholders (`__ADDIN_HOST__`, `__ADDIN_GUID__`), sideloading from a file for testing, the admin-center path for an internal deployment, and the three things deliberately not built: the SSO flow (needs the PLAN-017 app registration), AppSource submission (a Partner Center decision), and writing back to the mailbox (needs `ReadWriteItem` and has no purpose here).
- **Verification:** 30/30 assertions on the new `probe-outlook-addin.mjs` — the taskpane, stylesheet and manifest icon all served (200, correct content type); a selected email becoming a ticket that lands on the client the sender's domain resolves to, with a contact, status `new`, the subject as the title, **the quoted trailer stripped**, the problem text intact and no reply prefix in the title; the same `internetMessageId` not ticketed twice **with the skip reported as "already has a ticket"**; three messages producing two tickets and three result lines; a missing board and an empty message list refused (400); an account without `ticket:create` refused (403); unauthenticated refused (401); the board list answering (4). Browser-verified: the pane loading **with Office.js actually loading** and **zero CSP violations** (the first attempt showed both, which is how the policy was found), signing in, listing all four boards, and correctly reporting "Open this pane from the C7NTAX button in Outlook" with Create disabled when there is no mailbox context. Regression: 34/34 session, 13/13 scoping, 34/34 Kumo audit, 36/36 M365 inactivity, 28/28 CloudConnect status, `guard:routes` 354 routes/315 with permission/0 violations, API typecheck 152 (pre-existing only), web typecheck 0, Azure preflight 0 failures.
- **Rollback:** `OUTLOOK_ADDIN_ENABLED=false` stops serving the folder and 404s the routes, exactly as before this change.
- **Known limitation, recorded rather than implied:** the manifest carries two placeholders that must be replaced per deployment (the host and the GUID), because both are environment-specific and a committed GUID would be a land-grab on an identifier nobody should own by accident. Multi-select depends on the host: Outlook on the web and current desktop builds support it, older ones fall back to the open message.

## 2026.10.7.014 — A QR screenshot is enough to enrol, and a foreign one is refused
- **[New]** **Two-factor enrolment accepts a screenshot of the QR.** The workflow this exists for: a user screenshotted their authenticator QR (or was handed the image) and now needs the base32 key to type in by hand, because the screen that showed it is gone. `apps/web/src/lib/qrEnrolment.ts` reads the image, extracts the `otpauth://` enrolment and hands back the key — and the key above it is now grouped in fours with a copy button, the way manual entry expects it.
- **[New]** **The image is decoded in the browser and never uploaded.** A QR screenshot is that user's own credential material; there is no reason for it to leave the machine, and doing it here also avoids giving the server an image-decoding dependency to do the same arithmetic. `BarcodeDetector` is used where the browser has it, with **jsQR** as the fallback.
- **[New]** **A screenshot that belongs to somebody else is refused, by name.** Silently enrolling with a secret that is not this account's would produce an authenticator whose codes the server always rejects, with nothing on screen explaining why. A foreign QR is reported — "it carries the issuer “Kumo” and the account “Kumo: QR probe secret”; codes from it will not be accepted by this account" — and a summary that is not an authenticator enrolment, or an image with no QR in it, says so instead of failing silently.
- **Verification:** browser-driven end to end, because that is where the decode happens — the account's own QR data URL was turned into a `File` and dropped on the zone (matched: "This is the enrolment code for this account"), and a **genuinely different** TOTP enrolment generated through the Kumo password vault was dropped next (refused, with the issuer and account named, and the mismatch banner rendered). Regression: 34/34 session, 13/13 scoping, 31/31 dashboard, 34/34 Kumo audit, 36/36 M365 inactivity, `guard:routes` 354 routes/315 with permission/0 violations, web typecheck 0, API typecheck 152 (pre-existing only), Azure preflight 0 failures.
- **Rollback:** the feature is one page and one module with a new dependency; removing the dropzone restores the previous screen exactly, and enrolment itself is untouched (the server's `/auth/mfa/setup` and `/auth/mfa/verify-setup` are unchanged).
- **Deviation from the plan, recorded deliberately:** the plan said "server-side QR-decode". It is done in the browser instead — the screenshot stays on the user's machine, no image ever reaches the API, and the server gains nothing to decode, sanitise or rate-limit.
- **Known limitation, recorded rather than implied:** the enrolment screen regenerates its pending secret on every visit (pre-existing behaviour), so a screenshot taken before a reload no longer matches and is reported as a foreign enrolment. The message says what it found rather than "invalid", but the underlying rotate-on-load is the real fix and is left alone here.

## 2026.10.7.013 — The dormant Microsoft 365 accounts, and a departure checklist that disables nothing
- **[New]** **Inactive accounts per client, from what the tenant actually reported.** `M365User` gained `lastSignInAt`; the M365 sync now reads sign-in activity **in a separate, optional call**, and `GET /cloudconnect/m365/inactivity` buckets every synced account by last sign-in — active, 30–60, 60–90, over 90 days — grouped by client, dormant accounts first.
- **[New]** **"No sign-in data" is not "no sign-ins".** Sign-in activity needs Entra ID P1 and `AuditLog.Read.All`; on a tenant that cannot answer, the report says **exactly that** and every account reads as **unknown, never as dormant**. A report that quietly counted "we do not know" as "dormant" is how an MSP ends up disabling live accounts. The panel states it too, rather than showing a reassuring zero.
- **[New]** **`POST /cloudconnect/m365/users/:userId/offboard`** raises a standard departure checklist (revoke sessions, reset and disable, convert the mailbox, reclaim the licence, transfer OneDrive, check group memberships, reassign tickets, document the authorisation) against the client the account is mapped to. **It disables nothing**: the checklist is the deliverable, because the work is risky, order-dependent and should leave a record — and a second checklist for the same account is refused.
- **[New]** **An account mapped to no client is refused with the reason** ("nowhere to file the checklist") instead of being filed somewhere wrong; unknown synced users are a 404.
- **[New]** **The M365 sync cannot be broken by a tenant that cannot answer.** Asking for `signInActivity` in the main `$select` would 400 the entire user sync on a tenant without the permission; it is a separate read whose refusal is recorded in the sync result and the sync continues.
- **Verification:** 36/36 assertions on the new `probe-m365-inactivity.mjs` — 3-day, 45-day, 75-day, 150-day, 220-day and never-seen accounts landing in the right buckets; the known/unknown split reported separately; a disabled account reported as disabled; per-client grouping with unmapped accounts kept separate and no empty groups; dormant-first ordering inside a client; offboarding raising a checklist with **8 tasks filed against the right client**, including revoking sessions and reclaiming the licence, **with the account itself left untouched**; a second checklist refused (409); an unmapped account refused with the reason; an unknown user a 404; a technician refused (403) and an unauthenticated read refused (401). Browser-verified: the panel reporting "No sign-in activity is stored for any of the 3 synced accounts … every account reads as unknown, not as dormant" on this seeded data, the bucket strip, and the expandable per-client list with **Offboard** on the accounts that have a last sign-in. Regression: 34/34 session, 13/13 scoping, 24/24 reports, 31/31 dashboard, 33/33 board layout, 34/34 Kumo audit, 28/28 CloudConnect status, `guard:routes` 354 routes/315 with permission/0 violations, web typecheck 0, API typecheck 152 (pre-existing only), Azure preflight 0 failures.
- **Rollback:** `M365_OFFBOARD_ENABLED=false` makes the offboarding route answer 404 and hides the button; the report is read-only and the schema change is additive.
- **Known limitation, recorded rather than implied:** the report is only as fresh as the last sync, and it depends on the app registration holding `AuditLog.Read.All` — the note in the report and on the panel says so. `lastSignInAt` is only written by a sync that could read activity; accounts synced before that permission existed stay unknown until the next sync re-reads them.

## 2026.10.7.012 — Solved tickets write their own first draft of the knowledge base article
- **[New]** **A resolved ticket drafts an article, and the draft stays a draft.** The knowledge that leaves with whoever solved the ticket is the expensive kind, and the tickets carry it already. Resolving (or closing) a ticket now drafts a knowledge base article from it — title, cause, symptoms, resolution steps, tags — filed as a **draft** with the **ticket it came from attached** and a review note saying what to check. Nothing is ever published by a machine: a person publishes it or discards it.
- **[New]** **A review queue instead of a hidden pile.** The Knowledge Base page shows the drafts awaiting review, marked **AI** where they were drafted, with **Review** on each; the article view says plainly that AI wrote it, links the source ticket, and offers **Publish** and **Discard**. Discard deletes a draft; a *published* article cannot be deleted from that button — it says to archive it instead, because a published article is something somebody may already be relying on.
- **[New]** **`POST /kb/autogen/:ticketId`** drafts on demand and **`GET /kb/drafts`** lists what is waiting, both behind `KB_AUTOGEN_ENABLED` (default on; `KB_AUTOGEN_MODEL` can point drafting at a cheaper deployment than the interactive model).
- **[New]** **The prompt is built from resolved material and capped on a word boundary**, with a 6,000-character ceiling — the description, the customer-visible notes, the internal notes and the logged work. A prompt that stops mid-sentence is an invitation to invent the rest of it.
- **[New]** **A ticket with nothing recorded on it is refused rather than embellished**: "too little recorded on it to learn from", and nothing is written. A model that answers with prose instead of JSON is refused the same way — an unusable answer must not become an article.
- **[New]** **One draft per ticket.** Asking twice is refused with the reason, without calling the model again.
- **[Fix]** **Several providers can carry the default flag, and the winner was arbitrary.** `findFirst` over `isDefault: true` picked whichever row the database happened to return first, so a freshly configured model could be ignored in favour of an older one. The most recently updated default now wins.
- **[Fix]** **The article view never showed the article.** The knowledge base list did not select `content`, so opening an article showed its excerpt as if it were the body. The list now carries the content (and the provenance fields) and the modal renders it — which is also what makes reviewing an AI draft possible at all.
- **Verification:** 42/42 assertions on the new `probe-kb-autogen.mjs` (against a loopback stub standing in for the model) — a resolved ticket producing a **draft** marked AI-generated with the model's title, the source ticket attached, a body that says it was drafted and needs review, a review note, tags, an excerpt, structured sections and the reported token usage; the prompt naming the ticket, the client and the technician's recorded work and asking for JSON; a second request refused (409) without asking the model again; a ticket with nothing on it refused with an honest reason and nothing written; a prose answer refused and nothing written; **resolving a ticket drafting in the background while the resolution itself still returns 200**, and **resolving still succeeding with the model unreachable**; the drafts queue listing the AI draft and reporting auto-drafting on; publishing by a human, a published article refusing the draft-button discard with the reason it should be archived, and a rejected AI draft deleting cleanly; a technician without KB create permission refused and an unauthenticated read refused. Browser-verified: the queue showing "drafts awaiting review", the opened draft carrying the AI banner, the review note and a working **Source ticket** link, and Publish moving it into the published list with the banner gone and the queue back to "0 drafted from resolved tickets". Regression: 34/34 session, 13/13 scoping, 24/24 reports, 31/31 dashboard, 33/33 board layout, 34/34 Kumo audit, 28/28 CloudConnect status, `guard:routes` 352 routes/313 with permission/0 violations, web typecheck 0, API typecheck 152 (pre-existing only), Azure preflight 0 failures.
- **Rollback:** `KB_AUTOGEN_ENABLED=false` stops drafting at the source (the on-demand route answers with the reason, resolution never drafts); the schema change is additive.
- **Known limitation, recorded rather than implied:** the draft is generated from the ticket text only — it does not consult existing articles or the asset record, so a draft may restate knowledge the base already has. Duplicate detection before filing is the natural follow-up, and would need an embedding or similarity pass over the existing titles.

## 2026.10.7.011 — CloudConnect says what it verified, and stops asking the vendor
- **[New]** **A live status chip per connection.** CloudConnect knew a connection was broken when somebody pressed Test and found out; the row's badge was a status from the day it was saved. Each connection now carries a chip that says what the platform actually observed — **Verified**, **Not answering**, **Incomplete** or **Off**, with **when** it was checked and, when it is not healthy, a **Fix** link that opens the credential dialog for that connection directly.
- **[New]** **Verification is done server-side, on a throttle.** `GET /cloudconnect/status` verifies whichever connections are due (`CLOUDCONNECT_VERIFY_INTERVAL_SEC`, default 300) and reports the result — so ten open browsers still produce **one** call per connection per interval, not ten. A slow vendor cannot hold the page open: the request waits a budget, then reports the last known state while the answer is recorded when it lands (and the chip says "checking now…" meanwhile).
- **[New]** **A request that cannot succeed is never sent.** A connection missing any required credential is reported as **Incomplete** naming the fields, and **no call is made to the vendor at all** — an integration with no client secret is not a vendor's problem.
- **[New]** **The chip and the badge cannot disagree.** A verification writes the result back to the row it describes (`status`/`errorMessage`), and a hand-run Test records itself immediately, so the two never tell different stories. Consecutive failures are counted and surfaced in the tooltip.
- **[Fix]** **"All errors resolved!" was shown for a connection that was demonstrably failing.** The fix dialog renders the field list the *server* named, so a failure with no named field (a rejected password, a connection with no credentials stored) opened an empty dialog claiming success. A failure with no named field now lists **every configured field** as editable — which is the dialog's whole purpose — and a connection that stores nothing editable says exactly that instead of congratulating itself.
- **Verification:** 28/28 assertions on the new `probe-cloudconnect-status.mjs` — an incomplete connection reading as `unconfigured` with **every** missing field named, "nothing is sent" in its detail and **no verification timestamp**; a complete connection verified within seconds, its stored status matching its health state; **three polls in a row producing one check** (the throttle); a hand-run test updating the chip immediately; a switched-off connection reading `off` and unverified; the integration list still carrying what the fix dialog edits; the new endpoint gated exactly like the integration list it belongs to (403 for an account with no integration permission) and 401 unauthenticated. Browser-verified: chips rendering on real connections ("Not answering · verified 48s ago · Fix"), the Fix chip opening the credential dialog for that connection, and the corrected empty state naming the reason instead of claiming success. Regression: 34/34 session, 13/13 scoping, 21/21 egress, 24/24 reports, 31/31 dashboard, 33/33 board layout, 34/34 Kumo audit, `guard:routes` 349 routes/310 with permission/0 violations, web typecheck 0, API typecheck 152 (pre-existing only), Azure preflight **0 failures** (`CLOUDCONNECT_LIVE_STATUS_ENABLED` and `CLOUDCONNECT_VERIFY_INTERVAL_SEC` documented).
- **Rollback:** `CLOUDCONNECT_LIVE_STATUS_ENABLED=false` returns stored statuses only and makes no outbound calls — the endpoint still answers, so the page needs no change.
- **Known limitation, recorded rather than implied:** the health memory is in-process, so a restart reports "not verified since this process started" until the first check completes, and a multi-replica deployment would have each replica keeping its own. Moving that memory to the database is the natural follow-up and is the same shape as the passkey challenge store noted for Azure.

## 2026.10.7.010 — An Outage Board, and social reports that can never shout louder than they should
- **[New]** **An Outage Board tab.** The Service Alerts page showed everything as one long scroll, which answers "what is happening" only by reading the whole page. The board is one row per monitored service — **status**, the **last incident** (active or already resolved, with when it was detected and a link back to the source), and **what each source reported** — sorted so problems are at the top, with a five-figure summary: outages, degraded, notices, operational, and **how many services are currently unreadable** (every configured source unknown, so nothing is being detected for them). It refreshes on the same visibility-gated poll as the rest of the page, so it costs nothing extra while the tab is hidden.
- **[New]** **A social (X) source, behind configuration.** Off unless `X_BEARER_TOKEN` is set: a deployment that has not configured X gets **no social observation at all** — not an "unknown" one — so nothing on screen claims to be watching a source it cannot read. It searches X's recent-search endpoint for the service's own name (no retweets, English, a two-hour window), and a resolution post can retire a notice the same poll.
- **[New]** **Social chatter can raise a notice, and only a notice.** The weakest source in the set is treated as the weakest source in the set: a complaint is recorded as **informational**, never as an outage, with a title that says where it came from and a link to the post. An MSP reading a red banner should be reading the vendor's status page, not somebody's afternoon.
- **[New]** **A broken token is "unknown", and unknown never means all-clear.** A 401, a 403, a rate-limit and an HTTP error are each reported as unknown *with the reason* (the 401 line says the credentials were rejected), the alert is **kept** rather than resolved, and the HTTP error also lands in the run's error list. Silent credential death is how a monitoring system starts lying.
- **[Fix]** **`INVOICE_BATCH_ENABLED` was missing from the deployment template** — the Azure preflight caught the env contract gap from the batch-invoicing step. Now documented next to the other feature flags, and the preflight is back to **0 failures**.
- **Verification:** 33/33 assertions on the new `probe-outage-board.mjs` (against a loopback stub standing in for X) — a probe service with *only* a social source: the complaint observed as a problem with an honest detail line and a link to the post, the alert raised as **informational** and attributed to `social`, the bearer token actually sent, the query excluding retweets and naming the service; one clear poll not retiring it, nor the second while it is younger than the poll interval, and **two consecutive clears retiring it once it is old enough**; a public "resolved" post retiring it; 401 → unknown with the reason and the alert **kept**; 429 → unknown; HTTP 503 → unknown plus an error line; and the board's data present on `/service-alerts/services` (per-source verdicts, check time) and `/service-alerts` (resolved history for the last-incident column). Plus 7/7 on `probe-outage-board-social-off.mjs` with **no token configured** — zero social observations, "social" absent from the sources in use, and nothing claiming X failed. Browser-verified: the board rendered 14 rows with an active OpenAI outage at the top, its sources chipped including X (Twitter), the summary strip reading outages/degraded/notices/operational/unreadable, the **Last incident** column present, and the Live tab unchanged. Regression: 34/34 session, 13/13 scoping, 21/21 egress, 18/18 passkey, 24/24 time rules, 24/24 reports, 31/31 dashboard, 33/33 board layout, 34/34 Kumo audit, `guard:routes` 348 routes/309 with permission/0 violations, web typecheck 0, API typecheck 152 (pre-existing only), Azure preflight 0 failures.
- **Rollback:** set `SERVICE_ALERTS_SOCIAL_ENABLED=false` (or unset the token) and the source disappears entirely — asserted above rather than assumed. The board is a tab on one page; the Live view is untouched.
- **Known limitation, recorded rather than implied:** the X query is derived from the service name, so a service with a very common name ("Slack", "Zoom") can match unrelated chatter. It is capped at a notice for that reason. A per-service search query is the natural next step and would need a column on `ServiceAlertService`; the plan asked only for the source behind env config, so this is where it stops.

## 2026.10.7.009 — A board leads with the tile its desk cares about
- **[New]** **Board tiles can be arranged.** Each board card showed six metric tiles in a fixed two-row layout, so an escalation queue could not lead with **Escalated** and a MACD desk could not lead with **New**. The tiles are now arranged per board — drag by the handle or use the arrows, and **pin** the one that matters so it leads the card regardless of the dragged order.
- **[New]** **One arrangement per board, shared with the desk that reads it.** This is a board setting, not a personal preference: reading it needs `board:view`, changing it needs `board:manage`, and every account looking at that board sees the same tiles in the same order. Board cards still refresh their numbers every 15 seconds; only the arrangement is saved.
- **[New]** **"Pin to the front" survives the drag order.** A pinned tile is moved ahead of the unpinned ones and two pins keep their relative order, so a pin is a statement about importance rather than a one-off shuffle.
- **[New]** **The saved arrangement is reconciled, like the dashboard's.** An unknown tile id is dropped, a duplicate collapsed, and a tile added later **appended rather than missing** — so retiring or renaming a tile cannot leave a board with a hole in it. A non-array and an over-long list are refused with a 400, and an unknown board is a 404.
- **[New]** **The arrangement rides on the metrics the page already calls** (`/boards/metrics` loads every board's layout in one query), so there is no extra request per card.
- **Verification:** 33/33 assertions on the new `probe-board-layout.mjs` — catalogue order and six tiles for an unarranged board; an arrangement stored and returned exactly as made; a pin leading the card while the rest keep their dragged order; two pins keeping theirs; unknown ids dropped, duplicates collapsed, missing tiles appended; a non-array, an over-long list and an unknown board refused; read-only reading (200) but refused a write and a reset (403), a technician refused a write (403), an unauthenticated read refused (401); the metrics endpoint carrying the arrangement for the arranged board and the untouched default for every other board; reset restoring catalogue order. Browser-verified: pinned **Escalated** on the Infrastructure board, saved, **reloaded and it still led the card** while the other three boards kept their default order, then Reset and the row was gone. Regression: 34/34 session, 13/13 scoping, 21/21 egress, 18/18 passkey, 24/24 time rules, 24/24 reports, 34/34 Kumo audit, 31/31 dashboard, `guard:routes` 348 routes/309 with permission/0 violations, the six-persona matrix byte-identical, web typecheck 0, API typecheck 152 (pre-existing only).
- **Rollback:** the model is additive and every board renders catalogue order when no row exists; deleting the route restores the previous fixed layout with no data change.

## 2026.10.7.008 — The dashboard is yours: arrange it, size it, hide what you do not use
- **[New]** **A per-user dashboard.** The overview was one fixed grid of six stat cards and nine links, identical for everybody and identical forever. It is now assembled from a **widget catalogue** you arrange: drag a widget by its handle (or use the arrows) to reorder, pick **S / M / L** for its width, hide the ones you do not use, save. The layout follows **your account**, not the browser, so it is there on the next machine you sign in from — and **Reset** puts the catalogue order back.
- **[New]** **The catalogue is the server's, not the browser's.** `GET /dashboard/layout` returns your arrangement *reconciled against* the catalogue: unknown widget ids are dropped, duplicates collapsed, an impossible width corrected, and a widget added since you last saved is **appended rather than missing**. Retiring or renaming a widget cannot leave a user staring at a hole where it used to be.
- **[New]** **It is filtered by what you can actually load.** A widget that reads billing data is offered only to an account holding `billing:view`; the technician persona is offered 8 of 10 widgets, the administrator 10. That check runs on **both** the read and the write, so a save cannot smuggle in a widget the user was never offered.
- **[New]** **A saved layout is input, and is treated like one:** a non-array is refused (400), a list over 50 entries is refused, and hiding *everything* is refused — a dashboard that cannot be blanked by accident.
- **[New]** **The widgets themselves pull their own data:** open / waiting / all / resolved tickets, overdue invoices, active clients, **active alerts** (the live count from the same endpoint the nav badge uses), **my time this week** (your own entries since Monday, from the ticket-time data the time engine now weights), a **recent tickets** list, and quick links. Two of those — active alerts and my time — are new to the dashboard.
- **Verification:** 31/31 assertions on the new `probe-dashboard.mjs` — a fresh account gets the catalogue in catalogue order at each widget's default width; the technician is offered 8 of 10 and not the two billing widgets; a saved arrangement returns exactly as arranged with the unplaced widgets still appended; an unknown id dropped, a duplicate collapsed, an impossible width corrected; a non-array, an over-long list and an all-hidden layout all refused; **one account's layout never appears on another's** (the technician sees nothing of the administrator's and vice versa); reset restores the catalogue; an unauthenticated read refused. Browser-verified end to end: hid *All tickets*, widened *Recent tickets*, moved *Active alerts* up, saved, **reloaded and the arrangement was still there** ("1 widget hidden"), then Reset and the 96-ticket *All tickets* card came back. Regression: 34/34 session, 13/13 scoping, 21/21 egress, 18/18 passkey, 24/24 time rules, 24/24 reports, 34/34 Kumo audit, `guard:routes` 345 routes/306 with permission/0 violations, the six-persona matrix byte-identical to the previous step, web typecheck 0, API typecheck 152 (pre-existing only).
- **Rollback:** the table is additive and `GET /dashboard/layout` answers only when the browser asks; reverting the page restores the previous fixed grid and leaves every other screen untouched.
- **Deliberate scope:** the plan's "resize" is a three-step width (S/M/L) rather than free pixel resizing, because a fixed grid the API can validate is what keeps a saved layout safe to trust; "pin to top" is order, which the drag already gives.

## 2026.10.7.007 — Every change to a shared Kumo credential or document now has a name against it
- **[New]** **Kumo remembers who changed what.** "Last changed by" told you who touched a row last and nothing else: not who *revealed* a credential, not what the previous editor actually changed, not that anyone had. Shared vaults and shared runbooks are edited by many hands, and "the password changed and nobody knows why" is the question an audit asks. There is now a trail — a `KumoAuditLog` table with an entry per action, who did it, when, a sentence a person can read, and the field-level facts behind it.
- **[New]** **Recorded on the credential itself:** created, updated, deactivated, and **revealed** — the reveal is the event that matters most in a vault, and it is now named alongside the existing access log rather than living only in a table nobody opens.
- **[New]** **Recorded on documents too:** created, and every edit, with the version number and the change log the editor supplied, so a runbook's history reads as prose instead of a revision list.
- **[New]** **The trail names the fields that moved and never their values.** An edit says `label, password` — the password is an entry by name, not a copy of the secret; the plaintext never reaches the audit table, which would otherwise become the weakest copy of the very thing the vault protects. Bookkeeping columns (`updatedById`, `updatedAt`) are deliberately not dressed up as user edits.
- **[New]** **A trail panel where the item is.** An **Audit trail** expander in the credential detail panel and in the document viewer, loaded on demand (nobody wants a history query on every open) and refetched when a reveal happens, so the entry you just created appears without a reload.
- **[New]** **`GET /kumo/audit/:itemType/:itemId`**, newest first, limit clamped, entries resolved to a person's name. Gated on Kumo view permission, 404 for an item that does not exist or a type that does (so an unknown id cannot be told apart from a deleted record by its empty trail), and the general audit `Json` is typed rather than free-form.
- **Verification:** 34/34 assertions on the new `probe-kumo-audit.mjs` — create/update/reveal/deactivate recorded with the acting **user resolved**, the changed fields listed by name with **no plaintext secret anywhere in the trail**, an absurd `limit` clamped rather than run, document create and update recorded with the version and change log, an unauthenticated read refused (401), an account with no Kumo permissions refused **both** the trail (403) and the reveal it describes (403), an unknown item and an unknown type both 404, and — the assertion that makes attribution worth having — a *second* administrator's reveal named as **their** reveal and not the other administrator's. Browser-verified: revealed a credential and watched "Revealed "Acme Domain Admin" · 2:32:14 AM · Persona Super Admin" appear in the panel, and created a document and saw "Created "Browser check doc" (v1)" against it. Regression: 34/34 session, 13/13 scoping, 21/21 egress, 18/18 passkey, 24/24 time rules, 27/27 expenses, 36/36 billing batch, 24/24 reports, `guard:routes` 342 routes/306 with permission/0 violations, the six-persona matrix byte-identical to the Wave 0 baseline, API typecheck 152 (pre-existing only), web typecheck 0.
- **Rollback:** the audit write is a single `recordKumoAudit` call per action and the table is additive; reverting the routes removes the entries and leaves every Kumo read and write behaving exactly as before.
- **Known limitation, recorded rather than implied:** the trail covers Kumo **credentials and documents** — the two item types whose edits the plan named. Assets, configs and links are not yet written to, so asking for their trail returns an empty list rather than an error; the route and the table already accept them, which is where a follow-up would land. Audit rows are never pruned and have no retention policy yet.
- **Defect found while verifying, deliberately not fixed (unrelated to this change, present before it):** in the credential detail panel the three auto-TOTP blocks (Setup TOTP, the QR, the live code) sit *inside* the "Credentials Revealed" amber box, so the QR setup button is only reachable while a password is on screen. `git show HEAD` confirms the nesting predates this change; it is recorded here rather than quietly rearranged because it is a separate 30-second layout fix with its own verification.

## 2026.10.7.006 — The custom report builder actually runs what you give it, and there is a Client Value Report
- **[Fix]** **A "custom" report returned nothing, because nothing ran it.** `GET /reports/:id/run` understood two hardcoded types and answered an empty array for everything else, so every config a user typed in the builder came back empty. There is now a runner: a config says which **source** to read, which **columns** to show, what to **filter** on, and how to sort and limit — and it produces rows.
- **[New]** **The runner is a whitelist, not a query language.** Sources are named (tickets, invoices, time entries, expenses, assets, contacts, companies) and so are the fields and operators; anything outside them is **dropped and reported in the response** rather than run. A report config is text somebody typed into a form, so it gets treated like any other input — there is no SQL to inject and no field to reach for that the whitelist does not name. Columns that present themselves as `client` still resolve through the relation, which is what makes the output readable.
- **[New]** **`groupBy` gives a rollup** — counts per status, per priority, per client — without a second query type, and the response says when a result was truncated at the row limit.
- **[New]** **A Client Value Report**, per client: total tickets and the last 90 days, the open-versus-resolved split, critical/high count, how many people actually got in touch, **average first reply** (the first customer-visible comment against the ticket's creation), hours logged, hours billed (which respects the overtime weighting) and approved expenses. Available as a saved report type and as `GET /reports/data/client-value`, and scoped — a client-scoped account sees only its own row.
- **Verification:** 24/24 assertions — a custom config returning 25 filtered rows with the relation column resolved, the rollup shape, an unknown **source** refused with a 400, unknown columns dropped *and named in the notes*, unknown operators and filter fields ignored with a note, four other sources running, client scoping holding for both a saved report and the value report (one client at most), the built-in types still working, and `open + resolved === total` for every client. Browser-verified from the app origin: a config created and run through the real endpoints returned `[{ ticketNumber: "NOC-2011", …, client: { name: "Umbrella Corp" } }]` and the value report listed all five clients.
- **Rollback:** the runner only reads, and the built-in types keep their previous shapes — reverting the route restores the old behaviour with no data change.

## 2026.10.7.005 — Bill-through batch invoicing: preview it, hold it, approve it — and it can never double-bill
- **[New]** **A month of work becomes invoices in three deliberate steps.** Preview works out what each client owes for everything unbilled up to a date — weighted hours at the agreed rate plus approved expenses — and **writes nothing**, so it is safe to run as often as you like. Create turns that into *draft* invoices held by a batch. Approve issues them; Discard throws the drafts away and puts the work back.
- **[New]** **The time engine reaches the invoice.** Billing uses `billedMinutes`, so two hours of evening work at 1.5:1 bills as three — the acceptance case from the plan, now asserted end to end (a two-hour 19:00–21:00 entry produced a three-hour line).
- **[New]** **Approved expenses bill themselves.** They arrive as their own invoice line with the vendor and mileage in the description, which is what closes the loop on the expense work: a technician's $45 cable ends up on the client's invoice without anyone retyping it.
- **[New]** **Work cannot be billed twice.** Creating a batch claims its time entries and expenses by pointing them at the draft invoice, so a second run in the same period finds nothing — and discarding returns them to the pool, including putting an expense back to `approved`. An approved batch refuses to be discarded (void the invoices instead) and cannot be approved twice.
- **[New]** **`billThroughDate` per client**, moved when a batch is approved, so "how far have we billed this client" is a fact rather than a guess.
- **[New]** **Invoices are offered to the connected accounting system on approval**, through the same egress policy as everything else, with each invoice's outcome reported individually — an invoice that was issued but not pushed says so instead of pretending. The `Billing → Invoices` tab gained a **Bill through…** button that appears only when the feature is switched on server-side, and a dialog that previews per client with checkboxes, shows the draft step, and takes a reason before discarding.
- **[Fix]** **`window.prompt` is not supported in this environment — or in Electron.** The discard and expense-rejection flows used it to ask for a reason, which meant those buttons did nothing. Both now use an inline input, which also works in the desktop shell.
- **[Fix]** **The Azure preflight crashed on a worktree mid-rename** (it read every file `git ls-files` named, including one staged for deletion). It now skips files that are not there.
- **Verification:** 36/36 billing-batch assertions — weighted hours and expense lines in the preview with nothing written, draft creation with the work claimed, an empty second preview, discard returning time *and* the expense to `approved`, approval issuing and pushing against a local stub (payload, invoice number, total, both lines), the bill-through date moving, approving twice refused, an approved batch refusing discard, and an empty period reporting "nothing to bill"; **and the routes answer 404 with `INVOICE_BATCH_ENABLED=false`**, which is the rollback. Plus the browser: preview showed 5 clients and $20,437.50, creating drafts produced 5 drafts held by the batch, and discarding restored every hour and expense — the invoice list ended exactly where it started. Regression: 34/34 session, 13/13 scoping, 21/21 egress, 18/18 passkey, 24/24 time rules, 27/27 expenses, `guard:routes` 340 routes/0 violations, both typechecks at baseline, preflight 0 failures.
- **Known limitation, recorded rather than implied:** the plan's "approve batch → email (existing path)" assumes an invoice email that does not exist anywhere in the application — the send endpoint flips the status and nothing more. Approval therefore issues and syncs, and does not claim to have emailed anybody. A customer invoice email (the PDF already renders) is a follow-up, not something this step pretended to do.

## 2026.10.7.004 — Out-of-pocket costs can finally be filed by the technician who spent the money
- **[New]** **A technician can file an expense against their ticket.** Before this, adding an expense needed the billing permission, so the person who actually paid for parking could not record it — the plan's own words for the gap were "technician out-of-pocket costs untracked". Filing now needs only the ticket permission, the client is taken from the ticket (so the two can never disagree), and the expense starts life awaiting a decision.
- **[New]** **Approval is a real workflow, not a flag.** `Expense` gained a status (`submitted` → `approved` | `rejected`), who decided and when, and a reason. Approving needs the billing permission, a rejection has to say why, and an expense that already sits on an invoice cannot be deleted out from under it — 409 instead.
- **[New]** **Expenses gained the fields the plan asks for**: vendor, miles for mileage, and the parking/hardware/mileage/travel/software/other categories, validated rather than free text.
- **[New]** **The ticket's Expenses tab shows the decision state.** Filed costs appear with SUBMITTED/APPROVED/REJECTED badges, and Approve/Reject/Push appear only for someone who can act on them — the buttons follow the permission, so the page never offers what the API will refuse. A technician sees their own ticket's expenses without being handed the client-wide billing list, which stays closed to them.
- **[New]** **Approved expenses push to the connected accounting system** — and say so honestly when they cannot. The CloudConnect adapters read from their providers; none can create an expense, because every provider wants reference data the PSA does not own. So the push is explicit: an enabled QuickBooks or FlexPoint integration with a configured `expensePushUrl`, the request going out through the same egress policy as everything else, and the provider's id recorded against the expense. With no integration it answers "Connect QuickBooks or FlexPoint in CloudConnect first" rather than pretending; a URL the policy refuses is reported as a configuration problem, not a 500.
- **Verification:** 27/27 API assertions — the technician path, the client taken from the ticket rather than the request, category and amount validation, the client-wide list staying closed to a technician, a technician being unable to approve their own expense, a blank rejection refused, an unapproved expense refused for pushing, the push refused with a reason when nothing is connected, and then a real push against a local stub server checking the payload, the resolved client name and the bearer token. Plus the browser: a technician filed $18.75 of parking from the ticket tab and saw SUBMITTED, the administrator saw only Approve/Reject, approving turned it APPROVED and revealed Push, and Push surfaced the honest "no connected accounting system" message. Regression suite unchanged: 34/34 session, 13/13 scoping, 21/21 egress, 18/18 passkey, 24/24 time rules, `guard:routes` 334 routes/0 violations, both typechecks at baseline (API 152, web 0).
- **Rollback:** the new columns are additive with safe defaults, and filing/approval/push are separate endpoints — reverting the UI leaves the data intact and reverting the API returns the old three-endpoint behaviour.

## 2026.10.7.003 — Agreements that know their type, and a time engine that charges the evening hours properly
- **[New]** **Agreements now have a type, and it means something.** A service agreement can be a flat recurring service, a **block** of prepaid hours, a **Cyber Care** subscription with an allowance, or **spot** hourly work — with an hourly rate, which spot-rate tier it quotes, the hours included per period, and a running total of the hours spent. `POST`/`PATCH /api/billing/agreements` validate all of it (an unknown type, an impossible cut-off like `25:99` or a multiplier outside 1–5 are refused with a 400 rather than stored), and the New Agreement dialog asks for the type with the fields that belong to it.
- **[New]** **Overtime is weighted, not guessed.** Work after the agreement's cut-off — 18:00 local by default, configurable per agreement along with the multiplier — counts as overtime towards billing and towards the allowance. Two hours entirely after six o'clock is billed as **three**, which is the plan's own acceptance test and now the first assertion in the suite.
- **[New]** **Work that crosses midnight becomes two entries.** A timesheet that says "23:00–01:00 Tuesday" hides two different days of labour and every report downstream wants them apart, so the entry is split at midnight: the original keeps the pre-midnight stretch, the second row carries the rest, sits on its own work date, and points back at the first through `splitFrom`. Both hours are weighted as overtime, because a job that starts at 23:00 does not become cheaper when the clock rolls over.
- **[New]** **Block and Cyber Care allowances are spent by the same arithmetic as the invoice.** The four hours of an evening job that billed as six deduct six hours from the balance, not four. Goodwill and no-charge entries never touch it, and an entry recorded as a bare number of minutes (no clock attached) is never weighted, because there is nothing to compare with the cut-off.
- **[New]** **`TIME_RULES_ENABLED`, off by default.** With the flag off, every entry is stored exactly as typed: no weighting, no split, no balance movement, and `billedMinutes` stays null so "not computed" is distinguishable from "computed as zero".
- **Verification:** 24/24 API assertions on a throwaway client — the plan's acceptance case (2h post-18:00 → 3h deducted), a straddling window (17:00–19:00 → 120 minutes, 60 overtime, 150 billed), a daytime entry left alone, the overnight split with its `splitFrom` link, its own work date and both hours weighted, no-charge work leaving the balance untouched, bare minutes staying unweighted, and the three validation refusals. **Plus 9/9 with the flag off** (entry unchanged, nothing marked overtime, no split, balance untouched), which is what "additive and reversible" has to mean. In the browser: a block agreement created through the New Agreement dialog with an allowance and an 18:00/1.5 cut-off, read back from the API. Regression suite unchanged: 34/34 session, 13/13 scoping, 21/21 egress, 18/18 passkey, `guard:routes` 329 routes/0 violations, the six-persona permission matrix identical to the W1 baseline, both typechecks at baseline (API 152, web 0), preflight 0 failures.
- **Rollback:** set `TIME_RULES_ENABLED=false` — no data migration, no behavioural change, and existing entries are untouched either way, because nothing recomputes history. The new columns are additive (`agreementType` defaults to `service`, which behaves exactly as before).

## 2026.10.7.002 — Passkeys you can actually manage: see them, rename them, remove them — and a second device that works
- **[New]** **A Passkeys card in Settings.** It lists every passkey on the account with the device label, when it was added, when it was last used and how it authenticates (this device, phone or tablet, security key), and it lets the owner rename a device to something recognisable or remove one they no longer hold. Registration starts from the same card, and the label is filled in from the browser (`Chrome on Windows`) rather than left as "Passkey 2".
- **[New]** **The management API behind it** — `GET`, `PATCH` and `DELETE` on `/api/auth/webauthn/credentials`, every one of them scoped to the authenticated user, so a passkey can only be renamed or removed by the account that owns it. The key material never leaves the server: the list returns labels and timestamps, not the public key or the signature counter.
- **[Fix]** **Only the first passkey on an account ever worked.** Sign-in verification looked up *any* credential for the user rather than the one that signed the assertion, so a second device would have been verified against the first device's public key — and the counter update would have gone to the wrong row. The assertion now names the credential, and the right row gets the new counter and the last-used stamp.
- **[Fix]** **Registration and sign-in were calling the browser library the deprecated way.** `@simplewebauthn/browser` 13 wants `startRegistration({ optionsJSON })` and `startAuthentication({ optionsJSON })`; the old shape still worked but logged a warning on every ceremony, which is how it was caught.
- **[Update]** **A dismissed prompt now reads like a decision, not a failure.** Cancelling the passkey sheet says so and points back to the password, an unsupported browser says that instead of showing a button that cannot work, and a device that already holds a credential for the account is told to remove it first. The login page only offers the passkey button where the browser can use one.
- **[Update]** **The passkey endpoints have a rate limit** (PLAN-002 §5.4): 30 requests a minute per address, which stops a script without tripping an office behind one NAT. Verified by hammering it — the 31st request in a minute is refused with 429.
- **[Update]** **Production's environment template documents `SESSION_AUTH_ENABLED`**, the flag the session work introduced. `scripts/azure/preflight.mjs` caught the omission by comparing what the source reads against what the template lists.
- **Verification:** a **real WebAuthn ceremony** in a browser with a virtual authenticator — registered a passkey, saw it listed as "Chrome on Windows", renamed it to "Work laptop", signed out, signed in again with the passkey alone (cookie session, nothing in `localStorage`), and removed it — plus 18/18 API assertions covering the unauthenticated refusals, the blank-name and unknown-id cases, rename persistence, and that one account cannot rename or remove another's passkey. With `PASSKEY_ENABLED=false` every passkey route answers 404, which is the rollback. Regression suite unchanged: 34/34 session, 13/13 scoping, 21/21 egress, `guard:routes` clean at 329 routes, the six-persona permission matrix identical to the session-auth run, and the preflight at 0 failures.
- **Rollback:** `PASSKEY_ENABLED=false` on the API (routes answer 404) and `VITE_PASSKEY_ENABLED=false` for the UI; the `deviceName` and `lastUsedAt` columns are additive and stopping mid-way leaves passkeys working, only unlabelled.

## 2026.10.7.001 — Session authentication is live: a real session cookie, an inactivity clock, and a warning before it runs out
- **[New]** **Signing in now creates a session, not just a token.** `POST /api/auth/login` (and the MFA, passkey and SSO paths) sets an opaque session cookie that is `HttpOnly`, `SameSite=Strict` and `Secure` in production; the database stores only its SHA-256, so a stolen database copy cannot be replayed as a sign-in. Every write that rides on the cookie must also echo a CSRF token back in a header (double-submit, constant-time compare), the CSRF value lives in a cookie the scripts can read, and one live session per account is the rule — a new sign-in retires the previous one, which is the ConnectWise behaviour the plan asked for.
- **[New]** **Sessions end when they should.** Changing a password or having an administrator reset one ends every session for that account, deactivating a user does the same, and signing out ends the session **server-side** rather than only clearing the browser's cookie — a copied cookie cannot outlive the sign-out.
- **[New]** **An inactivity timeout that warns before it acts.** The idle clock is 30 minutes by default (configurable with the `session_timeout` setting) and runs server-side, where it cannot be edited away. The browser mirrors it: a minute before the deadline a modal appears with a live countdown, "Stay signed in" resets the server's clock (not just the modal), and "Sign out now" ends the session. Verified in the browser with a real countdown, a real extension that moved the database timestamp, and the terminal case.
- **[New]** **Administrators are exempt, and the browser is told so.** Admin and Super Admin sessions (plus the development bypass account) never expire from inactivity, matching the PSA convention used by Autotask and ConnectWise. The session endpoint reports that exemption as a zero timeout, so the browser never shows a warning for a timeout the server will not enforce.
- **[New]** **The sign-in page says why you are back.** A session that ended from inactivity or from being signed out elsewhere redirects to `/login?reason=timeout|expired`, and the page explains it in a banner instead of silently dropping you at a login form.
- **[Update]** **`authenticate` is session-first, and the old path still works.** A request is resolved from the cookie first and falls back to the existing bearer token untouched, which keeps the desktop shell, the Outlook add-in and scripts working — the desktop app cannot rely on cookies at all, because it loads the UI from `app://c7ntax`. The middleware grew a helper for the shared permission refresh and password-change gate, so all 326 guarded routes behave exactly as before.
- **[Update]** **The SPA keeps its token in memory, not in storage, whenever the cookie is usable.** Storage is only written when the browser cannot hold a cookie session (the desktop shell and add-in), which removes the long-lived token from `localStorage` in the normal browser case; the session bootstrap reads `/auth/session` and only trusts a stored token when there is no cookie session to prefer.
- **[Update]** **The verification harness grew instead of being rebuilt.** `probe-session.mjs` (34 assertions), the corrected write probes in `probe-permissions.mjs`, and `clean-probe-residue.ts` — which now also clears the sweep's knowledge-base, workflow, survey, report, client, locale and stale-session rows, still dry-run by default.
- **[Fix]** **The old session middleware was not just unmounted, it was broken.** It referenced a Prisma model that did not exist and was imported nowhere; it has been rewritten against a real `UserSession` table (migrated, not `db push`ed) and is the live path now.
- **Verification:** 34/34 session assertions (cookie attributes, CSRF accept/refuse, one-live-session, logout, token fallback, idle refusal with a 440 `SESSION_TIMEOUT`, the administrator exemption, the exemption reported to the browser, and a reset ending a live session), 13/13 scoping, 21/21 egress, `guard:routes` clean at 326 routes, and the six-persona permission matrix **identical** to the pre-change baseline. In the browser: a cookie session with no `c7_token` in storage, an internal write accepted through the real UI (201), the timeout modal with a live countdown, "Stay signed in" moving the server-side timestamp, a dead session landing on the sign-in page **with the reason shown**, and "Sign out now" ending the session. Database reports "up to date" after the migration; web typecheck 0 errors, API typecheck at baseline minus the three errors the broken file caused.
- **Rollback:** set `SESSION_AUTH_ENABLED=false` to return to token-only authentication without touching data, or revert this commit — the new table is additive, `UserSession` rows are disposable, and the bearer-token path was never removed.

## 2026.10.6.065 — The Azure deployment package: one image, two environments, and a pipeline that can promote them
- **[New]** **One container image serves the API and the web application.** `Dockerfile` installs the locked workspace, builds the SPA, and runs the API with the web build beside it: non-root, healthchecked, `--frozen-lockfile`, and diagnostics that say what is missing instead of failing silently. Verified properly — the image was built, run against the development database, and driven end to end (health, the SPA at `/` and on a client route, 404 for an unknown API path, login, tickets, users, service alerts).
- **[New]** **Production now has infrastructure, not just a plan.** `infra/main.bicep` creates the VNet with its subnets and NSG, Log Analytics, Key Vault with the three secrets, the container registry, a **VNet-injected PostgreSQL Flexible Server with no public endpoint**, the Container Apps environment and app, and the app's `AcrPull` and `Key Vault Secrets User` role assignments — so the app pulls its own image and reads its own secrets through managed identity, with no registry password or connection string in the deployment. Dev is Burstable/single-zone with 7-day backups; prod is General Purpose with zone-redundant HA, 35-day retention and geo-redundant backups. All three Bicep files **compile with no warnings** (`pnpm deploy:validate`).
- **[New]** **A deployment command that fails in the right order.** `scripts/azure/deploy-env.ps1` runs preflight → infrastructure → image → schema → a new revision at **0% traffic** → health gate → traffic shift, and prints the rollback revision if any step fails. Secrets are read from the shell's environment (or the pipeline's secret store) and land in Key Vault; the script refuses to run without them. `-WhatIf` prints the entire plan, which is how it was verified here.
- **[New]** **The schema can finally move dev → prod.** Production cannot be deployed with `db push`, and there was no migration history at all. `apps/api/prisma/migrations/0_init` (generated with `prisma migrate diff`) is the baseline, marked applied against the existing dev database, and `prisma migrate deploy` runs as its own pipeline step **before** the new revision takes traffic — so a bad release is still reversible by shifting traffic back.
- **[New]** **CI/CD: dev is automatic, prod is deliberate.** `.github/workflows/deploy-azure.yml` builds the image once, applies the schema, creates the revision at 0% traffic, gates on `/api/health`, then shifts and verifies — with the previous revision captured up front and restored automatically if any step fails. Prod only runs from a manual dispatch behind the GitHub `prod` environment's reviewers, which is the "Push to Prod" gate the plan describes. Authentication is OIDC federated credentials: no client secret in the repository.
- **[New]** **`node scripts/azure/preflight.mjs` catches deploy-day failures on the developer's machine**: stale lockfile, uncommitted files, a missing migration, an environment variable the source reads but nobody documented, an unguarded route, a new advisory, or an image that runs as root. It already earned its place twice — it caught the two undocumented variables the new web-serving code introduced and the missing `deploy-azure.yml`.
- **[New]** **The API can serve the SPA from its own origin** (`SERVE_WEB`), which is what makes one image possible: the CSP, the WebSocket path and the SSO redirects all already assume one origin. In development it stays off, so Vite remains the origin and the API stays an API — confirmed after the change (404 on `/` in dev, the SPA shell in the container).
- **[Update]** **`tsx` and `prisma` are runtime dependencies of the API**, not dev dependencies: the workspace packages publish TypeScript sources, so the container runs through `tsx`, and the migration step uses the Prisma CLI from the same image.
- **Verification:** the image builds and runs as a non-root user, answers `/api/health` 200, serves the built SPA from `/` and from a client route, keeps `/api/*` JSON-only (404/401 rather than the SPA shell), completes a login and reads real data from Postgres; `prisma migrate status` reports "up to date" from inside the image; `bicep build` reports no warnings on all three templates; `deploy-env.ps1` parses and its plan mode runs to completion; all three workflows parse; the preflight reports 0 failures; and the application itself is unchanged — the six-persona matrix is byte-identical to the previous step, 13/13 scoping and 21/21 egress assertions still pass, and both typechecks are at baseline.
- **Rollback:** delete `infra/`, `scripts/azure/`, `Dockerfile`, `.dockerignore` and `.github/workflows/deploy-azure.yml`; the migration baseline is additive (the dev database was marked, not altered) and `SERVE_WEB` defaults to off outside production.

## 2026.10.6.064 — Dependency wave: 128 advisories down to 4, none in the shipped product
- **[Fix]** **`nodemailer` 6 → 10, and the second copy nobody noticed.** `packages/email` moved to nodemailer 10, but `mailparser` carried its own nodemailer 9 — which still held eight advisories including two high — so `mailparser` went to 3.9.36, whose html-to-text 10.0.1 also clears the `deepmerge-ts` high. Verified by sending real mail: a probe runs a small SMTP server and drives `EmailService` through it, checking the envelope, subject, HTML body, inline `cid` attachment, multipart/alternative and the MFA path (10/10).
- **[Fix]** **`vite` 5 → 8 with `@vitejs/plugin-react` 6, and the dev server is no longer on the LAN.** The advisory on the 5.x line is a `server.fs.deny` bypass on Windows, made worse because the boot script started Vite with `--host`; the flag is gone, so the dev server now binds to localhost and says so. Vite 8 reports esbuild 0.28.2 and builds the app the same way (1926 modules).
- **[Fix]** **`react-router-dom` 6 → 7.** The 6.x line has no fix for two moderate advisories, and the upgrade turned out to be a drop-in: the app only uses `BrowserRouter`, `Routes`/`Route`, `Link`, `Navigate`, `useNavigate`, `useParams`, `useLocation` and `useSearchParams`, all of which are the same in v7. The React Router v6 future-flag console warnings are gone as a side effect.
- **[Fix]** **`electron` 33 → 44 and `electron-builder` 24 → 26**, with the desktop build script's `electronVersion` pin updated. This was 13 of the 25 high advisories; the portable build was then **run end to end** (105 MB installer produced) and the packaged app **launched** — main, renderer, GPU and utility processes all came up.
- **[Fix]** **The build tools' leftovers are gone too.** `electron-builder` 26 still pulls a stale `electron-builder-squirrel-windows@24.13.3`, which brought an old `app-builder-lib`, `builder-util-runtime` and `tar` 6 with it — nine tar advisories including the one critical. Targeted overrides (`app-builder-lib`, `builder-util-runtime`) resolve it. Also bumped: `uuid` 9 → 11, `turbo` 1 → 2 (with `pipeline` → `tasks` in `turbo.json`), and `mailparser`, plus overrides for `@xmldom/xmldom`, `js-yaml`, `source-map-js` and `tar`.
- **[Fix]** **Nested advisories come from the shadowed pnpm config.** Overrides were being ignored for transitive resolutions because the root `package.json` still carried a legacy `workspaces` field alongside `pnpm-workspace.yaml`, which makes pnpm 9 stop reading the `pnpm` field. Removing it is what actually took the tree from 8 advisories to 4 — and it explains why the previous pass's overrides looked applied in the lockfile but not in the tree.
- **[New]** **The audit is now a gate, not a report.** `security/audit-baseline.json` records every advisory with its scope (production vs build machine), `security/README.md` explains the rules and the four accepted risks with their reasons, and `pnpm guard:deps` fails on a new production advisory of any severity or a new high/critical one anywhere. It was proved to fail by removing an accepted entry (exit 1) before restoring it.
- **[New]** **CI runs the checks that must not be remembered.** `.github/workflows/security.yml` runs `guard:routes`, both typechecks, `guard:deps`, gitleaks and a trivy filesystem scan on every push and pull request to `main`.
- **Result:** advisories **128 → 4**, with **zero in production** (was 21); critical **2 → 0**; high **61 → 2** (both build-machine packages with no published fix). The four remaining are accepted with reasons: `braces`, `http-cache-semantics` and `sprintf-js` (no fix published, build machine only) and `postcss-selector-parser` (Tailwind 3 pins the 6.x line; revisit with Tailwind 4).
- **Verification:** both typechecks at baseline (API 155 pre-existing errors, none in changed code; web clean), the six-persona permission matrix byte-identical to the previous step, the SMTP probe 10/10, the Graph connector suite 37/37 and the EWS/delegated connector suite 69/69, the web app walked through six pages plus a query-string route with no failed requests or page errors, `pnpm guard:routes` 323 routes and zero violations, the dependency gate green, and the desktop installer built and launched. Two findings from that walk: the connector suites need `GRAPH_API_BASE=http://127.0.0.1:4600/v1.0`, `GRAPH_TOKEN_BASE`, `WEB_ORIGIN=http://127.0.0.1:3010` and the stub server running — without them the fixtures silently test against real Microsoft and fail for the wrong reason.
- **Rollback:** `git revert` this commit and run `pnpm install`; every bump is a manifest range, and the lockfile is regenerated rather than hand-edited. The `workspaces`-field removal and the overrides revert with it.

## 2026.10.6.063 — No sign-in token travels in a URL any more
- **[Fix]** **The invoice PDF no longer carries your session token in its address.** "Download PDF" opened `/api/billing/invoices/<id>/pdf?token=<jwt>`, so a twelve-hour credential landed in browser history, in the proxy log and in anything that records request lines. It now fetches with the `Authorization` header and opens the document from an in-memory blob, so the token never leaves the request header.
- **[Fix]** **`?token=` is no longer accepted anywhere on the API.** The auth middleware took a token from the query string for that one link; it now reads the `Authorization` header only. A request that presents a token in the query string is treated as unauthenticated.
- **[Fix]** **The SSO sign-in hand-off no longer puts the token in the redirect.** The OIDC callback used to bounce the browser to `/login?token=<jwt>` — the same exposure, on the route that creates a session. It now redirects with a **single-use, two-minute code** that the sign-in page exchanges for the token in the body of a POST; the code is compared in constant time, deleted on first use, and refused if it is stale or wrong. The token itself is never in a URL.
- **[Update]** **The tab is opened before the fetch, not after.** A browser only allows a popup raised while the click is still "active"; waiting for the response first loses that and the tab is silently blocked. The window is opened synchronously and pointed at the blob when the bytes arrive, with a file download as the fallback if the browser blocks the popup anyway.
- **Verification:** a live-API suite (14 assertions) proves `?token=` on the invoice route answers **401** while the same request with the header answers 200 and still returns the 5 KB invoice document with its original content type; the SSO code exchanges exactly once, and a reused, stale, wrong or missing code is refused **400**; and the browser was driven to confirm the button fetches without a token in the URL and produces the document blob. The six-persona permission matrix is identical to the previous step, `pnpm guard:routes` passes (323 routes, 0 violations), the API typecheck is at its 155-error baseline with none in the changed files, and the web typecheck is clean.
- **Rollback:** `git revert` this commit. Four files, no schema or data change.

## 2026.10.6.062 — Outbound requests go through one policy, and credentials stay out of the audit log
- **[New]** **One helper decides every outbound request** (`services/egress.ts`). The server fetches URLs that an administrator or an operator types in — an AI provider's endpoint, a status page, a monitor URL, an SSO issuer — and each of those could previously be aimed at the metadata service, an internal admin panel or a database port, with the stored API key travelling along on the inference call. Requests are now http(s) only (https for anything public), loopback/RFC1918/link-local destinations are refused before a socket opens, **every address a hostname resolves to** is checked so a public name cannot point inward, and every call carries a timeout.
- **[Fix]** **A refused redirect would have quietly broken a live data source, so redirects are followed and each hop re-validated instead.** The first version refused every redirect; the Google Workspace status feed answers 301, so the monitor lost that source and said so. Redirects are now walked one hop at a time — up to three — with the address policy applied to each target, so a public URL still works while a redirect into a private range is refused.
- **[Update]** **URLs are validated where they are saved, not only where they are used.** Creating or editing an AI provider or an alert service returns a 400 with a readable reason ("169.254.169.254 is a link-local address, which is never allowed"; "10.0.0.7 is a private address, which is not allowed") and stores nothing — so a refused value can never be half-saved, and a stored value that predates the policy is still stopped at call time (the inference layer then falls back to keyword suggestions instead of failing).
- **[Update]** **The ssl and dns monitors apply the same policy.** They open a socket and resolve a name directly rather than using `fetch`, so they check the address themselves instead of relying on the fetch helper.
- **[New]** **A local model server can be allowed deliberately, and the metadata service never can.** `EGRESS_ALLOW_PRIVATE=true` — development only, refused in production — relaxes loopback and RFC1918 for a local Ollama-style endpoint, but link-local (`169.254.0.0/16`) stays blocked in every configuration, so the allow-list cannot be turned into a metadata leak.
- **[Fix]** **API keys can no longer be written into the audit trail.** The audit middleware redacted `password`, `secret`, `privateKey`, `iv` and `authTag` by exact name, so `apiKey` went into the row in clear — visible in the audit log of the very change this step was hardening. Redaction now matches secret-*looking* names case- and separator-insensitively (`apiKey`, `api_key`, `accessToken`, `refresh_token`, `webhookSecret`, `smtp_password`, `signingKey`, …) while still recording lookalikes such as `tokenVersion`.
- **[New]** **Every outbound attempt is logged with its outcome** — the purpose, the URL, the status and the elapsed time, or the refusal and why — so an SSRF attempt is visible after the fact rather than inferred from a failed feature.
- **Verification:** a 28-assertion policy probe (metadata, loopback, RFC1918, IPv6 loopback and mapped addresses, `file://`, plain http, garbage, a name that resolves to `127.0.0.1`, an unresolvable name, a redirect into the metadata service via a local redirect server, and the private opt-in) and a 21-assertion live-API suite (four blocked endpoint shapes refused on create, a blocked update refused without changing the stored value, a legitimate https endpoint still accepted, `***` in the audit row while `model` is still recorded, and the alert monitor resolving all 14 configured services with no egress refusals). Provider and alert-service residue was removed and the snapshots re-captured. Typecheck at the 155-error baseline, none in the changed files; the six-persona permission matrix is identical to the previous step; `pnpm guard:routes` still reports 322 routes and zero violations.
- **Rollback:** `git revert` this commit. No schema or data changed; the only environment addition is the optional `EGRESS_ALLOW_PRIVATE` flag, which defaults to off.

## 2026.10.6.061 — A guard rail so an unguarded route can never ship again
- **[New]** **`pnpm guard:routes` fails the build on any authenticated route without a permission check.** PLAN-018's actual root cause was not one missing permission — it was thirteen routers that imported `requirePermission` and never called it, with nothing in the build that could notice. The check walks every route declaration in `apps/api/src/routes`, reads the middleware between the path and the handler, and reports anything reachable by a signed-in account with no permission; routes that are deliberately open must be listed in the script with a reason. It reports **322 routes, 293 carrying a permission, zero violations**, and exits non-zero otherwise.
- **[New]** **The exemption list is the documentation.** Five files are open on purpose and now say why in one place: `auth.ts` (credential routes run before a session exists), `webauthn.ts` (passkey registration still requires a session and identifies the user from the token), `ssoExchange.ts` (state-validated OIDC callback), `push.ts` (a user's own device subscriptions), `tenants.ts` (deferred with multi-tenant) — plus the three documented `/system` reads the SPA needs and the self-service config keys.
- **[Fix]** **Four routes the audit had logged as "still open" are closed**, and the check found them rather than my memory: webhook delivery logs now require `SystemConfig`, bulk operations require `TicketView`/`TicketEdit`, and the role permission catalogue requires `RoleManage`.
- **[Update]** **A second dead-roles router was found while wiring that last guard**, and it is the same class of trap as the bulk webhook routes: `users.ts` declares its own `rolesRouter` with a handful of routes, nothing imports it — `index.ts` mounts the one from `roles.ts` — and the SPA reads `PERMISSION_CATEGORIES` straight from `@C7NTAX/shared`, so those routes are simply unreachable. They are guarded and commented rather than deleted in a security step; removing the block is a listed follow-up.
- **Verification:** the check passes on the current tree, and it was **proved to fail** by copying `clients.ts` with its guards stripped and running it again — 12 violations, exit code 1 — then restoring. Typecheck at baseline, the six-persona permission matrix byte-identical to the previous step, 13/13 scoping assertions and 63/63 user-administration checks still pass, and the four newly guarded routes were spot-checked live (technician 403 / admin 200 on webhook deliveries, technician 403 / admin 200 on the catalogue).
- **Rollback:** delete `scripts/check-route-guards.mjs` and the `guard:routes` script entry; the four new guards revert with their routes.

## 2026.10.6.060 — A client-scoped account can only ever see its own company
- **[Fix]** **Permission was not the whole story: the modules were still serving every company's rows.** A scoped account could read its own client record *and* every other client's, their contacts, their agreements, their Kumo summary, their invoices and expenses — and, worst of all, the reporting endpoints, where revenue, SLA compliance, ticket volume and contract profitability are aggregated across the whole business. Those are now narrowed by company for any account that carries one, following the convention already used for tickets: internal staff have no `companyId` and see everything, a scoped account sees its own company.
- **[New]** **One place that decides the boundary** (`middleware/companyScope.ts`): a `where` fragment to merge into list, count and aggregate queries, a guard for a single record that answers **404 rather than 403** — an id that exists but is not yours must look exactly like an id that does not exist — and a variant for models (time entries) that reach a company through their ticket.
- **[Update]** **Client records are narrowed by id, not by company.** The `Company` table *is* the company, so scoping it by a `companyId` column is an invalid query — which is exactly what a scoped account hit the first time it asked for the client list: a 500. The scoping helper now has a documented company-row variant, and the mistake is the reason the verification is assertion-based rather than a status-code check.
- **[Update]** **Billing and expenses gained real gates while being scoped**: the finance dashboard, the quote endpoints and expense create/delete now require the billing permissions and check that the invoice, quote or expense belongs to the caller's company; the invoice PDF and payment-recording routes now share the same check as everything else instead of their own copy.
- **[Fix]** **The credential rate limiter no longer trips on your own test suites.** Signing in repeatedly from `127.0.0.1` in development exhausted the 300-per-15-minute bucket mid-suite and produced a cascade of 429s that looked like a regression; loopback requests are now exempt **in development only**, and production keeps the limit exactly as it was.
- **Verification:** a dedicated scoping suite — 13 assertions, all passing — signs in as a client-scoped account and an internal one, and proves: the scoped account sees 1 client where internal staff see 5; another company's client record answers **404**; another company's contacts and agreements come back **empty**; every contact and invoice returned belongs to its own company; its revenue figure is not the whole business's; internal staff are unaffected; and a technician scoped to one client sees only that client's tickets. The permission matrix is byte-identical to the previous step's, both typechecks are at baseline, 63/63 user-administration checks pass, and the six-persona sweep is unchanged.
- **Rollback:** `git revert` this commit — the scoping is a `where` fragment per query plus a guard per single-record route, and no schema or data changed.

## 2026.10.6.059 — Every module enforces a permission, and the navigation agrees with it
- **[Fix]** **The API now checks a permission on 265 routes, up from 164.** Thirteen routers mounted `authenticate` and nothing else, which meant any signed-in account — including a client contact — could read the knowledge base, internal chat sessions, surveys, workflow rules, alerts, AI actions, inference providers and their stored keys, the revenue and SLA report data per company, SSO configuration, the audit log, and every client's record; and could write to most of them. Each route now carries the permission its module was designed around: reads take the module's **View** permission, writes take the **Create/Edit/Delete/Manage** capability, and administration takes `SystemConfig`, `UserManage`, `RoleManage` or `SecurityManage`.
- **[Fix]** **System administration is now genuinely administrative.** `/system` had one guarded route out of 29; the failover reset, locale, translation, exchange-rate, retention-policy, field-permission, calendar-sync and poller/snapshot-poller controls — all writes — plus their unused read counterparts now require `SystemConfig`. Deliberately left open, and recorded in the plan as carve-outs: `GET/PATCH /system/config/:key` (the self-service keys and the app-wide context-menu flag, protected per key by the existing guard), `GET /system/changelog` (What's New) and `GET /system/audit-logs` (every ticket's Audit Trail tab).
- **[Fix]** **Three routers the original audit list had missed** are now gated too: asset inventory (`Asset*`), time off (`PTOView`/`PTORequest`/`PTOApprove`) and the Outlook add-in's ticket endpoint (`TicketCreate`). Four remain unguarded on purpose and each is defensible — `auth.ts` (the credential routes), `webauthn.ts` (passkey registration and sign-in; registration still requires a signed-in session and identifies the user from the token, not the body), `ssoExchange.ts` (the OIDC callback, which validates its state) and `push.ts` (a user's own device subscriptions).
- **[New]** **The navigation no longer advertises what the API refuses.** Every nav entry carries the permission its page needs, and the sidebar — plus the ⌘K command palette — filters against the signed-in role's permission set, dropping a group once all of its children are gone. A technician now sees Tickets, Service Boards, Clients, Assets, Projects, KB and Reporting but no Billing, Kumo, Pipeline, Users & Roles or Time Off, which matches exactly what the API returns for that role. Denied *actions* (a POST/PATCH/DELETE) surface the API's message as a toast; denied background reads stay silent, since pages already decide how to degrade.
- **Verification:** a six-persona harness (`super_admin`, `admin`, `technician`, `read_only`, and client- and technician-scoped personas) sweeps 40 endpoints per persona, and its status matrix was captured before any change and diffed after every step — every difference reviewed individually, with no unintended denials and no 5xx. Admin and Super Admin lose nothing; the seeded role rows were reconciled with their declared permissions first (2026.10.6.058), which is what made the gates safe to apply. 63/63 user-administration checks and 15 authenticated endpoints still pass, and both typechecks are at baseline. The navigation was checked in the browser for four roles, where it exposed a bug in the filter itself — a group's own permission was ignored when it had children, so Billing and Kumo stayed visible to a technician until that was fixed.
- **Rollback:** `git revert` this commit. The guards are additive per route (one middleware argument each) and no schema or data changed, so reverting restores the previous behaviour exactly; the navigation simply shows everything again.
- **Still open in this wave:** company scoping (a client-scoped user is still served every company's rows by the unpaged list endpoints), the route-guard test that fails the build on a new unguarded route, `alertWebhooks /deliveries`, `billing` dashboard/quotes/recurring/expenses, `bulk`, `users/permissions/catalog` and `tenants` — all small, and next.

## 2026.10.6.058 — Roles now hold the permissions they were always meant to have
- **[Fix]** **Every built-in role had drifted from its declared permission set, so the app disagreed with itself about who may do what.** `ROLE_PERMISSIONS` in `@C7NTAX/shared` is the source of truth, but the seeded role rows were written out by hand in `seed-full.ts` and had fallen behind: **Admin was missing 22 permissions** (all of contacts, contracts, agreements, surveys, chat, workflows and payment processing), **Technician was missing seven** it needs daily — knowledge base, contacts, projects, assets, schedule, chat and AI inference suggestions — **Client Admin** was missing ticket close, contacts, projects, assets, KB, schedule and reports, and **Read Only** was missing contacts, billing, projects, assets, KB and schedule. Nothing surfacing this drift was visible until now, because most of those routes were never gated; any permission gate built on top of the drifted rows would have locked the wrong people out.
- **[Fix]** **Super Admin could not see Service Alerts** while Admin could — the role was missing `servicealert:view` and `servicealert:manage`, the only two permissions it lacked. Confirmed from the live API before the change (403 for Super Admin, 200 for Admin on the same endpoint) and 200 for both after.
- **[New]** **A repeatable reconciliation instead of a one-off hand edit.** `seed-role-permissions.ts` merges `ROLE_PERMISSIONS` into every stored role **additively** — nothing is ever removed, so the worst case of a mistake is a role that can do slightly more than intended rather than one that silently cannot work — with a `--dry-run` that reports the diff before it is applied. `seed-full.ts` now reads the same table instead of duplicating 80-element arrays, so a freshly seeded database cannot drift again.
- **[Update]** **Three deliberate narrowings, recorded in the intent table itself** rather than applied silently by the sync: `TicketViewAll` was removed from the Technician default, because internal technicians already see every ticket by carrying no company (the convention in `tickets/index.ts`) while a technician scoped to one client must not see the rest; and `ChatView` and the PTO permissions were removed from the two client-facing roles, since both are internal surfaces a client contact has no business in.
- **Verification:** a six-persona harness (`super_admin`, `admin`, `technician`, `read_only`, client-scoped `client_admin`, client-scoped `technician`) signs in as each and sweeps 40 representative endpoints across every module, before and after. The diff is exactly four lines and every one is intended: Super Admin gains Service Alerts, and Read Only gains the read-only billing/contract/quote views its declared role includes. No 5xx anywhere, no other endpoint changed, and the two scoped personas still reach their tickets and clients.
- **Rollback:** `git revert` this commit restores the previous role rows from the snapshot fixtures and the previous intent table. The sync is additive, so nothing needs to be deleted to undo it by hand.

## 2026.10.6.057 — One account can be exempted from the login interruptions, for testing only
- **[New]** **A development-only bypass for a single account.** Waiting out a session expiry, getting locked out after a handful of bad passwords, or being stopped by a "choose a new password" prompt in the middle of clicking through the app is friction that has nothing to do with what is being tested — so one account can now be exempted from all four interruptions at once: the session expiry, the failed-attempt lockout, the sign-in rate limit, and the forced password change. The exempt account also gets a long-lived token (**720 hours** by default), which matters because turning `AUTH_HARDENING_ENABLED` on drops every session to **15 minutes** — the expiry that would otherwise end a testing session mid-task. A sign-in that finds a stale lock or a failed-attempt counter on the exempt account clears it, so a previous run cannot leave the account looking locked in the UI.
- **[New]** **Configured with two environment variables, and impossible to leave on by accident.** `AUTH_TEST_BYPASS=true` plus `AUTH_TEST_BYPASS_ACCOUNT=<email>` in `apps/api/.env`, with an optional `AUTH_TEST_BYPASS_TOKEN_TTL`. It matches **one account, not a role** — an admin-wide rule would quietly exempt every administrator — the API **refuses to start at all in production** with the flag set, refuses to start half-configured (flag without an account), prints a loud warning on every boot while it is active, and logs each sign-in as the exempt account. `/api/auth/me` reports `testBypass: true` for it so the state is checkable rather than assumed. Setting `AUTH_TEST_BYPASS=false` (or deleting the lines) switches it off, and behaviour returns to normal on the next restart.
- **[Update]** **The sign-in rate limit gained a skip rule** rather than a raised ceiling. The exempt account is not limited, but only on requests it has already authenticated or from **this machine** — the limiter has to match on the submitted email before authentication exists, so allowing any caller to skip it by typing that address would have turned the exemption into a way around the limit. `rateLimiter` now takes an optional predicate used by the credential endpoints; every other endpoint's limiting is untouched.
- **[Update]** **The account-scoped exemption is wired into the session middleware too**, alongside the existing admin bypass, so when sessions are mounted the same account keeps its exemption instead of needing a second change.
- **Verification:** with the bypass on, the exempt account signs in (200), receives a 720-hour token, reports `testBypass: true`, survives **six** wrong passwords and seven failed attempts with the counter still at **0** and no lock in the database, signs in even when the row is already marked locked (then clears it), and reaches a protected endpoint with `mustChangePassword` set. With the bypass off (`AUTH_TEST_BYPASS=false AUTH_HARDENING_ENABLED=true`, a second instance on port 4100), the same account gets a **15-minute** token, reports no bypass, is **locked after five bad passwords with HTTP 423**, and gets **403 `PASSWORD_CHANGE_REQUIRED`** from the same protected endpoint — so the flag demonstrably gates every one of the four behaviours rather than being decorative. A production boot (`NODE_ENV=production`) **throws**, as does a flag with no account configured. Regression: 63/63 user-administration checks and 15 authenticated endpoints still pass, and the exempt account's row was confirmed back to `loginAttempts: 0, isLocked: false, mustChangePassword: false` afterwards.
- **Rollback:** delete `apps/api/src/services/testBypass.ts` and its three call sites (`signToken`, the password-change gate, the credential limiter, the login lockout) and remove the two variables from `apps/api/.env`. Nothing in the schema changed, and no other code path depends on the module.

## 2026.10.6.056 — The collapsed sidebar's user footer no longer collides
- **[Fix]** **The sign-out button and your initials were drawn on top of each other in the collapsed sidebar.** The button was positioned absolutely `bottom-3` inside the footer, which is the last block of a full-height sidebar — so its 12px offset landed in exactly the same place as the centred avatar the footer already draws there, leaving the icons superimposed and the sign-out target hanging over the avatar. The collapsed footer is now a centred column — avatar, then sign-out beneath it — and the absolute positioning is gone.
- **[Fix]** **It was also a hit-target problem, not just a cosmetic one**: the button was the later sibling, so it painted over the avatar, while the avatar's own centre resolved to the button's icon. Both elements now sit fully inside the footer with a 6px gap, each is the topmost element at its own centre, and the footer grew from 53px to 79px — the nav is a `flex-1 overflow-y-auto` sibling, so it simply reclaims less height and still scrolls every item into view rather than letting the last few hide behind the footer.
- **Verification:** element-by-element hit testing of the live collapsed sidebar (`elementFromPoint` at each element's centre) reports **no occluded elements** — before the fix it reported the sign-out button and its icon both covered by the "AU" avatar; after, the avatar and button do not intersect, both are the topmost at their own centre, and both are inside the footer bounds. The expanded footer (avatar, name, email, sign-out in a row) is unchanged and its button still hit-tests to itself; the last nav item scrolls fully into view above the footer; web typecheck clean (0 errors).
- **Rollback:** restore `justify-center` and the `absolute bottom-3` class on the collapsed sign-out button in `apps/web/src/components/Layout.tsx`.

## 2026.10.6.055 — Service Alerts stands out in the left nav
- **[Update]** **Service Alerts now reads as an alert channel, not a page.** Its label and its warning-triangle icon carry the alert colour in the sidebar instead of the neutral nav grey, so the section is findable at a glance next to Tickets, Service Boards and Pipeline — which keep the grey. It stays red when the row is active or hovered (the red is the point), and the collapsed icon-only sidebar colours the icon too. The colour is the theme-aware `--alert-red` token the count badge already uses, so in the dark themes the label, the icon and the badge are the same red, and in the light themes it darkens to `#a30000` on its own.
- **[Update]** **Contrast checked in both themes rather than eyeballed**: `#ef4444` measures **5.1:1** on the active row surface and **5.6:1** on the sidebar itself in the dark (crimson) palette, and `#a30000` measures **9.1:1** in the light palettes — all above the 4.5:1 AA threshold for the 14px medium label, so the accent does not cost legibility.
- **Verification:** web typecheck clean (0 errors); the rendered colours were read from the live DOM in both themes (`rgb(239, 68, 68)` label and icon in dark, `rgb(163, 0, 0)` in light, with Tickets still `rgb(154, 154, 164)`), and the sidebar was checked both expanded and collapsed.
- **Rollback:** revert the two conditional classes in `apps/web/src/components/Layout.tsx` (`renderNode`).

## 2026.10.6.054 — Closing the exploitable paths from the security audit, without changing how the app behaves
- **[Fix]** **Stored XSS in the invoice "PDF".** The endpoint builds its HTML with string interpolation and serves it as `text/html`, so a line-item description, a payment method or a payment reference containing `<img src=x onerror=…>` executed in the browser of the admin or manager who opened the invoice — and because the API and the SPA share an origin, that script could read the JWT straight out of `localStorage`. Every interpolated value (line items, payment method and reference, invoice number, company name and email, currency, status) is now escaped with the `escapeHtml` that already existed in the email service; the invoice's real content renders exactly as before.
- **[Fix]** **Any signed-in account could read and rewrite system configuration.** `GET /api/system/configs` now requires `SystemConfig`, and both configuration write paths refuse reserved prefixes (`email_connector:`, `oauth`, `sso:`, `sample_data`) and any key whose name looks like a secret (`secret`, `token`, `password`, `credential`, `apikey`, `private_key`). This is deliberately **not** a blanket router guard: four `/api/system` routes are read by the SPA for every signed-in user — the context-menu flag, What's New, a ticket's Audit Trail tab and failover status — and three keys are legitimately self-service, so those paths are untouched and were verified working afterwards. Which of the remaining sub-routes need a gate is a decision, not a guess, and it is recorded as open in `PLAN-018`.
- **[Fix]** **Every webhook's HMAC signing secret was returned to any authenticated user** by the alert-webhook list. The list now requires `SystemConfig` and strips `secret`. The `/bulk/webhooks` copy of that route turns out to be unreachable — `/bulk/:id` is registered first and shadows it — so that route is now correctly guarded but dead; the plan records the correction.
- **[Fix]** **Managing users was a route to becoming an administrator.** `PATCH /api/users/:id` accepted `role` and a raw `permissions` array for any user including the caller on nothing more than `UserManage`, which managers hold. Role, `roleId` and permission changes now require `RoleManage`, nobody can change their own role or permissions (including deactivating themselves), and a user cannot be created into or moved into an administrative role — one carrying `role:manage` or `system:config` — without `RoleManage`. Editing a profile and creating an ordinary technician still work exactly as before, and the admin path was regression-tested. The escalation was latent rather than live: no role in the seed holds `user:manage` without `role:manage`, so it was one custom role away.
- **[Fix]** **Sign-in hardening, with the two behaviour changes kept behind a switch.** `authenticate` now fails closed — a database error returns 401 instead of continuing on the token's stale permissions — and the API refuses to boot in production with a missing `JWT_SECRET` or with the public fallback value, warning instead when `KUMO_MASTER_KEY` is unset (the Kumo vault key is derived from the JWT secret in that case). Morgan redacts `?token=` from the request lines it logs. Email-MFA codes come from the CSPRNG and are compared in constant time. The credential endpoints — `/auth/login`, MFA verify, verify-email, send-MFA-email and change-password — have their own limiter (300 per 15 minutes per IP) rather than relying on the effectively-off global one. Account lockout (5 attempts, HTTP 423) is fully implemented but **defaults to off** behind `AUTH_HARDENING_ENABLED`, so the current "call the service desk" flow and the existing Security-tab locked state are unchanged until it is switched on deliberately.
- **[Fix]** **SSO could be used to mint an administrator.** The OIDC `state` that the flow generated was never checked on the callback, and an unknown identity was provisioned with the **admin** role. The state is now persisted and validated single-use with a 10-minute expiry, unknown identities arrive **inactive and read-only** and are refused with 403 until an administrator enables them, and the role claim no longer falls back to `admin`.
- **[Update]** **Dependencies: 128 advisory instances down to 99.** `mjml` and `node-forge` are gone — neither was ever called, and removing them took 198 packages with them, including the unpatched `html-minifier` and `deepmerge-ts`; `morgan` → 1.12.1, `axios` → 1.20.0 (web and integrations), `react-router-dom` → 6.30.6, `dompurify` → 3.4.16, and root `pnpm.overrides` now pin `proxy-addr` 2.0.8, `brace-expansion` in both of its major lines, `semver` 5.7.2 and `qs` 6.16.0 — each pinned inside the major version it was already on, so nothing else in the tree shifts. The remaining majors (`nodemailer` 6→10, `vite`/`esbuild`, `electron` plus `electron-builder`) and the committed audit baseline are deliberately left for their own change window.
- **[Update]** **`PLAN-018` now says what actually shipped** — a Phase 0 status table marking each of the twelve items done, partial or open, with the four `/api/system` carve-outs written down so a future pass does not break the app by "finishing" the fix, the `bulk.ts` shadowing correction, the re-rated A4 severity, and the exact verification used.
- **Verification:** 63/63 checks in the user-administration probe suite and 15/15 authenticated endpoints still 200 — no regression from the role guards or the fail-closed auth middleware; a purpose-built 28-check security probe (config dump 403 for a technician and 200 for an admin, reserved and secret-looking keys refused, self-service keys still writable, webhook list 403 and secret-free, self-promotion / role-granting / promoting others / creating administrators all 403 while profile edits and technician creation still succeed, bad password still a plain 401); an invoice probe that seeds a hostile invoice and asserts the escaping while the real content still renders (8/8); browser walkthrough of nineteen routes including every page behind the carve-outs; web typecheck 0 errors and the API unchanged at its 155-error baseline; probe users, probe roles and their audit rows deleted from the database and the snapshots re-captured clean.
- **Rollback:** every Phase 0 fix is a single-file edit — revert the file. The dependency work reverts with the lockfile and `pnpm install --frozen-lockfile`; the removals can stay even if a major is backed out. Lockout and SSO hardening are already inert or additive: flipping `AUTH_HARDENING_ENABLED` off restores the previous login behaviour with no deploy.

## 2026.10.6.053 — Security audit: every CVE in the dependency tree, and the exploitable paths in our own code
- **[New]** **A full dependency-CVE audit against the CVE Project's database, filtered to what we actually ship.** Every workspace's real dependency closure was rebuilt from `pnpm-lock.yaml` (911 dependencies) and matched against the advisory data, then each finding was re-read from the primary `CVEProject/cvelistv5` record for its CWE, affected range and patch version, and finally checked against the code to see whether the vulnerable function is ever called. `pnpm audit` reports 128 advisory instances; **26 survive the reachability filter**, split into the production API, the browser bundle, the Electron desktop runtime and build-only tooling. The short version: **1 critical and 16 high in code we ship**, the worst of them being `electron` 33 (38 advisories, including ASAR-integrity bypass) which is already installed on users' machines, `nodemailer` 6 reaching the address parser with addresses taken from inbound email, `axios` 1.19, and a critical `proxy-addr` IP-spoofing bug that is harmless today **only** because `trust proxy` is unset — i.e. it arms itself the moment the planned reverse-proxy deployment lands.
- **[New]** **Three dependencies are dead weight carrying CVEs.** `node-forge` (a signature-verification forgery with no upstream fix) is never referenced anywhere in `packages/integrations`; `mjml` (with `html-minifier`'s unpatched ReDoS and `deepmerge-ts`' stack exhaustion behind it) is never compiled — a comment in the email package even says production "should use MJML". Removing both clears three of the high findings outright, and `dompurify` is declared in the web app but never imported, which is the opposite problem: it should be in the render path.
- **[New]** **An adversarial pass over our own code found two critical authorization holes and a stored XSS.** `/api/system/*` and the `clients`, `reports`, `kb`, `chat`, `surveys`, `workflows`, `alerts`, `aiActions` and `bulk` routers mount `authenticate` and then never call the `requirePermission` they import — with no company scoping either, so **any signed-in account, including a client contact, can read or delete every company's records and rewrite system config**. The invoice "PDF" endpoint builds HTML by string interpolation and serves it as `text/html`, so a line-item description or payment reference becomes script execution in the browser of the admin who opens the invoice. `PATCH /api/users/:id` needs only `UserManage` (which managers hold) but accepts `role` and a raw `permissions` array for any user including the caller, so a manager can promote themselves to super admin. The OIDC callback never validates the `state` it generates and provisions unknown identities with the **admin** role. Also confirmed: `authenticate` fails open on a database error, failed logins are never counted (the Security tab's "Account Locked" state has nothing behind it), the global rate limiter is `9999` per minute, `GET /api/alert-webhooks` returns each webhook's HMAC secret to any authenticated user, and the JWT fallback secret is a public constant that also derives the Kumo vault key when `KUMO_MASTER_KEY` is unset.
- **[New]** **The remediation is planned as `PLAN-018`, positioned as Wave 0 — ahead of the cloud split.** Phase 0 is twelve single-file fixes (permission gates, output escaping, the role-escalation guard, SSO state and provisioning, fail-closed auth, account lockout, per-endpoint rate limits, no token in query strings). Phase 1 is one dependency PR: remove the dead packages, upgrade `nodemailer` 6→10, `axios`, `electron` (plus the pinned `electronVersion`) and `electron-builder` 24→26, and pin the transitive fixes with `pnpm.overrides`, recording the four upstream-unfixed advisories as explicit accepted risks with their reachability reasoning. Phase 2 covers the structural causes — one egress helper with a host allow-list, Redis-backed rate limiting, HttpOnly session cookies instead of `localStorage`, defence-in-depth rendering, and company scoping as middleware rather than per-route discipline. Phase 3 puts the whole thing on a CI gate with a committed audit baseline, secret scanning and grouped update PRs.
- **[Update]** `PlanDocs/README.md` gained the new Wave 0 row, the registry entry for PLAN-018, and a note explaining why a security wave sits ahead of every feature wave.
- **Verification:** this change is documentation only — no code, schema, dependency or data was modified. The audit is reproducible from the commands in the document's Appendix B; the tiering was validated by re-running the closure and range filter across all seven workspaces, and each application finding was verified by reading the route in question (the `requirePermission` counts, the invoice template, the SSO callback, the login path, and the webhook list query are quoted with line numbers in §2 of the plan).
- **Rollback:** documentation only — delete `PlanDocs/PLAN-018-*.md` and revert the registry row.

## 2026.10.6.052 — Resetting a user's password, and a New User dialog that matches how PSA tools create people
- **[New]** **Reset password** — from the right-click menu on any row in Manage Users, or from the new **Password** section at the top of a user's **Security** tab. A reset can either generate a 20-character temporary password (shown once with a copy button, never retrievable later) or set one you type, and it does the three things a "I can't get in" call needs in one pass: it unlocks the account and clears the failed sign-in counter, requires a new password at the next sign-in by default, and can email the details to the user. Reusing the current password is refused, the policy is enforced on anything typed, and the dialog says whether MFA will still be needed afterwards.
- **[New]** **Changing your own password, and being made to.** Anyone handed a temporary password is stopped at a **"choose a new password"** screen after signing in — the API refuses every other route until it is done, so the change can't be skipped by navigating somewhere else or by signing in with a passkey or SSO instead. The change screen shows the live policy checklist and a strength meter, rejects a wrong current password, a weak new one, or reusing the old one, and then signs the session straight back in. **Every other session signed in with the old password is retired at the same time**, which also closes the gap where a password change previously left existing tokens working until they expired.
- **[New]** **A shared password policy** (`MIN_PASSWORD_LENGTH` and `validatePassword` in `@C7NTAX/shared`) now governs the New User dialog, an administrator's reset and a user's own change, so the rules, the message shown and what the API accepts can no longer disagree: at least 12 characters, three of the four character classes, no common passwords, and nothing containing the person's own name or email address. The dialogs show it as a live checklist with a strength bar.
- **[Update]** **The New User dialog is rebuilt** into three tabs, following how Autotask resources and Asio members are created. **Profile** takes identity and placement — first/last name (now genuinely required), email, username, job title, department, phone, mobile, time zone (the browser's full zone list) and reporting manager — plus a **Client** picker that distinguishes internal staff from a client contact. **Access** picks the role from cards showing each role's permission count, can copy the whole arrangement from an existing user, and sets the account Active or Inactive. **Credentials** chooses how the first password arrives: generate one and hand it over, type one yourself, or email it to the person (in which case you never see it, and if SMTP fails the password is shown to you instead). Creating ends on a panel with the temporary password, a copy button and **Create another**, which keeps the role and placement for the next person.
- **[Update]** **The user detail panel gained the new fields**: a **Placement** section on the Profile tab (department, time zone, reporting manager) that is editable, and a **Password** section on the Security tab showing when the password last changed, a "Change pending" badge while a reset is outstanding, and the reset button. The ad-hoc password box that used to sit inside the Profile tab's edit mode is gone — every password change now goes through the reset flow, so the policy and the audit trail can't be bypassed. **Reset MFA** is also reachable from the Security tab as well as the right-click menu.
- **[Fix]** **Creating a user without a first or last name failed inside the database** with a raw Prisma error, because those columns are required but only the password and email were checked. Creation now validates the name, email format, role and manager up front and returns a readable message, reports a duplicate username (not just a duplicate email) as a conflict, compares emails case-insensitively, and refuses to let you deactivate your own account.
- **[Update]** **The seeded staff now carry placement data** (department, time zone and a reporting line — Leadership ← Service Desk/Field Services/Professional Services), so the new fields are populated everywhere they appear rather than showing blanks, and the change is captured into the snapshot used for reseeding.
- **Verification:** 63/63 checks in a live API probe suite covering every credential mode, the policy rules, invite-without-reveal, the forced change, token retirement after a reset, unlock-on-reset, the guard rails on PATCH, and the list shape; 15 authenticated endpoints across tickets, clients, kumo, billing, contracts, projects and reports still return 200 (no regression from the session-validity check now in the auth middleware); browser walkthrough of the right-click menu entry, both dialogs, the Security-tab section, and the forced-change gate end to end including the mismatch error and the successful change; web and API typechecks clean (web 0 errors, API unchanged at its 155-error baseline, none in the touched files); `prisma db push` + client regeneration; probe users and their audit rows removed from the database and the snapshot re-captured clean.
- **Rollback:** revert this change and run `prisma db push` — the added `User` columns (`mustChangePassword`, `passwordChangedAt`, `tokenVersion`, `department`, `timezone`, `reportsToId`) are additive and nullable-or-defaulted, and no existing data is rewritten. Dropping `tokenVersion` retires nothing, since tokens issued before the change simply carry no version and are treated as 0.

## 2026.10.6.051 — Plan registry re-sequenced: the status of every plan checked against the code, and a new execution order
- **[Update]** **Every plan in `PlanDocs/` now carries a verified status and its position in the execution order**, and the registry (`PlanDocs/README.md`) is rebuilt around six waves. The old order was simply the order the plans were written; several of them turned out to be far further along — or further behind — than their own status lines claimed, so the statuses were re-derived from the repository rather than from the documents.
- **[Update]** **Plans that are already substantially shipped have moved out of the "pending" list**: the email-to-ticket connector (PLAN-009) is complete across four transports; quotes + quote→invoice (PLAN-013 #1/#2), website/SSL/DNS monitors (#4) and part of the billing-from-tickets chain (#5) are live; passkeys sign users in today (PLAN-002); a Windows desktop build ships (PLAN-005); token savings (PLAN-008) is complete.
- **[Update]** **The genuine gaps are now explicit**: the customer portal is absent; Plan-015's entire Phase A (agreements/time engine, expenses, bill-through batch invoicing) is untouched; the SOC 2 controls are unstarted with only code-side groundwork in place; there is no cloud dev/prod split and no CI beyond the desktop build; the AI assistant is unstarted; the Outlook add-in has only its tickets endpoint; mobile is a PWA manifest with no app; the RMM integration has no endpoints yet.
- **[Update]** **Order: 1** Microsoft 365 OAuth go-live (PLAN-017) · **2** finish session auth (PLAN-001) · **3** finish identity — passkeys + SSO (PLAN-002) · **4** billing & backlog chain (PLAN-015) · **5** modernization: portal, billing UI, UI/UX pass (PLAN-013) · **6** cloud dev/prod split (PLAN-016) · **7** SOC 2 (PLAN-007) · **8** AI assistant (PLAN-011) · **9** Outlook add-in (PLAN-012) · **10** mobile (PLAN-004) · **11** desktop completion (PLAN-005) · **12** C7NTRL integration (PLAN-014). Waves group these as "finish the foundation", "revenue & daily ops", "platform & compliance", "intelligence", "client surfaces" and "partner integration".
- **[Update]** **Multi-tenant (PLAN-003) is deferred by decision** and removed from the active sequence. Because three plans cited it as a prerequisite, each now names its substitute: the portal and SSO scope by **company** (which already exists), PLAN-011 drops its `tenant_id` vector filter for now, and PLAN-013 #8's RLS pass becomes a company-scoped query review. Re-enabling it would put it at position 1, ahead of everything else.
- **[Update]** PLAN-006 is folded into PLAN-005 (the shipped desktop toolchain is already open source), PLAN-010 is marked superseded by PLAN-016's Azure recommendation, and PLAN-008 is closed. The documents' own stale `**Status:**` lines were corrected so no plan contradicts its verified state.
- **Verification:** documentation-only change — no code, schema, dependency or data touched. Every status claim is backed by a file path in the plan's new `> **Sequence:**` block (routes, middleware, services, schema, web pages/app, desktop app, workflows, packages), and each of the 17 registry copies plus its 16 in-repo source documents was checked to contain the same block. Root `BuildNotes.md` regenerated into `apps/web/public/BuildNotes.md` and `apps/api/src/BuildNotes.json`.
- **Rollback:** documentation only — revert the change to `PlanDocs/`, the 16 root plan documents and this entry; nothing downstream depends on it.

## 2026.10.6.050 — Email connector: where unknown senders go, Exchange on-premises, and signing in as yourself
- **[New]** **Each connector now decides where a sender that matches nothing is filed.** A **default client** on the connector is tried first, then a client created automatically for the sender's domain (off by default — switch it on per connector), and only then the old oldest-client fallback, which logs a warning naming the domain. Consumer mailboxes (gmail, outlook, icloud and friends) are never turned into clients and never matched against a client's domain, so a personal address can't accidentally be filed under whichever client happens to carry "gmail.com". The panel lists the rule in plain language, and the default company is a picker rather than free text.
- **[New]** **Exchange Web Services (EWS) transport for on-premises Exchange.** EWS is what an on-prem/hybrid server still speaks (Microsoft is retiring it for Exchange Online, where Graph is the supported path): the connector lists unread mail with `FindItem`, pulls the messages as real MIME with `GetItem`, and marks them read with `UpdateItem` — the same process-then-mark contract as the other transports, so a failure leaves the mail unread and retried. Credentials are the mailbox username and password over Basic auth, with an optional self-signed-certificate allowance for internal servers.
- **[New]** **“Connect to Microsoft” — a delegated sign-in for a mailbox you can log into.** Instead of an app-only registration with Exchange RBAC scoping, an administrator presses the link button, signs in, and consents: the connector then reads *their* mailbox with a refresh token (stored encrypted and rotated on every use, never returned by the API). The panel shows who is signed in and since when, or **Not connected to Microsoft yet**, and a revoked or expired consent reports `Microsoft sign-in has expired or was revoked — reconnect the connector` rather than a raw OAuth error. The consent flow is authorization-code with PKCE and a single-use state, so a replayed callback is refused.
- **[New]** **Two more per-connector switches**, both on by default: **Mark mail read after filing** (leave it off to keep the original mail unread while still creating tickets) and **Ignore auto-replies** (out-of-office mail is skipped; switch it off and the auto-reply becomes a ticket).
- **[Fix]** **Ticket numbers could be handed out twice, and the insert then failed.** The next number came from a row *count*, which goes backwards when a ticket is deleted, so a new ticket could collide with an existing number and be rejected by the unique constraint — most visible when the connector filed several emails at once. Numbers now continue from the highest the client already has, and the email path retries if two inserts still pick the same one in the same instant.
- **[Fix]** A connector stopped or deleted while a poll was in flight no longer writes its state row back afterwards (that left orphaned state rows behind and could poll a connector that no longer existed).
- **[New]** **PLAN-017** documents building and deploying the Microsoft 365 OAuth app end to end: both identity arrangements, the exact Entra steps and CLI/PowerShell equivalents, the Exchange RBAC scope that keeps an app-only app to a single mailbox (including how to prove it is scoped), redirect URIs, secret rotation, a troubleshooting table of the AADSTS/Graph errors you can actually hit, the environment variables, rollback, and acceptance criteria.
- **Verification (live):** a new end-to-end probe (69 checks against a stubbed Microsoft + EWS endpoint) covered owner attribution, auto-created clients and contacts, consumer-domain safety, the EWS folder guard, EWS test/poll/attachment/mark-read/no-duplicate/error surfacing, the delegated consent URL and its PKCE parameters, callback state replay protection, refresh-token storage and rotation, reading the delegated mailbox and its status — all green, with the earlier 37-check connector probe still passing. In the browser the panel was driven through all three transports and both Graph sign-in modes, then connected, disconnected and deleted. Typechecks: web 0, API unchanged at its pre-existing count, no errors in the touched files. The API boots on the real Microsoft endpoints with the two seeded connectors.
- **Known limits:** an EWS folder must be a well-known name (Inbox, SentItems, Drafts, DeletedItems, JunkEmail, Archive); a delegated connector watches the signed-in account's mailbox (a shared mailbox wants the app-only flow).
- **Rollback:** connector-only — `packages/email/src/{graphFetch,ewsFetch,parseMail,imapFetch,EmailConnector,fieldDeduction,index}.ts`, `apps/api/src/services/{emailConnectorRuntime,emailToTicket,ticketNumber}.ts`, `apps/api/src/routes/email-connectors.ts`, `apps/web/src/components/EmailConnectorsPanel.tsx`, `apps/api/prisma/schema.prisma`, `PlanDocs/PLAN-017-*.md`. No dependency change.

## 2026.10.6.049 — Microsoft 365 email connector: working email → ticket ingestion, and the two bugs that would have made it fail silently
- **[New]** **The Microsoft 365 mailbox path is complete and live-ready.** Exchange Online has Basic authentication disabled in every tenant, so the IMAP-with-password connector the UI shipped with could never read a Microsoft 365 mailbox. The connector now speaks **Microsoft Graph app-only** (`tenantId` + `clientId` + `clientSecret`), lists unread mail oldest-first, fetches attachments, files the ticket, and only then marks the message read — a failure leaves the message unread so the next poll retries it instead of losing the email.
- **[New]** **The connector panel asks which transport you mean.** Choosing "Microsoft 365 / Exchange Online" shows the mailbox to watch plus the tenant, client id and secret, with a banner describing the Entra app, the application permission `Mail.ReadWrite` (write is needed to mark messages processed) and Exchange Online RBAC for Applications scoping the app to that one mailbox. Choosing "IMAP (username + password)" keeps the old fields and warns that it will not work for Microsoft 365.
- **[New]** **Each connector reports its own health**: whether a mailbox is being watched, when it last polled, how many messages it has processed, and the last error with its timestamp — plus a connection test that names the mailbox and its unread count.
- **[New]** **Email attachments become ticket attachments** through the same storage path the ticket screen uses (5 MB per file, 20 files per email), and an HTML-only email is flattened to text instead of landing as "(no message body)".
- **[Fix]** **Connectors could not be created at all: the API rejected the transport the UI sends.** Its alias list accepted `office365`, `o365`, `m365` and `microsoftgraph` but not `graph` itself, so every save failed with "Unsupported transport "graph"". A guard test against a stubbed Microsoft endpoint caught it before anyone hit it by hand.
- **[Fix]** **Replies never threaded, so every customer reply raised a duplicate ticket.** Ticket numbers are `C7-<stamp>-<4 chars>` (or `MSP-1001-1003` when the client has an id), but the matcher only looked for `[C7-12345678]` — a shape this app never generates. Replies are now matched on the real tag in the subject, in `In-Reply-To`/`References`, and as a last resort in the quoted body, and the tag is stripped from titles in either order (`"[MSP-1001-1003] RE: …"` used to leave a bare `RE:` behind). When a quoted number does not resolve, the email is raised as a new ticket rather than dropped.
- **[Fix]** **Deleting a ticket left its files behind on disk.** Attachment rows cascade with the ticket, the stored files did not — they are removed now (four orphaned folders from earlier deletes were cleaned up too).
- **[Fix]** **Stopping or deleting a connector cancelled only its interval, not its first poll** — the deferred tick could poll a connector that no longer existed and recreate its state row. Both timers are tracked and cleared now.
- **Verification (live):** 37/37 end-to-end checks against a stubbed Microsoft endpoint — create (with the `office365` alias normalising to `graph`, secret never returned, disabled until tested), test connection (token request fields, folder counts), poll → ticket on the connector's board with the HTML body flattened and the attachment stored and downloadable, comment present, message marked read, repeat poll creating no duplicate, reply quoting the ticket appending to it with no second ticket, and the status endpoint reporting the cursor. The panel was then driven in the browser: create → "Connected to servicedesk@cyber7group.com — Inbox: 1 unread of 3" → Watching → poll → ticket `MSP-1001-1022` on the right board → delete. Finally, against the **real** Microsoft token endpoint, a throwaway connector returned `AADSTS700016: Application … was not found in the directory '1fc90ce3-…'` — proving the token wiring reaches the C7 tenant and that the only thing missing for go-live is the Entra app registration itself. Typechecks: web 0, API unchanged at its pre-existing count, no errors in the touched files.
- **To switch it on:** register the Entra app, grant the **application** permission `Mail.ReadWrite` with admin consent, scope it to the mailbox with Exchange Online RBAC for Applications (e.g. the `Application Mail.ReadWrite` role assigned to the app's service principal for `servicedesk@cyber7group.com`), then add the connector, test it and flip it to Watching.
- **Known gaps:** a sender whose domain matches no client is still filed against the oldest client (with a server warning) — a per-connector default company and auto-create are not implemented; EWS and a delegated "Connect to Microsoft" sign-in flow are not supported.
- **Rollback:** connector-only — `packages/email/src/{graphFetch,imapFetch,EmailConnector,fieldDeduction,index}.ts`, `apps/api/src/services/{emailConnectorRuntime,emailToTicket,ticketAttachments}.ts`, `apps/api/src/routes/email-connectors.ts`, `apps/web/src/components/EmailConnectorsPanel.tsx`. No schema change (the transport/tenant/client columns already existed) and no dependency change.

## 2026.10.6.048 — Board cards, take two: outlined Workable and Escalated, plain Avg Age
- **[Update]** **Workable is an outlined card now** — the tint from the previous entry is gone and the thin border stands on its own.
- **[Update]** **Escalated gained the same thin border**, keeping its red tint.
- **[Update]** **Avg Age lost its border**: the age-banded background and text are what carry the meaning, so the extra edge was noise.
- **[Update]** **One orange for both, chosen against both themes rather than just the dark one.** orange-600 measures **5.45:1** against the dark card and **3.56:1** against the white light-mode card — clearing the 3:1 non-text contrast guideline in each, and unmistakably orange beside the red it sits next to. orange-500 was tried first: brighter on dark (6.9:1) but only 2.80:1 on white, under the guideline. The row's red hover rule would also have flipped these two borders red on hover, so they now brighten to orange-500 instead, with the existing hover ring left as the cue.
- **Verification (live):** measured in the browser in both themes — Workable transparent with a 1px orange border, Escalated red tint plus the same border, Avg Age red band tint with no border at 52 days, and New/On Hold/Waiting unchanged; the generated CSS was checked for the border and hover rules, and the theme was switched to light to measure it and left as it was found. Web typecheck 0.
- **Rollback:** one front-end file, `apps/web/src/pages/Boards.tsx`.

## 2026.10.6.047 — Service board cards: visible edges, and an Avg Age card that colours by age
- **[New]** **The Avg Age card is colour-coded by what it measures**: up to 7 days green, 8 to 14 days amber, more than 14 days red — background, border and text together, with a tooltip that names the band and the exact average ("Average age of open tickets on this board: 52 days (over two weeks)"). It reads at a glance instead of being one more grey number. On today's data every board sits at 51-52 days, so all four show red; the green and amber states were exercised by shifting the thresholds and restoring them.
- **[Fix]** **The Workable card had no tint and no border, which is why it looked like plain text beside the tinted cards.** Its background class was `bg-cyber-600/15`, and the `cyber` palette is defined as `var(--cyber-*)` — Tailwind cannot apply an opacity modifier to a CSS variable, so the class was never generated and the tile fell back to a transparent background. It now uses a `color-mix()` tint and border derived from the same accent variable, so it keeps following the active theme and finally reads as a card.
- **[Update]** Both cards the request named now carry a thin border: Workable in the theme accent, Avg Age in its band colour. The other four status tiles (New, On Hold, Waiting, Escalated) are unchanged.
- **Verification (live):** measured in the browser rather than eyeballed — Workable's background and border resolve to the accent at 15% and 40%, and the Avg Age card resolves to `rgba(5,150,105,…)` green, `rgba(245,158,11,…)` amber and `rgba(220,38,38,…)` red at the same 15%/40%, with the label and value taking the band's text colour. Each band was rendered by temporarily moving the thresholds, then the thresholds were restored and the red band re-checked against the real data. Web typecheck 0.
- **Rollback:** front-end only — one file, `apps/web/src/pages/Boards.tsx`; no API, schema, data or dependency change.

## 2026.10.6.046 — Service alerts resolve on what the sources actually say
- **[Fix]** **Alerts from weeks ago are gone, because a source that cannot be read can no longer veto a resolution.** The resolver demanded a positive all-clear from *every* configured source before retiring an alert. DownDetector now answers the reader with a Cloudflare challenge page (HTTP 200, no status line), which read as "not clear" — so on the 11 services carrying a DownDetector URL nothing could ever auto-resolve, and two live alerts sat there saying an outage was ongoing: AWS at 15 days and Azure at 33 days. A source is now recorded as **unknown** when it cannot be read: it never counts as all-clear, and it no longer blocks the clear that the readable sources agree on. Both alerts auto-resolved within two polls, each recording why.
- **[New]** **A third source, and one that is not behind a bot challenge: the status page's Statuspage.io API.** Where a service's status page is Statuspage.io, the monitor reads `/api/v2/status.json` and takes the vendor's own indicator — `none` is a positive all-clear, `minor`/`major`/`critical` raises or refreshes an alert with the page's own wording and severity. Status pages that are not Statuspage.io simply answer 404 and stay unknown, so nothing is inferred from them. Claude, GitHub, OpenAI and Meraki answer today, which is what made the AWS and Azure resolutions possible on the same poll as the empty feeds.
- **[New]** **Every source is observed independently, and every source reports back.** A service is polled from all of its sources in parallel — RSS/Atom feed, status-page API, DownDetector, and its website/ssl/dns monitor — instead of one branch chosen per service. The monitor snapshot and `GET /service-alerts/services` now carry, per service, what each source said on the last poll (`clear`, `problem`, `restored` or `unknown`) with the reason, so a silent source is visible instead of invisible.
- **[New]** **A stale ceiling, so nothing can be pinned to the banner indefinitely.** `SERVICE_ALERT_STALE_HOURS` (default 72, env-overridable) retires an alert that no source has reported for that long — the case where every source for a service is unreadable. The reason written into the record names the ceiling and the source verdicts ("no monitored source has reported this incident in the last 72h… (rss unknown, statuspage unknown)"). The two-poll anti-flap rule, the one-poll minimum age, and the rule that manual alerts are never auto-resolved are all unchanged.
- **[Update]** **The page shows the polling honestly.** A strip above the summary reports when sources were last polled, the cadence, which sources are unreadable and how many services that affects (today: "Unreadable: DownDetector ×13, Status Page ×8, RSS Feed ×1"), and the auto-resolve rule; each service card carries its source verdicts, and each active alert lists them too, so "is this outage still real?" is answerable from the row. The settings screen's service table shows the same verdicts per source (coloured, with the reason on hover), adds refreshed/stale tiles, and collapses the blocked DownDetector pages into one summary error line instead of one per service.
- **Verification (live + probe):** the two stale alerts (AWS 15d, Azure 33d) were confirmed auto-resolved with the reason recorded and the banner cleared; the resolver was then walked through every branch against a throwaway service pointed at a switchable local vendor — feed incident → alert created (`degraded`/`rss`), feed resolution → resolved immediately, empty feed + status page `major` → alert created (`outage`/`statuspage`), status page `minor` → same alert softened to `degraded` rather than duplicated, all sources clear → resolved on the second consecutive clear poll, every source unreachable → held under the default ceiling and retired as stale under a shortened one. 22 checks passed; the throwaway service and its alerts were deleted, the probe files live outside the repository, and the reseed snapshots were re-captured afterwards so the fixtures hold no probe records (127 alert records, all resolved).
- **Rollback:** the monitor, one route payload and two screens; no schema change and no new dependency. Set `SERVICE_ALERT_STALE_HOURS` to change the ceiling.

## 2026.10.6.045 — Commit identity changed to C7-Intelligence
- **[Update]** **Commits from this working copy are now authored as `C7-Intelligence <C7-Intelligence@users.noreply.github.com>`** instead of the personal `c7-imi` account, so the history under the repository's new owner reads as the organization rather than an individual. The change is **repository-local** (`git config --local`), so the machine-wide identity other checkouts use is untouched.
- **[Update]** **The automatic commit path inherits it with no script change.** `scripts/auto-sync.ps1` commits with whatever identity the repository configures, and no hook or script overrides `user.name`/`user.email`, so the scheduled auto-sync commits and manual commits both use the new identity from here on.
- **Verification:** `git var GIT_AUTHOR_IDENT` and `git var GIT_COMMITTER_IDENT` report the new identity; a probe commit object built with `git commit-tree` carried it in both the author and committer fields without touching the index or any ref; the first commit pushed while using it was accepted by GitHub, and the API resolves that commit's author to the **`C7-Intelligence` organization** (`type: Organization`, id `331890042`, with the organization's avatar and profile link) instead of the personal `C7-IMI` user account the previous commits resolved to.
- **Notes:** GitHub's email reference documents the `noreply` shape as `<ID+USERNAME@users.noreply.github.com>`, or the legacy `<USERNAME@users.noreply.github.com>`, for user accounts and says nothing about organizations — so the organization name was used with that same `users.noreply.github.com` form, and it resolves for an organization login as readily as for a user: the commit links to the organization, so no profile attribution is lost by moving off the personal account.
- **Rollback:** `git config --local user.name c7-imi` and `git config --local user.email c7-imi@users.noreply.github.com`, or `git config --local --unset user.name user.email` to fall back to the machine-wide identity.

## 2026.10.6.044 — Repository moved to the C7-Intelligence organization
- **[Update]** **C7NTAX now lives at `github.com/C7-Intelligence/C7NTAX`.** The repository was **transferred** from the `C7-IMI` personal account into the `C7-Intelligence` organization rather than copied, so it keeps its identity — same repository id, same commit history, branches and settings — and the old `C7-IMI/C7NTAX` URLs redirect to the new ones.
- **[Update]** **Only the push target changed; every file stays in OneDrive.** The working copy is still `C:\OneDrive\OneDrive - Cyber 7 Group\GHRepo\Kun\C7NTAX` and was never moved. The single local change is the `origin` remote, repointed from `git@github.com:C7-IMI/C7NTAX.git` to `git@github.com:C7-Intelligence/C7NTAX.git`.
- **[Update]** **The auto-sync push needed no script change.** `scripts/auto-sync.ps1` pushes `origin` and hardcodes only the local path, so the scheduled task keeps working against the new owner once the remote is repointed — it was paused for the transfer window and re-enabled afterwards.
- **Verification:** the transfer returned `202` and the repository appeared under the new owner within seconds with its id and last-push timestamp unchanged; `git ls-remote origin`, `git fetch` and `git push origin main` all succeed over SSH at the new path, and `HEAD == origin/main`; the auto-sync task ran once against the new remote and pushed successfully; `git rev-parse --show-toplevel` still reports the OneDrive folder.
- **Notes:** remaining `C7-IMI` mentions are historical (earlier BuildNotes and Retrace entries record what was true at the time) or refer to the separate `C7-IMI/C7NTRL` repository, which was not part of this move. A transfer leaves no copy behind at the old owner.
- **Rollback:** `git remote set-url origin git@github.com:C7-IMI/C7NTAX.git` and transfer the repository back from the organization settings; no files, schema or dependencies are involved.

## 2026.10.6.043 — Every asset type has its own configuration dialog and its own records
- **[New]** **One configuration dialog for every asset type, opened by the option itself.** The organization's type panel now adds and edits **in place**: *Add Active Directory* opens a dialog built from that type's own template — its name, icon, colour and description, the client (locked, so a record cannot land on the wrong one), a status, and then the type's fields. Editing a row is the pencil beside it, and the same dialog sits behind *Edit* on the record and behind *New Asset* in Kumo Assets (which first asks which type). Only the field definitions differ per type, so a type added later gets a dialog without any new code.
- **[New]** **Fields are rendered by kind, not as a wall of text boxes:** single-line text, multi-line for the free-text keys (`steps`, `targets`, `permissions`, `findings`…), number, checkbox for booleans, dropdown for selects, multi-select as a checkbox group, real **date pickers** for `date` fields (which previously arrived as raw text), URL/email input types where the key implies it, plus placeholders, help text, required markers — and validation that names the missing field rather than just refusing to save. Every control is properly labelled, so the form is reachable by name as well as by position.
- **[New]** **Sample data for every asset type, for every organization.** The seeder now walks the type templates and gives each client two records of each type with values that read like a real environment — a domain controller and a file server, Veeam job and Microsoft 365 backup, core and access switches, the primary fibre circuit and its 4G failover, corporate and guest SSIDs, and so on — with the fields filled from a per-key value map (16 cores, 500/500 Mbps, "Net 30", a 214-day contract end, a verified restore). That is **210 configurations and 1,020 field values** across the five clients, and the loop means a new type is populated the next time it runs. Records left over from the first pass, which were named "Client Type", are renamed to match so a type panel reads consistently. The three original types still create their legacy detail rows, so Configurations keeps working.
- **[Fix]** **A Kumo asset record now trails the client and the type it was filed under** — *Kumo › Organizations › Acme Corporation › Backup › Veeam job* instead of *Kumo › Assets › …*, and the segment links back to that client's list filtered to the type. The asset model stores the client as a plain id, so the record payload names it.
- **[Fix]** **An organization's Kumo asset list read "0 assets".** The list endpoint is capped at 50 rows per request while the client filter was applied in the browser, so a client whose records were not in the newest 50 saw nothing. The scope (and the type filter) now travel with the request and the page asks for enough rows; Acme's list went from 0 to 42.
- **[Fix]** **The old Checklists *asset type* is no longer an empty legacy panel.** It was promoted into Core Assets last week but could still be opened by URL or a stale link; it now explains that it moved and links straight to that client's checklists.
- **Verification (live):** all 22 type panels for Acme Corporation were opened — 21 show two records each, the 22nd is the promoted Checklists card above. Creating through the dialog posted exactly the field values typed (`product`, `targets`, `schedule`, `retention`, `last_verified`, `restore_tested` all landed on their own fields), the panel refreshed to *3 records*, the record page showed the values with the date formatted and booleans as Yes/No, editing pre-filled from the record and saved a changed retention and status, and the probe record was deleted afterwards. The assets list shows *210 assets* unscoped, *42* for one client and *2* for one client's type. A crawl of **46 routes** plus the type panels found no empty-state text, and the seams were checked by hand: Configurations still lists its servers, the drawer's breadcrumb still carries the client, and the type drawer's *New X* no longer navigates away. Snapshot captured at **3,198 records across 101 tables**. Web typecheck 0; api 156 (baseline).
- **Rollback:** one new component plus edits to the type panel, the assets list, the record page and one API handler; the seeded records are ordinary data that `npm run db:sample-off` removes. No schema change and no new dependency.

## 2026.10.6.042 — Organization options stay inside the organization, and the trail says which one
- **[Fix]** **Every link that leaves an organization now carries that client with it.** The rail's Core Assets entries already did, but the organization's own screens did not: *New Document* and the *Quick Add* menu (Asset, Password, Document, Configuration), the *Password Strength* tiles, the *View More* actions on passwords and documents, the three *Documentation Health* rings (Stale, Not Viewed, Expired), *Add Password*, and every row in *Recently Viewed*, *Recently Updated*, *Upcoming Expirations* and the activity feed all opened the all-clients list. They now pass the client, so clicking an option shows that organization's records rather than the general screen — and those deep links (`?select=`, `?doc=`) still open the record they point at.
- **[Fix]** **Contacts and Change Control now show the client in the trail.** They are organization options, but they live outside Kumo, and the bar that names the client only rendered on Kumo screens. A screen outside Kumo can now register its own trail and the bar appears for it, so the organization's contacts read *Organizations › Acme Corporation › Contacts* and its Change Control reads *Organizations › Acme Corporation › Change Control* instead of *Home › Clients › Contacts* and *Home › Tickets*. Screens that register nothing are untouched — the header trail on them is exactly as it was.
- **[Fix]** **A client's ticket list names the client again.** The *"Showing … 's tickets"* line read "one client" because it looked at a companies list that is only fetched for the new-ticket dialog; it now falls back to the client on the rows themselves, which is also what the new Change Control trail uses for its label.
- **Implementation:** the organization screen gained one `scopedTo(path, orgId, params)` helper so it is not possible to write a Kumo link there without the client, `itemLink()` takes the organization id, and `orgTrail()` joins `kumoClientTrail()` in the breadcrumb helpers for client-scoped screens outside Kumo.
- **Verification (live):** all fourteen rail entries were followed from an organization — Checklists, Configurations, Documents, Passwords, Domain Tracker, SSL Tracker, Contacts, Change Control, Overview, Locations and four asset types — and each opens scoped with a trail naming the client (*Kumo › Organizations › Acme Corporation › Checklists*; *Organizations › Acme Corporation › Contacts*). Every link on the organization screen was read off the page and confirmed to carry `companyId=`: *New Document*, the four Quick Add destinations (the fifth, New Contact, correctly opens the client record), all seven password-strength tiles (`?strength=…&companyId=…`), both *View More* links, the three health rings (`?filter=stale|unviewed|expired&companyId=…`), *Add Password*, and the recently-viewed / recently-updated / expirations / activity rows. The scoped deep links still select their record — `/kumo/passwords?select=…&companyId=…` shows *1 passwords* with the entry open, `/kumo/configs?select=…&companyId=…` shows *1 servers*, `/kumo/documents?doc=…&companyId=…` shows *3 of 7 documents*, `/kumo/domains?select=…&companyId=…` shows *2 tracked* — and the trail reads *Kumo › Organizations › Acme Corporation › Documents › Stale* on a filtered list. Regression pass: with no client in the URL nothing changed — `/tickets`, `/clients`, `/assets` and `/billing` show no client trail, `/kumo/checklists` shows *Kumo › Checklists*, and `/kumo/assets` *Kumo › Assets*. Web typecheck 0; api untouched.
- **Rollback:** five front-end files — a helper and the link updates in the organization screen, one line each in the Contacts and Tickets screens, and the trail helpers — `git revert` restores the previous navigation. No API, schema or dependency change.

## 2026.10.6.041 — Sample data in every corner, and a reseed that keeps it
- **[New]** **A coverage seeder — `apps/api/src/seed-sample-coverage.ts`, run with `npm run db:seed-coverage`.** It walks the app area by area and fills only what is empty, so it is safe to run again and again: every block counts its own collection first (or that client's slice of it) and either fills it or reports "already has N". It refuses to run while sample data is switched off, so a locked snapshot is never contaminated.
- **[New]** **Reference and configuration areas:** currencies and exchange rates, ticket categories per board, technician skills (1–5 scale), retention policies, field permissions, email connectors, alert webhooks with delivery history, the AI provider config, calendar sync configs, a disabled SSO config, and bulk operations — so the settings and admin screens open on real rows instead of empty states.
- **[New]** **Every client now has the full depth of a managed customer:** a domain and a certificate, at least two contacts, Kumo Server/Workstation/Network Device configurations with their template fields filled in, a password, a document with revisions, assets with assignment history, an invoice with line items, two checklists with tasks, and a project with three phases, four tasks and their dependencies.
- **[New]** **Every ticket now has a story:** a technician note, an internal note and an emailed note, field-change history entries (the *History* tab reads comments shaped `Field: old → new`), two time entries, a similar-ticket link, CC/additional contacts, and — for a decent share of them — an attachment with a **real file on disk**, so download works rather than 404s.
- **[New]** **The rest of the surfaces that were empty:** KB articles each with two versions, an attachment and a linked ticket; reports with a schedule; workflow rules; a closed chat session with its messages; detected patterns; AI actions; the inference cache; vendors; a purchase order; quotes with line items; opportunities in **every** pipeline stage; a contract; expenses; PTO requests; holidays; and calendar/schedule entries.
- **[New]** **Detail screens that rendered dashes now render data.** Kumo assets with no field values showed every template field as "—" — assets are now filled from their template (hostname, OS, cores, RAM, IP, serial and friends, by key then by field type). The Kumo organization *Quick Notes* card read "No notes yet" for every client — each company now carries an operational note.
- **[Fix]** **Thirteen tables were invisible to the snapshot pipeline**, so anything written into them was lost on the next reseed and absent from the fixtures: checklists, checklist tasks, ticket contacts, ticket similarities, ticket categories, exchange rates, retention policies, field permissions, detected patterns, the inference cache, bulk operations, asset assignments and KB↔ticket links. All thirteen are now captured (`snapshot-capture.ts`) and restored (`seed-from-snapshots.ts`).
- **[Fix]** **Five model names in the sample-data wipe list were misspelled** (`kbArticleTicket`, `kbArticleAttachment`, `kbArticleVersion`, `kbCategory`, `poLineItem`), so those destroy calls silently did nothing — the correct Prisma names are `kBArticle…`, `kBCategory` and `pOLineItem`. Checklists, checklist tasks, ticket contacts and webhook deliveries were missing from the list entirely and were added in the right wipe order.
- **[Fix]** **A reseed silently emptied three tables.** The connector, webhook and calendar-sync fixtures deliberately omit their secrets, but the columns are required, so every reseed failed on them and left the tables empty. The fixtures are now rehydrated with placeholders when seeded, so the rows come back.
- **[Fix]** **Two sample values did not match the enums the UI understands:** opportunities stored as `qualification` (not a pipeline stage, so those deals never appeared on the board) and assets typed `Network`/`Laptop`, which the asset type map does not recognise. Both are normalised, and the seeder now writes the stage/type values the app expects.
- **Verification (live):** an inventory across all 107 models showed 32 with no rows to start; after seeding, the only empty tables are the four runtime-only auth ones (sessions, refresh tokens, WebAuthn credentials, Outlook add-in tokens). A crawl of **44 routes** (tickets, boards, service alerts, monitors, webhooks, AI actions, pipeline, projects, assets, procurement, KB, clients, contacts, billing and its tabs, quotes, all reports tabs, cloud connect, users, roles, every Kumo screen, administration, calendar, PTO, AI settings) and **14 detail pages** (four tickets, two clients, two organizations, two Kumo assets, two checklists, two assets) found **zero** empty-state strings. Spot checks: a Kumo asset now reads *Hostname acme-corporation-network-device.corp.local · Device Type Access switch · Management IP 10.20.0.20*; the organization *Quick Notes* card shows the note with an *Edit Note* button; the ticket detail shows notes, an activity feed with time entries and changes, a populated *History* tab and a downloadable attachment (*network-scan.txt, 58 B*); the pipeline reads *8 deals · $141,500 pipeline · $9,600 won* with a card in every column including prospect, won and lost; the asset list shows *Network Equipment* instead of a raw "Network".
- **Verification (data):** zero companies without notes, zero tickets without comments, without time entries or without change history, zero Kumo assets without field values. Snapshot captured at **2,016 records across 101 tables**, and a full `db:reseed` round trip (delete-in-reverse-order, re-insert) completed with **0 failures** and re-seeded all 2,016 records — including the thirteen newly-covered tables. The delta journal recorded the additions per table (ticket comments +389, time entries +138, ticket contacts +114, Kumo field values +36, attachments +8, and so on), which is what makes the new data part of the reseed delta. API typecheck 156 (baseline), web typecheck unchanged.
- **Rollback:** one new script plus three list edits and a placeholder map in the existing seeding/toggle scripts — `git revert` restores the previous pipeline, and the seeded rows are ordinary data that `npm run db:sample-off` already knows how to remove (with the five wipe-list names now correct). No schema change and no new dependency.

## 2026.10.6.040 — Checklists become a real section, on one shared rich text editor
- **[New]** **Checklists are now records of their own, shaped like IT Glue's.** A checklist has a name, a rich-text description, an owner and a due date, and an ordered list of **tasks** — each with its own assignee, due date and tick state — instead of being one more asset type with fixed fields. New `checklists` and `checklist_tasks` tables; nothing about the existing Kumo asset types changed.
- **[New]** **The Checklists list** (`/kumo/checklists`, also in the Kumo navigation) follows the reference screenshots: *Checklists* and *My Tasks* tabs, a filter box across every column with an "N of M" count, a column chooser, sortable headings, row checkboxes with bulk delete, and per-row **Duplicate** and **Delete**. A client chip scopes the whole screen and can be cleared, and the organisation rail's Checklists entry lands here with the client's real count. Duplicating copies the tasks with everything unticked, which is what makes one checklist reusable for the next onboarding.
- **[New]** **The checklist editor** opens on breadcrumbs (Organizations › Client › Checklists › name) with an editable title, assignee picker and due-date picker, a rich-text **description**, a progress bar, and the task list: click the circle to complete (the row dims and strikes through), edit the name in place, set an assignee and due date per task, reorder with the move buttons, or delete. **Add task** opens a *Task name* row and Enter saves it and opens the next one, so a checklist can be typed straight through — the placeholder row in the reference screenshot.
- **[New]** **My Tasks** gathers everything assigned to the signed-in user across every client, with the checklist and client beside it and a tick to complete it in place; completing one clears it from the list, which is what the tab is for.
- **[New]** **One rich text editor, configured per section.** The editor that was built for the email composer now lives in `components/richText` with a **profile** describing what a surface gets: which toolbar groups, whether it takes attachments, whether Ctrl+Enter submits, and its default size and placeholder. Email uses `EMAIL_PROFILE` (everything, attachment chips, Ctrl+Enter to send); checklist descriptions and the new-checklist dialog use `DOCUMENT_PROFILE` (formatting and inline images, no attachment strip, Enter stays a newline). The editor also gained an **initial-content** prop so a stored description renders back — previously it only ever wrote what was typed. Improving the editor now improves every surface at once, and the section-specific parts (attachment chips, Save/Send buttons) stay with their section.
- **[Update]** `GET /api/checklists`, `/my-tasks`, the record and its tasks, duplicate and reorder all sit behind the existing ticket permissions; descriptions are sanitised through the same allowlist the email composer uses, so stored HTML is limited to the safe subset. Deleting a checklist removes its tasks, and the rail count updates with it.
- **Verification (live):** created "New PC Setup List" for Umbrella Corp through the dialog (name, client, assignee, due date, three tasks one-per-line, rich-text description) — the dialog rendered the document profile's toolbar with **no** Attach button. The editor then showed the title, assignee/due controls, description and the three tasks; **Add task** + Enter added "Hand over to the user" and left the next row open; a description with bold and a bullet list saved itself and came back after a reload (the toolbar showing *Bulleted list* pressed); completing a task moved the counter to *1 of 4* and struck the row through; assigning a task to Admin User made it appear under **My Tasks** ("1 task assigned to you") with its checklist and client; the list showed the row as *1 of 4* with duplicate/delete; **Duplicate** produced "New PC Setup List (copy)" with the same four tasks and *0 of 4* done, and deleting both left the empty state and `0 of 0 checklists`. The org rail read *Core Assets: Overview, Checklists 1, Configurations …* linking to `/kumo/checklists?companyId=…` with Checklists absent from the asset-type list, and the row right-click menu offered Open / Open in new tab / Open in new window / Duplicate / Copy link / Copy name / Delete. API checks: create with tasks, list with progress, task completion, duplicate, my-tasks, delete.
- **Housekeeping:** the two probe checklists and their tasks were deleted, the snapshots re-captured (both tables empty), and a whitespace-only `prisma format` realignment was reverted again so the schema diff is the 46 lines the two models need. Web typecheck 0, api 156 (baseline) — both unchanged; design-token lint unchanged.
- **Rollback:** two new models, one new route file, two new pages, the editor moved into `components/richText` with a profile, plus small edits to the rail, nav and App routes — `git revert` restores the previous state; the tables are inert once the routes are gone. No schema change to any existing model and no new dependency.

## 2026.10.6.039 — Checklists moves up into Core Assets
- **[Update]** **Checklists now sits in Core Assets, directly above Configurations**, instead of being one of twenty alphabetised entries in the *Asset Types* list. It keeps everything it had there — its icon and colour, its record count, the link through to the client's checklist view and the active highlight when it is open — so nothing about how it works changed, only where it is found.
- **[Update]** The rail now has a small list of promoted type slugs (Checklists, today) which are rendered as Core Assets and filtered out of the type list; the *Show N empty types* count follows, so an empty promoted type is no longer counted as a hidden one.
- **Verification (live):** on a client page the rail reads *Core Assets: Overview, **Checklists (0)**, Configurations (1), Contacts (3), …* and Checklists is gone from *Asset Types* (which now starts at Account Management). Clicking it navigates to `?type=29f111fb-…`, highlights in place in Core Assets, and opens the usual *Checklists · {client}* panel with its record count, field count, description and *Add Checklist* action. Web typecheck 0; design-token lint unchanged.
- **Rollback:** one constant and one render block in the rail — no API, schema or data change; the type itself is untouched in the database.

## 2026.10.6.038 — The warning bubble is now compact throughout
- **[Update]** **Warning text down to 10px** (from 11px, and 14px where it started) with a 12.5px line height, and everything around it shrank to match: the orange marker is 10px with an 8px glyph, the gap, padding and corner radius are all a step tighter, and the shadow is lighter. The bubble is roughly a third smaller than it was at the start — 35px tall for two lines instead of 55px.
- **[Update]** The sentence itself is unchanged, as are the amber outline on the field and the *Send anyway* confirmation. Every surface that borrows the component still inherits it: To/Cc/Bcc, the note composer's recipients, the ticket's *Add contact* box and the new-ticket *Also* field.
- **Verification (live):** measured on the bubble under the Cc row — 10px / 12.5px line height, 10px marker, 4px/8px padding, 35px tall. Same text, no layout shift beneath it. Web typecheck 0; design-token lint unchanged.
- **Rollback:** type scale and spacing in one component — no API, schema or data change.

## 2026.10.6.037 — Smaller again: the warning matches the app's field-note size
- **[Update]** **The warning text drops to 11px** (from 12px, and 14px originally), so it now matches the hint text under the other fields rather than reading as body copy. The orange marker shrinks with it — 12px box with a 10px glyph — and the padding tightens slightly, so the bubble takes noticeably less room under the chips.
- **[Update]** Nothing else about the warning changes: the wording, the amber outline on the field, and the *Send anyway* confirmation all behave as before, on every surface that borrows the component (To/Cc/Bcc, note recipients, the ticket's *Add contact* box and the new-ticket *Also* field).
- **Verification (live):** the bubble measured **11px / 15.125px line height** with a 12px marker under the Cc row, same sentence, no layout shift below it. Web typecheck 0; design-token lint unchanged.
- **Rollback:** type scale in one component — no API, schema or data change.

## 2026.10.6.036 — Smaller type in the outside-organisation warning
- **[Update]** **The warning bubble's text is smaller.** It was set at the body size (14px) and read as a message rather than a field note; it is now **12px** with the line height tightened to match, and the orange marker scaled down with it so the bubble sits under a field without dwarfing the chips above it. The wording, the amber field outline and the *Send anyway* confirmation are unchanged.
- **Verification (live):** the bubble under the Cc row rendered at 12px / 16.5px line height (was 14px) with the same text — "admin@c7ntax.com is not a contact at Umbrella Corp. You can still send it — just make sure it is intentional." — and the layout below it was unaffected. Web typecheck 0; design-token lint unchanged.
- **Rollback:** type scale in one component — no API, schema or data change.

## 2026.10.6.035 — Address fields only offer the ticket's own client, and warn about anyone else
- **[New]** **Recipient search is scoped to the ticket's organisation.** The To, Cc and Bcc fields, the note composer's recipients and the ticket's *Add contact* box only suggest contacts of the client the ticket belongs to, and name matching is limited to them — so on an Initech ticket, typing "John" offers Initech's John Smith and never the same-named John Smith at Stark Enterprises. (The new-ticket form scopes to the company being selected, and re-scopes if you change it.)
- **[New]** **An address outside that client gets a warning, not a block.** Type or paste one — `admin@c7ntax.com` on an Umbrella Corp ticket — and a white validation bubble appears under the field in the same style as the form validators, the field outline turns amber, and it stays until the address is removed: *"admin@c7ntax.com is not a contact at Umbrella Corp. You can still send it — just make sure it is intentional."* When we know who the address really belongs to, the warning names them: **"john@starkenterprises.com belongs to Stark Enterprises, not Umbrella Corp."** — which is exactly the wrong-John-Smith case.
- **[New]** **Sending checks the same thing.** Pressing *Send Email* (or *Add Note*) with an outside address opens an **Outside {client}** confirmation listing every one of them, with *Go back* and *Send anyway* — the send is held only long enough to be seen, never refused, and the recipients are all shown before you decide.
- **[Update]** **A malformed address is now rejected instead of quietly dropped.** The API validates every address a composer sends — typed addresses, Cc and Bcc lists, and the note recipients payload — and answers 400 naming the value (`"not-an-address" is not a valid email address`) rather than filtering it out and delivering to fewer people than the author thought.
- **[Update]** A small lookup (`GET /clients/contacts/lookup?email=`) resolves which client an outside address belongs to, one request per distinct address, so the warning can be specific. Emails are matched case-insensitively, and outside addresses are only ever warned about — nothing about them is stored unless the composer is saving recipients to the ticket.
- **Verification (live):** with two John Smiths seeded (Stark Enterprises and Umbrella Corp), typing "John" on an Umbrella ticket suggested **only** `john@umbrellacorp.net`. A manually typed `admin@c7ntax.com` produced the "not a contact at Umbrella Corp" bubble, and adding `john@starkenterprises.com` produced "belongs to Stark Enterprises, not Umbrella Corp" — both with the amber outline. Clicking *Send Email* showed the *Outside Umbrella Corp* dialog listing both addresses, and **Send anyway** delivered to all three recipients (envelope: `alice@umbrellacorp.net`, `admin@c7ntax.com`, `john@starkenterprises.com`; header `Cc: admin@c7ntax.com, john@starkenterprises.com`). The note composer behaved identically, with *Add note anyway* in place of *Send anyway*. Server-side: an invalid Cc returned 400 `"not-an-address" is not a valid email address`, an invalid note recipient returned 400, and a valid outside address was accepted as designed.
- **Housekeeping:** the two seeded John Smiths, every probe comment, contact link and audit row were removed, the snapshots re-captured (ticket back to its three original comments, Umbrella back to its two contacts, `ticket_contacts` empty) and the SMTP sink stopped with its temp files deleted and port 587 free. Web typecheck 0, api 156 (baseline) — both unchanged; design-token lint unchanged.
- **Rollback:** one new bubble component (`FieldWarning`), scope props on the existing `RecipientField`, the pre-send confirmation in the ticket page, one lookup route and the address validation in the ticket routes — `git revert` restores the previous unscoped suggestions. No schema, dependency or data change.

## 2026.10.6.034 — CC anyone on a ticket email, and keep extra contacts on the ticket
- **[New]** **The Email Contact composer has Cc and Bcc.** *To* starts with the ticket's contact and accepts anyone else — type a name to search the client's contacts or type any address, and it becomes a chip you can remove. *Cc* sits underneath with a **Bcc** toggle beside it, exactly as in Outlook on the web and Gmail, and a row of one-click **On this ticket** chips offers the ticket's other people. The activity entry in Notes now records the whole envelope (`To:`, `Cc:`, `Bcc:`), so it is clear who saw a message.
- **[New]** **Tickets can carry extra contacts, not just one.** A new **Contacts** card sits beside *Client Info* and lists the primary contact plus everyone else on the ticket. **Add contact** searches the client's contacts or accepts a typed address, and each person has one three-way choice that matches how the PSA tools model it: **CC on all email** (copied on every ticket notification), **Emailed notes** (only notes), or **Ticket only** (recorded on the ticket, emailed nothing automatically). Any of them can be removed with one click.
- **[New]** **Extra contacts can be added at every point in a ticket's life.** While *creating* a ticket, the new **Also** field takes CC/additional contacts up front and links them as the ticket is created. On an existing ticket the Contacts card adds and removes them at any time. And when *submitting a note*, the composer's **Send as email to N people** panel lists the ticket's contacts with a tick-box each — pre-ticked exactly as their role says — plus a Cc field for anyone else; a brand-new address typed there is emailed the note **and saved to the ticket** (and to the client's contact list), so the next note just ticks them.
- **[Update]** **The ticket's CC contacts are copied automatically, everywhere the ticket emails the customer.** Status changes, note notifications and time-entry notices all route through one helper, which now resolves the ticket's CC contacts and adds them to the Cc of the outgoing message, de-duplicated against the To list. Additional contacts flagged for notes are included on notes only. A "Cc-only" send (the customer's own address unticked, someone else added) is promoted to a real To on the wire, because mail clients need one.
- **[Update]** Free-form recipients behave sensibly per surface: on a note they become contacts of the client and are linked to the ticket; in the email dialog a typed external address is used for that message only, while picking one of the client's contacts still records them on the ticket. Addresses are validated on both sides — a malformed one is flagged inline instead of bouncing.
- **[Update]** The composer's Cc hint names who is already covered ("Thomas Mueller also receives this automatically"), so nobody is added twice, and the note panel's Cc hint says what saving does. The ticket-print view and the existing single-contact fields are unchanged.
- **Verification (live):** with a local SMTP sink capturing the traffic, an email to the ticket contact came out as `To: alice@umbrellacorp.net` / `Cc: tmueller@umbrellacorp.net` — the CC contact copied automatically; a manual send produced `To: alice@umbrellacorp.net, helpdesk-cc@umbrellacorp.net` / `Cc: tmueller@umbrellacorp.net`; and the SMTP envelope showed all three recipients including the **Bcc** address (`RCPT TO:<audit-archive@example.com>`), which is correctly absent from the message headers. Posting a note with a ticked contact and a new Cc address emailed both and the new address appeared in the ticket's Contacts card; the ticket-creation form sent `additionalContactIds` and the created ticket (`INF-1004-1019`) came back with that contact linked. Adding, re-roleing (all three modes, persisted across a reload) and removing contacts all worked, as did a free-form contact created from the note composer — the client's contact list showed it alongside the existing two.
- **Housekeeping:** every probe comment, contact link, contact, attachment and audit row was removed, the throwaway ticket deleted, the snapshots re-captured (ticket back to its three original comments, client back to its two contacts, `ticket_contacts` empty), and the SMTP sink stopped with its temp files deleted and port 587 free. The whitespace-only `prisma format` realignment of `schema.prisma` was reverted so the schema change is exactly the 22 lines it needs. Web typecheck 0, api 156 (baseline) — both unchanged; design-token lint unchanged.
- **Rollback:** one new model (`TicketContact`) plus edits to `schema.prisma`, the ticket routes, the ticket-notifications helper, `EmailService.sendTicketActivity`'s signature, and a new `RecipientField` component used by three screens — `git revert` restores the previous single-contact behaviour; the extra table is inert. No new dependency.

## 2026.10.6.033 — The display-density toggle lives in My Account only
- **[Update]** **The density toggle is gone from the header toolbar.** The narrow `≡` button that sat between the page title and *Search* has been removed, so the toolbar now runs *Search · Recent · AI · Help · Settings · My Account* with no switch that needs explaining. Spacing is still a user choice — it just lives where the rest of the appearance settings are, under **My Account → Appearance → Use compact/comfortable spacing**, unchanged.
- **[Update]** Nothing else about density moved: the preference still persists to `localStorage` and is applied before first paint, compact mode still tightens the main padding, card padding, input padding and table rows, and the *Use compact spacing* entry is still available from the command palette.
- **Verification (live):** the header rendered without the toggle (`Toggle display density` no longer present; toolbar labels *Search ⌘K, Recent, AI, Help, Settings, My Account*), and **My Account → Use compact spacing** still flipped `data-density` `comfortable → compact → comfortable` and wrote it back to `localStorage`. Web typecheck 0; design-token lint unchanged.
- **Rollback:** one button block plus an unused icon import — no API, schema or data change.

## 2026.10.6.032 — Pasting from Word keeps its formatting, images go inline, and the editor gets its own right-click menu
- **[New]** **Pasting from Word (or Outlook, or a web page) now keeps its formatting.** The composer used to strip pasted markup down to plain text, so a formatted message arrived as a paragraph of flat text. Paste now runs through a Word-aware cleaner: font, size, colour, bold/italic/underline, lists, alignment, indentation, links and tables survive; Word's `<font>` tags are converted to `span` style so the declaration is not thrown away on the next paste, and its private `mso-*` declarations, `class="MsoNormal"` noise and `<!--[if ...]-->` comments are dropped along with anything outside a safe inline-style allowlist. The same cleaner runs on drag-and-drop and on `contenteditable` input, so the result is identical however the content arrived.
- **[New]** **Images pasted or dropped into the message are inserted inline, in the body**, the way they are in Outlook on the web or Gmail — not added as attachment chips. Up to **2 MB** each, and the toolbar gained an **Insert image** button for picking a file. The API converts each embedded image into a proper `cid:` part (`Content-ID: <img-…@c7ntax>`, `Content-Disposition: inline`) nested inside the HTML alternative, so the picture renders in place and is never listed as an attachment.
- **[New]** **Anything that is not an image still becomes an attachment.** Pasting or dropping a PDF, spreadsheet or text file adds the same chip the paperclip produces, with the same 5 MB rule and the same result on the ticket's Attachments tab — so a drop can carry a formatted table *and* a supporting file in one gesture.
- **[New]** **The message editor has its own right-click menu**, and it is context-aware: right-clicking a link offers *Open link*, *Copy link address*, *Edit link…* and *Remove link*; right-clicking an image offers *Remove image*; anywhere else offers *Cut*, *Copy*, *Paste as plain text*, *Select all*, the formatting commands (*Bold*, *Italic*, *Underline*), *Insert link…*, *Insert image…*, *Attach file…*, *Clear formatting* and *Undo*/*Redo*. The app-wide menu now takes an explicit opt-in (`useContextMenu().open(…, { allowInTextEntry: true })`) so this one editor can claim the menu while ordinary text fields keep the browser's native one — including its spell-check and paste suggestions.
- **[Fix]** **Embedded images were being sent as empty `<img>` tags.** The sanitizer emitted void elements (`img`, `br`, `hr`) without their attributes, so every inline image silently lost its `src` on the way out. Attributes are now written for void tags, and an `<img>` whose `src` did not survive is removed rather than left broken. Found by capturing real outbound MIME, not by reading the code.
- **[Fix]** **Long inline images were truncated mid-payload.** The outbound HTML cap was 200 KB, which cut off the base64 data URI before `extractInlineImages` could convert it. It is now 10 MB — matching the API's `express.json({ limit: "10mb" })` — with a per-URI length cap so a single oversized image is refused cleanly instead of being half-encoded.
- **[Update]** The editor keeps the image and table styling it needs (max-width on images, collapsed table borders) and reports an inline image that fails to load with a toast rather than leaving a silent gap. Inline images are counted separately from file attachments: **20 images, 2 MB each and 8 MB in total**, all inside the same 10 MB request budget as the attachments.
- **Verification (live):** pasting Word-style HTML into the composer kept `font-size: 11.0pt`, `font-family: Calibri`, `color: #1F3864`, `<b>` and `margin-left: 36.0pt`, converted `<font>` to a styled `span`, and discarded `mso-*` declarations, `MsoNormal` classes and conditional comments. A pasted image became one inline `data:image/png` with **no** attachment chip; a dropped `.txt` became a chip ("dropped-notes.txt 20 B") with a *1 file attached* toast. Right-clicking inside the composer showed every editor entry; right-clicking a link led with *Open link*/*Copy link address*/*Edit link…*/*Remove link*, and **Bold** applied from the menu. The outgoing message was captured at a local SMTP sink as `multipart/mixed` → `multipart/alternative` → `text/plain` + `multipart/related` (`multipart/related` holding the HTML and the `image/png` part with `Content-ID: <img-1-…@c7ntax>` and `Content-Disposition: inline`), with the `dropped-notes.txt` attachment as its own `multipart/mixed` part; the body referenced `src="cid:img-1-…@c7ntax"`, carried the Word styling and contained **no** `data:` URI, `mso-` declaration, `class=` or `<script>`. The database showed exactly one `TicketAttachment` row — for `dropped-notes.txt` — and no row for the inline image, which is also why nothing extra appeared in the Attachments tab.
- **Housekeeping:** the probe email comment, its attachment row and file, and its audit entries were removed, the snapshots re-captured, and the throwaway SMTP sink and its capture file deleted with port 587 freed. Web typecheck 0, api 156 (baseline) — both unchanged; design-token lint unchanged (no new raw hex).
- **Rollback:** edits to two existing files (`RichTextEditor.tsx`, `emailHtml.ts`) plus the ticket email route, `ContextMenu.tsx` and `packages/email`'s attachment type — a single `git revert` restores the previous paste behaviour and the browser context menu inside the editor. No schema, dependency or data change.

## 2026.10.6.031 — The Email Contact dialog is a real compose window, and attachments land on the ticket
- **[New]** **The Email Contact dialog is now a rich text composer** in the shape people know from Outlook on the web and Gmail: a formatting toolbar over a large writing area, with **bold, italic, underline, strikethrough, bulleted and numbered lists, blockquote, insert/remove link, clear formatting, undo and redo**, each button showing its shortcut on hover and its active state as you move the caret. Links get a small inline popover instead of a browser prompt — type `example.com/x` and it is normalised to `https://`, or select text first to turn the selection into a link, and *Remove link* unwraps it.
- **[New]** **Attachments work like a mail client.** Paperclip button, drag-and-drop onto the message, or paste a file from the clipboard; each file appears as a chip with an icon, its size and a remove button. Files over **5 MB** are refused with a toast (the same limit the API enforces), and the message cannot be sent until there is a subject and a body.
- **[New]** **A file attached to the email also joins the ticket's Attachments tab.** The API writes the same `TicketAttachment` row it would for the Attach File dialog — linked to the ticket *and* to the email comment — so it shows up in the Attachments tab, downloads normally, and appears as a real MIME part on the message that goes out. The email comment in Notes lists what was attached.
- **[Update]** **Outbound HTML is rewritten to a safe subset** by a new `apps/api/src/services/emailHtml.ts`: `script`, `style`, `iframe`, `svg`, `form` and friends are dropped with their content, unknown tags are unwrapped while keeping their text, `on*` handlers and `javascript:`/`data:` URLs are removed, and inline styles are filtered to a safe property list (`color`, `font-size`, alignment…). Messages now go out as **multipart/alternative** — the rich HTML plus a plain-text rendering — so clients that block HTML still see the message. The composer panel says so, and that the formatting is sanitised.
- **[Fix]** **A failed send no longer leaves a trace, and says why.** If the mailer cannot reach SMTP the request now returns 502 with "The email could not be sent — check the SMTP configuration under Administration → System Settings", and **nothing is recorded** — no phantom *Email* entry in activity and no orphan attachment rows or files on disk. The dialog surfaces the API's message instead of printing an object.
- **[Fix]** **The global `t` shortcut no longer hijacks typing in a rich text editor.** The handler only skipped `INPUT`, `TEXTAREA` and `SELECT`, so any `contenteditable` area counted as page background — typing a "t" in the composer jumped straight to the ticket list. Editable targets (`isContentEditable`) are now skipped, as are modifier combinations.
- **[Update]** The recipient row reads as a chip with the contact's name and address ("replies return to the shared mailbox"), and the footer keeps the existing note that the sent email is recorded in activity. The standalone Attach File dialog and its route are unchanged; the two now share one validated storage helper (`prepareAttachment` + `storeAttachments`), so the size, filename and encoding rules cannot drift apart.
- **Verification (live):** a local SMTP sink captured the outgoing messages — `multipart/mixed` → `multipart/alternative` (text + HTML) → attachment parts, with `<ul><li>` structure and link markup intact and the base64 payloads decoding back to the exact files. The database showed the email comment (`isEmail`) with **2 linked attachments** and the files on disk, and the Attachments tab rendered both (`screenshot.png 89 B · image/png`, `diagnostics.txt 67 B · text/plain`) while Notes showed the entry under an *Email* badge. The sanitizer was unit-tested against 16 payloads (script/iframe/svg/form, `onerror`, `javascript:` href, `position:fixed` style, unbalanced and nested tags) with zero dangerous output, and a hostile payload pushed through the real endpoint left the building stripped — the captured HTML contained no `<script>`, handler, `iframe` or `javascript:` URL. A 6 MB attachment returned 413, and with the sink stopped the send returned 502 having created **no** comment, attachment row or file.
- **Housekeeping:** every probe comment, attachment row, file on disk and audit entry was removed and the snapshots re-captured; the ticket is back to its three original comments with no attachments. Web typecheck 0, api 156 (baseline) — both unchanged; design-token lint unchanged. The SMTP sink was a throwaway script outside the repo and has been deleted; it never relayed anything.
- **Rollback:** two new files (`RichTextEditor.tsx`, `emailHtml.ts`) and edits to the email route, the dialog and one keyboard guard — a single `git revert` restores the previous plain-text dialog. No schema, dependency or data change.

## 2026.10.6.030 — The note status sits closer to the entry box
- **[Update]** **The visibility status now hugs the note box.** It was vertically centred in the composer footer — a 36px row built by the *Add Note* button — so its text started 24px below the box. It is now `self-start` with a small negative top margin, which lifts only that line: the distance to the box is **11px**.
- **[Update]** The rest of the footer is deliberately untouched: the row is still 36px tall, the *Internal* checkbox sits 12px from the row's top and the *Add Note* button spans the row exactly as before, so the controls did not move relative to each other or to the box.
- **Verification (live):** measured on ticket `e28544bc` — status 24px → 11px below the textarea, with no overlap; row height 36px, button 0–36px and checkbox at 12px within the row (identical to before); textarea 104px and the Notes card's two notes plus the Activity card's three entries all still rendering, in both the customer-facing and internal states.
- **Rollback:** two utility classes on one element — no API, schema or data change.

## 2026.10.6.029 — The note submit button reads "Add Note"
- **[Update]** **"Post" is now "Add Note"** on the ticket note composer, so the button names the thing it creates rather than the act of publishing it. Everything else about the control is unchanged — it stays right-aligned next to the *Internal* checkbox, is disabled until there is text, shows "..." while the request is in flight, and still submits by button or Ctrl/Cmd+Enter.
- **Verification (live):** on ticket `e28544bc` the button rendered as "Add Note" (95px wide, right edge 952 against the card's 973), disabled while empty and enabled once text was typed; submitting added the note with the blue *Note* badge and cleared the box. The probe note was then deleted and the snapshots re-captured, leaving the ticket on its three original comments.
- **Rollback:** one word — no API, schema or data change.

## 2026.10.6.028 — The note box says plainly what will happen when you post
- **[Update]** **The composer footer now leads with the outcome instead of burying it in a label.** The status sits on the left — "Will be emailed to the ticket contact" or "Internal only — the customer is not emailed" — and the *Internal* checkbox moved to the right, in front of Post, so the switch and the sentence it controls are no longer run together as one grey label.
- **[Update]** **The status is smaller and colour-coded**, and carries an icon: **blue** with an envelope for a customer-facing note, **amber** with a shield for an internal one. The colours match the *Note* and *Internal* badges in the list below, so the note's visibility is readable at a glance before it is posted. It is set at 11px against the 12px around it, so it reads as a status line rather than another form label.
- **Verification (live):** measured on ticket `e28544bc` — status text flush to the card's left edge (x=301) with an icon, the checkbox and Post grouped on the right (checkbox edge at 827, card edge at 973), both vertically centred on one line. Toggling the box switched the sentence and its colour (`rgb(96,165,250)` blue → `rgb(251,191,36)` amber) at 11px in both states, with no layout shift.
- **Rollback:** styling and copy only — no API, schema or data change.

## 2026.10.6.027 — Notes and Activity are separate cards, with an Internal switch on the note box
- **[Update]** **The ticket detail's "Notes & Activity" card is now two cards.** **Notes** holds the composer and the note stream; **Activity** holds logged time and the automatic field-change records that used to be buried in the same list. Both sit in the same column with the usual 20px gap, and the split is presentational only — the dedicated **Activities** tab still shows the complete merged timeline.
- **[Update]** **The note box is a proper multi-line composer.** It was a one-line input sized to the card; it is now a four-row textarea (≈104px tall) that spans the full card width, so a paragraph is visible while it is written. Enter inserts a newline and **Ctrl+Enter (⌘+Enter) posts** — the placeholder says which, and the Post button still works.
- **[New]** **An Internal checkbox decides whether a note is customer-facing.** Unchecked (the default) posts a customer-facing note that carries the blue *Note* badge and goes to the ticket contact through the existing notification path; checked, it posts an internal note with the amber *Internal* badge that is never emailed. The label states which it is at that moment ("· emailed to the ticket contact" / "· not emailed to the customer"), the placeholder switches between "Add a note for the customer…" and "Add an internal note…", and the box clears and resets to customer-facing after posting.
- **[Update]** **"Add Time Entry" no longer looks like part of Notes.** The red text link that sat directly under the compose row is gone from there; the Activity card now carries it as a secondary button in its own header, next to the heading.
- **[Fix]** **Field changes are labelled as changes.** The automatic records the API writes on every edit ("Priority: High → Medium") now appear in Activity under a *Change* badge rather than being mixed in with correspondence. They are recognised by the generated `Label: old → new` shape and the auto-close sentence, because `TicketComment` has no system flag to filter on; anything a technician typed stays in Notes.
- **[Update]** Neither card shows an empty shell: Notes reads "No notes yet." and Activity "No activity recorded yet."
- **Verification (live):** on ticket `e28544bc` the Notes card rendered badges `[Note, Note]` with the composer and the checkbox, and Activity `[Change, Time, Time]` with the *Add Time Entry* button in its header; the textarea measured 104px tall across 4 rows at full card width and the two cards were 20px apart. Typing then pressing Enter kept one entry with an embedded newline; ticking Internal flipped the placeholder and hint, and Ctrl+Enter posted with the toast "Internal note posted", the amber *Internal* badge and the box reset. The two probe notes were then confirmed in the database (`isInternal=true` and `isInternal=false`) and deleted, along with their two audit rows, so the ticket is back to its three original comments; the snapshots were re-captured to match.
- **Rollback:** one commit, presentational only — no schema, API or data change, so `git revert` restores the single card exactly.

## 2026.10.6.026 — Fourteen API endpoints that never worked, and a codebase bug sweep
- **[Fix]** **Fourteen endpoints were answering `500 Internal server error` on every call, and now work.** The route handlers passed Prisma `include`/`create` arguments for relations the schema never declares — every one of them was rejected with a validation error before a row was read. Affected: **Contracts** (`Contract.company`), **Reports** (`.createdBy`, `.schedules`), **Purchase Orders** (list `vendor`/`lineItems` and create's nested `lineItems`), **Workflow Rules** (list `actions`/`_count.executions` and create's nested `actions`), **Surveys** (list counts, detail `questions`/`responses`/`answers`/`question`, response create and read), **Knowledge Base** (`author`, `category`, `versions`, `linkedTickets`, and category `children`), **CRM sales activities** (`user`), **Projects** detail (`phases`, `tasks`, `tickets`, `company`, `manager`), **Locales** (`_count.translations`), **Exchange rates** (`from`/`to`), and **Chat sessions** (`_count.messages`). Each one now fetches the related rows with its own query and joins them in memory, so the response shape the routes always intended is preserved without a schema migration.
- **[Fix]** **Sending an invoice always failed.** `POST /billing/invoices/:id/send` wrote `sentAt`, which is not a column on `Invoice`, so the request died and the invoice stayed a draft — the Send button in Finance → Invoices only ever produced "Failed". It now sets the status alone (the model carries `issueDate`/`dueDate`/`paidAt`, no sent timestamp).
- **[Fix]** **Creating a service agreement always failed**, for the same reason: the UI's Auto-renew checkbox posts `autoRenew`, which `ServiceAgreement` has no column for. The create no longer writes it, and `PATCH /billing/agreements/:id` — which wrote the equally non-existent `price`, `cancellationDays` and `status` — now maps them onto `billingAmount`, `followUpIntervalDays` and `isActive`.
- **[Fix]** **Creating a purchase order always failed.** The route nested `lineItems: { create: … }` into `purchaseOrder.create`, which the schema does not allow, and the Procurement page posts its rows as `items` rather than `lineItems` — so even the field name never matched. Both spellings are accepted and the lines are written as separate rows; the subtotal is still computed server-side.
- **[Fix]** **`GET /kb/categories` was shadowed by `GET /kb/:slug`**, so the category list was fetched as if "categories" were an article slug and 500'd. The category routes are declared first now.
- **[Fix]** **The background worker's emails were being sent to nowhere.** `startWorkers()` runs inside the API process, and two of its jobs called the mailer incorrectly: invoice reminders called `emailService.sendInvoiceReminder(...)`, a method that does not exist (the class has `sendOverdueReminder`), and ticket follow-ups passed one options object where `sendTicketFollowUp(email, ticketNumber, ticketTitle, daysWaiting, portalUrl)` expects five arguments — which would have mailed `undefined`. Both jobs failed silently every 6 hours (reminders) and 30 minutes (follow-ups) and now use the real signatures, with portal links built from `WEB_ORIGIN`.
- **[Fix]** **Every valid project priority was rejected by validation.** `projectSchema` built its priority with `z.nativeEnum(z.enum([...]))`, and a Zod enum is not an enum object, so `"low"` and `"high"` both failed to parse. Now a plain `z.enum([...])`.
- **[Fix]** **Manage Roles had a button inside a button** (the member-count chip sat inside the role row's button), which is invalid markup and raised a React `validateDOMNesting` warning on every visit. The row is a wrapper with the chip as a sibling, and the context menu still covers the whole row.
- **[Fix]** **The ticket detail toolbar could throw while a ticket was loading** — Email contact and Schedule follow-up read `ticket.contact` before the record existed, unguarded. Both now no-op until the ticket is loaded.
- **[New]** **The Kumo Passwords and Kumo Configurations search boxes now filter.** Both rendered an input wired to `onChange={() => {}}`; they now match on label, username, email, URL and category (passwords) and on name, hostname, FQDN, IP and OS (configurations), and their section menus gained a *Focus search* entry whose Clear filters also resets the query. (Kumo Documents has no search box to wire.)
- **[Update]** **Typecheck debt cut: web 26 → 0 errors, `packages/shared` 1 → 0, api 178 → 156.** The web fixes are real ones — the `Utilization` type was declared as an array (so `useState<Utilization>` could not take one), `Object.keys(arr[0])` was unguarded, `KumoConfigs`'s templates and `KV` props were untyped, and `KumoPasswords`'s TOTP state omitted the `enabled` flag the API actually returns. The api remainder is pre-existing null-safety noise.
- **How the sweep was run:** a script compiled the Prisma schema into model/relation tables and checked every `prisma.<model>.<op>({ include/select })` in `apps/api/src` against it, then the API's own TypeScript output was used as the authoritative cross-check (Prisma's generated types flag the same mistakes as `'…' is not assignable to type 'never'` and unknown-property errors). Each fix was then exercised over HTTP against the running API.
- **Verification (live):** all fourteen endpoints re-probed and returning 200 with real data — Contracts 1 row with its client, Reports 2 with author and schedules, Purchase Orders with vendor and line item, Workflow Rules with actions and execution counts, Surveys with a real answer and its question text, KB article with author/category/versions/linked tickets, KB categories (previously unreachable), Locales, Exchange rates, Chat sessions. Writes were proven end to end and then removed: a purchase order (subtotal 500, one line item), a service agreement, a workflow rule with two actions, a CRM activity (which came back with its author), a survey response with its answer, and an invoice sent draft → sent and then restored to draft. A full browser crawl of all 51 routes, logged in, reported **0 failed API responses, 0 console errors and 0 DOM-nesting warnings** (down from two 500s and one warning).
- **Housekeeping:** every probe row was deleted and the invoice status restored (verified in both the database and the API); the one audit-log row the sweep generated was removed and the snapshots re-captured so they match the clean database. Temporary sweep scripts live outside the repo.

## 2026.10.6.025 — Right-click menus across Kumo and Finance, and four screens that showed nothing
- **[New]** **Every Kumo subsection except the dashboard now answers a right-click with a C7NTAX menu** — Organizations, Assets, Passwords, Configurations, Documents and Domains & Certs — each with an item menu and a section menu:
  - **Organizations**: open / new tab / new window, the client record, a new ticket, a **Kumo** submenu scoped to that client, "show only Client/Prospect/Vendor/Partner organizations", and copy (name, or a documentation summary with the asset, password, document, domain and certificate counts).
  - **Assets**: open / new tab / new window, a new asset from the row's template, "show only this client", copy details, and *Delete asset…*.
  - **Passwords**: show details, **reveal and copy the password** (the same 30-second auto-clear as the Reveal button), copy username/label/URL, a **TOTP** submenu (set up / remove), and *Deactivate entry…*. Its CSV export is **metadata only — secrets are never written to a file.**
  - **Configurations**: show details, open the linked asset record, copy hostname / IP / FQDN / a full specification block, and filter to the client.
  - **Documents**: open, new tab or window, copy the document link or title, filter to the client; folders get show-contents, new-document-in-this-folder and copy.
  - **Domains & Certs**: show details, filter to the client or to domains/certificates only, copy name, expiry date or the whole record, and a filter menu. The CSV carries the expiry date **and the days remaining**.
- **[New]** **All five Finance subsections work the same way** — Invoices, Agreements, Payments, Time & Expenses and Reports:
  - **Invoices**: open, download PDF, send a draft, record a payment on a sent/partial/overdue one, *set to repeat*, open the client, copy the number, amount or a full summary, plus a sort menu and CSV.
  - **Agreements**: start a new agreement for that client, open the client or their tickets, and copy the billing terms (amount, period, dates, auto-invoice).
  - **Payments**: copy the reference, amount, invoice number or the whole payment block, with a method filter, sort menu and CSV.
  - **Time & Expenses**: open the entry's ticket, show only billable or non-billable time, copy the time details; expenses get open-ticket, *Delete expense…* (which asks first) and copy. Time and expenses export separately.
  - **Reports**: the custom report builder, and the usual open-in-tab/window pair.
- **[Fix]** **The Analytics revenue chart now draws its bars.** They were sized with a percentage height inside a flex column whose own height came from its content, which resolves to nothing — so every bar rendered 0px tall and the chart looked empty despite the data being there. Bars are now sized in pixels against a fixed maximum (the current month pair reads 100px and 140px for $2,712.50 and $3,788.75).
- **[Fix]** **Clicking a Reporting subsection in the nav now changes the screen.** `/reports`, `/reports/standard` and `/reports/analytics` all render `ReportsPage`, so moving between them re-rendered the same component and the tab state kept whichever subsection was opened first. The route now owns the tab (the prop is synced on change, and the in-page tabs navigate), which also keeps the nav highlight correct. `BillingPage` had the same latent gap for its five routes and is fixed too.
- **[Fix]** **Payments showed nothing, ever.** The tab built its rows from `payments` on the invoices list, and `GET /billing/invoices` does not include payments — so the table was permanently empty even though three payments exist. It now reads `GET /billing/payments`, which returns exactly the shape the tab needs.
- **[Fix]** **Time & Expenses showed no time at all**, for the same reason: the tab derived its rows from `GET /tickets`, whose list payload has no `timeEntries`. A new `GET /api/billing/time-entries` (with the ticket and client) feeds it, and five existing entries appeared. Each row's menu can now open its ticket — the ticket id travels with the row.
- **[Update]** `apps/web/src/lib/menuActions.ts` (open in tab/window, copy with its toast, the "open this view in…" pair) is used by every menu, and the asset list now honours `?companyId=`, which it previously read only for its create deep link.
- **Still deliberately not offered**, because the app cannot do it: deleting a contact, deleting a client, a hard delete for a user (`DELETE /users/:id` only deactivates), deleting a calendar entry, and — new to this list — editing or deleting Kumo configurations, deleting Kumo documents, and any change to a domain or certificate (that router is read-only).
- **Verification (live):** every one of the eleven surfaces was right-clicked and its menu read back — Kumo Organizations (9 item / 6 section entries), Assets (8/7), Passwords (7 plus a TOTP submenu; 5), Configurations (9/6), Documents (6 for a document, 3 for a folder; 8), Domains & Certs (6/5), Invoices (8/7), Agreements, Payments (5/6), Time & Expenses (5 for a time entry, 4 for an expense; 6), Reports (3). The chart's bars measured 100px and 140px in the DOM, and switching Reporting subsections moved the active tab through Analytics → Standard Reports → Dashboards → Analytics with the URL and the nav highlight following. Payments showed its 3 real payments and Time & Expenses its 5 real time entries. Typecheck unchanged (web 26, api 178 pre-existing errors, none in the touched files); design-token lint unchanged.
- **Housekeeping:** the probe payment and probe time entry created to prove those two tables were reachable were deleted afterwards; `app_settings` untouched.

## 2026.10.6.024 — Right-click menus for Client List, Contacts, Manage Users, Manage Roles and Calendar
- **[New]** **Five more sections now answer a right-click with a C7NTAX menu instead of the browser's** — Client List, Contacts, Manage Users, Manage Roles and Calendar — each with an item menu and a section menu, on the same surface, with the same keyboard handling and the same switch as Tickets (Administration → System Settings → General → *Application right-click menus*).
- **[New]** **Client List** — a row offers open, open in new tab or a new window, new ticket, the client's tickets, the client's contacts, the primary contact's record, and a **Kumo** submenu (organization, passwords, configurations, documents, each scoped to that client). It can narrow the list to the row's own type, and copy the name, email or phone.
- **[New]** **Contacts** — show details, edit (opens the same form the Edit button does), create ticket, open the client or the client's tickets, filter the list to that company, *Make primary contact*, deactivate or reactivate, and copy.
- **[New]** **Manage Users** — details, edit, jump straight to the Permissions or Security tab, activate or deactivate, lock or unlock the account, *Reset MFA* (which asks first), and copy the email or name.
- **[New]** **Manage Roles** — show permissions, edit, manage members, copy the role name or its full permission list, and *Delete role…*, which is disabled with "reassign users first" while the role still has users.
- **[New]** **Calendar** — right-click a day for *Add event on this date…* (the dialog opens prefilled for 9–10am on that day), show or clear that date's events, month navigation and today. Right-click an event for its linked ticket, its date's events, and copying the title or the whole detail block.
- **[New]** **Every section menu ends with the same pair** — *Open this view in new tab* and *Open this view in new window*, current filters included — and each list screen can export exactly what is on screen as CSV (Clients, Contacts, Users and Roles).
- **[Update]** **Actions that would do nothing are disabled and say why**: *Reset MFA* when the user has no authenticator enrolled, *Delete role…* while users are assigned, *Make primary contact* for a contact who already is one, *Clear filters* when nothing is filtered. Labels follow the item's state, so *Lock account* becomes *Unlock account* and *Deactivate* becomes *Activate* as soon as it changes.
- **[Update]** The pieces every menu shares now live in `apps/web/src/lib/menuActions.ts` (open in tab/window, copy with its toast, the view pair), and Tickets uses them too, so the six sections cannot drift apart.
- **Deliberately not offered, because the app cannot do it yet:** deleting a contact (no endpoint), deleting a client (a hard delete with relations the schema does not cascade consistently, and no screen offers it), deleting a user (`DELETE /users/:id` only deactivates, so the menu says *Deactivate user*), and deleting a calendar entry (`/schedule` has no delete). Each would need its endpoint and a decision about what happens to the dependent records first.
- **Verification (live):** Client List row menu read back with its 12 entries and the header *Acme Corporation*, the Kumo submenu with its four destinations, the section menu with its 8, and the CSV export as `Company,Type,Contact,Phone,Location,Industry,Status` across 5 rows (with `"New York, NY"` quoted correctly). Contacts read back with 11 entries, and *Edit contact* opened the form for the card that was clicked. Manage Users read back with 9 entries; *Lock account* locked the account (toast, header gained *Locked*, item flipped to *Unlock account*) and *Unlock account* reverted it; *Reset MFA* asked *Reset MFA? Zz MenuProbe will need to enrol an authenticator again at their next sign-in.*, then cleared the MFA column and disabled itself again; *Deactivate user* flipped the header to *Inactive* and the item to *Activate user*. Manage Roles showed *Delete role…* disabled with *reassign users first* on the Admin role (3 users) and deleted a role with none end-to-end, from the confirmation panel through the toast. Calendar opened the day menu on the 11th with the header *Sunday, October 11, 2026* and prefilled `2026-10-11T09:00`–`10:00`, listed four entries for an event, showed *Open linked ticket #INT-2008* on the event that has one (and navigated to it), and disabled *Clear date filter* once cleared. Right-clicking a search box left the browser menu alone on every page, and Tickets was re-checked after the shared-helper change (16 row, 8 section, 16 detail entries, unchanged). Typecheck unchanged (web 26 pre-existing errors, none in the touched files); design-token lint unchanged.
- **Housekeeping:** the throwaway user, role, MFA flag and ticket-linked event created to prove these paths were removed afterwards, and `app_settings` was left as it was found.

## 2026.10.6.023 — An application right-click menu in Tickets, with a switch in System Settings
- **[New]** **Right-clicking in Tickets now opens a C7NTAX menu instead of the browser's.** On a ticket row it offers *Open ticket*, *Open in new tab*, *Open in new window*, *Change status* ▸, *Change priority* ▸, *Assign to* ▸, *Assign to me*, *Acknowledge*, *Close ticket*, *Add note*, *Log time entry*, *Email customer contact*, *Print ticket*, *Copy ticket number*, *Copy link* and *Delete ticket…*; on the background it offers the section's own actions (*New ticket*, *Refresh list*, *Filter tickets…*, *Clear filters*, *Choose columns…*, *Export as CSV*, and open-this-view in a new tab or a new window, filters included). The ticket's own number, client, status, priority and technician head the menu, so what you are about to act on is on the face of it.
- **[New]** **The three actions the mockup left out are now real rather than faked.** *Delete ticket…* opens a confirmation that names the ticket and warns that notes, attachments and time entries go with it, then calls a new `DELETE /api/tickets/:id` (requires `ticket:delete`, honours client access, and reports what it cascaded). *Assign to me* assigns the signed-in technician in one click, disabled when the ticket is already theirs. *Export as CSV* writes the filtered list using the columns you have chosen to display.
- **[New]** **Administration → System Settings → General → "Application right-click menus"** switches the menus on or off for everyone, stored in the `app_settings` system config. A change applies to screens already open, and the per-browser `c7_ui_context_menus` flag still overrides it locally. An unset value — or an unreachable API — means on, so the feature cannot be lost to a missing setting.
- **[Update]** **The menu works on the ticket detail screen too**, and its entries drive that screen's own handlers: *Add note* focuses the note box, *Log time entry* opens the time-entry dialog, *Attach file…* opens the attach dialog, *Print ticket* prints, *Refresh* reloads.
- **[Fix]** **Keyboard operation genuinely works.** Verification caught two real faults in the new menu: the panel never took focus, so arrow keys scrolled the page behind it — which closed the menu — and *Home*/*End* did nothing. The panel now focuses itself once positioned and hands focus back on close, and Home/End jump to the first and last item. Shift+F10 and the Menu key open a focused row's menu.
- **Verification (live):** the row menu read back with all 16 entries and its header (*INT-2008 · Indicators of compromise enrichment* / *Initech Solutions · on hold · Medium · Stephen Simmons*); Escape closes it; Shift+F10 opens it with focus inside; four ArrowDowns then ArrowRight reach the status submenu (all nine statuses); ArrowLeft and Escape back out. Right-clicking the search box leaves the browser menu alone. The detail menu read back with its 16 entries, and the *Add note* / *Log time entry* deep links land with the note box focused and the time dialog open, their `action` parameter cleared. CSV export produced `c7ntax-tickets-2026-10-06.csv` — 12,547 bytes, header `Ticket #,Summary,Status,Board,Client,Technician,Timestamp`, 96 rows matching the filtered list. *Assign to me* put *Admin User* on the ticket; *Delete ticket…* asked *Delete MSP-1001-1022 — ZZ ui delete probe?* and the ticket was gone afterwards (404 from the API as well). With the setting off, `contextmenu` went unprevented; switched back on, the app menu returned without a page reload. Endpoint check: create → assign → comment + time entry → delete returned `removed: {comments: 2, attachments: 0, timeEntries: 1}`. Typecheck unchanged (web 26, api 178 pre-existing errors, none in the new files); design-token lint unchanged (117 legacy hex, none new).

## 2026.10.6.022 — Expiry dates are visible everywhere, and numeric
- **[Update]** **The organization screen's Upcoming Expirations card now shows the date on the face of it** instead of hiding it in a hover tooltip: *acmecorp.com Wildcard · in 65 days · 12/10/26*. Reading the card previously told you how urgent something was but not when it actually expires, which are two different questions.
- **[Update]** **Expiry dates are now numeric** — `12/10/26` rather than `Dec 10, 2026` — via a new `formatDateShort` helper that follows the viewer's own locale, so a US reader sees month/day and a UK reader day/month. Applied to the tracker's rows, its detail panel (*Expires 9/11/26 (25 days overdue)*) and the Upcoming Expirations card, so all three read alike. The full written date is still available on hover, which also disambiguates a two-digit year.
- **Verification:** read back from the live pages — the card shows *in 65 days · 12/10/26* and *in 125 days · 2/8/27*; the tracker rows show *expired · 9/11/26*, *in 5 days · 10/11/26*, *in 35 days · 11/10/26*; and selecting a record shows *Expires 9/11/26 (25 days overdue)*. Typecheck unchanged (web 26, api 178 pre-existing errors), no errors in the changed files. Screenshots: `files/live-expirations-org-card.png`, `files/live-domains-dates.png`.

## 2026.10.6.021 — Domains & Certificates list shows the expiry date, not just the countdown
- **[Update]** **Every domain and certificate in the tracker now shows its actual expiry date alongside the time remaining** — "in 5 days" with "Oct 11, 2026" beneath it, "expired" with "Sep 11, 2026" — so the list can be read as a calendar rather than only as a countdown. Previously the date was reachable only by opening the record (or hovering), which meant scanning the list told you how urgent something was but not when it actually expires.
- **[Update]** A record with no expiry date now says **"no expiry tracked"** instead of showing nothing at all, so a blank space never reads as a rendering fault.
- **Verification:** rows read back from the live page — `initech.io` *expired · Sep 11, 2026*, `globexind.com` *in 5 days · Oct 11, 2026*, *in 35 days · Nov 10, 2026*, `acmecorp.com Wildcard` *in 65 days · Dec 10, 2026*, `acmecorp.com` *in 125 days · Feb 8, 2027*, `starkent.com Wildcard` *in 195 days · Apr 19, 2027*, `starkent.com` *in 310 days · Aug 12, 2027* — each row carrying both values, in expiry order. The detail panel already showed "Expires: date (label)" and is unchanged. Typecheck unchanged (web 26, api 178 pre-existing errors). Screenshot: `files/live-domains-dates.png`.

## 2026.10.6.020 — Kumo gets its own breadcrumb trail, and the global one goes back to normal
- **[New]** **Kumo now has its own breadcrumb trail, with a back button**, shown at the top of the Kumo content area: *Kumo › Organizations › Acme Corporation › Server* on a client's asset type, *Kumo › Assets › SRV-DC-01* on an asset, *Kumo › Organizations › Acme Corporation › Passwords* on a client-scoped list, and the active filter where there is one (*Kumo › Documents › Stale*, *… › Domains & Certs › Certificates*). It appears on Kumo screens only and starts at *Kumo*, since the header already carries the app-level *Home*.
- **[Update]** **The global header trail is back to how it was** — no back button, no Kumo-specific segments, built from the navigation tree alone, and shown everywhere as before. The two trails now do different jobs: the header one tells you where you are in the app, Kumo's tells you where you are in the client's documentation.
- **[Fix]** One correction remains in the global trail, because it was plainly wrong: `buildBreadcrumbs` accepted the **first** navigation child whose path was a prefix of the URL, and a section's root (`/kumo`) is a prefix of every one of its children. Every Kumo sub-page therefore read "Dashboard", and the invoices list at `/billing` read "Finance Dashboard". The **deepest** match now wins. Reverting just that function restores the previous behaviour byte for byte if ever wanted.
- **[Update]** Kumo screens that have nothing dynamic to add (the dashboard, Organizations, the Assets list) fall back to the navigation tree's trail, so all nine Kumo screens have a trail rather than only the six that register one.
- **Verification:** walked live — the header trail renders on every section with **no** back button (`Home › Kumo › Passwords`, `Home › Tickets`, `Home › Billing › Invoices`, `Home › Clients › Client List`), while Kumo's trail renders on Kumo routes only (`Kumo › Dashboard`, `Kumo › Organizations`, `Kumo › Organizations › Acme Corporation`, `… › Locations`, `Kumo › Assets`, `Kumo › Organizations › Acme Corporation › Passwords`, `Kumo › Documents › Stale`) and is absent on `/tickets` and `/billing`. The back button was driven in sequence — list → client → type → back → client → back → list — returning one step at a time through history; it sits above the page title with no overlap (checked by geometry and hit-testing), and Kumo's trail carries no duplicated Home icon. Typecheck unchanged (web 26, api 178 pre-existing errors). Screenshots: `files/live-kumo-trail.png`, `files/live-kumo-trail-scoped.png`.

## 2026.10.6.019 — Breadcrumb trails for every Kumo screen, with a back button
- **[New]** **The breadcrumb in the header now resolves for every Kumo screen and names what you are looking at.** Previously every Kumo sub-page collapsed to "Dashboard" — the trail matched the first navigation child whose path was a prefix of the URL, and `/kumo` (Dashboard) is a prefix of all of its siblings, so Passwords, Documents, Assets and the rest all read "Kumo › Dashboard". Matching now keeps the **deepest** match, which fixes every section, not just Kumo: the invoices list reads "Home › Billing › Invoices" instead of "Finance Dashboard".
- **[New]** **A back button sits in front of the trail.** It steps back through your history when there is history to step back to, and otherwise follows the nearest parent in the trail — so a bookmarked deep link still has a way back instead of a dead button.
- **[New]** **Screens name their own context,** which the navigation tree cannot know: *Home › Kumo › Organizations › Acme Corporation › Server* on a client's asset type, *Home › Kumo › Assets › SRV-DC-01* on an asset, *Home › Kumo › Organizations › Acme Corporation › Passwords* on a client-scoped list, and the active filter where there is one (*Documents › Stale*, *Domains & Certs › Certificates*). A screen's trail replaces the derived one and is withdrawn on navigation, so nothing leaks between pages.
- **[Update]** There is now exactly **one** trail, in the header, instead of a second one inside the page. The organization screen's old single back link ("← Organizations") is replaced by the shared trail, and every Kumo page picks the feature up without its own markup.
- **[Update]** Every segment except the current page is a link, and the current page is marked `aria-current="page"`.
- **Verification:** on the live app every Kumo route was walked and the trail read back: `/kumo`, Organizations, a client, a client's type, Locations, Assets, an asset, Passwords, Configurations, Documents, Documents filtered to Stale, and the tracker narrowed to Certificates — all showing the expected trail with a back button and **no React hook-order errors**. The back button was driven in sequence (list → client → type → back → client → back → list) and returned through history one step at a time; from a cold-loaded deep link with no history it returned to Organizations, as designed. Non-Kumo sections were checked too (`/tickets`, `/billing`). With `c7_ui_kumo_crumbs=0` the trail falls back to the navigation tree, and it is restored when the flag is removed. Typecheck unchanged (web 26, api 178 pre-existing errors), no errors in the changed files.

## 2026.10.6.018 — Card spacing on the organization screen, and a service worker that no longer hides updates
- **[Fix]** **The organization screen's cards were touching each other.** The wrapper added around the dashboard used `display: contents`, and Tailwind's `space-y-*` only matches direct DOM children — so every card lost its vertical spacing. Measured on the live screen: **0px** between all six card rows, which is the bunching that was reported. The wrapper now carries its own rhythm instead of relying on the parent, so cards sit 20px apart.
- **[Update]** The row gutters on that screen went from 16px to 20px as well, so the vertical and horizontal rhythm match rather than being two different values.
- **[Fix]** **The service worker was serving stale code in development.** [sw.js](apps/web/public/sw.js) cached every GET response cache-first, including Vite's dev modules, so code changes never appeared — a page reload, a dev-server restart and a cache-disabled reload all kept running the pre-edit code. Dev-server requests (`/src/`, `/@*`, `/node_modules/`) now bypass the cache entirely, navigations are network-first with the cached copy still available for an offline start, and the cache name was bumped to `C7NTAX-v2` so existing clients purge the stale entries on activation.
- **Verification:** measured in the live app rather than by eye — 20px between all six card rows (previously 0) and 20px in each of the three grid rows (previously 16), with the type rail unaffected; the seed round-trip, all ten deep links and the `UI_KUMO_TYPES` rollback were re-checked afterwards and still pass. Typecheck unchanged (web 26, api 178 pre-existing errors).

## 2026.10.6.017 — Asset types: the organization rail, 19 standard types and client-scoped screens
- **[New]** **Asset type rail on the organization screen.** Every documentation type for a client in one place, grouped as IT Glue groups them: **Core Assets** — Overview, Configurations, Contacts, Documents, Passwords, Domain Tracker, SSL Tracker, Locations, Vendors, Change Control — and **Asset Types**, which lists every Kumo asset type with a live count for that client. Clicking a type opens that client's records of it in place, with an Add button preset to that type and client, a search box, and each row linking to the asset. Types with nothing documented are hidden behind a *Show N empty types* toggle that is remembered per browser, so the rail never buries what is in use. Overview returns to the dashboard.
- **[New]** **19 standard asset types, seeded with their field definitions** — Backup (product, targets, schedule, retention, last verified, restore tested), Networks, LAN, Wireless, Internet/WAN, VPN, Email, File Sharing, Printing, Licensing, Remote Access, Security, Virtualization, Voice/PBX, Account Management, Active Directory, Applications, Checklists and Sales & Finance, each with an icon and a schema of five to six fields. **Opt-in and fully reversible:** `pnpm --filter api db:types-on` seeds them (idempotent) and `db:types-off` reverses it — the reversal only ever touches those 19 names, deletes the ones nothing uses, and deactivates any type that holds records so no asset is ever orphaned.
- **[New]** **Locations** shows the client's primary address from the client record and states plainly that separate sites per client are not modelled yet, rather than implying multi-site support.
- **[New]** **Change Control** opens that client's tickets (21 of the 96 on the demo data), automatically using a "Change" service board when one exists (`?boardId`), and falls back to the client's tickets when it does not.
- **[Update]** **Vendors** and a company-type filter on the Kumo client list — Clients, Prospects, Vendors and Partners — read from the `companyType` already on the client record, so a new `?companyType=` param deep-links to any of them.
- **[Update]** **Client-scoped screens**: Passwords, Configurations, Documents and Contacts accept a `companyId` param and show a chip that clears it; the expiry tracker accepts `kind=Domain|Certificate` so the rail's Domain Tracker and SSL Tracker land on the right half of the page; Tickets accepts `companyId` to scope the list to one client.
- **[Fix]** **Asset field values were being dropped.** The asset create form posted `fieldValues` while the API reads `values`, so every field entered on a new asset — backup schedule, VPN endpoint, and so on — was silently discarded. Fields now persist, which is what makes the typed asset records worth having.
- **[Fix]** **The Configurations list never filtered by client.** The servers payload omitted the owning asset's `companyId`, so the client filter always matched nothing and showed an empty list. It now returns 1 server for the demo client, matching the count on the rail.
- **[Update]** **[README](README.md) now records the convention that every change ships reversible:** UI work behind a flag in `uiFlags.ts` (off in one console line or one env var), data changes as an opt-in script with a matching reversal, no destructive schema changes, and a `<AREA>-ROLLBACK.md` per feature. This feature follows it — see [KUMO-TYPES-ROLLBACK.md](KUMO-TYPES-ROLLBACK.md).
- **Verification:** **API** — with a real signed-in token: `assetTypes` returned 3 templates with per-client counts before seeding and 22 after; `counts.configs` matched the rail; `?companyId=` scoping on assets returned 1 for the demo client, `?companyType=` returned 0 vendors and 5 clients, and Tickets returned 21 of 96. **Seed round-trip** — `on` (19 created), `on` again (19 kept, nothing duplicated), `off` (19 deleted), then a probe asset attached to VPN: `off` deleted 18 and *deactivated* VPN with its record still readable, `on` restored it, and the probe was removed afterwards leaving the demo data as found. **UI (live app, not mockups)** — all ten rail destinations opened correctly: overview, the Server type view (`Server · Acme Corporation`, 1 record, Add preset to that type and client), Locations, Passwords (1), Configurations (1), Documents ("3 of 4 documents" with the client chip), the expiry tracker narrowed to certificates, Contacts (3), Tickets (scoped), and `Kumo → Assets?new=1` opening **New Server** with the client preselected. The rail itself renders 11 links with empty types hidden and 32 with them shown, sticky at 208px beside the content. **Rollback** — with `c7_ui_kumo_types=0` the rail disappears and the page returns to its previous single-column layout, and an unknown `?type=` falls back to the dashboard instead of erroring. Typecheck unchanged (web 26, api 178 pre-existing errors), token lint unchanged (117 legacy hex in 9 allowlisted files), all new files error-free.

## 2026.10.6.016 — Every item on the organization screen opens its own record
- **[New]** **Clicking any entry on the organization screen now opens that specific record rather than a list.** Assets open their detail page, passwords open selected in the vault, configurations selected in Configurations, documents open in the reader, domains and certificates selected in the new tracker, contacts selected on the Contacts page, and sub-organizations on their own dashboard. The aggregates link to the matching filtered view too: a password-strength bucket opens the vault filtered by that strength (scored server-side only when the filter is asked for), the Stale and Not Viewed rings open Documents filtered, and the Expired ring and *View All* open the expiry tracker.
- **[New]** **Domains & Certificates** — a page in Kumo (nav entry after *Documents*) listing domains and certificates with their client, expiry date and renewal status, with All / Expiring soon / Expired filters and a detail panel. Certificates and domains previously existed only as counts, so this is what the expiry links land on.
- **[Update]** The Passwords, Configurations, Documents and Contacts pages accept a `select` / `doc` / `strength` / `filter` query param, so a link from the organization screen opens the item directly even on a cold load. Filtered views show a chip that clears the filter.
- **Verification:** on the live screen every entry was checked for a correct destination, then ten of them were opened and confirmed — password, configuration, document, domain, certificate, contact and asset all arrived with that record selected (the detail pane heading matched the item), a strength bucket opened the vault showing "Strength: Strong", the Not Viewed ring opened Documents at "Not viewed", and *View All* opened the tracker scoped to that client. Typecheck unchanged (web 26, api 178 pre-existing errors); token lint unchanged at 117.

## 2026.10.6.015 — The Organization dashboard in Kumo, and sub-organizations
- **[New]** **Clicking an organization in Kumo now opens a full documentation dashboard for that client.** `GET /api/kumo/organizations/:id` answers with everything the screen needs in one round trip: **Quick Notes** (the client record's notes, editable in place), **Password Strength** for the whole vault using the same ladder the vault uses, a **Documentation Health Summary** of stale / never-viewed / expired items, your **Recently Viewed By You** items for that client, its **Important Contacts**, **Recently Updated** records, **Popular Passwords**, **Upcoming Expirations**, **Locations** and a client **Activity Feed**. It is built from C7NTAX cards, tokens and icons rather than a copy of another product's chrome.
- **[New]** **Sub-organizations are now real records.** `Company` gained a nullable `parentId` self-relation (applied with `prisma db push`), and the client API accepts `parentId` on create and update with a cycle guard so a hierarchy cannot loop. The organization screen lists its children — each opening its own dashboard — and can create one from the header's Quick Add menu or from the section itself.
- **[Update]** **One password strength ladder for the whole app.** `packages/shared/src/passwordStrength.ts` now holds the scoring used both by the password vault (on reveal) and by the organization dashboard, so the two views cannot disagree. One visible side effect: a credential that scores full marks now reads "Very Strong" instead of "Strong".
- **[Update]** **The header title now follows the most specific route.** `getPageTitle` only matched exact paths, so nested pages such as `/kumo/organizations/:id` fell back to "Dashboard"; it now picks the longest matching nav entry, which also fixes the header on other detail pages.
- **[Update]** Organization entries in Recently Viewed now open the organization screen, and `apps/web/src/lib/format.ts` collects the initials, avatar tint and time helpers the two Kumo screens share.
- **Verification:** the endpoint was called live for Acme Corporation and returned real aggregates (1 asset, 1 password, 3 documents, 1 domain, 1 certificate; strength Strong 1; 3 never-viewed documents; 3 contacts; 7 activity events; a certificate expiring 2026-12-10). In the browser the screen rendered all eleven sections, a note saved through the UI, and a sub-organization was created, opened its own dashboard and was then deleted with the note reset to null — record counts and both empty states were identical afterwards. No page-level or card overflow at 1440 or 1280.

## 2026.10.6.014 — Kumo now tags new records to the client you choose, and the duplicate dashboard route is gone
- **[Fix]** **Kumo ignored the client selected when creating a record.** The password, asset, configuration/server, document and folder handlers all wrote `companyId: req.user!.companyId`, so the client chosen in the form was overwritten: every new record was tagged to the creator's own company, and nothing new could appear under the client it belonged to. All five now resolve the company through one helper — an explicit `companyId` wins, otherwise the record follows the creator's company exactly as before, and an unknown id is rejected with a 400 rather than written. (The asset handler previously stored `null` when no client was sent, so assets never appeared under any organization.)
- **[Update]** **The Assets, Configurations and Documents create forms now offer the client picker the Passwords form already had.** The missing picker was why a client choice could not be honoured: Assets, New Doc, New Folder and Add Server now send `companyId`, and "No client" keeps the previous behaviour of following your own company.
- **[Fix]** **`kumo.ts` registered `/dashboard` twice.** The first, unguarded copy — returning `{ data: { … servers, folders } }` — shadowed the permission-guarded copy further down the file, so the guarded route was dead code and the endpoint answered without its `KumoView` check. The duplicate is deleted and the surviving guarded route returns `{ assets, passwords, configs, documents, links }`; the dashboard cards accept either shape.
- **Verification:** an integration harness booted the real Kumo router on a spare port (with the dev port occupied, so no workers or pollers started) and drove it over real HTTP with a real signed token — all five creates stored the chosen client, an unknown `companyId` returned 400, exactly one `/dashboard` route was registered, it returned the flat five-key payload with a token and 401 without one, and the passwords/assets/documents/folders/servers row counts were identical before and after, with the harness deleting everything it created. In the browser the cards read the new payload (5 assets, 5 passwords, 1 server, 4 documents) and all four create forms expose a client picker. Typecheck unchanged (web 26, api 178 pre-existing errors); token lint unchanged at 117.

## 2026.10.6.013 — Organizations in Kumo: the client list with its documentation coverage
- **[New]** **A new Organizations view inside Kumo — every client, annotated with how much Kumo documentation it actually has.** `GET /api/kumo/organizations` returns a page of companies with grouped counts for assets, passwords, documents, domains and certificates, merged from five `companyId` groupings so the page costs a fixed number of queries instead of one lookup per row. The new `/kumo/organizations` page is built in the C7NTAX table style rather than a copy of another product: an IT Glue-style Recents strip of initials avatars, a debounced server-side filter beside an `n of total` counter, and a sortable table (organization, type, contacts, assets, passwords, documents, domains, certs, status). Clicking a row opens the client record and records the organization in Recents.
- **[Update]** **Kumo gains an Organizations entry directly after Dashboard** in the sidebar, and the Kumo dashboard's card for it replaces the old **Universal Links** card — which pointed at `/kumo` (itself) and counted a `links` field the dashboard endpoint never returns, so it always read "0 links". Organizations also now appear in Recently Viewed on the Kumo dashboard, with their own icon, label and colour.
- **[Fix]** **The Kumo dashboard's module cards showed "undefined assets" and "0 servers".** `/kumo/dashboard` answers with a nested payload (`{ data: { assets, passwords, documents, servers, folders } }`) and counts `servers`, while the cards read a flat `assets`/`configs`. The cards now read the nested payload and map `servers` to the Configurations card, so they show real numbers: 5 assets, 5 passwords, 1 server, 4 documents.
- **[Update]** Rollback is one switch — `localStorage.setItem("c7_ui_kumo_orgs", "0")`, or `VITE_UI_KUMO_ORGS=false` for a deployment-wide change — which hides the nav entry, the route and the dashboard card and restores the previous behaviour exactly. Full details in `KUMO-ORGANIZATIONS-ROLLBACK.md`, including the file list for removing it outright.
- **Verification:** route registration proved on the real router (41 registered routes, `GET /organizations` present); the payload was checked against the live database (5 clients, all 5 carrying coverage); the page rendered 5 rows whose counts match the API exactly, every column sorts both directions, and the rollback switch was exercised in the browser both ways — nav entry and route gone, Universal Links card restored. No page-level layout overflow at 1440×900. Typecheck unchanged (web 26, api 178 pre-existing errors); token lint unchanged at 117.

## 2026.10.6.012 — Removed the header dark/light toggle
- **[Update]** **The theme toggle is gone from the header toolbar.** Light/dark now switches from the Appearance section of the My Account menu, matching where the colour schemes are chosen. The header is down to the density toggle, Search, Recent, AI, Help, Settings and My Account.
- **[Update]** Dropped the now-unused `Sun`/`Moon` icon import from `Layout.tsx`. `useTheme` stays: the command palette still offers "Switch to light/dark mode" as an action, so the theme remains reachable from ⌘K as well as the menu.
- **[Verification]** Live, authenticated: the header toolbar exposes **no theme button** (`Compact spacing, Search (Ctrl/⌘ K), Recent Items, AI Assistant, Settings, My Account`), and the My Account menu's chips still drive the theme — `data-theme` went `dark → light → dark` when toggled from the menu and was left as found. No console or page errors on a clean reload; `apps/web` typecheck unchanged (26 pre-existing errors); design-token lint unchanged at 117 legacy occurrences.

---

## 2026.10.6.011 — Removed the header palette swap button
- **[Update]** **The palette swap control is gone from the header toolbar.** Colour schemes are now chosen in one place only — the Appearance section of the My Account menu, which is where they were being used anyway. The header keeps its density toggle, light/dark switch and the rest of the toolbar.
- **[Update]** Deleted `apps/web/src/components/PalettePicker.tsx`, now unused (recoverable from git history if the button is ever wanted back), and dropped its import and the `UI_PALETTE` reference from `Layout.tsx`. The flag itself stays: it still gates the scheme list in the My Account menu.
- **[Update]** `UI-PALETTE-ROLLBACK.md` — records that the scheme list lives in the My Account menu, so the Level 2 `VITE_UI_PALETTE=false` switch now hides the only palette control left in the UI.
- **[Verification]** Live: the header toolbar reports **no palette button** (`Compact spacing, Light, Search, Recent Items, AI Assistant, Settings, My Account`), while the My Account menu still lists all five dark schemes; switching from the menu drove the palette as before (`crimson → rose`), and reselecting the first entry restored `crimson`. Clean reload with no console or page errors; `apps/web` typecheck unchanged (26 pre-existing errors); design-token lint unchanged at 117 legacy occurrences.

---

## 2026.10.6.010 — Login page fits above the fold again (service health as a 2×2 grid)
- **[Update]** **The login page no longer scrolls.** The whole page — lockup, form, passkey buttons and service health — now fits the viewport at every size tested, with the service boxes as a **2×2 grid** instead of a single stack.
- **[Update]** **Service health boxes are compact**: the port moved down beside the status so each box is a tidy two lines, padding and gaps tightened, and the summary spacing reduced. The section drops from **275px to 145px**; a box goes from 384×52 to **189×48**.
- **[Update]** Trimmed the page's vertical rhythm to buy the last few pixels — outer padding `py-8`→`py-6`, lockup `mb-8`→`mb-6`, health section `mt-6`→`mt-4`.
- **[Verification]** Measured, not eyeballed, by comparing `scrollHeight` against the viewport: the page overflowed by **17px** at 997×820 before, and now reports **0px overflow at 1366×700, 1280×720, 1440×900, 997×820 and 390×844** (mobile), with the grid resolving to exactly 2 rows and no box clipping its text (checked via `scrollWidth` vs `clientWidth`). The **failure state was exercised too** by aborting `/api/health`: "3 services down", help text rendering inside the narrower 189px columns, still **0px overflow** and no clipping. No console errors; typecheck unchanged (26 pre-existing errors); token lint unchanged at 117.

---

## 2026.10.6.009 — Brand wordmark on the splash, loading and login screens
- **[Update]** **All three entry surfaces now use the brand wordmark.** The initial loading screen and the login screen (both the main form and the 2FA step) render the mask-based `<Wordmark>` introduced for the My Account menu, so the sheet's own letterforms — plate-free, and following the active colour scheme — are now the app's first and last impression rather than a text approximation.
- **[New]** **The pre-JS splash shows the brand lockup** instead of the words "Loading C7NTAX…": the shield and the wordmark, centred on the brand surface, with a soft pulse that is disabled under `prefers-reduced-motion`. It uses the flat `wordmark-on-dark.png` served from `public/`, because the splash renders before the bundle's CSS exists and so cannot use the masks.
- **[New]** `BrandMark` component — the sheet's shield on its black tile, used by the loading screen, both login screens and the sidebar. It replaces two hand-made placeholders (`bg-cyber-600` squares with the letters "C7") that stood in for a logo on the loading and 2FA screens.
- **[Fix]** `.input-field:focus` carried a hardcoded sky-blue glow, `rgba(14, 165, 233, 0.3)` — visible as a blue wash on the focused field of the login form. It is now derived from the scheme's accent with `color-mix`, so it reads crimson everywhere the brand schemes are active.
- **[Update]** `brand/README.md` records what each surface uses and why the splash needs the flat copy.
- **[Verification]** Splash verified deterministically by aborting the bundle request so `#root` stays empty: the mark loads at 56×56 and the wordmark at 159×38, both from the sheet's assets, over `rgb(13,13,15)`; with the pulse paused the wordmark paints **5423 letter pixels at x 838–1155** — exactly its box — plus the crimson shield and 7. On the login page the wordmark renders **168×40** with white letters and a crimson 7 landing at x 56–108 against an expected 52–107, the mark at 56×56, the shell at `rgb(10,10,11)` (the scheme's page surface) and the focus ring now crimson; the `h1` still exposes "C7NTAX" as a level-1 heading. No console errors on either screen; `apps/web` typecheck unchanged (26 pre-existing errors) and the design-token lint unchanged at 117 legacy occurrences.

---

## 2026.10.6.008 — Brand wordmark in the My Account menu, with the metallic plate removed
- **[New]** **The brand wordmark now heads the My Account menu.** It is the sheet's own logotype — the letters keyed out of their metallic plate into two alpha masks — so there is no plate behind it and no separate light/dark artwork. It was built as a reusable `<Wordmark>` component with a `.c7-wordmark` style block, ready to drop anywhere else the logotype is wanted.
- **[New]** `apps/web/public/brand/wordmark-mask.png` + `wordmark-7-mask.png` — the logotype at 327×78, taken from sheet x 51–377 / y 449–526. They are consumed as **CSS masks**, not pictures: the letters paint with the inherited text colour and the 7 with a new `--brand-crimson` token, so a single pair of files renders correctly on every surface and in all eight colour schemes. Also added flat `brand/wordmark-on-dark.png` / `wordmark-on-light.png` for contexts that cannot use masks (email, docs).
- **[Fix]** Extracting the logotype needed two different keys, and the reason is worth recording: the letters are pure `#FFFFFF` on a mid-tone plate, so luminance separates them, but **the crimson 7 sits on a plate that the mockup's red glow has already washed pink** — their hues overlap, and only saturation (`G/R ≈ 0.15` for the stroke against `0.4–0.9` for the wash) tells them apart. Keying the 7 by brightness or by hue yields either nothing or a rectangle of plate.
- **[Fix]** A CSS `mask` on an element also clips its own pseudo-elements, so the first cut of this — one masked element with the 7 drawn by `::after` — rendered the letters and silently dropped the crimson entirely. The two layers are now sibling elements, each masked on itself.
- **[Update]** `brand/README.md` — records the logotype's measured geometry, both keying methods and why each is needed, and notes that the 7's ~25px descender is the brand's own treatment (the standalone `mark-7-core.png` is 82×140, taller than wide), not a slicing error.
- **[Verification]** Verified from the browser's own pixels, not from the source files: at 2× the element captures 218×52 with the letters in the theme text colour (`rgb(247,248,248)` dark / `rgb(26,17,20)` light) and the 7 in `rgb(192,0,0)` — landing at x 35–68 against an expected 33–69 slot — with 72% of the box left unpainted, i.e. the plate really is gone. Both masks load at 327×78, no console errors on a clean reload, `apps/web` typecheck unchanged (26 pre-existing errors) and the design-token lint unchanged at 117 legacy occurrences.

---

## 2026.10.6.007 — Fixed the clipped shield/"7" brand icon
- **[Fix]** **App icon was mis-cropped**: the icon slices had been cut ~23px too high, which pulled in the red glow strip *above* the black tile and sliced the bottom off the shield — the favicon showed a pink checkerboard bar across the top with a clipped "7". Every icon-variation slice was re-cut at the tile's real bounds (black tile x 545–618, y 429–502), and the four web icons plus the desktop icon are now built from a 60×60 interior crop centred on the shield (strict bbox x 559–604, y 439–488) drawn at 88% of a flat black rounded plate, so the glyph is centred with an even margin and nothing is cut off.
- **[Fix]** `brand/README.md` — the caveat claiming the black tile's *own* top edge was glow-washed (`#9E8684`) was wrong; the tile is uniformly black (`#000000`–`#050102`) to its edges and the wash belongs to the strip above it. Replaced with the measured tile and shield bounds and a note on the centred-crop recipe, so the vertical offset can't be reintroduced.
- **[Fix]** `apps/desktop/build/icon.png` was never committed — the generic `build/` rule in `.gitignore` hid it, so electron-builder's `win.icon` (which points at it) fell back to the default Electron icon in a fresh clone. `.gitignore` now re-includes that single source asset (the rest of the directory stays ignored).
- **[Verification]** Shield-mask IoU between the delivered icon and the source tile is 0.975 (the "7" counter intact); at 512px the art clears the plate edge by 74/73/61/31px, so no clipping; the four icons serve HTTP 200 as `image/png` and the sidebar logo loads at naturalWidth 192; `apps/web` typecheck unchanged (26 pre-existing errors) and the design-token lint stays at 117 legacy occurrences.

---

## 2026.10.6.006 — Brand assets extracted from the composite sheet and wired into the app
- **[New]** `brand/` — eleven slices cut from the supplied brand asset composite sheet (primary wordmark, the three wordmark variations, the core "7" marks, the app-icon grid, the three shield variations, the palette/typeface specimen) plus `brand/README.md`, which records provenance **and the quality caveats**: the sheet is a rendered mockup, so the transparency checkerboard is baked into the pixels, a red glow is composited over the panels (the black shield tile reads `#020202` at the bottom but `#9E8684`/`#CCAFB2` at the top), and the largest icon is only ~74px.
- **[New]** **Real app icons**: `favicon.png` (2 KB), `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` built from the shield slice on a flat near-black plate with a rounded mask — so the plate edges stay crisp, the glow is minimised and the files compress. `index.html` gained the apple-touch-icon link and a brand `theme-color`, and the pre-JS splash background now matches the brand surface (`#0d0d0f`) instead of the old navy.
- **[Fix]** **Broken PWA install**: `manifest.json` referenced `/icon-192.png` and `/icon-512.png`, which did not exist, and still carried `short_name: "Overwatch"` with navy theme colours. It now lists the four real icons and uses the brand colours (`background #0d0d0f`, `theme #c00000`).
- **[Fix]** `sw.js` contained TypeScript syntax in a JavaScript file (`caches.match(req) as Promise<Response>`), which is a parse error — the service worker could never have installed. Fixed, and its notification icon/badge now use the brand PNGs; `node --check` passes.
- **[Update]** **Sidebar and login page** now show the extracted mark with the wordmark as text (`C` + a brand-crimson `7` + `NTAX`), which stays crisp at any size and follows the active colour scheme. This also removed the last hardcoded hex (`#C42D4B`) from `Layout.tsx` — the design-token allowlist count drops from 118 to 117.
- **[Update]** **Email templates** (`packages/email`): the off-brand cyan header bands and call-to-action buttons became brand crimson `#c00000` with white text, and cyan accent text became `#ff5c5c`; the semantic status bands (amber "Action Required", slate "Ticket Closed", red "Payment Overdue") are deliberately unchanged.
- **[New]** Desktop build icon (`apps/desktop/build/icon.png` + electron-builder `win.icon`).
- **[Verification]** `apps/web` typecheck unchanged (26 pre-existing errors, zero new); design-token lint passes; `manifest.json` and `apps/desktop/package.json` parse as valid JSON and `sw.js` passes `node --check`; the four icons, the manifest and the deleted `favicon.svg` were checked over HTTP; live check confirmed the sidebar mark loads at 32×32 with the wordmark "C7NTAX", the login page renders the mark and the crimson `7` (`rgb(255, 92, 92)`), the old hardcoded tile is gone, and `/assets` renders with no console errors.


## 2026.10.6.005 — My Account menu + brand colour schemes as the defaults
- **[New]** **My Account menu** — the header's previously inert *My Account* button now opens an account menu following the ConnectWise Manage / Autotask PSA / Scoro / NinjaOne pattern: identity block (initials avatar, name, email, role chip), **My Profile**, **Security & two-factor** (shows the current MFA state), **Preferences**, an **Appearance** section (dark/light switch, colour scheme list, density), **Help & Support**, **What's New**, and **Sign out**.
- **[Update]** **Brand Crimson is now the default dark theme and Rose Tint the default light theme.** `palette.ts` gained a `DEFAULTS` map; both `data-palette-*` attributes are always set, so a scheme is always active and an unknown/retired stored id falls back to the brand default.
- **[Update]** **Classic is gone** — removed from the picker, from the catalogue and from the CSS swatches. The base theme blocks stay as the token foundation the schemes override.
- **[Update]** The header palette button remains, but it and the My Account menu now share one `PaletteSchemeList` component so the two lists cannot drift apart.
- **[Update]** `Settings.tsx` gained section anchors (`#profile`, `#landing`, `#security`, `#session`, `#system`) with `scroll-mt-6`, and scrolls to the anchor on mount so the menu's deep links land in the right place.
- **[Verification]** `apps/web` typecheck unchanged (26 pre-existing errors, zero new); design-token lint passes (no raw hex in `.tsx`); live check with empty storage confirmed the defaults (`data-palette-dark="crimson"`, `data-palette-light="rosetint"`, `--surface #0d0d0f`) and a picker with no Classic entry; the My Account menu was driven end-to-end — Plum Noir applied from inside the menu (`--surface #180f16`), the light/dark switch swapped the list to the light schemes and applied Rose Tint, and **My Profile** navigated to `/settings#profile` with the Profile section scrolled into view; no console errors across `/`, `/tickets`, `/clients`, `/assets`, `/reports`.
- **[Fix]** Repaired the changelog structure: earlier entries in this file had been inserted *over* the previous day's `##` heading, so `2026.10.5.014`/`015` and `2026.10.6.001`–`004` were being parsed as a single version. The headings are restored and the changelog now reports **107 separate versions** (all five of today's entries present, no duplicates).


## 2026.10.6.004 — Colour schemes rebuilt on the C7NTAX brand palette
- **[Update]** All eight alternate schemes now derive from the brand asset sheet's palette — **`#C00000`** crimson, **`#EE5483`** rose, **`#662428`** maroon, **`#801550`** plum, plus black and white — replacing the previous navy/violet/amber/teal set. Dark: **Brand Crimson**, **Crimson Rose**, **Deep Maroon**, **Plum Noir**, **True Black (OLED)**. Light: **Brand Light**, **Rose Tint**, **High Contrast**. Classic remains the default and is untouched.
- **[Fix]** `#C00000` only reaches **3.0:1** against a near-black surface, so it cannot carry accent text on dark. The dark schemes therefore use lighter crimson tints (`#ff5c5c`) or the brand rose for accent text/icons and reserve `#C00000` for fills that carry a **white label (6.48:1)** — mirroring how the brand sheet itself uses the red. Plum fills use white at 9.81:1.
- **[Update]** Scheme swatches in the picker now preview the brand black/crimson pairing, and the light schemes carry brand-crimson status colours (`--alert-red #a30000`).
- **[Verification]** `apps/web` typecheck unchanged (26 pre-existing errors, zero new); design-token lint passes (no raw hex added to any `.tsx` — all scheme colours remain in `index.css`); an audit reading the shipped CSS confirms **80/80 contrast checks pass** across the eight scheme blocks (text, secondary, tertiary, muted, accent on all three surfaces, and primary-button label at rest and hover; worst pair 4.54:1); live check applied all eight schemes and confirmed the expected `--surface`, border, accent and button colours with no console errors, verified the picker lists the right schemes per mode, reset both modes to Classic, and re-checked `/`, `/tickets`, `/clients`, `/assets`, `/reports`.


## 2026.10.6.003 — Selectable colour schemes (5 dark + 3 light) with AA-audited tokens
- **[New]** **Colour scheme picker** in the header toolbar (next to the density and theme controls): choose a scheme per mode from **Classic** plus eight alternates — dark **Midnight Slate**, **Deep Violet**, **Warm Carbon**, **True Black (OLED)**, **Ocean Teal**; light **Cool Paper**, **Warm Stone**, **High Contrast**. Dark and light are chosen independently and each applies to its own theme.
- **[New]** `apps/web/src/lib/palette.ts` (catalogue, per-mode persistence, `applyPalettes()` before first paint) and `apps/web/src/components/PalettePicker.tsx`. A scheme is pure CSS applied via `data-palette-dark` / `data-palette-light` on `<html>` — no data, routing or behaviour is touched, and **Classic means "no attribute"**, so the built-in theme is never modified.
- **[Update]** Every alternate scheme is **WCAG AA audited (96/96 checks)**: body text, secondary/tertiary/muted text, accent-on-surface and the primary-button label all stay ≥ 4.5:1.
- **[Fix]** Introduced `--btn-primary-fg` so a scheme can pick a dark or light button label: the built-in dark primary button (white on `#00aae0`) is only **2.68:1**, while the alternates reach 4.93–8.75:1. `.btn-primary` now uses `color: var(--btn-primary-fg, var(--text-primary))`, which is byte-for-byte the previous `text-white` behaviour when nothing overrides the variable — Classic is visually unchanged.
- **[New]** `UI-PALETTE` flag (default on; `VITE_UI_PALETTE=false` / `localStorage.c7_ui_palette=0`) hides the picker, and `window.c7Palette` exposes `list()`, `get(mode)`, `set(mode, id)` and `reset()`.
- **[New]** `UI-PALETTE-ROLLBACK.md` — scheme table, three rollback levels and the list of files the feature owns.
- **[Verification]** `apps/web` typecheck unchanged (26 pre-existing errors, zero new); design-token lint passes with **no raw hex added to any `.tsx`** (scheme colours and picker swatches live in `index.css`); live check: the picker lists the schemes for the active mode, selecting **Warm Carbon** / **Deep Violet** / **True Black** / **Cool Paper** applied the expected `--surface`, border, muted-text and button colours with zero console errors, Classic restored the original tokens exactly, both modes store independently, and `/`, `/clients`, `/assets`, `/billing/dashboard` render normally with the app left on Classic.


## 2026.10.6.002 — Silent boot startup + shared hidden launcher for both tasks
- **[New]** `scripts/run-hidden.vbs` — one generic hidden launcher used by both scheduled tasks: `wscript.exe //B //Nologo run-hidden.vbs <script.ps1> [args…]` runs PowerShell with `SW_HIDE` (console created hidden), passes extra arguments through, and logs to `startup/hidden-runner.log` if the target script is missing. Replaces `scripts/auto-sync-hidden.vbs`, which covered only auto-sync.
- **[Fix]** **C7NTAX Boot Startup** no longer flashes a console window at boot/login — it now launches `startup/c7ntax-boot.ps1` through the hidden runner instead of `powershell.exe` directly. Boot trigger (45s delay), `RunLevel Highest` (needed for service/Defender work), batteries allowed, `IgnoreNew`, `StartWhenAvailable` and the 30-minute limit are all preserved; the working directory is now pinned to the repo root.
- **[New]** `scripts/register-boot-task-hidden.ps1` — re-registers the boot task with the hidden runner. It **must run elevated**: the task's `Highest` run level makes `Register-ScheduledTask`, `Set-ScheduledTask` and `schtasks /Change` fail with "Access is denied" for a standard token (this is how the change was applied).
- **[Update]** Both tasks set `WorkingDirectory` to the repo root, and the scripts' header comments document the launcher.
- **[Verification]** Launcher probe (script path containing spaces + a pass-through switch) ran correctly with **0 visible console windows** across 43,645 samples, versus 1 visible window for the old direct `powershell.exe` action (62,684 samples); `C7NTAX Auto-Sync` then ran end-to-end through `wscript.exe` → `powershell.exe`, committing and pushing a real change (`7ca0ac0`, `LastTaskResult = 0`); both task definitions read back with the new action, trigger and settings intact; API :4000 and web :3010 still HTTP 200.


## 2026.10.6.001 — Silent auto-sync (no more console window pop-ups)
- **[Fix]** The **C7NTAX Auto-Sync** scheduled task no longer flashes a command-prompt window. Task Scheduler was launching `powershell.exe` directly; even with `-WindowStyle Hidden` PowerShell creates its console window and then hides it, which is the visible flash every 15 minutes. The task now runs `scripts/auto-sync-hidden.vbs` via `wscript.exe //B //Nologo` — a GUI host with no console — and `Shell.Run(cmd, 0, False)` starts PowerShell with `SW_HIDE`, so the console is created hidden and never appears.
- **[New]** `scripts/auto-sync-hidden.vbs` — resolves the repo from its own location (with the canonical path as fallback) and launches `scripts/auto-sync.ps1` hidden.
- **[Fix]** Removed the task's battery restrictions (`DisallowStartIfOnBatteries` / `StopIfGoingOnBatteries` were both enabled, so auto-sync silently stopped on a laptop running off battery). Re-asserted `MultipleInstances = IgnoreNew`, `StartWhenAvailable`, and a 10-minute execution limit; the 15-minute repetition trigger, interactive principal (required for the SSH push) and run level are unchanged.
- **[Verification]** Task re-registration confirmed by reading it back (action `wscript.exe //B //Nologo "…\scripts\auto-sync-hidden.vbs"`, interval `PT15M`, duration `P3650D`, batteries allowed); `Start-ScheduledTask` completed with `LastTaskResult = 0` and a fresh `startup/auto-sync.log` line, with the process tree confirmed as `wscript.exe` → `powershell.exe` and no leftover processes or temp files.


## 2026.10.5.015 — UI modernization P2 (elevation, typography, sticky tables, content width) + rollback switch
- **[New]** **Card elevation** — soft layered shadows on every `.card`, with a subtle `translateY(-1px)` hover lift and cyber-blue border accent on interactive cards (`a.card`, `button.card`, `.card--interactive`). Theme-aware shadow tokens (`--card-shadow`, `--card-shadow-hover`, `--card-hover-border`) for dark and light.
- **[Update]** **Typography polish** — Inter `font-feature-settings: "cv11", "ss01"`, `text-wrap: balance` on headings, `tabular-nums` on tables, and page titles (`PageHeader`) at 22px with tighter tracking.
- **[New]** **Sticky table headers** with an opaque themed background, plus a 150ms row-hover transition, so long lists stay readable while scrolling.
- **[Update]** **Content container** — page content is capped at 1600px and centered so it no longer stretches edge-to-edge on ultra-wide displays.
- **[New]** Independent **P2 kill switch** alongside P1 — deployment-wide via `VITE_UI_P2=false`, or instantly in the browser via `localStorage.c7_ui_p2=0` / `c7UiP2.disable()` + reload. The command palette also gained a "Turn off look-and-feel polish (P2)" action. All P2 CSS is gated by `data-ui-p2="true"` and is inert when off.
- **[Update]** `UI-P1-ROLLBACK.md` now documents both tiers, and `scripts/rollback-ui-p1.ps1` gained `-Part P1|P2|All`.
- **[Verification]** `apps/web` typecheck unchanged (26 pre-existing errors, zero new); design-token lint passes (no new raw hex); live check on `/`, `/tickets`, `/assets`: `data-ui-p2="true"`, card shadow + hover lift/border confirmed via computed styles, `thead th` sticky with opaque background, tables `tabular-nums`, `/assets` title 22px, content wrapper `1600px`; with `c7_ui_p2=0` every P2 effect reverts (no shadow, no max-width, `font-feature-settings: normal`) while P1 stays on; removing the key restores P2 — no console errors.


## 2026.10.5.014 — UI modernization P1 (command palette, density, nav accents) + rollback switch
- **[New]** **Command palette** (⌘K / Ctrl-K): searches every page in the nav tree plus quick actions (New Ticket, toggle theme, toggle density, turn off P1); arrow keys + Enter + Esc, mouse hover, scroll-into-view. The existing header **Search** button now opens it.
- **[New]** **Density toggle** (comfortable / compact) in the header toolbar; persisted per browser and applied before first paint.
- **[Update]** Sidebar active items gain a cyber-blue accent rail + gradient (P1-scoped CSS).
- **[New]** Single **kill switch** — `apps/web/src/lib/uiFlags.ts`. Deployment-wide via `VITE_UI_P1=false`, or instantly in the browser via `localStorage.c7_ui_p1=0` / `c7UiP1.disable()` + reload. With it off, the app renders exactly as before (all P1 JSX/CSS is gated by `data-ui-p1`).
- **[New]** `UI-P1-ROLLBACK.md` (3 rollback levels) and `scripts/rollback-ui-p1.ps1` (`-Restart`, `-Enable`).
- **[Verification]** `apps/web` typecheck unchanged (26 pre-existing errors, zero in the new files); design-token lint passes; live check: Ctrl-K opens the palette, filtering+navigation works (`calendar` → `/calendar`), density toggles `comfortable`↔`compact`, and with the flag off `data-ui-p1="false"` with no palette/density control (original UI), re-enabling restores P1 — all with no console errors.

## 2026.10.5.013 — Design-system primitives + token/contrast cleanup (UI modernization P0)
- **[New]** Added shared UI primitives under `apps/web/src/components/ui/` — `PageHeader`, `Section`, `StatCard`, `EmptyState`, `Skeleton`/`TableSkeleton` — to replace the hand-rolled header/section/state markup duplicated across pages (78 page headers, 66 section labels).
- **[Update]** Migrated the Asset Inventory, Calendar, and Service Boards (Administration) page headers to `PageHeader` for a consistent title/subtitle/actions treatment.
- **[New]** Added `scripts/lint-design-tokens.mjs` — fails when a new raw hex color appears in a `.tsx` (the 9 pre-existing offenders are allowlisted), so theme-breaking colors can't creep back into the codebase.
- **[Fix]** Raised the dark-theme muted text tokens (`--text-muted`, `--text-muted-alt`) to meet WCAG AA (4.5:1) against the surface color.
- **[Verification]** `apps/web` typecheck unchanged (26 pre-existing errors, none in the new or migrated files); the token lint passes; a live check confirms `/assets` and `/calendar` render the new header (title + subtitle) with no console errors.

## 2026.10.5.012 — Automatic GitHub sync (auto-commit + push)
- **[New]** Added `scripts/auto-sync.ps1` and registered the scheduled task **"C7NTAX Auto-Sync"** (every 15 minutes, run while signed in): stages working-tree changes (respecting `.gitignore`), commits `auto-sync: <timestamp>` when there is something to commit, and pushes to `origin main`. Skips when there is nothing to commit, when a merge/rebase is in progress, or when the git index is locked.
- **[Update]** Complements the existing hooks — `pre-commit` regenerates and stages the What's New fallbacks, `post-commit` pushes after a commit; the missing piece was auto-committing, which this job adds.
- **[Verification]** Ran the job twice: pushed `38399a2` (30 files) and `ac5c89a`; `origin/main` now matches local (`0/0`), no `.env` or `.login-body.json` was staged, and the task shows `Ready` with a 15-minute recurrence and its next run scheduled.

## 2026.10.5.011 — Cloud provider recommendation reference doc
- **[New]** Added `cloud-provider-recommendation.md` — a standalone reference of the AWS-vs-Azure recommendation (recommend **Azure** for this codebase/product), with the rationale, where AWS wins, the deciding-factor table, and the practical notes (no cloud SDK lock-in; Front Door port caveat).

## 2026.10.5.010 — Cloud provider decision record (AWS vs Azure)
- **[New]** Recorded the AWS-vs-Azure recommendation in `PLAN-Azure-Dev-Prod-Split-and-Sync.md` §15 (PLAN-016): **recommend Azure** for this codebase/product — Microsoft-centric identity (Entra ID SSO + M365 Graph already integrated), Azure OpenAI as the Bedrock-equivalent for the AI assistant, native Container Apps blue/green, and 1:1 SOC 2 control mapping — plus the conditions under which AWS is the better choice.
- **[Update]** Cross-referenced the decision record from `PLAN-AWS-Dev-Prod-Split-and-Sync.md` §14 and the PlanDocs PLAN-010 copy; regenerated the PLAN-016 registry copy.
- **Note:** decision/documentation only — no application code change; both migration plans remain plan-only.

## 2026.10.5.009 — Azure dev/prod migration plan (PLAN-016)
- **[New]** Added `PLAN-Azure-Dev-Prod-Split-and-Sync.md` — the Azure twin of the AWS dev/prod split plan: same sync-command semantics, phases, rollback, and verification, with every AWS service mapped to its Azure equivalent (ACR, Container Apps, Application Gateway + Front Door, PostgreSQL Flexible Server, Key Vault, Blob + immutable logs, Azure Monitor, Entra ID managed identity, DDoS Protection Standard, Azure OpenAI).
- **[New]** Registered it in the PlanDocs registry as `PLAN-016` (copy at `PlanDocs/PLAN-016-Azure-Dev-Prod-Split-Sync.md` + index row).

## 2026.10.5.008 — Document the admin bulk status email gap
- **[New]** Added `adminBulkticketemail.md`, a reference explaining why `POST /api/bulk` (`ticket_update`) can change a ticket status without emailing the customer, how it differs from `POST /api/tickets/batch`, why it was left out of the notification change, and the steps to wire it.

## 2026.10.5.007 — Notify the customer contact on ticket activity
- **[New]** Ticket activity now emails the ticket's customer contact whenever a non-internal note is added, a time entry is logged, or the ticket status changes (individual edit, bulk update, or the worker's automatic close after inactivity).
- **[New]** Added `EmailService.sendTicketActivity`, a customer-facing template that greets the contact by name and shows the ticket number/title, the event, and the client-facing detail; internal notes and internal time-entry notes are never included.
- **[New]** Added `apps/api/src/services/ticketNotifications.ts`, a shared best-effort helper (`notifyTicketContact` / `notifyTicketStatusChange`) used by the ticket routes and the background worker; delivery failures are logged and never fail the originating request.
- **[Update]** Status notifications report the previous and new status and are only sent when the status actually changes.
- **[Verification]** Captured live SMTP output end-to-end: a public note, status changes, and two time entries each delivered exactly one message to the ticket contact with the correct recipient, subject, and escaped body, while an internal note delivered none. The API also boots cleanly with the new worker import (no circular-import failure).

## 2026.10.5.006 — In-depth time entry dialog
- **[Update]** Rebuilt the Add Time Entry dialog on ticket details (and consolidated the inline quick-add into the same modal) with PSA-grade fields: work date, resource, start/end times, auto-calculated duration, billing status (Billable / Non-billable / No Charge), work type, work role, optional hourly rate, client-facing notes, and internal notes — modeled after ConnectWise Manage / AutoTask time entry.
- **[New]** `TimeEntry` now persists `startTime`/`endTime`, `workType`, `workRole`, `internalNotes`, and `noCharge`; the time API accepts an optional resource override and per-entry rate. Work dates are parsed as local dates so entries no longer display one day behind.
- **[Update]** Time entry lists, the Activities feed, and the Billing time view now show work type, role, and rate; No Charge entries display a distinct amber badge.
- **[Update]** Invoice generation honors per-entry rates and excludes No Charge entries from billable totals.
- **[Verification]** Exercised the dialog live: billable, non-billable, and No Charge entries all saved and rendered with correct metadata; duration auto-calculates from start/end; explicit work dates display on the correct day. API/web source lint remains blocked by unrelated pre-existing strict-TypeScript errors.

## 2026.10.5.005 — Complete ticket-detail actions and workflows
- **[New]** Ticket details now provide an SMTP-backed contact email composer, a print-ready ticket summary, scheduled follow-ups with date/time/assignee/notes, and a More Actions menu for editing, copying the ticket link, and changing status or priority.
- **[New]** Ticket attachments now upload actual files (5 MB maximum) to API-managed storage and download them through authenticated ticket-scoped routes; legacy metadata-only attachments are marked unavailable, and runtime uploads are excluded from Git.
- **[Fix]** Added the missing ticket comment endpoint used by the Notes UI; Audit Trail now filters records server-side by ticket; Refresh reloads the active tab, Finance loads its expense totals, and failed time saves keep the entry dialog open.
- **[Verification]** All 12 ticket tabs and the action dialogs were exercised in the live web app; Add Note focus was verified. API source lint remains blocked by unrelated existing strict-TypeScript errors.

## 2026.10.5.004 — Change history and prompt logging standard
- **[Update]** Added `.github/copilot-instructions.md` to require a Retrace entry for every user prompt and a BuildNotes/What's New entry for every completed project change; documented version generation and static fallback regeneration.
- **[Update]** Backfilled the theme, Service Alerts, and GitHub-sync work from this conversation into BuildNotes and Retrace.

## 2026.10.5.003 — Service Alerts respect configured sort order
- **[Fix]** `apps/web/src/pages/ServiceAlerts.tsx` now sorts monitored service cards by configured `sortOrder` (then name) and active alert cards by the related service's `sortOrder` (then newest detection), so administration ordering is reflected on the display page. Recently resolved alerts remain chronological.
- **[Verification]** Live API values and rendered cards were checked; configured order was reflected in both sections.

## 2026.10.5.002 — Keep Service Alerts page display-only
- **[Update]** Removed the Configure link from `apps/web/src/pages/ServiceAlerts.tsx`; alert display and Refresh remain, while service configuration stays in Administration.
- **[Verification]** Live page check confirmed no Configure link and Refresh remains available.

## 2026.10.5.001 — Improve light-mode contrast and alert banner
- **[Fix]** Darkened shared light-theme link, muted-text, and border colors in `apps/web/src/index.css`; removed duplicate injected light-theme CSS from `apps/web/src/hooks/useTheme.tsx` so the stylesheet is the single source of theme values.
- **[Update]** `apps/web/src/components/Layout.tsx` now styles the global service-alert banner red in both themes, with dark red text and border on light surfaces.
- **[Verification]** Live computed styles confirmed improved light-theme colors and preserved dark-theme banner colors.

## 2026.8.31.001 — Outage recovery: full stack restarted via boot task
- **[Fix]** App reported "connection refused": both API (:4000) and frontend (:3010) had no listeners (last boot 2026-08-29 had finished with errors; processes were gone by 2026-08-31). Ran the C7NTAX Boot Startup scheduled task — boot completed clean: API attempt 1 OK, frontend OK, login 200, frontend check 200.
- **[Verification]** `/api/health` 200; login returns a valid token; `/api/tickets?limit=5` 200; web :3010 200.

## 2026.8.24.001 — App outage fixed: boot script stranded frontend + self-heal poller false-degraded
- **[Fix]** App was down (screenshot: frontend connection failure). Root cause 1: `startup/c7ntax-boot.ps1` started the API but waited only 60s for it to bind :4000, then `exit 1` BEFORE the frontend step — a slow API cold start stranded the web with no :3010 listener. Hardened: API start now retries twice with a 120s window per attempt, and on failure the boot logs CRITICAL but continues to start the frontend instead of aborting (never strands the web again).
- **[Fix]** Root cause 2: `apps/api/src/services/poller.ts` health check GETs `/api/auth/login`, which is POST-only → permanent 404 → poller reported "degraded" and ran a useless repair loop every 30s. Replaced that check with `GET /api/health`; health check now reports "up" and the loop is silent.
- **[Fix]** Restarted the stack via the C7NTAX Boot Startup task: boot completed clean (API attempt 1 OK, frontend OK, login 200, frontend check 200). Verified: `/api/health` 200, auth-gated routes 401 (alive), web :3010 200, poller no longer logs degraded.

## 2026.8.19.016 — Peer review (Claude Sonnet 5) incorporated into AWS + Kumo plans
- **[Update]** PLAN-010: architecture diagram + §4 security bullet revised — CloudFront + AWS Shield Standard in front of the ALB (WAF is L7 rules, not volumetric DDoS), S3 buckets annotated (bucket SSE-KMS is baseline; vault data depends on envelope encryption), tamper-evident CloudTrail bucket (S3 Object Lock compliance mode / dedicated log account), SSM Session Manager admin access (no bastion/SSH, no inbound ports).
- **[Update]** PLAN-010 §11: 11.1 rewritten as edge-layer WAF/rate limiting (CloudFront + Shield + WAF); 11.3 replaces bastion SSH with SSM Session Manager; new 11.7 (tamper-evident audit trail) and 11.8 (envelope encryption for vault data — per-record and per-tenant DEKs wrapped by per-tenant KMS CMKs once tenancy decided). §12 gains a peer-review notes bullet; §13 gains decisions #7 (tenancy model: multi-tenant SaaS vs single-tenant — decide BEFORE SC-02 migration) and #8 (adopt CloudFront + Shield).
- **[Update]** PLAN-015: phase 1 gains a peer-review gate (per-tenant KEKs/CMKs if multi-tenant; decide tenancy before the migration); open decision #1 ties KEK scope to the PLAN-010 §13.7 / PLAN-003 Step 0 decision; #2 notes KMS provider enables per-tenant CMKs (aligns with PLAN-010 §11.8).
- **[Update]** PLAN-003 (MultiTenant.md): new Step 0 — tenancy model decision gate (multi-tenant SaaS vs single-tenant; RLS vs schema-per-tenant; per-tenant KMS keys) that blocks the PLAN-015 phase-1/SC-02 envelope-encryption migration; Steps 1–3 unchanged.

## 2026.8.19.015 — IT Glue security comparison → PLAN-015 Kumo vault plan + plan updates
- **[New]** Reviewed IT Glue Security Whitepaper + Kaseya "About password security and encryption" and compared to C7NTAX. Created **PLAN-015 (Kumo Vault Security & Encryption Upgrade)**: 11 dependency-ordered phases — per-password AES-256-GCM data keys + RSA-2048 KEK (private key passphrase-encrypted outside the DB), key rotation, decrypted-data hygiene, password versioning/rollback (`kumoPasswordVersion`), reveal TTL, granular `kumoPasswordAccess` ACLs, host-proof vault mode (browser-only decryption), sensitive-password access workflow, at-risk password report, 32-char generator policy, snapshot/reseed + verification. Includes rollback, verification, and open decisions.
- **[Update]** PLAN-013: gap analysis item 14 (Kumo encryption parity); new phase #11 (Kumo vault security parity, PLAN-015 integration surface); phase #6 extended with enforced MFA, SSO-only mode + per-user overrides, login brute-force rate limiting; phase #8 scoped to app-wide items (Kumo crypto → PLAN-015); frontend surfaces and moved/appended notes updated.
- **[Update]** PLAN-010: new §11 "Security & compliance controls (IT Glue parity)" with 11.1–11.6 (WAF + rate limiting, IP access control, network segmentation, vuln-scan/pen-test calendar, backups + restore tests + replication/failover, SOC 2 change management); old §11/§12 renumbered to §12/§13 and the §12 port reference updated to §13.

## 2026.8.19.014 — Ticket list pagination + Show All in filtered board view
- **[New]** `pages/Tickets.tsx` — client-side pagination for the ticket listing: page-size selector (10 / 25 / 50 / 100 / All, default 25) on the right of a new list footer below the table card; when more tickets exist than the page size, pagination controls appear with jump-to-first/last (`«` / `»`), prev/next arrows, and a page-number window with gap ellipses (`1 … 4 5 6 … 9`); active page highlighted in cyber theming; page resets to 1 when filters/board change and when the page size changes.
- **[New]** "Show All" link on the bottom-left of the same footer (visible when any status/priority/technician/date filter is active) — clears all filters and shows every ticket on the current board, the same as clicking the board name.
- **[Update]** Select-all checkbox now operates on the currently visible page (standard paginated-table behavior); the footer shows the total ticket count for the active filter.
- **[Verification]** web typecheck (changed file clean); Vite dev server serving the updated page ("Show All" present in transformed module).

## 2026.8.19.013 — Every ticket has a contact; contact email/phone on ticket details
- **[Update]** Sample data: every ticket now has an assigned contact. 7 legacy tickets with no contact were assigned appropriate contacts (primary/first contact of their company); `seed-ticket-samples.ts` now guarantees a contact for every seeded ticket (company contact, falling back to any contact). 0 tickets remain contactless; reseed snapshot re-captured (tickets.json 96 rows).
- **[New]** Ticket details client info card now shows the assigned contact's **email** and **phone** alongside the contact name; `GET /tickets/:id` includes `contact.phone` in its select.
- **[Verification]** DB check 0 tickets without contact; detail endpoint returns contact name + email + phone (e.g. Tony Stark / tony@starkent.com / +1-555-0501); web typecheck clean; API restarted via boot task and serves the new field; Vite dev (3010) serves the updated page.

## 2026.8.19.012 — Sample ticket data for every Service Board
- **[New]** `apps/api/src/seed-ticket-samples.ts` — idempotent sample-ticket seeding: 88 new tickets across all 4 active boards (MSP +24, Infrastructure +20, NOC +21, Intelligence +23; every board ≥20 additions) with varied statuses, priorities, sources, and ages so every board badge (New, Workable, On Hold, Waiting, Escalated, open, stale 3/7/30-day, Avg Age) is non-zero with varied numbers. Per-board target counts make re-runs no-ops; existing tickets are never touched.
- **[Fix]** Renumbered 7 legacy tickets whose ticketNumber prefix did not match their board's ticketCode, which had hidden them from board-filtered ticket lists. Badge counts now equal the filtered list counts (Infra 25, MSP 25, NOC 23, INT 23).
- **[Update]** Reseed snapshot re-captured: `tickets.json` now holds all 96 tickets (88 new + 8 existing, existing data intact); capture total 416 records across 88 tables; diff-only writer left unchanged tables untouched.
- **[Verification]** `/boards/metrics` (auth): all badges non-zero and varied — Infra: new 6, workable 10, on hold 2, waiting 4, escalated 3, stale 8/5/1 · MSP: 7/7/3/5/2 stale 4/2/1 · NOC: 4/7/1/3/1 stale 5/4/1 · INT: 5/5/2/5/1 stale 3/2/1; board-filtered lists match badge counts; snapshot ↔ DB ticket ids identical (96/96); idempotency re-run adds 0.

## 2026.8.19.011 — Tickets UX polish series + self-updating What's New pipeline
- **[New]** Tickets toolbar reorganized: board selector + Create pinned far left, Filter + Choose Columns on the right, all on one row (`pages/Tickets.tsx`).
- **[New]** Quick Actions: the per-row "Modify Ticket" menu was renamed to Quick Actions and now renders through a portal pinned to the viewport's far left so it can never be clipped by the table's overflow containers; a selection-gated Quick Actions button was added to the toolbar row (disabled until one or more tickets are checked, then applies Acknowledge / Close / Set Status / Set Priority to all selected tickets via `POST /tickets/batch`).
- **[New]** Quick Actions dropdown polish: chevron moved to the far left of the trigger button, the menu opens left-aligned directly underneath the arrow, and the menu width is content-sized (`w-max` grid) with no blank space on the right — it grows and shrinks automatically as options appear or disappear.
- **[New]** Global hover tooltips: a single event-delegated `components/GlobalTooltip.tsx` (mounted once in App.tsx) shows themed tooltips for every button, link, input, select and textarea across the app, deriving labels from `data-tooltip`, `aria-label`, `title`, labels/placeholders, lucide icon names, or visible text. Native titles are temporarily suppressed while the custom tooltip is open so they never double-show.
- **[New]** Service board cards: the New, Workable, On Hold, Waiting and Escalated metrics are now clickable links that open `/tickets` filtered to that board + status (Workable → in_progress, Waiting → waiting_on_client + waiting_on_third_party, Escalated → open + critical); hover ring + underline marks them clickable. Board name and "View tickets →" remain links to the board.
- **[Update]** Tickets list filters are now URL-param driven (`status`, `priority`, `assignedToId`, `dateFrom`, `dateTo`), so deep links from boards load pre-filtered. The API list endpoint accepts comma-separated multi-value status/priority and the literal `status=open` (everything not closed/cancelled).
- **[New]** Filter dialog: "Filter By" quick filter (Workable / Escalated / Waiting / On Hold / New) added above Status, mapping to the matching underlying filters; all filter options now use proper capitalization ("Closed", "In Progress", "Waiting On Client", …).
- **[Fix]** Quick action chevron column moved from the far right of the ticket table to immediately left of Ticket #; dropdown blank space removed.
- **[Fix]** What's New stopped updating — root cause: the page read a static build-time copy (`apps/web/public` → `dist/BuildNotes.md`) while the root `BuildNotes.md` is the live source, and the copy step ran only manually. The page now fetches `GET /api/system/changelog`, which parses the root file on every request (path resolution hardened to walk up from the API location + `C7NTAX_ROOT` env); a pre-commit git hook regenerates the static fallbacks (public MD + JSON) automatically; the static-file fallback remains for offline use.
- **[Update]** Changelog policy documented: a change is complete only when Build Notes, Retrace, and What's New have all been updated.
- **[Verification]** web typecheck (changed files clean); vite build success; `/api/system/changelog` serves the newest entry; 80 versions regenerated.

## 2026.8.19.010 — Reseed snapshot refreshed with all manual changes
- **[Update]** Re-ran `snapshot-capture.ts` to capture the latest application state: users.json now holds all 9 users (including the newly added ones); all other changed tables re-captured. Capture total: 313 records across 86 tables; unchanged tables skipped by the diff-only writer.
- **[New]** Added 15 previously-uncaptured tables to the snapshot pipeline (`snapshot-capture.ts` TABLES + `seed-from-snapshots.ts` SEED_ORDER): emailConnector, ssoConfig, webhookConfig, aiProviderConfig, calendarSyncConfig, technicianSkill, projectTaskDependency, kumoPasswordAccessLog, kumoDocumentRevision, kBArticleVersion, kBArticleAttachment, kumoWorkstation, kumoNetworkDevice, currency, alertWebhookDelivery — secret-bearing fields excluded via select (email passwords, client secrets, webhook secrets, AI API keys, calendar tokens, SSO config payloads).
- **[Fix]** Corrected Prisma client names for KB article version/attachment (kBArticleVersion / kBArticleAttachment).
- **[Verification]** Full delete + re-insert reseed round-trip (71 fixture inserts); after reseed: users 9, tickets 8, kumo assets 5 — all manual data intact.

## 2026.8.19.009 — Sample data coverage for every section & subsection
- **[New]** `apps/api/src/seed-coverage.ts` — idempotent per-table guards (creates only when count is 0) seeding sample rows for every previously-empty area: Calendar (scheduleEntry), Procurement (vendor, purchaseOrder, pOLineItem), Payments (payment), Analytics (report + reportSchedule), PTO & Holidays, Contracts + milestones, Sales activities, KB categories, Chat (session + messages), Workflows (rule + action + execution), Locales + translations, Surveys (survey/question/response/answer), M365 (user/group/subscription), Sync logs + synced entities, Expenses, Alert rules + log, Notifications, Kumo Configurations (kumoServer), Kumo domains/certificates/links, and Project phases + tasks. 39 tables verified non-empty after reseed.
- **[Update]** Snapshot pipeline: added the 23 new tables to `snapshot-capture.ts` TABLES and `seed-from-snapshots.ts` SEED_ORDER in dependency order (parents before children: vendor→purchaseOrder→pOLineItem, survey→question→response→answer, contract→milestone, workflowRule→action/execution, locale→translation, chatSession→chatMessage, projectPhase→projectTask). Corrected Prisma client names for two models (pOLineItem, kBCategory). Captured all new fixtures; full delete+re-insert reseed round-trip verified (71 fixture inserts).
- **[Fix]** Notification sample fields corrected to the schema (type instead of severity); m365Group/m365Subscription guarded separately so partial states self-heal.
- **[Verification]** `ALL COVERED (39 tables)` after reseed; fixture files present with expected row counts; version computed via `scripts/next-version.mjs` (2026.8.19.009).

## 2026.8.19.008 — Service alert banner: reliable per-alert dismissal
- **[Fix]** `components/Layout.tsx` — banner dismissal raced with the visibility-gated poller: the polling callback captured a stale `dismissedAlerts` state closure, so a poll that started before dismissal could resurrect the same banner within the next minute. Rewrote the logic to read the dismissed-alert set FRESH from localStorage on every poll (`loadDismissed()`), made the poll callback identity-stable (`useCallback([])`), and made `dismissBanner` persist the dismissal synchronously to localStorage (capped at 50 ids) before hiding the banner. Result: the close button reliably hides the banner, the same alert never reappears, and a NEW alert (different id) shows the banner again immediately.
- **[Verification]** web typecheck 17 (baseline; changed file clean); Vite transforms Layout.tsx (200); next version computed via `scripts/next-version.mjs` (2026.8.19.008).

## 2026.8.19.007 — Ticket list: configurable columns, drag reorder, Timestamp/Technician/Summary
- **[New]** `pages/Tickets.tsx` — PSA-style configurable ticket list (Autotask/ConnectWise/HaloPSA/Kantata/Scoro/NinjaOne/Atera reference):
  - Timestamp column: shows creation time; switches to last-updated time once the ticket has changed (tooltip shows both).
  - Summary (ticket subject) moved to its own column; Technician column added (assignee from the API's existing `assignedTo` include).
  - Columns are draggable via header drag-and-drop to reorder; click a header to sort (supported fields keep sorting).
  - Choose Columns button above the ticket card opens a modal with a checkbox list of all columns; displayed columns are pre-checked; Priority is available but unchecked by default. Visibility + order persist per user via localStorage (`c7_ticket_columns`).
- **[Update]** Help docs: "Ticket list columns" steps added to the UI Shortcuts & Batch Actions walkthrough + Index row (maintenance rule).
- **[Verification]** web typecheck 17 (baseline; changed file clean); Vite transforms Tickets.tsx (200); `/tickets` serves 200; version computed via `scripts/next-version.mjs` (2026.8.19.007).

## 2026.8.19.006 — Date/version generation logic fixed permanently
- **[Fix]** Entries 2026.8.18.018–.022 were created on 2026-08-19 but carried the previous day's date octets (manually typed). Renumbered to 2026.8.19.001–.005 per the scheme (build resets to 001 on a new day). Header Last Updated corrected to 2026-08-19; Retrace references updated to match.
- **[New]** `scripts/next-version.mjs` — computes the next version from the actual system date + the highest existing build for that day; eliminates manual date errors permanently.
- **[Update]** `apps/api/src/verify-post-change.ts` — now also runs `scripts/generate-buildnotes.mjs` automatically, so What's New outputs refresh after every post-change verification (in addition to the boot step 6a).
- **[Update]** Versioning Scheme + `PROMPT-LIBRARY.md`/`NewProjectPrompts.md` P2 — version date octets must be derived from the current date, never typed.

## 2026.8.19.005 — App-wide button/endpoint audit (all sections & subsections)
- **[Fix]** Cross-checked every API path used by web buttons/dialogs against the mounted API routes. Four silent-404 breakages found and fixed:
  - `GET /api/kumo/dashboard` missing → added (Kumo dashboard stats: asset/password/document/server/folder counts).
  - `GET/POST /api/system/failover/status|reset` missing → added (SystemConfig-backed failover counter + reset, survives restarts).
  - `GET /api/assets?limit=50` (Tickets → configurations tab) → repointed to existing `/kumo/assets?limit=50`.
  - Verified all other web API calls resolve (cloudconnect/types, billing/expenses, kumo/configs/servers, inference/suggestions, system/audit-logs, service-alerts/monitor-status, tickets/batch, inventory/assets/import, etc.).
- **[Verification]** api typecheck 177 / web 17 (both baseline; changed files clean). Boot via scheduled task clean; the three fixed endpoints now return 401 (auth-gated route exists) instead of 404; `/api/health` 200.

## 2026.8.19.004 — Service Alerts: Add Service button fixed
- **[Fix]** `ServiceAlertsSettings.tsx` — the Add Service button appeared to do nothing: the editor dialog rendered only when `form.name !== "" || editing`, but `openNew()` reset the form to an empty name, so the dialog never opened. Added a dedicated `showForm` state — `openNew`/`openEdit` set it true, save/Cancel/backdrop close it via a new `closeForm()` — and the dialog now renders on `showForm`. Save still posts to the existing `POST /api/service-alerts/services` (verified the route + SERVICE_FIELDS whitelist already include the form's fields).
- **[Verification]** web typecheck 17 (baseline, changed file clean); `/admin/service-alerts` serves 200.

## 2026.8.19.003 — Broken buttons/links audit & fixes
- **[Fix]** Audited the entire web app for non-functional buttons/links (grep sweeps for href="#", no-op onClick, handler-less button blocks, and Link targets vs registered routes). All nav Links verified against App.tsx routes; all multiline buttons in Users/Roles/Tickets/ServiceAlerts/Settings verified to have handlers. Top-right header placeholders excluded per instruction.
- **[Fix]** `Reports.tsx` Analytics → Quick Actions: "Export Dashboard PDF" now generates a real PDF (jsPDF + autoTable with revenue metrics); "Schedule Weekly Report" now opens a working dialog (report select, day, time, recipients) posting to `POST /api/reports/:id/schedules`; "Custom Report Builder" was navigating to a dead SPA route (`window.location.href = "/reports/custom"`) — now a `Link` to the new route.
- **[New]** `pages/CustomReports.tsx` + route `/reports/custom` — list/create custom reports (name, type ticket_summary/revenue/custom, config JSON validated), Run (uses `GET /api/reports/:id/run`) with results table.
- **[Update]** Help docs (maintenance rule): added "Custom Reports & Scheduling" walkthrough + Index rows in the same change.
- **[Verification]** web typecheck 17 (baseline; one transient noUncheckedIndexedAccess error fixed in CustomReports); `/reports/custom` and `/help/walkthroughs/custom-reports` serve 200.

## 2026.8.19.002 — Help walkthroughs + documentation maintenance rule
- **[New]** Feature walkthroughs in the Help docs (`pages/HelpDoc.tsx`, 12 new sections under `/help/walkthroughs/*`): Email-to-Ticket Setup, Quotes & Convert to Invoice, Billing & Agreements (block/Cyber Care/spot, overtime, midnight split, bill-through), Uptime Monitors (website/SSL/DNS), Service Alerts & Outage Monitoring, Alert Webhooks, AI Actions (risk-classified), MFA/SSO/Passkeys, Outlook Add-in, CloudConnect Integrations, Kumo (passwords/documents/audit/file manager), UI Shortcuts & Batch Actions. Each includes step-by-step configuration instructions where configuration is required, and clickable related-content links.
- **[Update]** Help Index reorganized into feature-set groups (Getting started & UI, Ticketing & email, Billing & agreements, Monitoring & alerts, Integrations, AI, Identity & security, Kumo & KB, Mobile) with rows linking to walkthroughs and app pages. Help landing page now shows the 4 core sections plus a Feature walkthroughs grid.
- **[New]** Documentation maintenance rule (durable): whenever a feature or function is added, updated, changed, or removed, create/update its walkthrough in the same change and keep its Help Index rows and related-content links accurate. Rule recorded in `PROMPT-LIBRARY.md` (P3) and `NewProjectPrompts.md` (P3).
- **[Verification]** web typecheck 17 (baseline); Vite transforms HelpDoc/Help (200); `/help/walkthroughs/email-tickets` serves 200.

## 2026.8.19.001 — Help section (button + nav + PSA-style docs)
- **[New]** `pages/Help.tsx` — Help landing page: hero + 4 subsection cards (icon, title, description) + quick links.
- **[New]** `pages/HelpDoc.tsx` — PSA-style documentation frame modeled on Autotask / ConnectWise Asio / HaloPSA help centers: left rail (section navigation + on-page anchors), content blocks (headings, numbered steps, note/tip/warn callouts, tables), and a "Related topics" cross-reference box linking help sections and app pages. Content for Getting Started, FAQ, Configuration, Index (data-driven `HELP_SECTIONS`).
- **[Update]** `components/Layout.tsx` — Help button (top right) converted from placeholder to a `Link` to `/help`; new parent nav section "Help" in `NAV_TREE` with subsections Help Home, Getting Started, FAQ, Configuration, Index; header descriptions added for the five `/help*` routes; `Settings2`/`ListOrdered` icons imported.
- **[Update]** `App.tsx` — routes for `/help` + 4 subsections; removed a duplicate `/quotes` route.
- **[Fix]** Callout styles: removed side-accent borders (border-l + rounded-r) in favor of full tinted backgrounds per design review.
- **[Verification]** web typecheck 17 (baseline; changed files clean); Vite transforms both new modules (200); `/help` SPA route serves 200.

## 2026.8.18.017 — What's New auto-refresh fix
- **[Fix]** What's New stopped updating: `scripts/generate-buildnotes.mjs` had not been re-run after BuildNotes entries .014–.016, so `apps/web/public/BuildNotes.md` (the What's New page data source) and `apps/api/src/BuildNotes.json` stalled at .008. Regenerated both (68 versions, through .016); verified `/BuildNotes.md` serves .016 and `BuildNotes.json` contains .014–.016.
- **[Update]** `startup/c7ntax-boot.ps1` — added step 6a: runs `scripts/generate-buildnotes.mjs` on every boot so What's New outputs refresh automatically from the root BuildNotes.md (idempotent).

## 2026.8.18.016 — Now-deployable backlog implemented (12 items, non-breaking, verified)
- **[New]** Backend: `Quote`/`QuoteLineItem`/`WebauthnCredential`/`PushDevice`/`AiAction`/`AiActionAudit`/`AlertWebhookDelivery`/`OutlookAddinToken` models + `EmailConnector.transport/clientId/clientSecretEncrypted/tenantId` + `ServiceAlertService.monitorKind/monitorUrl/monitorConfig` (additive, `db push` synced).
- **[New]** Routes: `quotes.ts` (CRUD + convert-to-invoice), `push.ts` (device registration + sync markers), `aiActions.ts` (risk-tier propose/decide; critical blocked), `alertWebhooks.ts` (webhook CRUD + delivery log), `outlookAddin.ts` (batch email→ticket with messageId dedup), `ssoExchange.ts` (env-gated OIDC login, JWKS RS256 verify, user auto-provision), `webauthn.ts` (@simplewebauthn passkey register/login). `billing.ts` gains `POST /invoices/generate-from-tickets` (draft-only).
- **[Update]** `alertMonitor.ts`: website/ssl/dns monitor kinds with the existing 2-poll clear-streak rule; `serviceAlerts.ts` field whitelist extended.
- **[Update]** `emailConnectorRuntime.ts`: M365 Graph transport (client-credentials OAuth + Graph mail API) beside IMAP.
- **[Update]** Auth: `signToken` 15-min expiry + bcrypt cost-12 rehash-on-login behind `AUTH_HARDENING_ENABLED`; `startup/security-scanners.ps1` (optional gitleaks/trivy) wired into boot.
- **[New]** Web: `Quotes`, `Monitors`, `Webhooks`, `AiActions` pages + routes; Login gains SSO button, passkey sign-in/register, `?token=` SSO callback; FinanceDashboard gains generate-from-tickets; keyboard shortcut `T`→tickets; skeleton CSS (reduced-motion safe).
- **[New]** `ROLLBACK-BACKLOG-2026-08-18.md` (per-item + unified rollback; all flags listed). `seed-backlog.ts` + snapshot fixtures for new tables (capture + seed-from-snapshots lists extended).
- **[Verify]** Boot (scheduled task) → API PID fresh, `/api/health` 200, web `/` 200, login check 200; new routes live (quotes/ai-actions/webhooks/push = 401 auth-gated, sso/status 200 `{"enabled":false}`); typechecks: api 177 / web 17 (all errors in pre-existing files; changed files clean). C7NTRL `docs/DEV-HANDOFF.md` updated + pushed (commit 72ffdcf): prerequisites fulfilled, Phase 4 should target C7NTAX alert webhooks.

## 2026.8.18.015 — PLAN-015: strict dependency-order renumbering
- **[Update]** `PLAN-C7NTAX-Feature-Backlog-UI-Billing-Kumo-Integrations.md` (PLAN-015 §2) — reorganized the 16-item implementation plan into strict dependency order: Phase A billing chain (#1 agreements/time engine → #2 expenses → #3 bill-through batch invoicing), Phase B independent upgrades (#4–#13, no unresolved prerequisites, parallel-safe), Phase C externally gated (#14 remote-session notes ← C7NTRL phase 7; #15 client portal ← PLAN-003 Step 2/PLAN-002; #16 infrastructure ← PLAN-010). SMS verification moved #14 → #13 (ungated before gated). All `Depends on` / `Risk if skipped` notes updated with the verified statuses (batch ops ✅, QB Realm ID ✅, file manager ✅, connection fix/re-test ⚠️, per-service RSS/DownDetector ⚠️). No items added or removed; names, paths, and details preserved. PlanDocs copy re-synced with revision note.

## 2026.8.18.014 — PLAN-015: Feature Backlog (UI, Billing, Kumo, Integrations, Infrastructure)
- **[New]** `PLAN-C7NTAX-Feature-Backlog-UI-Billing-Kumo-Integrations.md` (PLAN-015) — status-mapped all 24 requested features against the verified codebase (✅ batch ticket ops via `bulk.ts` + Tickets.tsx selection, QuickBooks Realm ID fields, Kumo file manager; ⚠️ partials: invoice generate, report writer, CloudConnect fix/re-test dialog, M365 sync, service alerts; 📋 planned elsewhere: client portal FI0042 → PLAN-013 #3, remote-session notes → C7NTRL-001 phase 7 / PLAN-014, serverless/OpenTofu/dev=prod → PLAN-010; ❌ new: 16-item dependency-ordered implementation plan — agreements/time engine (block/cyberCare/spot rates, 1.5x overtime after 18:00, midnight split, 1.5:1 block deduction), expenses tab, bill-through batch invoicing with preview/approve, per-user dashboard, board drag-and-drop, Kumo audit log, MFA QR upload, Outage Board, CloudConnect live statuses, report fix + client value template, AI KB auto-generation, M365 inactivity/offboarding, SMS verification) with `Depends on`/`Risk if skipped` notes, moved/appended notes, frontend items, rollback (flag-gated), verification, and open decisions.

## 2026.8.18.013 — PLAN-014: C7NTRL RMM split-out + GitHub repo created
- **[New]** `PLAN-C7NTRL-RMM-Product-Line-and-PSA-Integration.md` (PLAN-014) — C7NTAX stays PSA-only; the RMM product line from PLAN-013 is split into a separate application **C7NTRL** with its own GitHub repository (`C7-IMI/C7NTRL`, private, `main`+`develop` branches pushed) and mirrored plan C7NTRL-001 (architecture: Node/Express server + React console reusing the C7NTAX theme, Go agent; 10 dependency-ordered phases derived from re-reviewing Endar/NetLock/Breeze with clean-room reuse only — Endar CC BY-NC-ND, NetLock & Breeze AGPL).
- **[New]** `docs/INTEGRATION-CONTRACT.md` v0.1 committed to both repos: versioned endpoints, HMAC-signed webhooks, shared-JWT trust, contract fixtures + `integration-contract` CI jobs enforcing bidirectional change checks (C7NTAX changes validated against C7NTRL and vice versa).
- **[Update]** `PLAN-C7NTAX-Competitive-Review-and-Modernization.md` (PLAN-013) — phase #10 RMM line now split OUT to C7NTRL/PLAN-014; website/SSL/DNS monitoring moved to C7NTRL phase 8 (C7NTAX Service Alerts stays vendor-only).
- **[New]** Reference clones of endar / NetLock-RMM / breeze under `../_ref/` (study only, never merged).

## 2026.8.18.012 — Now-Deployable Backlog Review (No AWS, Non-Breaking)
- **[New]** `PLAN-C7NTAX-Now-Deployable-Backlog.md` — reviewed all 13 plans + live codebase and identified 12 features deployable now without AWS migration and without breaking the app, each with an implementation approach that preserves existing functionality (quotes/service catalog, time→invoice lines, website/SSL/DNS monitoring, alert severity/webhooks, provider-agnostic AI risk-classified actions, SAML/OIDC SSO, WebAuthn passkey, Outlook add-in backend, M365 Graph transport, mobile backend enablement, SOC 2 non-AWS hardening, UI/UX modernization). Explicit exclusion table with reasons (AWS-dependent or break-risk items deferred).

## 2026.8.18.011 — PLAN-013: Competitive Review & Modernization
- **[New]** `PLAN-C7NTAX-Competitive-Review-and-Modernization.md` (PLAN-013) — in-depth review of Endar, NetLock RMM, and Breeze vs C7NTAX: full feature inventories for all four; comparison tables (common features across the three, unique per app, vs C7NTAX); gap analysis (RMM device agents/monitoring, patch management, remote tools, SSO, quoting→invoice, customer portal, backup, risk-classified AI actions, MCP, RLS multi-tenancy, UI modernization); dependency-ordered incremental implementation plan with per-phase `Depends on`/`Risk if skipped` notes, explicit moved-items notes (AI risk engine → extends PLAN-011; SSO → links PLAN-002; multi-tenant RLS → links PLAN-003; device agents deferred until PLAN-010 AWS infra), frontend items (dialogs, settings, sections), design modernization preserving C7NTAX theming, and performance tradeoff justifications.

## 2026.8.18.010 — PLAN-012: Outlook Add-in Email-to-Ticket Generator
- **[New]** `PLAN-Outlook-Addin-Email-to-Ticket.md` (PLAN-012) — detailed plan for an Outlook plugin that creates service tickets from emails: recommends an **Office Web Add-in** (MessageReadCommandSurface + ExecuteFunction + taskpane) for cross-platform reach matching the C7NTAX TS/React stack; reuses PLAN-009's implemented machinery (`createTicketFromEmail`, deduction, `EmailConnector` patterns) via a new `POST /api/outlook-addin/tickets` batch endpoint with internetMessageId dedup; full email→ticket field mapping table; SSO auth (Office SSO → `/api/auth/office-sso` exchange → C7NTAX JWT) with manual-login fallback; C7 icon from the Composite asset sheet at 16/32/80 px; selection behavior spec (multi-select → one ticket per email via `getSelectedItemsAsync`; single open/previewed message → that message); testing (unit + Outlook desktop/web E2E) and deployment (sideload → Integrated Apps/AppSource) steps; 7 dependency-ordered phases with `Depends on`/`Risk if skipped` notes; rollback + open decisions.

## 2026.8.18.009 — Monitored Mailbox Email-to-Ticket Connector (PLAN-009 Phases 1–4)
- **[New]** Implemented the email-to-ticket connector core (no cross-plan prerequisites existed): `packages/email/src/imapFetch.ts` (real IMAP polling via node-imap + mailparser; process-then-mark contract left to API), `packages/email/src/fieldDeduction.ts` (subject stripping, name/domain deduction, quoted-reply stripping, priority, auto-reply detection), `EmailConnector.pollNow()`; `apps/api/src/services/ticketNumber.ts` (extracted from ticket routes), `services/emailToTicket.ts` (system user `connector@c7ntax.local`, contact/company resolution, ticket + email-comment creation, threaded replies), `services/emailConnectorRuntime.ts` (manager singleton, boot hydration guarded by `EMAIL_CONNECTORS_ENABLED`, Message-ID dedup cursors), `services/emailConnectorCrypto.ts` (kumoCrypto-backed password encryption), `routes/email-connectors.ts` (CRUD/test/poll/status on the existing `EmailConnector` Prisma model), CloudConnect `EmailConnectorsPanel` UI (list/create/test/enable/poll/delete).
- **[Fix]** `routes/boards.ts` pre-existing broken `EmailConnector` queries corrected to the real model fields (select/create/update; `boardId` validation) — 6 baseline tsc errors removed (182 → 176).
- **[Verified]** Smoke-tested: list/create/test(502 graceful on unreachable host)/nested board list/delete all pass; typecheck at baseline; boot green.
- **[Pending]** PLAN-009 Phases 5–6 (M365 modern/legacy auth) NOT implemented — external prerequisites listed for review: Azure AD app registration, tenant ids, M365 test mailbox.

## 2026.8.18.008 — Service Alerts: DownDetector Auto-Resolution
- **[Update]** `apps/api/src/services/alertMonitor.ts` — extended the all-clear auto-resolve logic to DownDetector: every configured service now checks its `downDetectorUrl` alongside the RSS feed; a page whose own H1 status line says "no current problems" counts as all-clear (2-consecutive-poll streak + min alert age, same anti-flap rule), and "possible problems / issues" pages create or keep a `downdetector`-sourced alert. DownDetector's Cloudflare blocks non-browser TLS fingerprints (Node fetch 403), so the page is fetched through the r.jina.ai reader (`DD_READER_BASE_URL` env-overridable); classification uses only the page's own H1 so sidebar tweets about other services can't cause false alerts. Verified live: stale Comcast Xfinity alert auto-resolved (page: "no current problems"); GitHub correctly got a new degraded alert (page: "possible problems with GitHub"); Google Workspace RSS incident still active; 0 monitor errors.

## 2026.8.18.007 — PLAN-011: Bedrock Agentic RAG AI Assistant
- **[New]** `PLAN-Bedrock-Agentic-RAG-AI-Assistant.md` (PLAN-011) — AWS-native Agentic RAG plan for the PSA: Bedrock Agents (Claude 3.5 Sonnet / Llama 3), Knowledge Bases + Titan embeddings + OpenSearch Serverless over RDS→S3 ticket exports, Lambda `search_web` Action Group (Tavily/Brave/SerpApi), API Gateway + IAM `InvokeAgent` integration with the existing `/api/inference` + `/api/kb` code, EventBridge + Step Functions weekly KB batch generation, Bedrock Guardrails + tenant_id vector filtering + PrivateLink. 8 dependency-ordered phases with `Depends on`/`Risk if skipped` notes; rollback (BEDROCK_ENABLED flag falls back to existing provider); verification and open decisions (model, embeddings, search vendor, DMS vs Lambda ETL).

## 2026.8.18.006 — PLAN-010: AWS Dev/Prod Split & Sync Plan
- **[New]** `PLAN-AWS-Dev-Prod-Split-and-Sync.md` (PLAN-010) — plan to split into two AWS environments (dev + prod) with prod running alongside dev on a different port (`:3011` vs `:3010`) for browser-refresh verification; separate RDS databases; ECS Fargate + ALB; local→AWS push tooling; **sync-command semantics** (standalone trigger phrases like "Push to Prod" sync; negated or mid-sentence occurrences never sync; all other messages work on dev only); 10 dependency-ordered phases with `Depends on`/`Risk if skipped` notes (per PlanDocs convention), rollback plan, verification plan, security (KMS, Secrets Manager, WAF, prod seed guards), and LLM/inference containerization options (vLLM/TGI on ECS or Bedrock with `INFERENCE_BASE_URL` config).

## 2026.8.18.005 — Service Alerts Auto-Clear on All-Green Sources
- **[Fix]** `apps/api/src/services/alertMonitor.ts` — active alerts are now auto-resolved when the monitored source shows **all green**: after a successful feed fetch with no outage-classified items, two consecutive all-clear polls (anti-flap streak) and a minimum alert age of one poll interval resolve the alert with an "all clear confirmed" note. Explicit "restored" items still resolve immediately; **manual alerts are never auto-resolved**; services without an RSS feed are untouched. Verified live: stale Microsoft 365 and Azure alerts (active since 2026-08-14) auto-resolved; the genuine Google Workspace incident (current "investigating" item) correctly stays active; Comcast (downdetector-only, no feed) correctly untouched.

## 2026.8.18.004 — All Plans Reordered: Prerequisites Before Dependents
- **[Update]** Reviewed all 9 plan documents (`PLAN-001`…`PLAN-009`) against the codebase and renumbered their implementation items into dependency order, preserving every original item name, path, and detail. Added `Depends on:` / `Risk if skipped:` notes to every dependent item: PLAN-001 phases 1–6 (foundation → timeout → TOTP → email → SMS → admin UI; noted `mfaSmsPhone` column already lands in Phase 1), PLAN-002 passkey stages 1–4 (+ cross-plan dep on PLAN-001 MFA flow), PLAN-003 multi-tenant steps 1–3 (foundation → middleware → isolation, with cross-tenant leak risk if middleware precedes columns), PLAN-004 mobile 13-step sequence (Phase 0 → backend enablement → Android/iOS builds → publishing), PLAN-005/006 desktop P0–P5 dependency notes, PLAN-007 SOC 2 dependency-ordered sequencing (SC-12+PI-03 → SC-11+SC-01 → AV-01/02/03/05 → CF-01/03 → SC-02..07 → PI/PR/OR), PLAN-008 token-savings cross-cutting notes (schema-hash regeneration for future schema changes), PLAN-009 email-connector phases 1–7 dependency/risk notes.
- **[New]** PlanDocs registry convention added: all future plans must list implementation items in dependency order with `Depends on:`/`Risk if skipped:` notes; originals updated and PlanDocs copies re-synced.

## 2026.8.18.003 — Calendar Content Scales with Container (Width-Driven)
- **[Update]** `apps/web/src/hooks/useCalendarScale.ts` — scaling is now width-driven (`k = availW / baseW`, min 1) instead of being capped by remaining viewport height, so the month calendar (date cards + all inner content) grows to fill the calendar container's width on wide windows and scales down with the window; uniform transform keeps square cells and aspect ratio; date cards and their content now scale proportionally with the container. Base measurement loop also made stable (state only updates on real size changes).

## 2026.8.18.002 — Calendar Fixes & Scaling, PlanDocs Registry, Email Connector Plan (M365), Changelog Policy
- **[Fix]** Calendar and Time Off pages restored: their API routes (`/api/schedule`, `/api/schedule/skills`, `/api/pto`, `/api/pto/all`) used Prisma `include` on relations that don't exist on `ScheduleEntry`/`TechnicianSkill`/`PtoRequest` (scalar-only `userId`/`ticketId`/`approvedById`) — every call returned 500. Replaced with manual joins preserving the same response shape; API typecheck improved 186 → 182 errors.
- **[New]** Dynamic calendar scaling: new `apps/web/src/hooks/useCalendarScale.ts` scales the Calendar and Time Off month grids with the window via uniform CSS transform (`k = max(1, min(availW/baseW, availH/baseH))`) — square day cells and aspect ratio preserved; current size is the minimum (never shrinks below 1), grows to fill the window when maximized.
- **[New]** `PlanDocs/` plan registry: all 9 project plan documents copied with stable IDs `PLAN-001`…`PLAN-009` (session auth, passkey, multi-tenant, native mobile, native desktop, desktop OSS, SOC 2, token savings, email-to-ticket connector) plus `README.md` index with conventions; originals remain in place.
- **[New]** `PLAN-Monitored-Mailbox-Email-to-Ticket-Connector.md` (PLAN-009) — Monitored Mailbox Email-to-Ticket Connector implementation plan (AutoTask/ConnectWise Manage/Asio-guided): IMAP polling, field deduction (name/company/contact/subject/description), threading, rollback plan, phased delivery; extended with **Microsoft 365 Exchange mailbox support** (legacy Basic Auth IMAP/EWS with deprecation warnings + modern OAuth 2.0/Microsoft Graph with delegated or app-only flows, shared mailboxes, token rotation).
- **[New]** Mandatory changelog policy: every change now updates all three records — **What's New** (generated from BuildNotes), **build notes** (`BuildNotes.md`), and **Retrace** (`Retrace.md`) — and today's previously unrecorded changes were backfilled.

## 2026.8.18.001 — Login Flow Restoration & Token-Savings Hardening
- **[Fix]** Login loop resolved: the gzip middleware truncated response bodies (the zlib stream flushed after `res.end()`), corrupting the login JWT so `/users/me` returned 401 and the app bounced straight back to the login screen; replaced streaming compression with buffered compress-once-and-end (atomic responses with correct `Content-Length`).
- **[Fix]** Removed the leftover temp auth bypass (`TEMP_BYPASS_AUTH` / `c7_bypass`) that silently cleared real tokens, disabled the 401→login redirect, and left every section polling with invalid auth; real login flow restored and stale bypass flags are now cleared automatically.
- **[Update]** Implemented the 10-option token-savings plan: quiet morgan polling (401 spam), 5 MB `dev-errors.log` cap + boot rotation, snapshot diff-only captures, `boot.log` rotation + prisma skip-if-unchanged, single-source BuildNotes generation, visibility-gated frontend polling, per-file `typecheck-diff.sh` (untracked files + anchored path matching), inference cheap-model override + 6000-char excerpt + memoized prompt prefix, gzip + weak ETags, additive snapshot delta journal (capped at 100 entries).
- **[Fix]** Shared package barrel TS2308 duplicate-export conflicts resolved (explicit type re-exports; stale duplicate `sso-etc` feature module removed from the barrel) — `@C7NTAX/shared` now compiles clean.
- **[Update]** Sample data restored from snapshots via the defined seed process (235 records; all tables match the snapshot manifest); API layer verified serving data (8 tickets, 4 boards, 6 users, 8 alert services).
- **[Verified]** Boot pipeline green; login HTTP 200; frontend HTTP 200; 304 conditional responses clean; gzip login response byte-identical to the uncompressed response.

## 2026.8.14.004 — SOC2.Compliance Plan
- **[New]** `SOC2.Compliance.md` — SOC 2 Type II readiness plan for C7NTAX deployed to AWS: numbered items (SC-01…OR-04) across Security, Availability, Confidentiality, Processing Integrity, Privacy, and Organizational controls; each item includes why, functional impact, and ⚠️ breakage-risk flags; AWS-specific guidance inline (Secrets Manager, KMS envelope encryption, RDS Multi-AZ + PITR, ALB/ACM/WAF, ECS Fargate hardening, CloudWatch/CloudTrail/GuardDuty/Security Hub/Config); recommended sequencing and open decisions (Type I vs II, desktop app scope, AWS org/SCPs, pen-test vendor).
- **[New]** Top gaps identified: dev secrets in `.env`, permissive rate limit, JWT without rotation, `--accept-data-loss` in the boot pipeline, reseed-able audit trail, hardcoded crypto fallback key.

## 2026.8.14.003 — Audit Log Data Recovery & Snapshot Restoration
- **[Fix]** Missing audit logs recovered: the snapshot reseed (Option 2) had replaced the live audit trail with the older 6-row snapshot, losing several days of `AuditLog` rows. Reconstructed the complete set by unioning all 15 historical git versions of `apps/api/src/snapshots/audit-logs.json` — 63 unique rows spanning 2026-08-06 → 2026-08-14 (ticket updates, kumo password events, board/schedule/service-alert activity).
- **[Fix]** Restored the 63 rows into the live database (deleteMany + createMany with skipDuplicates); `audit-logs.json` now carries the full union, and verify-post-change re-captured `auditLog: 63 records`, so every future boot reseed restores the complete audit trail.
- **[New]** `apps/api/src/restore-audit-logs.ts` — idempotent utility to rebuild the audit trail from the snapshot union.

## 2026.8.14.002 — Snapshot Fixtures Are Now the Seed Source of Truth
- **[Update]** Boot reseed switched from hardcoded seed scripts to snapshot restore: `c7ntax-boot.ps1` now runs `seed-from-snapshots.ts` (full dataset from `apps/api/src/snapshots/`) plus the idempotent `seed-service-alerts.ts` role-permission backfill, instead of `seed-full.ts` + `seed-contacts.ts` + `seed-service-alerts.ts`.
- **[Update]** Restored the 4-service-board snapshot set from git history (commit 9ec9f67: MSP Service Desk, Intelligence Service Desk, Infrastructure Service Desk, NOC Alerts) along with the matching-era tickets/users/companies/agreements; the two HEAD-only cross-era fixtures (ticket-attachments, schedule-entries) were reset to empty so no foreign-key references dangle.
- **[Fix]** Root cause addressed: `seed-full.ts` hardcodes 3 boards and previously ran on every boot, after which verify/snapshot-poller captures overwrote the richer 4-board snapshot with the 3-board state. With snapshots as the source of truth, reseed now preserves the richer dataset and captures mirror it back.
- **[Verified]** Boot run green in 20s: snapshot reseed OK, backfill OK, login HTTP 200, frontend HTTP 200; DB shows 4 boards, 8 tickets, 6 users, 5 companies, 13 contacts, 5 agreements, 0 orphaned board references, 8 alert services; verify-post-change "All checks passed" and re-captured service-boards.json with 4 records.

## 2026.8.14.001 — Full System Audit & Configuration Corrections
- **[Fix]** `apps/api/.env` — `CORS_ORIGIN` corrected from stale `http://localhost:3001` to `http://localhost:3010` (matches `WEB_ORIGIN`/vite port); preflight now returns `Access-Control-Allow-Origin: http://localhost:3010` with credentials.
- **[Fix]** PostgreSQL service logging — `postgresql.conf`: `logging_collector = on`, `log_directory = 'log'`, `log_filename = 'postgresql-%Y-%m-%d.log'`; the Windows service previously wrote no logs, now service-mode PG writes daily logs to `data/log/` for crash diagnosis (0xC0000142/487 recurrence watch).
- **[Update]** `postgresql-c7ntax` service re-registered cleanly (Automatic, LocalSystem); verified against a full boot-script run.
- **[Audit]** Verified healthy: PG service Running/Automatic on 5432 with real backend queries; single API (:4000) + single vite (:3010) processes, no orphans; scheduled task "C7NTAX Boot Startup" (AtStartup+45s, Highest, StartWhenAvailable, 3x restart) LastTaskResult 0; Defender exclusions present for PG data/bin; Prisma schema valid + DB synced; sample data intact (6 users, 8 tickets, 3 boards, 5 companies, 13 contacts, 8 alert services, active alerts legitimate — Azure RSS incident + 2 seeded); all roles carry `servicealert:view`; full boot sequence re-run green in 21s with login HTTP 200; verify-post-change "All checks passed".
- **[Audit]** Known baseline: pre-existing strict-`tsc` errors remain in legacy files (`seed-ticket-tabs`, `seed-full`, `packages/billing`, `shared/features`, `KumoConfigs`, `KumoPasswords`, `Reports`, etc.) — runtime-unaffected (tsx strips types; seeds/API verified working at runtime); intentionally left untouched to avoid scope creep.

## 2026.8.13.004 — Automatic Startup on Reboot (Self-Healing Boot)
- **[New]** `startup/c7ntax-boot.ps1` — self-healing boot script that starts PostgreSQL (prefers the `postgresql-c7ntax` Windows service, ensures Automatic start, console fallback), verifies the DB with a real backend query, restarts PG up to 4x when backends cannot spawn, adds best-effort Defender exclusions for the PG data/bin dirs, syncs Prisma, reseeds sample data (seed-full + seed-contacts + seed-service-alerts) with exit-code checks and one retry, then launches the API (:4000) and frontend (:3010) and verifies login + page HTTP — every blocking call is time-bounded and logged to `startup/boot.log`.
- **[New]** Scheduled task "C7NTAX Boot Startup" (AtStartup + 45s delay, highest privileges, StartWhenAvailable, restarts 3x on failure) — the app is now fully functional automatically after every reboot, including sample-data reseed.
- **[Fix]** Root cause of the loading failure: PostgreSQL was down after reboot (no auto-start) and later entered a recurring failure mode where a backend/autovacuum worker dies with 0xC0000142 and the postmaster then cannot spawn backends (error 487) despite listening on 5432 — fixed by service-mode PostgreSQL, Defender exclusions, and the script's backend-query self-heal.
- **[Fix]** Boot-script portability fixes: pure-ASCII (PS 5.1 UTF-8 BOM), reserved `$args` renamed, Start-Process quoting for spaced paths, cmd /c wrapper for reliable exit codes.

## 2026.8.13.003 — Service Alerts Landing Directly
- **[Update]** Service Alerts is now a single top-level nav item with no children — clicking it opens the Service Alerts Dashboard directly as the section's landing page.
- **[Update]** Active-alert count badge remains on the Service Alerts nav item (expanded + collapsed sidebar).

## 2026.8.13.002 — Service Alerts as Top-Level Nav Section
- **[Update]** Service Alerts is now a top-level parent section placed between Dashboard and Tickets (Dashboard, Service Alerts, Tickets, Service Boards…); it expands to its own Dashboard landing page and is draggable like every other parent section.
- **[Update]** Service Boards restored to a single top-level link (no longer a parent); active-alert badge moved back to the Service Alerts parent section (expanded + collapsed sidebar).
- **[Fix]** Stale persisted nav orders are reconciled so the new top-level Service Alerts section inserts at its default position (after Dashboard) without wiping user customizations.
- **[Update]** Section-landing description moved to the Service Alerts section (Dashboard child); Service Alerts card remains on the Home landing page.

## 2026.8.13.001 — Service Alerts Nested Under Service Boards
- **[Update]** Service Alerts is now nested inside the Service Boards navigation section: Service Boards → (Service Boards, Service Alerts), matching the requested structure; the dedicated top-level Service Alerts parent section was removed.
- **[Fix]** Navigation now reconciles the persisted `c7_nav_order` against the nav tree on load — stale saved orders no longer hide new sections, and the removed top-level "service-alerts" id is dropped safely.
- **[Update]** Service Boards now carries the active-alert count badge (expanded and collapsed sidebar); the Service Alerts child keeps its own badge too.
- **[New]** Service Alerts card added to the Home landing page "Getting Started" grid, linking to the outage dashboard.
- **[Update]** Section landing descriptions added for Service Boards (dashboard + Service Alerts) and the Administration → Service Alerts settings page.

## 2026.8.12.019 — Service Alerts (Outage Monitoring & Alerting)
- **[New]** Draggable "Service Alerts" parent section in the app navigation (below Service Boards) with a live red badge showing the number of active alerts; Administration gains a "Service Alerts" configuration subsection.
- **[New]** Service Alerts dashboard (`/service-alerts`): aggregate outage cards for Microsoft 365, Azure, AWS, GitHub, Google Workspace, Comcast/Xfinity, Verizon, and Spectrum, each with official status-page and DownDetector links plus Outage/Degraded/Operational status badges; summary strip and recently-resolved list; alerts sourced from official status RSS feeds, status pages, and DownDetector.
- **[New]** Global outage banner below the header on every section: red, dismissable (X on the far right), clickable to the Service Alerts dashboard, example text "Possible Service Interruption has been reported for Microsoft 365. Click here for more details." (service name replaced as appropriate), persists across navigation until dismissed or auto-cleared.
- **[New]** Alerting mechanism: background monitor polls configured RSS feeds every 5 minutes, imports/parses RSS (no external deps), auto-creates an alert on outage/degraded keywords, and auto-resolves the alert + banner once a restored/resolved feed item appears. Status-page HTML keyword scraping deliberately avoided (false-positive prone); non-RSS services are monitored manually via the dashboard.
- **[New]** Administration → Service Alerts page (`/admin/service-alerts`): add/edit/delete monitored services, category, RSS/status-page/DownDetector URLs, dashboard visibility + feed-polling toggles, manual alert creation, "Run Monitor Check Now" with live run stats and feed-error log.
- **[New]** Backend: `ServiceAlertService` + `ServiceAlert` Prisma models, `/api/service-alerts` REST routes (status, alerts, services CRUD, manual alert, resolve, refresh, monitor-status), `servicealert:view` / `servicealert:manage` permissions added to shared enums and all default roles, seeded sample services/alerts, snapshot capture/reseed entries, sample-data-toggle wipe entries, and verify-post-change coverage.
- **[Fix]** Removed two false-positive auto-alerts generated during the initial HTML-probe run; monitor reverted to RSS-only detection.

## 2026.8.12.018 — Native Desktop OSS Plan
- **[New]** `native-desktop-oss-plan.md` — open-source edition of the native desktop plan: preserves goals and structure while replacing all proprietary tooling (Visual Studio → VS Code + dotnet CLI, MSIX GUI → msix-packaging CLI, signtool → osslsigncode + self-signed, MSVC AOT linker → LLVM clang/lld, Xcode → VS Code + swift.org toolchain + CLT, GitHub Actions → Forgejo/GitLab CE/Jenkins, commercial monitoring → GlitchTip/OpenTelemetry).
- **[New]** Includes license table per tool, no-purchase signing/distribution strategies (WinGet sideload, Homebrew Cask, Flathub), and a cost-comparison section flagging the only unavoidable costs (Apple hardware for macOS CI; optional paid certs for SmartScreen/notarization).

## 2026.8.12.017 — Native Desktop Clients Plan (Windows / Linux / macOS)
- **[New]** `native-desktop-plan.md` — plan only, no code: three native desktop apps using C#/.NET 8 + WinUI 3 (Windows), Rust + GTK 4/libadwaita (Linux), Swift 6 + SwiftUI/AppKit (macOS); Electron app remains and is updated alongside, not replaced.
- **[New]** Plan covers per-platform toolchains/SDKs/dependencies, installer packaging (MSIX/MSI/EXE, .deb/Flatpak, .pkg/.dmg with notarization), design-token parity with the WebUI, backend reuse (same REST API), security, and CI/CD.

## 2026.8.12.016 — Desktop App Now Replicates WebUI Exactly
- **[Update]** Desktop app rewritten to serve the exact built WebUI via a custom `app://c7ntax` protocol — same interface and session state as the browser; `/api/*` proxied to the API server so the relative API contract works unchanged; SPA fallback for client routing; stable origin keeps localStorage state (login, theme, sidebar) persistent.
- **[Update]** Production packages now bundle the freshly built WebUI (`prebuild` runs `vite build`; `extraResources` copies `web/dist` → `resources/webui`); dev mode loads the Vite dev server with hot reload.
- **[Update]** Window bounds persisted across launches; `npmRebuild` disabled to avoid the pnpm `workspace:` protocol breaking electron-builder; desktop menu navigation wired into the web router via a `DesktopNavBridge` (Settings/New Ticket/New Invoice shortcuts now work).
- **[Fix]** Pre-existing web strict-mode type errors blocking the build pipeline: Changelog date parsing non-null assertions, SectionLanding + HomePage icon types widened, Clients sort state typed as SortState, KumoConfigs state arrays typed; web `vite build` verified green.
- **[Update]** Portable exe rebuilt (144 MB) with the current WebUI and placed in `apps/desktop/dist-electron/`.

## 2026.8.12.015 — Native Mobile Applications Plan
- **[New]** `mobile-native-plan.md` — comprehensive phased plan for native Android (Kotlin + Jetpack Compose) and iOS (Swift + SwiftUI) apps replicating core C7NTAX desktop functionality; no code implemented (planning only).
- **[New]** Plan covers: Phase 0 foundations/tooling (Gradle version catalogs, Xcode, Fastlane, CI), Phase 1 backend enablement (versioned /api/v1 contract, OpenAPI codegen, device sessions, push via FCM/APNs, delta sync + ETags, offline queue), Phases 2–3 app builds (MVVM, Room/SwiftData offline cache, WorkManager/BackgroundTasks, biometrics), Phase 4 security (certificate pinning, Keystore/Keychain, refresh-token rotation, privacy manifests, data safety), and Phase 5 store publishing (Play App Signing, App Store Connect, Fastlane lanes, review guidelines, maintenance).

## 2026.8.12.014 — Add Time Entry Button on Dates & Times Card
- **[Fix]** Restored the time-entry button on the Dates & Times card — previously labeled "Log Time", now labeled "Add Time Entry" to match the Time tab; placed in the card header right of the title.
- **[Update]** Card button keeps the small `text-xs` cyber-styled size (Timer icon, 12px) matching the previous "Log Time" styling; opens the same Add Time Entry dialog used by the Time tab, so time can be added from both locations.
- **[Update]** Notes & Activity inline toggle button renamed "Log Time" → "Add Time Entry" for consistency.
- **[Update]** Time tab functionality unchanged (same dialog, totals, and list).

## 2026.8.12.013 — Tab Dialog Data Fully Connected Across the App
- **[New]** Attachments tab now uses real `TicketAttachment` records — new API endpoints `POST /tickets/:id/attachments` and `DELETE /tickets/:id/attachments/:attId`; ticket detail includes attachments; the dialog accepts a real file (name/size/type stored, content storage placeholder); legacy customFields attachments migrated into real records.
- **[Update]** Configurations tab — linked configurations now carry `kind` + `refId` pointing to real assets and Kumo servers; each row has an Open link (assets → /assets/:id, Kumo servers → /kumo/configs, Kumo assets → /kumo/assets/:id); the link dialog now fetches the correct `/kumo/configs/servers` endpoint.
- **[New]** Links tab shows incoming (reverse) links — tickets that link to the current one are computed and displayed with Open buttons, making links two-way.
- **[Update]** Finance tab now includes a Products total card (5-card summary).
- **[New]** Kumo server records seeded (5 servers linked to Kumo assets) so Kumo → Configurations and the link dialog are populated; snapshot capture and reseed lists now include `ticketAttachment` and `kumoServer` (43 tables).
- **[Update]** `seed-full.ts` creates real attachments, Kumo server records, and links ticket configurations to real asset/Kumo-asset IDs after entity creation; `seed-ticket-tabs.ts` migration re-run; snapshot recaptured (259 records).

## 2026.8.12.012 — Ticket Tab Sample Data Seeded Across All Tickets
- **[New]** Every ticket now shows representative content in all toolbar tabs — seeded per ticket: 2 configurations, 2 products, 2 links, 2 attachments (customFields), 2 expenses (Expense rows), 2 schedule entries (ScheduleEntry rows), 1 History change-log comment, and 2 audit trail entries.
- **[New]** `seed-ticket-tabs.ts` — idempotent seeding script for existing databases; added `scheduleEntry` to snapshot capture and reseed lists so the new data survives the snapshot/reseed cycle (new `schedule-entries.json` fixture, 42 tables total).
- **[Update]** `seed-full.ts` — full reseeds now create the same ticket tab data (cleanup added for expense, scheduleEntry, and auditLog).
- **[Update]** Billing → Time & Expenses now shows an Expenses section — a linked ticket expense created in the ticket tab dialog appears there with ticket number, category, date, and amount; expenses total line included.

## 2026.8.12.011 — Sample Data Toggling
- **[New]** Sample data toggling — `pnpm db:sample-off` (disable) and `pnpm db:sample-on` (enable), backed by `apps/api/src/sample-data-toggle.ts`.
- **[New]** Disable flow — captures a snapshot as usual, wipes all business data (identity and platform config preserved so login/RBAC/settings still work), then sets a marker flag (`.sample-data-disabled`).
- **[New]** While disabled — snapshot captures are locked (auto-snapshot middleware, snapshot poller, and the capture script all skip), so the preserved snapshot is never overwritten and no automatic reseed occurs after changes.
- **[New]** Enable flow — reseeds from the preserved snapshot files via the established `seed-from-snapshots` process, then clears the flag so the snapshot-after-change process resumes.
- **[New]** Command detection rule — "disable sample data"/"turn off sample data" and "enable sample data"/"turn on sample data" only apply as explicit standalone commands; when those phrases appear inside a natural-language sentence they are ignored and treated as a normal prompt.

## 2026.8.12.010 — Ticket Detail Two-Column Layout Restored & Compact Tabs
- **[Fix]** Classification & Details and Client Info cards moved back to their original location — right column beside the General card (restored `lg:grid-cols-3` with the left column spanning 2); both cards' display and edit modes fully functional.
- **[Update]** Toolbar card spans the full width of both columns (General left, Classification & Details right) per the reference screenshot.
- **[Update]** Toolbar tab labels compacted — `text-xs` with `px-2 py-1`, zero gap between tabs — so all 12 tabs fit without horizontal scrolling on desktop widths.

## 2026.8.12.009 — Square Date Cards on All Calendars
- **[Update]** Calendar page and Time Off page day cells changed from `min-h-[60px]` rectangles to true squares via `aspect-square` — cleaner visual style per reference screenshot.
- **[Update]** Calendar cards constrained to `max-w-3xl` so square cells stay small (~100px per cell) and the full month (including 6-week months) fits on a single screen without scrolling.
- **[Update]** All existing behavior preserved: month navigation, jump-to-today, today/selected highlights, event chips with "+N more", click-a-date filtering, and clear-filter rows.

## 2026.8.12.008 — ConnectWise-Style Ticket Detail Toolbar & Tabs
- **[New]** Full-width toolbar card on ticket detail — tabbed interface with 12 tabs (Ticket, Configurations, Products, Activities, Time, Links, Expenses, Schedule, Attachments, History, Finance, Audit Trail); Tasks, Open Tickets, Conversions, Surveys, and RMA excluded per spec.
- **[New]** Icon toolbar below the tabs — Refresh, Add Note, Log Time, and Attach are functional; Email, Print, Follow Up, and More Actions are placeholders with "coming soon" toasts.
- **[Update]** Ticket detail layout — General and Classification & Details cards now each sit on their own full-width row under the toolbar (single-column stack).
- **[New]** Configuration dialogs for every tab — Link Configuration (searches assets + Kumo configurations), Add Product (qty/cost with totals), Link Ticket (search + relation type), Add Expense (backed by /billing/expenses), Schedule Entry (backed by /schedule with ticketId), Attach File (metadata placeholder), and Add Time Entry.
- **[Update]** Lightweight tab data (linked configurations, products, links, attachments) persisted in the ticket's `customFields` JSON — tickets PATCH now accepts `customFields` and excludes it from change-comment logging.
- **[Fix]** Time entry logging now posts to the correct `/tickets/:id/time` endpoint (was `/time-entries`, which does not exist).
- **[New]** Activities tab merges notes and time entries into one chronological feed; History tab shows friendly field-change log; Finance tab shows billable/non-billable totals, expenses, and agreement summary; Audit Trail tab lists ticket-scoped system audit records.

## 2026.8.12.007 — Clear Selected-State Highlight in Navigation
- **[Update]** Sidebar selected/active items now use the same light `bg-surface-lighter` background with white text as the hover state — replacing the previous faint cyber tint that was hard to distinguish.
- **[Update]** Applied consistently across all four nav rendering paths: collapsed-mode icon buttons, collapsed-mode links, expandable parent sections, and leaf/section links; the existing accent indicators (active chevron and collapsed-mode edge bar) remain as secondary cues.

## 2026.8.12.006 — Time Off Monthly Calendar
- **[New]** Monthly calendar added to the Time Off page above the PTO Requests card — same Outlook-style mini-card design used on the Calendar page (subtle cell borders, top-left date numbers, month navigation, today highlight).
- **[New]** PTO requests appear as status-colored chips across their full date span in the calendar (green = approved, red = denied, amber = pending), up to 2 chips per day with "+N more" overflow.
- **[New]** Click-a-date filtering — selecting a calendar date filters the PTO Requests table to requests covering that date, with a clear-filter row.
- **[Update]** PTO Requests card now has a header showing total count or filtered count; request form resets after submission.

## 2026.8.12.005 — Outlook-Style Mini-Card Month Calendar
- **[Update]** Monthly calendar redesigned — smaller, visually cleaner day cells in mini-card style with subtle borders (`border-surface-border`), rounded corners, and consistent `gap-1` spacing.
- **[Update]** Date number moved from center to top-left corner of each day cell; day-of-week headers compacted to uppercase micro-labels.
- **[Update]** Event dots replaced by Outlook-style event chips — up to 2 chips per cell showing time and title in the event's color, with "+N more" overflow text.
- **[Update]** Today highlight (cyber border + tint) and selected-date highlight (stronger cyber border + background) preserved; all existing behavior intact: month navigation, click month/year to jump to today, click-a-date filtering, clear-filter row.

## 2026.8.12.004 — Friendly Notes & Activity Card in Ticket Details
- **[Fix]** Ticket change comments no longer contain raw UUIDs or ISO timestamps — the API now resolves board, assignee, contact, company, and service agreement IDs to friendly names, and formats dates as readable strings when generating change-log comments.
- **[Fix]** Legacy change-log comments with raw values (e.g., "Board: 81f12ded-… → 9e4422d8-…") are now rendered friendly in the Notes & Activity card — UUIDs are resolved to names from loaded lookups and ticket relations, ISO timestamps become readable dates, and snake_case enums become title case.
- **[Update]** Comment badges now distinguish Email (purple), Internal (amber), and Note (blue); email-sourced comments show the sender email as author fallback.
- **[Update]** Author/user fallbacks — comments and time entries without an author display "System" instead of "undefined undefined"; time entries show their entry date.

## 2026.8.12.003 — Audit Log Username + UserID & Default Expanded Entries
- **[Update]** Audit log entries now display both the friendly username and the UserID (8-character prefix) — e.g., "Fiona Ray (a1b2c3d4)"; system entries show only "System".
- **[Update]** Audit Logs page defaults — the top three most recent day groups are expanded on open; all older groups default to collapsed; each group toggles independently.

## 2026.8.12.002 — feature_list.json Renamed to BuildNotes.json
- **[Update]** Data source rename — `apps/api/src/feature_list.json` renamed to `apps/api/src/BuildNotes.json` to match the BuildNotes.md naming convention.
- **[Update]** API resolver renamed — `parseFeatureList()` renamed to `parseBuildNotes()` in `apps/api/src/routes/system.ts`; the `/api/system/changelog` fallback now loads `../BuildNotes.json`.
- **[Update]** Frontend parser renamed — `parseFeatureList()` renamed to `parseBuildNotes()` in `apps/web/src/pages/Changelog.tsx`.
- **[Update]** Historical changelog references — BuildNotes.md (root and public copies) entries that named `feature_list.json` as the What's New data source now reference `BuildNotes.json`.
- **[Fix]** What's New continuity — all three changelog sources (public BuildNotes.md, root BuildNotes.md, BuildNotes.json) remain in sync and are updated after every change.

## 2026.8.12.001 — Calendar, Permissions UX & Human-Readable Audit Logs
- **[New]** Monthly calendar card — Outlook-style month grid above Scheduled Events on the Calendar page with prev/next month navigation, colored event indicators on each date, today highlighting, and click-a-date filtering of the event list below.
- **[New]** Batch action confirmation — the "Modify Selected" ticket menu now shows checkboxes next to each action with an OK button that applies only the checked actions and a Cancel button that dismisses without changes; multiple checked actions run sequentially with per-action success/failure reporting.
- **[New]** Audit log user name resolution — `GET /system/audit-logs` now resolves user IDs to full names ("Stephen Simmons") instead of truncated UUID prefixes.
- **[Update]** Human-readable audit log display — raw JSON and code blocks eliminated from the Audit Logs page; every event renders as a narrative sentence (e.g., "updated ticket #a1b2c3d4 — status to in progress") with friendly entity/field labels, "enabled/disabled" for booleans, "(redacted)" for masked values, and flattened nested objects.
- **[Update]** Modify Selected menu labels — batch action items now display human-readable names ("Set Status → In Progress") instead of raw machine values like `status_in_progress`.
- **[Update]** Schedule events keep their color — the schedule POST endpoint now accepts and stores the `color` field so newly created calendar events render with the chosen color in both the event list and monthly calendar indicators.
- **[Fix]** Permissions tab false yellow highlight — the amber deviation indicator on Manage Users permissions no longer appears when loaded permissions exactly match the user's assigned role; comparison is always against the role's actual permissions and updates live while toggling.
- **[Fix]** Permissions role-template mismatch — the "Apply role defaults" dropdown no longer drives deviation highlighting; it applies presets only, while the highlight always compares against the assigned role.
- **[Fix]** Project Calendar loading — the Calendar page now handles both array and wrapped API response shapes reliably and resets the create form after adding an event so new events display immediately.

## 2026.8.11.001 — CloudConnect, Batch Tickets, Audit Logging & Kumo Fixes
- **[New]** CloudConnect action screen — clicking a connected integration tile opens a modal with user preview, field mapping, company assignment, and sync controls.
- **[New]** DummyConnect simulator — a persistent, always-active integration for exploring any connector's interface without live credentials. Includes a type selector dropdown with all 16 integration types.
- **[New]** Batch ticket operations — checkbox column on every ticket row with Select All; "Modify Selected" dropdown appears when tickets are checked, supporting bulk status and priority changes.
- **[New]** Individual ticket Modify menu — ChevronDown button per row opens a dropdown with Acknowledge, Close, Set Status, and Set Priority actions; excludes predecessor options.
- **[New]** Ticket filter dialog — Filter button opens a modal with Status, Priority, Assigned Technician, and Date Range fields; structured for easy addition of future filter fields.
- **[New]** Comprehensive audit logging — every create, update, and delete operation across the entire application is logged to the AuditLog model with user identity, entity type, change summary, and IP address.
- **[New]** Audit Logs page — now fetches from `GET /system/audit-logs` instead of ad-hoc ticket/invoice queries; displays all operations grouped by date with action type, detail, and user identity.
- **[New]** Auto-incremented IDs in What's New — each BuildNotes entry displays a `#ID` badge for user reference when submitting prompts.
- **[New]** Password generator — "Generate" button with eye toggle added to Kumo Passwords create/edit dialogs and Manage Users create/change-password sections.
- **[New]** Super Admin role — `super_admin` system role with all permissions; sessions never expire due to inactivity.
- **[New]** Editable session timeout — Settings page card with configurable inactivity timeout (5–480 minutes, default 30); stored in SystemConfig; sessionAuth middleware reads dynamically.
- **[New]** Snapshot polling system — background service polls at varying intervals with jitter and adaptive backoff; detects new records from any source and triggers snapshot captures.
- **[Update]** Admin role permissions expanded from 24 to 79 — now includes Kumo, Assets, Projects, KB, Opportunities, Procurement, Schedule, PTO, Inference, and Security permissions.
- **[Update]** Kumo seed data cleanup fix — Kumo tables now properly deleted in reverse FK order before re-seeding, preventing data accumulation.
- **[Update]** FEATURE_LIST.md renamed to BuildNotes.md — all 16 references updated across the codebase including Vite plugin, fetch paths, API resolver, README, and self-references.
- **[Update]** CloudConnect error fix dialog — clickable error banners open a modal with per-field editable inputs, Test buttons, pass/fail results, and "OK — Save All Fixes" when all resolved.
- **[Update]** Credential helpers — `getRequiredCredentials()`, `formatCredLabel()`, `getCredFix()`, `getCredExample()`, `checkCredFormat()` added for all 16 integration kinds.
- **[Update]** Test endpoint enhanced — returns structured `fieldErrors[]` with fix instructions and example values on failure.
- **[Update]** Snapshot capture now includes `auditLog`, `kumoTemplateField`, `kumoAssetFieldValue` tables; 41 tables total.
- **[Update]** Permissions refresh logic — now refreshes on any permission difference (`hasNew || hasLess`), not just count increase.
- **[Fix]** Kumo password reveal "access denied" — decrypt failures now handled gracefully with placeholder fallback text.
- **[Fix]** Kumo password TOTP setup — IV and authTag now stored delimited in `totpSecret` field; decrypt uses correct per-record encryption params.
- **[Fix]** Kumo password edit flow — save now sends only editable fields in payload; password field clears after save; reveal card refreshes with updated "last changed by" after password change.
- **[Fix]** Kumo reveal card stuck on entry switch — `selectPassword()` now clears `revealData` and `showEditPwd` when switching entries.
- **[Fix]** Kumo seed passwords — placeholder `ENC:` values replaced with properly AES-256-GCM-encrypted sample passwords.
- **[Fix]** Kumo PATCH endpoint — `updatedById` now set on every password edit; password change encrypts new value with correct IV/authTag.
- **[Fix]** Manage Roles "Changed" indicator — amber badge now only appears when `editPerms` differs from `originalPerms`; no false positives on initial edit open.
- **[Fix]** Manage Roles user count banner — now always visible; "0 users assigned to this role" is clickable and opens the member management modal.
- **[Fix]** "New Board" button removed from main Service Boards page; board creation now only possible under Administration → Service Boards.
- **[Fix]** Service Boards snapshot — manual data changes now captured; snapshot updated from 3 to 4 boards with correct SLA settings.
- **[Fix]** AutoSnapShot path — `CAPTURE_SCRIPT` corrected from `snapshot-capture.ts` to `../snapshot-capture.ts`, fixing MODULE_NOT_FOUND crash on server start.
- **[Fix]** `Eye`/`EyeOff` imports added to Users.tsx — fixing `ReferenceError: Eye is not defined`.
- **[Fix]** Ticket batch endpoint — `POST /tickets/batch` added to tickets router supporting `updateMany` for status and priority.
- **[Fix]** Retrace.md — expanded from 18 to 37 entries; all prompts standardized with BuildNotes IDs, verbatim text, and detailed change lists.

## 2026.8.10.003 — Header Descriptions & Section Landing Pages
- **[New]** Dynamic section header — every page now displays its section name alongside a brief contextual description rendered on a single line in the top navigation bar, replacing the previous title-only header with a formatted `{Section Name} — {description}` layout that stays on one line and leaves generous spacing before the Search button.
- **[New]** 36 section descriptions — mapped across all application routes (e.g., `/`, `/tickets`, `/kumo`, `/billing`) with intelligent parent-path fallback so nested pages (e.g., `/kumo/assets/abc123`) inherit their parent section's description rather than showing nothing.
- **[New]** Collapsible resizable sidebar — icon-only mode (64 px) with persistent width stored in localStorage; drag-to-resize handle on the right edge of the sidebar; clicking a parent section in collapsed mode navigates to a landing page instead of expanding the sidebar.
- **[New]** Section landing pages — clicking any parent section (Administration, Clients, Assets, Users & Roles, Projects, Kumo, Billing, Reports) while the sidebar is collapsed opens a card-grid landing page listing every subsection with its icon, label, and a brief description of its functionality.
- **[New]** Breadcrumb navigation bar — hierarchical path shown on every page with clickable parent segments; the first segment is always "Home" with a house icon linking to `/home`; all segments including the current page are clickable.
- **[New]** Auto-snapshot capture — the database state is automatically dumped to 38 snapshot fixture files (`src/snapshots/*.json`) after any successful POST, PUT, PATCH, or DELETE operation, with 5-second debouncing to coalesce rapid consecutive writes into a single capture.
- **[New]** Snapshot capture-to-reseed pipeline — the `pnpm db:capture` and `pnpm db:reseed` scripts provide a full round-trip: wipe the database in dependency order (children before parents), re-seed every table from captured JSON fixtures, and output record counts for verification.
- **[New]** Recently Viewed tracking — browsing Kumo assets (`/kumo/assets/:id`), passwords (`selectPassword()`), configurations (`setSelected()`), and documents (`openDoc()`) now automatically records views via `POST /api/kumo/recently-viewed`; the Kumo Dashboard polls `GET /api/kumo/recently-viewed` every 10 seconds for live updates without full page reload.
- **[New]** Header toolbar — Search, Recent (Clock icon), AI (Sparkles icon), Help (HelpCircle icon), Settings (Settings icon), and My Account (UserCircle icon, cyber-accented) placeholder buttons rendered in the top-right of the application header bar, hidden on mobile screens below the `sm` breakpoint.
- **[Update]** CloudConnect rebrand — the "Integrations" navigation item (formerly `admin-integrations`, route `/integrations`, API mount `/api/integrations`, component `IntegrationsPage`, file `Integrations.tsx`) has been renamed to "CloudConnect" (`admin-cloudconnect`, `/cloudconnect`, `/api/cloudconnect`, `CloudConnectPage`, `CloudConnect.tsx`); all 12 cross-reference files updated including Dashboard quick-links, Settings landing page, and the Administration card grid.
- **[Update]** Extended contacts seed — the database seed script (`seed-full.ts`) now creates 13 contacts across 5 companies (up from 5 contacts) with full PSA-standard fields: phone (`+1-555-XXXX`), mobile, title (IT Director, VP Operations, CEO), department, and `isActive` boolean.
- **[Update]** Resequenced version numbering — all 25 entries in BuildNotes.md and 7 entries in BuildNotes.json (the What's New data source) converted from semantic-like versions (`v1.11.001`) to date-based `Year.Month.Day.Build` format (e.g., `2026.8.10.003`); build number starts at `001` each day and increments sequentially for same-day releases.
- **[Update]** Manage Roles rename — "Roles & Permissions" (navigation label, page title `<h2>`, SectionLanding description, BuildNotes.json changelog entries x2, BuildNotes.md sub-item reference) has been renamed to "Manage Roles" across the entire codebase; the parent "Users & Roles" section and `/roles` route path remain unchanged.
- **[Update]** Home breadcrumb — the top-level breadcrumb label changed from "Dashboard" to "Home" with a house icon; a new `/home` route renders a `HomePage` with a welcome message and 12-card Getting Started grid linking to Tickets, Boards, Pipeline, Clients, Billing, Projects, Assets, KB, Kumo, Users, Roles, and Administration; the "Home" nav section sits fixed at the top of the sidebar and is non-draggable.

## 2026.8.10.002 — Recently Viewed on Kumo Dashboard
- **[New]** Recently Viewed card replaces Implementation Status on the Kumo Dashboard
- **[New]** Tracks user access across all Kumo item types: Passwords, Configurations, Flexible Assets, Documents, Domains, Certificates, and Universal Links
- **[New]** New `RecentlyViewedItem` Prisma model with per-user deduplication via `@@unique([userId, entityType, entityId])`
- **[New]** API endpoint `POST /api/kumo/recently-viewed` upserts view records when users access items
- **[New]** API endpoint `GET /api/kumo/recently-viewed` returns last 20 items for the current user, ordered by most recent
- **[New]** Real-time 10-second polling keeps the Recently Viewed list current without manual refresh
- **[New]** Items display with color-coded type indicators (amber=passwords, green=configs, cyber=assets, purple=docs, blue=domains, yellow=certs)
- **[New]** Each entry shows the item name, type label, and relative timestamp ("just now", "5m ago", "2h ago", "3d ago")
- **[New]** Clicking an item navigates to its detail page (assets link to specific asset, others link to their list pages)
- **[Update]** Preserved C7NTAX dark navy/cyber theme across all new components
- **[Update]** Renamed Integrations navigation → CloudConnect; moved What's New below CloudConnect in Administration menu
- **[Update]** Route /integrations → /cloudconnect; API /api/integrations → /api/cloudconnect; frontend page Integrations.tsx → CloudConnect.tsx

## 2026.8.9.003 — Comprehensive Reporting Suite
- **[New]** Reporting section added to navigation tree with Dashboards, Standard Reports, Analytics sub-items
- **[New]** Dashboard tab: KPI cards (total tickets, SLA response%, revenue, outstanding), ticket status/pie chart, priority distribution, SLA compliance gauges, technician utilization table, monthly revenue bars
- **[New]** Standard Reports tab: 6 pre-built report cards (Ticket Volume, SLA Performance, Revenue Summary, Technician Utilization, Aging Report, Board Summary) with live preview and run capability
- **[New]** Analytics tab: ticket volume by status/priority/board visual bars, SLA met/breached gauges, technician billable hours ranking, monthly revenue history chart
- **[New]** 4 new API endpoints: GET /reports/data/ticket-volume, /sla-compliance, /technician-utilization, /revenue-summary
- **[New]** Visual bar charts implemented with pure CSS + JS (no chart library dependency)
- **[Update]** Report data refreshes on tab switch
- **[Update]** Consistent card-based layout matching all other application pages

## 2026.8.9.002 — Comprehensive Billing Suite
- **[New]** Tabbed billing interface: Invoices, Agreements, Payments, Time & Expenses, Reports
- **[New]** Invoices tab: list with status + date filtering, generate from unbilled time, send, PDF, record payment
- **[New]** Agreements tab: service agreement management with billing period, amount, auto-invoice toggles
- **[New]** Payments tab: full payment history with method, reference, linked invoice, client
- **[New]** Time & Expenses tab: billable/non-billable time entries with invoice status, total tracked
- **[New]** Reports tab: revenue summary (total invoiced, collected, overdue), aging summary, quick actions
- **[New]** New API endpoints: GET /billing/payments, GET /billing/reports/revenue
- **[New]** Invoice status badges: Draft, Sent, Partial, Paid, Overdue, Void
- **[New]** Payment method tracking: credit_card, ach, check, wire, flexpoint, other
- **[Update]** All pages maintain consistent dark theme design patterns

## 2026.8.9.001 — Past Due Tasks Auto-Update
- **[New]** Added `isOverdue` boolean field to Ticket model in Prisma schema
- **[New]** Worker job `processPastDueTickets` runs every 15 minutes:
  - Finds tickets where `dueDate < NOW()` and status is not resolved/closed/cancelled
  - Sets `isOverdue = true` and notifies assigned technician
- **[New]** "OVERDUE" badge displayed on ticket list rows (red background, next to status)
- **[New]** "OVERDUE" badge displayed on ticket detail view near the due date
- **[Update]** Updated shared Ticket TypeScript interface with `isOverdue: boolean`
- **[Update]** Prisma db push syncs the new column to PostgreSQL

## 2026.8.8.002 — Bug Fixes & Audit
- **[Fix]** Fixed user creation: API now looks up Role by systemRole name, uses roleId FK
- **[Fix]** Fixed user list display: role field now returned as flat string from API
- **[Fix]** Fixed auth route: user.active → user.isActive (2 instances causing login failures)
- **[Fix]** Fixed users GET endpoint: properly maps role systemRole + company name
- **[Fix]** Fixed dashboard resolvedToday: now fetches resolved tickets count directly
- **[Update]** Full frontend audit: Dashboard, Settings, Opportunities, Projects, Clients, Integrations, Knowledge Base, Inference — all verified no additional bugs

## 2026.8.8.001 — Collapsible Tree Navigation & Section Expansion
- **[New]** Sidebar restructured as collapsible tree with parent sections
- **[New]** Sections: Administration, Clients, Assets, Users & Roles, Projects
- **[New]** Expand/collapse state persisted to localStorage
- **[New]** Administration expanded with: General Settings, Service Boards, Audit Logs, Integrations
- **[New]** New AdminServiceBoardsPage: board list with inline SLA/auto-close/follow-up settings
- **[Update]** "New Board" button moved to Administration → Service Boards page
- **[Update]** Board settings: SLA response/resolution times, auto-close toggle/days, follow-up toggle/intervals
- **[Update]** Clients section with Client List sub-item
- **[Update]** Assets section with Asset Inventory and Procurement sub-items
- **[Update]** Users & Roles section with Manage Users and Manage Roles sub-items
- **[Update]** Projects section with Project List sub-item
- **[New]** New Procurement placeholder page created
- **[New]** Administration landing page shows card grid linking to all admin sub-sections
- **[Update]** Ticket list header button renamed from "New Ticket" to "Create"

## 2026.8.7.004 — Service Boards Dashboard & Ticket Board Filtering
- **[New]** Boards page redesigned: each board is a metric card with 10+ live KPIs
- **[New]** Metric cards show: open, workable, new, on hold, waiting, escalated, avg age
- **[New]** Stale ticket tracking: >3d, >7d, >30d with color-coded severity
- **[New]** Most active client per board (last 30 days)
- **[New]** Real-time polling: metrics refresh every 10 seconds while page is open
- **[New]** Cards are clickable — navigates to tickets filtered by that board
- **[New]** `GET /boards/metrics` API endpoint with all computed stats
- **[New]** Ticket list: added Service Board column
- **[New]** Ticket list: board filter dropdown to switch between boards
- **[New]** Breadcrumb navigation when viewing board-filtered tickets
- **[Update]** Sidebar C7 branding updated to red #C42D4B

## 2026.8.7.003 — Invoice PDF & Auth Token in Query
- **[New]** Double-click any invoice row to open styled PDF invoice in new tab
- **[New]** PDF button in invoice table actions and detail modal
- **[New]** `GET /billing/invoices/:id/pdf` returns dark-themed styled HTML invoice
- **[New]** Invoice PDF shows: C7NTAX branding, bill-to/from, line items, totals, payments, balance
- **[New]** Authenticate middleware now accepts `?token=` query param (for new-tab PDF links)
- **[Fix]** seed-full.ts restored (was corrupted by cache hygiene)
- **[Update]** Full database reseeded with 6 users, 5 companies, 8 tickets, etc.

## 2026.8.7.002 — Layout Restructure & Client Type
- **[Update]** Merged Classification and Details cards into single right-column card
- **[Update]** Left column now: General, Dates & Times only (cleaner layout)
- **[New]** Client Type badge displayed under company name (MSP/INT/INF from DB)
- **[Update]** Logged Time entries now show "Time Entry" activity badge instead of raw date string
- **[Update]** Time entry author names include both firstName and lastName
- **[Update]** Created/Updated dates moved to bottom of combined card with separator

## 2026.8.7.001 — Notes & Activity Unified Feed
- **[New]** Combined comments and time entries into single sorted activity feed
- **[New]** Activity type badges: Note (blue), Internal Note (amber), Email Note (purple), Time Entry (green)
- **[Update]** Author names now show firstName + lastName (was previously only firstName)
- **[Update]** Email-sourced notes show fromEmail as author fallback
- **[Fix]** API ticket detail now includes contact relation (was missing)

## 2026.8.6.004 — Sidebar Reorganization & Drag-and-Drop
- **[New]** BuildNotes.md created with full versioning scheme
- **[Update]** Administration moved below Integrations in sidebar nav
- **[New]** Sidebar navigation sections reorderable via drag-and-drop (GripVertical handle)
- **[New]** Nav order persisted to localStorage across sessions

## 2026.8.6.003 — Rebrand to C7NTAX
- **[Update]** All source code, configs, package names rebranded
- **[Update]** Logo updated
- **[Update]** Sidebar branding: NT/NTAX
- **[Update]** Folder renamed from c7-overwatch to C7NTAX
- **[Update]** GitHub repo published at github.com/C7-IMI/c7-overwatch
- **[New]** Windows desktop app compiled (portable .exe + zip)
- **[Fix]** Electron 33.2.1 binary download issue resolved

## 2026.8.6.002 — Dashboard & Navigation
- **[Update]** Dashboard stat cards made clickable with pre-applied filters
- **[New]** 9 quick-link modules on dashboard
- **[Update]** Cards made clickable on Projects, KB, Clients pages
- **[Fix]** Unused imports removed from Billing, Users, Projects, Assets, KB

## 2026.8.6.001 — Bug Fixes
- **[Fix]** Fixed prisma.ticketNote → prisma.ticketComment (model name mismatch)
- **[Fix]** Fixed prisma.integrationConfig → prisma.integration
- **[Fix]** Fixed comment content → body field name
- **[Fix]** Fixed worker.ts enabled → isActive
- **[Fix]** Fixed ticket comments → notes field name in frontend
- **[Fix]** Fixed boardId not recognized by stale Prisma client (regenerated)

## 2026.8.5.005 — Administration Section
- **[New]** Administration nav item with Shield icon
- **[New]** Logs sub-section: cumulative change log grouped by day
- **[New]** Client IDs (4-digit) and Client Types (MSP, INT, INF) in database

## 2026.8.5.004 — Billing Overhaul
- **[Fix]** Billing/invoice API fixes: billingAmount, minutes field names
- **[New]** Invoice view modal with line items
- **[New]** Record payment modal with method selector
- **[New]** Send invoice functionality
- **[New]** Company dropdown in generate invoice form

## 2026.8.5.003 — Ticket Detail Overhaul
- **[New]** Fully editable ticket detail screen with Audit Trail
- **[New]** Inline toggle between view/edit modes
- **[New]** Start time and end time fields
- **[New]** ClientType selector (MSP, INT, INF)
- **[New]** Service agreement auto-display when company selected
- **[New]** Contact dropdown filtered by company
- **[New]** Cumulative time spent display
- **[New]** Log Time modal with start/end time auto-calculation
- **[New]** Inline note posting (Enter to submit)
- **[New]** Ticket numbering scheme: ClientType-ClientID-Sequential

## 2026.8.5.002 — Database & Infrastructure
- **[New]** PostgreSQL 18 installed via Scoop
- **[New]** Database c7_overwatch created and schema pushed
- **[New]** Sample data populated: 6 users, 5 companies, 5 contacts, 3 boards, 8 tickets, 3 agreements, 4 invoices, 3 projects, 5 assets, 4 KB articles, 3 opportunities
- **[New]** Dev error logger with timestamps, rotation, git commit tracking
- **[Update]** Configurable default landing page (/settings)

## 2026.8.5.001 — Auth Fixes
- **[Fix]** Fixed login: user.active → user.isActive (field name mismatch)
- **[Fix]** Fixed login: added include: { role: true } for proper relation loading
- **[Fix]** Fixed login: user.role.systemRole instead of user.role as cast
- **[New]** Added email + username dual login support
- **[New]** Bypass login link on login page

## 2026.8.4.004 — Bug Fixes: Blank Page, Build Errors
- **[Fix]** Fixed @c7-overwatch/shared workspace resolution in Vite
- **[New]** Added ErrorBoundary to main.tsx
- **[Fix]** Fixed 401 interceptor redirect loop on login page
- **[Fix]** Fixed useAuth User type import (inlined locally)
- **[New]** Added noscript fallback and critical CSS to index.html
- **[Fix]** Fixed missing TestTube import in InferenceSettings
- **[New]** Created pnpm-workspace.yaml for proper monorepo resolution
- **[Fix]** Fixed Prisma schema validation errors (ambiguous relations, SQLite incompatibilities)
- **[Update]** Port changed from 5173 → 3001 → 3003
- **[New]** Environment config (.env) created

## 2026.8.4.003 — AI Inference Engine
- **[New]** Pluggable AI provider system (OpenAI, Anthropic, Azure, local keyword search)
- **[New]** Ticket solution suggestions from resolved ticket history
- **[New]** Pattern detection: recurring issues, SLA risks, knowledge gaps
- **[New]** InferencePanel component embedded in ticket detail screen
- **[New]** Admin UI for AI provider configuration (/settings/ai)

## 2026.8.4.002 — CRM, Projects, Inventory, Procurement, PTO, Surveys, KB, Chat, Workflows, Reports, SSO, I18N, Currency, Retention, Calendar, Bulk Ops
- **[New]** 40+ new Prisma models covering all PSA feature areas
- **[New]** Full API routes for all new modules
- **[New]** Frontend pages: Opportunities (CRM pipeline), Projects, Asset Inventory, Knowledge Base
- **[New]** PWA manifest and service worker for mobile/offline support

## 2026.8.4.001 — Core Platform Scaffold
- **[New]** Monorepo with Turborepo (apps/api, apps/web, apps/desktop, packages/shared, packages/email, packages/billing, packages/integrations)
- **[New]** Express + TypeScript REST API with PostgreSQL via Prisma ORM
- **[New]** React + Vite + Tailwind CSS frontend with dark theme (navy/cyber palette)
- **[New]** Shared Zod schemas and TypeScript types across frontend/backend
- **[New]** JWT authentication with MFA (TOTP authenticator + email codes)
- **[New]** RBAC with 8 roles and 25 granular permissions
- **[New]** Client-scoped data access (company-based isolation)
- **[New]** Ticket management: CRUD, status workflow, auto-follow-up, auto-close
- **[New]** Service boards with email connectors (IMAP ticket ingestion)
- **[New]** Billing engine: service agreements, invoicing, payments, PDF generation
- **[New]** 10 third-party integration adapters (Flexpoint, QuickBooks, Pax8, Avanan, Proofpoint, SentinelOne, ITGlue, Microsoft 365, Azure, AWS)
- **[New]** Electron desktop wrapper for Windows
- **[New]** OpenAPI 3.1 specification


