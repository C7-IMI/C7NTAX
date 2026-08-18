# C7NTAX — Session-Based Authentication & Permissions Implementation Plan

## Scope

Replace the current JWT-based auth with a secure session-based system modeled after enterprise PSA platforms (Autotask PSA, ConnectWise Manage, HaloPSA). All changes are incremental and preserve the existing API surface, frontend component tree, and navigation structure.

---

## 1. Database Schema Changes

### 1.1 New Models (add to `schema.prisma`)

```prisma
// ─── Tenant System Settings ─────────────────────────────────────────
// Replaces hardcoded timeout values. One row = one setting key/value.
// Mirrors Autotask's SystemSettings table.
model TenantSetting {
  id          String   @id @default(uuid())
  key         String   @unique   // e.g. "session.timeoutMinutes"
  value       String              // JSON-encoded or plain string
  category    String   @default("general")  // security, billing, display
  description String?
  updatedById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// ─── Enhanced Session ───────────────────────────────────────────────
// Extends existing Session model. Adds CSRF token, idle tracking.
// Aligned with ConnectWise Manage's session table (LoginHistory equivalent).
model UserSession {
  id           String   @id @default(uuid())
  sessionToken String   @unique   // HttpOnly cookie value (SHA-256 hash of server-side secret)
  csrfToken    String              // Sent to client as a readable cookie (not HttpOnly)
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  ipAddress    String?
  userAgent    String?
  lastActivityAt DateTime @default(now())  // Sliding window — updated on each authenticated request
  expiresAt    DateTime
  invalidatedAt DateTime?  // Set on logout or admin force-logout
  createdAt    DateTime @default(now())

  @@index([userId])
  @@index([sessionToken])
  @@index([lastActivityAt])
}

// ── Login Attempt Tracking (Brute-Force Protection) ────────────────
// Mirrors HaloPSA's LoginAttempt log.
model LoginAttempt {
  id          String   @id @default(uuid())
  email       String
  ipAddress   String?
  success     Boolean
  failureReason String?  // "invalid_password", "account_locked", "no_user"
  createdAt   DateTime @default(now())

  @@index([email, createdAt])
  @@index([ipAddress])
}

// ── Permission Override ────────────────────────────────────────────
// Per-user additive/restrictive permission overrides.
// Current User.permissions[] (flat string array) is replaced by explicit overrides.
model UserPermissionOverride {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  permission String   // e.g. "ticket:delete"
  grant     Boolean  @default(true)  // true=add, false=revoke

  @@unique([userId, permission])
}
```

### 1.2 Modifications to Existing Models

**User model** — add fields:
```prisma
model User {
  // ... existing fields ...
  isLocked        Boolean  @default(false)
  lockedUntil     DateTime?            // Auto-unlock timestamp
  failedLogins    Int      @default(0) // Consecutive failures (reset on success)
  passwordChangedAt DateTime?          // For password expiration policies
  sessions        UserSession[]       // Replace existing sessions relation
}
```

**Role model** — no changes needed. Existing `permissions String[]` field already provides role-level permissions.

### 1.3 Migration Path
- `prisma migrate dev --name session-auth` creates new tables
- Existing `Session` model can be dropped after migration (or kept for backward compat)
- `User.permissions[]` field retained for backward compat; `UserPermissionOverride` is additive

---

## 2. Backend Middleware & Controllers

### 2.1 Session Configuration Service (`services/sessionConfig.ts`)

Reads tenant settings from `TenantSetting` table with fallback defaults:

```typescript
// services/sessionConfig.ts
import { prisma } from "../index";

const DEFAULTS = {
  sessionTimeoutMinutes: 30,      // Aligned with Autotask default
  maxFailedLoginAttempts: 5,      // ConnectWise Manage default
  enforceIpRestrictions: false,   // HaloPSA default (off)
  lockoutDurationMinutes: 15,     // Auto-unlock after 15 min
  csrfTokenLength: 32,
};

export async function getSessionConfig() {
  const settings = await prisma.tenantSetting.findMany({
    where: { category: "security" },
  });
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;
  return {
    sessionTimeoutMs: (Number(map["session.timeoutMinutes"]) || DEFAULTS.sessionTimeoutMinutes) * 60 * 1000,
    maxFailedLogins: Number(map["session.maxFailedLogins"]) || DEFAULTS.maxFailedLoginAttempts,
    enforceIpRestrictions: map["session.enforceIpRestrictions"] === "true" || DEFAULTS.enforceIpRestrictions,
    lockoutDurationMs: (Number(map["session.lockoutDurationMinutes"]) || DEFAULTS.lockoutDurationMinutes) * 60 * 1000,
  };
}
```

### 2.2 Login Controller (`routes/auth.ts` — augment existing)

