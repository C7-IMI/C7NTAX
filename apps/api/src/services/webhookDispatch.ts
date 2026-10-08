/**
 * Outbound alert webhooks — the delivery half.
 *
 * The registry and the delivery log shipped without anything that sends: a registration stopped at
 * the row, so an endpoint was never called and the log only ever held sample data. This is what
 * fills it — one signed POST per event, retried as many times as the endpoint's own retryCount
 * allows, every attempt recorded so a failure is visible in the log rather than inferred from
 * silence.
 *
 * Delivery is deliberately fire-and-forget. The endpoint belongs to somebody else and may be slow,
 * broken or gone; the poll that raised the alert must not wait for it. The pending row is written
 * before the first attempt, so the log shows work in flight and a crash mid-delivery leaves a
 * visible pending row instead of nothing at all.
 *
 * Requests go through safeFetch. A webhook URL is user-supplied and fetched server-side, which is
 * the exact shape of an SSRF, so the same address policy as every other outbound request applies.
 */
import crypto from "crypto";
import { prisma } from "../index";
import { configFlag } from "./appSettings";
import { safeFetch } from "./egress";

export type WebhookEvent = "service_alert.raised" | "service_alert.resolved" | "webhook.test";

/** Events an endpoint can subscribe to, and the sentence the settings page shows for each. */
export const WEBHOOK_EVENTS: ReadonlyArray<{ event: string; label: string; description: string }> = [
  {
    event: "service_alert.raised",
    label: "Alert raised",
    description:
      "An alert opened against a monitored service — from a vendor feed, a public status page, or one of the uptime checks. A manual alert counts too.",
  },
  {
    event: "service_alert.resolved",
    label: "Alert resolved",
    description:
      "An open alert was retired: either the readable sources agreed the incident was over, or nothing reported it for long enough.",
  },
];

/** What a registration may ask for. A test delivery is sent by hand, never subscribed to. */
export const SUBSCRIBABLE_EVENTS: string[] = WEBHOOK_EVENTS.map((e) => e.event);

const SIGNATURE_HEADER = "X-C7-Signature";
const EVENT_HEADER = "X-C7-Event";
const DELIVERY_HEADER = "X-C7-Delivery";

/** How long a single attempt may take before it counts as a failure. */
const ATTEMPT_TIMEOUT_MS = 10_000;
/** Backoff between attempts. Short: an alert delivered late still beats one never delivered. */
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000];
/** The most attempts a registration may ask for. The schema default is 3. */
export const MAX_RETRIES = RETRY_DELAYS_MS.length + 1;

