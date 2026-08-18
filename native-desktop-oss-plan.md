# C7NTAX — Native Desktop Clients Plan (Windows / Linux / macOS) — Open-Source Edition

**Scope:** Build three native desktop applications — Windows, Linux, macOS — that look and
function as close as possible to the current C7NTAX WebUI/desktop experience. The existing
Electron desktop app **remains part of the project** and is updated alongside these three
versions; it is not replaced.

**Constraint:** Native toolkits only — **no Electron, no web frameworks** (no Tauri, no embedded
browser views). Priority order: speed → low memory/resource usage → compatibility → maintenance.

**This edition:** Identical goals and structure to `native-desktop-plan.md`, but **all tooling
is open-source or freely available without purchase**. Assumption: no proprietary software has
been purchased. Where no direct open-source replacement exists, an equivalent workflow using
open-source tools is specified. Licensing of every tool is listed.

**Status:** Plan only. No implementation has begun.
**Version:** 1.0 — 2026-08-12

---

## 1. Technology Selection (unchanged — all already OSS)

| Platform | Language | UI Toolkit | Licenses | Rationale (speed / RAM / maintenance) |
|---|---|---|---|---|
| **Windows** | C# (.NET 8 LTS) | **WinUI 3** (Windows App SDK) | .NET SDK MIT · Windows App SDK MIT | Microsoft's recommended native stack; JIT is fast; **Native AOT** for near-C++ startup/memory (AOT linking via LLVM below); MSIX + MSI/EXE packaging first-class. WPF fallback for pre-22H2 compatibility. |
| **Linux** | Rust | **GTK 4 + libadwaita** (`gtk4-rs`) | Rust MIT/Apache-2.0 · GTK LGPL-2.1 · libadwaita LGPL-2.1 | Zero-GC memory profile, native GNOME look, small fast binaries, memory-safe; Flatpak + .deb first-class. Qt 6 (LGPL) fallback for KDE-centric distros. |
| **macOS** | Swift 6 | **SwiftUI + AppKit** | Swift Apache-2.0 · (SDK — see §2.3 note) | Apple's native stack; AppKit interop for menu bar/window control; lowest energy impact; Keychain integration; .dmg/.pkg pipeline. |

All three consume the **same backend REST API** as the web/Electron clients — no backend rewrite.

### Why not X
- C++/Win32: fastest, but maintenance cost highest — rejected.
- WPF: fine, but WinUI 3 is the forward path with better HiDPI/theme tooling.
- .NET MAUI / Avalonia / Uno / Flutter: cross-platform frameworks — reduce per-platform fidelity;
  rejected per "one native toolkit per platform" requirement.
- Tauri/Neutralino/webview shells: web frameworks — excluded by constraint.
- Qt on Linux: excellent, but Rust+GTK4 wins on memory safety and GNOME-first polish.

---

## 2. Required Software, SDKs, and Dependencies — All Open-Source / Free

### 2.1 Windows
| Category | OSS Replacement (was → is) | License | Version |
|---|---|---|---|
| Language SDK | .NET SDK (unchanged) | MIT | 8.0 LTS (Native AOT-capable) |
| UI SDK | Windows App SDK (WinUI 3) (unchanged) | MIT | 1.5+ |
| OS SDK | Windows SDK — free download (unchanged) | freeware (Microsoft, no cost) | 10.0.26100 |
| **IDE** | **Visual Studio 2022 → VS Code + C# extension + `dotnet` CLI** | MIT (VS Code), OmniSharp MIT | latest |
| Build | MSBuild / `dotnet build` / `dotnet publish` (MSBuild is MIT, ships with SDK) | MIT | via SDK |
| Native AOT toolchain | MSVC link.exe → **LLVM clang-cl + lld-link** (set `IlcLinkTool`/toolchain env; fallback: free MS Build Tools, no cost but proprietary — only if a linker edge case requires it) | Apache-2.0 (LLVM) | LLVM 18 |
| Packaging MSIX | MSIX Packaging Tool GUI → **`msix-packaging` CLI** (`makemsix`, `signmsix`) from github.com/microsoft/msix-packaging | MIT | latest |
| Packaging MSI | WiX Toolset v4 (already OSS — unchanged) | MS-RL | v4 |
| Packaging EXE | NSIS (scriptable EXE installer) or single-file self-contained publish | zlib (NSIS) | 3.x |
| Signing | signtool → **`osslsigncode`** (Authenticode signing) or self-signed cert via PowerShell `New-SelfSignedCertificate` for internal builds | GPL-3.0 (osslsigncode) | 2.9+ |
| Icons/assets | Fluent System Icons (MIT, unchanged); vector edits in **Inkscape** (Figma → Inkscape/Penpot) | MIT / GPL-3.0 / AGPL | latest |
| NuGet packages | `Microsoft.WindowsAppSDK`, `CommunityToolkit.Mvvm`, `System.Text.Json`, `Microsoft.Data.Sqlite` (all MIT) | MIT | latest stable |
| Auto-update | Squirrel → **Velopack** or **WinSparkle** | MIT | latest |

