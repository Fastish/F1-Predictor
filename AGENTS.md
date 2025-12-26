# Repository Guidelines

## Project Structure & Module Organization
- `client/` houses the Vite/React frontend. Key entry points are `client/src/main.tsx`, `client/src/App.tsx`, and feature code lives under `client/src/components`, `client/src/pages`, and `client/src/hooks`.
- `server/` contains the Express API and runtime services (routing, data access, and integrations). The server starts from `server/index.ts`.
- `shared/` holds cross-cutting TypeScript code shared between client and server.
- `script/` contains build tooling (see `script/build.ts`).
- Root config files include `vite.config.ts`, `tailwind.config.ts`, `drizzle.config.ts`, and `tsconfig.json`.

## Build, Test, and Development Commands
- `npm run dev`: run the server in development mode with Vite middleware for the client.
- `npm run build`: build the client with Vite and bundle the server into `dist/index.cjs`.
- `npm run start`: run the production server from `dist/index.cjs` (run `npm run build` first).
- `npm run check`: run TypeScript type-checking.
- `npm run db:push`: apply Drizzle schema changes to the database.

## Coding Style & Naming Conventions
- TypeScript-first codebase with strict type checking (`tsconfig.json`).
- Use 2-space indentation and double quotes, matching existing files in `server/` and `client/`.
- React components use PascalCase (`DriverCard.tsx`), hooks use `use*` naming (`usePools.ts`).
- Prefer path aliases: `@/` for `client/src` and `@shared/` for `shared/`.

## Testing Guidelines
- No dedicated test framework is configured yet. If adding tests, use `*.test.ts` or `*.test.tsx` alongside the code they cover.
- Keep tests fast and deterministic; update `npm run check` or add scripts when introducing a test runner.

## Commit & Pull Request Guidelines
- Commit messages in history are short, imperative, and sentence-cased (e.g., "Improve error reporting for failed order requests"). Follow that pattern.
- PRs should include a clear summary, any linked issues, and screenshots/GIFs for UI changes. Call out any config or environment changes explicitly.

## Configuration & Secrets
- Runtime configuration is read from environment variables. Use a local `.env` file for secrets; it is gitignored.
- Avoid committing credentials or API keys in code or fixtures.
