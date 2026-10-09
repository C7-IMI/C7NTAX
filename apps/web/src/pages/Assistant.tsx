import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import {
  Bot, Send, Loader2, Sparkles, AlertTriangle, ChevronDown, ChevronRight, Plug,
  ArrowUpRight, Info, RefreshCw, ShieldCheck, Wrench,
} from "lucide-react";
import { PageHeader } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";

/**
 * The Assistant: ask the model something, and let it use this application's own functions to answer.
 *
 * The shape of the screen follows the shape of the feature: the prompt is one box, the answer is one
 * block, and underneath is the *receipt* — which functions ran, what they were asked and whether they
 * were allowed. That trace is the difference between an assistant you can rely on and one you cannot:
 * every fact in the answer above came from one of these, or the model made it up.
 */

interface AssistantStep {
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  summary: string;
  durationMs: number;
}

interface AssistantAnswer {
  answer: string;
  steps: AssistantStep[];
  provider: string;
  model: string;
  tokensUsed: number;
  modelCalls: number;
  stoppedBecause: "answered" | "step-limit" | "not-configured" | "failed";
  detail: string | null;
  functionsOffered: boolean;
}

interface ModelStatus {
  connected: boolean;
  provider: string | null;
  providerLabel: string | null;
  model: string | null;
  name: string | null;
  appFunctions: boolean;
  toolCalling: boolean | "model-dependent";
}

interface ToolEntry {
  name: string;
  kind: "read" | "propose";
  permission: string;
  description: string;
}

/** The API returns { error: { message, status } }; show the message, not the object. */
function errText(e: any, fallback: string): string {
  const raw = e?.response?.data?.error;
  return (typeof raw === "string" ? raw : raw?.message) || e?.message || fallback;
}

/** A function's name as a sentence, for the receipt. */
const toolLabel = (name: string) => name.replace(/_/g, " ");

function ArgumentList({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) return <span className="text-gray-600">no arguments</span>;
  return (
    <span className="font-mono text-[11px] text-gray-400">
      {entries.map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join(" · ")}
    </span>
  );
}

