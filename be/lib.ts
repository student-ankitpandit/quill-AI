import axios from "axios";
import jwt from "jsonwebtoken";
import { Octokit } from "octokit";
import type { Request, Response } from "express";
import { Sandbox } from "e2b";
import { getSession, saveSession, log } from "./sessions";
import type { Session } from "./sessions";
import { posix as pathPosix } from "node:path";

const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;
const REPO_DIR = "/home/user/repo";
const SAFE = /^[\w-]+$/;
const publishing = new Set<string>();

type GithubTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

type GithubTokens = {
  accessToken: string;
  refreshToken: string | null;
};

export type GithubUser = {
  id: number | string;
  login: string;
  name: string | null;
  email: string | null;
};

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
  permissions: Record<string, string>;
  repositories: Array<{
    id: number;
    name: string;
    full_name: string;
  }>;
}

export const exchangeCodeForToken = async (
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<GithubTokens> => {
  const response = await axios.post<GithubTokenResponse>(
    "https://github.com/login/oauth/access_token",
    {
      code,
      client_id: clientId,
      client_secret: clientSecret,
    },
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.data.access_token) {
    throw new Error(
      response.data.error_description ||
        response.data.error ||
        "GitHub did not return an access token. Reconnect your GitHub account.",
    );
  }

  return {
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token ?? null,
  };
};

export async function refreshGithubAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<GithubTokens> {
  const response = await axios.post<GithubTokenResponse>(
    "https://github.com/login/oauth/access_token",
    {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.data.access_token) {
    throw new Error(
      response.data.error_description ||
        response.data.error ||
        "GitHub did not return an access token. Reconnect your GitHub account.",
    );
  }

  return {
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token ?? refreshToken,
  };
}

export const getGithubUser = async (
  accessToken: string,
): Promise<GithubUser> => {
  const response = await axios.get<GithubUser>("https://api.github.com/user", {
    timeout: 15_000,
    headers: {
      Accept: "application/vnd.github+json", //github json representation
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  let email = response.data.email ?? null;
  try {
    const emails = await axios.get<
      Array<{ email: string; primary: boolean; verified: boolean }>
    >("https://api.github.com/user/emails", {
      timeout: 15_000,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    email =
      emails.data.find((item) => item.primary && item.verified)?.email ??
      emails.data.find((item) => item.verified)?.email ??
      email;
  } catch (error) {
    // Email lookup is optional (and requires the user:email OAuth scope). Avoid
    // logging the Axios error object because it includes request/config details.
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    console.warn(
      status
        ? `Could not read the authenticated GitHub user's email (HTTP ${status}); using the public profile email when available.`
        : "Could not read the authenticated GitHub user's email; using the public profile email when available.",
    );
  }

  return {
    id: response.data.id,
    login: response.data.login,
    name: response.data.name ?? response.data.login ?? "",
    email,
  };
};

export async function getUserAppInstallation(
  accessToken: string,
  appId: string,
  preferredInstallationId?: string,
): Promise<string> {
  const response = await axios.get<{
    installations?: Array<{
      id: number;
      app_id?: number;
      app?: { id?: number };
    }>;
  }>("https://api.github.com/user/installations", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    params: { per_page: 100 },
  });

  const installations = response.data.installations ?? [];
  const expectedAppId = String(appId);
  const appInstallations = installations.filter((item) => {
    const itemAppId = String(item.app_id ?? item.app?.id ?? "");
    return itemAppId === expectedAppId;
  });

  const preferred = appInstallations.find(
    (item) => String(item.id) === preferredInstallationId,
  );
  const matched =
    preferred ??
    appInstallations.sort((a, b) => b.id - a.id)[0];
  return matched ? String(matched.id) : "";
}

export function getAppJWT(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: process.env.GITHUB_APP_ID!,
    iat: now - 60,
    exp: now + 60 * 9,
  };

  return jwt.sign(payload, process.env.GITHUB_PRIVATE_KEY!, {
    algorithm: "RS256",
  });
}

export async function getInstallationToken(
  installationId: string,
): Promise<string> {
  const appJWT = getAppJWT();

  const response = await axios.post(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    undefined,
    {
      headers: {
        Authorization: `Bearer ${appJWT}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      timeout: 15_000,
    },
  );

  if (!response.data) {
    const error = await response.data;
    throw new Error(`Failed to get installation token: ${error}`);
  }

  const data = (await response.data) as InstallationTokenResponse;
  return data.token;
}

export async function getInstallationOctokit(
  installationId: string,
): Promise<Octokit> {
  const token = await getInstallationToken(installationId);
  return new Octokit({ auth: token, request: { timeout: 15_000 } });
}

export async function loadOwned(
  req: Request,
  res: Response,
): Promise<Session | null> {
  const sessionId = (req.params.id ?? req.params.sessionId) as
    | string
    | undefined;
  const session = sessionId ? await getSession(sessionId) : null;
  if (!session || session.installationId !== req.installationId) {
    res.sendStatus(404);
    return null;
  }
  return session;
}

export async function waitForPort(
  sandbox: Sandbox,
  port: number,
  timeoutMs = 60_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // curl exits non-zero (and run() throws) while nothing is listening yet
      await sandbox.commands.run(
        `curl -s -o /dev/null http://localhost:${port}`,
        { timeoutMs: 5_000 },
      );
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  return false;
}

export function isSandboxNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; message?: string };
  return (
    candidate.name === "SandboxNotFoundError" ||
    /(?:paused )?sandbox .* not found/i.test(candidate.message ?? "")
  );
}

export async function connectSessionSandbox(
  sandboxId: string,
): Promise<Sandbox> {
  const sandbox = await Sandbox.connect(sandboxId);
  // Reset the idle timer on activity. New sandboxes are configured to pause,
  // rather than be destroyed, when this timeout elapses.
  await sandbox.setTimeout(30 * 60 * 1000);
  return sandbox;
}


export async function createSessionSandbox(
  installationId: string,
  repoFullName: string,
): Promise<Sandbox> {
  const token = await getInstallationToken(installationId);
  const sandboxTemplate = process.env.E2B_TEMPLATE?.trim();
  const sandboxOptions = {
    timeoutMs: 30 * 60 * 1000,
    lifecycle: { onTimeout: "pause" as const, autoResume: true },
  };
  const sandbox = sandboxTemplate
    ? await Sandbox.create(sandboxTemplate, sandboxOptions)
    : await Sandbox.create(sandboxOptions);
  try {
    await sandbox.commands.run(
      `git clone https://x-access-token:${token}@github.com/${repoFullName}.git repo`,
      { timeoutMs: 120_000 },
    );
    // The sandbox is user-visible through its terminal. Never leave the
    // installation credential in the cloned repository's .git/config.
    await sandbox.commands.run(
      `git -C repo remote set-url origin ${quoteShell(`https://github.com/${repoFullName}.git`)}`,
      { timeoutMs: 10_000 },
    );
    return sandbox;
  } catch (err: any) {
    await sandbox.kill().catch(() => {});
    throw new Error(
      `git clone failed: ${String(err.stderr ?? err.message)
        .split(token)
        .join("***")}`,
    );
  }
}

export async function ensureSessionSandbox(
  session: Session,
): Promise<Sandbox> {
  if (session.sandboxId) {
    try {
      return await connectSessionSandbox(session.sandboxId);
    } catch (err) {
      if (!isSandboxNotFoundError(err)) {
        throw err;
      }
      log(session, "info", "Previous workspace sandbox expired. Re-creating sandbox...");
    }
  }

  log(session, "info", `Starting workspace sandbox for ${session.repoFullName}...`);
  const sandbox = await createSessionSandbox(
    session.installationId,
    session.repoFullName,
  );
  session.sandboxId = sandbox.sandboxId;
  await saveSession(session);
  log(session, "info", "Workspace sandbox is ready.");
  return sandbox;
}
export function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function workspacePath(input: unknown): { relative: string; absolute: string } {
  const requested = typeof input === "string" ? input : "";
  if (requested.split(/[\\/]+/).some((segment) => segment === "..")) {
    throw new Error("Path must stay inside the repository workspace.");
  }
  const relative = pathPosix.normalize(`/${requested}`).replace(/^\/+/, "");
  if (relative === ".." || relative.startsWith("../")) {
    throw new Error("Path must stay inside the repository workspace.");
  }
  const absolute = pathPosix.resolve(REPO_DIR, relative);
  if (absolute !== REPO_DIR && !absolute.startsWith(`${REPO_DIR}/`)) {
    throw new Error("Path must stay inside the repository workspace.");
  }
  return { relative, absolute };
}

export async function assertWorkspacePathInside(
  sandbox: Awaited<ReturnType<typeof connectSessionSandbox>>,
  absolute: string,
) {
  const result = await sandbox.commands.run(
    `realpath -e -- ${quoteShell(absolute)}`,
    {
      cwd: REPO_DIR,
      timeoutMs: 10_000,
    },
  );
  const realPath = result.stdout.trim();
  if (realPath !== REPO_DIR && !realPath.startsWith(`${REPO_DIR}/`)) {
    throw new Error("Path resolves outside the repository workspace.");
  }
  return realPath;
}

export function signUserToken(payload: {
  installationId?: string;
  userId: string;
  login?: string;
  name?: string;
  email?: string | null;
}) {
  return jwt.sign(
    {
      installationId: payload.installationId || "",
      userId: payload.userId,
      login: payload.login,
      name: payload.name,
      email: payload.email,
    },
    process.env.GITHUB_PRIVATE_KEY!,
    { algorithm: "RS256", expiresIn: "7d" },
  );
}

export async function resolveInstallationId(opts: {
  accessToken?: string;
  preferredInstallationId?: string;
}): Promise<string> {
  // Resolve from the authenticated user's own GitHub installation list.
  // Never fall back to a global installation ID: that would let every Quill
  // account act through the operator's GitHub installation.
  if (opts.accessToken) {
    try {
      const installationId = await getUserAppInstallation(
        opts.accessToken,
        process.env.GITHUB_APP_ID || "",
        opts.preferredInstallationId,
      );
      if (installationId) return installationId;
    } catch (error) {
      console.warn(
        "Could not discover a GitHub App installation for the authenticated user",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return "";
}
