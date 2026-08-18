# C7NTAX — Native Desktop Clients Plan (Windows / Linux / macOS)

**Scope:** Build three native desktop applications — Windows, Linux, macOS — that look and
function as close as possible to the current C7NTAX WebUI/desktop experience. The existing
Electron desktop app **remains part of the project** and is updated alongside these three
versions; it is not replaced.

**Constraint:** Native toolkits only — **no Electron, no web frameworks** (no Tauri, no
embedded browser views). Priority order: speed → low memory/resource usage → compatibility →
maintenance.

**Status:** Plan only. No implementation has begun.
**Version:** 1.0 — 2026-08-12

---

## 1. Technology Selection

| Platform | Language | UI Toolkit | Rationale (speed / RAM / maintenance) |
|---|---|---|---|
| **Windows** | C# (.NET 8 LTS) | **WinUI 3** (Windows App SDK) | Microsoft's recommended native stack; JIT is fast; option to publish **Native AOT** for near-C++ startup/memory; best tooling/docs; MSIX + MSI/EXE packaging first-class. WPF listed as fallback for pre-22H2 compatibility. |
| **Linux** | Rust | **GTK 4 + libadwaita** (`gtk4-rs`) | Zero-GC memory profile, native GNOME look, small binaries, memory-safe; Flatpak + .deb both first-class. Qt 6 (C++) listed as fallback for KDE-centric distros. |
| **macOS** | Swift 6 | **SwiftUI + AppKit** | Apple's native stack; AppKit interop for fine-grained control (menu bar, window state, NSToolbar); lowest energy impact (Apple Silicon), Keychain integration, App Store + notarized .dmg/.pkg pipeline. |

All three consume the **same backend REST API** as the web/Electron clients — no backend rewrite.

### Why not X
- C++/Win32: fastest, but maintenance cost highest — rejected.
- WPF: fine, but WinUI 3 is the forward path with better HiDPI/theme tooling.
- .NET MAUI / Avalonia / Uno / Flutter: cross-platform frameworks — reduce per-platform fidelity
  and platform-native feel; rejected per "one native toolkit per platform" requirement.
- Tauri/Neutralino/webview shells: web frameworks — excluded by constraint.
- Qt on Linux: excellent, but Rust+GTK4 wins on memory safety and GNOME-first polish.

---

## 2. Required Software, SDKs, and Dependencies

### 2.1 Windows
| Category | Item | Version |
|---|---|---|
| Language SDK | .NET SDK | 8.0 LTS (Native AOT-capable) |
| UI SDK | Windows App SDK (WinUI 3) | 1.5+ |
| OS SDK | Windows SDK | 10.0.26100 (Windows 11 24H2) |
| IDE/toolchain | Visual Studio 2022 | 17.10+, `.NET desktop development` + `Windows application development` workloads |
| Build | MSBuild / `dotnet publish` | via SDK |
| Packaging | WiX Toolset v4, MSIX Packaging Tool, `MakeAppx`, `signtool` | latest |
| Icons/assets | Windows App SDK icons + Fluent icon font | — |
| NuGet packages | `Microsoft.WindowsAppSDK`, `CommunityToolkit.Mvvm`, `System.Text.Json`, `Microsoft.Data.Sqlite`, `WindowsAppSDK` self-contained runtime | latest stable |
| Signing | Code Signing Certificate (OV/EV) in CI secrets | — |

Min target: Windows 10 22H2 / Windows 11. Outputs: **MSIX**, **MSI (WiX)**, and
**self-contained single-file EXE** (`dotnet publish -r win-x64 --self-contained /p:PublishAot=true`).

### 2.2 Linux
| Category | Item | Version |
|---|---|---|
| Language | Rust toolchain via rustup | 1.80+ stable |
| UI SDK | GTK 4 + libadwaita (dev packages) | GTK ≥ 4.10, libadwaita ≥ 1.3 |
| Bindings | gtk4-rs, adw, glib, gio, reqwest, tokio, rusqlite | crates.io latest |
| Build system | Cargo (+ Meson/Ninja only if C glue needed) | — |
| Packaging .deb | `dpkg-dev`, `debhelper`, `cargo-deb` | — |
| Packaging Flatpak | `flatpak`, `flatpak-builder`, GNOME SDK runtime | org.gnome.Sdk 46 |
| Metadata | AppStream XML, desktop-entry file, icon theme (hicolor) | — |
| Distro targets | Ubuntu 22.04/24.04 LTS, Fedora 40+, Debian 12, Flathub (universal) | — |

