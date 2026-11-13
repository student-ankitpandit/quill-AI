# Project: Quill AI
Quill is an AI-powered coding agent platform. The Users choose a GitHub repository they want agent to work in, describe a task, and Quill works in an isolated E2B workspace will fix it, review it, commit the changes and then opens a PR.

The repository root is `D:\wsp\projects\quill`. Use paths relative to this root in documentation and commands.

## Tech Stack
- **Runtime & Backend:** Node.js / Bun, TypeScript, Express.js
- **Database & Caching:** PostgreSQL (Prisma ORM), Redis
- **Integrations:** GitHub App / OAuth, Razorpay Subscriptions API, LLM Agent SDKs
- **Deployment:** Render Web Service (`main` branch auto-deploy)

## Commands
Run backend commands from `be\` and frontend commands from `fe\`.

### Backend (`be\`)
- **Install dependencies:** `cd be; bun install`
- **Generate Prisma Client:** `bun run db:generate`
- **Push development schema:** `bun run db:push`
- **Development server:** `bun run dev`
- **Build:** `bun run build`
- **Start production:** `bun run start`
- **Prisma Studio:** `bun run db:studio`

### Frontend (`fe\`)
- **Install dependencies:** `cd fe; bun install`
- **Development server:** `bun run dev`
- **Build:** `bun run build`
- **Watch CSS:** `bun run dev:css`

## Architecture & Key Directories
- `be/index.ts` — Express API routes and server startup
- `be/agent.ts` — Agent execution loop, intent classification, and repository work
- `be/lib.ts` — GitHub and E2B helpers
- `be/billing.ts` — Subscription plans, usage limits, and payment handling
- `be/routes/` — Session-specific API routes
- `be/prisma/schema.prisma` — PostgreSQL data model
- `fe/src/` — React frontend entry point, pages, components, and styles
- `e2b-template/Dockerfile` — Base image for E2B coding workspaces

## Code Style & Conventions
- **TypeScript:** Prefer strict typing and named exports over default exports.
- **Bundler Safety:** Never reference Node-only globals (like `process.env`) directly inside frontend browser-bundled modules; validate and inject API base URLs safely so local URLs never leak into production.
- **Error Handling & Timeouts:** Always wrap external GitHub API calls, LLM agent loops, and PR review pipelines with explicit timeout handling and structured user-facing error messages.
- **Environment Variables:** Keep `.env.example` clean and strictly aligned with required production environment variables on Render.

## Documentation References
@README.md