export function AssistantPage() {
  const redesign = useRedesign();
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [maxSteps, setMaxSteps] = useState(6);
  const [prompt, setPrompt] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AssistantAnswer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const [statusRes, toolsRes] = await Promise.all([
        api.get("/inference/status"),
        api.get("/inference/tools"),
      ]);
      setStatus(statusRes.data ?? null);
      setTools(toolsRes.data?.tools ?? []);
      setMaxSteps(toolsRes.data?.maxSteps ?? 6);
    } catch (e) {
      toast.error(errText(e, "Could not read the model status"));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { boxRef.current?.focus(); }, []);

  const ask = async () => {
    const question = prompt.trim();
    if (!question || asking) return;
    setAsking(true);
    setFailure(null);
    setResult(null);
    setExpanded(null);
    try {
      const res = await api.post("/inference/assist", { prompt: question });
      setResult(res.data as AssistantAnswer);
    } catch (e: any) {
      const message = errText(e, "The model could not be reached");
      // A missing model is a setup problem, not an error: it gets a sentence with a way to fix it
      // rather than a red toast somebody can only dismiss.
      setFailure(message);
    } finally {
      setAsking(false);
      void load();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void ask();
    }
  };

  const noModel = !!status && !status.connected;

  return (
    <div className="space-y-5 animate-fade-in max-w-4xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          variant="section"
          icon={<Bot size={18} className="text-cyber-400" />}
          title="Assistant"
          subtitle="Ask a question about what is in C7NTAX. The model can look things up itself, under your permissions."
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="btn-secondary p-2"
            title="Reload the model status"
            aria-label="Reload the model status"
          >
            <RefreshCw size={14} />
          </button>
          <Link to="/c7nc/models" className="btn-secondary text-xs flex items-center gap-1.5">
            <Plug size={13} /> AI models
          </Link>
        </div>
      </div>

      {/* Which model answers, and what it is allowed to do — before the prompt, not after. */}
      <div className={`card border ${noModel ? "border-amber-500/20" : status?.appFunctions ? "border-cyber-500/20" : "border-surface-border"}`}>
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${status?.appFunctions ? "bg-cyber-600/10" : "bg-surface-lighter"}`}>
            {status?.appFunctions ? <Wrench size={16} className="text-cyber-400" /> : <Info size={16} className="text-gray-500" />}
          </div>
          <div className="min-w-0">
            {noModel ? (
              <>
                <p className="text-sm font-medium text-white">No model is connected</p>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                  Connect one in <Link to="/c7nc/models" className="text-cyber-400 hover:text-cyber-300">C7NC → AI models</Link> and make it
                  the model the application uses. The key stays on the server.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-white">
                  {status?.providerLabel ?? status?.provider}{status?.model ? ` · ${status.model}` : ""}
                </p>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                  {status?.appFunctions
                    ? `It may call this application's functions while it answers, up to ${maxSteps} rounds, as you — so it can only see what you can see. Anything that would change data is proposed for approval instead of done.`
                    : "This connection is not allowed to call application functions, so it can only answer from what you type. Turn on “May perform app functions” on the connection to let it look things up."}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* The prompt */}
      <div className="card space-y-3">
        <textarea
          ref={boxRef}
          className="input-field min-h-[92px] resize-y font-normal"
          placeholder={"e.g. What is going on with Contoso this week?\nOr: which managed services have an open incident right now?"}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={noModel}
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[11px] text-gray-500">⌘/Ctrl + Enter to ask. The question and what it looked up are recorded in the audit trail.</span>
          <div className="flex items-center gap-2">
            {prompt ? <button onClick={() => { setPrompt(""); setResult(null); setFailure(null); }} className="btn-secondary text-xs">Clear</button> : null}
            <button onClick={() => void ask()} disabled={asking || !prompt.trim() || !!noModel} className="btn-primary flex items-center gap-2">
              {asking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {asking ? "Thinking…" : "Ask"}
            </button>
          </div>
        </div>
      </div>

      {/* What it can look at, so the question can be aimed */}
      {tools.length ? (
        <div className="card">
          <button onClick={() => setShowTools(v => !v)} className="w-full flex items-center justify-between gap-3 text-left">
            <span className="text-sm text-gray-300 flex items-center gap-2">
              {showTools ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              What it can look up, as you
            </span>
            <span className={redesign ? "text-[11px] text-gray-500 tabular-nums" : "text-[11px] text-gray-500"}>{tools.length} functions · {tools.filter(t => t.kind === "propose").length} propose changes</span>
          </button>
          {showTools ? (
            <div className="mt-3 space-y-1.5">
              {tools.map(tool => (
                <div key={tool.name} className="flex items-start gap-2 text-xs">
                  {redesign ? (
                    <span className={`chip text-[10px] ${tool.kind === "read" ? "" : "chip--warn"}`}>
                      {tool.kind === "read" ? "reads" : "proposes"}
                    </span>
                  ) : (
                    <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] ${tool.kind === "read" ? "bg-surface-lighter text-gray-400" : "bg-cyber-600/10 text-cyber-300"}`}>
                      {tool.kind === "read" ? "reads" : "proposes"}
                    </span>
                  )}
                  <span className="text-gray-300 font-mono">{tool.name}</span>
                  <span className="text-gray-500 leading-relaxed">{tool.description.split(".")[0]}.</span>
                </div>
              ))}
              <p className="text-[11px] text-gray-500 pt-1">
                Every function runs as you, and each one needs the same permission its screen does.
                {tools.some(t => t.kind === "propose") ? " Proposals appear under AI Actions for somebody to approve." : ""}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Setup problem, with the way out of it */}
      {failure ? (
        <div className="card border border-amber-500/20">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-white">{failure}</p>
              <p className="text-xs text-gray-400 mt-1">
                Check the connection in <Link to="/c7nc/models" className="text-cyber-400 hover:text-cyber-300">C7NC → AI models</Link> — Test
                connection asks the vendor whether the key works and shows what it said.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* The answer */}
      {asking && !result ? (
        <div className="card flex items-center gap-3 text-gray-400 text-sm">
          <Loader2 size={16} className="animate-spin text-cyber-400" />
          {status?.appFunctions ? "Thinking, and looking things up if it needs to…" : "Thinking…"}
        </div>
      ) : null}

      {result ? (
        <>
          {result.stoppedBecause === "failed" ? (
            <div className="card border border-red-500/20">
              <div className="flex items-start gap-3">
                <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-white">The model did not answer</p>
                  <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                    {result.detail ?? "No reason was given."} — this is the vendor's own answer, and it is the useful part: a rejected key, a
                    model that does not exist for this key, or a vendor quota.
                  </p>
                  <p className={redesign ? "text-[11px] text-gray-500 mt-1 tabular-nums" : "text-[11px] text-gray-500 mt-1"}>
                    {result.provider}{result.model ? ` · ${result.model}` : ""} · {result.modelCalls} call{result.modelCalls === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                  <Sparkles size={13} className="text-cyber-400" /> Answer
                </h3>
                <span className={redesign ? "text-[11px] text-gray-500 tabular-nums" : "text-[11px] text-gray-500"}>
                  {result.provider}{result.model ? ` · ${result.model}` : ""} · {result.modelCalls} call{result.modelCalls === 1 ? "" : "s"}
                  {result.tokensUsed ? ` · ${result.tokensUsed} tokens` : ""}
                </span>
              </div>
              <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed mt-3">{result.answer || "(the model answered with nothing)"}</p>
              {result.stoppedBecause === "step-limit" ? (
                <p className="text-[11px] text-amber-300 mt-3">
                  Stopped after {maxSteps} rounds of looking things up — the answer above may be incomplete. Ask something narrower to get to the
                  bottom of it.
                </p>
              ) : null}
            </div>
          )}

          {/* The receipt */}
          {result.steps.length ? (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">What it looked up</h3>
              <div className="mt-3 space-y-1.5">
                {result.steps.map((step, index) => (
                  <div key={`${step.tool}-${index}`} className="border border-surface-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpanded(expanded === index ? null : index)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-lighter transition-colors"
                    >
                      {expanded === index ? <ChevronDown size={13} className="text-gray-500" /> : <ChevronRight size={13} className="text-gray-500" />}
                      {step.ok
                        ? <ShieldCheck size={13} className="text-emerald-400 shrink-0" />
                        : <AlertTriangle size={13} className="text-amber-400 shrink-0" />}
                      <span className="text-xs font-mono text-gray-300">{toolLabel(step.tool)}</span>
                      <span className="text-xs text-gray-500 truncate flex-1">{step.summary}</span>
                      <span className={redesign ? "text-[10px] text-gray-600 shrink-0 tabular-nums" : "text-[10px] text-gray-600 shrink-0"}>{step.durationMs}ms</span>
                    </button>
                    {expanded === index ? (
                      <div className="px-3 pb-2 pt-0.5 border-t border-surface-border">
                        <p className="mt-2"><ArgumentList args={step.arguments} /></p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-3">
                These are the application's own functions, run as you. {result.functionsOffered ? "" : "This model is not permitted to call them, so this list should be empty."}
                {result.steps.some(s => !s.ok) ? " A refused or failed call is shown so you can see what the answer could not have known." : ""}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">
                Anything it proposed is waiting under <Link to="/ai-actions" className="text-cyber-400 hover:text-cyber-300 inline-flex items-center gap-0.5">AI Actions <ArrowUpRight size={10} /></Link> — nothing has been changed by asking.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
