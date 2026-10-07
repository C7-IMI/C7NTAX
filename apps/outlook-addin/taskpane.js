/**
 * C7NTAX Outlook add-in taskpane (PLAN-012, flow per PLAN-023).
 *
 * Reads the selected message — or several, when the reading pane has a multi-selection — and turns
 * it into tickets through `POST /api/outlook-addin/tickets`, which runs the same deduction pipeline
 * the monitored-mailbox connector uses (`services/emailToTicket.ts`). One contact-matching path, one
 * dedup key, one ticket number series: an add-in that built tickets its own way would be a second,
 * quietly different behaviour for the same email.
 *
 * The flow, and why each step exists:
 *
 *   1. **What is selected** — the messages themselves rather than a count, with the ones that
 *      already have a ticket flagged before anything is committed to.
 *   2. **How several become tickets** — one each, or bundled into one. Asked, never
 *      guessed: three unrelated problems and one incident look identical from here.
 *   3. **Which message the ticket is written from**, when bundling — a real choice with no sensible
 *      default, which is why bundling is the one answer that cannot be remembered.
 *   4. **Whether to review** — and the review itself, showing the fields the *server* will fill in,
 *      editable, because a client is matched from the sender's domain and the pane cannot know it.
 *
 * The saved answers that let steps 2 and 4 stop being asked are held on the user, not in this
 * webview: `localStorage` here belongs to the add-in's origin, so it is shared by every C7NTAX
 * account used on the machine — and these settings decide whether a ticket is filed without asking.
 *
 * Dependency-free on purpose. An add-in runs inside a webview the host controls, every kilobyte is
 * loaded on a cold start, and Office.js from Microsoft's CDN is the only script this file waits for.
 */
/* global Office */

const TOKEN_KEY = "c7_addin_token";

/**
 * `?demo=1` runs this pane — the shipped one — against canned answers instead of the API, so the
 * flow can be walked from a browser without installing anything or touching a mailbox. Nothing is
 * submitted and nothing is saved.
 *
 * The simulator is the real pane rather than a second copy of the interface on purpose: a separate
 * demo screen drifts the moment the flow changes, and a demo that shows something the add-in does
 * not do is worse than no demo at all. Administration → Configuration → Client Apps & Notifications
 * opens it in a pop-up window.
 */
const DEMO = new URLSearchParams(location.search).has("demo");

const el = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  ready: false,
  boards: [],
  clients: [],
  items: [],            // the selected messages, in the shape the endpoint accepts
  preview: [],          // per message: what the server would fill in, and whether it is a duplicate
  prefs: { mode: "ask", preview: "ask", rememberBoard: true, lastBoardId: null },
  boardId: "",
  screen: "entry",      // entry | bundle | preview | prefs | result
  sheet: null,          // mode | previewAsk
  sheetReturn: "entry",
  mode: null,           // individual | bundled
  parent: 0,            // index of the message that becomes the ticket when bundling
  attached: {},         // index -> boolean
  edits: {},            // index -> the reviewed fields
  result: null,
  busy: false,
};

/* ── Plumbing ──────────────────────────────────────────────────────────────── */

/**
 * The API lives on the same origin that serves this folder, so relative URLs are correct.
 *
 * `credentials: "omit"` is load-bearing, not tidiness. This pane authenticates with its own bearer
 * token, but a browser sends the origin's cookies with a same-origin fetch by default — and if the
 * person happens to be signed in to the C7NTAX web app, the API sees a valid session cookie and
 * demands the CSRF header that goes with it. Every write from the pane came back
 * `403 CSRF token missing or invalid` while every read worked, which is exactly the shape of a
 * confusing bug. Omitting credentials keeps the pane what it is: a token client with no ambient
 * session to confuse, and one whose requests cannot ride on somebody's browser login.
 */
async function api(path, options = {}) {
  if (DEMO) return demoAnswer(path, options);
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: "omit",
    headers: {
      "content-type": "application/json",
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    signOut("Your session expired — sign in again.");
    throw new Error(data?.error?.message || "Not signed in");
  }
  if (!res.ok) throw new Error(data?.error?.message || data?.error || `Request failed (${res.status})`);
  return data;
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const initials = (name, email) => {
  const source = (name || email || "?").trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
};
/** Messages that can still become tickets: the ones already filed are shown, not offered. */
const fresh = () => state.items.map((_, i) => i).filter((i) => !state.preview[i]?.alreadyHasTicket);
const attachedIndexes = () => fresh().filter((i) => i !== state.parent && state.attached[i]);

/* ── Sign-in ───────────────────────────────────────────────────────────────── */
function signOut(message) {
  state.token = "";
  localStorage.removeItem(TOKEN_KEY);
  el("signout").hidden = true;
  el("prefs-open").hidden = true;
  el("panel").hidden = true;
  el("signin").hidden = false;
  if (message) {
    el("signin-error").textContent = message;
    el("signin-error").hidden = false;
  }
}

async function signIn() {
  const email = el("email").value.trim();
  const password = el("password").value;
  el("signin-error").hidden = true;
  el("signin-submit").disabled = true;
  try {
    const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (data.mfaRequired) throw new Error("This account requires a second factor — sign in from the web app first");
    state.token = data.token;
    localStorage.setItem(TOKEN_KEY, data.token);
    await afterSignIn();
  } catch (err) {
    el("signin-error").textContent = err.message;
    el("signin-error").hidden = false;
  } finally {
    el("signin-submit").disabled = false;
  }
}

/* ── Reading the selection ─────────────────────────────────────────────────── */

/** Trims the body the way the connector does, so the ticket reads the same either way. */
function toText(value) {
  if (!value) return "";
  return String(value).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, 20000);
}

/** One Office.js message object into the payload shape the endpoint accepts. */
function messageToEmail(item) {
  const from = item.from || (item.sender ? { emailAddress: item.sender } : null);
  const received = item.dateTimeCreated ? new Date(item.dateTimeCreated) : new Date();
  return {
    internetMessageId: item.internetMessageId || "",
    from: from?.emailAddress || "",
    fromName: from?.displayName || "",
    subject: item.subject || "(no subject)",
    bodyText: toText(item.body?.content || item.body || ""),
    receivedAt: received.toISOString(),
    hasAttachment: Array.isArray(item.attachments) && item.attachments.length > 0,
  };
}

