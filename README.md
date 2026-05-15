# Meowphyr

**Meowphyr** is a free, local, open-source AI app builder — a personal fork of [dyad-sh/dyad](https://github.com/dyad-sh/dyad) with Thai locale support, Windows path fixes, and customizations for local use.

Built with Electron, React 19, and the Vercel AI SDK. It runs entirely on your machine; no cloud account required.

---

## What's different from Dyad

| Area | Change |
|---|---|
| **Branding** | Renamed to Meowphyr; blue UI accent colors |
| **Skills** | `/create-skill` slash command; app-scoped project skills; SkillsPanel UI |
| **Token tracking** | Real API token tracking with streaming display; manual compaction |
| **Slash commands** | `/compact`, `/new`, `/init`, `/create-skill` built-in commands |
| **Agent swarm** | Local multi-agent coordination tools (send/read/wait for messages) |
| **Thai locale** | Full Thai UI language support |
| **Theme** | Project-based theme generation |
| **Provider UI** | Provider/model picker; image-gen settings; Pro-gated UI removed |
| **Pro bypass** | All local Pro features enabled without a subscription |
| **Windows** | Normalized path handling; symlink edge-case fixes; stable Windows tests |
| **Default model** | `gemini-2.5-flash-preview` (Google) |

---

## Features

### Core
- **AI-powered app generation** — describe what you want, get a working app
- **Multi-provider support** — OpenAI, Anthropic Claude, Google Gemini, xAI Grok, Amazon Bedrock, Azure OpenAI, MiniMax, and local (OpenAI-compatible) endpoints
- **Built-in preview** — live app preview with hot reload
- **Version history** — searchable version panel with visual diff

### Local Agent
- **Multi-step coding agent** — tool use: bash, file read/write, semantic codebase search
- **Agent swarm** — spawn named sub-agents that coordinate via in-process message passing
- **File watcher** — auto-reindex changed files for up-to-date semantic search
- **Cross-app references** — reference other apps with `@app:Name`

### Skills
- **Global & project-scoped skills** — reusable prompt templates
- **`/create-skill`** — AI drafts and saves a new skill from chat
- **Slash command expansion** — `/slug` in chat expands skill content inline

### Productivity
- **Realtime token streaming** — live token count and cost tracking
- **Manual context compaction** — `/compact` to summarize and free context
- **Queued messages** — send follow-up messages while agent is running
- **Voice input** — transcription-based voice input
- **Image generation** — generate and swap images from chat
- **Web fetch tool** — agent can crawl URLs for context
- **Media library** — browse and reuse generated images

### Integrations
- **Supabase** — deploy edge functions, run SQL, manage projects
- **Neon** — Postgres database integration
- **Vercel** — deploy and manage apps
- **MCP support** — connect external tools via the Model Context Protocol
- **React DevTools** — built-in in development mode

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) **≥ 24**
- npm (comes with Node.js)

### Install & run

```sh
git clone https://github.com/focusthitipan/meowphyr.git
cd meowphyr
npm install
npm run dev
```

### AI provider setup

Open **Settings → Providers** and add an API key for at least one provider (e.g. Google Gemini, OpenAI, or Anthropic).

---

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start in development mode |
| `npm run build` | Build for E2E tests |
| `npm run test` | Run unit tests |
| `npm run e2e` | Run E2E tests (requires `npm run build` first) |
| `npm run ts` | Type-check with tsgo |
| `npm run lint` | Lint with oxlint |
| `npm run fmt` | Format with oxfmt |
| `npm run db:generate` | Generate Drizzle SQL migrations |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 40 |
| UI | React 19, TailwindCSS 4, Base UI |
| Routing | TanStack Router |
| Data fetching | TanStack Query |
| State | Jotai |
| AI SDK | Vercel AI SDK |
| Database | SQLite + Drizzle ORM |
| Testing | Vitest, Playwright |

---

## Project Structure

```
src/
  main.ts              # Electron main process
  renderer.tsx         # React SPA entry point
  ipc/                 # Typed IPC contracts and handlers
  pro/                 # Local agent, swarm, skills (fair-source)
  db/                  # Drizzle schema and migrations
  atoms/               # Jotai global state
  routes/              # TanStack Router pages
```

---

## Releases

[https://github.com/focusthitipan/meowphyr/releases](https://github.com/focusthitipan/meowphyr/releases)

---

## License

- Code outside `src/pro/` — Apache 2.0, see [LICENSE](LICENSE)
- Code inside `src/pro/` — [Functional Source License 1.1 Apache 2.0](https://fsl.software/), see [src/pro/LICENSE](src/pro/LICENSE)
