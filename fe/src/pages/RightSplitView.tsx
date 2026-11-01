import { useCallback, useEffect, useRef, useState } from "react";
import "./RightSplitView.css";
import { AppSidebar } from "@/components/AppSidebar";
import {
  Activity,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Files,
  Folder,
  FolderOpen,
  GitMerge,
  GitPullRequest,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Save,
  Send,
  Square,
  Terminal,
} from "lucide-react";
import { navigate } from "@/lib/router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getSession,
  getConfiguredModelName,
  getSessionChanges,
  getSideChat,
  listWorkspaceFiles,
  mergePullRequest,
  readWorkspaceFile,
  resizeTerminal,
  sendTerminalInput,
  sendSideChatMessage,
  sendMessage,
  stopSession,
  subscribeToSession,
  subscribeToTerminal,
  startTerminal,
  writeWorkspaceFile,
} from "@/lib/api";
import type { LogEntry, Session, SessionStatus, SideChatMessage, WorkspaceEntry } from "@/lib/api";
import { getCachedSessions, listSessions } from "./apiPage";
import type { SessionSummary } from "./apiPage";

type WorkspacePanel = "files" | "changes" | "terminal" | "side-chat" | "progress";

const allPanels: { id: WorkspacePanel; label: string; description: string; icon: typeof Files; requiresSandbox?: boolean }[] = [
  { id: "files", label: "Files", description: "Browse the session workspace", icon: Files, requiresSandbox: true },
  { id: "changes", label: "Changes", description: "See the agent's file edits", icon: GitPullRequest, requiresSandbox: true },
  { id: "terminal", label: "Terminal", description: "Commands and output", icon: Terminal, requiresSandbox: true },
  { id: "side-chat", label: "Side chat", description: "Ask a follow-up question", icon: MessageCircle },
  { id: "progress", label: "Progress", description: "Understand the agent's work", icon: Activity },
];

const statusLabel: Record<SessionStatus, string> = {
  ready: "Ready",
  running: "Working",
  waiting_for_input: "Needs your answer",
  done: "Done",
  error: "Failed",
  stopped: "Stopped",
};

function appendIfNew(messages: Array<{ role: "user" | "assistant"; content: string }>, message: { role: "user" | "assistant"; content: string }) {
  const last = messages[messages.length - 1];
  if (last?.role === message.role && last.content === message.content) return messages;
  return [...messages, message];
}

