import Router from "express";
import { Sandbox } from "e2b";
import {
  saveSession,
  deleteSession,
  setStatus,
  log,
  getSession,
} from "../sessions";
import type { Session } from "../sessions";
import { getRepoConfig } from "../repo-config";
import { ensureRelay } from "../browser-stream";
import { loadOwned } from "../lib";
import {
  connectSessionSandbox,
  isSandboxNotFoundError,
  waitForPort,
} from "../lib";

const router = Router();
const workspaceJobs = new Map<string, Promise<void>>();

async function detectPreviewSetup(
  sandbox: Awaited<ReturnType<typeof Sandbox.connect>>,
) {
  const packageJson = await sandbox.files
    .read("/home/user/repo/package.json")
    .catch(() => "");
  if (!packageJson) {
    const goMod = await sandbox.files
      .read("/home/user/repo/go.mod")
      .catch(() => "");
    return goMod
      ? {
          installCommand: "go mod download",
          buildCommand: "go build ./...",
          runCommand: undefined,
          port: undefined,
        }
      : null;
  }

  let manifest: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    manifest = JSON.parse(packageJson);
  } catch {
    return null;
  }

  const files = await sandbox.commands.run(
    'for file in bun.lockb bun.lock pnpm-lock.yaml yarn.lock package-lock.json; do [ ! -f "$file" ] || echo "$file"; done',
    { cwd: "/home/user/repo" },
  );
  const lockfiles = files.stdout.split(/\r?\n/);
  const manager = lockfiles.some((file) => file.startsWith("bun.lock"))
    ? "bun"
    : lockfiles.includes("pnpm-lock.yaml")
      ? "pnpm"
      : lockfiles.includes("yarn.lock")
        ? "yarn"
        : "npm";
  const installCommand =
    manager === "bun"
      ? "bun install"
      : manager === "pnpm"
        ? "pnpm install"
        : manager === "yarn"
          ? "yarn install"
          : lockfiles.includes("package-lock.json")
            ? "npm ci"
            : "npm install";
  const scripts = manifest.scripts ?? {};
  const script = scripts.dev ? "dev" : scripts.start ? "start" : undefined;

  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  const framework = dependencies.next
    ? "next"
    : dependencies.vite
      ? "vite"
      : "";
  const port = 3000;
  const runCommand = !script
    ? undefined
    : framework === "next"
      ? `${manager} run ${script} -- --hostname 0.0.0.0 --port ${port}`
      : framework === "vite"
        ? `${manager} run ${script} -- --host 0.0.0.0 --port ${port}`
        : `HOST=0.0.0.0 HOSTNAME=0.0.0.0 PORT=${port} ${manager} run ${script}`;

  const buildCommand = scripts.build ? `${manager} run build` : undefined;
  return {
    installCommand,
    buildCommand,
    runCommand,
    port: script ? port : undefined,
  };
}


