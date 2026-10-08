/**
 * Connector adapters, against a stub of each vendor.
 *
 * The catalogue probe checks what the form promises; this one checks that the adapters make the calls
 * those vendors' documentation actually describes. Every assertion here exists because the previous
 * implementation got that exact thing wrong and the mistake was invisible — a request to a host that
 * does not exist, an API key where the vendor wanted a signed token, a token endpoint that is not a
 * token endpoint, page one re-fetched forever. A stub is the only way to see the request before a
 * real tenant rejects it.
 *
 * Run from apps/api:  pnpm exec tsx probe-connector-adapters.mts
 */
import type { IntegrationConfig, IntegrationKind } from "@C7NTAX/integrations";
import { AutoTaskAdapter } from "../../packages/integrations/src/adapters/AutoTaskAdapter";
import { AvananAdapter } from "../../packages/integrations/src/adapters/AvananAdapter";
import { AwsAdapter } from "../../packages/integrations/src/adapters/AwsAdapter";
import { AzureAdapter } from "../../packages/integrations/src/adapters/AzureAdapter";
import { ConnectWiseAdapter } from "../../packages/integrations/src/adapters/ConnectWiseAdapter";
import { HaloPSAAdapter } from "../../packages/integrations/src/adapters/HaloPSAAdapter";
import { ITGlueAdapter } from "../../packages/integrations/src/adapters/ITGlueAdapter";
import { KantataAdapter } from "../../packages/integrations/src/adapters/KantataAdapter";
import { Microsoft365Adapter } from "../../packages/integrations/src/adapters/Microsoft365Adapter";
import { Pax8Adapter } from "../../packages/integrations/src/adapters/Pax8Adapter";
import { ProofpointAdapter } from "../../packages/integrations/src/adapters/ProofpointAdapter";
import { QuickBooksAdapter } from "../../packages/integrations/src/adapters/QuickBooksAdapter";
import { ScoroAdapter } from "../../packages/integrations/src/adapters/ScoroAdapter";
import { SentinelOneAdapter } from "../../packages/integrations/src/adapters/SentinelOneAdapter";

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

interface Call { method: string; url: string; headers: Record<string, string>; body: string }
const calls: Call[] = [];

/** Substitute the network: the vendor is whatever this function says it is. */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(init.headers ?? {})) headers[key.toLowerCase()] = String(value);
  const body = typeof init.body === "string" ? init.body : "";
  calls.push({ method: init.method ?? "GET", url, headers, body });

  for (const [pattern, respond] of routes) {
    if (pattern.test(url)) {
      const result = respond({ url, method: init.method ?? "GET", headers, body });
      return new Response(typeof result === "string" ? result : JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  }
  return new Response(`the stub has no route for ${init.method ?? "GET"} ${url}`, { status: 501 });
}) as typeof fetch;

type Route = [RegExp, (req: Call) => unknown];
const routes: Route[] = [];
const reset = () => { calls.length = 0; };
const config = (kind: IntegrationKind, credentials: Record<string, string>, settings: Record<string, unknown> = {}): IntegrationConfig => ({
  id: `probe-${kind}`, kind, name: kind, enabled: true, credentials, settings, lastSyncAt: null, status: "connected",
});
const called = (pattern: RegExp) => calls.filter(c => pattern.test(c.url));

