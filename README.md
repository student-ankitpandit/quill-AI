<p align="center">
  <img src="fe/src/logo.svg" alt="Quill AI logo" width="88" height="88" />
</p>

<h1 align="center">Quill AI</h1>

Quill AI is cloud AI coding agent. A user chooses a github repository, describes a task, and Quill works in an isolated cloud workspace. The dashboard streams the agent's progress and lets the user inspect files, changes, and terminal output. When code work is ready, Quill can publish a branch and open a pull request for the user to review.

## Contents

- [What Quill does](#what-quill-does)
- [How the system fits together](#how-the-system-fits-together)
- [Repository layout](#repository-layout)
- [Requirements](#requirements)
- [Run Quill locally](#run-quill-locally)
- [Environment variables](#environment-variables)
- [Database and Prisma](#database-and-prisma)
- [GitHub setup](#github-setup)
- [E2B workspace setup](#e2b-workspace-setup)
- [Payments and plans](#payments-and-plans)
- [Deployment](#deployment)
- [Useful commands](#useful-commands)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)

## What Quill does

- **GitHub sign-in and repository access:** users authenticate with GitHub and install the HelloQuill GitHub App, granting access to all repositories or only the repositories they select.
- **Coding sessions:** users start a session for a repository and send a task. The backend classifies messages as conversation, informational, or repository work so casual chat does not need to trigger repository actions.
- **Isolated workspaces:** repository work runs in an E2B sandbox rather than on the user's computer or the Quill web server.
- **Live session view:** the dashboard streams agent messages, status, and activity. It includes workspace files, a changes view, an Ubuntu terminal, side chat, and progress details.
- **Pull requests:** after repository changes, Quill can publish a branch and create a pull request. Users review the result; merging remains the user's decision and requires their explicit action.
- **Pull request review:** the Review area accepts a GitHub pull request URL and reports a model-generated review, including findings and possible exposed secrets. The GitHub App must be able to access that repository. Binary or otherwise unpatchable files may be omitted from textual diff review.
- **Plans and usage:** the app currently has a free allowance and paid Basic and Pro plans. Usage is tracked in agent runs, and the backend enforces the plan limits.
- **Payments:** paid plans use Razorpay checkout and server-side signature/payment verification.
- **Settings:** users can view their account, usage, plan and billing information, and GitHub connection.

## How the system fits together

```text
Browser (React + Bun) ──HTTP / event stream──> Backend (Express + Bun)
                                                   │
                ┌──────────────────────────────────┼───────────────────────────┐
                │                                  │                           │
          PostgreSQL / Prisma                GitHub OAuth + App          OpenAI API
                                                   │
                                             E2B sandbox
                                        (repository and terminal)

Browser ──Razorpay Checkout──> Razorpay ──payment verification──> Backend
```

The frontend calls the local backend at `http://localhost:3001` when the browser is on localhost. On a public host it defaults to the deployed backend URL; `BUN_PUBLIC_API_URL` can override the production default at frontend build time. The backend derives its public OAuth callback and CORS origins from its environment and deployment defaults.

### A session from start to finish

1. The user signs in through the GitHub OAuth App. The backend exchanges the callback for GitHub identity, resolves the user's GitHub App installation, and gives the browser a signed Quill token.
2. The user selects a repository exposed by that GitHub App installation and submits a task. The backend checks the user's available plan allowance and classifies the request before starting repository work.
3. For repository work, the backend creates an E2B sandbox, clones the selected repository into the workspace, and starts the GPT-5 agent loop. The agent can inspect or edit the sandbox and run repository commands through its tools.
4. Messages, status, and activity are persisted in PostgreSQL and streamed to the browser. The workspace panels use authenticated API calls to read files, diffs, terminal output, and side-chat messages.
5. When requested code work is ready, Quill publishes a branch and opens a pull request. The user reviews the changes in GitHub or in Quill and chooses whether to merge.

Conversation or informational messages should not need a repository checkout or publication step. Paid usage is charged against agent runs and the backend enforces the allowance before a new session starts.

## Repository layout

```text
.
├── README.md                 # This guide
├── fe/                       # React frontend, served/built with Bun
│   ├── src/pages/             # Landing, dashboard, session, settings, review, policy pages
│   ├── src/components/        # Shared UI components
│   └── package.json
├── be/                       # Express API, agent orchestration, persistence
│   ├── index.ts               # API routes and server startup
│   ├── agent.ts               # GPT-5 agent, intent classification, tool loop, PR work
│   ├── lib.ts                 # GitHub and E2B helpers
│   ├── billing.ts             # Subscription usage limits
│   ├── prisma/schema.prisma   # PostgreSQL data model
│   └── package.json
└── e2b-template/              # Docker base for E2B coding workspaces
    └── Dockerfile
```

## Backend API at a glance

Most application endpoints expect the signed Quill token in the `Authorization: Bearer …` header. The frontend API helpers add it automatically. Session activity uses a Server-Sent Events stream so new messages, logs, and status changes can appear without repeatedly reloading the conversation.

| Area | Main endpoints | Purpose |
| --- | --- | --- |
| Health | `GET /health` | Hosting-platform health check |
| Authentication | `GET /api/auth/github`, `GET /api/auth/github/callback`, `POST /api/auth/exchange` | GitHub sign-in and browser token exchange |
| Account and installation | `GET /api/auth/profile`, `GET /api/auth/installation` | Current Quill profile and GitHub App installation state |
| Repositories | `GET /api/github/repos`, `POST /api/github/repo/config` | List accessible repositories and save repository setup commands |
| Sessions | `POST /api/app/sessions`, `GET /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/messages`, `POST /api/sessions/:id/stop` | Create, list, resume, message, and stop coding sessions |
| Session stream | `GET /api/session/:id/stream` | Stream session messages, logs, and status events |
| Workspace | `/api/app/sessions/:id/workspace/*`, `/api/app/sessions/:id/changes` | Browse/read/edit files and inspect sandbox changes |
| Terminal and side chat | `/api/app/sessions/:id/terminal/*`, `/api/app/sessions/:id/side-chat` | Interact with the sandbox shell and separate side conversation |
| Pull requests | `POST /api/app/sessions/:id/pull-request`, `POST /api/reviews/pull-request`, `POST /api/reviews/pull-request/chat` | Publish session changes or review/ask about an existing GitHub PR |
| Billing | `GET /api/billing/usage`, `GET /api/billing/history`, `POST /create-order`, `POST /verify-payment` | Read allowance/history and complete Razorpay checkout |

The backend route implementation is in `be/index.ts`; session-specific preview and workspace routes are also registered from `be/routes/session.ts`. Treat the source as authoritative if this overview and the implementation ever differ.

## Requirements

- [Bun](https://bun.sh/) for the frontend and backend
- Node.js/npm available in the E2B template for repository tasks that need them
- A PostgreSQL database
- A GitHub OAuth App and the HelloQuill GitHub App
- An OpenAI API key
- An E2B account and a built E2B template
- Razorpay credentials to enable paid-plan checkout (optional for local work not involving payments)
- A Vercel token only if using the optional sandbox deployment feature

## Run Quill locally

The frontend and backend are separate applications. Run each in its own terminal from its directory.

### 1. Configure the backend

Create `be/.env` and fill in the variables listed in [Environment variables](#environment-variables). Do not commit this file.

### 2. Install backend dependencies and generate Prisma Client

```powershell
cd be
bun install
bun run db:generate
```

Apply the Prisma schema to a development database when you are ready to initialize or update it:

```powershell
bun run db:push
```

Start the API:

```powershell
bun run dev
```

The backend listens on `http://localhost:3001` by default. It uses the `PORT` supplied by platforms such as Render when present. Check `http://localhost:3001/health` for the health response.

### 3. Install and start the frontend

In a second terminal:

```powershell
cd fe
bun install
bun run dev
```

Open the local URL printed by Bun (normally `http://localhost:3000`). The frontend detects localhost and calls `http://localhost:3001`, so the deployed backend URL does not need to be swapped in when testing locally.

### 4. Sign in and create a session

Use **Continue with GitHub**, install the HelloQuill GitHub App for the account, and grant it access to at least one repository. Select a repository, describe a task, and start a session. Creating sessions requires the free or paid run allowance to be available and the backend's OpenAI, database, GitHub App, and E2B settings to be configured.

## Environment variables

Set secrets in `be/.env` for local development and in the backend hosting provider's secret/environment settings in production. The frontend only needs a public API URL override for a non-default deployment; never put backend secrets in frontend variables.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Backend | PostgreSQL connection string used by Prisma. Required. |
| `OPENAI_API_KEY` | Backend / OpenAI SDK | Credentials for GPT-5 agent responses, intent classification, and pull request review. Required for AI features. |
| `GITHUB_CLIENT_ID` | Backend | GitHub OAuth App client ID. Required for sign-in. |
| `GITHUB_CLIENT_SECRET` | Backend | GitHub OAuth App client secret. Required to exchange OAuth authorization codes. |
| `GITHUB_APP_ID` | Backend | HelloQuill GitHub App ID, used to create App authentication tokens. Required for repository access. |
| `GITHUB_PRIVATE_KEY` | Backend | PEM private key for the GitHub App and signed Quill tokens. Keep the complete private key secure; configure it as a multiline secret in production. |
| `E2B_API_KEY` | Backend / E2B SDK | E2B API key used to create and connect coding workspaces. Required for repository sessions. |
| `E2B_TEMPLATE` | Backend | ID of the E2B template used to start workspaces. Required for repository sessions. |
| `FRONTEND_URL` | Backend | Public frontend origin for OAuth redirects and CORS. Defaults to the app's deployed frontend in production and localhost in development. Set this to the actual frontend origin if it differs. |
| `BACKEND_URL` | Backend | Public backend origin used to form GitHub's OAuth callback URL. Defaults to the Render external URL in production and localhost in development. |
| `RENDER_EXTERNAL_URL` | Backend on Render | Render-provided public service URL; used as the production backend-origin fallback. |
| `PORT` | Backend | HTTP listen port supplied by the hosting platform. Defaults to `3001` locally. Usually set automatically by Render. |
| `SERVER_PORT` | Backend | Secondary local listen-port setting, used only when `PORT` is absent. Defaults to `3001`. |
| `BUN_PUBLIC_API_URL` | Frontend build | Optional production API origin override. Localhost browsers always use `http://localhost:3001`; public builds fall back to the configured production backend. |
| `RAZORPAY_API_KEY` | Backend | Razorpay public key ID. Returned to the browser through the backend's payments config endpoint. |
| `RAZORPAY_API_KEY_SECRET` | Backend | Razorpay secret used to create orders and verify captured payments. Backend only; never expose it to the frontend. |
| `BUN_PUBLIC_RAZORPAY_KEY_ID` | Frontend build | Optional public Razorpay key ID override. The frontend can also fetch the public key from the backend. This is not a secret. |
| `VERCEL_TOKEN` | Backend / E2B sandbox | Optional token for the feature that deploys a workspace using the Vercel CLI. |
| `SANDBOX_SECRET` | Backend middleware | Optional shared secret for internal sandbox endpoints protected by the secret middleware. |

The frontend's public API URL is resolved at runtime from the browser hostname: localhost uses the local backend, and a deployed site uses the production default or the build-time override. For OAuth, the GitHub OAuth App's callback must exactly match:

```text
<BACKEND_URL>/api/auth/github/callback
```

For example, local development uses `http://localhost:3001/api/auth/github/callback`; the hosted app uses the backend's HTTPS origin followed by the same path. Configure the GitHub App's homepage and post-installation setup URL to the public frontend as appropriate for the GitHub App settings.

## Database and Prisma

The Prisma schema is in `be/prisma/schema.prisma`. It defines records for:

- Users and GitHub App installations
- Installation events and per-repository setup commands
- Sessions, conversation messages, activity logs, side chat, and terminal state
- Agent runs, model/token usage, queued messages, and run status
- Subscriptions, payment/order identifiers, billing periods, and plan status
- Backend migration tracking

Prisma Client is generated into `be/prisma/generated/prisma`, which is generated output and should not be committed. From `be/`, run:

```bash
bun run db:generate
```

For a local development database, `bun run db:push` applies the current schema directly. For production, use a reviewed and versioned migration workflow rather than casually pushing schema changes from a developer machine. Back up production data before schema operations.

## GitHub setup

Quill uses two related GitHub configurations:

1. **GitHub OAuth App** signs users in. Its client ID and secret are `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Add the backend callback URL to the OAuth App's authorization callback URLs.
2. **GitHub App** grants repository permissions and performs repository operations on behalf of each installation. Configure its App ID and private key as `GITHUB_APP_ID` and `GITHUB_PRIVATE_KEY`. Users install it and select the repositories Quill may access.

The GitHub App needs the permissions required by the app's operations, including repository metadata/code and pull request access. Keep the App's configured permissions aligned with features such as reading files, creating branches/commits, opening pull requests, and reviewing pull requests. After changing permissions, GitHub may require users to approve the updated installation permissions.

An installation is account-specific. A user who signs in must install the app (or have an existing installation) and grant access to the repository they want to use. A successful OAuth login alone does not imply that the app can read every repository.

## E2B workspace setup

Repository sessions are created in E2B, using the template ID configured by `E2B_TEMPLATE`. The included `e2b-template/Dockerfile` is based on E2B's code-interpreter image and installs the Vercel CLI for optional deployment actions.

Build/publish the template using the E2B template workflow for your account, then put the resulting template ID in the backend environment. The backend clones the selected repository into `/home/user/repo` in the sandbox. The terminal and preview services operate against that sandbox; the Quill backend itself does not host the user's repository checkout.

Sandbox lifetimes are finite. Persisted session records and messages live in PostgreSQL, while the working checkout lives in the sandbox. If a sandbox expires before work is published, its unpushed working-tree changes may no longer be available; users should rely on a pushed branch or pull request for durable code changes.

## Payments and plans

The backend creates Razorpay orders and verifies the signature and captured payment with Razorpay before activating a subscription. The amount sent to Razorpay is expressed in the currency's minor unit (paisa for INR). Keep the public Razorpay key ID separate from the secret key, and configure test/live credentials consistently between Razorpay and Quill.

Current backend limits are:

| Plan | Agent runs per period | Price configured in code |
| --- | ---: | ---: |
| Free | 5 trial runs | Free |
| Basic | 50 runs | ₹799 per 30 days |
| Pro | 100 runs | ₹1,599 per 30 days |

The backend is authoritative for limits and prices; frontend display text alone does not grant access. Update the backend billing/order configuration and frontend pricing presentation together when plans change.

## Deployment

### Frontend

The frontend can be deployed as a static web app (the project uses Bun to build it). In the `fe/` directory:

```bash
bun install
bun run build
```

The build output is `fe/dist`. Configure the hosting platform to use `fe` as the project root and serve the generated static files with SPA fallback behavior so hash routes and dashboard paths load the frontend entry point. Set `BUN_PUBLIC_API_URL` only when the production backend differs from the built-in production default.

### Backend

The backend can be deployed as a Bun service (for example, on Render) with `be/` as its root directory. Install dependencies, generate Prisma Client, build, and start with:

```bash
bun install
bun run db:generate
bun run build
bun run start
```

Provide the production environment variables listed above. The server listens on the platform-provided `PORT`. Configure the health check path as `/health`. Set `FRONTEND_URL` to the deployed frontend origin and `BACKEND_URL` to the public backend origin so CORS and the GitHub OAuth callback point to the correct hosts.

When deploying a new database schema, run the approved migration step as part of a deliberate release. Do not assume a local `.env` file exists on the host; configure values through the host's environment/secret settings.

## Useful commands

Run commands from the relevant subdirectory.

| Directory | Command | Purpose |
| --- | --- | --- |
| `fe/` | `bun install` | Install frontend dependencies |
| `fe/` | `bun run dev` | Start the frontend development server |
| `fe/` | `bun run build` | Build the frontend into `dist/` |
| `fe/` | `bun run dev:css` | Watch and rebuild Tailwind CSS during development |
| `be/` | `bun install` | Install backend dependencies |
| `be/` | `bun run dev` | Start the backend with watch mode |
| `be/` | `bun run build` | Build the backend into `dist/` |
| `be/` | `bun run start` | Start the built backend |
| `be/` | `bun run db:generate` | Generate Prisma Client |
| `be/` | `bun run db:push` | Apply the current Prisma schema directly (development use) |
| `be/` | `bun run db:studio` | Open Prisma Studio |

## Troubleshooting

### The frontend says it cannot reach Quill's server

- When testing locally, start the backend on port `3001` and the frontend on port `3000`.
- Check `http://localhost:3001/health`.
- In browser DevTools, confirm API calls use `localhost:3001` locally and the deployed backend origin on the public site.
- In production, verify `FRONTEND_URL`, `BACKEND_URL`, CORS origin, and `BUN_PUBLIC_API_URL` (if set) agree with the actual deployed domains.

### GitHub OAuth says the redirect URL is not associated with the application

The callback URL in the GitHub OAuth App must exactly match the backend callback in the authorization request, including scheme, host, port, and path. Local and production callbacks are different; register the needed callback URLs in GitHub's OAuth App settings.

### Sign-in succeeds but no repositories appear

Verify that the user installed the HelloQuill GitHub App for the same GitHub account, selected at least one repository, and that the installation has the required repository permissions. Sign-in and GitHub App installation are separate steps.

### Prisma cannot connect or the generated client is missing

Check `DATABASE_URL`, run `bun run db:generate` from `be/`, and ensure the PostgreSQL database is reachable from the backend. For a new local schema, use the development database initialization workflow described above. Do not put the generated Prisma client path into `.env`; Prisma Client is imported from the generated output by backend code.

### Razorpay reports a missing key or payment verification error

Check that `RAZORPAY_API_KEY` and `RAZORPAY_API_KEY_SECRET` are configured on the backend. The browser key is public; the secret must stay server-side. Use matching test or live credentials and confirm the order amount/currency in Razorpay minor units (for INR, ₹1 is 100 paisa).

### E2B cannot start a session

Check `E2B_API_KEY` and `E2B_TEMPLATE`, verify that the template exists in the configured E2B account, and inspect the backend logs for sandbox creation or GitHub clone errors.

## Security notes

- Never commit `.env` files, GitHub private keys, OAuth secrets, OpenAI keys, E2B keys, Razorpay secrets, or Vercel tokens.
- Only variables prefixed with `BUN_PUBLIC_` should be treated as safe to expose in frontend builds. Public key IDs are intended for browser use; private keys and API secrets are not.
- Grant the GitHub App only the permissions its product features need. Users choose which repositories the installation can access.
- Review generated changes and pull requests before merging. Quill does not merge a pull request without the user's explicit approval.
- The AI review is an aid to human review, not a guarantee that code is safe, correct, or free of vulnerabilities.

## Contribution Guidelines

Contributions that improve Quill's reliability, security, accessibility, documentation, or user experience are welcome.

1. **Discuss substantial changes first.** Open an issue or discussion describing the problem, expected behavior, and proposed approach before starting large features or changes to authentication, billing, data storage, or deployment.
2. **Keep changes focused.** Make one coherent change per pull request where practical. Avoid unrelated formatting or generated-file changes.
3. **Work on a branch.** Create a descriptive branch from the current default branch; do not commit directly to the default branch.
4. **Follow the existing structure and style.** Frontend changes belong in `fe/`; API, agent, persistence, and billing changes belong in `be/`. Keep secrets and environment-specific values in environment configuration, never in source code.
5. **Update documentation and configuration examples.** If a change affects setup, environment variables, routes, database schema, or user-visible behavior, update this README or the relevant project documentation.
6. **Check your changes before opening a pull request.** Run the relevant build or checks for the part you changed, and describe what you ran and the result. If a check cannot be run, say so and explain why. Do not include credentials, real customer data, or private repository content in logs, screenshots, or fixtures.
7. **Open a pull request for review.** Include the motivation, a concise summary, relevant screenshots for UI changes, database or environment changes, and any known limitations. Wait for review and required checks before merging.

Pull requests should not include `.env` files, secrets, generated Prisma Client output, build output, or unrelated local changes. Changes that alter the Prisma schema should describe the migration or deployment steps needed to apply them safely.