/**
 * The selected messages. `getSelectedItemsAsync` needs Mailbox 1.13 and is the only way to see a
 * multi-selection; older hosts and single-open messages fall back to `mailbox.item`, which is the
 * message actually being read.
 */
function readSelection() {
  return new Promise((resolve) => {
    const mailbox = Office?.context?.mailbox;
    if (!mailbox) return resolve([]);
    if (typeof mailbox.getSelectedItemsAsync !== "function") {
      return resolve(mailbox.item ? [messageToEmail(mailbox.item)] : []);
    }
    mailbox.getSelectedItemsAsync((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded && result.value?.length) {
        resolve(result.value.map(messageToEmail));
        return;
      }
      // A single open message is not a "selection" to some hosts; fall back rather than showing none.
      resolve(mailbox.item ? [messageToEmail(mailbox.item)] : []);
    });
  });
}

/* ── The reviewed fields ───────────────────────────────────────────────────── */

/**
 * Seed the editable fields from what the server says it would do.
 *
 * The server is the one that knows: a client is matched from the sender's domain and a contact from
 * the sender's address, and this pane can see neither. Everything here starts as the server's answer
 * and only changes if the user changes it, so an untouched review is exactly what would have been
 * filed anyway.
 */
function seedEdits() {
  state.edits = {};
  state.preview.forEach((preview, index) => {
    if (!preview) return;
    state.edits[index] = {
      boardId: state.boardId,
      companyId: preview.matchedCompany?.id ?? "",
      contactName: preview.contactName || "",
      subject: preview.title || state.items[index]?.subject || "",
      description: preview.description || "",
      priority: preview.priority || "Normal",
    };
  });
}

/** Only the fields the user actually changed are sent, so the server's own deduction still applies. */
function reviewedPayload(index) {
  const edit = state.edits[index];
  const preview = state.preview[index];
  if (!edit) return {};
  const payload = {};
  if (edit.subject && edit.subject !== (preview?.title || "")) payload.subject = edit.subject;
  if (edit.description && edit.description !== (preview?.description || "")) payload.description = edit.description;
  if (edit.priority && edit.priority !== (preview?.priority || "")) payload.priority = edit.priority;
  if ((edit.companyId || "") !== (preview?.matchedCompany?.id ?? "")) payload.companyId = edit.companyId || null;
  if ((edit.contactName || "") !== (preview?.contactName || "")) payload.contactName = edit.contactName;
  if (edit.boardId && edit.boardId !== state.boardId) payload.boardId = edit.boardId;
  return payload;
}

function emailFor(index) {
  const item = state.items[index];
  if (!item) return null;
  return { ...item, ...reviewedPayload(index) };
}

/* ── Rendering ─────────────────────────────────────────────────────────────── */

const STEPS = { entry: 1, bundle: 2, preview: 3, result: 4 };

function render() {
  const board = state.screen === "prefs" ? null : el("body");
  const steps = STEPS[state.screen] ?? 0;
  el("steps").hidden = steps === 0;
  for (const [i, span] of Array.from(el("steps").children).entries()) {
    span.className = i < steps ? "on" : "";
  }

  const screen = { entry: screenEntry, bundle: screenBundle, preview: screenPreview, prefs: screenPrefs, result: screenResult }[state.screen];
  const view = screen ? screen() : { body: "", foot: "" };
  el("body").innerHTML = view.body;
  el("foot").innerHTML = view.foot;

  const sheet = state.sheet === "mode" ? sheetMode() : state.sheet === "previewAsk" ? sheetPreviewAsk() : "";
  el("sheet").innerHTML = sheet;

  wire();
  void board;
}

function messageRow(index, right = "") {
  const item = state.items[index];
  if (!item) return "";
  return `
    <div class="msg">
      <div class="avatar">${escapeHtml(initials(item.fromName, item.from))}</div>
      <div class="msg-body">
        <span class="msg-who">${escapeHtml(item.fromName || item.from || "Unknown sender")}</span>
        <span class="msg-sub">${escapeHtml(item.subject || "(no subject)")}</span>
        <span class="msg-meta">${escapeHtml(item.from || "")}${item.hasAttachment ? " · attachment" : ""}</span>
      </div>
      ${right ? `<div class="msg-right">${right}</div>` : ""}
    </div>`;
}

function screenEntry() {
  const total = state.items.length;
  const duplicates = state.preview.filter((p) => p?.alreadyHasTicket).length;
  const willCreate = total - duplicates;
  const oneClick = state.prefs.mode === "individual" && state.prefs.preview === "never";

  if (!state.ready) {
    return {
      body: `<div class="card"><strong>Open this pane from the C7NTAX button in Outlook.</strong><p class="muted small">It needs a message to work from.</p></div>`,
      foot: "",
    };
  }
  if (total === 0) {
    return {
      body: `<div class="card"><strong>No message selected.</strong><p class="muted small">Select an email, or open one, and reopen this pane.</p></div>`,
      foot: "",
    };
  }

  const body = `
    <div class="card">
      <div class="card-head">
        <h3>${plural(total, "message", "messages")} selected</h3>
        <span class="chip chip-neutral">from Outlook</span>
      </div>
      ${state.items.map((_, i) => messageRow(i, state.preview[i]?.alreadyHasTicket ? `<span class="chip chip-warn">Has a ticket</span>` : "")).join("")}
    </div>

    <label for="board">Board
      <select id="board">${state.boards.map((b) => `<option value="${escapeHtml(b.id)}"${b.id === state.boardId ? " selected" : ""}>${escapeHtml(b.name)}</option>`).join("")}</select>
    </label>
    <p class="hint">Where the tickets go. Everything else is filled in from the message, and you can change it before it is submitted.</p>

    ${savedPrefsNotice()}
    ${duplicates ? `<p class="hint warn">${plural(duplicates, "message already has", "messages already have")} a ticket and will be skipped, so ${plural(willCreate, "ticket", "tickets")} will be created.</p>` : ""}
  `;

  const label = oneClick
    ? `Create ${plural(willCreate, "ticket", "tickets")} now`
    : total === 1
      ? "Create ticket"
      : `Create ${plural(willCreate, "ticket", "tickets")}…`;
  const promise = oneClick
    ? `${plural(willCreate, "ticket", "tickets")} filed immediately — no questions, per your saved preferences.`
    : state.prefs.preview === "always"
      ? "Straight to the review — your preferences always show it."
      : total === 1
        ? "You'll be asked whether to review it first."
        : state.prefs.mode === "individual"
          ? "One ticket per message, then you'll be asked whether to review."
          : "You'll choose one ticket each or bundled, then whether to review.";

  return {
    body,
    foot: `
      <button class="primary" id="go"${state.busy || !state.boardId ? " disabled" : ""}>${escapeHtml(label)}</button>
      <p class="hint" style="text-align:center;margin:0">${escapeHtml(promise)}</p>`,
  };
}

