# Passkey Authentication — Implementation Plan

> **Status**: Planning  
> **Target**: C7 Overwatch (C7NTAX)  
> **Protocol**: WebAuthn Level 2 (W3C) via `@simplewebauthn/server` + `@simplewebauthn/browser`  
> **Principle**: Passkey-first, password-retained — additive, never destructive

---

## Table of Contents

1. [Current Auth Landscape](#1-current-auth-landscape)
2. [Dependencies](#2-dependencies)
3. [Database Schema Changes](#3-database-schema-changes)
4. [Environment Configuration](#4-environment-configuration)
5. [API Routes — Server](#5-api-routes--server)
6. [Client-Side Implementation](#6-client-side-implementation)
7. [Login Flow Design](#7-login-flow-design)
8. [Session Management](#8-session-management)
9. [Security Considerations](#9-security-considerations)
10. [Fallback & Recovery Strategy](#10-fallback--recovery-strategy)
11. [Implementation Stages](#11-implementation-stages)
12. [Rollback Plan](#12-rollback-plan)

---

## 1. Current Auth Landscape

| Aspect | Implementation |
|---|---|
| **Primary auth** | JWT Bearer token, 12 h expiry, signed with `JWT_SECRET` |
| **Login endpoint** | `POST /api/auth/login` — email/username + bcrypt password |
| **MFA** | TOTP via speakeasy (`/mfa/setup`, `/mfa/verify-setup`, `/mfa/verify`), backup codes, email OTP (`/mfa/send-email`, `/mfa/verify-email`) |
| **Session (alt)** | Cookie `c7_sid` + `sessionAuth.ts` — sliding expiry, admin bypass |
| **Middleware** | `authenticate()` extracts JWT → `req.user`; `requirePermission()` gates endpoints |
| **User model** | `id, email, username, passwordHash, firstName, lastName, isActive, isLocked, loginAttempts, lastLoginAt, mfaEnabled, mfaSecret, mfaBackupCodes, mfaEmailCode, roleId, permissions, companyId` |
| **Frontend** | `useAuth` hook + `AuthProvider` context; `LoginPage` collects email/username + password + MFA; token held in memory only |
| **Relevant files** | `apps/api/src/routes/auth.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/middleware/sessionAuth.ts`, `apps/web/src/pages/Login.tsx`, `apps/web/src/hooks/useAuth.tsx`, `apps/api/prisma/schema.prisma` |

---

## 2. Dependencies

```bash
pnpm add @simplewebauthn/server@^10 @simplewebauthn/browser@^10
```

| Package | Role |
|---|---|
| `@simplewebauthn/server` | Challenge generation, credential verification, RP metadata |
| `@simplewebauthn/browser` | `startRegistration()` / `startAuthentication()` wrappers around `navigator.credentials` |

No additional infrastructure (no Redis, no session store). Challenges are carried in short-lived signed JWTs.

---

## 3. Database Schema Changes

### 3.1 New Model — `PasskeyCredential`

```prisma
model PasskeyCredential {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  credentialId  String   @unique          // WebAuthn credential ID (base64url)
  publicKey     String                    // CBOR-encoded COSE key (base64url)
  counter       Int      @default(0)      // signature counter — clone detection
  transports    String[] @default([])     // ["internal","usb","nfc","ble","hybrid"]
  deviceName    String?                   // user-friendly label, e.g. "Chrome on Windows"
  createdAt     DateTime @default(now())
  lastUsedAt    DateTime?

  @@index([userId])
}
```

### 3.2 User Model Addition

```prisma
model User {
  // … all existing fields remain unchanged …
  passkeys  PasskeyCredential[]   // one user → many passkeys (cross-device)
}
```

**Migration**: `pnpm --filter @C7NTAX/api run db:push` (Prisma push in dev) or `npx prisma migrate dev --name add-passkey-credential` for a generated migration.

---

## 4. Environment Configuration

```env
# apps/api/.env — add:
WEBAUTHN_RP_ID=localhost                         # dev
WEBAUTHN_RP_NAME=C7 Overwatch
WEBAUTHN_ORIGIN=http://localhost:5173             # Vite dev server

# Production overrides:
# WEBAUTHN_RP_ID=app.cyber7group.com
# WEBAUTHN_ORIGIN=https://app.cyber7group.com
```

`RP_ID` must match the domain the web app is served from. For localhost dev the port is omitted (WebAuthn spec normalises `localhost`). `ORIGIN` must include scheme + port.

---

## 5. API Routes — Server

All routes under `apps/api/src/routes/auth.ts` prefixed `POST /api/auth/passkey`.

### 5.1 Registration Flow

#### `POST /auth/passkey/register/begin`

- **Auth**: `authenticate` middleware required — user must be logged in with password
- **Input**: none (user from JWT)
- **Logic**:
  1. Fetch user from DB
  2. Query existing passkeys → `excludeCredentials` array
  3. Call `generateRegistrationOptions()`:
     - `rpName: "C7 Overwatch"`, `rpID: WEBAUTHN_RP_ID`
     - `userDisplayName: firstName lastName`
     - `attestationType: "none"` (privacy-preserving; no attestation verification)
     - `residentKey: "preferred"`, `userVerification: "preferred"`
  4. Sign `{ challenge, userId }` → `challengeJwt` (5 min expiry)
- **Output**: `{ options: PublicKeyCredentialCreationOptions, challengeJwt: string }`

#### `POST /auth/passkey/register/complete`

- **Auth**: `authenticate` middleware required
- **Input**: `{ registrationResponse: AuthenticatorAttestationResponseJSON, challengeJwt: string }`
- **Logic**:
  1. Verify `challengeJwt` — extract `expectedChallenge` + `userId`; confirm userId matches `req.user.userId`
  2. Call `verifyRegistrationResponse()` with `expectedChallenge`, `expectedOrigin`, `expectedRPID`
  3. On success → `prisma.passkeyCredential.create({ credentialId, publicKey, counter, transports, deviceName })`
- **Output**: `{ registered: true, credentialId: string }`

### 5.2 Authentication Flow

#### `POST /auth/passkey/authenticate/begin`

- **Auth**: none (public)
- **Input**: `{ email?: string }` — optional, enables conditional UI pre-filtering
- **Logic**:
  1. If `email` → find user → fetch their passkeys → build `allowCredentials`
  2. Otherwise → empty `allowCredentials` (usernameless flow)
  3. Call `generateAuthenticationOptions({ rpID, userVerification: "preferred", ...allowCredentials })`
  4. Sign `{ challenge }` → `challengeJwt` (5 min)
- **Output**: `{ options: PublicKeyCredentialRequestOptions, challengeJwt: string }`

#### `POST /auth/passkey/authenticate/complete`

- **Auth**: none (public)
- **Input**: `{ authenticationResponse: AuthenticatorAssertionResponseJSON, challengeJwt: string }`
- **Logic**:
  1. Verify `challengeJwt` → extract `expectedChallenge`
  2. Look up `PasskeyCredential` by `authenticationResponse.id`
  3. Call `verifyAuthenticationResponse()` with stored credential
  4. On success:
     - Update credential counter + `lastUsedAt`
     - If user has `mfaEnabled: true` → return `{ mfaRequired: true, mfaToken }` (reuse existing `signMfaToken`)
     - Otherwise → `signToken()` with full payload, update `lastLoginAt`
- **Output**: `{ token, user: {…}, landingPage: {…} }` or `{ mfaRequired: true, mfaToken }`

### 5.3 Management Endpoints

#### `DELETE /auth/passkey/:credentialId`

- **Auth**: `authenticate`
- Removes a passkey belonging to the authenticated user
- At least one authentication method must remain (check: passkey count > 0 OR password exists)

#### `GET /auth/passkey`

- **Auth**: `authenticate`
- Returns list of user's passkeys with `{ credentialId, deviceName, transports, createdAt, lastUsedAt }`

### 5.4 Rate Limiting

Apply to `/authenticate/begin` and `/authenticate/complete`:

```ts
import rateLimit from "express-rate-limit";
const passkeyLimiter = rateLimit({ windowMs: 60_000, max: 10, message: "Too many requests" });
authRouter.use("/passkey", passkeyLimiter);
```

---

## 6. Client-Side Implementation

### 6.1 New Hook — `hooks/usePasskey.ts`

```ts
// Core functions exposed by the hook:
interface UsePasskey {
  registerPasskey: () => Promise<void>;              // begin → browser API → complete
  loginWithPasskey: (email?: string) => Promise<LoginResult>;
  passkeys: PasskeyInfo[];                           // user's registered passkeys
  removePasskey: (id: string) => Promise<void>;       // DELETE endpoint
  isSupported: boolean;                               // !!window.PublicKeyCredential
}
```

### 6.2 Registration UI (Settings → Security tab)

- Section heading: **"Passkeys"**
- "Add Passkey" button → calls `registerPasskey()`
- Table of registered passkeys: device name, transport icons, created date, last used, "Remove" action
- Tooltip explains: "Passkeys let you sign in with your fingerprint, face, or device PIN instead of a password."

### 6.3 Login Page Changes (`pages/Login.tsx`)

Add a **"Sign in with Passkey"** button as the primary CTA above the password form:

```
┌────────────────────────────────┐
│          C7 Overwatch           │
│                                │
│  ┌──────────────────────────┐  │
│  │ 🔑 Sign in with Passkey  │  │  ← primary, calls loginWithPasskey()
│  └──────────────────────────┘  │
│                                │
│  ─────── or ───────           │
│                                │
│  Email or username             │
│  ┌──────────────────────────┐  │
│  │ auto-filled by passkey   │  │  ← autocomplete="username webauthn"
│  └──────────────────────────┘  │
│  Password                      │
│  ┌──────────────────────────┐  │
│  │                            │  │
│  └──────────────────────────┘  │
│  [Sign In]                     │
└────────────────────────────────┘
```

Conditional UI: when the email field is focused and a passkey is available, the browser presents a native autofill prompt — no separate button press needed for returning users.

---

## 7. Login Flow Design

```
User arrives at /login
    │
    ├─ Passkey available on device?
    │   └─ Yes → click "Sign in with Passkey" (or conditional UI autofill)
    │       │
    │       ├─ POST /authenticate/begin  →  options + challengeJwt
    │       ├─ navigator.credentials.get(options)  →  browser native dialog
    │       ├─ POST /authenticate/complete  →  verification
    │       │
    │       ├─ User has MFA enabled?
    │       │   ├─ Yes → prompt TOTP code → POST /mfa/verify → JWT
    │       │   └─ No  → JWT directly
    │       │
    │       └─ Navigate to landing page
    │
    └─ No passkey / passkey fails
        └─ Fall through to password form
            └─ Password + MFA (existing flow, unchanged)
```

---

## 8. Session Management

Passkey authentication issues the **same JWT** as password login. No new session mechanism.

| Step | Action |
|---|---|
| Passkey verified | `signToken()` called with identical payload: `{ userId, email, role, companyId, permissions }` |
| JWT expiry | 12 hours (unchanged from password flow) |
| MFA | If `mfaEnabled: true`, passkey login still requires MFA — no single-factor downgrade |
| Logout | Same `logout()` — clears in-memory auth state; no server-side invalidation needed |
| Cookie session | `sessionAuth.ts` (`c7_sid` cookie) remains available as alternative; passkey can also create a cookie session if desired (future) |

---

## 9. Security Considerations

| Concern | Mitigation |
|---|---|
| **Challenge replay** | `challengeJwt` signed with `JWT_SECRET`, 5 min expiry, verified on server for every assertion/attestation |
| **Credential cloning** | Signature counter tracked; server rejects authentication if `newCounter <= storedCounter` |
| **RP ID spoofing** | `expectedRPID` and `expectedOrigin` checked server-side against env-configured values |
| **User verification bypass** | `userVerification: "preferred"` — browser decides; server can escalate to `"required"` for admin/sensitive operations |
| **Attestation privacy** | `attestationType: "none"` — no device fingerprinting; zero attestation metadata stored |
| **Brute force** | Rate limiter on begin + complete (10 req/min); account lockout after N failed attempts across passkey + password combined |
| **Account recovery** | Password login is **never removed** when passkeys are added; always a fallback path |
| **MFA downgrade** | If user has MFA enabled, passkey login still requires MFA — passkey + MFA = phishing-resistant + second factor |
| **Locked accounts** | `isLocked` / `isActive` checks apply identically to passkey and password flows |
| **XSS** | JWT held in memory, not localStorage — passkey flow uses the same token storage pattern |

---

## 10. Fallback & Recovery Strategy

Passkeys are **additive, never destructive**. The existing password + MFA path is untouched.

| Scenario | Path |
|---|---|
| **User with passkey on current device** | Passkey login → MFA (if enabled) → in |
| **User without passkey on current device** | Type email → password → MFA → in. Register passkey in Settings for next time. |
| **User lost passkey device** | Password login is always available. Remove old passkey in Settings. Register new one. |
| **Passkey verification fails** (wrong device, RP mismatch) | Show clear error → fallback to password form. |
| **Browser doesn't support WebAuthn** | `isSupported` check hides passkey UI entirely. Only password form shown. |
| **User changes device/OS** | Login with password on new device → register new passkey in Settings. Old passkey can be removed. |
| **First-time user (no account)** | Account creation with password (existing flow). Optionally prompted to register passkey post-login. |
| **Admin needs to reset access** | Same as today — admin changes password or deactivates account. Passkey is additional credential, not exclusive. |

---

## 11. Implementation Stages

Stages are listed in **dependency order** (prerequisites first).

### Stage 1 — Server Foundation *(~1 day)*
- **Dependency note:** no prerequisites beyond the existing `auth.ts` router and JWT session storage. Everything else depends on this stage's endpoints and model.

- [ ] Add `PasskeyCredential` model to `schema.prisma`
- [ ] Run `prisma db push` / migration
- [ ] Install `@simplewebauthn/server`
- [ ] Add `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN` to `.env`
- [ ] Implement `POST /auth/passkey/register/begin`
- [ ] Implement `POST /auth/passkey/register/complete`
- [ ] Implement `POST /auth/passkey/authenticate/begin`
- [ ] Implement `POST /auth/passkey/authenticate/complete`
- [ ] Add rate limiter to passkey routes
- [ ] Test all routes with `@simplewebauthn/server` unit tests or a WebAuthn simulator

**Verification**: POST endpoints return correct JSON shapes; `generateRegistrationOptions` and `generateAuthenticationOptions` produce valid output.

### Stage 2 — Client Passkey Management *(~1 day)*
- **Dependency note:** depends on Stage 1 (register/authenticate endpoints + `PasskeyCredential` model). Risk if Stage 1 is skipped: `registerPasskey()`/`loginWithPasskey()` call routes that don't exist and the Settings list has no data source.

- [ ] Install `@simplewebauthn/browser`
- [ ] Create `hooks/usePasskey.ts`
- [ ] Implement `registerPasskey()` — begin → `startRegistration()` → complete
- [ ] Implement `loginWithPasskey()` — begin → `startAuthentication()` → complete
- [ ] Add "Passkeys" section to Settings page
- [ ] Wire up "Add Passkey" button + passkey list + remove action
- [ ] Handle errors: user cancellation, timeout, unsupported browser

**Verification**: Can register a passkey in Settings; passkey appears in list; can remove it.

### Stage 3 — Login Page Integration *(~1 day)*
- **Dependency note:** depends on Stages 1–2 (`loginWithPasskey()` + routes), and on the **Session-Auth plan's MFA flow** (PLAN-001 Phase 3) for the `{ mfaRequired: true }` transition. Risk if skipped: the login button has no handler and the MFA handoff has no challenge flow to enter.

- [ ] Add "Sign in with Passkey" button to `Login.tsx` above the password form
- [ ] Wire button to `loginWithPasskey()`
- [ ] Handle MFA: if passkey login returns `{ mfaRequired: true }`, transition to existing MFA flow
- [ ] On success: store JWT token, navigate to landing page (same as password flow)
- [ ] Handle errors gracefully: show error message, fallback to password form
- [ ] Add `autocomplete="username webauthn"` to email field

**Verification**: Full login with passkey works; MFA prompt appears if enabled; password login continues to work.

### Stage 4 — Conditional UI & Polish *(~0.5 day)*
- **Dependency note:** depends on Stage 3 (the visible email field + login button the conditional UI augments). Risk if Stage 3 is skipped: conditional mediation has no login surface to attach to and cannot complete a session.

- [ ] Trigger conditional mediation on page load when email field is visible
- [ ] If conditional UI succeeds → complete login silently
- [ ] Add loading states, spinner on "Sign in with Passkey" button
- [ ] End-to-end test: passkey login, MFA, password fallback, all three paths
- [ ] Cross-browser smoke test (Chrome, Edge, Firefox, Safari)

**Verification**: Returning user with passkey sees browser autofill prompt on the login page without clicking anything.

---

## 12. Rollback Plan

Passkey authentication is entirely **additive** — it introduces a parallel path without modifying or removing the existing password + MFA login. Rollback can be executed incrementally with zero user impact.

### 12.1 Rollback Levels

| Level | Action | User Impact | Recovery Time |
|---|---|---|---|
| **Level 1 — Hide passkey UI** | Feature-flag the passkey button in `Login.tsx` and Settings; all routes remain active but unreachable | None — users see only password login | < 5 min |
| **Level 2 — Disable passkey routes** | Wrap passkey route registration with env flag `PASSKEY_ENABLED=false`; routes return 404 | Passkey users must use password; no data loss | < 5 min |
| **Level 3 — Full server rollback** | Revert `auth.ts` changes, remove passkey routes, keep DB table | Passkey users must use password; existing passkey data preserved for re-enable | < 30 min |
| **Level 4 — DB rollback** | Drop `PasskeyCredential` table via migration or `prisma db push` with model removed | All passkeys deleted — users must re-register after re-deploy | < 1 hour |

### 12.2 Feature Flag Architecture

All passkey functionality is gated by a single env variable:

```env
# apps/api/.env
PASSKEY_ENABLED=true   # set to "false" to disable all passkey routes + UI hints
```

**Server** (`auth.ts`):
```ts
if (process.env.PASSKEY_ENABLED !== "false") {
  authRouter.post("/passkey/register/begin", authenticate, …);
  authRouter.post("/passkey/register/complete", authenticate, …);
  authRouter.post("/passkey/authenticate/begin", …);
  authRouter.post("/passkey/authenticate/complete", …);
  authRouter.get("/passkey", authenticate, …);
  authRouter.delete("/passkey/:credentialId", authenticate, …);
}
```

**Client** (`Login.tsx` / Settings):
```ts
const passkeyEnabled = import.meta.env.VITE_PASSKEY_ENABLED !== "false";
// Only show passkey UI when enabled
```

### 12.3 Rollback Procedure (Step by Step)

1. **Assess severity**: Is the issue cosmetic (bad UX), partial (some users), or critical (no one can log in)?
2. **Level 1** — Set `VITE_PASSKEY_ENABLED=false` → redeploy frontend → passkey buttons hidden. Password login fully functional.
3. **Level 2** — Additionally set `PASSKEY_ENABLED=false` on API → redeploy backend → passkey routes return 404. No credential data lost.
4. **Level 3** — Revert `auth.ts` to pre-passkey state (keep from git). Remove passkey route registration block. Keep DB table.
5. **Level 4** — Only if passkey data must be purged: rollback Prisma migration or delete `PasskeyCredential` model and re-push.

### 12.4 Data Preservation

- `PasskeyCredential` table contains only public keys — no secrets, no passwords.
- Rollback Levels 1–3 preserve all passkey data. Users can resume using passkeys when re-enabled.
- Level 4 is a clean-slate only; re-enabling after Level 4 requires users to re-register passkeys.

### 12.5 Monitoring Before/After

| Metric | Before deploy | After deploy | Alert if |
|---|---|---|---|
| Login success rate | Baseline | Within 2% of baseline | > 5% drop |
| `/auth/login` 4xx rate | Baseline | Unchanged | Increase |
| `/auth/passkey/*` 4xx rate | N/A | < 10% | > 20% |
| `/auth/passkey/*` 5xx rate | N/A | 0 | > 0 for 5 min |
| Average login latency | Baseline | Within 200 ms | > 500 ms increase |

### 12.6 Known Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| RP ID mismatch between dev/prod | Medium | Env-configured; test in staging with prod-matching domain before production release |
| Browser silently fails conditional UI | Low | `isSupported` check + graceful fallback to password form |
| User registers passkey then clears platform authenticator | Medium | Multiple passkeys per user; password always available |
| @simplewebauthn version incompatibility with deployed browser base | Low | Pin exact version; test across Chrome/Firefox/Safari release channels |

---

## Revision History

| Date | Author | Change |
|---|---|---|
| 2026-08-09 | Kun | Initial plan |
