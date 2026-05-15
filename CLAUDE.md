# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules index

> **IMPORTANT: BEFORE writing any code or making changes, read the relevant rule files below.** Skipping this causes avoidable mistakes.

| File | Read when... |
|------|-------------|
| [rules/electron-ipc.md](rules/electron-ipc.md) | Adding/modifying IPC endpoints, handlers, React Query hooks, or renderer-to-main communication |
| [rules/dyad-errors.md](rules/dyad-errors.md) | Classifying IPC/main errors with `DyadError` / `DyadErrorKind` and PostHog exception filtering |
| [rules/local-agent-tools.md](rules/local-agent-tools.md) | Adding/modifying local agent tools, tool flags (`modifiesState`), or read-only/plan-only guards |
| [rules/e2e-testing.md](rules/e2e-testing.md) | Writing or debugging E2E tests (Playwright, Base UI radio clicks, Lexical editor, test fixtures) |
| [rules/git-workflow.md](rules/git-workflow.md) | Pushing branches, creating PRs, or dealing with fork/upstream remotes |
| [rules/base-ui-components.md](rules/base-ui-components.md) | Using TooltipTrigger, ToggleGroupItem, ContextMenu, Accordion, or other Base UI wrapper components |
| [rules/database-drizzle.md](rules/database-drizzle.md) | Modifying the database schema, generating migrations, or resolving migration conflicts |
| [rules/native-modules.md](rules/native-modules.md) | Adding Electron native modules or binaries that must survive Forge packaging/rebuild |
| [rules/typescript-strict-mode.md](rules/typescript-strict-mode.md) | Debugging type errors from `npm run ts` (tsgo) that pass normal tsc |
| [rules/openai-reasoning-models.md](rules/openai-reasoning-models.md) | Working with OpenAI reasoning model (o1/o3/o4-mini) conversation history |
| [rules/adding-settings.md](rules/adding-settings.md) | Adding a new user-facing setting or toggle to the Settings page |
| [rules/chat-message-indicators.md](rules/chat-message-indicators.md) | Using `<dyad-status>` tags in chat messages for system indicators |
| [rules/supabase-functions.md](rules/supabase-functions.md) | Deploying, bundling, or queueing Supabase Edge Functions |
| [rules/product-principles.md](rules/product-principles.md) | Planning new features to guide design trade-offs |
| [rules/jotai-testing.md](rules/jotai-testing.md) | Unit-testing Jotai atoms/hooks with `renderHook`, especially across unmount/remount |
| [rules/claude-github-workflows.md](rules/claude-github-workflows.md) | Editing `.github/workflows/*.yml` that invoke `anthropics/claude-code-action` |

## Commands

```sh
npm run dev          # Start in development mode
npm run ts           # Type-check (uses tsgo — never run npx tsc directly)
npm run lint         # Lint (oxlint)
npm run lint:fix     # Lint + auto-fix
npm run fmt          # Format (oxfmt)
npm run fmt:check    # Check formatting without modifying
npm run test         # Run all unit tests
npm run test:watch   # Watch mode
npm run db:generate  # Generate Drizzle SQL migrations (never write these by hand)
npm run build        # Build for E2E tests (must run before e2e)
npm run e2e          # Run E2E tests (requires npm run build first)
```

**Run a single unit test file:**
```sh
npx vitest run src/path/to/file.spec.ts
```

**Pre-commit (run before every commit):**
```sh
npm run fmt && npm run lint && npm run ts
```

Or use the `/lint` skill if available.

> **WARNING:** Never run `npx tsc` directly — always use `npm run ts` (tsgo). Also, `tsgo` requires Node.js ≥ 24 and is installed via `npm install`, not from the npm registry.

## Architecture overview

Meowphyr is an **Electron app** — a local, open-source AI app builder. It has:

- **Main process** (`src/main.ts`, `src/ipc/ipc_host.ts`): Electron backend, IPC handlers, file I/O, AI streaming
- **Renderer process** (`src/renderer.tsx`): React 19 SPA with TanStack Router + TanStack Query
- **Preload** (`src/preload.ts`): Secure bridge exposing whitelisted IPC channels to renderer
- **Pro features** (`src/pro/`): Fair-source code. Local agent (multi-step AI coding) lives here

### IPC architecture (contract-driven)

All renderer↔main communication goes through typed IPC contracts:

1. **Define** contracts in `src/ipc/types/<domain>.ts` using `defineContract()` / `defineEvent()` / `defineStream()`
2. **Export** the client via `createClient(contracts)` from the same file; re-export from `src/ipc/types/index.ts`
3. **Register** handlers in `src/ipc/handlers/<domain>_handlers.ts` using `createTypedHandler(contract, async (_event, params) => {...})`
4. **Call** `register*Handlers()` in `src/ipc/ipc_host.ts`
5. **Preload allowlist** is auto-derived from contracts — no manual channel registration needed

