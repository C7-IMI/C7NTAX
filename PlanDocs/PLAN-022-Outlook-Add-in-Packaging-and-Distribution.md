# PLAN-022 — Outlook Add-in Packaging, Distribution, and the C7NC Section

> **Sequence:** overlay on PLAN-012 and PLAN-017 — it packages what PLAN-012 built and points at the
> registration PLAN-017 provisions. It blocks nothing and is blocked by nothing.
> **Implemented:** the installer, the generated manifest, the download endpoints, the C7NC section,
> and the `O365/` provisioning script — BuildNotes **2026.10.7.031**.
> **Outstanding:** committing an installer built against the production origin, and the tenant-side
> run of the `O365` script (needs a tenant and an administrator).

---

## 1. The gap this closes

PLAN-012 built the add-in, and it works: the taskpane is served, the endpoint creates tickets, and
the README says how to sideload it. What PLAN-012 did not do is make it *installable*, and the
distance between "the code is finished" and "a technician can use it" turned out to be three
separate faults, all of which had to be fixed before an installer would help anyone.

### 1.1 The manifest that was served could not be loaded

`apps/outlook-addin/manifest.xml` carries two placeholders:

```
__ADDIN_HOST__   the origin serving the folder
__ADDIN_GUID__   the identity Office knows the add-in by
```

The README told the reader to replace them by hand, and the API served the folder with
`express.static` — so `GET /addin/manifest.xml` returned the file **with the placeholders still in
it**. Office rejects a manifest whose URLs are not absolute, and it reports that as an add-in that
simply does not appear. Anyone following the documented path was handed a file that could not work,
and the failure mode was silence.