### 2.3 macOS
| Category | Item | Version |
|---|---|---|
| Language | Swift | 6.x (Xcode 16+) |
| UI SDK | SwiftUI + AppKit | macOS 13+ min (Ventura) |
| IDE/toolchain | Xcode (xcodebuild CLI for CI) | 16+ |
| Build system | Swift Package Manager + Xcode project | — |
| Packaging | `hdiutil`/`create-dmg`, `pkgbuild`, `productbuild` | system |
| Signing/notarization | Apple Developer ID Application cert, `notarytool`, `stapler` | — |
| Dependencies | Keychain Services, URLSession (async/await), SQLite (system libsqlite3) | system |

---

## 3. UI Fidelity & Design System Parity

The three apps must render the same experience as the WebUI (dark navy/cyber design, light mode
support):

1. **Token port**: export the web design tokens (colors, spacing scale, radius, type scale) as
   machine-readable JSON from the shared package; each app consumes them into its theming layer:
   - Windows: WinUI `ResourceDictionary` + `ThemeResource` brushes generated from tokens.
   - Linux: GTK CSS provider generated from tokens; libadwaita dark preference respected.
   - macOS: SwiftUI `Color`/`Font` extensions generated from tokens; automatic dark/light via
     `colorScheme`.
2. **Component parity checklist** (shared spec doc): sidebar + collapse/resize, breadcrumb
   header, cards, badges, tab strips, toolbar cards (ticket detail 12-tab interface), month
   calendar mini-cards, dialogs/modals, toasts, empty/loading/error states, ticket list
   selection + batch actions.
3. **Feature parity (v1)**: login/MFA (TOTP + email), dashboard KPIs, tickets (list, filters,
   detail tabs: Ticket/Activities/Time/Attachments/Expenses/Schedule/Links/History/Finance/
   Audit Trail), board views, calendar, PTO, clients/contacts, KB, Kumo (passwords with
   AES-256-GCM decrypt + TOTP — crypto logic ported per language), billing read views, settings,
   What's New (BuildNotes renderer).
4. **Excluded in v1**: CloudConnect heavy configuration, full admin/user management, reports
   builder — read-only or link-to-web fallback.

---

## 4. Architecture (per platform, shared patterns)

- **MVVM / MVVM-like** on all three: Windows (CommunityToolkit.Mvvm), Linux (gtk4-rs relm-style
  or plain actor model), macOS (Swift Observation framework).
- **API layer**: OpenAPI 3.1 spec is the source of truth; generate typed clients:
  Windows: Kiota or NSwag-generated C# client → Linux: `progenitor` (Rust OpenAPI client) →
  macOS: custom `Codable` DTOs validated against the spec (or swift-openapi-generator).
- **Auth/session**: same JWT contract; refresh handling; MFA flows; tokens in platform secure
  storage: Windows Credential Locker/DPAPI → Linux libsecret (Secret Service) → macOS Keychain.
- **Local cache**: SQLite per platform (Microsoft.Data.Sqlite / rusqlite / libsqlite3) for
  dashboard KPIs, ticket lists, KB, and offline read; writes are online-only in v1
  (desktop assumption) with optimistic UI + retry queue.
- **Config**: server URL default `http://localhost:4000` (matching shared constants), overridable
  in Settings; stored in platform-native config locations.
- **Updates**: Windows — auto-update via MSIX/App Installer or Squirrel-style EXE updater;
  Linux — distro repos / Flathub updates; macOS — Sparkle 2 for .dmg builds.

---

## 5. Security Requirements

- TLS 1.2+; certificate pinning available via platform HTTP stacks (WinHttpHandler, rustls,
  URLSession) — enabled once a pinned-CA rotation policy exists.
- Secure storage: DPAPI/Credential Locker (Windows), libsecret (Linux), Keychain (macOS).
- Kumo secrets decrypted in memory only; wipe buffers after use; screen-capture protection
  (Win32 SetWindowDisplayAffinity / Linux portals / macOS) on sensitive screens.
- Signing: Authenticode (Windows), signed Flatpak + optional gpg-signed .deb (Linux),
  notarization + hardened runtime (macOS).
- No secrets in repos; CI-injected certificates/keys.

---

## 6. Packaging & Distribution

| Platform | Installers | Tools |
|---|---|---|
| Windows | MSIX (recommended), MSI via WiX v4, portable/self-contained EXE | MakeAppx, signtool, WiX |
| Linux | .deb (Ubuntu/Debian) + Flatpak (Flathub) | cargo-deb/dpkg, flatpak-builder, AppStream validation |
| macOS | .dmg (signed/notarized) + .pkg | create-dmg/hdiutil, pkgbuild/productbuild, notarytool + stapler |