```typescript
// routes/auth.ts — add to existing authRouter

import { randomBytes, createHash } from "crypto";
import { getSessionConfig } from "../services/sessionConfig";

const SESSION_COOKIE = "c7_sid";
const CSRF_COOKIE = "c7_csrf";

// POST /api/auth/login — enhanced with brute-force protection
authRouter.post("/login", rateLimiter(5, 60_000), async (req, res, next) => {
  try {
    const { email, username, password } = req.body;
    const loginId = email || username;
    const config = await getSessionConfig();

    // 1. Check account lockout
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: loginId }, { username: loginId }],
      },
      include: { role: true },
    });
    if (!user) {
      await prisma.loginAttempt.create({ data: { email: loginId || "unknown", ipAddress: req.ip, success: false, failureReason: "no_user" } });
      // Use constant-time error to prevent user enumeration (Autotask standard)
      await delay(200);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    if (user.isLocked && user.lockedUntil && user.lockedUntil > new Date()) {
      res.status(423).json({ error: "Account locked", lockedUntil: user.lockedUntil });
      return;
    }

    // 2. Verify password
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const failures = user.failedLogins + 1;
      const updates: any = { failedLogins: failures };
      if (failures >= config.maxFailedLogins) {
        updates.isLocked = true;
        updates.lockedUntil = new Date(Date.now() + config.lockoutDurationMs);
      }
      await prisma.user.update({ where: { id: user.id }, data: updates });
      await prisma.loginAttempt.create({ data: { email: user.email, ipAddress: req.ip, success: false, failureReason: "invalid_password" } });
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    // 3. Reset failed counter on success (HaloPSA behavior)
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, isLocked: false, lockedUntil: null, lastLoginAt: new Date() },
    });

    // 4. Session ID rotation — invalidate old sessions (ConnectWise standard)
    await prisma.userSession.updateMany({
      where: { userId: user.id, invalidatedAt: null },
      data: { invalidatedAt: new Date() },
    });

    // 5. Create new session
    const sessionToken = createHash("sha256").update(randomBytes(64)).digest("hex");
    const csrfToken = randomBytes(32).toString("hex");
    const permissions = computeEffectivePermissions(user);

    await prisma.userSession.create({
      data: {
        sessionToken,
        csrfToken,
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] || null,
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + config.sessionTimeoutMs),
      },
    });

    await prisma.loginAttempt.create({ data: { email: user.email, ipAddress: req.ip, success: true } });

    // 6. Set cookies (HttpOnly, Secure, SameSite=Strict — PSA standard)
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
      path: "/",
      maxAge: config.sessionTimeoutMs,
    };
    res.cookie(SESSION_COOKIE, sessionToken, cookieOpts);
    res.cookie(CSRF_COOKIE, csrfToken, { ...cookieOpts, httpOnly: false }); // readable by JS

    res.json({
      user: sanitizeUser(user),
      permissions,
      expiresAt: new Date(Date.now() + config.sessionTimeoutMs),
    });
  } catch (e) { next(e); }
});

// POST /api/auth/logout
authRouter.post("/logout", authenticateSession, async (req, res) => {
  await prisma.userSession.updateMany({
    where: { userId: req.user!.userId, invalidatedAt: null },
    data: { invalidatedAt: new Date() },
  });
  res.clearCookie(SESSION_COOKIE);
  res.clearCookie(CSRF_COOKIE);
  res.json({ message: "Logged out" });
});
```

### 2.3 Session Middleware (`middleware/sessionAuth.ts`)

Replaces the current JWT `authenticate` middleware with session-based auth:

```typescript
// middleware/sessionAuth.ts
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../index";
import { getSessionConfig } from "../services/sessionConfig";

const SESSION_COOKIE = "c7_sid";
const CSRF_COOKIE = "c7_csrf";

export interface AuthRequest extends Request {
  user?: { userId: string; email: string; role: string; permissions: string[]; companyId: string | null };
  sessionId?: string;
}

/**
 * Authenticate via session cookie.
 * Also enforces: CSRF check, inactivity timeout, sliding expiration.
 */
export async function authenticateSession(req: AuthRequest, res: Response, next: NextFunction) {
  const sessionToken = req.cookies?.[SESSION_COOKIE];
  if (!sessionToken) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // CSRF check for mutating methods (ConnectWise standard)
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const csrfHeader = req.headers["x-csrf-token"] as string;
    const csrfCookie = req.cookies?.[CSRF_COOKIE];
    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
      res.status(403).json({ error: "CSRF token mismatch" });
      return;
    }
  }

  const session = await prisma.userSession.findUnique({
    where: { sessionToken },
    include: { user: { include: { role: true } } },
  });

  if (!session || session.invalidatedAt || session.expiresAt < new Date()) {
    res.clearCookie(SESSION_COOKIE);
    res.status(401).json({ error: "Session expired", code: "SESSION_EXPIRED" });
    return;
  }

  // Inactivity timeout check
  const config = await getSessionConfig();
  const idleMs = Date.now() - session.lastActivityAt.getTime();
  if (idleMs > config.sessionTimeoutMs) {
    await prisma.userSession.update({
      where: { id: session.id },
      data: { invalidatedAt: new Date() },
    });
    res.clearCookie(SESSION_COOKIE);
    res.status(401).json({ error: "Session expired due to inactivity", code: "SESSION_EXPIRED" });
    return;
  }

  // Sliding expiration — extend session (HaloPSA behavior)
  await prisma.userSession.update({
    where: { id: session.id },
    data: { lastActivityAt: new Date() },
  });

  req.user = {
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role.systemRole,
    permissions: computeEffectivePermissions(session.user),
    companyId: session.user.companyId,
  };
  req.sessionId = session.id;
  next();
}

// Keep old JWT authenticate as fallback alias for backward compat
export { authenticateSession as authenticate };
```