```ts
// Renderer usage
import { appClient, ipc } from "@/ipc/types";
const app = await appClient.getApp({ appId });
const settings = await ipc.settings.getUserSettings();
```

> **Handler signature:** `createTypedHandler` calls `handler(event, parsed.data)` — always use `async (_event, params) => {}` (two arguments, first is IpcMainInvokeEvent).

### Local Agent tools (`src/pro/main/ipc/handlers/local_agent/tools/`)

Each tool is a `ToolDefinition<T>` with:
- `name`, `description`, `inputSchema` (Zod), `defaultConsent` ("always" | "ask" | "never")
- `modifiesState?: boolean` — **required** for tools that write to disk/DB (filters them out in read-only/ask mode)
- `execute(args, ctx): Promise<string>` — returns text result to AI
- `buildXml(args, isComplete): string | undefined` — renders UI indicator in chat
- `getConsentPreview?(args): string`
- `isEnabled?(ctx): boolean` — optional; return `false` to filter the tool out for a given context (e.g. framework-specific tools)

All tools are registered in `TOOL_DEFINITIONS` in `tool_definitions.ts`. Add new tools there.

Use `ctx.onXmlComplete(xml)` to surface output in the chat UI. Use `ctx.onWarningMessage(msg)` for toast warnings.

**`AgentContext` key fields** (see `tools/types.ts` for the full interface):
- `runSubAgent?(prompt, description, options)` — spawns a sub-agent; `options.background` returns immediately and the agent reports back via `send_message`
- `swarm?: AgentSwarm` — in-session message bus shared across the leader and all sub-agents
- `agentName?: string` — this agent's registered swarm name (`undefined` for the leader)
- `referencedApps: Map<string, string>` — apps mentioned via `@app:Name`; read-only tools can target them via `app_name`

### Agent Swarm (`tools/agent_swarm.ts`)

An in-process multi-agent coordination system. One **leader** agent can spawn named **worker** agents that share a single `AgentSwarm` instance (in-memory mailboxes — no file I/O).

Key concepts:
- **`runSubAgent(prompt, desc, { name, background })`** on `AgentContext` — spawns a worker. Without `background`, blocks until the worker finishes. With `background: true`, returns immediately; the worker uses `send_message_tool` to report back.
- **`send_message_tool`** / **`read_messages_tool`** / **`wait_for_reply_tool`** — inter-agent messaging tools available to both leader and workers.
- **`monitor_agents_tool`** — lets the leader poll lifecycle state (`running` / `completed` / `failed`) of all workers.
- **`sleep_tool`** — used by agents that need to yield while waiting for async events.
- **Permission bridge** — sub-agent consent requests are routed to the leader's `requireConsent` handler (shown to the user via Electron UI).

### Codebase indexing (`local_agent/indexing/`)

The local agent maintains a vector-search index of each app's source files for semantic code retrieval.

- **`codebase_indexer.ts`** — entry point; scans files, hashes content to skip unchanged files, batches embedding calls, stores chunks via `vector_store`. Exports `indexCodebase(appId, appPath, onProgress?)` → `IndexProgress`.
- **`chunker.ts`** — splits source files into `Chunk[]` using `SKIP_DIRS` / `EXTENSIONS` allowlists. Both are exported and re-used by `file_watcher.ts`.
- **`vector_store.ts`** — SQLite-backed store (separate from the app DB) for file hashes and embedding chunks. Key exports: `upsertChunks`, `getFileHash`, `getIndexedFilePaths`, `deleteFile`.
- **`embeddings.ts`** — calls the configured embedding provider and returns float vectors.
- **`file_watcher.ts`** — wraps `fs.watch` with a 2 s debounce; calls `reindex` on relevant file changes. Lifecycle: `startWatching(appId, appPath, reindexFn)` / `stopWatching(appId)` / `stopAllWatchers()`.

### Shell session (`tools/shell_session.ts`, `tools/bash_tool.ts`)

`bash_tool` executes shell commands with a **persistent cwd** across calls within a single agent turn. The cwd is stored in `shell_session.ts` (`getSessionCwd` / `setSessionCwd`) using a per-session temp file, so `cd` in one `bash_tool` call carries over to subsequent calls. On Windows it resolves Git Bash / MSYS2 bash automatically.

### React Query keys

All keys defined in `src/lib/queryKeys.ts` using a centralized factory. Follow the existing pattern: `queryKeys.X.all()` (function) for the base invalidation key, factory functions for parameterized keys (e.g. `queryKeys.skills.list(appId)`). Use `queryClient.invalidateQueries({ queryKey: queryKeys.X.all() })` to invalidate an entire domain.

