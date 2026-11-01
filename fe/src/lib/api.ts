const PRODUCTION_API_URL = "https://quill-c05l.onrender.com";
const LOCAL_API_URL = "http://localhost:3001";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function getApiBaseUrl(): string {
  const hostname = typeof window === "undefined" ? "" : window.location.hostname;
  const isLocal =
    LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");

  // Localhost always targets the local API, even when a production URL is
  // present in the developer's environment. Deployed builds may override the
  // production default for preview/staging deployments.
  if (isLocal) return LOCAL_API_URL;

  const configuredUrl =
    typeof process !== "undefined"
      ? process.env.BUN_PUBLIC_API_URL?.trim()
      : undefined;
  if (!configuredUrl) return PRODUCTION_API_URL;

  // A stale Vercel/Bun build variable must never make a public deployment
  // send users to their own machine. Keep localhost API URLs local-only.
  try {
    const configured = new URL(configuredUrl);
    const pointsToLocalhost =
      LOCAL_HOSTNAMES.has(configured.hostname) ||
      configured.hostname.endsWith(".localhost");
    return (pointsToLocalhost ? PRODUCTION_API_URL : configured.origin).replace(/\/+$/, "");
  } catch {
    return PRODUCTION_API_URL;
  }
}

export const API_BASE_URL = getApiBaseUrl();
const BACKEND_URL = API_BASE_URL;

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
};

export type RazorpayPaymentResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

export async function getRazorpayPublicKey(): Promise<string> {
  const response = await request<{ keyId: string }>("/api/payments/config");
  return response.keyId;
}

export async function getConfiguredModelName(): Promise<{ name: string; models: Array<{ id: string; name: string }> }> {
  return request("/api/model");
}

export type SessionStatus =
  | "ready"
  | "running"
  | "waiting_for_input"
  | "done"
  | "error"
  | "stopped";

export type LogEntry = {
  time: string;
  type: "info" | "tool_call" | "tool_result" | "error";
  text: string;
};

export type Session = {
  id: string;
  installationId: string;
  repoFullName: string;
  sandboxId: string;
  task: string;
  title: string;
  issueNumber?: number;
  status: SessionStatus;
  createdAt: string;
  messages: any[];
  logs: LogEntry[];
  branch?: string;
  prUrl?: string;
  prBaseBranch?: string;
  prMergedAt?: string;
  prMergeCommitSha?: string;
  repoPath: string;
  previewStarted: boolean;
  deployUrl?: string;
  gitDiff?: string;
  workspaceUnavailable?: boolean;
};

export type WorkspaceEntry = {
  name: string;
  type: "directory" | "file" | "symlink";
  size: number;
};

export type SideChatMessage = {
  role: "user" | "assistant";
  content: string;
  time: string;
};

export type TerminalSession = { pid: number; cwd: string };

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("quill_token");
  if (!token) return {};
  return { Authorization: token };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json();
}

