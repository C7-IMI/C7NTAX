/**
 * The Email Studio — every message this instance sends: the words, who receives it, and what happened to
 * the last few.
 *
 * The subtitle is the sentence `Layout.tsx`'s `SECTION_DESCRIPTIONS` carries for `/admin/email`, word for
 * word, because the classic header reads that map and the two must not describe this page differently.
 *
 * Five surfaces, because merging them is how a template editor gets ruined:
 *
 *  · **Messages** — the list. Every key the vocabulary holds, with its trigger, its reader, its subject
 *    *as written*, and whether anybody has changed it.
 *  · **Editor** — a palette, a canvas and an inspector over one message, with the choice of *what gets
 *    sent* kept out of the canvas and the plain-text part beside the blocks it is derived from.
 *  · **Preview** — one renderer, two widths, against a real record, with the text part and the
 *    attachments in panes of their own.
 *  · **History & reset** — what it said before, who changed it, and the way back to the code's version.
 *  · **What an internal message is not** — the distinction the code already draws, quoted.
 *
 * **What this page does when the API is not there.** `/api/email` is being built in parallel with this
 * screen, so every read is allowed to fail and is *reported* rather than smoothed over: the list says
 * which read failed and labels the rows it still draws as the code's own facts; the editor opens the
 * code's transcribed body and says that is what it is; and the preview draws **nothing** at all, because
 * there is one renderer and a second one written here to fill the gap is exactly how a preview stops
 * being the message that goes out.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Permission, type EmailBlock, type EmailMessageKey } from "@C7NTAX/shared";
import { PageHeader, Tabs } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { normaliseList, useEmailMessages } from "../components/email/emailApi";
import {
  codeTemplateForKey,
  requestPreview,
  resetEmailTemplate,
  saveEmailTemplate,
  sendTemplateTest,
  useEmailTemplate,
  useEmailVersions,
  versionsFrom,
  type PreviewState,
} from "../components/email/emailStudioApi";
import { buildMessageRows } from "../components/email/emailMessageRow";
import { useEmailRecordIds } from "../components/email/emailRecordIds";
import { EmailMessageList } from "../components/email/EmailMessageList";
import { EmailEditor } from "../components/email/EmailEditor";
import { EmailPreviewPanel } from "../components/email/EmailPreviewPanel";
import { EmailHistoryPanel } from "../components/email/EmailHistoryPanel";
import { EmailInternalPanel } from "../components/email/EmailInternalPanel";
import { CONTENT_SWITCHES } from "../components/email/emailCodeV0";
import { derivePlainText } from "../components/email/emailBlocks";
import { resolveFields } from "../components/email/emailRecords";
import { EMAIL_FACTS_BY_KEY } from "../components/email/emailCatalogue";
import { setRegisteredFields } from "../components/email/emailFieldRegistry";

type StudioTab = "messages" | "editor" | "preview" | "history" | "internal";

/** The override ladder, with this instance's own boards and clients named in it. */
const OVERRIDES = [
  { level: "1 · Instance", scope: "everything", message: "", state: "inherits" },
  {
    level: "2 · Board",
    scope: "Infrastructure Desk · Intelligence Desk · MSP Service Desk · NOC Alerts",
    message: "none",
    state: "inherits",
  },
  {
    level: "3 · Client",
    scope: "Acme Corporation · Globex Industries · Initech Solutions · Stark Enterprises · Umbrella Corp",
    message: "none",
    state: "inherits",
  },
  { level: "4 · Language", scope: "shown only when a language other than the instance default is enabled", message: "none", state: "inherits" },
];

