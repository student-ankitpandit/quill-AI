# Quill System Architecture & Technical Design

## 1. Overview

**Quill** is an Cloud AI Agent and a software engineering copilot. Developers connect their GitHub repositories, assign natural-language coding tasks, ask technical questions, and receive automated pull requests with tested code changes.

Quill integrates directly with:

1. **GitHub App & OAuth APIs**: granular repository permissions, branch management, and PR creation.
2. **E2B MicroVM sandboxes**: isolated, ephemeral Linux environments where code is cloned, modified, built, tested, and run, with terminal and browser preview support.
3. **OpenAI GPT-5 agent engine**: autonomous tool-use loop with intent classification, multi-turn reasoning, and secret redaction.
4. **Real-time streaming (SSE and PTY)**: agent logs, chat messages, status transitions, and interactive terminal sessions.
5. **Subscription and credit metering**: Razorpay-backed plans with follow-up credit consumption.

---

## 2. High-Level System Topology

```mermaid
flowchart TD
    subgraph Client ["Client Browser (Frontend)"]
        UI["React 19 SPA (Tailwind CSS 4)"]
        Router["Client-Side Router (PushState)"]
        SSEClient["SSE Stream Listener"]
        TerminalStream["PTY Stream Reader"]
    end

    subgraph Backend ["Backend API Service (Render, Bun + Express)"]
        Express["Express 5 HTTP Server"]
        AuthMid["JWT Auth Middleware"]
        AgentEngine["Agent Loop and Tool Execution"]
        BillingModule["Billing and Credit Engine"]
        EventPubSub["EventEmitter Event Bus"]
        TerminalMgr["Terminal PTY Manager"]
        RelayMgr["Browser Preview Relay"]
    end

    subgraph DataStore ["Persistence Layer"]
        Postgres[("PostgreSQL")]
        PrismaORM["Prisma ORM Client"]
    end

    subgraph ExternalServices ["External Integrations"]
        OpenAI["OpenAI API (GPT-5)"]
        GitHub["GitHub REST / App API (Octokit)"]
        E2B["E2B Cloud Sandboxes"]
        Razorpay["Razorpay Payment Gateway"]
    end

    UI --> Router
    Router --> Express
    SSEClient <-->|SSE events| Express
    TerminalStream <-->|PTY stream| Express

    Express --> AuthMid
    AuthMid --> AgentEngine
    AuthMid --> BillingModule
    AgentEngine --> EventPubSub
    EventPubSub --> Express
    Express --> TerminalMgr
    Express --> RelayMgr

    Express --> PrismaORM
    BillingModule --> PrismaORM
    AgentEngine --> PrismaORM
    PrismaORM --> Postgres

    AgentEngine --> OpenAI
    Express --> GitHub
    AgentEngine --> GitHub
    AgentEngine <-->|commands and files| E2B
    TerminalMgr <-->|PTY session| E2B
    Express --> Razorpay
```

---

## 3. Frontend Architecture (`fe/`)

A lightweight single-page application built on React 19, bundled with Bun, and styled with Tailwind CSS 4.

### 3.1 Technology Stack

| Area | Choice |
|---|---|
| Framework | React 19 |
| Bundler | Bun (`bun build`) |
| Styling | Tailwind CSS 4 plus custom dark/light themes |
| Icons | `lucide-react` |
| Markdown | `react-markdown` + `remark-gfm` |
| Deployment | Vercel SPA (`fe/vercel.json` rewrites) |

### 3.2 Page and Route Hierarchy

```mermaid
flowchart LR
    Root["App Router"] --> LandingPage["LandingPage: /"]
    Root --> PolicyPage["PolicyPage: /policy/*"]
    Root --> DashboardGate["DashboardGate"]
    Root --> SessionView["RightSplitViewPage: /sessions/:id"]
    Root --> AuthCallback["AuthCallback: /auth/callback"]

    DashboardGate --> NewSession["NewSessionPage: task creator"]
    DashboardGate --> Settings["SettingsPage: config and billing"]
    DashboardGate --> Review["ReviewPage: PR code reviewer"]
```