async function prepareWorkspaceInternal(session: Session): Promise<void> {
  const cwd = "/home/user/repo";
  const sandbox = await connectSessionSandbox(session.sandboxId);
  const config = await getRepoConfig(
    session.installationId,
    session.repoFullName,
  );
  const detected = await detectPreviewSetup(sandbox);
  const installCommand = config?.installCommand || detected?.installCommand;
  const buildCommand = config?.buildCommand || detected?.buildCommand;
  const runCommand = config?.runCommand || detected?.runCommand;
  const port = config?.port ?? detected?.port;

  const runSetupStep = async (label: string, command: string) => {
    log(session, "info", `${label}: ${command}`);
    try {
      const result = await sandbox.commands.run(command, {
        cwd,
        timeoutMs: 5 * 60_000,
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
      log(
        session,
        "info",
        output ? `${label} finished.\n${output}` : `${label} finished.`,
      );
      return true;
    } catch (error: any) {
      const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
      log(session, "error", `${label} failed: ${output || error.message}`);
      return false;
    }
  };

  if (installCommand)
    await runSetupStep("Installing dependencies", installCommand);
  if (buildCommand) await runSetupStep("Building project", buildCommand);

  if (runCommand && port !== undefined) {
    log(session, "info", `Starting project: ${runCommand}`);
    session.previewStarting = true;
    await saveSession(session);
    try {
      await sandbox.commands.run(runCommand, { background: true, cwd });
      if (await waitForPort(sandbox, port)) {
        session.previewStarted = true;
        session.previewStarting = false;
        const hasUI = config?.hasUI !== false;
        if (hasUI) {
          try {
            await ensureRelay(sandbox, session.id, `http://localhost:${port}`);
          } catch (error: any) {
            log(
              session,
              "error",
              `Project is running, but the browser preview relay failed: ${error.message}`,
            );
          }
        }
        log(
          session,
          "info",
          `Project is ready on port ${port}. Handing the workspace to the agent.`,
        );
      } else {
        session.previewStarting = false;
        log(
          session,
          "error",
          `Project did not become ready on port ${port}; handing the workspace to the agent anyway.`,
        );
      }
    } catch (error: any) {
      session.previewStarting = false;
      log(
        session,
        "error",
        `Project startup failed: ${error.message}; handing the workspace to the agent anyway.`,
      );
    }
    await saveSession(session);
  } else {
    log(
      session,
      "info",
      "No app start command detected. Handing the cloned workspace to the agent.",
    );
  }

  await saveSession(session);
}

export function prepareWorkspace(session: Session): Promise<void> {
  if (!session.sandboxId || session.taskIntent !== "repository_task") return Promise.resolve();
  const job = prepareWorkspaceInternal(session);
  workspaceJobs.set(session.id, job);
  return job.finally(() => {
    if (workspaceJobs.get(session.id) === job) workspaceJobs.delete(session.id);
  });
}

// We're not using browser-relay service right now
router.post("/:sessionId/preview", async (req, res) => {
  let session = await loadOwned(req, res);
  if (!session) return;

  try {
    if (!session.sandboxId) {
      return res.status(400).json({ error: "This session has no workspace sandbox." });
    }
    const config = await getRepoConfig(
      session.installationId,
      session.repoFullName,
    );
    const sandbox = await connectSessionSandbox(session.sandboxId);
    const workspaceJob = workspaceJobs.get(session.id);
    if (workspaceJob) {
      await workspaceJob;
      session = (await getSession(session.id)) ?? session;
    }
    const detected = await detectPreviewSetup(sandbox);
    const runCommand = config?.runCommand || detected?.runCommand;
    const port = config?.port ?? detected?.port;
    const installCommand = config?.installCommand || detected?.installCommand;
    const buildCommand = config?.buildCommand || detected?.buildCommand;
    if (!runCommand || port === undefined) {
      return res.status(400).json({
        error:
          "Could not find a web app start script. Add a dev or start script to package.json, or configure the preview in Settings.",
      });
    }
    const hasUI = config?.hasUI !== false;
    const url = `https://${sandbox.getHost(port)}`;

    if (session.previewStarted) {
      if (hasUI)
        await ensureRelay(sandbox, session.id, `http://localhost:${port}`);
      return res.json({ ready: true, hasUI, url });
    }

    if (session.previewStarting) {
      const up = await waitForPort(sandbox, port);
      if (!up)
        return res
          .status(504)
          .json({
            error:
              "Project is still starting and did not become ready within 60s.",
          });
      if (hasUI)
        await ensureRelay(sandbox, session.id, `http://localhost:${port}`);
      session.previewStarted = true;
      session.previewStarting = false;
      await saveSession(session);
      return res.json({ ready: true, hasUI, url });
    }

    if (installCommand) {
      await sandbox.commands.run(installCommand, {
        cwd: "/home/user/repo",
        timeoutMs: 5 * 60_000,
      });
    }

    if (buildCommand) {
      await sandbox.commands.run(buildCommand, {
        cwd: "/home/user/repo",
        timeoutMs: 5 * 60_000,
      });
    }

    await sandbox.commands.run(runCommand, {
      background: true,
      cwd: "/home/user/repo",
    });
    const up = await waitForPort(sandbox, port);
    if (!up) {
      return res.status(504).json({
        error:
          "Server did not come up within 60s. It must listen on 0.0.0.0, not localhost.",
      });
    }

    if (hasUI)
      await ensureRelay(sandbox, session.id, `http://localhost:${port}`);

    session.previewStarted = true;
    await saveSession(session);
    res.json({ ready: true, hasUI, url });
  } catch (err) {
    if (isSandboxNotFoundError(err)) {
      return res.status(410).json({
        error:
          "This session's workspace has expired. Start a new session to preview the repository.",
      });
    }
    console.error("Preview failed", err);
    res.status(500).json({ error: "Failed to start preview." });
  }
});

router.delete("/:sessionId", async (req, res) => {
  const session = await loadOwned(req, res);
  if (!session) return;

  setStatus(session, "stopped");

  try {
    if (session.sandboxId) await Sandbox.kill(session.sandboxId);
  } catch {
  }

  await deleteSession(session.id);
  res.sendStatus(204);
});

export default router;