/** What the saved answers will do, said on the screen they will do it on — and a way out of them. */
function savedPrefsNotice() {
  const saved = state.prefs.mode !== "ask" || state.prefs.preview !== "ask" || !state.prefs.rememberBoard;
  if (!saved) {
    return `<p class="hint" style="margin:0">Nothing saved yet. <button class="linklike" data-prefs>Preferences</button></p>`;
  }
  const parts = [];
  if (state.prefs.mode === "individual" && state.items.length > 1) parts.push("one ticket each");
  if (state.prefs.preview === "never") parts.push("no review");
  if (state.prefs.preview === "always") parts.push("always reviewing first");
  if (!state.prefs.rememberBoard) parts.push("a fixed board");
  const oneClick = state.prefs.mode === "individual" && state.prefs.preview === "never";
  return `
    <div class="saved">
      <span class="chip ${oneClick ? "chip-ok" : "chip-brand"}">${oneClick ? "One-click" : "Saved"}</span>
      <span class="saved-text">${escapeHtml(parts.join(" · ") || "preferences saved")}</span>
      <button class="linklike" data-prefs>Change</button>
    </div>`;
}

function screenBundle() {
  const candidates = fresh();
  const others = candidates.filter((i) => i !== state.parent);
  const parent = state.items[state.parent];

  if (!candidates.length || !parent) {
    return { body: `<p class="muted">Nothing left to file — every selected message already has a ticket.</p>`, foot: backFoot("Back") };
  }

  const body = `
    <p class="hint" style="margin:0 0 7px">Which message should the ticket be written from?</p>
    ${candidates.map((i) => `
      <button class="pick" role="radio" aria-checked="${i === state.parent}" data-parent="${i}" type="button">
        <span class="tick"></span>
        <span class="msg-body">
          <span class="msg-who">${escapeHtml(state.items[i].fromName || state.items[i].from || "Unknown sender")}</span>
          <span class="msg-sub">${escapeHtml(state.items[i].subject || "(no subject)")}</span>
        </span>
        ${i === state.parent ? `<span class="chip chip-brand">The ticket</span>` : ""}
      </button>`).join("")}
    <p class="hint">The ticket takes this message's subject, body and contact, so pick the one that describes the work best.</p>

    ${others.length ? `
      <p class="hint" style="margin:12px 0 7px">Attach the other ${others.length === 1 ? "message" : `${others.length} messages`}</p>
      ${others.map((i) => `
        <button class="pick" role="checkbox" aria-checked="${!!state.attached[i]}" data-attach="${i}" type="button">
          <span class="tick square"></span>
          <span class="msg-body">
            <span class="msg-who">${escapeHtml(state.items[i].fromName || state.items[i].from || "Unknown sender")}</span>
            <span class="msg-sub">${escapeHtml(state.items[i].subject || "(no subject)")}</span>
          </span>
        </button>`).join("")}
      <p class="hint">Each attached message is saved on the ticket as a file, so anyone reading it later can open the original.</p>
    ` : ""}
  `;

  const count = attachedIndexes().length;
  return {
    body,
    foot: `
      <button class="primary" id="go">Continue</button>
      <button id="back">Back</button>
      <p class="hint" style="text-align:center;margin:0">1 ticket with ${plural(count, "attachment", "attachments")}</p>`,
  };
}

function fieldBlock(index, key) {
  const edit = state.edits[index] || {};
  const preview = state.preview[index] || {};
  const unmatched = !edit.companyId;
  const boardOptions = state.boards
    .map((b) => `<option value="${escapeHtml(b.id)}"${b.id === edit.boardId ? " selected" : ""}>${escapeHtml(b.name)}</option>`)
    .join("");
  const clientOptions = state.clients
    .map((c) => `<option value="${escapeHtml(c.id)}"${c.id === edit.companyId ? " selected" : ""}>${escapeHtml(c.name)}</option>`)
    .join("");
  const priorities = ["Low", "Normal", "High", "Urgent"]
    .map((p) => `<option${p === edit.priority ? " selected" : ""}>${p}</option>`)
    .join("");

  return `
    <label for="f-board-${key}">Board<select id="f-board-${key}" data-field="boardId" data-index="${index}">${boardOptions}</select></label>

    <label for="f-client-${key}">Client
      <select id="f-client-${key}" data-field="companyId" data-index="${index}">
        <option value=""${unmatched ? " selected" : ""}>Not matched</option>
        ${clientOptions}
      </select>
    </label>
    ${unmatched
      ? `<p class="hint warn">No client matched <strong>${escapeHtml(state.items[index]?.from || "this sender")}</strong>. ${
          preview.fallbackCompany
            ? `It will be filed under <strong>${escapeHtml(preview.fallbackCompany.name)}</strong> unless you pick one.`
            : "Pick one, or the ticket is created without a client."
        }</p>`
      : `<p class="hint ok">Matched from ${escapeHtml(state.items[index]?.from || "the sender")}</p>`}

    <label for="f-contact-${key}">Contact<input id="f-contact-${key}" type="text" data-field="contactName" data-index="${index}" value="${escapeHtml(edit.contactName || "")}" /></label>

    <label for="f-subject-${key}">Subject<input id="f-subject-${key}" type="text" data-field="subject" data-index="${index}" value="${escapeHtml(edit.subject || "")}" /></label>

    <label for="f-desc-${key}">Description<textarea id="f-desc-${key}" data-field="description" data-index="${index}">${escapeHtml(edit.description || "")}</textarea></label>
    <p class="hint" style="margin-top:-4px">The message body, trimmed of the signature and quoted history.</p>

    <label for="f-priority-${key}">Priority<select id="f-priority-${key}" data-field="priority" data-index="${index}">${priorities}</select></label>

    <label>Source<input type="text" value="Email (Outlook add-in)" disabled /></label>
    ${preview.alreadyHasTicket ? `<p class="hint warn">Already has a ticket — this one will be skipped.</p>` : ""}
  `;
}