export async function createRazorpayOrder(
  plan: "basic" | "pro",
): Promise<RazorpayOrder> {
  const response = await request<{ order: RazorpayOrder }>("/create-order", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
  return response.order;
}

export async function verifyRazorpayPayment(
  payment: RazorpayPaymentResponse,
): Promise<{ verified: boolean; usage: PlanUsage }> {
  return request("/verify-payment", {
    method: "POST",
    body: JSON.stringify(payment),
  });
}

// ── Sessions ──

export async function listSessions(): Promise<Session[]> {
  return request("/api/sessions");
}

export async function getSession(id: string): Promise<Session> {
  return request(`/api/sessions/${id}`);
}

export async function createSession(body: {
  repoFullName: string;
  task?: string;
  issueNumber?: number;
}): Promise<Session> {
  return request("/api/app/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function sendMessage(
  sessionId: string,
  message: string,
): Promise<any> {
  return request(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function stopSession(sessionId: string): Promise<any> {
  return request(`/api/sessions/${sessionId}/stop`, { method: "POST" });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await request(`/api/app/sessions/${sessionId}`, { method: "DELETE" });
}

// ── PR / Deploy ──

export async function createPR(sessionId: string): Promise<{ prUrl: string }> {
  return request(`/api/app/sessions/${sessionId}/pull-request`, {
    method: "POST",
  });
}

export async function mergePullRequest(sessionId: string): Promise<{
  merged: boolean;
  mergedAt: string;
  mergeCommitSha?: string;
  baseBranch?: string;
}> {
  return request(`/api/app/sessions/${sessionId}/pull-request/merge`, {
    method: "POST",
    body: JSON.stringify({ userApproved: true }),
  });
}

export async function deploy(
  sessionId: string,
  target: "preview" | "vercel" = "preview",
): Promise<{ url: string; temporary: boolean }> {
  return request(`/api/app/sessions/${sessionId}/deploy`, {
    method: "POST",
    body: JSON.stringify({ target }),
  });
}

export async function listWorkspaceFiles(sessionId: string, path = ""): Promise<{ path: string; entries: WorkspaceEntry[] }> {
  return request(`/api/app/sessions/${sessionId}/workspace/files?path=${encodeURIComponent(path)}`);
}

export async function readWorkspaceFile(sessionId: string, path: string): Promise<{ path: string; content: string; byteLength: number }> {
  return request(`/api/app/sessions/${sessionId}/workspace/file?path=${encodeURIComponent(path)}`);
}

export async function writeWorkspaceFile(sessionId: string, path: string, content: string): Promise<{ path: string; saved: boolean }> {
  return request(`/api/app/sessions/${sessionId}/workspace/file`, {
    method: "PUT",
    body: JSON.stringify({ path, content }),
  });
}

export async function getSessionChanges(sessionId: string): Promise<{ diff: string }> {
  return request(`/api/app/sessions/${sessionId}/changes`);
}

export async function startTerminal(sessionId: string, cols = 100, rows = 30): Promise<TerminalSession> {
  return request(`/api/app/sessions/${sessionId}/terminal/start`, {
    method: "POST",
    body: JSON.stringify({ cols, rows }),
  });
}

export async function sendTerminalInput(sessionId: string, data: string): Promise<void> {
  await request(`/api/app/sessions/${sessionId}/terminal/input`, {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export async function resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
  await request(`/api/app/sessions/${sessionId}/terminal/resize`, {
    method: "POST",
    body: JSON.stringify({ cols, rows }),
  });
}

export function subscribeToTerminal(
  sessionId: string,
  handlers: { onData: (data: string) => void; onError?: (error: string) => void; onExit?: () => void },
): () => void {
  const controller = new AbortController();
  void (async () => {
    const decoder = new TextDecoder();
    let retryDelay = 500;
    while (!controller.signal.aborted) {
      const connectedAt = Date.now();
      let receivedOutput = false;
      try {
        const response = await fetch(`${BACKEND_URL}/api/app/sessions/${sessionId}/terminal/stream`, {
          headers: authHeaders(), credentials: "include", signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: `Terminal stream failed (${response.status})` }));
          if (response.status === 410 || response.status === 404) {
            handlers.onError?.(body.error);
            return;
          }
          throw new Error(body.error);
        }
        if (!response.body) throw new Error("Terminal stream is unavailable");
        const reader = response.body.getReader();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let eventType = "message";
            const data: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) eventType = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
            }
            if (data.length && eventType === "output") {
              receivedOutput = true;
              const bytes = Uint8Array.from(atob(data.join("\n")), (character) => character.charCodeAt(0));
              handlers.onData(decoder.decode(bytes, { stream: true }));
            } else if (eventType === "terminal-error" && data.length) {
              handlers.onError?.((JSON.parse(data.join("\n")) as { error: string }).error);
              return;
            } else if (eventType === "exit") {
              handlers.onExit?.();
              return;
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
        if (!controller.signal.aborted) throw new Error("Terminal stream disconnected");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof Error && /failed \((401|403)\)/.test(error.message)) {
          handlers.onError?.(error.message);
          return;
        }
      }
      if (receivedOutput && Date.now() - connectedAt > 5_000) retryDelay = 500;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, retryDelay);
        controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      retryDelay = Math.min(retryDelay * 2, 10_000);
    }
  })();
  return () => controller.abort();
}

export async function getSideChat(sessionId: string): Promise<{ messages: SideChatMessage[] }> {
  return request(`/api/app/sessions/${sessionId}/side-chat`);
}

export async function sendSideChatMessage(sessionId: string, message: string): Promise<{ messages: SideChatMessage[] }> {
  return request(`/api/app/sessions/${sessionId}/side-chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

// ── Repos ──

export async function listRepos(): Promise<
  { full_name: string; name: string; private: boolean }[]
> {
  return request("/api/github/repos");
}

// ── SSE Stream ──

export function subscribeToSession(
  sessionId: string,
  handlers: {
    onLog?: (entry: LogEntry) => void;
    onMessage?: (message: { role: "user" | "assistant"; content: string }) => void;
    onStatus?: (data: {
      status: SessionStatus;
      prUrl?: string;
      branch?: string;
      sandboxId?: string;
    }) => void;
    onError?: (err: Error) => void;
  },
): () => void {
  const controller = new AbortController();
  const waitBeforeReconnect = (delay: number) => new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    controller.signal.addEventListener("abort", finish, { once: true });
  });

  void (async () => {
    let retryDelay = 500;
    while (!controller.signal.aborted) {
      const connectedAt = Date.now();
      let receivedEvent = false;
      try {
        const response = await fetch(`${BACKEND_URL}/api/session/${sessionId}/stream`, {
          headers: authHeaders(),
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new Error(`Session stream failed (${response.status})`);
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            handlers.onError?.(error);
            return;
          }
          throw error;
        }
        if (!response.body) throw new Error("Session stream is unavailable");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let eventType = "message";
            const data: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) eventType = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
            }
            if (data.length) {
              receivedEvent = true;
              const payload = JSON.parse(data.join("\n"));
              if (eventType === "log") handlers.onLog?.(payload as LogEntry);
              else if (eventType === "message") handlers.onMessage?.(payload);
              else if (eventType === "status") handlers.onStatus?.(payload);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }

        if (!controller.signal.aborted) throw new Error("Session stream disconnected");
      } catch (error) {
        if (controller.signal.aborted) return;
        // Reconnect automatically after network interruptions or server restarts.
        // A fresh stream sends the persisted status and activity log again.
      }
      if (receivedEvent && Date.now() - connectedAt > 5_000) retryDelay = 500;
      await waitBeforeReconnect(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10_000);
    }
  })();

  return () => controller.abort();
}

// 🔐 Auth helpers

export type QuillProfile = { userId: string; name: string; login: string; email: string };

export type PlanUsage = {
  active: boolean;
  plan: "free" | "basic" | "pro" | null;
  limit: number;
  used: number;
  remaining: number;
  periodEnd: string | null;
};

export function getPlanUsage(): Promise<PlanUsage> {
  return request<PlanUsage>("/api/billing/usage");
}

export type BillingHistoryItem = {
  id: string;
  plan: "basic" | "pro";
  status: string;
  priceMinorUnits: number;
  currency: string;
  createdAt: string;
  currentPeriodEnd: string | null;
};

export function getBillingHistory(): Promise<BillingHistoryItem[]> {
  return request<BillingHistoryItem[]>("/api/billing/history");
}

export type PullRequestReviewFinding = {
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  file?: string;
  line?: number;
  details: string;
};

export type AgentPullRequestReview = {
  pullRequest: {
    number: number;
    title: string;
    url: string;
    state: string;
    draft: boolean;
    merged: boolean;
    author: string;
    description: string;
    createdAt: string;
    commitCount: number;
    baseBranch: string;
    headBranch: string;
    changedFiles: number;
    additions: number;
    deletions: number;
  };
  verdict: "needs_attention" | "review_recommended" | "no_issues_detected";
  summary: string;
  findings: PullRequestReviewFinding[];
  reviewedFiles: string[];
  omittedFiles: string[];
};

export function reviewAgentPullRequest(url: string): Promise<AgentPullRequestReview> {
  return request<AgentPullRequestReview>("/api/reviews/pull-request", {
    method: "POST",
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(90_000),
  });
}

export async function askAboutPullRequest(url: string, question: string): Promise<string> {
  const response = await request<{ answer: string }>("/api/reviews/pull-request/chat", {
    method: "POST",
    body: JSON.stringify({ url, question }),
  });
  return response.answer;
}

export async function getUserProfile(): Promise<QuillProfile> {
  return request<QuillProfile>("/api/auth/profile");
}

export function getLoginUrl(installationId?: string): string {
  const id = installationId?.trim() || getInstallationId() || "";
  const query = id ? `?installation_id=${encodeURIComponent(id)}` : "";
  return `${BACKEND_URL}/api/auth/github${query}`;
}

export async function exchangeAuthCode(
  code: string,
): Promise<{ token: string; installationId: string }> {
  const res = await fetch(`${BACKEND_URL}/api/auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  const body = await res
    .json()
    .catch(() => ({ error: "Authentication failed" }));
  if (!res.ok) throw new Error(body.error ?? "Authentication failed");
  return body;
}

function installationIdFromToken(token = localStorage.getItem("quill_token")): string {
  if (!token) return "";
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return "";
    const json = atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { installationId?: unknown };
    return String(payload.installationId ?? "").trim();
  } catch {
    return "";
  }
}

export function saveAuth(token: string, installationId?: string) {
  localStorage.setItem("quill_token", token);
  const id = installationId?.trim() || installationIdFromToken(token);
  if (id) localStorage.setItem("quill_installation_id", id);
  else localStorage.removeItem("quill_installation_id");
}

export function saveInstallation(installationId: string) {
  localStorage.setItem("quill_installation_id", installationId);
}

export function clearAuth() {
  localStorage.removeItem("quill_token");
  localStorage.removeItem("quill_installation_id");
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem("quill_token");
}

export function getInstallationId(): string | null {
  const stored = localStorage.getItem("quill_installation_id")?.trim();
  if (stored) return stored;
  return installationIdFromToken() || null;
}

export function clearInstallation() {
  localStorage.removeItem("quill_installation_id");
}

const GITHUB_APP_SLUG = "helloquill-ai-integration";

export function getInstallUrl(): string {
  return `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`;
}

export function getManageInstallUrl(): string {
  // Route through the app's public page so GitHub resolves the installation
  // for the account currently signed in. A cached installation ID can be
  // stale or belong to a different GitHub account, which produces a 404 at
  // /settings/installations/:id.
  return getInstallUrl();
}

export function hasInstallation(): boolean {
  return Boolean(getInstallationId());
}

type InstallationResolution =
  | { status: "ok"; installationId: string }
  | { status: "missing" }
  | { status: "unauthenticated" }
  | { status: "reauthenticate" };

let installationResolutionRequest: Promise<InstallationResolution> | null = null;

async function requestInstallationResolution(): Promise<InstallationResolution> {
  const res = await fetch(`${BACKEND_URL}/api/auth/installation`, {
    headers: {
      ...authHeaders(),
    },
  });

  if (res.status === 401 || res.status === 403) {
    return { status: "unauthenticated" };
  }
  if (res.status >= 500 || res.status === 429) {
    throw new Error("GitHub connection could not be checked right now.");
  }
  if (!res.ok) return { status: "missing" };

  const body = (await res.json().catch(() => ({}))) as {
    installationId?: string | null;
    token?: string | null;
    reauthenticate?: boolean;
  };
  if (body.reauthenticate) return { status: "reauthenticate" };
  const id = String(body.installationId ?? "").trim();
  if (!id) return { status: "missing" };

  if (body.token) saveAuth(body.token, id);
  else saveInstallation(id);
  return { status: "ok", installationId: id };
}

export function resolveInstallation(): Promise<InstallationResolution> {
  if (!installationResolutionRequest) {
    installationResolutionRequest = requestInstallationResolution().finally(() => {
      installationResolutionRequest = null;
    });
  }
  return installationResolutionRequest;
}