export function EmailStudioPage() {
  const { user, permissions } = useAuth();
  const canManage = permissions.includes(Permission.EmailManage);
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as StudioTab | null) ?? "messages";
  const selectedKey = (params.get("key") as EmailMessageKey | null) ?? "ticket.activity";

  // ── Reads ──────────────────────────────────────────────────────────────────────────────────────
  const messagesRead = useEmailMessages();
  const templateRead = useEmailTemplate(selectedKey);
  const versionsRead = useEmailVersions(selectedKey);

  const apiMessages = useMemo(
    () => (messagesRead.status === "ok" ? normaliseList<Record<string, unknown>>(messagesRead.data, "messages") : null),
    [messagesRead.status, messagesRead.data],
  );
  const { rows, fromCode } = useMemo(() => buildMessageRows(apiMessages), [apiMessages]);
  const fact = EMAIL_FACTS_BY_KEY[selectedKey];

  /*
   * The API's field registry, which is wider than the shared vocabulary's 21: it carries the computed
   * fields a template function assembles at send time. Registering it once, from the one read that owns
   * it, is what lets the canvas label `{{message.greeting}}` as a field the sender builds rather than as a
   * field that does not exist.
   */
  useEffect(() => {
    if (!apiMessages) return;
    setRegisteredFields(apiMessages.map((row) => row.fields));
  }, [apiMessages]);

  // ── The draft ──────────────────────────────────────────────────────────────────────────────────
  const [subject, setSubject] = useState("");
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);
  const [text, setText] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [source, setSource] = useState<"api" | "code">("code");
  const [sourceFailure, setSourceFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [switches, setSwitches] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CONTENT_SWITCHES.map((entry) => [entry.id, entry.on])),
  );
  const [recordId, setRecordId] = useState<string | null>("MSP-02-2013");
  const [preview, setPreview] = useState<PreviewState>({ status: "idle", data: null, message: null });
  const [testState, setTestState] = useState<{
    status: "idle" | "sending" | "ok" | "unavailable";
    message: string | null;
  }>({ status: "idle", message: null });
  const [testAddress, setTestAddress] = useState("");
  const [renderNonce, setRenderNonce] = useState(0);

  /*
   * The draft is initialised from the API's template when it answers, and from the **code's own body**
   * when it does not — the same body `GET /templates/:key` would import read-only as v0. `source` records
   * which of the two the editor is showing, and the editor prints it, so a transcription is never
   * mistaken for something somebody saved.
   */
  useEffect(() => {
    if (templateRead.status === "loading") return;
    if (templateRead.status === "ok" && templateRead.data) {
      setSubject(templateRead.data.subject ?? "");
      setBlocks(Array.isArray(templateRead.data.blocks) ? templateRead.data.blocks : []);
      setText(templateRead.data.text ?? null);
      setSource("api");
      setSourceFailure(null);
    } else {
      const fallback = codeTemplateForKey(selectedKey);
      setSubject(fallback.subject ?? "");
      setBlocks(fallback.blocks);
      setText(null);
      setSource("code");
      setSourceFailure(templateRead.message ?? "This template could not be read");
    }
    setDirty(false);
    setSaveMessage(null);
  }, [templateRead.status, templateRead.data, templateRead.message, selectedKey]);

  useEffect(() => {
    if (!testAddress && user?.email) setTestAddress(user.email);
  }, [user?.email, testAddress]);

  /*
   * The text part is derived here from the *current blocks*, which is what makes it a first-class pane
   * rather than a snapshot: it moves as the blocks move, and it cannot carry a fact the blocks do not.
   * The preview pane shows the API's own `derivedText` and `text` instead, because the pair that will be
   * sent is the renderer's answer.
   */
  const derivedText = useMemo(
    () => derivePlainText(blocks, (value) => resolveFields(value, recordId)),
    [blocks, recordId],
  );

  const versions = useMemo(() => versionsFrom(versionsRead), [versionsRead]);

  // ── The preview: one renderer, debounced, never faked ───────────────────────────────────────────
  /**
   * The record's id, resolved from its number — see `emailRecordIds.ts`. The *names* the chooser offers
   * are the numbers a person reads (MSP-02-2013, INV-2026-002), and the endpoint resolves fields by id.
   */
  const resolve = useEmailRecordIds();
  const targetId = recordId ? resolve.ids[recordId] ?? recordId : null;

  const render = useCallback(async () => {
    setPreview((current) => ({ ...current, status: "loading", message: null }));
    const result = await requestPreview({ key: selectedKey, subject, blocks, text, recordId, targetId });
    if (result.ok) setPreview({ status: "ok", data: result.answer, message: null });
    else setPreview({ status: "unavailable", data: null, message: result.message });
  }, [selectedKey, subject, blocks, text, recordId, targetId, renderNonce]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void render();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [render]);

  // ── Writes ─────────────────────────────────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    setSaveMessage(null);
    const result = await saveEmailTemplate(selectedKey, { subject, blocks, text });
    setSaving(false);
    if (result.ok) {
      setDirty(false);
      setSaveMessage("Saved. A version was written, and the code's own body stays as the default.");
      templateRead.reload();
      versionsRead.reload();
    } else {
      setSaveMessage(result.message ?? "The template could not be saved.");
    }
  };

  const reset = async () => {
    setBusy(true);
    const result = await resetEmailTemplate(selectedKey);
    setBusy(false);
    if (result.ok) {
      setSaveMessage("Reset to the body the code writes. A version was written, so nothing is lost.");
      templateRead.reload();
      versionsRead.reload();
    } else {
      setSaveMessage(result.message ?? "The template could not be reset.");
    }
  };

  const restore = (version: number) => {
    const stored = versions.find((entry) => entry.version === version);
    const fallback = codeTemplateForKey(selectedKey);
    const body =
      version === 0 || !stored
        ? { subject: fallback.subject ?? "", blocks: fallback.blocks, text: null as string | null }
        : { subject: stored.subject, blocks: stored.blocks, text: stored.text };
    setSubject(body.subject);
    setBlocks(body.blocks);
    setText(body.text);
    setDirty(true);
    setSaveMessage(
      `v${version} is in the editor as an unsaved draft. Save it to write a new version; nothing is deleted.`,
    );
  };

  const sendTest = async (to: string) => {
    setTestState({ status: "sending", message: null });
    const result = await sendTemplateTest(selectedKey, to.trim());
    if (result.ok) {
      setTestState({
        status: "ok",
        message: `The API accepted the test${
          result.payload?.messageId ? ` — messageId ${result.payload.messageId}` : ""
        }. A messageId is all the mail library returns, and it is all this screen can honestly claim.`,
      });
    } else {
      setTestState({ status: "unavailable", message: result.message ?? "The test send was refused." });
    }
  };

  const openMessage = (key: EmailMessageKey) => {
    const next = new URLSearchParams(params);
    next.set("key", key);
    next.set("tab", "editor");
    setParams(next, { replace: true });
  };

  const neverSent = rows.filter((row) => !row.live).length;
  const changedFromCode = rows.filter((row) => row.state !== "default").length;
  const overrides = OVERRIDES.map((row) => ({
    ...row,
    message: row.level.startsWith("1") ? selectedKey : row.message,
    state: row.level.startsWith("1") ? (source === "api" ? "this instance" : "the code's default") : "inherits",
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Email Studio"
        subtitle="Every message this instance sends: the words, who receives it, and what happened to the last few."
        icon={<Mail size={16} className="text-cyber-400" />}
      />

      <Tabs
        items={[
          { id: "messages" as StudioTab, label: "Messages", count: rows.length },
          { id: "editor" as StudioTab, label: "Editor" },
          { id: "preview" as StudioTab, label: "Preview" },
          { id: "history" as StudioTab, label: "History & reset" },
          { id: "internal" as StudioTab, label: "What an internal message is not" },
        ]}
        value={tab}
        onChange={(id) => {
          const next = new URLSearchParams(params);
          next.set("tab", id);
          setParams(next, { replace: true });
        }}
        label="Email Studio sections"
      />

      {tab === "messages" && (
        <EmailMessageList
          rows={rows}
          selectedKey={selectedKey}
          onOpen={openMessage}
          loading={messagesRead.status === "loading"}
          failure={messagesRead.status === "unavailable" ? messagesRead.message : null}
          onRetry={messagesRead.reload}
          fromCode={fromCode}
        />
      )}

      {tab === "editor" && (
        <EmailEditor
          messageKey={selectedKey}
          fact={fact}
          subject={subject}
          onSubject={(value) => {
            setSubject(value);
            setDirty(true);
          }}
          blocks={blocks}
          onBlocks={(next) => {
            setBlocks(next);
            setDirty(true);
          }}
          text={text}
          onText={(next) => {
            setText(next);
            setDirty(true);
          }}
          derivedText={derivedText}
          recordId={recordId}
          onOpenPreview={() => {
            const next = new URLSearchParams(params);
            next.set("tab", "preview");
            setParams(next, { replace: true });
          }}
          canManage={canManage}
          dirty={dirty}
          source={source}
          sourceFailure={sourceFailure}
          saving={saving}
          saveMessage={saveMessage}
          onSave={() => {
            void save();
          }}
          onReset={() => {
            void reset();
          }}
          onDiscard={() => {
            templateRead.reload();
            setDirty(false);
            setSaveMessage(null);
          }}
          switches={switches}
          onToggleSwitch={(id, on) => setSwitches((current) => ({ ...current, [id]: on }))}
          overrides={overrides}
        />
      )}

      {tab === "preview" && (
        <div className="space-y-4">
          <p className="text-[11.5px] leading-relaxed text-gray-500">
            Editing <code className="font-mono text-gray-400">{selectedKey}</code> — {fact?.name ?? "not stated"}. The
            figures and names in the frame are the chosen record&apos;s, not samples.
            {resolve.failure ? <span className="text-alert-amber"> {resolve.failure}</span> : null}
          </p>
          <EmailPreviewPanel
            messageKey={selectedKey}
            messageName={fact?.name ?? null}
            subject={subject}
            blocks={blocks}
            derivedText={derivedText}
            recordId={recordId}
            onRecord={setRecordId}
            preview={preview}
            onRender={() => setRenderNonce((nonce) => nonce + 1)}
            attachmentsAllowed={fact?.attachments ?? null}
            canManage={canManage}
            testState={testState}
            onTest={(to) => {
              void sendTest(to);
            }}
            testAddress={testAddress}
            onTestAddress={setTestAddress}
          />
        </div>
      )}

      {tab === "history" && (
        <EmailHistoryPanel
          messageKey={selectedKey}
          versions={versions}
          versionsReading={versionsRead.status === "loading"}
          versionsFailure={versionsRead.status === "unavailable" ? versionsRead.message : null}
          onRetryVersions={versionsRead.reload}
          subject={subject}
          blocks={blocks}
          stateLabel={source === "api" ? "read from the API" : "the code's own version"}
          canManage={canManage}
          onRestore={restore}
          onReset={() => {
            void reset();
          }}
          overrides={overrides}
          busy={busy}
        />
      )}

      {tab === "internal" && <EmailInternalPanel />}

      <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-surface-border pt-3 text-[11px] text-gray-600">
        <span>{rows.length} keys</span>
        <span>·</span>
        <span>{rows.length - neverSent} live senders</span>
        <span>·</span>
        <span>{neverSent} written and never called</span>
        <span>·</span>
        <span>changed from the code: {changedFromCode}</span>
        {fromCode ? <span>· the live template state could not be read, so the code&apos;s own state is shown</span> : null}
      </footer>
    </div>
  );
}