function screenPreview() {
  if (state.mode === "bundled") {
    const parent = state.parent;
    const attached = attachedIndexes();
    return {
      body: `
        <div class="card">
          <div class="card-head"><h3>What will be submitted</h3><span class="chip chip-brand">1 ticket</span></div>
          <p class="hint" style="margin:0">From <strong>${escapeHtml(state.items[parent]?.fromName || state.items[parent]?.from || "")}</strong></p>
        </div>
        ${fieldBlock(parent, "b")}
        <div>
          <p class="hint" style="margin:0 0 6px">Attachments</p>
          ${attached.map((i) => `<div class="att"><span aria-hidden="true">📎</span><span class="name">${escapeHtml(state.items[i]?.subject || "")}</span><span class="chip chip-neutral">email</span></div>`).join("") || `<p class="hint">No other messages attached.</p>`}
        </div>`,
      foot: `
        <button class="primary" id="go"${state.busy ? " disabled" : ""}>${state.busy ? "Creating…" : "Create ticket"}</button>
        <button id="back"${state.busy ? " disabled" : ""}>Back</button>`,
    };
  }

  const list = fresh();
  return {
    body: `
      <div class="card">
        <div class="card-head"><h3>What will be submitted</h3><span class="chip chip-brand">${plural(list.length, "ticket", "tickets")}</span></div>
        <p class="hint" style="margin:0">${list.length === 1
          ? "Check and edit what will be filled in before it is submitted."
          : "Each message becomes its own ticket. Open one to change what will be filled in."}</p>
      </div>
      ${list.map((i, position) => {
        const open = state.openEdit === i || (state.openEdit === undefined && position === 0);
        return open
          ? `<div class="card">
               <div class="card-head"><h3>${escapeHtml(state.items[i]?.fromName || state.items[i]?.from || "")}</h3><button class="linklike" data-close="${i}">Done</button></div>
               ${fieldBlock(i, `i-${i}`)}
             </div>`
          : `<button class="pick" data-open="${i}" type="button">
               <span class="avatar">${escapeHtml(initials(state.items[i]?.fromName, state.items[i]?.from))}</span>
               <span class="msg-body">
                 <span class="msg-who">${escapeHtml(state.edits[i]?.subject || "")}</span>
                 <span class="msg-sub">${escapeHtml(state.edits[i]?.companyId ? (state.clients.find((c) => c.id === state.edits[i].companyId)?.name || "client") : "no client matched")}</span>
               </span>
               <span class="chip chip-neutral">Edit</span>
             </button>`;
      }).join("")}`,
    foot: `
      <button class="primary" id="go"${state.busy ? " disabled" : ""}>${state.busy ? "Creating…" : `Create ${plural(list.length, "ticket", "tickets")}`}</button>
      <button id="back"${state.busy ? " disabled" : ""}>Back</button>`,
  };
}

/**
 * The one place a saved answer can be seen and undone.
 *
 * It exists because every one of these preferences works by making a question stop appearing — so
 * once it has taken effect, this screen is the only evidence it was ever set.
 */
function screenPrefs() {
  const pick = (checked, attrs, title, sub) => `
    <button class="pick" role="radio" aria-checked="${checked}" ${attrs} type="button">
      <span class="tick"></span>
      <span class="msg-body">
        <span class="msg-who">${escapeHtml(title)}</span>
        <span class="msg-sub">${escapeHtml(sub)}</span>
      </span>
    </button>`;

  return {
    body: `
      <div class="card">
        <div class="card-head">
          <h3>Preferences</h3>
          ${state.prefs.mode === "individual" && state.prefs.preview === "never" ? `<span class="chip chip-ok">One-click</span>` : `<span class="chip chip-neutral">Ask</span>`}
        </div>
        <p class="hint" style="margin:0">Saved to your C7NTAX account, so they follow you rather than this computer.</p>
      </div>

      <p class="hint" style="margin:0">When several messages are selected</p>
      ${pick(state.prefs.mode === "ask", 'data-pref-mode="ask"', "Ask me each time", "One ticket each, or bundled into one — you choose.")}
      ${pick(state.prefs.mode === "individual", 'data-pref-mode="individual"', "One ticket per message", "No question. Bundling still asks, because which message the ticket is written from is a real choice.")}

      <p class="hint" style="margin:6px 0 0">Before creating</p>
      ${pick(state.prefs.preview === "ask", 'data-pref-preview="ask"', "Ask each time", "You decide whether to review, per conversation.")}
      ${pick(state.prefs.preview === "always", 'data-pref-preview="always"', "Always show the review", "Go straight to the fields; nothing is submitted until you confirm.")}
      ${pick(state.prefs.preview === "never", 'data-pref-preview="never"', "Never — create immediately", "The ticket is filed as soon as you press Create, with the fields taken from the message.")}

      <p class="hint" style="margin:6px 0 0">Board</p>
      <label class="remember" style="border:1px solid var(--border);border-radius:8px;padding:8px">
        <input type="checkbox" id="pref-board"${state.prefs.rememberBoard ? " checked" : ""} />
        <span>Remember the last board I used${state.prefs.rememberBoard && state.prefs.lastBoardId ? ` (${escapeHtml(state.boards.find((b) => b.id === state.prefs.lastBoardId)?.name || "set")})` : ""}</span>
      </label>

      <div class="card" style="background:var(--surface-2)">
        <p class="hint" style="margin:0">${escapeHtml(prefsOutcome())}</p>
      </div>`,
    foot: `
      <button id="prefs-done">Done</button>
      <button id="prefs-reset">Reset to asking</button>`,
  };
}

