# SyncFlow Kanban

A real-time collaborative workspace for teams to plan tasks, manage sprints, and track delivery across shared Kanban boards.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (managed workflow)
- `pnpm --filter @workspace/syncflow-kanban run dev` — run the web app (managed workflow)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/syncflow-kanban/` — React/Vite web app and shared UI.
- `artifacts/api-server/` — Express REST API and Socket.IO server.
- `lib/api-spec/openapi.yaml` — source of truth for API request and response contracts.
- `lib/api-client-react/` and `lib/api-zod/` — generated client hooks and runtime validators.
- `lib/db/src/schema/` — PostgreSQL tables and Drizzle schema.

## Architecture decisions

- PostgreSQL with Drizzle is the chosen store for this app; the user selected the workspace database instead of a separate MongoDB service.
- Sessions are signed JWTs in an HttpOnly, SameSite=Lax cookie; passwords use bcrypt hashing.
- Socket.IO runs on `/api/socket.io` and only joins board rooms after checking membership.
- Every new account receives a starter board and sample sprint tasks so the first board view is useful.

## Product

Users can register and sign in, create and share boards, manage tasks and comments, move work between five workflow columns, filter by assignee/priority/sprint, plan sprints, and view board activity and delivery analytics. Board changes refresh live for connected members.

## User preferences

- Use the included PostgreSQL database rather than an external MongoDB connection.

## Gotchas

- After OpenAPI codegen, keep `lib/api-zod/src/index.ts` exporting `generated/api` only. Wildcard-exporting `generated/types` collides with generated Zod parameter schemas (`ListTasksParams` and `ListBoardActivityParams`).
- If the API schema changes, run codegen, then `pnpm run typecheck:libs` before checking app packages.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