### 2.4 Permission Middleware (no changes needed)
The existing `requirePermission(...permissions: Permission[])` function works identically — it checks `req.user.permissions` which is populated by the new session middleware.

### 2.5 Admin Settings API (`routes/system.ts` — augment)

```typescript
// GET /api/system/security-settings
systemRouter.get("/security-settings", requirePermission(Permission.SystemConfig), async (req, res) => {
  const settings = await prisma.tenantSetting.findMany({ where: { category: "security" } });
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;
  res.json({
    sessionTimeoutMinutes: Number(map["session.timeoutMinutes"]) || 30,
    maxFailedLogins: Number(map["session.maxFailedLogins"]) || 5,
    enforceIpRestrictions: map["session.enforceIpRestrictions"] === "true",
    lockoutDurationMinutes: Number(map["session.lockoutDurationMinutes"]) || 15,
  });
});

// PUT /api/system/security-settings
systemRouter.put("/security-settings", requirePermission(Permission.SystemConfig), async (req, res) => {
  const { sessionTimeoutMinutes, maxFailedLogins, enforceIpRestrictions, lockoutDurationMinutes } = req.body;
  const entries = [
    { key: "session.timeoutMinutes", value: String(sessionTimeoutMinutes || 30) },
    { key: "session.maxFailedLogins", value: String(maxFailedLogins || 5) },
    { key: "session.enforceIpRestrictions", value: String(enforceIpRestrictions || false) },
    { key: "session.lockoutDurationMinutes", value: String(lockoutDurationMinutes || 15) },
  ];
  for (const e of entries) {
    await prisma.tenantSetting.upsert({
      where: { key: e.key },
      create: { key: e.key, value: e.value, category: "security" },
      update: { value: e.value },
    });
  }
  res.json({ message: "Security settings updated" });
});
```

---

## 3. Frontend Components

### 3.1 Auth Context — Session-Aware (`hooks/useAuth.tsx`)

```typescript
// hooks/useAuth.tsx — replace current JWT-based auth with session-aware version
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "../api";

interface AuthState {
  user: User | null;
  permissions: string[];
  loading: boolean;
  login: (email: string, password: string) => Promise<{ mfaRequired?: boolean }>;
  logout: (reason?: string) => void;
  hasPermission: (perm: string) => boolean;
  refreshSession: () => Promise<void>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // On mount: check if session cookie is still valid
  const refreshSession = useCallback(async () => {
    try {
      const res = await api.get("/auth/session");
      setUser(res.data.user);
      setPermissions(res.data.permissions);
    } catch {
      setUser(null);
      setPermissions([]);
    }
  }, []);

  useEffect(() => { refreshSession().finally(() => setLoading(false)); }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post("/auth/login", { email, password });
    if (res.data.mfaRequired) return { mfaRequired: true };
    setUser(res.data.user);
    setPermissions(res.data.permissions);
    return {};
  }, []);

  const logout = useCallback(async (reason?: string) => {
    try { await api.post("/auth/logout"); } catch {}
    setUser(null);
    setPermissions([]);
    const params = reason ? `?reason=${encodeURIComponent(reason)}` : "";
    window.location.replace(`/login${params}`);
  }, []);

  const hasPermission = useCallback((perm: string) => permissions.includes(perm), [permissions]);

  return (
    <AuthContext.Provider value={{ user, permissions, loading, login, logout, hasPermission, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}
```

### 3.2 Activity Monitor Hook (`hooks/useActivityMonitor.ts`)

```typescript
// hooks/useActivityMonitor.ts
// Aligned with Autotask's automatic session expiry (inactivity timeout).
import { useEffect, useRef, useState, useCallback } from "react";

interface UseActivityMonitorOptions {
  timeoutMs: number;          // e.g., sessionConfig.sessionTimeoutMs
  warningBeforeMs: number;    // e.g., 60_000 (warn 1 min before)
  onTimeout: () => void;      // Called when timeout fires
}

export function useActivityMonitor({ timeoutMs, warningBeforeMs, onTimeout }: UseActivityMonitorOptions) {
  const [showWarning, setShowWarning] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
  }, []);

  useEffect(() => {
    const events = ["mousedown", "keydown", "scroll", "touchstart", "mousemove"];
    const handler = () => resetTimer();
    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, handler));
  }, [resetTimer]);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle >= timeoutMs) {
        onTimeout();
      } else if (idle >= timeoutMs - warningBeforeMs) {
        setShowWarning(true);
      }
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [timeoutMs, warningBeforeMs, onTimeout]);

  return { showWarning, resetTimer };
}
```

### 3.3 Timeout Warning Modal (`components/SessionTimeoutWarning.tsx`)