/** The consequence of the current answers, spelled out — including the one that files with nothing shown. */
function prefsOutcome() {
  const { mode, preview } = state.prefs;
  if (mode === "ask" && preview === "ask") {
    return "Every selection asks how to handle it, and asks whether to review. Nothing is filed without a confirmation.";
  }
  if (preview === "never" && mode === "individual") {
    return "Selecting messages and pressing Create files them straight away — one ticket per message, no review, no questions. Bundling still asks which message the ticket is written from.";
  }
  if (preview === "never") {
    return "With one message selected, pressing Create files it straight away. With several, you are still asked whether to bundle them.";
  }
  if (preview === "always") {
    return "You always land on the review, so nothing is filed until you confirm." +
      (mode === "individual" ? " Several messages are filed one ticket each without being asked." : " Several messages still ask whether to bundle them.");
  }
  return "Your answers take effect on the next selection.";
}

function screenResult() {
  const r = state.result;
  const attachments = r.attachments || [];
  return {
    body: `
      <div class="card" style="text-align:center;padding:14px 10px">
        <h3 style="margin:0 0 3px;font-size:13.5px">${r.created ? plural(r.created, "ticket created", "tickets created") : "Nothing to create"}</h3>
        <p class="hint" style="margin:0">
          ${r.bundled ? `Bundled into one ticket, with ${plural(attachments.length, "message", "messages")} attached.` : "One ticket per message."}
          ${r.skipped?.length ? ` ${plural(r.skipped.length, "message was", "messages were")} skipped.` : ""}
        </p>
      </div>
      ${(r.results || []).filter((x) => x.ticketId).map((x) => `
        <div class="result">
          <span class="num">${escapeHtml(x.ticketNumber || "Ticket")}</span>
          <span class="sub">${escapeHtml(x.subject || "")}</span>
          <span class="state">${DEMO
            ? `<span class="chip chip-neutral">Example</span>`
            : `<a href="/tickets/${encodeURIComponent(x.ticketId)}" target="_blank" rel="noreferrer" style="color:var(--brand);font-size:12px;font-weight:600">Open</a>`}</span>
        </div>`).join("")}
      ${(r.results || []).filter((x) => x.reason).map((x) => `
        <div class="result skipped">
          <span class="num muted">—</span>
          <span class="sub">${escapeHtml(x.subject || "")}</span>
          <span class="state"><span class="chip chip-warn">${escapeHtml(x.reason)}</span></span>
        </div>`).join("")}
      ${attachments.length ? `
        <div>
          <p class="hint" style="margin:6px 0 6px">Attached to ${escapeHtml(r.results.find((x) => x.ticketNumber)?.ticketNumber || "the ticket")}</p>
          ${attachments.map((a) => `<div class="att"><span aria-hidden="true">📎</span><span class="name">${escapeHtml(a.subject)}</span><span class="chip chip-neutral">email</span></div>`).join("")}
        </div>` : ""}`,
    foot: `
      <button class="primary" id="again">Create another</button>
      <button id="back">Back to the messages</button>`,
  };
}

/* ── Sheets ───────────────────────────────────────────────────────────────── */

function sheetMode() {
  const total = state.items.length;
  const willFile = fresh().length;
  const dropped = total - willFile;
  return `
    <div class="scrim">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="How should these messages become tickets">
        <h2>${plural(total, "message", "messages")} selected</h2>
        <p>Choose how ${willFile === 1 ? "this message becomes a ticket" : `these ${willFile} messages become tickets`}.</p>
        ${dropped ? `<p class="hint warn" style="margin:0">${plural(dropped, "message already has", "messages already have")} a ticket and will be skipped.</p>` : ""}

        <button class="opt" role="radio" aria-checked="${state.mode === "individual"}" data-mode="individual" type="button">
          <span class="opt-title">One ticket each <span class="chip chip-neutral">Most common</span></span>
          <span class="opt-sub">${plural(willFile, "ticket", "tickets")}, one per message. Each keeps its own subject and stays in its own conversation.</span>
        </button>

        <button class="opt" role="radio" aria-checked="${state.mode === "bundled"}" data-mode="bundled" type="button">
          <span class="opt-title">Bundle into one ticket <span class="chip chip-neutral">One ticket</span></span>
          <span class="opt-sub">All ${willFile} messages become a single ticket. You choose which one the ticket is written from; ${willFile === 2 ? "the other one is attached" : `the other ${willFile - 1} are attached`} to it as ${willFile === 2 ? "a file" : "files"} you can open later.</span>
        </button>

        <div class="row" style="margin-top:2px">
          <button id="sheet-cancel" type="button">Cancel</button>
          <button class="primary" id="sheet-continue" type="button"${state.mode ? "" : " disabled"}>Continue</button>
        </div>

        ${state.mode === "individual"
          ? `<label class="remember"><input type="checkbox" id="remember-mode" /><span>Remember this — create one ticket per message without asking</span></label>`
          : state.mode === "bundled"
            ? `<p class="hint" style="margin:0">Bundling always asks which message the ticket is written from, so this answer cannot be remembered.</p>`
            : ""}
      </div>
    </div>`;
}

function sheetPreviewAsk() {
  const count = state.mode === "bundled" ? 1 : fresh().length;
  return `
    <div class="scrim">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Preview before creating">
        <h2>Preview first?</h2>
        <p>You can check and edit what will be filled in from ${count === 1 ? "the message" : "the messages"} — the client, contact, subject, description and priority — before ${count === 1 ? "the ticket is" : "any ticket is"} created.</p>
        <div class="row">
          <button id="ask-skip" type="button">Create now</button>
          <button class="primary" id="ask-preview" type="button">Preview and edit</button>
        </div>
        <label class="remember"><input type="checkbox" id="remember-preview" /><span>Remember this answer</span></label>
        <p class="hint" style="text-align:center;margin:0">Nothing is submitted until you confirm.</p>
      </div>
    </div>`;
}

/* ── Actions ──────────────────────────────────────────────────────────────── */

function backFoot(label = "Back") {
  return `<button id="back">${escapeHtml(label)}</button>`;
}

