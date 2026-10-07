# Installing the C7NTAX Outlook add-in

The add-in is served by the API, but it has to be *registered* on each user's own machine before
Outlook will show it. This folder builds the Windows installer that does that, and this document
explains what it does and why it is shaped the way it is.

```
installer/
  outlook-addin/
    C7NTAX-OutlookAddIn.wxs      the WiX definition — what the MSI installs and registers
    build.ps1                    fetches a resolved manifest, stamps it in, compiles the MSI
    install-README.template.txt  the note installed beside the manifest
  artifacts/
    C7NTAX-OutlookAddIn-<version>.msi   one artifact per plugin version, committed
    index.json                         the release history: version, origin, payload hash, SHA-256
```

`artifacts/` and not `release/` or `dist/`, which the repository ignores wholesale — the artifacts
have to be committed for **C7NC → Outlook Add-in** to have something to offer from a fresh clone, and
for an earlier version to still be downloadable when a change turns out badly.

Users do not need any of this: **C7NC → Outlook Add-in** in the application serves the built
installer, the manifest, and a silent-install command. This folder is for whoever ships it.

## Why an installer, and why *this* installer

A web add-in is three separate things, and only one of them is per-user:

| Part | Where it lives | Who configures it |
|---|---|---|
| The taskpane and icons | the API, served at `/addin` | the deployment — already done |
| The endpoint the pane posts to | the API, `/api/outlook-addin` | the deployment — already done |
| The **manifest** | each user's own machine, registered in their own registry hive | **this installer** |

Office identifies a sideloaded add-in by a value under
`HKEY_CURRENT_USER\Software\Microsoft\Office\16.0\Wef\Developer`, whose **name** is the manifest's
`<Id>` GUID and whose **data** is the full path to the manifest file. Two consequences follow, and
they are the whole design:

1. **It is per-user and needs no administrator.** The hive is the signed-in user's, so a
   machine-wide MSI would write a hive that is not the one Office reads and appear to work only for
   whoever ran the install. The package is therefore `Scope="perUser"`.
2. **The value must be `REG_SZ`.** Office does not follow `REG_EXPAND_SZ` here. Written with the
   wrong type, the add-in installs, registers, and never appears — with nothing to show for it.

## Building it

```powershell
# once, if wix is not already installed
dotnet tool install --global wix --version '5.*'

# from the repository root — equivalent to pwsh -File installer/outlook-addin/build.ps1
pnpm installer:build -- -ApiUrl https://tax.cyber7group.com
```

`-ApiUrl` is the running C7NTAX to take the manifest from. The script calls
`GET {ApiUrl}/addin/manifest.xml`, which is the *generated* manifest — the file on disk still
contains `__ADDIN_HOST__`, and a manifest with a placeholder in it is one Office rejects without
saying why. Asking the server means the installer and the manifest a user downloads by hand can
never disagree about the origin or about the add-in's identity.

The output is `installer/artifacts/C7NTAX-OutlookAddIn-<plugin version>.msi` plus a prepended entry
in the release history `installer/artifacts/index.json`.

**The script refuses to build a plugin that has not been versioned.** It re-hashes the payload
(`packages/shared/src/addinPlugin.ts`) and stops if the hash does not match the one in
`apps/outlook-addin/plugin.json`. That is the enforcement: an installer cannot be produced for a
plugin whose files changed without its version advancing, so a shipped MSI always corresponds to a
version somebody can see and roll back to. `pnpm guard:plugin` makes the same check available
without building.

### The release history, and why it is not a single build record

`index.json` holds an entry per release — plugin version, product release, the origin baked in, the
add-in id, the payload hash, build time, and the artifact's own SHA-256 and size. Rebuilding the same
plugin version replaces that version's entry and artifact rather than adding a second one, so the
history stays one line per version.

It replaces an earlier single `build.json`, because one record can only describe one build: a
previous installer would have been overwritten on disk with no way to say which version it had been,
and the in-app download of a known-good version would have had nothing to point at. The application
serves **only** names that appear in this history, so a download path can never become a filesystem
path, and it compares the newest entry's origin and payload hash against what it is running on and
says so on the C7NC page rather than quietly offering a package that cannot work.

### The plugin version, and the installer's