```typescript
// components/SessionTimeoutWarning.tsx
// HaloPSA-style "Session Expiring" modal with countdown.
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

export function SessionTimeoutWarning({ onExtend, onLogout, visible }: {
  onExtend: () => void;
  onLogout: () => void;
  visible: boolean;
}) {
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    if (!visible) { setCountdown(60); return; }
    const timer = setInterval(() => {
      setCountdown(p => { if (p <= 1) { onLogout(); return 0; } return p - 1; });
    }, 1000);
    return () => clearInterval(timer);
  }, [visible, onLogout]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="card w-full max-w-md mx-4 space-y-4">
        <div className="flex items-center gap-3">
          <Clock size={24} className="text-amber-400" />
          <h2 className="text-lg font-semibold text-white">Session Expiring</h2>
        </div>
        <p className="text-sm text-gray-400">
          Your session will expire in <span className="text-amber-400 font-bold">{countdown}s</span> due to inactivity.
          Click "Stay Logged In" to continue.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onLogout} className="btn-secondary">Logout Now</button>
          <button onClick={onExtend} className="btn-primary">Stay Logged In</button>
        </div>
      </div>
    </div>
  );
}
```

### 3.4 Protected Route Wrapper (`components/ProtectedRoute.tsx`)

```typescript
// components/ProtectedRoute.tsx
// Hides entire routes from users lacking permissions.
// Wraps existing page components. Non-breaking addition.
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function ProtectedRoute({ children, permission }: {
  children: React.ReactNode;
  permission?: string;
}) {
  const { user, loading, hasPermission } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (permission && !hasPermission(permission)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

### 3.5 Admin Security Settings Page (`pages/SecuritySettings.tsx`)

```typescript
// pages/SecuritySettings.tsx
// Route: /admin/system → Security tab (existing SystemSettings page, new tab)
// Matches Autotask's Admin → Security Settings layout.
import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Shield, Clock, Lock, Globe } from "lucide-react";