function savePrefs(patch) {
  state.prefs = { ...state.prefs, ...patch };
  // Fire and forget: a preference that failed to save should not block filing a ticket, and the
  // screen already shows what the local answer is.
  api("/outlook-addin/preferences", { method: "PATCH", body: JSON.stringify(state.prefs) }).catch(() => {});
}

async function submit() {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    const indexes = state.mode === "bundled" ? [state.parent, ...attachedIndexes()] : fresh();
    const emails = indexes.map((i) => emailFor(i)).filter(Boolean);
    const payload = {
      boardId: state.boardId,
      mode: state.mode === "bundled" ? "bundled" : "individual",
      emails,
      ...(state.mode === "bundled" ? { parentMessageId: state.items[state.parent]?.internetMessageId || "" } : {}),
    };
    state.result = await api("/outlook-addin/tickets", { method: "POST", body: JSON.stringify(payload) });
    if (state.prefs.rememberBoard) savePrefs({ lastBoardId: state.boardId });
    state.screen = "result";
    state.sheet = null;
  } catch (err) {
    el("foot").insertAdjacentHTML("afterbegin", `<p class="error">${escapeHtml(err.message)}</p>`);
  } finally {
    state.busy = false;
    render();
  }
}

/* ── Wiring ───────────────────────────────────────────────────────────────── */

function wire() {
  el("go") && (el("go").addEventListener("click", () => {
    if (state.screen === "entry") {
      const several = fresh().length > 1;
      if (several && state.prefs.mode === "ask") { state.sheet = "mode"; return render(); }
      state.mode = "individual";
      if (state.prefs.preview === "never") return void submit();
      if (state.prefs.preview === "always") { state.screen = "preview"; return render(); }
      state.sheet = "previewAsk";
      return render();
    }
    if (state.screen === "bundle") {
      state.screen = "preview";
      state.sheet = "previewAsk";
      return render();
    }
    if (state.screen === "preview") return void submit();
    if (state.screen === "result") { resetFlow(); return render(); }
  }));

  el("back") && (el("back").addEventListener("click", () => {
    // Only a bundled flow has a bundling step to return to. Sending an individual-ticket user
    // "back" to a parent-and-attachments screen they never saw would be a step out of nowhere.
    if (state.screen === "bundle") state.screen = "entry";
    else if (state.screen === "preview") state.screen = state.mode === "bundled" ? "bundle" : "entry";
    else if (state.screen === "result") state.screen = "entry";
    else if (state.screen === "prefs") state.screen = state.sheetReturn || "entry";
    state.openEdit = undefined;
    render();
  }));

  el("again") && (el("again").addEventListener("click", () => { resetFlow(); render(); }));

  const board = el("board");
  if (board) board.addEventListener("change", () => {
    state.boardId = board.value;
    for (const edit of Object.values(state.edits)) edit.boardId = board.value;
    if (state.prefs.rememberBoard) savePrefs({ lastBoardId: board.value });
  });

  el("prefs-open") && (el("prefs-open").addEventListener("click", openPrefs));
  el("prefs-done") && (el("prefs-done").addEventListener("click", () => { state.screen = state.sheetReturn || "entry"; render(); }));
  el("prefs-reset") && (el("prefs-reset").addEventListener("click", () => {
    state.prefs = { mode: "ask", preview: "ask", rememberBoard: true, lastBoardId: null };
    savePrefs({ ...state.prefs });
    render();
  }));

  document.querySelectorAll("[data-prefs]").forEach((b) => b.addEventListener("click", openPrefs));
  document.querySelectorAll("[data-pref-mode]").forEach((b) => b.addEventListener("click", () => {
    savePrefs({ mode: b.dataset.prefMode });
    render();
  }));
  document.querySelectorAll("[data-pref-preview]").forEach((b) => b.addEventListener("click", () => {
    savePrefs({ preview: b.dataset.prefPreview });
    render();
  }));
  el("pref-board") && (el("pref-board").addEventListener("change", (e) => {
    savePrefs({ rememberBoard: e.target.checked, ...(e.target.checked ? { lastBoardId: state.boardId } : {}) });
    render();
  }));

  document.querySelectorAll("[data-parent]").forEach((b) => b.addEventListener("click", () => {
    state.parent = Number(b.dataset.parent);
    // The parent cannot also be an attachment.
    state.attached[state.parent] = false;
    render();
  }));
  document.querySelectorAll("[data-attach]").forEach((b) => b.addEventListener("click", () => {
    const index = Number(b.dataset.attach);
    state.attached[index] = !state.attached[index];
    render();
  }));

  document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => {
    state.openEdit = Number(b.dataset.open);
    render();
  }));
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => {
    state.openEdit = null;
    render();
  }));
  document.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const index = Number(input.dataset.index);
      if (!state.edits[index]) return;
      state.edits[index][input.dataset.field] = input.value;
      // A client change alters the match hint under the select, so that one field re-renders.
      if (input.dataset.field === "companyId") { render(); return; }
      // Re-rendering on every keystroke would steal focus mid-edit; the value is already stored.
    });
    input.addEventListener("input", () => {
      const index = Number(input.dataset.index);
      if (state.edits[index] && input.dataset.field !== "companyId") {
        state.edits[index][input.dataset.field] = input.value;
      }
    });
  });

  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    const cont = el("sheet-continue");
    if (cont) cont.disabled = false;
    render();
  }));
  el("sheet-cancel") && (el("sheet-cancel").addEventListener("click", () => { state.sheet = null; state.mode = null; render(); }));
  el("sheet-continue") && (el("sheet-continue").addEventListener("click", () => {
    if (el("remember-mode")?.checked && state.mode === "individual") savePrefs({ mode: "individual" });
    state.sheet = null;
    if (state.mode === "bundled") {
      state.screen = "bundle";
      state.parent = fresh()[0] ?? 0;
      for (const i of fresh()) if (state.attached[i] === undefined) state.attached[i] = true;
      state.attached[state.parent] = false;
    } else {
      state.screen = "preview";
      state.sheet = "previewAsk";
    }
    render();
  }));
  el("ask-skip") && (el("ask-skip").addEventListener("click", () => {
    if (el("remember-preview")?.checked) savePrefs({ preview: "never" });
    state.sheet = null;
    void submit();
  }));
  el("ask-preview") && (el("ask-preview").addEventListener("click", () => {
    if (el("remember-preview")?.checked) savePrefs({ preview: "always" });
    state.sheet = null;
    state.screen = "preview";
    render();
  }));
}