- [`App.tsx`](../fe/src/App.tsx): dispatches views using a custom `pushState` router in [`router.ts`](../fe/src/lib/router.ts).
- **`DashboardGate`**: guards authenticated routes by checking the JWT and GitHub App installation status.
- **`RightSplitViewPage`** ([`RightSplitView.tsx`](../fe/src/pages/RightSplitView.tsx)): the core interface. A left conversational timeline with markdown rendering, and a right workspace drawer with:
  - **Files**: workspace file explorer and inline editor.
  - **Changes**: live `git diff` against workspace `HEAD`.
  - **Terminal**: interactive Ubuntu bash shell over an E2B PTY stream.
  - **Side Chat**: out-of-band assistant chat that does not modify main conversation state or run repository tools.
  - **Progress**: real-time status and structured activity logs.

### 3.3 Real-Time Streaming Channels

1. **Agent activity stream** (`/api/session/:id/stream`): Server-Sent Events carrying `log`, `message`, and `status` updates, with automatic reconnect logic in [`api.ts`](../fe/src/lib/api.ts).
2. **Terminal stream** (`/api/app/sessions/:id/terminal/stream`): base64-encoded chunked stream supporting keystroke delivery, screen redraws, and terminal resize (`SIGWINCH`).

---

## 4. Backend Architecture (`be/`)

Built with Bun and Express 5, using an asynchronous, event-driven pattern for long-running AI tasks.

| Module | Location | Responsibility |
|---|---|---|
| Entry point and API gateway | [`index.ts`](../be/index.ts) | Express config, CORS, route dispatch, auth exchange, webhooks, SSE endpoints. |
| Agent engine | [`agent.ts`](../be/agent.ts) | Intent classifier, tool loop, OpenAI orchestration, git publisher, secret scanner. |
| Session lifecycle | [`sessions.ts`](../be/sessions.ts) | DB sync, status updates, message appends, log truncation, token redaction. |
| Session routes | [`routes/session.ts`](../be/routes/session.ts) | Preview detection (`detectPreviewSetup`), workspace bootstrap, session deletion. |
| GitHub App integration | [`lib.ts`](../be/lib.ts) | Octokit auth, RSA JWT signing, installation token exchange. |
| Billing and credits | [`billing.ts`](../be/billing.ts) | Credit allocation, subscription checks, plan enforcement. |
| Terminal sessions | [`terminal-sessions.ts`](../be/terminal-sessions.ts) | Tracks PTY process IDs per session in PostgreSQL. |
| Event pub/sub | [`events.ts`](../be/events.ts) | Node `EventEmitter` coordinating multi-subscriber SSE broadcast. |
| Relay stream | [`browser-stream.ts`](../be/browser-stream.ts) | Injects a headless browser relay script into E2B to proxy web dev servers. |

---

## 5. Autonomous Agent System

The agent uses a classified hybrid loop: a fast path for casual chat, and a sandboxed tool-augmented loop for repository changes.

```mermaid
sequenceDiagram
    autonumber
    actor User as User (Browser)
    participant API as Backend API
    participant Agent as Agent Engine
    participant OpenAI as OpenAI GPT-5
    participant E2B as E2B Sandbox
    participant GH as GitHub API

    User->>API: POST /api/app/sessions (task prompt)
    API->>Agent: classifyUserIntent(prompt)
    Agent->>OpenAI: Intent classification prompt
    OpenAI-->>Agent: intent = conversation, informational, or repository_task

    alt intent is conversation
        API->>Agent: runAgent (skip sandbox creation)
        Agent->>OpenAI: Generate conversational reply
        OpenAI-->>Agent: Assistant message
        Agent-->>User: Stream response via SSE (about 2s)
    else intent is repository_task
        API->>Agent: Provision sandbox in background
        Agent-->>E2B: Create sandbox and clone repo
        Agent->>OpenAI: Run agent loop with tools
        loop Up to 30 iterations
            OpenAI-->>Agent: Function tool call
            alt Tool is ask_user
                Agent->>User: Status WAITING_FOR_INPUT
            else Repository tools
                Agent->>E2B: Execute command, read, or write
                E2B-->>Agent: Output or file content
                Agent->>OpenAI: Send tool result
            end
        end
        Agent->>E2B: git status, add, commit
        Agent->>GH: git push to quill-agent branch
        Agent->>GH: Open pull request
        GH-->>Agent: PR URL
        Agent->>User: Status DONE (PR URL and summary)
    end
```

