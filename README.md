# Meowphyr

**Meowphyr** is a free, local, open-source AI app builder — a personal fork of [dyad-sh/dyad](https://github.com/dyad-sh/dyad) with Thai locale support, Windows path fixes, and customizations for local use.

Built with Electron, React 19, and the Vercel AI SDK. It runs entirely on your machine; no cloud account required.

---

## Features

- **AI-powered app generation** — describe what you want, get a working app
- **Multi-provider support** — OpenAI, Anthropic Claude, Google Gemini, xAI Grok, Amazon Bedrock, Azure OpenAI, and local (OpenAI-compatible) endpoints
- **Local agent** — multi-step coding agent with tool use (bash, file read/write, semantic codebase search)
- **Agent swarm** — spawn named sub-agents that coordinate via in-process message passing
- **Skills system** — reusable prompt templates scoped globally or per-project
- **MCP support** — connect external tools via the Model Context Protocol
- **Built-in preview** — live app preview with hot reload
- **Supabase & Vercel integration** — deploy and manage databases from within the app
- **Thai UI locale** — full Thai language support

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

Open **Settings → Providers** and add an API key for at least one provider (e.g. Google Gemini, OpenAI, or Anthropic). The default model is `gemini-2.5-flash-preview`.

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

## License

MIT — see [LICENSE](LICENSE) for details.

Portions under fair-source license — see `src/pro/` directory.