### Database

SQLite + Drizzle ORM. Schema in `src/db/schema.ts`. **Always generate migrations with `npm run db:generate`**, never write SQL migration files by hand.

### State management

- **TanStack Query** for server/IPC-backed async state
- **Jotai atoms** for global UI state (`src/atoms/`)
- **TanStack Router** for navigation (`src/router.ts`, `src/routes/`)

### Skills system

Skills are reusable instruction templates stored in two scopes:

- **Global skills** — `<userData>/skills/<slug>/SKILL.md` (file-based) or DB prompts with a slug. Managed via Library UI.
- **Project skills** — `<appPath>/.meowphyr/skills/<slug>/SKILL.md`. Scoped to a specific app; only visible when that app is active.

File-based global skills override DB skills with the same slug. Project skills never override globals (distinct `project:<appName>:<slug>` key).

Skill loading is app-scoped: `ipc.skill.list({ appId })` returns global + project skills for that app only. Passing no `appId` returns globals only — this is intentional so the Home page doesn't show project skills.

- **Level 1** — `/slug` in chat expands to skill content before AI receives the message (`replaceSlashSkillReference`)
- **Level 2** — Library UI to create/edit/delete global skills
- **Level 3** — AI sees skill metadata in system prompt and calls the `use_skill` tool to load full content on demand
- **`/create-skill`** — builtin slash command; AI drafts and saves a new skill under `.meowphyr/skills/<slug>/SKILL.md` via the `save_skill` inline tool

SKILL.md frontmatter fields: `name` (display title), `description`, `argument-hint`, `disable-model-invocation`, `user-invocable`. **Directory name = slug** (not frontmatter `name`).

`serializeSkillMd` / `parseSkillMd` in `src/lib/skillParser.ts` handle reading/writing the frontmatter format.

### Fork-specific changes

This is `focusthitipan/meowphyr`, a personal fork of `dyad-sh/dyad`. Key customizations:
- Dyad Pro feature checks centralized via `isDyadProEnabled`; Pro bypass re-enabled for local use
- Default model: `gemini-2.5-flash-preview`
- Removed cloud-dependent UI (onboarding banner, Pro trial card, `auto` provider)
- Windows path normalization fixes

## Key conventions

- **Always use Base UI (`@base-ui/react`)** for UI primitives — never Radix UI. See `rules/base-ui-components.md`.
- **Throw `DyadError`** (not plain `Error`) from IPC handlers for expected non-bug failures (validation, not found, auth, etc.) to suppress PostHog noise.
- **No `remote` module** — Electron security practice. Validate and lock mutations by `appId`.
- **Settings writes:** `writeSettings(partial)` does a shallow top-level merge. Always spread the parent object to avoid silently dropping sibling fields. Call `readSettings()` immediately before `writeSettings()` — never across an `await` boundary.
- **`<dyad-status>` tags** render as collapsible status indicators in chat. Valid states: `finished`, `in-progress`, `aborted`, `pending`.
- **Builtin slash commands** (`/new`, `/compact`, `/init`, `/create-skill`) are intercepted in `ChatInput.tsx` before reaching the AI. Add new builtins there AND in `BUILTIN_SLASH_COMMANDS` in `LexicalChatInput.tsx`. Commands that need AI processing pass a dedicated flag (e.g. `triggerCreateSkill`) in `ChatStreamParams`; the handler must be placed **before** `isAskMode` / `isLocalAgentBackedMode` checks in `chat_stream_handlers.ts` to run regardless of chat mode.
- **`<dyad-skill name="slug"/>` in user messages** renders as an inline amber badge (via `parseUserMessageParts` in `ChatMessage.tsx`). Use `displayUserPrompt` in the stream handler to set the display version while keeping the full command in `req.prompt`.

## Testing

- **Unit tests:** Use for pure business logic. Run with `npx vitest run path/to/file.spec.ts`.
- **E2E tests:** Run against the built app — **always `npm run build` first** if app code changed. See `rules/e2e-testing.md`.
- When adding a field to `DEFAULT_SETTINGS`, regenerate inline snapshots with `npm test -- -u`.
- When adding `AgentContext` fields, update all mock context literals in `tools/*.spec.ts`.

## Git workflow

- Push to `origin` (fork `focusthitipan/meowphyr`) for new branches; create PRs from fork to upstream (`dyad-sh/dyad`).
- Add `#skip-bugbot` to PR description for trivial changes (CI config, docs, agent config).
- Run `npm run init-precommit` once after `npm install` to activate pre-commit hooks.