export function RightSplitViewPage({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [recentSessions, setRecentSessions] = useState<SessionSummary[] | null>(() => getCachedSessions());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<SessionStatus>("ready");
  const [modelName, setModelName] = useState("GPT 5");
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; name: string }>>([{ id: "gpt-5", name: "GPT 5" }]);
  const [panel, setPanel] = useState<WorkspacePanel | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [retryingAnswer, setRetryingAnswer] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergingPullRequest, setMergingPullRequest] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileDraft, setFileDraft] = useState("");
  const [fileEditing, setFileEditing] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalReady, setTerminalReady] = useState(false);
  const [terminalSending, setTerminalSending] = useState(false);
  const [terminalError, setTerminalError] = useState("");
  const [sideMessages, setSideMessages] = useState<SideChatMessage[]>([]);
  const [sideDraft, setSideDraft] = useState("");
  const [sideSending, setSideSending] = useState(false);
  const [sideError, setSideError] = useState("");
  const [changesLoading, setChangesLoading] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const terminalOutputRef = useRef<HTMLDivElement>(null);
  const terminalPanelRef = useRef<HTMLDivElement>(null);
  const sessionLoadedRef = useRef(false);
  const pendingMessagesRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const missingAnswerRecoveryRef = useRef(false);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getConfiguredModelName().then(({ name, models }) => {
      if (!cancelled && name) setModelName(name);
      if (!cancelled && models?.length) setModelOptions(models);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setSending(false);
    setRetryingAnswer(false);
    setWorkspacePath("");
    setWorkspaceEntries([]);
    setSelectedFile("");
    setFileContent("");
    setFileDraft("");
    setFileEditing(false);
    setTerminalOutput("");
    setTerminalReady(false);
    setTerminalError("");
    setSideMessages([]);
    setSideError("");
    sessionLoadedRef.current = false;
    pendingMessagesRef.current = [];
    missingAnswerRecoveryRef.current = false;
    stopRequestedRef.current = false;
    getSession(sessionId)
      .then((data) => {
        if (cancelled) return;
        sessionLoadedRef.current = true;
        const persisted = data.messages?.filter((item: any) => item.role === "user" || item.role === "assistant") ?? [];
        const combined = [...persisted];
        for (const pending of pendingMessagesRef.current) {
          if (!combined.some((item: any) => item.role === pending.role && item.content === pending.content)) combined.push(pending);
        }
        pendingMessagesRef.current = [];
        setSession({ ...data, messages: combined });
        setLogs(data.logs ?? []);
        setStatus(data.status);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    listSessions().then((items) => !cancelled && setRecentSessions(items)).catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    if (panel === "files") {
      setWorkspaceLoading(true);
      setWorkspaceError("");
      listWorkspaceFiles(sessionId, workspacePath)
        .then((result) => setWorkspaceEntries(result.entries))
        .catch((e) => setWorkspaceError(e instanceof Error ? e.message : "Could not load files."))
        .finally(() => setWorkspaceLoading(false));
    }
  }, [panel, sessionId, workspacePath]);

  useEffect(() => {
    if (panel !== "changes") return;
    setWorkspaceError("");
    setChangesLoading(true);
    getSessionChanges(sessionId)
      .then(({ diff }) => setSession((current) => current ? { ...current, gitDiff: diff } : current))
      .catch((e) => setWorkspaceError(e instanceof Error ? e.message : "Could not load changes."))
      .finally(() => setChangesLoading(false));
  }, [panel, sessionId]);

  useEffect(() => {
    if (panel !== "side-chat") return;
    getSideChat(sessionId)
      .then(({ messages }) => setSideMessages(messages))
      .catch((e) => setSideError(e instanceof Error ? e.message : "Could not load side chat."));
  }, [panel, sessionId]);

  useEffect(() => {
    if (panel !== "terminal") return;
    let cancelled = false;
    let unsubscribeTerminal = () => {};
    setTerminalReady(false);
    setTerminalError("");
    startTerminal(sessionId)
      .then(() => {
        if (cancelled) return;
        setTerminalReady(true);
        unsubscribeTerminal = subscribeToTerminal(sessionId, {
          onData: (data) => setTerminalOutput((current) => `${current}${data}`.slice(-100_000)),
          onError: (message) => { setTerminalReady(false); setTerminalError(message); },
          onExit: () => { setTerminalReady(false); setTerminalError("The shell exited. Reopen Terminal to start a new shell."); },
        });
      })
      .catch((e) => {
        if (!cancelled) setTerminalError(e instanceof Error ? e.message : "Could not start the Ubuntu terminal.");
      });
    return () => { cancelled = true; unsubscribeTerminal(); };
  }, [panel, sessionId]);

  useEffect(() => {
    if (!terminalReady || !terminalPanelRef.current) return;
    const resize = () => {
      const rect = terminalPanelRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cols = Math.min(240, Math.max(40, Math.floor((rect.width - 24) / 8)));
      const rows = Math.min(100, Math.max(10, Math.floor((rect.height - 68) / 20)));
      void resizeTerminal(sessionId, cols, rows).catch(() => {});
    };
    const observer = new ResizeObserver(resize);
    observer.observe(terminalPanelRef.current);
    resize();
    return () => observer.disconnect();
  }, [terminalReady, sessionId]);

  useEffect(() => {
    terminalOutputRef.current?.scrollTo({ top: terminalOutputRef.current.scrollHeight });
  }, [terminalOutput]);

  useEffect(() => {
    const unsubscribe = subscribeToSession(sessionId, {
      onLog: (entry) => setLogs((current) => current.some((item) => item.time === entry.time && item.type === entry.type && item.text === entry.text) ? current : [...current, entry]),
      onMessage: (incoming) => {
        if (!sessionLoadedRef.current) {
          pendingMessagesRef.current.push(incoming);
          return;
        }
        setSession((current) => current
          ? { ...current, messages: appendIfNew(current.messages ?? [], incoming) }
          : current);
      },
      onStatus: (update) => {
        if (stopRequestedRef.current && update.status === "running") return;
        setStatus(update.status);
        setSession((current) => current ? {
          ...current,
          prUrl: update.prUrl ?? current.prUrl,
          branch: update.branch ?? current.branch,
          sandboxId: update.sandboxId ?? current.sandboxId,
        } : current);
      },
      onError: (streamError) => setError(streamError.message),
    });
    return unsubscribe;
  }, [sessionId]);

  useEffect(() => {
    if (!session || status !== "done" || missingAnswerRecoveryRef.current) return;
    const hasAnswer = session.messages?.some((item: any) => item.role === "assistant" && typeof item.content === "string" && item.content.trim());
    if (hasAnswer) return;

    // Recover old question-only sessions created before direct replies were saved.
    missingAnswerRecoveryRef.current = true;
    setStatus("running");
    sendMessage(sessionId, session.task).catch((e) => {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not retry the question.");
    });
  }, [session?.id, session?.task, session?.messages, status, sessionId]);

  async function openWorkspaceEntry(entry: WorkspaceEntry) {
    const nextPath = workspacePath ? `${workspacePath}/${entry.name}` : entry.name;
    setWorkspaceError("");
    if (entry.type === "directory") {
      setSelectedFile("");
      setFileEditing(false);
      setWorkspacePath(nextPath);
      return;
    }
    setWorkspaceLoading(true);
    try {
      const file = await readWorkspaceFile(sessionId, nextPath);
      setSelectedFile(file.path);
      setFileContent(file.content);
      setFileDraft(file.content);
      setFileEditing(false);
    } catch (e) {
      setWorkspaceError(e instanceof Error ? e.message : "Could not open this file.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function saveWorkspaceFile() {
    if (!selectedFile || fileSaving) return;
    setFileSaving(true);
    setWorkspaceError("");
    try {
      await writeWorkspaceFile(sessionId, selectedFile, fileDraft);
      setFileContent(fileDraft);
      setFileEditing(false);
      const { diff } = await getSessionChanges(sessionId);
      setSession((current) => current ? { ...current, gitDiff: diff } : current);
    } catch (e) {
      setWorkspaceError(e instanceof Error ? e.message : "Could not save this file.");
    } finally {
      setFileSaving(false);
    }
  }

  async function sendTerminalLine() {
    if (!terminalCommand.trim() || terminalSending || !terminalReady) return;
    setTerminalSending(true);
    setTerminalError("");
    try {
      await sendTerminalInput(sessionId, `${terminalCommand}\r`);
      setTerminalCommand("");
    } catch (e) {
      setTerminalError(e instanceof Error ? e.message : "Could not send input to the terminal.");
    } finally {
      setTerminalSending(false);
    }
  }

  async function interruptTerminal() {
    try {
      await sendTerminalInput(sessionId, "\u0003");
    } catch (e) {
      setTerminalError(e instanceof Error ? e.message : "Could not interrupt the terminal process.");
    }
  }

  async function sendSideChat() {
    const question = sideDraft.trim();
    if (!question || sideSending) return;
    setSideSending(true);
    setSideError("");
    try {
      const result = await sendSideChatMessage(sessionId, question);
      setSideMessages(result.messages);
      setSideDraft("");
    } catch (e) {
      setSideError(e instanceof Error ? e.message : "Side chat could not send your question.");
    } finally {
      setSideSending(false);
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages?.length, status]);

  async function handleSend() {
    const content = message.trim();
    if (!content || sending) return;
    setSending(true);
    stopRequestedRef.current = false;
    setError("");
    setMessage("");
    setStatus("running");
    setSession((current) => current
      ? { ...current, messages: appendIfNew(current.messages ?? [], { role: "user", content }) }
      : current);
    const delivery = sendMessage(sessionId, content);
    // Keep the composer usable while the server durably queues the message.
    setSending(false);
    try {
      await delivery;
      composerRef.current?.focus();
    } catch (e) {
      setSession((current) => {
        if (!current) return current;
        const messages = [...(current.messages ?? [])];
        let optimisticIndex = -1;
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const item = messages[index] as any;
          if (item.role === "user" && item.content === content) {
            optimisticIndex = index;
            break;
          }
        }
        if (optimisticIndex !== -1) messages.splice(optimisticIndex, 1);
        return { ...current, messages };
      });
      setMessage((current) => current || content);
      void getSession(sessionId).then((latest) => {
        setStatus(latest.status);
        setSession((current) => current ? { ...current, status: latest.status } : current);
      }).catch(() => {});
      setError(e instanceof Error ? e.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function handleStop() {
    if (status !== "running") return;
    stopRequestedRef.current = true;
    setError("");
    setStatus("stopped");
    setSession((current) => current ? { ...current, status: "stopped" } : current);
    try {
      const result = await stopSession(sessionId);
      if (result?.status) {
        setStatus(result.status);
        setSession((current) => current ? { ...current, status: result.status } : current);
      }
    } catch (e) {
      try {
        const latest = await getSession(sessionId);
        setStatus(latest.status);
        setSession((current) => current ? { ...current, status: latest.status } : current);
      } catch {
        setError(e instanceof Error ? e.message : "Could not stop the agent.");
      }
    }
  }

  async function retryMissingAnswer() {
    setRetryingAnswer(true);
    setError("");
    try {
      if(!session) return
      await sendMessage(sessionId, session.task);
      setStatus("running");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not retry the question.");
    } finally {
      setRetryingAnswer(false);
    }
  }

  async function confirmMergePullRequest() {
    if (!session?.prUrl || mergingPullRequest) return;
    setMergingPullRequest(true);
    setError("");
    try {
      const result = await mergePullRequest(sessionId);
      setSession((current) => current
        ? { ...current, prMergedAt: result.mergedAt, prMergeCommitSha: result.mergeCommitSha, prBaseBranch: result.baseBranch ?? current.prBaseBranch }
        : current);
      setMergeDialogOpen(false);
      setReviewConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not merge the pull request.");
    } finally {
      setMergingPullRequest(false);
    }
  }

  if (loading && !session) {
    return (
      <div className="quill-workspace h-screen flex overflow-hidden bg-[#101010] text-neutral-100">
        <AppSidebar
          sessions={recentSessions}
          activeSessionId={sessionId}
          menuOpen={sidebarOpen}
          onToggleMenu={() => setSidebarOpen((open) => !open)}
          onNewSession={() => navigate({ page: "dashboard" })}
          onSettings={() => navigate({ page: "settings" })}
        />
        <main className="qw-main flex min-w-0 flex-1 items-center justify-center" aria-live="polite" aria-busy="true">
          <div className="qw-loading-simple"><LoaderCircle size={17} className="animate-spin" /><span>Loading session…</span></div>
        </main>
      </div>
    );
  }
  if (!session) {
    return <div className="h-screen grid place-items-center bg-[#101010] text-neutral-300"><div className="text-center"><p className="mb-4">{error || "Session not found"}</p><button className="text-orange-400" onClick={() => navigate({ page: "dashboard" })}>Back to dashboard</button></div></div>;
  }

  const chatMessages = (session.messages ?? []).filter((item: any) => (item.role === "user" || item.role === "assistant") && typeof item.content === "string" && item.content.trim());
  const hasInitialTask = chatMessages.some((item: any) => item.role === "user" && item.content === session.task);
  const hasAssistantReply = chatMessages.some((item: any) => item.role === "assistant");
  const changedFiles = [...new Set(
    Array.from(session.gitDiff?.matchAll(/^diff --git a\/(.+?) b\//gm) ?? [], (match) => match[1]),
  )];
  const elapsedSeconds = logs.length > 1
    ? Math.max(1, Math.round((new Date(logs[logs.length - 1].time).getTime() - new Date(logs[0].time).getTime()) / 1000))
    : 1;
  return (
    <div className="quill-workspace h-screen flex overflow-hidden bg-[#101010] text-neutral-100">
      <AppSidebar
        sessions={recentSessions}
        activeSessionId={sessionId}
        menuOpen={sidebarOpen}
        onToggleMenu={() => setSidebarOpen((open) => !open)}
        onNewSession={() => navigate({ page: "dashboard" })}
        onSettings={() => navigate({ page: "settings" })}
      />

      <main className="qw-main flex min-w-0 flex-1 flex-col">
        <header className="qw-header flex h-[68px] shrink-0 items-center justify-between border-b border-white/10 px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button aria-label="Back to dashboard" onClick={() => navigate({ page: "dashboard" })} className="rounded-lg p-2 text-neutral-400 hover:bg-white/10 hover:text-white"><ArrowLeft size={18} /></button>
            <div className="min-w-0"><h1 className="truncate text-sm font-semibold">{session.title || "New session"}</h1><p className="mt-1 truncate text-xs text-neutral-500">{session.repoFullName}</p></div>
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 text-xs text-neutral-300">
              <i aria-hidden="true" className={`qw-header-status-dot status-${status}`} />
              {statusLabel[status]}
            </span>
            {loading && <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-neutral-400"><LoaderCircle size={13} className="animate-spin text-orange-400" /> Switching…</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {session.prUrl && !session.prMergedAt && <a href={session.prUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-200 hover:bg-white/5">Review PR ↗</a>}
            {session.prUrl && !session.prMergedAt && <button type="button" onClick={() => { setReviewConfirmed(false); setMergeDialogOpen(true); }} disabled={mergingPullRequest || status === "running"} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-medium text-black hover:bg-orange-400 disabled:opacity-50"><GitMerge size={14} /> Merge PR</button>}
            {session.prMergedAt && <span className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2 text-xs text-emerald-200">Merged into {session.prBaseBranch || "main"}</span>}
          </div>
        </header>

        <div className="qw-content flex min-h-0 flex-1">
          <section className="qw-thread flex min-w-0 flex-1 flex-col">
            <div className="qw-messages min-h-0 flex-1 overflow-y-auto px-5 py-7 sm:px-10">
              <div className="qw-message-list mx-auto flex flex-col gap-7">
                {session.workspaceUnavailable && <div role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm leading-6 text-amber-100/80">This session’s sandbox has expired and can’t be resumed. Unpushed changes from that sandbox are unavailable. Start a new session to continue from the repository on GitHub.<button type="button" onClick={() => navigate({ page: "dashboard" })} className="ml-2 font-medium text-orange-300 hover:text-orange-200">New session</button></div>}
                {session.prUrl && <div role="status" className={`rounded-xl border px-4 py-3 ${session.prMergedAt ? "border-emerald-400/20 bg-emerald-400/[0.06]" : "border-orange-400/20 bg-orange-400/[0.05]"}`}>
                  <p className={`text-sm font-medium ${session.prMergedAt ? "text-emerald-200" : "text-orange-100"}`}>{session.prMergedAt ? `Pull request merged into ${session.prBaseBranch || "main"}` : "Pull request ready for your review"}</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-400">{session.prMergedAt ? `Merge commit ${session.prMergeCommitSha?.slice(0, 7) ?? "created"}.` : "Review the PR changes and checks on GitHub. Quill will never merge it without your explicit approval here."}</p>
                </div>}
                {!hasInitialTask && <div className="qw-user-row flex justify-end"><div className="qw-user-bubble max-w-[82%] rounded-2xl bg-[#202020] px-5 py-3 text-[15px] leading-6 text-neutral-100">{session.task}</div></div>}
                {chatMessages.map((item: any, index: number) => item.role === "user" ? (
                  <div key={`${index}-${item.role}`} className="qw-user-row flex justify-end"><div className="qw-user-bubble max-w-[82%] rounded-2xl bg-[#202020] px-5 py-3 text-[15px] leading-6 text-neutral-100 whitespace-pre-wrap">{item.content}</div></div>
                ) : (
                  <article key={`${index}-${item.role}`} className="qw-assistant-message max-w-[92%] text-[15px] leading-7 text-neutral-200"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown></article>
                ))}
                {status === "running" && <div className="flex items-center gap-2 text-sm text-neutral-500"><LoaderCircle size={15} className="animate-spin" /> Quill is working…</div>}
                {(status === "done" || status === "error") && !hasAssistantReply && <article className="max-w-[92%] rounded-xl border border-white/10 bg-[#151515] p-4 text-sm leading-6 text-neutral-400">This session has no saved reply. <button onClick={() => void retryMissingAnswer()} disabled={retryingAnswer} className="ml-1 text-orange-400 hover:text-orange-300 disabled:opacity-50">{retryingAnswer ? "Asking Quill…" : "Ask Quill to answer"}</button></article>}
                {logs.length > 0 && <details className="rounded-xl border border-white/10 bg-[#151515] px-4 py-3 text-sm text-neutral-400"><summary className="cursor-pointer select-none">Activity log · {elapsedSeconds >= 60 ? `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s` : `${elapsedSeconds}s`} span · {logs.length} {logs.length === 1 ? "item" : "items"}</summary><div className="mt-3 space-y-2 border-t border-white/10 pt-3">{logs.map((entry, index) => <div key={`${entry.time}-${index}`} className="font-mono text-xs leading-5"><span className="mr-2 text-neutral-600">{entry.type.replaceAll("_", " ")}</span>{entry.text}</div>)}</div></details>}
                {error && <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-300">{error}</div>}
                <div ref={messagesEndRef} />
              </div>
            </div>
            <div className="qw-composer-wrap shrink-0 px-5 pb-5 sm:px-10">
              <form onSubmit={(event) => { event.preventDefault(); void handleSend(); }} className={`qw-composer w-full rounded-2xl border border-white/15 bg-[#191919] p-3 shadow-2xl shadow-black/20 focus-within:border-white/25 ${loading ? "opacity-60" : ""}`}>
                <textarea ref={composerRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void handleSend(); } }} rows={2} placeholder={loading ? "Switching session…" : "Ask Quill a question or describe a change"} className="max-h-40 min-h-14 w-full resize-y bg-transparent px-2 py-1 text-sm leading-6 text-neutral-100 outline-none placeholder:text-neutral-500" disabled={sending || loading} />
                <div className="flex items-center justify-between px-1 pt-2"><span className="text-xs text-neutral-600">{loading ? "Loading conversation…" : "Enter to send · Shift+Enter for a new line"}</span><div className="flex items-center gap-2"><label className="qw-model-picker flex cursor-pointer items-center gap-0.5"><select aria-label="AI model" title="Active AI model" value={modelOptions.find((option) => option.name === modelName)?.id ?? modelOptions[0]?.id} onChange={(event) => { const selected = modelOptions.find((option) => option.id === event.target.value); if (selected) setModelName(selected.name); }} className="qw-model-select max-w-28 cursor-pointer text-xs text-neutral-500 outline-none hover:text-neutral-300 focus:text-neutral-300">{modelOptions.map((option) => <option key={option.id} value={option.id} className="bg-[#191919] text-neutral-200">{option.name}</option>)}</select><ChevronDown size={12} className="shrink-0 text-neutral-500" /></label>{status === "running" && <button type="button" onClick={handleStop} disabled={loading} className="qw-stop-button" aria-label="Stop agent" title="Stop agent"><Square size={15} fill="currentColor" strokeWidth={1.5} /></button>}<button type="submit" disabled={loading || !message.trim() || sending} className="qw-send-button" aria-label="Send message" title="Send message">{sending || loading ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowUp size={20} strokeWidth={2} />}</button></div></div>
              </form>
            </div>
          </section>

          <aside className="qw-tools hidden w-[300px] shrink-0 flex-col border-l border-white/10 bg-[#141414] xl:flex">
            {panel === null ? (
              <nav className="qw-tool-launcher" aria-label="Session workspace tools">
                {allPanels.map(({ id, label, description, icon: Icon }) => (
                  <button key={id} onClick={() => { setPanel(id); if (id === "side-chat") composerRef.current?.focus(); }} className="qw-tool-item">
                    <span className="qw-tool-icon"><Icon size={18} strokeWidth={1.8} /></span>
                    <span className="qw-tool-copy"><span className="qw-tool-label">{label}</span><span className="qw-tool-description">{description}</span></span>
                  </button>
                ))}
              </nav>
            ) : (
              <>
                <header className="qw-tools-bar">
                  <button onClick={() => setPanel(null)} aria-label="Back to workspace tools"><ArrowLeft size={16} /> Workspace</button>
                  <span>{allPanels.find(({ id }) => id === panel)?.label}</span>
                </header>
                <div className="qw-tools-detail">
              {panel === "files" && <div className="flex h-full min-h-0 flex-col gap-3">
                <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Files</h2><p className="mt-1 truncate font-mono text-[11px] text-neutral-500">{session.repoFullName}</p></div><button type="button" title="Refresh files" onClick={() => { setWorkspaceLoading(true); setWorkspaceError(""); listWorkspaceFiles(sessionId, workspacePath).then((result) => setWorkspaceEntries(result.entries)).catch((e) => setWorkspaceError(e instanceof Error ? e.message : "Could not refresh files.")).finally(() => setWorkspaceLoading(false)); }} className="rounded-md p-1.5 text-neutral-500 hover:bg-white/5 hover:text-neutral-200"><RefreshCw size={14} /></button></div>
                <div className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-xs text-neutral-500"><button type="button" onClick={() => { setWorkspacePath(""); setSelectedFile(""); }} className="hover:text-white">repo</button>{workspacePath.split("/").filter(Boolean).map((part, index, parts) => <span key={`${part}-${index}`} className="inline-flex items-center gap-1"><ChevronRight size={12} /><button type="button" onClick={() => { setWorkspacePath(parts.slice(0, index + 1).join("/")); setSelectedFile(""); }} className="hover:text-white">{part}</button></span>)}</div>
                {workspaceError && <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-2 text-xs text-red-300">{workspaceError}</div>}
                {workspaceLoading && !selectedFile ? <div className="flex items-center gap-2 py-5 text-xs text-neutral-500"><LoaderCircle size={14} className="animate-spin" /> Loading workspace…</div> : selectedFile ? <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <div className="flex items-center justify-between gap-2"><button type="button" onClick={() => { setSelectedFile(""); setFileEditing(false); }} className="truncate font-mono text-xs text-neutral-400 hover:text-white">‹ {selectedFile}</button>{fileEditing ? <button type="button" onClick={() => void saveWorkspaceFile()} disabled={fileSaving} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-orange-500 px-2 py-1.5 text-xs font-medium text-black disabled:opacity-50">{fileSaving ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />} Save</button> : <button type="button" onClick={() => setFileEditing(true)} className="shrink-0 rounded-md border border-white/10 px-2 py-1.5 text-xs text-neutral-300 hover:bg-white/5">Edit</button>}</div>
                  {fileEditing ? <textarea value={fileDraft} onChange={(event) => setFileDraft(event.target.value)} spellCheck={false} className="min-h-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11px] leading-5 text-neutral-200 outline-none focus:border-orange-400/40" /> : <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11px] leading-5 text-neutral-300">{fileContent}</pre>}
                </div> : <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/10 bg-black/10 p-1">
                  {workspaceEntries.map((entry) => <button type="button" key={entry.name} onClick={() => void openWorkspaceEntry(entry)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-neutral-300 hover:bg-white/[0.06]"><span className="text-neutral-500">{entry.type === "directory" ? <Folder size={14} /> : entry.type === "symlink" ? <FolderOpen size={14} /> : <FileCode2 size={14} />}</span><span className="min-w-0 flex-1 truncate">{entry.name}</span>{entry.type === "directory" ? <ChevronRight size={13} className="text-neutral-600" /> : <span className="text-[10px] text-neutral-600">{entry.size < 1024 ? `${entry.size} B` : `${Math.round(entry.size / 1024)} KB`}</span>}</button>)}
                  {!workspaceLoading && !workspaceEntries.length && <p className="p-3 text-xs text-neutral-500">This folder is empty.</p>}
                </div>}
              </div>}
              {panel === "changes" && <div className="flex h-full min-h-0 flex-col gap-3"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Changes</h2><p className="mt-1 text-xs text-neutral-500">Live diff from the session workspace</p></div><button type="button" onClick={() => { setChangesLoading(true); getSessionChanges(sessionId).then(({ diff }) => setSession((current) => current ? { ...current, gitDiff: diff } : current)).catch((e) => setWorkspaceError(e instanceof Error ? e.message : "Could not refresh changes.")).finally(() => setChangesLoading(false)); }} disabled={changesLoading} title="Refresh changes" className="rounded-md p-1.5 text-neutral-500 hover:bg-white/5 hover:text-neutral-200 disabled:opacity-50">{changesLoading ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}</button></div>{workspaceError && <p className="text-xs text-red-300">{workspaceError}</p>}{session.gitDiff ? <pre className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/10 bg-black/20 p-3 font-mono text-[11px] leading-5 text-neutral-300">{session.gitDiff}</pre> : <div className="rounded-xl border border-white/10 bg-black/10 p-4 text-xs leading-5 text-neutral-500">{changesLoading ? "Checking for file changes…" : "No changes in the session workspace yet."}</div>}</div>}
              {panel === "terminal" && <div ref={terminalPanelRef} className="flex h-full min-h-0 flex-col gap-3"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Ubuntu terminal</h2><p className="mt-1 truncate font-mono text-[10px] text-neutral-500">E2B sandbox · /home/user/repo</p></div><span className={`inline-flex items-center gap-1.5 text-[10px] ${terminalReady ? "text-emerald-400" : "text-neutral-500"}`}><span className={`size-1.5 rounded-full ${terminalReady ? "bg-emerald-400" : "bg-neutral-600"}`} />{terminalReady ? "Connected" : "Starting"}</span></div>
                {terminalError && <p className="rounded-lg border border-red-400/20 bg-red-400/5 p-2 text-xs text-red-300">{terminalError}</p>}
                <div ref={terminalOutputRef} className="min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-[#080b0a] p-3 font-mono text-[11px] leading-5 text-emerald-100/90"><pre className="whitespace-pre-wrap break-all">{terminalOutput || (terminalReady ? "Connected to the session's Ubuntu shell.\n" : "Connecting to the E2B workspace…\n")}</pre></div>
                <form onSubmit={(event) => { event.preventDefault(); void sendTerminalLine(); }} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-2"><span className="shrink-0 font-mono text-xs text-emerald-400">$</span><input value={terminalCommand} onChange={(event) => setTerminalCommand(event.target.value)} onKeyDown={(event) => { if (event.ctrlKey && event.key.toLowerCase() === "c") { event.preventDefault(); void interruptTerminal(); } }} disabled={!terminalReady || terminalSending} placeholder="Run a command in the repo…" className="min-w-0 flex-1 bg-transparent font-mono text-xs text-neutral-100 outline-none placeholder:text-neutral-600" /><button type="submit" disabled={!terminalReady || terminalSending || !terminalCommand.trim()} aria-label="Run command" className="rounded-md bg-emerald-500/15 p-1.5 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40">{terminalSending ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}</button></form><p className="text-[10px] text-neutral-600">Persistent shell · Enter to run · Ctrl+C to interrupt</p>
              </div>}
              {panel === "side-chat" && <div className="flex h-full min-h-0 flex-col gap-3"><div><h2 className="text-sm font-semibold">Side chat</h2><p className="mt-1 text-xs text-neutral-500">Separate from the main agent conversation</p></div><div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-white/10 bg-black/10 p-2">{sideMessages.length ? sideMessages.map((item, index) => <div key={`${item.time}-${index}`} className={`rounded-lg px-3 py-2 text-xs leading-5 ${item.role === "user" ? "ml-5 bg-white/[0.07] text-neutral-200" : "mr-2 text-neutral-300"}`}><div className="mb-1 text-[10px] text-neutral-600">{item.role === "user" ? "You" : "Quill · Side chat"}</div><p className="whitespace-pre-wrap">{item.content}</p></div>) : <p className="p-2 text-xs leading-5 text-neutral-500">Ask a question about the task or repository here. Replies stay out of the main agent conversation.</p>}</div>{sideError && <p className="text-xs text-red-300">{sideError}</p>}<form onSubmit={(event) => { event.preventDefault(); void sendSideChat(); }} className="space-y-2"><textarea value={sideDraft} onChange={(event) => setSideDraft(event.target.value)} rows={3} placeholder="Ask a side question…" className="w-full resize-y rounded-lg border border-white/10 bg-black/20 p-2.5 text-xs leading-5 text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-white/20" /><button type="submit" disabled={sideSending || !sideDraft.trim()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/[0.08] px-3 py-2 text-xs text-neutral-200 hover:bg-white/[0.12] disabled:opacity-40">{sideSending ? <LoaderCircle size={13} className="animate-spin" /> : <Send size={13} />}Ask Quill</button></form></div>}
              {panel === "progress" && <div className="flex h-full min-h-0 flex-col gap-3"><div><h2 className="text-sm font-semibold">Progress</h2><p className="mt-1 text-xs text-neutral-500">What Quill has done in this session</p></div><div className="grid grid-cols-2 gap-2"><div className="rounded-lg border border-white/10 bg-black/10 p-3"><span className="text-[10px] uppercase tracking-wide text-neutral-600">Status</span><p className="mt-1 text-xs font-medium text-neutral-200">{statusLabel[status]}</p></div><div className="rounded-lg border border-white/10 bg-black/10 p-3"><span className="text-[10px] uppercase tracking-wide text-neutral-600">Activity</span><p className="mt-1 text-xs font-medium text-neutral-200">{logs.length} events</p></div></div><div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">{logs.length ? [...logs].reverse().map((entry, index) => <div key={`${entry.time}-${index}`} className="relative border-l border-white/10 pb-1 pl-3"><span className={`absolute -left-[4px] top-1 size-1.5 rounded-full ${entry.type === "error" ? "bg-red-400" : entry.type === "tool_result" ? "bg-emerald-400" : "bg-orange-400"}`} /><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">{entry.type.replaceAll("_", " ")}</span><time className="shrink-0 text-[10px] text-neutral-700">{new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-neutral-300">{entry.text}</p></div>) : <p className="rounded-lg border border-white/10 p-3 text-xs text-neutral-500">No activity has been recorded yet.</p>}</div></div>}
              {panel === "side-chat" && <div className="space-y-3"><h2 className="text-sm font-semibold">Side chat</h2><div className="rounded-xl border border-white/10 p-4 text-sm leading-6 text-neutral-400">Ask a follow-up in the main conversation. A simple question will get a direct reply without starting code work.</div><button onClick={() => composerRef.current?.focus()} className="rounded-lg bg-white/10 px-3 py-2 text-xs text-neutral-200 hover:bg-white/15">Go to chat</button></div>}
                </div>
              </>
            )}
          </aside>
        </div>
      </main>
      {mergeDialogOpen && session.prUrl && !session.prMergedAt && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !mergingPullRequest) { setMergeDialogOpen(false); setReviewConfirmed(false); } }}>
        <section role="dialog" aria-modal="true" aria-labelledby="merge-pr-title" className="w-full max-w-md rounded-2xl border border-white/10 bg-[#191919] p-6 shadow-2xl shadow-black/60">
          <div className="mb-4 grid size-10 place-items-center rounded-xl bg-orange-400/10 text-orange-300"><GitMerge size={19} /></div>
          <h2 id="merge-pr-title" className="text-lg font-semibold text-neutral-100">Ready to merge this PR?</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-400">Review the diff and checks before continuing. Quill will merge this pull request into <span className="font-medium text-neutral-200">{session.prBaseBranch || "main"}</span> only after you approve below.</p>
          <a href={session.prUrl} target="_blank" rel="noreferrer" onClick={() => setReviewConfirmed(false)} className="mt-3 inline-block text-sm text-orange-300 hover:text-orange-200">Open pull request to review ↗</a>
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm leading-5 text-neutral-300">
            <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} className="mt-1 accent-orange-500" />
            <span>I reviewed the pull request and want Quill to merge it.</span>
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => { setMergeDialogOpen(false); setReviewConfirmed(false); }} disabled={mergingPullRequest} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => void confirmMergePullRequest()} disabled={mergingPullRequest || !reviewConfirmed} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-black hover:bg-orange-400 disabled:opacity-60">{mergingPullRequest && <LoaderCircle size={15} className="animate-spin" />}{mergingPullRequest ? "Merging…" : "Confirm merge"}</button>
          </div>
        </section>
      </div>}
    </div>
  );
}

export { RightSplitViewPage as RightSideSplitViewPage }
