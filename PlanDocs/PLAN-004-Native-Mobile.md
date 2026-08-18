> **Plan ID:** PLAN-004
> **Title:** Native Mobile Applications Plan
> **Source:** `mobile-native-plan.md` (original remains in place)
> **Indexed:** 2026-08-18

# C7NTAX — Native Mobile Applications Plan

**Scope:** Android (Kotlin + Jetpack Compose) and iOS (Swift + SwiftUI) apps replicating the
core functionality of the existing C7NTAX desktop client (Electron app + web UI).

**Status:** Planning only. No implementation has begun.
**Version:** 1.0 — 2026-08-12
**Audience:** Engineering, operations, and release management.

---

## 1. Objectives & Scope

### 1.1 Goals
- Deliver native, offline-capable PSA clients for field technicians and managers on Android and iOS.
- Replicate the **core** desktop workflows: authentication (incl. MFA), ticket list/detail with
  notes & time entry, dashboard KPIs, calendar, PTO requests, clients/contacts lookup, knowledge
  base search, Kumo password read (biometric-gated), and notification inbox.
- Keep a single backend of record (existing Express/Prisma API) extended with a versioned,
  mobile-oriented contract.

### 1.2 Non-goals (initial release)
- Full administration (users/roles, board configuration), advanced billing operations, reports
  builder, and CloudConnect configuration are **view-only or excluded** in v1; they remain on
  desktop/web.
- Real-time collaboration (live co-editing of tickets) — replaced by near-real-time sync + push
  notifications.
- Full offline write support for complex entities (invoices, projects) — offline writes are
  limited to tickets/notes/time/PTO (see §4.4).

### 1.3 Core feature parity matrix

| Feature | Android/iOS v1 | Notes |
|---|---|---|
| Login, MFA (TOTP + email backup), session timeout | ✅ full | Biometric unlock after first login |
| Dashboard KPIs | ✅ read-only | Cached 15 min |
| Tickets: list, filters, detail, tabs (Ticket/Activities/Time/Attachments) | ✅ full incl. offline create note/time | Other tabs view-only |
| Calendar (month grid, schedule entries) | ✅ read-only + create schedule entry | Offline read |
| PTO requests | ✅ create + list | Offline queue |
| Clients & contacts | ✅ search/view | |
| Knowledge base | ✅ search/read | Offline cache of favorites |
| Kumo passwords | ✅ read + TOTP | Biometric re-auth required |
| Notifications inbox | ✅ | Push + in-app |
| Settings | ✅ (profile, theme, session timeout) | |
| Billing / reports / admin | ⛔ web only in v1 | Links open browser (SSO) |

---

## 2. Phase 0 — Foundations, Tooling & Repository

### 2.1 Repository layout
```
c7ntax/
  apps/
    mobile/
      android/        # Kotlin + Jetpack Compose
      ios/            # Swift + SwiftUI
      shared/         # API contract artifacts (OpenAPI spec, JSON schemas, feature flags)
```
- Keep both apps in the existing Turborepo/pnpm monorepo; native builds are driven by Gradle and
  Xcode build systems, invoked from CI directly (not via pnpm build), with a thin pnpm script
  pass-through for convenience.
- The OpenAPI 3.1 spec becomes the **single source of truth** for the mobile API surface
  (see §3.1). Generated clients are committed under `apps/mobile/shared/generated`.

### 2.2 Android toolchain
| Item | Choice |
|---|---|
| IDE | Android Studio (latest stable, Koala+ or newer) |
| Language | Kotlin 2.x (K2 compiler) |
| UI | Jetpack Compose (BOM), Material 3, adaptive layouts (WindowSizeClass), Navigation Compose |
| Build | Gradle 8.x with **version catalogs** (`gradle/libs.versions.toml`) |
| minSdk / targetSdk | 26 (Android 8.0) / 35 (Android 15) at launch |
| DI | Hilt |
| Networking | Retrofit + OkHttp 4.x + kotlinx.serialization |
| Local storage | Room (offline mirror + queue), DataStore Preferences/Proto |
| Background work | WorkManager (sync + upload retry) |
| Images | Coil |
| Push | Firebase Cloud Messaging (FCM HTTP v1 API on server side) |
| Monitoring | Firebase Crashlytics (optional) or Sentry |
| Signing | Play App Signing with an upload keystore kept in CI secrets |