### 5.1 Intent Classification

Every incoming message goes through `classifyUserIntent()` in [`agent.ts`](../be/agent.ts):

- **`conversation`**: greetings and casual chat. The sandbox is bypassed entirely, giving replies in about 2s.
- **`informational`**: general questions that may need codebase inspection. Tools are available; the sandbox is provisioned lazily only if the model calls `read_file`.
- **`repository_task`**: requests to inspect, edit, fix, test, or build code. The E2B sandbox is provisioned speculatively in the background while the model plans.

### 5.2 Tool Registry

| Tool | Behavior |
|---|---|
| `run_command(command)` | Runs a shell command in `/home/user/repo` with a 120s timeout. |
| `read_file(path)` | Reads files up to 20,000 characters, relative to repo root. |
| `write_file(path, content)` | Writes or overwrites workspace files. |
| `ask_user(question)` | Halts the turn, sets status `waiting_for_input`, awaits user reply. |

### 5.3 Git Publishing and Secret Scanning

Before pushing:

- `findExposedSecrets(diff)` scans for private keys, GitHub tokens, AWS keys, Slack tokens, JWTs, Stripe keys, and live Razorpay credentials.
- `publishChanges()` checks for uncommitted changes, creates a dedicated branch (`quill-agent-<task>-<timestamp>`), commits as `cloud-agent`, pushes with installation credentials, and opens a PR with a structured task summary.
- Remote URLs are scrubbed after publishing so installation tokens never remain in `.git/config`.

---

## 6. E2B Sandbox Runtime

E2B provides hardware-virtualized MicroVMs running Ubuntu Linux.

### 6.1 Workspace and Lifecycle

- Path: `/home/user/repo`
- Isolation: each session has a unique `sandboxId`.
- Idle timeout: 30-minute sliding window (`sandbox.setTimeout(30 * 60 * 1000)`).
- Configured with `onTimeout: "pause"` and `autoResume: true`.
- Lazy reconnection: `ensureSessionSandbox()` in [`lib.ts`](../be/lib.ts) detects expired sandboxes (`SandboxNotFoundError`) and provisions a clean replacement.

### 6.2 Automatic App Preview Detection

`detectPreviewSetup()` in [`routes/session.ts`](../be/routes/session.ts) analyzes the workspace:

- Detects the package manager (`bun`, `pnpm`, `yarn`, `npm`) from lockfiles.
- Reads `package.json` or `go.mod` to resolve dev and start scripts.
- Detects frameworks (`next`, `vite`) and injects host/port config (`0.0.0.0:3000`).
- Spawns background servers and verifies readiness via `curl` polling (`waitForPort`).

---

## 7. Security, Auth and Multi-Tenancy

```mermaid
flowchart TD
    User([GitHub User]) -->|1. OAuth login| GHApp[GitHub App Authorization]
    GHApp -->|2. Exchange code| QuillAuth["/api/auth/exchange"]
    QuillAuth -->|3. Look up installations| GHEndpoint["GitHub /user/installations"]
    QuillAuth -->|4. Generate RS256 JWT| Token[Quill Bearer JWT]
    Token -->|5. Store in localStorage| BrowserClient[Browser Client]
    BrowserClient -->|6. API requests with auth header| BackendAPI[Quill Express API]
    BackendAPI -->|7. Verify JWT| AuthMW[authMiddleware]
    AuthMW -->|8. Fetch installation token| OctokitApp[Octokit Instance]
```