The plugin's version lives in `apps/outlook-addin/plugin.json` as `YY.M.PPPP`, derived from the
release at the top of [BuildNotes.md](../BuildNotes.md) (`2026.10.7.034` → `26.10.7034`). It is the
version in the MSI filename, the version Office reports from the manifest's `<Version>`, and the
version shown on the application's page — one record, three readers.

The MSI's own `<Package Version>` cannot use a four-digit year: Windows Installer requires
`major < 256`, `minor < 256`, `build < 65536`. The mapping is therefore the identity:

| BuildNotes | Plugin version | MSI package version |
|---|---|---|
| `2026.10.7.031` | `26.10.7031` | `26.10.7031` |

`YY.M.PPPP`, where `PPPP` is patch × 1000 + build number. Monotonic as the changelog advances, every
field in range, and now the same number in all three places, so a version that could not order two
builds correctly would be caught by the guard rather than looking like an upgrade that silently did
nothing.

**One plugin version per application release.** A change to any file the add-in runs inside a release
must advance the release, because the version is derived from it. Do not bump the plugin version by
hand.

## What it installs

| Path | What |
|---|---|
| `%LOCALAPPDATA%\C7NTAX\OutlookAddIn\manifest.xml` | the manifest, with the deployment's real origin in it |
| `%LOCALAPPDATA%\C7NTAX\OutlookAddIn\README.txt` | the server it points at, and how to remove it |
| `HKCU\...\Office\16.0\Wef\Developer\<add-in Id>` | `REG_SZ`, the full path to that manifest |

It does **not** touch the mailbox, does not request `ReadWriteItem`, and does not run as
administrator. Uninstalling removes the file, the value, and the folder.

**Restart Outlook afterwards.** Office reads its add-in list once at start-up, so a running Outlook
will not show the button until it is reopened.

## Installing it without the wizard

```powershell
# per-user, silent — run it as the user who will use the add-in
msiexec /i "C7NTAX-OutlookAddIn-26.10.7034.msi" /qn

# remove
msiexec /x "C7NTAX-OutlookAddIn-26.10.7034.msi" /qn
```

The filename carries the **plugin** version (`26.10.7034`), not the product release. Any version in
the history can be installed the same way, and installing an earlier one over a newer one is
supported — it is the rollback path. Both are offered for download from **C7NC → Outlook Add-in**.

Run it as the account that will use the add-in, not as an administrator on their behalf. A
management tool that pushes this as `SYSTEM`, or as a different account, writes the *wrong* hive —
the add-in installs, reports success, and is invisible to the person it was meant for.

## The three ways to install, and when each is right

| Method | Reaches | Needs | Use it when |
|---|---|---|---|
| **This installer** | whoever runs it | nothing | a handful of users, or a user who wants it now |
| **Manual sideload** | whoever does it | nothing | testing a change; no registry is touched at all |
| **Centralized deployment** | everyone in the tenant | Exchange or Global admin | the whole organisation, with no user action |

Centralized deployment is the only one that scales, and it needs the manifest URL to be publicly
reachable over HTTPS — the production origin, not a development one. It also caches the manifest, so
a changed manifest needs the deployment updated in the admin center.

## Verified behaviour

Built with WiX 5.0.2 and tested on this machine:

- install → files land in `%LOCALAPPDATA%\C7NTAX\OutlookAddIn`, the manifest has **zero**
  placeholders, and the registry value exists with kind `String` (`REG_SZ`) and the correct path;
- uninstall → the file, the value and the folder are all removed;
- the guard **fails** on a real payload change with no version bump, and passes again once the
  version is bumped and the installer rebuilt;
- the install page lists the history newest first and downloads an earlier version.

WiX **6 and later require accepting a fee-bearing licence** (the Open Source Maintenance Fee) before
they will build anything. That is a business decision rather than a build-script one, so the script
pins `5.*`. Moving to a newer WiX is a deliberate choice to make, not an upgrade to take by default.

## One honest limitation

The installer is built for **one origin**, because the manifest it registers has to name one. An
installer built against a development server registers a manifest pointing at that server, and the
symptom is an add-in that installs cleanly and then opens an empty pane.

The application compares the newest history entry's origin and payload hash against the origin it is
running on and against the plugin it is serving, and says so plainly on the C7NC page — showing the
rebuild command — rather than quietly offering a package that cannot work. When the deployment's
origin changes, rebuild and commit the new artifact.
