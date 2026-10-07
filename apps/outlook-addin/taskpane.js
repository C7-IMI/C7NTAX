/**
 * C7NTAX Outlook add-in taskpane (PLAN-012).
 *
 * Reads the selected message — or several, when the reading pane has a multi-selection — turns each
 * into the same `ParsedEmail` shape the monitored-mailbox connector uses, and posts them to
 * `POST /api/outlook-addin/tickets`, which runs the identical deduction pipeline
 * (`services/emailToTicket.ts`). One contact-matching path, one dedup key, one ticket number series:
 * an add-in that built tickets its own way would be a second, quietly different behaviour for the
 * same email.
 *
 * It is dependency-free on purpose. An add-in runs inside a webview the host controls, so every
 * kilobyte is loaded on a slow cold start, and the Office.js CDN is the only script this file
 * waits for.
 */
/* global Office */

const TOKEN_KEY = "c7_addin_token";
const BOARD_KEY = "c7_addin_board";

const el = id => document.getElementById(id);
const state = { token: localStorage.getItem(TOKEN_KEY) || "", boards: [], items: [], ready: false };

/** The API lives on the same origin that serves this folder, so relative URLs are correct. */
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
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

function signOut(message) {
  state.token = "";
  localStorage.removeItem(TOKEN_KEY);
  el("signout").hidden = true;
  el("panel").hidden = true;
  el("signin").hidden = false;
  if (message) {
    el("signin-error").textContent = message;
    el("signin-error").hidden = false;
  }
}

/** Trims the body the way the connector does, so the ticket reads the same either way. */
function toText(value) {
  if (!value) return "";
  return String(value).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, 20000);
}

/** One Office.js message object into the payload shape the endpoint accepts. */
function messageToEmail(item) {
  const from = item.from || (item.sender ? { emailAddress: item.sender } : null);
  return {
    internetMessageId: item.internetMessageId || "",
    from: from?.emailAddress || "",
    fromName: from?.displayName || "",
    subject: item.subject || "(no subject)",
    bodyText: toText(item.body?.content || item.body || ""),
    receivedAt: item.dateTimeCreated ? new Date(item.dateTimeCreated).toISOString() : new Date().toISOString(),
  };
}

/**
 * The selected messages. `getSelectedItemsAsync` needs Mailbox 1.13 and is the only way to see a
 * multi-selection; older hosts and single-open messages fall back to `mailbox.item`, which is the
 * message actually being read.
 */
function readSelection() {
  return new Promise(resolve => {
    const mailbox = Office?.context?.mailbox;
    if (!mailbox) return resolve([]);
    const multi = typeof mailbox.getSelectedItemsAsync === "function";
    if (!multi) return resolve(mailbox.item ? [messageToEmail(mailbox.item)] : []);
    mailbox.getSelectedItemsAsync(result => {
      if (result.status === Office.AsyncResultStatus.Succeeded && result.value?.length) {
        resolve(result.value.map(messageToEmail));
        return;
      }
      // A single open message is not a "selection" to some hosts; fall back rather than showing none.
      resolve(mailbox.item ? [messageToEmail(mailbox.item)] : []);
    });
  });
}

function renderSelection() {
  const count = state.items.length;
  const box = el("selection");
  if (!state.ready) {
    box.innerHTML = "<strong>Open this pane from the C7NTAX button in Outlook.</strong><p class='muted small'>It needs a message to work from.</p>";
    el("create").disabled = true;
    return;
  }
  if (count === 0) {
    box.innerHTML = "<strong>No message selected.</strong><p class='muted small'>Select an email, or open one, and reopen this pane.</p>";
    el("create").disabled = true;
    return;
  }
  box.innerHTML = count === 1
    ? `<strong>${escapeHtml(state.items[0].subject || "(no subject)")}</strong><p class='muted small'>from ${escapeHtml(state.items[0].from || "unknown sender")}</p>`
    : `<strong>${count} messages selected</strong><p class='muted small'>One ticket will be created for each.</p>`;
  el("create").disabled = state.boards.length === 0;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadBoards() {
  const boards = await api("/boards");
  state.boards = (Array.isArray(boards) ? boards : []).filter(b => b.isActive !== false && b.enabled !== false);
  const select = el("board");
  select.innerHTML = "";
  for (const board of state.boards) {
    const option = document.createElement("option");
    option.value = board.id;
    option.textContent = board.name;
    select.appendChild(option);
  }
  // The board somebody used last is almost always the one they want again.
  const remembered = localStorage.getItem(BOARD_KEY);
  if (remembered && state.boards.some(b => b.id === remembered)) select.value = remembered;
}

function showResults(results) {
  const list = el("results");
  list.innerHTML = "";
  for (const result of results) {
    const li = document.createElement("li");
    if (result.ticketId) {
      const link = document.createElement("a");
      link.href = `/tickets/${result.ticketId}`;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = `${result.ticketNumber || "Ticket"} — ${result.subject || ""}`.trim();
      li.appendChild(link);
    } else {
      li.className = "skipped";
      li.textContent = `Skipped: ${result.subject || "a message already has a ticket"}${result.reason ? ` (${result.reason})` : ""}`;
    }
    list.appendChild(li);
  }
}

async function createTickets() {
  const boardId = el("board").value;
  if (!boardId) return;
  el("create").disabled = true;
  el("status").textContent = `Creating ${state.items.length === 1 ? "a ticket" : `${state.items.length} tickets`}…`;
  try {
    const data = await api("/outlook-addin/tickets", {
      method: "POST",
      body: JSON.stringify({ boardId, emails: state.items }),
    });
    localStorage.setItem(BOARD_KEY, boardId);
    showResults(data.results || []);
    el("status").textContent = `${data.created} created${data.skipped?.length ? `, ${data.skipped.length} skipped` : ""}.`;
  } catch (err) {
    el("status").textContent = `Could not create the ticket: ${err.message}`;
  } finally {
    el("create").disabled = false;
  }
}

async function afterSignIn(token) {
  state.token = token;
  localStorage.setItem(TOKEN_KEY, token);
  el("signin").hidden = true;
  el("signin-error").hidden = true;
  el("signout").hidden = false;
  el("panel").hidden = false;
  try {
    await loadBoards();
  } catch (err) {
    el("status").textContent = `Could not load the boards: ${err.message}`;
  }
  state.items = await readSelection();
  renderSelection();
}

async function signIn() {
  const email = el("email").value.trim();
  const password = el("password").value;
  el("signin-error").hidden = true;
  el("signin-submit").disabled = true;
  try {
    const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (data.mfaRequired) throw new Error("This account requires a second factor — sign in from the web app first");
    await afterSignIn(data.token);
  } catch (err) {
    el("signin-error").textContent = err.message;
    el("signin-error").hidden = false;
  } finally {
    el("signin-submit").disabled = false;
  }
}

function wire() {
  el("signin-submit").addEventListener("click", signIn);
  el("password").addEventListener("keydown", e => { if (e.key === "Enter") signIn(); });
  el("signout").addEventListener("click", () => signOut());
  el("create").addEventListener("click", createTickets);
}

async function start() {
  wire();
  if (!state.token) {
    el("signin").hidden = false;
    return;
  }
  await afterSignIn(state.token);
}

if (typeof Office !== "undefined" && Office.onReady) {
  Office.onReady(() => { state.ready = Boolean(Office.context?.mailbox); void start(); });
} else {
  // Opened in a plain browser: the panel still renders so the screen can be looked at, and it says
  // why it cannot do anything rather than failing silently.
  void start();
}