1. **Authentication**: users sign in via GitHub OAuth.
2. **Authorization**: the backend signs an RS256 JWT containing `userId`, `login`, and `installationId`.
3. **Repository boundaries**: Octokit instances use short-lived GitHub App installation tokens scoped to the tenant's `installationId`. Quill can only access repositories the user granted in GitHub App settings.

---

## 8. Database Architecture (PostgreSQL and Prisma)

The schema ([`schema.prisma`](../be/prisma/schema.prisma)) models users, GitHub installations, sessions, logs, agent runs, and subscriptions.

```mermaid
erDiagram
    User ||--o{ GitHubInstallation : installs
    User ||--o{ Subscription : subscribes
    GitHubInstallation ||--o{ Session : owns
    GitHubInstallation ||--o{ RepositoryConfig : configures

    Session ||--o{ SessionMessage : contains
    Session ||--o{ SessionLog : records
    Session ||--o{ SideChatMessage : side_discussions
    Session ||--o{ AgentRun : tracks
    Session ||--o{ QueuedAgentMessage : queues
    Session ||--o| TerminalSession : runs

    User {
        string id PK
        string publicId UK
        string githubUserId UK
        string login
        string name
        string email
    }

    GitHubInstallation {
        string installationId PK
        string userId FK
        string refreshToken
    }

    Session {
        string id PK
        string installationId FK
        string repoFullName
        string sandboxId UK
        string taskIntent
        string task
        string title
        int issueNumber
        string status
        string branch
        string prUrl
        boolean previewStarted
    }

    SessionMessage {
        string id PK
        string sessionId FK
        int sequence
        string role
        json payload
    }

    SessionLog {
        string id PK
        string sessionId FK
        int sequence
        datetime time
        string type
        string text
    }

    AgentRun {
        string id PK
        string sessionId FK
        string provider
        string model
        string status
        int totalTokens
    }

    Subscription {
        string id PK
        string userId FK
        string plan
        string status
        int priceMinorUnits
        datetime currentPeriodEnd
    }
```

---

## 9. Monetization and Credits (`billing.ts`)

### 9.1 Plan Tiers

| Plan | Credits |
|---|---|
| Free | 5 (lifetime trial) |
| Basic | 50 per billing period |
| Pro | 100 per billing period |

### 9.2 Credit Consumption

- Creating a session consumes **1 credit**.
- Every **2 follow-up requests** in the same session consume **1 additional credit**.

```text
credits = 1 + floor(max(0, requestCount - 1) / 2)
```

| Requests in session | Credits used |
|---|---|
| 1 | 1 |
| 2 | 1 |
| 3 | 2 |
| 5 | 3 |

Razorpay handles checkout orders (`/create-order`) and signature verification (`/verify-payment`), with automatic subscription activation.

---

## 10. Production Deployment

```mermaid
flowchart TD
    subgraph VercelEdge ["Vercel Edge Network"]
        SPA["Frontend build (HTML, JS, CSS)"]
        Rewrite["SPA rewrites via vercel.json"]
    end

    subgraph RenderPlatform ["Render Cloud Platform"]
        API["Backend service"]
        ManagedDB[("Managed PostgreSQL")]
    end

    subgraph ExternalPaaS ["External Infrastructure"]
        E2BVM["E2B MicroVM farm"]
        OpenAIGateway["OpenAI API"]
        GitHubCore["GitHub API and Git servers"]
    end

    Users((Global Users)) --> SPA
    SPA -->|REST and SSE| API
    API --> ManagedDB
    API -->|MicroVM control| E2BVM
    API -->|Inference| OpenAIGateway
    API -->|Git operations| GitHubCore
```

- **Frontend**: Vercel (`quill-si.vercel.app`). All paths rewrite to `dist/index.html` for client-side routing.
- **Backend**: Render (`quill-c05l.onrender.com`), running Bun in Linux containers.
- **Database**: managed PostgreSQL on Render, schema managed via Prisma.
- **Local development**: runnable via Bun, frontend on `localhost:3000` and backend on `localhost:3001`.