**Configuration required:**
- `google-services.json` (Firebase project) — not committed; injected at CI build time.
- ProGuard/R8 rules tuned for Retrofit/kotlinx.serialization (keep rules for DTOs).
- `buildConfigField` values for API base URL, build variant (dev/staging/prod), pinning hashes
  (§5.3), and feature flags.

### 2.3 iOS toolchain
| Item | Choice |
|---|---|
| IDE | Xcode 16+ (Swift 5.10/6) |
| UI | SwiftUI, iOS 16+ minimum |
| Architecture | MVVM + repository layer (or TCA if team prefers); Observation framework |
| Networking | URLSession (async/await) — no third-party networking needed |
| Local storage | SwiftData (or Core Data) for cache + queue; UserDefaults for settings |
| Keychain | Security framework (kSecClass keys, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`) |
| Biometrics | LocalAuthentication (Face ID / Touch ID) |
| Push | Apple Push Notification service (APNs over HTTP/2) |
| Background | BGAppRefreshTask / BGProcessingTask for sync |
| Monitoring | Sentry (or App Store Connect crash reporting) |
| Signing | Xcode automatic signing with an App Store Connect API key |

**Configuration required:**
- `*.xcconfig` files for API base URLs, bundle id, entitlements, and per-environment config —
  secrets via CI environment, never in the repo.
- `PrivacyInfo.xcprivacy` manifest (§5.6) included in every target.
- Push Notification, Background Modes (background fetch) entitlements.

### 2.4 CI/CD & release automation
- **GitHub Actions**: `ubuntu-latest` (Android + backend tests) and `macos-15` (iOS builds, keychain
  access for signing).
- **Fastlane** for both platforms: match (iOS certs/profiles), supply (Play upload), App Store
  delivery, and screenshot automation.
- Automated versioning: `YEAR.MONTH.PATCH+build` aligned with the existing BuildNotes scheme;
  Git tags drive release notes generation.

---

## 3. Phase 1 — Backend Enablement for Mobile Clients

> Principle: **no breaking changes to the existing web/desktop API.** Mobile gets a parallel,
> versioned surface. The stable HTTP/SSE contract used by existing clients remains byte-stable.

### 3.1 API design
- **Versioned namespace:** `GET /api/mobile/v1/...` with the OpenAPI 3.1 spec generated/published
  from the Express routes (route decorators or a hand-maintained spec in `packages/shared/api`).
- **Mobile-optimized payloads:**
  - Cursor pagination (`?cursor=&limit=50`) instead of offset pagination for list feeds.
  - Field selection (`?fields=id,title,status,updatedAt`) to shrink payloads on cellular.
  - Response envelopes: `{ data, meta: { cursor, hasMore, serverTime } }`; errors as
    `{ error: { code, message, retryable } }` with stable machine codes.
  - `ETag`/`If-None-Match` and `updatedAt`-based conditional requests (304s save bandwidth).
- **Idempotency:** every mobile POST/PATCH carries an `Idempotency-Key` header; server persists
  keys per device+user for 24h so retries after network loss never duplicate notes/time entries.
- **Client attestation of versions:** `X-Client: c7ntax-android/1.2.3` and
  `X-Client: c7ntax-ios/1.2.3`; API can enforce minimum supported versions and return
  `force_update` flags.

### 3.2 Authentication & sessions
- Extend the existing JWT system with **device-bound sessions**:
  - New `DeviceSession` model: `userId, deviceId, platform, pushToken, publicKey, createdAt,
    lastSeenAt, revokedAt`.
  - Short-lived access token (15 min) + rotating refresh token per device; refresh rotation
    invalidates the previous token (detect theft).
  - On Android/iOS the refresh token is stored in Keystore/Keychain, optionally
    **biometric-protected** (Android Keystore `setUserAuthenticationRequired`, iOS
    `kSecAccessControlBiometryCurrentSet`).
- **MFA:** reuse the existing TOTP + email backup flows; expose mobile endpoints
  (`/auth/mfa/verify`, device-remember window of 30 days tied to the device session).
- Session timeout and lockout policies from the existing SystemConfig apply identically on mobile.
- Logout revokes only that device session; "logout everywhere" revokes all device sessions.

### 3.3 Push notifications (new capability)
- New service in `packages/notifications` (or `apps/api/src/services/push`):
  - **FCM HTTP v1** (Android) and **APNs HTTP/2** (iOS) senders, both via JWT service accounts.
  - `PushDevice` registry (device token, platform, app version, topics).
- Event-driven notifications from existing domain events (ticket assigned, SLA breached,
  ticket status change, PTO approved, new note mention). Initially an in-process emitter;
  graduate to a queue (Redis/BullMQ) when volumes require.
- Fallback: in-app notification inbox (existing Notification model) polled every 60s with the
  existing delta sync.

### 3.4 Data synchronization & offline behavior
- **Sync surface (offline-capable):** tickets (own + assigned), their comments, time entries,
  attachments metadata, schedule entries, PTO requests, KB articles (favorites).
- **Initial sync:** `GET /mobile/v1/sync/snapshot?scope=myWork` returning a compact bundle with a
  sync cursor (server `updatedAt` watermark) per collection.
- **Delta sync:** `GET /mobile/v1/sync/delta?cursor=...` returns creates/updates/deletes since the
  watermark; server keeps per-entity `updatedAt` + `deletedAt` tombstones for syncable entities.
- **Conflict policy:** last-write-wins at field level for tickets; notes/time entries are
  append-only (idempotency keys) so conflicts are avoided by design; PTO requests are
  immutable-after-create.
- **Offline write queue:** WorkManager / BGProcessingTask uploads queued mutations in order with
  exponential backoff; UI shows per-item state (pending/synced/failed) and surfaces conflicts
  to the user.
- **Offline UX rules:** everything readable from cache; create/edit actions enabled offline for
  the syncable subset; a persistent "Offline — changes will sync" banner.

### 3.5 Files & attachments
- Move attachment content to object storage (S3-compatible) behind the API with **pre-signed
  URLs**: `POST /mobile/v1/attachments/presign` → client uploads directly to storage → calls
  complete endpoint. Existing `storagePath` placeholder becomes a real key.
- Uploads resume via multipart chunking or background upload APIs on both platforms.

### 3.6 Backend migration & deployment notes
- All schema changes additive (new models: DeviceSession, PushDevice, SyncTombstone, IdempotencyKey).
- Deploy behind feature flags; web/desktop unaffected; monitor DB growth of new tables and add
  retention (purge revoked sessions, tombstones older than 90 days).

---

## 4. Phase 2 & 3 — Application Builds

### 4.1 Android (Kotlin + Jetpack Compose)
**Deliverables:**
1. Project scaffold: Gradle version catalog, Hilt, Compose BOM, Navigation, theming aligned to
   the C7NTAX navy/cyber design system (reuse hex tokens from the web design tokens).
2. Auth flow: login, MFA, biometric unlock, session timeout.
3. Home: dashboard KPIs + notification inbox.
4. Tickets: list with filters/search, detail with tabbed toolbar (Ticket, Activities, Time,
   Attachments view; other tabs read-only), offline note/time creation.
5. Calendar: month grid matching the web card style, schedule entry creation.
6. PTO: requests list + create.
7. Clients/Contacts, KB search, Kumo passwords (read + TOTP behind biometrics), Settings.
8. Offline engine: Room mirror, WorkManager sync, connectivity manager.
9. Push: FCM registration → PushDevice; deep links (`c7ntax://tickets/{id}`).

**Action items:** define navigation graph; implement repository + sync interfaces; UI tests with
Compose Test; instrumented tests on API 26–35 emulators; accessibility (TalkBack) pass.

### 4.2 iOS (Swift + SwiftUI)
**Deliverables:** identical feature set (parity with Android), implemented with SwiftUI
navigation stack, SwiftData cache, URLSession networking, Keychain, Face ID, APNs, and
BGAppRefreshTask sync. Deep links via universal links (`https://app.c7ntax.com/tickets/{id}`) and
custom scheme.

**Action items:** Xcode project + xcconfig environments; snapshot/unit tests; accessibility
(VoiceOver) pass; iPad adaptive layout (SplitView) from day one.

### 4.3 Shared UI/UX rules
- One design system: consume the existing C7NTAX token set (colors, spacing, type) — no divergent
  restyles. Dark theme default matching desktop; support light theme.
- Offline states, empty states, and error states designed explicitly for small screens.
- Feature parity gating: backend feature flags control rollout (e.g., billing view-only).

---

## 5. Security Requirements (Mobile)

### 5.1 Secure storage
- **Android:** Keystore-backed encryption for tokens; EncryptedSharedPreferences (Jetpack
  Security) or SQLCipher for cached data; hardware-backed keys where available
  (`setIsStrongBoxBacked(true)` when supported).
- **iOS:** Keychain for tokens (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`,
  biometric access control for refresh token + Kumo secrets); encrypted Core Data/SwiftData
  (Data Protection `NSFileProtectionCompleteUntilFirstUserAuthentication`).

### 5.2 Network transport
- TLS 1.2+ everywhere; HSTS respected. No cleartext traffic in release builds
  (`usesCleartextTraffic=false`; iOS ATS enforced with no exceptions).

### 5.3 Certificate pinning
- Pin the backend certificate or intermediate CA: OkHttp `CertificatePinner` (Android) and
  `URLSessionDelegate` challenge evaluation (iOS). Pin hashes shipped via config, rotated with
  app releases; a "report-only" mode in staging to validate rotation.

### 5.4 Authentication & session handling
- Short-lived access tokens; rotating device refresh tokens; biometric gate for sensitive
  operations (Kumo password reveal, PTO approval if enabled); automatic session expiry on device
  lock policy; jailbreak/root detection as advisory signal (log + warn, not hard block).

### 5.5 Secrets management
- No secrets in source: Firebase `google-services.json`, API keys, signing keystores, and App
  Store Connect API keys live in CI secret stores (GitHub Actions secrets/Vault).
- Backend secrets for FCM/APNs service accounts are server-side environment config.
- Obfuscation (R8) for Android release; strip debug symbols to crash services.

### 5.6 Platform data safety compliance
- **Google Play Data Safety form** and **Apple privacy nutrition labels** completed and kept in
  sync; both apps ship `PrivacyInfo.xcprivacy` (required API reasons).
- Data minimization: collect only push token, device identifiers for sessions, and analytics
  opt-in; document retention in a public privacy policy URL linked in both stores.
- Permissions only when needed: notifications (prompted after login), no contacts/location by
  default; photo access only for attachment picker (system picker, no broad storage permission).
- Screen capture protection: `FLAG_SECURE` on Kumo/sensitive screens; iOS privacy overlay on
  app-switcher snapshot.

---

## 6. Phase 4 — Store Publishing & Operations

### 6.1 Google Play
1. Create Google Play Console account (one-time $25), set up app, complete **Data Safety form**.
2. Enroll in **Play App Signing**; generate upload keystore (CI-held), upload first AAB.
3. Set up Firebase project, FCM, and Crashlytics linkage.
4. Internal testing track → closed alpha (technician pilot) → open beta → production rollout
   (staged percentages with rollback plan).
5. Store listing: screenshots (phone + tablet), feature graphic, short/full descriptions,
   privacy policy URL, content rating questionnaire.
6. Ongoing: quarterly targetSdk updates (Play requirement), API level audits, policy reviews.

### 6.2 Apple App Store
1. Enroll in Apple Developer Program ($99/yr); create App Store Connect app record.
2. Bundle ID + entitlements (push, background fetch); Xcode automatic signing with
   App Store Connect API key in CI.
3. Add `PrivacyInfo.xcprivacy`; complete privacy "nutrition labels"; verify against
   App Review guideline 5.1.1 (data collection) and 1.1.6 (security).
4. TestFlight internal (25 testers) → external beta (up to 10k) → App Store submission.
5. App Review readiness: 4.2 minimum functionality (not a webview wrapper — native UI required),
   account deletion in-app or web-linked (per 5.1.1(v) if accounts can be created in-app),
   login with demo account for review when applicable.
6. Ongoing: annual developer agreement renewal, new OS SDK adoption (typically required by April
   each year), TestFlight expirations (90 days).

### 6.3 Release management & maintenance
- Fastlane lanes: `beta` (internal/testflight), `release` (store submission with staged rollout).
- Versioning policy: `YYYY.M.P` + build number; forced-update floor managed by
  `X-Client` version check (§3.1).
- Backend compatibility: API keeps ≥ 2 mobile major versions supported; deprecation warnings
  before removal.
- Monitoring: Sentry/Crashlytics, ANR/launch metrics, API error dashboards, and release health
  dashboards in Play Console / App Store Connect.
- Update cadence: biweekly app patches; emergency hotfix lane with expedited review request.

---

## 7. Phased Delivery Plan & Timeline

| Phase | Deliverables | Est. effort |
|---|---|---|
| **P0 — Foundations** | Repo layout, OpenAPI contract tooling, Android/iOS scaffolds with CI that builds signed artifacts, design-token sync | 2–3 weeks |
| **P1 — Backend enablement** | `/mobile/v1` API (pagination, idempotency), DeviceSession + refresh rotation, PushDevice + FCM/APNs senders, delta sync + tombstones, pre-signed attachment uploads | 3–4 weeks |
| **P2 — Android v1** | Auth/MFA/biometrics, dashboard, tickets + offline notes/time, calendar, PTO, clients/KB/Kumo-read, notifications, offline engine | 6–8 weeks |
| **P3 — iOS v1** | Feature parity with Android on SwiftUI | 6–8 weeks (overlaps P2 if two engineers) |
| **P4 — Security hardening** | Pinning, storage audits, data-safety/隐私 manifests, pen-test + remediation | 2–3 weeks |
| **P5 — Store launch & ops** | Play + App Store listings, beta programs, staged rollout, monitoring, update cadence | 2 weeks + ongoing |

**Milestones**
- M1: Backend mobile contract frozen (OpenAPI v1 tagged).
- M2: Internal alpha on Android (closed track) with offline ticket workflows.
- M3: TestFlight alpha on iOS with feature parity.
- M4: Security sign-off (pinning, storage, manifests) before public beta.
- M5: Public beta both platforms; production rollout with staged percentages.

**Risks & mitigations**
- API bloat for mobile → strict field selection + DTOs, response size budgets in CI tests.
- Offline sync complexity → restrict offline writes to append-only entities first; conflicts
  avoided by design.
- App Review rejections → native UI (no webview shells), complete privacy manifests, demo
  accounts for review, compliance checklist before submission.
- Push reliability (China/AGP fragmentation) → in-app polling fallback; FCM token refresh handling
  and APNs sandbox/prod separation.

---

## 8. Open Questions to Resolve Before Implementation
1. Hosting for attachment object storage (S3-compatible provider + bucket policies).
2. Push provider choice: Firebase (works for both platforms via FCM on iOS) vs native APNs for
   iOS; recommend FCM for unified topic management + APNs direct as fallback.
3. Analytics platform decision (Sentry vs Crashlytics vs both).
4. Mobile team capacity: build Android and iOS in parallel (two engineers) or sequentially.
5. Offline write scope confirmation (tickets/notes/time/PTO as proposed).