Min target: Windows 10 22H2 / Windows 11. Outputs: **MSIX**, **MSI (WiX)**, **self-contained
single-file EXE** (`dotnet publish -r win-x64 --self-contained /p:PublishAot=true`).

**No-purchase signing strategy (Windows):** internal/QA builds use self-signed certificates;
public distribution without a CA-issued cert (the one unavoidable third-party cost) can ship
unsigned MSIX with sideloading or via **WinGet** (open-source client + community manifest repo)
with a documented SmartScreen warning. A paid OV/EV cert is *optional* — not required to build,
package, or install.

### 2.2 Linux (already fully OSS — unchanged)
| Category | Item | License | Version |
|---|---|---|---|
| Language | Rust toolchain via rustup | MIT/Apache-2.0 | 1.80+ stable |
| UI SDK | GTK 4 + libadwaita dev packages | LGPL-2.1 | GTK ≥ 4.10, libadwaita ≥ 1.3 |
| Bindings | gtk4-rs, adw, glib, gio, reqwest, tokio, rusqlite | MIT/Apache-2.0 | crates.io latest |
| Build system | Cargo (+ Meson/Ninja if C glue needed) | MIT / Apache-2.0 | — |
| Packaging .deb | `dpkg-dev`, `debhelper`, `cargo-deb` | GPL / MIT | — |
| Packaging Flatpak | `flatpak`, `flatpak-builder`, GNOME SDK runtime | LGPL / GPL / FOSS | org.gnome.Sdk 46 |
| Metadata | AppStream XML, desktop-entry file, hicolor icon theme | FOSS | — |
| Distro targets | Ubuntu 22.04/24.04 LTS, Fedora 40+, Debian 12, Flathub (universal) | — | — |

Signing: optional gpg-signed .deb via `debsign`/`dpkg-sig` (GPL tools, free); Flatpak signing
built into flatpak-builder. **Zero purchase required.**

### 2.3 macOS
| Category | OSS Replacement (was → is) | License | Version |
|---|---|---|---|
| Language | Swift (unchanged) | Apache-2.0 | 6.x |
| UI SDK | SwiftUI + AppKit (unchanged — Apple frameworks) | Apple free SDK | macOS 13+ min |
| **IDE/toolchain** | **Xcode GUI → VS Code + Swift extension + `swift` CLI; or the swift.org Swift toolchain + Command Line Tools** | MIT (VS Code) · Apache-2.0 (toolchain) | latest |
| SDK note | The macOS SDK itself is Apple-proprietary but **free of charge** (ships with Command Line Tools for Xcode). There is no fully-OSS way to link macOS frameworks — treat CLT as a free runtime requirement, not a purchase. | freeware | CLT 16.x |
| Build system | Swift Package Manager (unchanged) | Apache-2.0 | SPM 6 |
| App bundling | Xcode archive → **scripted `.app` layout + `swift build --product ... --configuration release`** (small shell/Python script; no xcodebuild required) | self-written (MIT) | — |
| Packaging .dmg | **create-dmg** or **dmgbuild** (unchanged — OSS) | MIT | latest |
| Packaging .pkg | `pkgbuild` + `productbuild` (system, free) | freeware (Apple) | system |
| Signing (local) | `codesign --deep -s -` ad-hoc / self-signed identity — no paid cert needed for internal distribution | system | — |
| Notarization | `notarytool` + `stapler` (system, free) — **requires $99/yr Apple Developer Program membership only if you choose notarized/App Store distribution; skip entirely for internal or Homebrew-cask distribution** | system | — |
| Updates | Sparkle 2 (already OSS) | MIT | 2.x |
| Dependencies | Keychain Services, URLSession async/await, system libsqlite3 | system | — |