function openPrefs() {
  state.sheetReturn = state.screen === "prefs" ? "entry" : state.screen;
  state.screen = "prefs";
  render();
}

function resetFlow() {
  state.screen = "entry";
  state.sheet = null;
  state.mode = null;
  state.parent = fresh()[0] ?? 0;
  state.attached = {};
  state.openEdit = undefined;
  state.result = null;
  seedEdits();
}

/* ── Simulator (`?demo=1`) ─────────────────────────────────────────────────── */

const DEMO_CLIENTS = [
  { id: "demo-umbrella", name: "Umbrella Corp", domain: "umbrellacorp.net" },
  { id: "demo-northwind", name: "Northwind Traders", domain: "northwind.example" },
  { id: "demo-contoso", name: "Contoso Ltd", domain: "contoso.com" },
];

const DEMO_BOARDS = [
  { id: "demo-service-desk", name: "Service Desk" },
  { id: "demo-projects", name: "Projects" },
  { id: "demo-onboarding", name: "Onboarding" },
];

/** The example messages, in the shape `readSelection` produces, so the pane treats them alike. */
const DEMO_INBOX = {
  vpn: {
    internetMessageId: "<demo-vpn@simulator.invalid>",
    from: "jane.holt@umbrellacorp.net", fromName: "Jane Holt", hasAttachment: false,
    subject: "VPN keeps dropping on the 3rd floor",
    bodyText: "Hi team,\n\nSince yesterday afternoon the VPN drops every few minutes on the third floor. It reconnects on its own but it interrupts calls.\n\nNothing changed on our side that I know of.\n\nThanks,\nJane",
  },
  starter: {
    internetMessageId: "<demo-starter@simulator.invalid>",
    from: "marcus.reed@northwind.example", fromName: "Marcus Reed", hasAttachment: true,
    subject: "New starter setup for next Monday",
    bodyText: "Morning,\n\nWe have a new starter joining the finance team on Monday. Could you set up a laptop, a mailbox and access to the shared drive?\n\nHis details are in the attached form.\n\nRegards,\nMarcus",
  },
  invoice: {
    internetMessageId: "<demo-invoice@simulator.invalid>",
    from: "priya.raman@contoso.com", fromName: "Priya Raman", hasAttachment: false,
    subject: "Invoice 4471 question",
    bodyText: "Hi,\n\nInvoice 4471 looks like it has last month's support line on it twice. Can you check?\n\nPriya",
    alreadyTicketed: true,
  },
  portal: {
    internetMessageId: "<demo-portal@simulator.invalid>",
    from: "tom.baker@gmail.example", fromName: "Tom Baker", hasAttachment: false,
    subject: "Can't log into the portal",
    bodyText: "Hi, I'm locked out of the customer portal. It says my code has expired but I only just got it.\n\nTom",
  },
  firewall: {
    internetMessageId: "<demo-firewall@simulator.invalid>",
    from: "sara.lee@unknownco.example", fromName: "Sara Lee", hasAttachment: true,
    subject: "Renewal quote for the firewall",
    bodyText: "Hello,\n\nOur firewall licence is up for renewal next month. Could you send over a quote?\n\nSara",
  },
};

const DEMO_SCENARIOS = [
  { id: "single", label: "One email", messages: ["vpn"], hint: "One message selected." },
  { id: "several", label: "Three", messages: ["vpn", "starter", "invoice"], hint: "Three messages, one already ticketed." },
  { id: "mixed", label: "Five, two unmatched", messages: ["vpn", "starter", "portal", "firewall", "invoice"], hint: "Five messages, two from senders with no matching client." },
];

let demoScenario = "several";

const demoSelection = () =>
  (DEMO_SCENARIOS.find((s) => s.id === demoScenario) || DEMO_SCENARIOS[1]).messages.map((key) => ({ ...DEMO_INBOX[key] }));
const demoClientList = () => DEMO_CLIENTS.map(({ id, name }) => ({ id, name }));
const demoIsTicketed = (id) => Object.values(DEMO_INBOX).some((m) => m.internetMessageId === id && m.alreadyTicketed);

/**
 * What the server would say, worked out from the example messages.
 *
 * It mirrors `previewEmailFields` rather than inventing its own shape, because the pane reads these
 * fields — a demo that answered differently would demonstrate a flow the add-in does not have.
 */
function demoPreview(email) {
  const domain = (email.from || "").split("@")[1] || "";
  // The simulator's consumer-domain stand-in: Gmail addresses match no client, which is the case
  // worth showing, because that is where the ticket ends up under a client nobody chose.
  const matchable = domain && !/^gmail\./.test(domain) ? domain : "";
  const matched = DEMO_CLIENTS.find((c) => c.domain === matchable) || null;
  const title = (email.subject || "").replace(/^(re|fw|fwd)\s*:\s*/i, "") || "(no subject)";
  const body = (email.bodyText || "").trim();
  return {
    key: email.internetMessageId,
    subject: email.subject || "",
    alreadyHasTicket: Boolean(email.alreadyTicketed),
    title,
    description: body || "(no message body)",
    priority: /\b(urgent|locked out|drops every|failing|critical)\b/i.test(`${title}\n${body}`) ? "High" : "Normal",
    matchedCompany: matched ? { id: matched.id, name: matched.name } : null,
    fallbackCompany: matched ? null : { id: DEMO_CLIENTS[0].id, name: DEMO_CLIENTS[0].name },
    // The simulator has no contact records, so a name is offered and nothing is attached to it.
    matchedContact: null,
    contactName: [email.fromName, email.from || ""].filter(Boolean)[0]?.replace(/[._]/g, " ") || "",
  };
}

/** Ticket numbers that look like the real ones and are plainly not: the board's initials plus 1001. */
function demoNumber(boardId, n) {
  const board = DEMO_BOARDS.find((b) => b.id === boardId) || DEMO_BOARDS[0];
  const prefix = board.name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3);
  return `${prefix}-1001-${1000 + n}`;
}