**Fixed by generation.** `apps/api/src/services/addinPackage.ts` renders the manifest for the origin
`PUBLIC_BASE_URL` declares (or the request's own host when it does not), and
`apps/api/src/routes/addin.ts` answers `/addin/manifest.xml` with it before the static handler sees
the request. One definition, used by three callers — the served manifest, the installer build, and
the deployment report — so they cannot disagree.

The identity is **fixed, not generated**: `d25125d4-fcab-47bb-82a8-89a19450042a` by default, with
`OUTLOOK_ADDIN_GUID` as the override. A generated GUID is a *different add-in* to Office, so
regenerating it would strand every mailbox that had already sideloaded the old one.

### 1.2 Registering the add-in was undocumented, and is per-user

The one thing Office needs locally is a registry value:

| | |
|---|---|
| Key | `HKEY_CURRENT_USER\Software\Microsoft\Office\16.0\Wef\Developer` |
| Name | the manifest's `<Id>` GUID |
| Data | the full path to the manifest file |
| Type | **`REG_SZ`** |

Two facts drive the whole packaging design. It is **per-user** — the hive is the signed-in user's,
so a machine-wide install writes a hive Office is not reading and works only for whoever ran it. And
the type matters: `REG_EXPAND_SZ` registers an add-in that never appears.

### 1.3 There was no way to get it

The README's manual sideload is fine for a developer and useless for a technician. Nothing in the
application mentioned the add-in at all.

---

## 2. What was built

### 2.1 The installer

`installer/outlook-addin/` builds a per-user MSI with WiX 5:

| Path | What |
|---|---|
| `C7NTAX-OutlookAddIn.wxs` | the definition: `Scope="perUser"`, the manifest and its README into `%LOCALAPPDATA%\C7NTAX\OutlookAddIn`, and the `HKCU` `REG_SZ` registration |
| `build.ps1` | fetches the generated manifest from a running server, reads the version from `BuildNotes.md`, compiles the MSI, writes `build.json` |
| `install-README.template.txt` | the note that lands beside the manifest |

**The manifest comes from the server, not from a substitution in the script.** The API is the only
thing that knows both the deployment's public origin and the add-in identity in force, so asking it
means the installer and the manifest a user downloads by hand cannot diverge. The knock-on
consequence is stated rather than hidden: the installer is valid for one origin, and it is rebuilt
when that origin changes.

**Versions are mapped, not reused.** BuildNotes carries `2026.10.7.031`; Windows Installer requires
`major < 256`, `minor < 256`, `build < 65536`, so a four-digit year does not fit. The mapping is
`YY.M.PPPP`, giving `26.10.7031`, with the true version kept in `build.json`, the filename, and the
UI. Choosing a version that ordered builds incorrectly would break the upgrade rule, and the
symptom would be an upgrade that silently did nothing.

**WiX 5, deliberately.** WiX 6 and later require accepting a fee-bearing licence (the Open Source
Maintenance Fee) before they will build anything. Accepting a fee is the business's decision, not a
build script's, so the script pins `5.*` and says why.

### 2.2 Serving it

Three public, flag-gated routes, alongside the taskpane:

| Route | Answers with |
|---|---|
| `/addin/manifest.xml` | the generated manifest |
| `/addin/installer` | JSON: availability, version, size, build time, SHA-256, download paths |
| `/addin/installer/<name>.msi` | the artifact, under its versioned name or the versionless alias `C7NTAX-OutlookAddIn.msi` |

They are public because the add-in's own taskpane is public — a signed-in-anyway endpoint would mean
the install button could not be a plain link. They are governed by the same
`apps.outlookAddin` switch as the pane: offering a package for a switched-off add-in would install a
button that answers 404.

The descriptor is a JSON endpoint rather than the obvious "send a HEAD and see". A probed HEAD that
fails for any transient reason would have the page assert that no installer exists — a false claim
about a file sitting right there. Asking once for a description means the page can be wrong about
*when*, never about *whether*.

### 2.3 The C7NC section

A new top-level nav parent, **C7NC**, holding the companion clients. Its first child is **Outlook
Add-in** (`/c7nc/outlook-addin`):

- the install button, and the version and size of what it will fetch;
- the manifest download, for a manual sideload or a centralized deployment;
- the three installation routes with the conditions each one needs;
- the deployment facts for an administrator — the served origin, the taskpane's presence, the
  add-in identity, and the installer's build record with a **warning and the rebuild command when
  the installer was built for a different server**;
- the silent-install and uninstall commands;
- troubleshooting, including the two failure modes that look like breakage: a stale Outlook, and
  the add-in being switched off.

It carries **no permission**, and the page is written so a 403 from the admin-only deployment report
costs it a card rather than the screen. A technician who cannot read deployment detail can still
install the add-in, which is the point of the page.

### 2.4 C7NC means companion clients, not settings

It sits at the top level rather than under Administration because these are things a *user* installs
on their own machine, not settings an administrator changes. Burying them behind a settings screen
would make "install the add-in" an administrator's task by accident.

---

## 3. `O365/` — provisioning the registration

PLAN-017 §4 and §5 are a runbook of portal clicks, and a portal click leaves no record of what was
asked for. `O365/New-C7NTAXMailboxApp.ps1` does the same work over Microsoft Graph REST:

1. device-code sign-in with Microsoft's own Graph command-line client — no module, no `az`;
2. create or reuse the app registration (matched on display name, so it is safe to re-run);
3. request `Mail.ReadWrite` as an **application** role and/or `Mail.ReadWrite` + `User.Read` +
   `offline_access` as **delegated** scopes;
4. set the Web redirect URI for the delegated flow;
5. create the service principal — without it there is nothing to consent *for*;
6. grant admin consent, by app-role assignment for the application permission and by an
   `oauth2PermissionGrants` entry for the delegated scope;
7. create the client secret and write it, once, to a git-ignored file;
8. **print** the Exchange Online RBAC commands that scope the app to one mailbox (§6).

Step 8 prints rather than runs, because those are Exchange cmdlets and not Graph, and because
scoping is the step that turns a tenant-wide reader into a mailbox reader — it deserves to be
deliberate.

The one permission that catches people: **`Mail.ReadWrite`, not `Mail.Read`.** The connector marks a
message read once it has become a ticket, and that needs write. `Mail.Read` connects, reads, and then
fails on the first message it tries to mark.

---

## 4. Decisions, and what was rejected

| Decision | Why, and what it costs |
|---|---|
| Generate the manifest rather than document a manual replace | The documented path produced a file Office cannot load. Generation is the only option that makes the served manifest, the installer and the report agree. |
| Fix the add-in GUID | Office treats a new GUID as a different add-in; regenerating it would strand existing sideloads. Overridable for a deployment that wants its own identity. |
| Fetch the manifest from the server when building | One source of truth for origin and identity. Cost: the installer is valid for one origin, so it is rebuilt when that changes — and the application detects and reports the mismatch rather than failing quietly. |
| Per-user MSI, no elevation | Not a preference: the registration lives in the user's hive. A machine-wide package writes the wrong place. |
| WiX 5, not 6+ | 6 and later gate the build behind accepting a fee. That is the business's call, not the script's. |
| WiX at all, rather than Inno Setup | An MSI is what a management tool expects, it uninstalls through Installed apps, and the registry write is declarative in the package rather than a script step. |
| JSON descriptor rather than a HEAD probe | A transient probe failure would make the page assert something false about a file that exists. |
| Public download routes | The taskpane is already public and the button should be a plain link. The switch gates them the same way. |
| No installer rebuild endpoint on the API | Shelling `dotnet` and `wix` from a production API is a supply-chain surface for a step that belongs in a build. The page shows the command instead. |
| **Rejected:** hosting the manifest per-origin at build time only | Would leave the manual and centralized paths with a placeholder manifest — the original defect. |
| **Rejected:** `util:XmlFile` to rewrite the URLs at install time | Needs namespace-aware XPath over a manifest with three prefixed namespaces and a *text* node (`AppDomains/AppDomain`), for a portability gain that rebuild-and-commit already provides. |
| **Deferred:** AppSource submission | A Partner Center account and a business-owned review process. The admin-center path needs neither. |

---

## 5. Verification

- **Manifest generation** — `GET /addin/manifest.xml` → `200`, `application/xml`, **zero** remaining
  placeholders, every URL on the request's origin.
- **Installer, end to end** — built with WiX 5.0.2; installed per-user with `msiexec`; asserted the
  manifest and README landed in `%LOCALAPPDATA%\C7NTAX\OutlookAddIn`, the manifest contained no
  placeholder, and the registry value existed with kind `String` (`REG_SZ`) and the right path;
  uninstalled with exit 0 and asserted the file, the value and the folder were gone.
- **Download** — the versioned name and the versionless alias both return `200` with
  `Content-Disposition: attachment` and a body matching `build.json`'s SHA-256, through the API and
  through the Vite proxy. Unknown names and encoded traversal (`..%2f`, `%2e%2e%2f`) return `404`:
  the route matches only the artifact name in `build.json`, so a path never reaches the filesystem.
- **Deployment report** — `/system/deployment` reports the origin, identity, manifest URL, the
  artifact's version and size, and `matchesOrigin: true` for an installer built against the server
  it is running on.
- **Browser** — the C7NC nav entry, the page rendering live installer facts, the section landing
  card, and both download links resolving to `/addin/installer/...`.
- **Guards** — web typecheck 0 errors; API typecheck 150, the pre-existing baseline; route guards
  389 routes / 343 guarded / 0 violations; help links 75 routes resolve.

---

## 6. What is left

| Item | Owner | Why it is not done |
|---|---|---|
| Build and commit an installer for the **production** origin | whoever deploys | Needs the production hostname (PLAN-016). The current artifact is built for `http://localhost:4000` and says so. |
| Run `O365/New-C7NTAXMailboxApp.ps1` against a real tenant | the tenant administrator | Needs a tenant and an Application Administrator account. The script has not been executed past sign-in. |
| Scope the app-only app to its mailbox | the tenant administrator | PLAN-017 §6. The script prints the commands; they are Exchange cmdlets. |
| AppSource / Integrated Apps submission | business decision | Needs a Partner Center account. |
| `POST /api/auth/office-sso` for the add-in | code, blocked | Needs the PLAN-017 registration to exist first. Unchanged by this plan; PLAN-012 records it. |
