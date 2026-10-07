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
    C7NTAX-OutlookAddIn-<version>.msi   the artifact, committed so the in-app download works
    build.json                          what was built, and for which origin
```

`artifacts/` and not `release/` or `dist/`, which the repository ignores wholesale — the artifact
has to be committed for **C7NC → Outlook Add-in** to have something to offer from a fresh clone.

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

cd installer/outlook-addin
pwsh -File ./build.ps1 -ApiUrl https://tax.cyber7group.com
```

`-ApiUrl` is the running C7NTAX to take the manifest from. The script calls
`GET {ApiUrl}/addin/manifest.xml`, which is the *generated* manifest — the file on disk still
contains `__ADDIN_HOST__`, and a manifest with a placeholder in it is one Office rejects without
saying why. Asking the server means the installer and the manifest a user downloads by hand can
never disagree about the origin or about the add-in's identity.

The output is `installer/artifacts/C7NTAX-OutlookAddIn-<version>.msi` plus `build.json`, which records
the version, the origin baked in, the add-in id, and a SHA-256. `build.json` is not decoration: an
MSI is a binary, so nothing can read the origin back out of it, and the application needs to be able
to say whether the installer it is offering belongs to the server it is running on.

### The version, and why the installer's differs

`build.ps1` reads the version from the repository's own [BuildNotes.md](../BuildNotes.md), so there
is one answer to "what release is this". It cannot use it verbatim: Windows Installer requires
`major < 256`, `minor < 256`, `build < 65536`, and a four-digit year does not fit. The mapping is:

| BuildNotes | MSI package version |
|---|---|
| `2026.10.7.031` | `26.10.7031` |

`YY.M.PPPP`, where `PPPP` is patch × 1000 + build number. Monotonic as the changelog advances, every
field in range, and the true version is kept in `build.json`, in the artifact's filename, and on the
application's page. A version that could not order two builds correctly would break the upgrade
rule, and the failure would look like an upgrade that silently did nothing.

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
msiexec /i "C7NTAX-OutlookAddIn-2026.10.7.031.msi" /qn

# remove
msiexec /x "C7NTAX-OutlookAddIn-2026.10.7.031.msi" /qn
```

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
- uninstall → the file, the value and the folder are all removed.

WiX **6 and later require accepting a fee-bearing licence** (the Open Source Maintenance Fee) before
they will build anything. That is a business decision rather than a build-script one, so the script
pins `5.*`. Moving to a newer WiX is a deliberate choice to make, not an upgrade to take by default.

## One honest limitation

The installer is built for **one origin**, because the manifest it registers has to name one. An
installer built against a development server registers a manifest pointing at that server, and the
symptom is an add-in that installs cleanly and then opens an empty pane.

The application compares the origin in `build.json` against the origin it is running on and says so
plainly on the C7NC page, showing the rebuild command, rather than quietly offering a package that
cannot work. When the deployment's origin changes, rebuild and commit the new artifact.