function demoCreate(body) {
  const emails = body.emails || [];
  const slug = (s) => String(s || "message").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "message";

  if (body.mode === "bundled") {
    const parent = emails.find((e) => e.internetMessageId === body.parentMessageId) || emails[0];
    if (!parent) return { created: 0, skipped: [], bundled: true, results: [], attachments: [] };
    const attached = emails.filter((e) => e !== parent);
    return {
      created: 1,
      skipped: [],
      tickets: ["demo-bundled-1"],
      bundled: true,
      results: [
        { subject: parent.subject, ticketId: "demo-bundled-1", ticketNumber: demoNumber(body.boardId, 1) },
        ...attached.map((e) => ({ subject: e.subject, attached: true })),
      ],
      attachments: attached.map((e) => ({ subject: e.subject, filename: `${slug(e.subject)}.eml` })),
    };
  }

  let n = 0;
  const results = emails.map((e) => {
    if (demoIsTicketed(e.internetMessageId)) return { subject: e.subject, reason: "already has a ticket" };
    n += 1;
    return { subject: e.subject, ticketId: `demo-ticket-${n}`, ticketNumber: demoNumber(body.boardId, n) };
  });
  return {
    created: n,
    skipped: results.filter((r) => r.reason).map((r) => r.subject),
    tickets: results.filter((r) => r.ticketId).map((r) => r.ticketId),
    bundled: false,
    results,
  };
}

/** The simulator's stand-in for the API. A short delay so the working states are visible. */
async function demoAnswer(path, options = {}) {
  await new Promise((resolve) => setTimeout(resolve, 220));
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  if (path === "/outlook-addin/options") return { boards: DEMO_BOARDS, clients: demoClientList() };
  if (path === "/outlook-addin/preferences") return method === "PATCH" ? { ...state.prefs, ...body } : { ...state.prefs };
  if (path === "/outlook-addin/preview") return { messages: (body.emails || []).map(demoPreview) };
  if (path === "/outlook-addin/tickets") return demoCreate(body);
  throw new Error(`The simulator does not answer ${path}`);
}

/** The strip that says this is not real and lets the simulated selection be changed. */
function demoStrip() {
  const strip = el("demo");
  if (!DEMO) return;
  strip.hidden = false;
  strip.innerHTML = `
    <p class="demo-note">Simulator — the real add-in pane, with example messages. Nothing is created, sent or saved.</p>
    <div class="demo-row">
      ${DEMO_SCENARIOS.map((s) => `<button data-demo="${s.id}" aria-pressed="${s.id === demoScenario}" type="button">${escapeHtml(s.label)}</button>`).join("")}
    </div>
    <p class="hint" style="margin:0">${escapeHtml((DEMO_SCENARIOS.find((s) => s.id === demoScenario) || {}).hint || "")}</p>
    <div class="demo-row"><button data-demo-restart type="button">Start this selection again</button></div>`;
  strip.querySelectorAll("[data-demo]").forEach((button) => button.addEventListener("click", async () => {
    demoScenario = button.dataset.demo;
    await loadDemo();
  }));
  strip.querySelector("[data-demo-restart]").addEventListener("click", () => void loadDemo());
}

/** Load the simulated selection and its answers, then start the flow from the top. */
async function loadDemo() {
  state.items = demoSelection();
  state.boards = DEMO_BOARDS;
  state.clients = demoClientList();
  state.boardId = state.boards[0].id;
  state.ready = true;
  const preview = await api("/outlook-addin/preview", { method: "POST", body: JSON.stringify({ emails: state.items }) });
  state.preview = preview.messages || [];
  state.sheet = null;
  resetFlow();
  demoStrip();
  render();
}

/* ── Start ────────────────────────────────────────────────────────────────── */

async function afterSignIn() {
  el("signin").hidden = true;
  el("signin-error").hidden = true;
  el("signout").hidden = false;
  el("prefs-open").hidden = false;
  el("panel").hidden = false;

  state.items = await readSelection();
  state.ready = Boolean(Office?.context?.mailbox);

  try {
    const [options, preferences] = await Promise.all([
      api("/outlook-addin/options"),
      api("/outlook-addin/preferences"),
    ]);
    state.boards = options.boards || [];
    state.clients = options.clients || [];
    state.prefs = { ...state.prefs, ...preferences };
  } catch (err) {
    el("body").innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    return;
  }

  const remembered = state.prefs.rememberBoard && state.prefs.lastBoardId;
  state.boardId = (remembered && state.boards.some((b) => b.id === remembered) ? remembered : state.boards[0]?.id) || "";

  // Ask the server what each message would become before showing anything: the client and contact
  // matches are its answers, and the duplicate flags are what the row says "Has a ticket" from.
  if (state.items.length) {
    try {
      const preview = await api("/outlook-addin/preview", {
        method: "POST",
        body: JSON.stringify({ emails: state.items }),
      });
      state.preview = preview.messages || [];
    } catch (err) {
      state.preview = [];
      console.warn("[C7NTAX add-in] Could not preview the selection:", err.message);
    }
  }

  resetFlow();
  render();
}

async function start() {
  el("signin-submit").addEventListener("click", signIn);
  el("password").addEventListener("keydown", (e) => { if (e.key === "Enter") signIn(); });
  el("signout").addEventListener("click", () => signOut());

  if (DEMO) {
    // No account, no mailbox and no server: the point is the flow, and asking for credentials to
    // look at it would defeat that.
    document.title = "C7NTAX — Email to ticket (simulator)";
    el("signin").hidden = true;
    el("panel").hidden = false;
    el("prefs-open").hidden = false;
    el("signout").hidden = true;
    await loadDemo();
    return;
  }

  if (!state.token) {
    el("signin").hidden = false;
    return;
  }
  try {
    await afterSignIn();
  } catch (err) {
    signOut(err.message);
  }
}

if (typeof Office !== "undefined" && Office.onReady) {
  Office.onReady(() => { state.ready = Boolean(Office.context?.mailbox); void start(); });
} else {
  // Opened in a plain browser: the panel still renders so the screen can be looked at, and it says
  // why it cannot do anything rather than failing silently.
  void start();
}