**No-purchase distribution strategy (macOS):** ad-hoc-signed `.dmg` for internal use
(right-click → Open); public distribution without the Developer Program via a **Homebrew Cask**
(open-source ecosystem) with a documented Gatekeeper step; the paid program remains optional.

---

## 3. UI Fidelity & Design System Parity (unchanged from original plan)

1. **Token port**: export web design tokens as machine-readable JSON from the shared package;
   consume per platform: WinUI `ResourceDictionary`/`ThemeResource`, GTK CSS provider,
   SwiftUI `Color`/`Font` extensions. Automatic dark/light per OS preference.
2. **Component parity checklist**: sidebar + collapse/resize, breadcrumb header, cards, badges,
   tab strips, toolbar cards (ticket detail 12-tab interface), month calendar mini-cards,
   dialogs/modals, toasts, empty/loading/error states, ticket selection + batch actions.
3. **Feature parity (v1)**: login/MFA (TOTP + email), dashboard KPIs, tickets (all detail tabs),
   board views, calendar, PTO, clients/contacts, KB, Kumo (AES-256-GCM decrypt + TOTP ported
   per language), billing read views, settings, What's New renderer.
4. **Excluded in v1**: CloudConnect heavy configuration, full admin/user management, reports
   builder — read-only or link-to-web fallback.

---

## 4. Architecture (unchanged patterns; only tooling swaps)

- **MVVM-like** on all three: Windows `CommunityToolkit.Mvvm` (MIT), Linux gtk4-rs/actor model,
  macOS Swift Observation.
- **API layer**: OpenAPI spec as source of truth; generated typed clients — Windows: Kiota
  (MIT) or NSwag (MIT) → Linux: `progenitor` (MIT) → macOS: `swift-openapi-generator`
  (Apache-2.0) or hand-written Codable DTOs.
- **Auth/session**: same JWT + MFA contract; tokens in Windows Credential Locker/DPAPI,
  libsecret (LGPL), macOS Keychain.
- **Local cache**: SQLite (Microsoft.Data.Sqlite / rusqlite / libsqlite3) for KPIs, ticket
  lists, KB; online-first with optimistic UI + retry queue.
- **Config**: server URL default `http://localhost:4000`, overridable in Settings.
- **Updates**: Windows — Velopack/WinSparkle or MSIX App Installer; Linux — Flathub/repos;
  macOS — Sparkle 2.

---

## 5. Security Requirements (unchanged; OSS tooling only)

- TLS 1.2+; certificate pinning via WinHttpHandler, rustls (MIT/Apache), URLSession.
- Secure storage: DPAPI/Credential Locker, libsecret, Keychain.
- Kumo secrets decrypted in memory only; wipe buffers; screen-capture protection on sensitive
  screens.
- Signing: **osslsigncode/self-signed** (Windows, optional CA cert), signed Flatpak + optional
  gpg .deb (Linux), ad-hoc/Developer-ID codesign (macOS — paid cert optional).
- No secrets in repos; CI-injected keys.

---

## 6. Packaging & Distribution (same outputs, OSS tools)

| Platform | Installers | Open-source tooling |
|---|---|---|
| Windows | MSIX (recommended), MSI via WiX v4, self-contained EXE | `msix-packaging` CLI, WiX v4, NSIS, `osslsigncode` |
| Linux | .deb (Ubuntu/Debian) + Flatpak (Flathub) | cargo-deb/dpkg, flatpak-builder, `appstreamcli` validation |
| macOS | .dmg (ad-hoc or notarized) + .pkg | create-dmg/dmgbuild, pkgbuild/productbuild, codesign/notarytool/stapler |

