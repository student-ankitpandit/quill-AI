import type OpenAI from "openai";
import { prisma } from "./db";
import { publish } from "./events";

export interface messageType {
  type: string;
  toolCallId: number;
  content: string;
}

export interface Session {
  id: string;
  installationId: string;
  repoFullName: string;
  sandboxId: string;
  task: string;
  taskIntent?: "conversation" | "informational" | "repository_task";
  title: string;
  issueNumber?: number;
  status: "ready" | "running" | "waiting_for_input" | "done" | "error" | "stopped";
  createdAt: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  logs: LogEntry[];
  pendingToolCallId?: string;
  branch?: string;
  prUrl?: string;
  prBaseBranch?: string;
  prMergedAt?: string;
  prMergeCommitSha?: string;
  repoPath: string;
  previewStarted: boolean;
  previewStarting?: boolean;
  deployUrl?: string;
}

export interface LogEntry {
  time: string;
  type: "info" | "tool_call" | "tool_result" | "error";
  text: string;
}

const prismaSessionStatus: Record<Session["status"], string> = {
  ready: "READY",
  running: "RUNNING",
  waiting_for_input: "WAITING_FOR_INPUT",
  done: "DONE",
  error: "ERROR",
  stopped: "STOPPED",
};

const prismaLogType: Record<LogEntry["type"], string> = {
  info: "INFO",
  tool_call: "TOOL_CALL",
  tool_result: "TOOL_RESULT",
  error: "ERROR",
};

function fromPrismaSession(row: any): Session {
  return {
    id: row.id,
    installationId: row.installationId,
    repoFullName: row.repoFullName,
    sandboxId: row.sandboxId ?? "",
    taskIntent: (row.taskIntent as Session["taskIntent"]) ?? undefined,
    task: row.task,
    title: row.title,
    issueNumber: row.issueNumber ?? undefined,
    status: String(row.status).toLowerCase() as Session["status"],
    createdAt: row.createdAt.toISOString(),
    pendingToolCallId: row.pendingToolCallId ?? undefined,
    branch: row.branch ?? undefined,
    prUrl: row.prUrl ?? undefined,
    prBaseBranch: row.prBaseBranch ?? undefined,
    prMergedAt: row.prMergedAt?.toISOString(),
    prMergeCommitSha: row.prMergeCommitSha ?? undefined,
    repoPath: row.repoPath,
    previewStarted: row.previewStarted,
    previewStarting: row.previewStarting,
    deployUrl: row.deployUrl ?? undefined,
    messages: (row.messages ?? []).map((message: any) => message.payload as OpenAI.Chat.ChatCompletionMessageParam),
    logs: (row.logs ?? []).map((entry: any) => ({
      time: entry.time.toISOString(),
      type: String(entry.type).toLowerCase() as LogEntry["type"],
      text: entry.text,
    })),
  };
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/https:\/\/x-access-token:[^@\s'\"]+@github\.com/gi, "https://x-access-token:[REDACTED]@github.com")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bgh[opsur]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
}

export function log(session: Session, type: LogEntry["type"], text: string) {
  const entry = { time: new Date().toISOString(), type, text: redactSensitiveText(text).slice(0, 2000) };
  session.logs.push(entry);
  publish(session.id, { type: "log", id: session.logs.length - 1, data: entry });
}

export function setStatus(session: Session, status: Session["status"]) {
  session.status = status;
  publish(session.id, {
    type: "status",
    data: { status, prUrl: session.prUrl, branch: session.branch, sandboxId: session.sandboxId || undefined },
  });
}

export async function saveSession(session: Session, consumedQueueMessageIds: string[] = []): Promise<void> {
  const sessionData = {
    installationId: session.installationId,
    repoFullName: session.repoFullName,
    sandboxId: session.sandboxId || null,
    taskIntent: session.taskIntent ?? null,
    task: session.task,
    title: session.title,
    issueNumber: session.issueNumber ?? null,
    status: prismaSessionStatus[session.status],
    createdAt: new Date(session.createdAt),
    pendingToolCallId: session.pendingToolCallId ?? null,
    branch: session.branch ?? null,
    prUrl: session.prUrl ?? null,
    prBaseBranch: session.prBaseBranch ?? null,
    prMergedAt: session.prMergedAt ? new Date(session.prMergedAt) : null,
    prMergeCommitSha: session.prMergeCommitSha ?? null,
    repoPath: session.repoPath,
    previewStarted: session.previewStarted,
    previewStarting: session.previewStarting ?? false,
    deployUrl: session.deployUrl ?? null,
  };

  await prisma.$transaction(async (tx: any) => {
    await tx.session.upsert({
      where: { id: session.id },
      create: { id: session.id, ...sessionData },
      update: sessionData,
    });

    if (session.messages.length) {
      await tx.sessionMessage.createMany({
        data: session.messages.map((message, sequence) => ({
          sessionId: session.id,
          sequence,
          role: message.role,
          payload: JSON.parse(JSON.stringify(message)),
        })),
        skipDuplicates: true,
      });
    }
    if (session.logs.length) {
      await tx.sessionLog.createMany({
        data: session.logs.map((entry, sequence) => ({
          sessionId: session.id,
          sequence,
          time: new Date(entry.time),
          type: prismaLogType[entry.type],
          text: entry.text.slice(0, 2000),
        })),
        skipDuplicates: true,
      });
    }
    if (consumedQueueMessageIds.length) {
      await tx.queuedAgentMessage.updateMany({
        where: { id: { in: consumedQueueMessageIds }, sessionId: session.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
    }
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const row = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      messages: { orderBy: { sequence: "asc" } },
      logs: { orderBy: { sequence: "asc" } },
    },
  });
  return row ? fromPrismaSession(row) : null;
}

export async function listSessions(installationId: string): Promise<Session[]> {
  const rows = await prisma.session.findMany({
    where: { installationId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(fromPrismaSession);
}

export async function deleteSession(id: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id } });
}

export async function appendLog(
  sessionId: string,
  entry: { kind: string; payload: string },
): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;
  const type: LogEntry["type"] = entry.kind === "error" ? "error" : "info";
  log(session, type, entry.payload);
  await saveSession(session);
}
