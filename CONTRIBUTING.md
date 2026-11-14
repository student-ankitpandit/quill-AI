# Contributing to Quill AI

Thank you for your interest in contributing to Quill AI! This guide will help you get started, whether you're fixing a bug, adding a feature, or improving documentation.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Coding Guidelines](#coding-guidelines)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [Reporting Issues](#reporting-issues)
- [Security Vulnerabilities](#security-vulnerabilities)

## Code of Conduct

By participating in this project, you agree to maintain a respectful, inclusive, and harassment-free environment. Be kind, constructive, and professional in all interactions.

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/quill.git
   cd quill
   ```
3. **Create a branch** for your work:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) (runtime for both frontend and backend)
- PostgreSQL database (local or hosted)
- A GitHub OAuth App and the HelloQuill GitHub App
- An OpenAI API key
- An E2B account with a built template
- Razorpay credentials (optional, only for payment-related work)

### Backend

```bash
cd be
cp .env.example .env       # Fill in your credentials
bun install
bun run db:generate        # Generate Prisma Client
bun run db:push            # Apply schema to your dev database
bun run dev                # Start with watch mode on :3001
```

### Frontend

```bash
cd fe
cp .env.example .env       # Fill in if needed
bun install
bun run dev                # Start dev server on :3000
```

The frontend automatically calls `http://localhost:3001` when running on localhost.

### Verify Setup

- Backend health check: `http://localhost:3001/health`
- Frontend: `http://localhost:3000`
- Sign in with GitHub, install the GitHub App, and try creating a session.

## Project Structure

```
quill/
├── fe/                        # Frontend (React 19 + Tailwind CSS 4 + Bun)
│   ├── src/
│   │   ├── pages/             # Page components (Landing, Dashboard, Session, etc.)
│   │   ├── components/        # Shared UI components
│   │   └── lib/               # API client, router, utilities
│   ├── styles/                # Global CSS
│   ├── build.ts               # Bun build script
│   └── vercel.json            # Vercel SPA rewrite config
│
├── be/                        # Backend (Express 5 + Bun)
│   ├── index.ts               # API routes and server startup
│   ├── agent.ts               # GPT-5 agent, intent classification, tool loop
│   ├── lib.ts                 # GitHub and E2B sandbox helpers
│   ├── billing.ts             # Plan limits and subscription logic
│   ├── sessions.ts            # Session management and SSE
│   ├── events.ts              # Event types and pub/sub
│   ├── routes/                # Modular route handlers
│   ├── middlewares/           # Auth and request middleware
│   ├── prisma/
│   │   └── schema.prisma      # PostgreSQL data model
│   └── data/                  # Static data files
│
└── e2b-template/              # Docker template for E2B coding sandboxes
    └── Dockerfile
```

### Key Concepts

- **Intent Classification**: User messages are classified as `conversation`, `informational`, or `repository_task`. Only `repository_task` spins up an E2B sandbox.
- **Lazy Sandbox Provisioning**: Sandboxes are created on-demand, not upfront. Conversation and informational intents skip sandbox creation entirely.
- **SSE Streaming**: Session messages, status, and activity are streamed to the browser via Server-Sent Events.
- **Agent Tool Loop**: The GPT-5 agent runs in a loop, calling tools (file read/write, terminal, search) until the task is complete.

## Development Workflow

### 1. Pick an Issue

- Check existing [issues](../../issues) for bugs or feature requests.
- For substantial changes (auth, billing, schema, deployment), **open an issue first** to discuss your approach.

### 2. Make Your Changes

- **Frontend changes** go in `fe/src/`.
- **Backend changes** go in `be/`.
- Keep changes focused — one coherent change per PR.

### 3. Test Your Changes

Before opening a PR, verify your changes work:

```bash
# Build frontend
cd fe && bun run build

# Build backend
cd be && bun run build
```

- If you changed the Prisma schema, run `bun run db:generate` and `bun run db:push`.
- Test the affected user flow end-to-end (sign in → create session → verify behavior).
- For UI changes, test on both desktop and mobile viewport sizes.

### 4. Open a Pull Request

Push your branch and open a PR against the `main` branch.

## Coding Guidelines

### General

- Follow the existing code style and patterns — don't introduce new frameworks or major dependencies without discussion.
- Keep secrets and environment-specific values in `.env`, never hardcoded in source.
- Don't commit generated files (`prisma/generated/`, `dist/`, `node_modules/`).

### Frontend

- **React 19** with functional components and hooks.
- **Tailwind CSS 4** for styling; use existing utility classes and CSS files in `styles/` and page-specific CSS.
- Custom `pushState` router in `fe/src/lib/router.ts` — no React Router.
- API calls go through the helpers in `fe/src/lib/api.ts`.
- Icons from `lucide-react`.

### Backend

- **Express 5** on Bun with TypeScript.
- **Prisma** for all database access — don't write raw SQL unless absolutely necessary.
- All new endpoints need auth middleware (the signed Quill token).
- Use the existing `log()` helper for structured logging.
- Agent tools are defined in `agent.ts` — follow the existing tool pattern when adding new ones.

### Database

- Schema changes go in `be/prisma/schema.prisma`.
- Always make new columns **nullable** or provide a default to avoid breaking existing data.
- Document migration steps in your PR description.
- Never run `prisma migrate` or `db push` against production without explicit approval.

## Commit Messages

Use clear, descriptive commit messages:

```
feat(fe): add currency toggle to pricing section
fix(be): guard sandbox access for conversation sessions
docs: update environment variables table in README
chore: update dependencies
```

**Format:** `type(scope): description`

| Type | Use for |
|------|---------|
| `feat` | New features |
| `fix` | Bug fixes |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code restructuring, no behavior change |
| `test` | Adding or updating tests |
| `chore` | Build, deps, config changes |

## Pull Requests

### What to Include

- **Motivation**: Why is this change needed?
- **Summary**: What does the PR do?
- **Screenshots**: For any UI changes.
- **Schema changes**: If Prisma schema was modified, list the migration steps.
- **Environment changes**: If new env vars are needed, update `.env.example` and the README table.
- **Testing**: Describe what you tested and the result.

### What NOT to Include

- `.env` files or any secrets/credentials
- `prisma/generated/` directory
- `dist/` build output
- `node_modules/`
- Unrelated formatting or refactoring changes

### Review Process

1. A maintainer will review your PR.
2. Address any requested changes by pushing new commits to the same branch.
3. Once approved, a maintainer will merge the PR.

## Reporting Issues

When opening an issue, include:

- **Description**: What happened vs. what you expected.
- **Steps to reproduce**: Numbered steps to trigger the issue.
- **Environment**: OS, browser, Bun version.
- **Screenshots or logs**: If applicable (redact any secrets or personal data).
- **Severity**: Is it a crash, data loss, UI glitch, or minor inconvenience?

## Security Vulnerabilities

**Do not open a public issue for security vulnerabilities.** Instead, email the maintainer directly or use GitHub's private vulnerability reporting. Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact

We will respond promptly and credit you in the fix (unless you prefer to remain anonymous).

---

Thank you for helping make Quill AI better! 🎉