/** HMAC-SHA256 over the exact bytes sent, in the form the integration contract uses. */
export function signBody(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

export interface WebhookAlertData {
  service: { id: string; name: string; category: string };
  alert: {
    id: string;
    title: string;
    description: string | null;
    severity: string;
    status: string;
    source: string;
    sourceUrl: string | null;
    detectedAt: string;
    resolvedAt: string | null;
  };
}

/** The `data` half of a delivery, built once so every emitter sends the same shape. */
export function alertEventData(
  service: { id: string; name: string; category: string },
  alert: {
    id: string;
    title: string;
    description?: string | null;
    severity: string;
    status: string;
    source: string;
    sourceUrl?: string | null;
    detectedAt: Date;
    resolvedAt?: Date | null;
  },
): WebhookAlertData {
  return {
    service: { id: service.id, name: service.name, category: service.category },
    alert: {
      id: alert.id,
      title: alert.title,
      description: alert.description ?? null,
      severity: alert.severity,
      status: alert.status,
      source: alert.source,
      sourceUrl: alert.sourceUrl ?? null,
      detectedAt: alert.detectedAt.toISOString(),
      resolvedAt: alert.resolvedAt ? alert.resolvedAt.toISOString() : null,
    },
  };
}

export interface DeliveryOutcome {
  status: "delivered" | "failed";
  attempts: number;
  /** One line for the log and for the test button: what the endpoint did, or why it never answered. */
  detail: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface DeliverableWebhook {
  id: string;
  url: string;
  secret: string;
  retryCount: number;
}

/**
 * Send one event to one endpoint and record the outcome. `maxAttempts` is 1 for a test, where the
 * person is waiting on the answer and would rather press the button again than wait out a backoff.
 */
async function deliver(
  webhook: DeliverableWebhook,
  event: string,
  body: string,
  maxAttempts: number,
): Promise<DeliveryOutcome> {
  const delivery = await prisma.alertWebhookDelivery.create({
    data: { webhookId: webhook.id, event, payload: body, status: "pending", attempts: 0 },
  });

  const attempts = Math.max(1, Math.min(maxAttempts, MAX_RETRIES));
  let detail = "no attempt was made";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now();
    try {
      const response = await safeFetch(webhook.url, {
        purpose: "webhook",
        method: "POST",
        timeoutMs: ATTEMPT_TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          "user-agent": "C7NTAX-Webhooks/1.0",
          [EVENT_HEADER]: event,
          [DELIVERY_HEADER]: delivery.id,
          [SIGNATURE_HEADER]: signBody(webhook.secret, body),
        },
        body,
      });
      // Drain the response: an unread body holds the socket open, and some endpoints answer with
      // an HTML error page that would otherwise be parsed as if it mattered.
      await response.text().catch(() => "");
      if (response.ok) {
        await prisma.alertWebhookDelivery.update({
          where: { id: delivery.id },
          data: { status: "delivered", attempts: attempt },
        });
        return { status: "delivered", attempts: attempt, detail: `HTTP ${response.status} in ${Date.now() - started} ms` };
      }
      detail = `HTTP ${response.status} from the endpoint`;
    } catch (e: unknown) {
      detail = e instanceof Error ? e.message : String(e);
    }

    await prisma.alertWebhookDelivery.update({ where: { id: delivery.id }, data: { attempts: attempt } });
    const backoff = RETRY_DELAYS_MS[attempt - 1];
    if (attempt < attempts && backoff) await sleep(backoff);
  }

  await prisma.alertWebhookDelivery.update({
    where: { id: delivery.id },
    data: { status: "failed", attempts: attempts },
  });
  return { status: "failed", attempts, detail };
}

/**
 * Fan an event out to every active endpoint that asked for it. Never throws and never blocks: the
 * caller is a poll, and a webhook endpoint must not be able to slow it down.
 */
export async function emitWebhookEvent(
  event: Exclude<WebhookEvent, "webhook.test">,
  data: WebhookAlertData,
): Promise<void> {
  try {
    if (!configFlag("monitoring", "alertWebhooks")) return;
    const hooks = await prisma.webhookConfig.findMany({ where: { isActive: true } });
    const interested = hooks.filter((hook) => (hook.events || []).includes(event));
    if (!interested.length) return;

    const body = JSON.stringify({ event, sentAt: new Date().toISOString(), data });
    for (const hook of interested) {
      void deliver(hook, event, body, hook.retryCount ?? 3)
        .then((outcome) => {
          if (outcome.status === "failed") {
            console.warn(`[webhooks] ${event} to ${hook.name || hook.url} failed after ${outcome.attempts} attempt(s): ${outcome.detail}`);
          }
        })
        .catch((e: unknown) => console.error(`[webhooks] ${event} to ${hook.url} could not be recorded:`, e));
    }
  } catch (e: unknown) {
    console.error("[webhooks] dispatch failed:", e);
  }
}

/** One attempt, right now, so the person pressing the button gets an answer. */
export async function sendTestDelivery(webhook: DeliverableWebhook & { name?: string }): Promise<DeliveryOutcome> {
  const body = JSON.stringify({
    event: "webhook.test",
    sentAt: new Date().toISOString(),
    data: { test: true, message: "Test delivery from C7NTAX. No alert is behind it." },
  });
  return deliver(webhook, "webhook.test", body, 1);
}
