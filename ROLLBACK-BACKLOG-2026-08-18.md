# Backlog Rollback Guide — 2026-08-18 (12 deployable items)

Scope: the 12 now-deployable backlog items implemented 2026-08-18 (`PLAN-C7NTAX-Now-Deployable-Backlog.md`).

## Global safety rails
- Every item ships behind its own flag (listed per item) or is purely additive; flags default **off** where behavior-changing.
- All new Prisma models are additive (no destructive migrations). `db push` was used (dev).
- **Roll back the entire set as one unit:** set all flags off, then `git checkout` the changed files if under VCS, else delete the new files and models listed below; finally `pnpm --filter api exec prisma db push` to drop new tables and restart via `startup/c7ntax-boot.ps1`.
  - Flags: `QUOTES_ENABLED`, `BILLING_FROM_TICKETS_ENABLED`, `UPTIME_MONITORS_ENABLED`, `ALERT_WEBHOOKS_ENABLED`, `AI_ACTIONS_ENABLED`, `SSO_ENABLED`, `PASSKEY_ENABLED`, `OUTLOOK_ADDIN_ENABLED`, `EMAIL_GRAPH_ENABLED`, `PUSH_ENABLED`, `AUTH_HARDENING_ENABLED`, `UI_MODERN_ENABLED`.

## Per-item rollback
1. **Quotes** — drop `QuoteLineItem`, `Quote`; remove `routes/quotes.ts`, `QuotesPage.tsx`; unmount `/api/quotes`; flag `QUOTES_ENABLED`.
2. **Billing generate-from-tickets** — remove endpoint from `billing.ts` + FinanceDashboard button; flag `BILLING_FROM_TICKETS_ENABLED`.
3. **Website/SSL/DNS monitors** — remove new monitor-kind columns from `ServiceAlertService`/`alertMonitor.ts`, `MonitorsPage.tsx`; flag `UPTIME_MONITORS_ENABLED`.
4. **Alert webhooks** — remove webhook delivery worker + `routes/alertWebhooks.ts`, `WebhooksPage.tsx`; drop `AlertWebhookDelivery`; flag `ALERT_WEBHOOKS_ENABLED`.
5. **AI actions** — drop `AiAction` + `AiActionAudit`; remove `routes/aiActions.ts`, `AiActionsPage.tsx`; flag `AI_ACTIONS_ENABLED`.
6. **SSO** — remove `routes/auth/ssoExchange.ts` mount + Login SSO button; no new tables; flag `SSO_ENABLED`.
7. **Passkey** — drop `WebauthnCredential`; remove `routes/auth/webauthn.ts` + Login button; flag `PASSKEY_ENABLED`; uninstall `@simplewebauthn/server` if unused.
8. **Outlook add-in** — remove `routes/outlookAddin.ts`, `public/outlook-manifest.xml` + taskpane asset; flag `OUTLOOK_ADDIN_ENABLED`.
9. **M365 Graph transport** — remove graph branch in `emailConnectorRuntime.ts` + `graphTransport.ts`; `EmailConnector.transport` column back to default `imap`; flag `EMAIL_GRAPH_ENABLED`.
10. **Mobile backend** — drop `PushDevice`; remove `routes/push.ts`; flag `PUSH_ENABLED`.
11. **SOC 2 hardening** — set `AUTH_HARDENING_ENABLED=false` (revert to 12h tokens + no rehash; scrypt rehash is forward-only, old logins still work); remove `startup/security-scanners.ps1` call; audit-log writer already existed pre-backlog.
12. **UI modernization** — remove filter-chips + skeleton CSS + keyboard shortcut additions; bulk bar pre-existed (keep); flag `UI_MODERN_ENABLED`.

## Unified rollback checklist (app broken after batch)
1. Set every flag above to `false`/remove from env.
2. Remove new route files/pages listed above (do not touch pre-existing files beyond the noted additions).
3. `pnpm --filter api exec prisma db push` (drops new tables; existing data untouched).
4. Restart: `powershell -File startup/c7ntax-boot.ps1`; verify `/api/health` 200 and web index 200.
5. Re-capture snapshot seed (run `seed-from-snapshots`) to restore pre-backlog sample data.