export function SecuritySettingsTab() {
  const [form, setForm] = useState({
    sessionTimeoutMinutes: 30,
    maxFailedLogins: 5,
    enforceIpRestrictions: false,
    lockoutDurationMinutes: 15,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/system/security-settings")
      .then(r => setForm(r.data))
      .catch(() => toast.error("Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    try {
      await api.put("/system/security-settings", form);
      toast.success("Security settings saved");
    } catch { toast.error("Failed to save"); }
  };

  if (loading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Security Settings</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field icon={Clock} label="Session Inactivity Timeout (minutes)"
          value={form.sessionTimeoutMinutes}
          onChange={v => setForm(p => ({ ...p, sessionTimeoutMinutes: Number(v) }))}
          type="number" min={5} max={480} />
        <Field icon={Lock} label="Maximum Failed Login Attempts"
          value={form.maxFailedLogins}
          onChange={v => setForm(p => ({ ...p, maxFailedLogins: Number(v) }))}
          type="number" min={3} max={20} />
        <Field icon={Clock} label="Account Lockout Duration (minutes)"
          value={form.lockoutDurationMinutes}
          onChange={v => setForm(p => ({ ...p, lockoutDurationMinutes: Number(v) }))}
          type="number" min={5} max={1440} />
        <label className="flex items-center gap-3 card p-4 cursor-pointer">
          <Globe size={18} className="text-cyber-400" />
          <div className="flex-1">
            <p className="text-sm text-white">Enforce IP Address Restrictions</p>
            <p className="text-xs text-gray-500">Require sessions to originate from the same IP</p>
          </div>
          <input type="checkbox" checked={form.enforceIpRestrictions}
            onChange={e => setForm(p => ({ ...p, enforceIpRestrictions: e.target.checked }))}
            className="rounded" />
        </label>
      </div>

      <button onClick={save} className="btn-primary">Save Security Settings</button>
    </div>
  );
}
```

---

## 4. Integration Points with Existing App

### 4.1 Routes — No Changes Needed
- `/admin/system` already renders `SystemSettingsPage` with a tab for "Security"
- Add `<SecuritySettingsTab />` as the "security" tab content

### 4.2 Navigation — No Changes Needed
- Administration → System Settings → Security tab (existing structure)

### 4.3 Backward Compatibility
- Old JWT `authenticate` function re-exported as `authenticateLegacy` — routes can migrate incrementally
- Existing `requirePermission()` middleware works unchanged with session-based `req.user`
- All existing API routes remain functional

### 4.4 Activity Monitor Integration
- Add `<SessionTimeoutWarning />` and `useActivityMonitor` to the `<Layout>` component
- The hook reads `sessionTimeoutMs` from the login response or a `/auth/session` endpoint

---

## 5. Session Timeout Rules & Rollback Strategy

### 5.1 Timeout Behavior

| Account Type | Default Timeout | Override |
|---|---|---|
| **Admin** (`systemRole: "admin"`) | No timeout (infinite session) | Not configurable — enforced by middleware |
| **All other roles** | 30 minutes inactivity | Configurable via tenant setting `session.timeoutMinutes` |

**Middleware enforcement logic** (`middleware/inactivity.ts`):
```typescript
// Pseudocode for inactivity check in session middleware
if (req.user.role === "admin") {
  // Admin sessions never expire — skip inactivity check entirely.
  // Only invalidated by explicit logout or server restart.
  return next();
}

const config = await getSessionConfig();           // reads TenantSetting
const timeoutMs = config.sessionTimeoutMs;          // default 30 min
const idleMs = Date.now() - session.lastActivityAt.getTime();
if (idleMs > timeoutMs) {
  await invalidateSession(session.id);
  res.clearCookie(SESSION_COOKIE);
  res.status(440).json({ error: "Session expired due to inactivity", code: "SESSION_TIMEOUT" });
  return;
}
// Extend sliding window
await updateLastActivity(session.id);
next();
```

### 5.2 Why Admin Has No Timeout (PSA Standard Rationale)
- **Autotask PSA**: Global Admin accounts bypass session timeouts to avoid interruption during long-running administrative tasks (bulk imports, report generation, system configuration).
- **ConnectWise Manage**: Admin-level users are exempt from idle timeout policies.
- **HaloPSA**: System administrators have perpetual sessions; only explicit logout or password change terminates them.

### 5.3 Per-User MFA Override Field
Add to `User` model:
```prisma
model User {
  // ... existing ...
  mfaEnabled        Boolean  @default(false)  // already exists — keep
  mfaEnforced       Boolean  @default(false)  // NEW: if true, MFA is mandatory regardless of system setting
  mfaBypassUntil    DateTime?                  // NEW: temp bypass (e.g., trusted device for 30 days)
  mfaPreferredMethod String? @default("totp")  // NEW: "totp" | "email" | "sms"
  mfaSmsPhone       String?                    // NEW: phone number for SMS delivery
}
```

### 5.4 Rollback Strategy
All changes are implemented behind feature flags and can be individually reverted:

| Component | Rollback Method |
|---|---|
| **Session cookies** | Middleware checks for `Authorization: Bearer` header as fallback; setting env `AUTH_MODE=jwt` switches back to JWT-only |
| **Inactivity timeout** | Setting `session.timeoutMinutes=0` disables timeout globally; per-role check is a single `if` branch |
| **Admin exemption** | Hardcoded `role === "admin"` check — if problematic, remove the `if` block and all users get the same timeout |
| **MFA** | `User.mfaEnforced` default is `false`; system tenant setting `mfa.required` default is `false`; both must be true for enforcement |
| **Full rollback** | Run `git revert <commit>` for the auth-migration branch, restart servers — zero data loss (all new tables are additive) |

---

## 6. Multi-Factor Authentication (MFA)

### 6.1 MFA Methods — Modeled After PSA Leaders

| Method | Autotask | ConnectWise | HaloPSA | C7NTAX Implementation |
|---|---|---|---|---|
| **TOTP Authenticator App** | ✓ (Google Authenticator, Microsoft Authenticator) | ✓ | ✓ | Use `otplib` for TOTP generation/validation; store `mfaSecret` (existing field) |
| **Email Code** | ✓ (6-digit code to registered email) | ✓ | ✓ | Generate 6-digit code, store hashed with 5-min expiry in `mfaEmailCode` / `mfaEmailCodeExpires` (existing fields) |
| **SMS** | ✓ (Twilio integration) | ✓ | ✓ | New field `mfaSmsPhone`; integrate SMS provider (Twilio or generic HTTP API) |

### 6.2 System-Level MFA Configuration

**Tenant Settings** (`category: "mfa"`):
| Key | Type | Default | Description |
|---|---|---|---|
| `mfa.required` | boolean | `false` | If true, ALL non-admin users MUST enroll MFA |
| `mfa.adminRequired` | boolean | `false` | If true, admin accounts also require MFA |
| `mfa.allowedMethods` | string[] | `["totp","email","sms"]` | Which methods are available system-wide |
| `mfa.codeLength` | number | `6` | Digits in email/SMS codes |
| `mfa.codeExpiryMinutes` | number | `5` | Email/SMS code validity window |
| `mfa.rememberDeviceDays` | number | `30` | If 0, "remember this device" is disabled |

### 6.3 Per-User MFA Settings

**User Edit Screen** (`pages/Users.tsx` — User Detail panel):
| Field | Type | Description |
|---|---|---|
| MFA Enabled | Toggle | Enables/disables MFA for this specific user |
| MFA Enforced | Toggle | If on, user cannot disable MFA (overrides system setting) |
| Preferred Method | Dropdown | `totp`, `email`, `sms` (filtered by `mfa.allowedMethods`) |
| SMS Phone | Input | Required if preferred method is `sms` |
| Reset MFA | Button | Clears TOTP secret, backup codes; forces re-enrollment |
| Generate Backup Codes | Button | Issues 10 one-time-use recovery codes |

### 6.4 Login Flow with MFA (Dynamic Prompt)

```
User enters credentials
    ↓
POST /api/auth/login { email, password }
    ↓
Credentials valid?
    ├─ No  → 401 "Invalid credentials"
    └─ Yes → Check MFA status
              ├─ MFA NOT enabled for user
              │     → Create session, return cookies + user data
              │
              └─ MFA IS enabled
                    → Return { mfaRequired: true, mfaToken: "<short-lived-token>",
                               methods: ["totp", "email"], preferred: "totp" }
                    → Frontend shows MFA prompt (NOT the login form)
```

**MFA prompt on login screen** — the `LoginPage` component conditionally renders:
```tsx
// LoginPage.tsx — pseudocode
function LoginPage() {
  const [step, setStep] = useState<"credentials" | "mfa">("credentials");
  const [mfaToken, setMfaToken] = useState("");
  const [methods, setMethods] = useState<string[]>([]);

  const handleLogin = async (email, password) => {
    const res = await api.post("/auth/login", { email, password });
    if (res.data.mfaRequired) {
      setMfaToken(res.data.mfaToken);
      setMethods(res.data.methods);
      setStep("mfa");        // ← Switches to MFA code input without page reload
    } else {
      onLoginSuccess(res.data);
    }
  };

  const handleMfaSubmit = async (code, method) => {
    const res = await api.post("/auth/verify-mfa", { mfaToken, code, method });
    onLoginSuccess(res.data);
  };

  return step === "credentials" ? (
    <LoginForm onSubmit={handleLogin} />
  ) : (
    <MfaPrompt mfaToken={mfaToken} methods={methods} onSubmit={handleMfaSubmit} />
  );
}
```

### 6.5 MFA Enrollment Flow

```
User navigates to /settings/security or Admin edits user
    ↓
POST /api/auth/mfa/enroll { method: "totp" }
    → Returns { secret: "JBSWY3DPEHPK3PXP", qrCodeUrl: "otpauth://..." }
    → Frontend shows QR code + manual entry key
    ↓
User scans QR, enters TOTP code
    ↓
POST /api/auth/mfa/verify-enrollment { method: "totp", code: "123456" }
    → Validates code, stores mfaSecret, sets mfaEnabled=true
    → Returns backup codes to display once
```

### 6.6 Admin MFA Management UI

Admin can override MFA for any user from the Manage Users page:
- **Disable MFA** button (with confirmation modal: "This will remove MFA protection for this user. Continue?") — aligned with Autotask admin override
- **Reset MFA** button — forces re-enrollment on next login (ConnectWise standard)
- **View MFA Status** — badge shows: "Enabled (TOTP)", "Enabled (Email)", "Disabled", "Enforced"

---

## 7. Implementation Phases (Extended)

### Phase 1: Foundation (Session Infrastructure)
- Add `TenantSetting`, `UserSession`, `LoginAttempt`, `UserPermissionOverride` models
- Create `sessionAuth.ts` middleware alongside existing JWT auth
- Add `User.mfaEnforced`, `User.mfaPreferredMethod`, `User.mfaSmsPhone` columns
- **Rollback**: `git revert` — new tables deleted, no data loss
- **Dependency note:** no prerequisites — this is the foundation all other phases build on. Skipping it blocks Phases 2–6 (no `UserSession` table for the middleware, no `mfaEnforced`/`mfaPreferredMethod`/`mfaSmsPhone` columns for MFA logic).

### Phase 2: Session Timeout & Admin Exemption
- Implement inactivity check in session middleware
- Admin bypass logic (`role === "admin"` → skip timeout)
- Tenant setting `session.timeoutMinutes` configurable via admin UI
- Activity monitor hook on frontend with warning modal
- **Rollback**: Set env `SESSION_TIMEOUT_ENABLED=false`; middleware skips timeout check
- **Dependency note:** depends on Phase 1 (`sessionAuth.ts` middleware + `UserSession` model + `TenantSetting` storage). Risk if skipped: timeout check has no middleware to attach to and the `session.timeoutMinutes` setting has no table to live in; the activity-monitor hook would call endpoints that don't exist.

### Phase 3: MFA — TOTP (Authenticator App)
- Build on existing `mfaSecret`, `mfaEnabled` fields
- Create `/api/auth/mfa/enroll`, `/api/auth/mfa/verify-enrollment` endpoints
- Update login flow to check MFA status and return `mfaRequired` + challenge token
- Dynamic MFA prompt on login screen
- **Rollback**: Set tenant setting `mfa.required=false`; all users bypass MFA
- **Dependency note:** depends on Phase 1 (`mfaEnforced`/`mfaPreferredMethod` columns) and Phase 2 (tenant settings plumbing). Risk if skipped: the login flow has no columns to read, so `mfaRequired` challenges can never be produced and Phases 4–5 have no dynamic MFA prompt to add methods to.

### Phase 4: MFA — Email Codes
- Use existing `mfaEmailCode`, `mfaEmailCodeExpires` fields
- Send 6-digit code via configured email provider (`@C7NTAX/email` package)
- Add email method to login MFA prompt
- **Rollback**: Remove `"email"` from `mfa.allowedMethods` tenant setting
- **Dependency note:** depends on Phase 3 (dynamic MFA prompt + `mfa.allowedMethods` mechanism) and the existing `@C7NTAX/email` provider. Risk if Phase 3 is skipped: email codes have no prompt to appear in and no method-selection config to gate them; users would never see the email option.

### Phase 5: MFA — SMS
- Add `User.mfaSmsPhone` column
- Integrate SMS provider (Twilio SDK or generic HTTP webhook)
- Add SMS method to login MFA prompt
- **Rollback**: Remove `"sms"` from `mfa.allowedMethods` tenant setting
- **Dependency note:** depends on Phase 3 (MFA prompt/method config). Note: the `User.mfaSmsPhone` column is already added in Phase 1 — Phase 5 only adds the SMS provider integration and prompt wiring. Risk if Phase 3 is skipped: SMS has no prompt/method plumbing to attach to.

### Phase 6: Admin MFA Management UI
- Admin user detail panel: MFA status, disable/reset buttons
- System settings → Security → MFA tab with all tenant-level configs
- Audit log entries for MFA changes
- **Rollback**: UI components are additive; removing them leaves no broken functionality
- **Dependency note:** depends on Phases 3–5 (MFA status fields, enroll/reset endpoints, and method configs the panel displays/edits) and Phase 2 (system settings page plumbing). Risk if skipped: the admin panel would render MFA controls against endpoints that don't exist, and reset/disable actions would 404.

### Phase 7: Hardening & Edge Cases
- Backup/recovery codes for MFA (one-time use, 10 codes per user)
- "Remember this device" — trusted device cookie bypasses MFA for N days
- Rate limiting on MFA code attempts (3 failures = lockout for 5 minutes)
- **Rollback**: All features controlled by tenant settings; set to `false`/`0` to disable

---

## 8. Rollback Commands (Quick Reference)

```bash
# Full rollback — restore pre-implementation state
git revert <session-auth-commit-range>
pnpm prisma migrate reset    # rolls back schema changes
pnpm db:seed-full             # re-seeds from original fixtures

# Partial rollback — disable MFA only
psql -c "INSERT INTO \"TenantSetting\" (key, value, category) VALUES ('mfa.required', 'false', 'mfa') ON CONFLICT (key) DO UPDATE SET value='false'"

# Partial rollback — disable timeout only
psql -c "UPDATE \"TenantSetting\" SET value='0' WHERE key='session.timeoutMinutes'"

# Partial rollback — switch to JWT auth
export AUTH_MODE=jwt
```

---

## 9. CloudConnect Integration Compatibility

All 16 CloudConnect integrations must continue to function after the session auth migration. Each integration uses its own credential store (stored in the `Integration` table's `credentials` JSON field) and authenticates to third-party APIs independently — **not** via the C7NTAX user session. This section documents each integration's auth mechanism and confirms session compatibility.

### 9.1 Integration Authentication Methods (All 16)

| # | Integration | Auth Method | Credentials Stored | Session Impact |
|---|---|---|---|---|
| 1 | **Microsoft 365** | OAuth 2.0 client_credentials (tenantId, clientId, clientSecret → access token) | `tenantId`, `clientId`, `clientSecret` | None — uses its own OAuth token, not user session |
| 2 | **AutoTask PSA** | HTTP Basic + API integration code headers | `username`, `password`, `integrationCode` | None — sends `UserName`, `Secret`, `ApiIntegrationCode` headers per AutoTask REST API spec |
| 3 | **ConnectWise PSA** | HTTP Basic (companyId+publicKey:privateKey) | `companyId`, `publicKey`, `privateKey`, `clientId`, `baseUrl` | None — `Authorization: Basic base64(companyId+publicKey:privateKey)` per ConnectWise REST API |
| 4 | **HaloPSA** | OAuth 2.0 client_credentials (clientId, clientSecret → access token) | `tenantUrl`, `clientId`, `clientSecret` | None — obtains its own bearer token via `/auth/token` endpoint |
| 5 | **Kantata** | Bearer token (accessToken) | `accessToken` | None — `Authorization: Bearer {accessToken}` per Kantata REST API |
| 6 | **Scoro** | API key + company account ID in JSON-RPC body | `apiKey`, `companyAccountId` | None — sends `apiKey` and `company_account_id` in request payload per Scoro RPC spec |
| 7 | **Flexpoint Payments** | API key header | `apiKey`, `baseUrl` | None — `x-api-key: {apiKey}` header |
| 8 | **QuickBooks Online** | OAuth 2.0 (clientId, clientSecret, realmId, accessToken with refresh) | `clientId`, `clientSecret`, `realmId`, `accessToken` | None — uses Intuit OAuth token, supports refresh via `refreshAccessToken()` |
| 9 | **Pax8** | API key header | `apiKey`, `baseUrl` | None — `Authorization: Bearer {apiKey}` per Pax8 API |
| 10 | **Avanan** | API key header | `apiKey`, `baseUrl` | None — `x-api-key: {apiKey}` header |
| 11 | **Proofpoint** | HTTP Basic (principal:secret) | `principal`, `secret`, `baseUrl` | None — `Authorization: Basic base64(principal:secret)` per Proofpoint SIEM API |
| 12 | **SentinelOne** | API token header | `apiToken`, `baseUrl` | None — `Authorization: ApiToken {apiToken}` per S1 API |
| 13 | **ITGlue** | API key header | `apiKey`, `baseUrl` | None — `x-api-key: {apiKey}` per ITGlue API |
| 14 | **Azure** | Bearer token (accessToken) | `accessToken`, `subscriptionId` | None — `Authorization: Bearer {accessToken}` per Azure ARM API |
| 15 | **AWS** | Access key + secret key (AWS Signature V4) | `accessKeyId`, `secretAccessKey`, `region` | None — uses AWS SDK credential chain |
| 16 | **Azure AD SSO** | SAML 2.0 / OpenID Connect federation | `tenantId`, `clientId` | None — handles its own OIDC/SAML flow; generates SAML metadata and login URLs server-side |

### 9.2 Key Architecture Principle

**Integration credentials are NEVER derived from or linked to user sessions.** Each integration stores its own credentials in the `Integration.credentials` JSON column. The `IntegrationHub` adapter classes read credentials directly from the database and use them to authenticate with third-party APIs. This is the same pattern used by Autotask PSA's "Extensions & Integrations" module and ConnectWise Manage's "Setup Tables" → "Integrator Login" pattern.

### 9.3 Sync & Test Connection — Session Independence

The CloudConnect routes (`/api/cloudconnect/*`) currently use the existing `authenticate` (JWT) middleware. After migration, they switch to `authenticateSession` (cookie). This change is transparent because:

1. **Test Connection** (`POST /api/cloudconnect/:id/test`) — The middleware only validates the C7NTAX user has permission to trigger the test. The actual API call to the third-party service uses the integration's stored credentials, not the user's session.

2. **Sync** (`POST /api/cloudconnect/:id/sync`) — Same pattern. The user's session authorizes the sync trigger; the adapter's credentials authorize the third-party API call.

3. **CRUD operations** (create/update/delete integration) — Session middleware validates user permissions (`integration:manage`). The credentials are stored in the database independently.

### 9.4 Integration-Specific Notes

**OAuth 2.0 integrations (Microsoft 365, HaloPSA, QuickBooks Online):**
- These adapters implement `refreshAccessToken()` which may update the stored `credentials.accessToken` field via `persistCredentials()`.
- This write-back to the `Integration` table is triggered by the sync process, not by user session activity.
- No session migration impact — the `persistCredentials()` helper calls `prisma.integration.update()` directly.

**SAML/OIDC integrations (Azure AD SSO):**
- The `AzureADSSOAdapter` generates SAML metadata URLs and OIDC redirect URIs server-side.
- These are served as configuration endpoints consumed by Azure AD, not by the C7NTAX user session.
- No session migration impact.

**API key/basic auth integrations (remaining 12):**
- All use static credential headers or auth parameters.
- No token refresh, no session dependency.
- Transparent migration.

### 9.5 Required Code Changes (Minimal)

| File | Change |
|---|---|
| `routes/cloudconnect.ts` | Replace `import { authenticate }` with `import { authenticateSession }` |
| `routes/cloudconnect.ts` | Replace `cloudConnectRouter.use(authenticate)` with `cloudConnectRouter.use(authenticateSession)` |
| No other files | All adapter code, credential storage, and sync/test logic remain unchanged |

### 9.6 Verification Checklist

- [ ] Test Connection works for all 16 integrations after session auth migration
- [ ] Sync triggers and completes without 401/403 errors
- [ ] OAuth token refresh (Microsoft 365, HaloPSA, QuickBooks) continues to update stored credentials
- [ ] Azure AD SSO metadata endpoints respond correctly
- [ ] Integration CRUD (create, update, delete) respects RBAC via session permissions
- [ ] Long-running syncs do not time out the user's session (sync runs server-side)

---

## 5. Implementation Order (Phased, Non-Breaking)

| Phase | Task | Impact |
|---|---|---|
| **1** | Add `TenantSetting`, `UserSession`, `LoginAttempt`, `UserPermissionOverride` models to Prisma schema | Zero impact on existing code |
| **2** | Create `sessionAuth.ts` middleware; keep old JWT middleware as `authenticateLegacy` | New routes can opt in; existing routes unchanged |
| **3** | Update `/api/auth/login` to support session cookies alongside JWT | Both auth methods work simultaneously |
| **4** | Add `useActivityMonitor.ts`, `SessionTimeoutWarning.tsx`, `ProtectedRoute.tsx` | New components; existing pages unchanged |
| **5** | Create admin security settings UI page & API endpoints | New feature; no existing feature affected |
| **6** | Migrate frontend `useAuth.tsx` to session-based flow | Requires browser cookie support; JWT fallback preserved |
| **7** | Gradually migrate API routes from JWT to session auth | One route at a time to prevent regressions |

### Phase Execution Dependency Graph

```
Phase 1 (Schema)
    ↓
Phase 2 (Session Auth Middleware — dual JWT + cookie)
    ↓
    ├── Phase 3 (Timeout + Admin Exemption)
    │       ↓
    │   Phase 5 (MFA TOTP)
    │       ↓
    │   Phase 6 (MFA Email SMS)
    │       ↓
    │   Phase 7 (Admin UI)
    │
    └── Phase 4 (Frontend Migration — useActivityMonitor, SessionTimeoutWarning, ProtectedRoute)
            ↓
        Phase 8 (Route Migration — incrementally switch routes from JWT to session)
```