- Windows: self-signed certs for internal builds; WinGet + unsigned MSIX sideload for public
  no-cost distribution; paid OV/EV cert strictly optional.
- macOS: ad-hoc signing + Homebrew Cask for no-cost distribution; Developer Program only if
  notarization/App Store is required.
- Linux: zero cost end-to-end (Flathub submission needs AppStream metadata + screenshots).

---

## 7. CI/CD & Performance — Open-Source Tooling

### CI (GitHub Actions → self-hosted open-source alternatives)
- **Forgejo Actions** (MIT) or **Gitea Actions**, or **GitLab CE** (MIT) / **Jenkins** (MIT).
- Runners: Windows — existing dev workstation or self-hosted VM; Linux — containerized runner;
  macOS — self-hosted runner on a Mac (hardware is the only unavoidable cost; VM macOS builds
  violate Apple's license, so use real Mac hardware — a used Mac mini suffices).
- Note: GitHub Actions free tier is usable for public repos without cost, but it is a
  proprietary service; the self-hosted options above remove that dependency entirely.

### Performance profiling (proprietary → OSS)
- Windows: `dotnet-trace` / `dotnet-counters` (MIT, ships with SDK) + **Tracy** (BSD) sampling.
- Linux: `perf` (GPL) + **FlameGraph** (CDDL/Apache) + **hyperfine** (MIT) benchmarks.
- macOS: `xctrace`/Instruments is free-with-Xcode; OSS alternatives: **samply** (MIT) and
  FlameGraph/hyperfine for cross-platform parity.

### Monitoring / crash reporting
- **GlitchTip** (MIT, Sentry-API-compatible, self-hosted) or **OpenTelemetry + Grafana**
  (Apache-2.0) instead of commercial SaaS.

### Performance budgets (CI-enforced, unchanged)
- Launch to interactive: ≤ 1.2 s (Native AOT Windows target ≤ 800 ms)
- Idle RAM: Windows ≤ 150 MB · Linux ≤ 90 MB · macOS ≤ 120 MB
- Ticket list scroll: 60 fps with 10k rows (virtualization mandatory)
- API round-trip overhead: no framework overhead beyond JSON decode; typed clients only

---

## 8. Phased Delivery Plan (unchanged structure)

| Phase | Scope | Deliverables |
|---|---|---|
| **P0 — Shared contracts** | Design-token JSON export, OpenAPI client generation per language, component parity spec, self-hosted CI (Forgejo/GitLab) with Windows/Linux/macOS runners | token packs, generated clients, parity checklist, green CI scaffolds |
| **P1 — Windows native** | .NET 8 + WinUI 3 app: auth/MFA, dashboard, tickets (all tabs), calendar, PTO, clients, KB, Kumo read, settings; Native AOT via LLVM | MSIX + MSI + EXE artifacts (self-signed), performance report |
| **P2 — Linux native** | Rust + GTK4/libadwaita app: same feature set | .deb + Flatpak artifacts; AppStream metadata |
| **P3 — macOS native** | Swift + SwiftUI/AppKit app: same feature set | ad-hoc .dmg + .pkg (notarization optional) |
| **P4 — Hardening & co-existence** | Security passes, performance budgets enforced in CI, parallel-versioning with the Electron app, feature flags | benchmark reports, release runbook |
| **P5 — Distribution & maintenance** | WinGet + Flathub + Homebrew Cask channels, auto-update (Velopack/Sparkle/Flathub), GlitchTip telemetry, update cadence | published channels + runbook |

### Dependency & ordering notes (phases already listed prerequisites-first)

- **P0** — no prerequisites. Skipping it blocks P1–P3: token packs, generated API clients, the parity checklist, and self-hosted CI runners are all consumed by the per-platform apps.
- **P1 (Windows native)** — depends on **P0** (tokens, generated clients, parity spec, Windows CI) and the existing backend (login/MFA per PLAN-001). Risk if P0 is skipped: WinUI screens are hand-built against an unsynced theme and untyped API calls; CI can't build MSIX/MSI artifacts.
- **P2 (Linux native)** — depends on **P0** (tokens, generated clients, parity spec, Linux CI). Independent of P1. Risk if P0 is skipped: same drift as P1.
- **P3 (macOS native)** — depends on **P0** (tokens, generated clients, parity spec, macOS runner — requires real Mac hardware). Independent of P1/P2. Risk if P0 is skipped: same drift as P1/P2.
- **P4 (Hardening & co-existence)** — depends on **P1–P3** (apps must exist before security passes, CI-enforced perf budgets, and parallel-versioning with Electron). Risk if skipped: hardening/benchmarks have no native binaries to audit.
- **P5 (Distribution & maintenance)** — depends on **P4** (signing decisions, runbooks, update mechanism) and **P1–P3** (shippable artifacts). Risk if P4 is skipped: stores receive unsigned/unapproved builds; auto-update ships without a tested update path.

---

## 9. Coexistence with the Existing Electron App (unchanged)

- The Electron app remains in `apps/desktop` with its `app://c7ntax` pipeline and is rebuilt on
  the same cadence; it is not replaced.
- All four desktop clients share: backend API, OpenAPI spec, design tokens, feature flags,
  BuildNotes versioning (`YYYY.M.D.BBB`), and QA fixture data.
- New repo layout: `apps/desktop-win/`, `apps/desktop-linux/`, `apps/desktop-mac/` alongside
  `apps/desktop/` (Electron); shared artifacts in `packages/shared/` and
  `packages/desktop-common/`.

---

## 10. Cost & Compliance Summary (what this plan avoids vs. what remains)

| Item | Original plan | OSS plan | Notes |
|---|---|---|---|
| Windows IDE | Visual Studio 2022 | VS Code + `dotnet` CLI | MIT, free |
| Windows packaging GUI | MSIX Packaging Tool | `msix-packaging` CLI | MIT |
| Windows signing | signtool + paid OV/EV cert | `osslsigncode` + self-signed; paid cert optional | SmartScreen reputation only with paid cert — document warning |
| AOT linker | MSVC link.exe | LLVM clang-cl + lld-link | Apache-2.0 |
| macOS IDE | Xcode | VS Code + swift.org toolchain + CLT | CLT/Xcode SDK free but Apple-proprietary — no purchase |
| Notarization | Developer Program ($99/yr) | Optional — ad-hoc + Homebrew Cask | Only needed for App Store/notarized distribution |
| CI | GitHub Actions (SaaS) | Forgejo/Gitea/GitLab CE/Jenkins self-hosted | macOS runner needs real Mac hardware (one-time hardware cost) |
| Profiling | Instruments/WPT | dotnet-trace, perf, Tracy, samply, FlameGraph, hyperfine | all OSS |
| Monitoring | commercial SaaS | GlitchTip / OpenTelemetry + Grafana | MIT/Apache |
| Icons/design | Figma (SaaS) | Inkscape + Penpot | GPL/AGPL |

**Unavoidable non-software costs (flagged for transparency):**
1. macOS build/CI requires Apple hardware (used Mac mini is the cheapest path).
2. Windows SmartScreen reputation and macOS notarization/App Store require paid certificates /
   program fees — both are optional for distribution via WinGet / Flathub / Homebrew Cask.

---

## 11. Open Decisions to Confirm Before Implementation (unchanged + 1)
1. Windows fallback target: Windows 10 22H2 vs Windows 11-only (affects WinUI 3 features).
2. Linux default toolkit preference: GTK4/libadwaita (recommended) vs Qt 6.
3. Windows installer priority: MSIX-first vs EXE-first for corporate deployments.
4. macOS minimum: macOS 13 Ventura (recommended) or newer.
5. Update mechanism approval per platform (Velopack/MSIX, Flathub, Sparkle).
6. CI platform: Forgejo Actions (recommended) vs GitLab CE vs Jenkins — confirm before P0.