- Windows signing: OV/EV code-signing cert; SmartScreen reputation via signed MSIX.
- macOS: Developer ID Application cert; notarize every release; staple.
- Linux: Flathub submission requires AppStream metadata, screenshots, and a build recipe.

---

## 7. Phased Delivery Plan

| Phase | Scope | Deliverables |
|---|---|---|
| **P0 — Shared contracts** | Design-token JSON export, OpenAPI client generation per language, component parity spec, CI runners (windows-latest, ubuntu-latest, macos-14) | token packs, generated clients, parity checklist, green CI scaffolds |
| **P1 — Windows native** | .NET 8 + WinUI 3 app: auth/MFA, dashboard, tickets (all tabs), calendar, PTO, clients, KB, Kumo read, settings; Native AOT build | MSIX + MSI + EXE artifacts, signed; performance report (launch/memory targets below) |
| **P2 — Linux native** | Rust + GTK4/libadwaita app: same feature set | .deb + Flatpak artifacts; AppStream metadata |
| **P3 — macOS native** | Swift + SwiftUI/AppKit app: same feature set | signed/notarized .dmg + .pkg |
| **P4 — Hardening & co-existence** | Security passes, performance budgets enforced in CI, parallel-versioning scheme shared with the Electron app, feature flags | benchmark reports, release runbook |
| **P5 — Distribution & maintenance** | Store/channel publishing (WinGet/MSIX, Flathub, direct downloads), auto-update, crash telemetry, update cadence | published channels + runbook |

### Dependency & ordering notes (phases already listed prerequisites-first)

- **P0** — no prerequisites. Skipping it blocks P1–P3: token packs, generated API clients, the parity checklist, and CI runners are all consumed by the per-platform apps.
- **P1 (Windows native)** — depends on **P0** (tokens, generated clients, parity spec, Windows CI) and the existing backend (login/MFA per PLAN-001). Risk if P0 is skipped: WinUI screens are hand-built against an unsynced theme and untyped API calls; CI can't build MSIX/MSI artifacts.
- **P2 (Linux native)** — depends on **P0** (tokens, generated clients, parity spec, Linux CI). Independent of P1 (different platform), but sharing P0 avoids re-deriving contracts. Risk if P0 is skipped: same drift as P1.
- **P3 (macOS native)** — depends on **P0** (tokens, generated clients, parity spec, macOS CI runner). Independent of P1/P2. Risk if P0 is skipped: same drift as P1/P2.
- **P4 (Hardening & co-existence)** — depends on **P1–P3** (apps must exist before security passes, CI-enforced perf budgets, and parallel-versioning with Electron). Risk if skipped: hardening/benchmarks have no native binaries to audit; parallel-versioning scheme has no releases to version.
- **P5 (Distribution & maintenance)** — depends on **P4** (signing, runbooks, update mechanism decisions) and **P1–P3** (shippable artifacts). Risk if P4 is skipped: stores receive unsigned/unapproved builds; auto-update ships without a tested update path.

### Performance budgets (CI-enforced, from cold start, 1080p window, seeded dataset)
- Launch to interactive: **≤ 1.2 s** (Native AOT Windows target ≤ 800 ms)
- Idle RAM: Windows ≤ 150 MB · Linux ≤ 90 MB · macOS ≤ 120 MB
- Ticket list scroll: 60 fps with 10k rows (virtualization mandatory on all platforms)
- API round-trip overhead: no framework overhead beyond JSON decode; typed clients only

---

## 8. Coexistence with the Existing Electron App

- The Electron app remains in `apps/desktop` and keeps its `app://c7ntax` protocol-based
  packaging pipeline (WebUI source of truth). It is rebuilt and shipped on the same release
  cadence.
- All four desktop clients share: backend API, OpenAPI spec, design tokens, feature flags,
  BuildNotes versioning scheme (`YYYY.M.D.BBB`), and QA fixture data (seeded DB + snapshots).
- New repo layout: `apps/desktop-win/`, `apps/desktop-linux/`, `apps/desktop-mac/` alongside
  `apps/desktop/` (Electron). Shared artifacts live in `packages/shared/` (tokens, spec) and a
  new `packages/desktop-common/` (parity spec, test fixtures, benchmark harness).

---

## 9. Open Decisions to Confirm Before Implementation
1. Windows fallback target: Windows 10 22H2 vs Windows 11-only (affects WinUI 3 features).
2. Linux default toolkit preference: GTK4/libadwaita (recommended) vs Qt 6.
3. Windows installer priority: MSIX-first vs EXE-first for corporate deployments.
4. macOS minimum: macOS 13 Ventura (recommended) or newer.
5. Update mechanism approval per platform (MSIX auto-update, Flathub, Sparkle).