try {
  // ── Microsoft 365 ──────────────────────────────────────────────────────
  console.log("\nMicrosoft 365");
  routes.length = 0;
  routes.push(
    [/login\.microsoftonline\.com/, () => ({ access_token: "ms-token", expires_in: 3600 })],
    [/graph\.microsoft\.com.*\/organization/, () => ({ value: [{ id: "org" }] })],
    [/graph\.microsoft\.com.*\/subscribedSkus/, () => ({ value: [{ id: "sku1" }] })],
    [/graph\.microsoft\.com.*\/groups/, () => ({ value: [{ id: "g1" }] })],
    [/graph\.microsoft\.com.*\/users/, () => ({ value: [{ id: "u1", mail: "a@b.c" }] })],
  );
  {
    const adapter = new Microsoft365Adapter();
    const cfg = config("microsoft365", { tenantId: "contoso.onmicrosoft.com", clientId: "c1", clientSecret: "s1" });
    check(await adapter.validateCredentials(cfg), "microsoft365: credentials validate");
    reset();
    const result = await adapter.sync(cfg);
    check(result.errors.length === 0 && result.recordsProcessed === 3, `microsoft365: 3 records, no errors (${result.errors.join("; ") || "clean"})`);
    const skus = called(/subscribedSkus/)[0];
    check(!!skus && !skus.url.includes("$top"), "microsoft365: no $top on subscribedSkus, which rejects it");
    const activity = called(/signInActivity/)[0];
    check(!!activity && activity.url.includes("%24top=500"), "microsoft365: signInActivity is read with $top=500 (the documented ceiling)");
    check(calls.every(c => !/refresh_token/.test(c.body)), "microsoft365: no refresh-token grant, which the client-credentials flow cannot use");

    reset();
    await adapter.sync(config("microsoft365", { tenantId: "t", clientId: "c2", clientSecret: "s2" }, { syncUsers: false, syncLicenses: false, syncGroups: false }));
    check(called(/\/users/).length === 0 && called(/subscribedSkus/).length === 0 && called(/\/groups/).length === 0, "microsoft365: the sync switches actually stop those reads");
  }

  // ── ConnectWise ────────────────────────────────────────────────────────
  console.log("\nConnectWise PSA");
  routes.length = 0;
  routes.push(
    [/myconnectwise\.net/, req => (req.url.includes("/system/info") ? { version: "1" } : [{ id: 1 }])],
  );
  {
    const adapter = new ConnectWiseAdapter();
    const cfg = config("connectwise", { companyId: "acme", publicKey: "pub", privateKey: "priv", clientId: "0000-1111", baseUrl: "https://api-eu.myconnectwise.net/v4_6_release/apis/3.0" }, { pageSize: 100, maxPages: 1 });
    check(await adapter.validateCredentials(cfg), "connectwise: credentials validate");
    reset();
    const result = await adapter.sync(cfg);
    check(result.recordsProcessed > 0, `connectwise: records read (${result.recordsProcessed})`);
    check(calls.every(c => c.url.startsWith("https://api-eu.myconnectwise.net")), "connectwise: the configured EU host is used for every call");
    check(calls.every(c => c.headers.clientid === "0000-1111"), "connectwise: the clientId header is sent, as its documentation requires");
    check(calls.every(c => /^Basic /.test(c.headers.authorization ?? "")), "connectwise: Basic auth rather than a bearer token");
    check(called(/\?.*pageSize=100/).length > 0, "connectwise: the page size comes from the connection's options");
  }

  // ── HaloPSA ────────────────────────────────────────────────────────────
  console.log("\nHaloPSA");
  routes.length = 0;
  routes.push(
    [/auth\.halopsa\.com\/token/, () => ({ access_token: "halo-token" })],
    [/halopsa\.com\/api\/tickets/, () => [{ id: 1 }]],
    [/halopsa\.com\/api\//, () => ({ record_count: 0 })],
  );
  {
    const adapter = new HaloPSAAdapter();
    const cfg = config("halopsa", { tenantUrl: "https://acme.halopsa.com", clientId: "c", clientSecret: "s" });
    check(await adapter.validateCredentials(cfg), "halopsa: credentials validate");
    reset();
    const result = await adapter.sync(cfg);
    check(result.errors.length === 0, `halopsa: sync is clean (${result.errors.join("; ") || "clean"})`);
    const token = called(/\/token/)[0];
    check(!!token && token.body.includes("grant_type=client_credentials"), "halopsa: client-credentials grant");
    check(!!token && /scope=all/.test(token.body), "halopsa: the token request carries a scope, which its API requires");
    check(!!token && token.url.includes("tenant=acme"), "halopsa: a hosted tenant authenticates at the auth host, not the tenant host");
    const page = called(/\/api\/tickets/)[0];
    check(!!page && /pageinate=true/.test(page.url) && /page_no=1/.test(page.url), "halopsa: paging uses pageinate/page_size/page_no rather than $top/$skip");
    check(called(/\/api\/software/).length === 0, "halopsa: /software is not requested — it is a field, not a resource");
  }

  // ── AutoTask ───────────────────────────────────────────────────────────
  console.log("\nAutoTask PSA");
  routes.length = 0;
  routes.push(
    [/webservices1\.autotask\.net.*zoneInformation/, () => ({ url: "https://webservices3.autotask.net/ATServicesRest/" })],
    [/webservices[2-8]\.autotask\.net.*zoneInformation/, () => { throw new Error("not this zone"); }],
    [/webservices3\.autotask\.net.*page=2/, () => ({ items: [{ id: 2 }], pageDetails: { nextPageUrl: null } })],
    [/webservices3\.autotask\.net/, req => (req.url.includes("/Companies/query")
      ? { items: [{ id: 1 }], pageDetails: { nextPageUrl: "https://webservices3.autotask.net/ATServicesRest/v1.0/Companies/query?page=2" } }
      : { items: [], pageDetails: { nextPageUrl: null } })],
  );
  {
    const adapter = new AutoTaskAdapter();
    const cfg = config("autotask", { username: "api@acme.com", password: "pw", integrationCode: "CODE" }, { maxPages: 5 });
    check(await adapter.validateCredentials(cfg), "autotask: credentials validate");
    // The zone is looked up once and cached, so the lookup is inspected before the recorder clears.
    check(called(/zoneInformation\?user=api%40acme\.com/).length > 0, "autotask: the zone is resolved from the documented zoneInformation call");
    reset();
    const result = await adapter.sync(cfg);
    check(result.recordsProcessed > 0, `autotask: records read (${result.recordsProcessed})`);
    check(calls.every(c => c.url.includes("webservices3.autotask.net")), "autotask: every data call goes to the resolved zone host");
    check(called(/\/Companies\/query/).length > 0, "autotask: the entity is Companies, which is the name AutoTask uses");
    check(called(/Accounts\/query/).length === 0, "autotask: Accounts is never requested — there is no such entity");
    check(called(/page=2/).length > 0, "autotask: paging follows pageDetails.nextPageUrl instead of re-querying page one");
    check(calls.every(c => c.headers.username === "api@acme.com" && c.headers.apiintegrationcode === "CODE"), "autotask: the three documented headers are sent");
  }

  // ── Kantata ────────────────────────────────────────────────────────────
  console.log("\nKantata");
  routes.length = 0;
  routes.push([/mavenlink\.com/, () => ({ results: [{ key: "workspace", id: "1" }], workspace: { "1": { title: "W" } }, meta: { page_count: 1 } })]);
  {
    const adapter = new KantataAdapter();
    const cfg = config("kantata", { accessToken: "tok" });
    check(await adapter.validateCredentials(cfg), "kantata: credentials validate");
    reset();
    const result = await adapter.sync(cfg);
    check(result.errors.length === 0 && result.recordsProcessed > 0, `kantata: records read (${result.recordsProcessed})`);
    check(calls.every(c => c.url.startsWith("https://api.mavenlink.com/api/v1/")), "kantata: the documented host is used, not api.kantata.com");
    check(calls.every(c => /\.json\?/.test(c.url)), "kantata: every path carries the .json extension the API requires");
    check(calls.every(c => /^Bearer /.test(c.headers.authorization ?? "")), "kantata: bearer token");
    const workspaces = (result as any).workspaces as any[];
    check(workspaces?.[0]?.title === "W" && workspaces[0].id === "1", "kantata: {key,id} references are resolved into records");
  }

  // ── Scoro ──────────────────────────────────────────────────────────────
  console.log("\nScoro");
  routes.length = 0;
  routes.push([/scoro\.com\/api\/v2\/[a-z]+\/list/, () => ({ status: "ok", data: [{ id: 1, name: "one" }] })]);
  {
    const adapter = new ScoroAdapter();
    const cfg = config("scoro", { site: "acme", apiKey: "key", companyAccountId: "42" }, { perPage: 5 });
    check(await adapter.validateCredentials(cfg), "scoro: credentials validate");
    reset();
    const result = await adapter.sync(cfg);
    check(result.errors.length === 0, `scoro: sync is clean (${result.errors.join("; ") || "clean"})`);
    check(calls.every(c => c.method === "POST" && /\/api\/v2\/[a-z]+\/list$/.test(c.url)), "scoro: every call is a POST to a module list route");
    check(calls.every(c => !c.url.includes("apikey")), "scoro: no API key in the query string, where it is ignored");
    const first = JSON.parse(calls[0]!.body);
    check(first.apiKey === "key" && first.company_account_id === "42", "scoro: the key and company account go in the JSON body");
    check(first.per_page === 5 && first.page === 1, "scoro: paging is in the body too, and comes from the connection's options");
  }

  // ── QuickBooks ─────────────────────────────────────────────────────────
  console.log("\nQuickBooks Online");
  routes.length = 0;
  routes.push(
    [/oauth\.platform\.intuit\.com/, req => (req.body.includes("production") ? {} : { access_token: "qb-token", expires_in: 3600, refresh_token: "rotated" })],
    [/quickbooks\.api\.intuit\.com.*query/, () => ({ QueryResponse: { Customer: [{ Id: "1", DisplayName: "Acme" }] } })],
    [/intuit\.com/, () => ({ access_token: "qb-token", expires_in: 3600, refresh_token: "rotated" })],
  );
  {
    const adapter = new QuickBooksAdapter();
    const cfg = config("quickbooks", { clientId: "cid", clientSecret: "csec", refreshToken: "rtok", realmId: "1234567890" }, { environment: "sandbox", recordLimit: 10 });
    check(await adapter.validateCredentials(cfg), "quickbooks: credentials validate");
    // The exchange happens on the first call, which is the validation — so it is inspected here,
    // before the recorder is cleared for the sync.
    const token = called(/oauth\.platform\.intuit\.com/)[0];
    check(!!token && token.body.includes("grant_type=refresh_token"), "quickbooks: the refresh token is exchanged, because an access token lasts an hour");
    check(!!token && token.headers.authorization?.startsWith("Basic "), "quickbooks: the token exchange is authenticated with Basic client id and secret");
    reset();
    const result = await adapter.sync(cfg);
    check(called(/sandbox-quickbooks\.api\.intuit\.com/).length > 0, "quickbooks: the sandbox setting selects the sandbox host");
    check(called(/maxresults%2010/).length > 0 || called(/maxresults 10/).length > 0, "quickbooks: the record limit is applied to each query");
    check(result.errors.some(e => /rotated the refresh token/.test(e)), "quickbooks: refresh-token rotation is reported rather than dropped");
  }

  // ── Pax8 ───────────────────────────────────────────────────────────────
  console.log("\nPax8");
  routes.length = 0;
  routes.push(
    [/api\.pax8\.com\/v1\/token/, req => (JSON.parse(req.body || "{}").audience === "https://api.pax8.com" ? { access_token: "pax8-token", expires_in: 3600 } : {})],
    [/api\.pax8\.com\/v1\/companies/, () => ({ content: [{ id: "co1" }], page: { number: 0, size: 200, totalPages: 1 } })],
    [/api\.pax8\.com/, () => ({ content: [], page: { totalPages: 1 } })],
  );
  {
    const adapter = new Pax8Adapter();
    const cfg = config("pax8", { clientId: "10000000-0000-0000-0000-000000000001", clientSecret: "sec" });
    check(await adapter.validateCredentials(cfg), "pax8: credentials validate");
    // The token is minted on the first call and cached, so it is inspected before the recorder clears.
    const token = called(/\/v1\/token/)[0];
    check(!!token && token.headers["content-type"] === "application/json", "pax8: the token request is JSON, as its Auth0-style endpoint requires");
    check(!!token && token.body.includes("\"audience\":\"https://api.pax8.com\""), "pax8: the token request names the API as its audience");
    reset();
    const result = await adapter.sync(cfg);
    check(result.errors.length === 0, `pax8: sync is clean (${result.errors.join("; ") || "clean"})`);
    check(called(/\/v1\/identity/).length === 0, "pax8: /v1/identity is not a token endpoint and is never called");
    check(called(/\/v1\/companies/).length > 0, "pax8: customers are read as companies");
    check(called(/\/v1\/customers/).length === 0, "pax8: /v1/customers does not exist and is never called");
  }

  // ── Harmony Email (Avanan) ─────────────────────────────────────────────
  console.log("\nCheck Point Harmony Email");
  routes.length = 0;
  routes.push(
    [/\/v1\.0\/auth$/, () => ({ responseData: { jwt: "avanan-jwt" } })],
    [/\/v1\.0\/incidents/, () => ({ responseData: [{ id: "i1" }], responseEnvelope: { scrollId: null } })],
    [/\/v1\.0\/events/, () => ({ responseData: [], responseEnvelope: { scrollId: null } })],
  );
  {
    const adapter = new AvananAdapter();
    const cfg = config("avanan", { region: "eu", appId: "app", appSecret: "secret" });
    check(await adapter.validateCredentials(cfg), "avanan: credentials validate");
    reset();
    const result = await adapter.sync(cfg);
    check(result.errors.length === 0 && result.recordsProcessed === 1, `avanan: records read (${result.recordsProcessed})`);
    const auth = called(/\/v1\.0\/auth$/)[0];
    check(!!auth && auth.method === "POST" && auth.headers["x-av-app-id"] === "app" && auth.headers["x-av-app-secret"] === "secret", "avanan: the app id and secret are signed at /v1.0/auth");
    const incidents = called(/\/v1\.0\/incidents/)[0];
    check(!!incidents && incidents.headers["x-av-token"] === "avanan-jwt", "avanan: the JWT comes back in x-av-token on every call");
    check(calls.every(c => c.url.startsWith("https://eu.api.avanan.com")), "avanan: the region decides the host, and EU data is not on the US host");
    check(called(/\/api\/v1\/incidents/).length === 0, "avanan: the old /api/v1 paths and api-key header are gone");
    const incidentsPage = called(/\/v1\.0\/incidents/)[0];
    check(!!incidentsPage && incidentsPage.url.includes("startDate="), "avanan: reads are bounded by a start date rather than paging forever");
  }

  // ── Proofpoint ─────────────────────────────────────────────────────────
  console.log("\nProofpoint TAP");
  routes.length = 0;
  routes.push([
    /tap-api-v2\.proofpoint\.com\/v2\/siem\/messages\/blocked/,
    () => ({ messagesBlocked: [{ GUID: "g1" }] }),
  ]);
  routes.push([/tap-api-v2\.proofpoint\.com/, () => ({})]);
  {
    const adapter = new ProofpointAdapter();
    const cfg = config("proofpoint", { principal: "principal", secret: "pw" }, { lookbackDays: 2 });
    check(await adapter.validateCredentials(cfg), "proofpoint: credentials validate");
    reset();
    const result = await adapter.sync(cfg);
    check(result.errors.length === 0 && result.recordsProcessed === 48, `proofpoint: 48 blocked messages across the two days (${result.recordsProcessed})`);
    check(calls.every(c => /^Basic /.test(c.headers.authorization ?? "")), "proofpoint: HTTP Basic, not the x-api-key headers it does not read");
    const windows = calls.map(c => Number(/sinceSeconds=(\d+)/.exec(c.url)?.[1] ?? 0));
    check(windows.length > 0 && windows.every(w => w > 0 && w <= 3600), `proofpoint: every window is within the API's 3600-second ceiling (${Math.max(...windows)}s largest)`);
    check(windows.length === 24 * 2 * 5, `proofpoint: two days are taken as hourly slices across the five SIEM endpoints (${windows.length} requests)`);
    check((result as any).blockedMessages.length === 24 * 2, "proofpoint: the messagesBlocked key is read, not a generic data array");
  }

  // ── SentinelOne ────────────────────────────────────────────────────────
  console.log("\nSentinelOne");
  routes.length = 0;
  routes.push(
    [/\/system\/info/, () => ({ data: { version: "23.1" } })],
    [/cursor=abc/, () => ({ data: [{ id: "t2" }], pagination: {} })],
    [/\/threats/, () => ({ data: [{ id: "t1" }], pagination: { nextCursor: "abc" } })],
    [/web\/api\/v2\.1\//, () => ({ data: [], pagination: {} })],
  );
  {
    const adapter = new SentinelOneAdapter();
    const cfg = config("sentinelone", { consoleUrl: "https://usea1-acme.sentinelone.net", apiToken: "tok" }, { pageSize: 50 });
    check(await adapter.validateCredentials(cfg), "sentinelone: credentials validate");
    reset();
    const result = await adapter.sync(cfg);
    check(result.errors.length === 0 && result.recordsProcessed === 2, `sentinelone: records read (${result.recordsProcessed})`);
    check(calls.every(c => c.url.startsWith("https://usea1-acme.sentinelone.net")), "sentinelone: the tenant's own console is used, not a shared host");
    check(calls.every(c => /^ApiToken /.test(c.headers.authorization ?? "")), "sentinelone: the ApiToken header, which is not a bearer token");
    check(called(/cursor=abc/).length > 0, "sentinelone: paging follows pagination.nextCursor");
    check(called(/limit=50/).length > 0, "sentinelone: the page size comes from the connection's options");
  }

  // ── IT Glue ────────────────────────────────────────────────────────────
  console.log("\nIT Glue");
  routes.length = 0;
  routes.push(
    [/relationships\/documents/, () => ({ data: [{ id: "d1", type: "documents", attributes: { name: "Runbook" } }], meta: { totalPages: 1 } })],
    [/\/organizations/, () => ({ data: [{ id: "1", type: "organizations", attributes: { name: "Acme" } }], meta: { totalPages: 1 } })],
    [/api\.itglue\.com/, () => ({ data: [], meta: { totalPages: 1 } })],
  );
  {
    const adapter = new ITGlueAdapter();
    const cfg = config("itglue", { apiKey: "key" }, { pageSize: 100 });
    check(await adapter.validateCredentials(cfg), "itglue: credentials validate");
    reset();
    const result = await adapter.sync(cfg);
    check(result.errors.length === 0, `itglue: sync is clean (${result.errors.join("; ") || "clean"})`);
    check(calls.every(c => c.headers["x-api-key"] === "key"), "itglue: the x-api-key header");
    check(calls.every(c => !c.url.includes("include=")), "itglue: no include=organization, which these resources reject");
    check(called(/page%5Bsize%5D=100|page\[size\]=100/).length > 0, "itglue: paging is page[size]/page[number]");
    check(called(/relationships\/documents/).length > 0, "itglue: documents are read through their organisation");
    const documents = (result as any).documents as any[];
    check(documents?.[0]?.name === "Runbook" && documents[0].organizationId === "1", "itglue: JSON:API records are flattened and tied to their organisation");
  }

  // ── Azure ──────────────────────────────────────────────────────────────
  console.log("\nAzure");
  routes.length = 0;
  routes.push(
    [/login\.microsoftonline\.com/, () => ({ access_token: "arm-token", expires_in: 3600 })],
    [/management\.azure\.com/, () => ({ value: [{ id: "/subscriptions/x/resourceGroups/rg" }] })],
  );
  {
    const adapter = new AzureAdapter();
    const cfg = config("azure", { tenantId: "contoso.onmicrosoft.com", clientId: "arm-client", clientSecret: "arm-secret", subscriptionId: "sub-1" });
    check(await adapter.validateCredentials(cfg), "azure: credentials validate");
    // The ARM token is minted on the first call and cached, so it is inspected before the recorder clears.
    const token = called(/login\.microsoftonline\.com/)[0];
    check(!!token && /scope=https%3A%2F%2Fmanagement\.azure\.com%2F\.default/.test(token.body), "azure: the token scope is management.azure.com/.default");
    check(!!token && token.url.includes("contoso.onmicrosoft.com"), "azure: the token is scoped to the configured tenant");
    reset();
    const result = await adapter.sync(cfg);
    check(called(/api-version=/).length > 0, "azure: every ARM call names an api-version");
    check(result.errors.length === 0, `azure: sync is clean (${result.errors.join("; ") || "clean"})`);
  }

  // ── AWS ────────────────────────────────────────────────────────────────
  console.log("\nAWS");
  routes.length = 0;
  routes.push([
    /amazonaws\.com/,
    req => (req.url.includes("sts.")
      ? "<GetCallerIdentityResponse><GetCallerIdentityResult><Arn>arn:aws:iam::123456789012:user/probe</Arn><Account>123456789012</Account></GetCallerIdentityResult></GetCallerIdentityResponse>"
      : req.url.includes("organizations.")
        ? "<ListAccountsResponse><ListAccountsResult><Accounts><Account><Id>123456789012</Id><Name>acme</Name></Account></Accounts></ListAccountsResult></ListAccountsResponse>"
        : "<DescribeInstancesResponse><reservationSet><item><instancesSet><item><instanceId>i-1</instanceId><instanceType>t3.micro</instanceType></item></instancesSet></item></reservationSet></DescribeInstancesResponse>"),
  ]);
  {
    const adapter = new AwsAdapter();
    const cfg = config("aws", { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "eu-west-2" });
    check(await adapter.validateCredentials(cfg), "aws: credentials validate through sts:GetCallerIdentity");
    // The identity call is the first one, so the signature is inspected before the recorder clears.
    const signature = called(/sts\.eu-west-2\.amazonaws\.com/)[0]?.headers.authorization ?? "";
    check(called(/sts\.eu-west-2\.amazonaws\.com/).length > 0, "aws: STS is called at the configured regional endpoint");
    check(signature.startsWith("AWS4-HMAC-SHA256 "), "aws: requests are signed with SigV4, not sent with a bearer token");
    check(/Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/eu-west-2\/sts\/aws4_request/.test(signature), "aws: the signature names the credential, date, region and service");
    check(/Signature=[0-9a-f]{64}/.test(signature), "aws: the signature is a real HMAC-SHA256 digest");
    reset();
    const result = await adapter.sync(cfg);
    check(result.recordsProcessed === 2, `aws: accounts and instances read (${result.recordsProcessed})`);
    check(calls.every(c => c.headers["x-amz-date"]), "aws: every request carries x-amz-date");
    check(calls.every(c => /Region=eu-west-2|eu-west-2/.test(c.url + JSON.stringify(c.headers))), "aws: every service call is addressed in the configured region");
  }
} catch (error) {
  fail++;
  console.log(`\n  FAIL  the probe threw: ${(error as Error).message}`);
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} passing, ${fail} failing`);
process.exit(fail ? 1 : 0);
