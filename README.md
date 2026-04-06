# Briefly: A Multi-Protocol Nano Agent powered by Gemma 4.
### The Edge-native intelligence layer for creative agencies.

> Briefly monitors the AI industry in real-time and makes that intelligence available to humans via chat, to AI assistants via MCP, and to other agents via A2A.

---

## What is a Nano Agent?

A **nano agent** is an AI agent with a deliberately narrow scope and zero infrastructure overhead. Unlike monolithic AI platforms, a nano agent:

- **Does one job** — Briefly surfaces AI industry intelligence for creative agencies. It doesn't try to be a general assistant, a code editor, or a research tool.
- **Runs at the edge** — No servers, no databases to manage. Briefly lives entirely on Cloudflare Workers and Durable Objects, globally distributed with sub-millisecond cold starts.
- **Is composable** — Briefly speaks MCP (Model Context Protocol) and A2A (Agent-to-Agent) natively. Any other AI agent or LLM tool can call it as a sub-agent, delegating the "what's new in AI" question to the one agent built for it.
- **Stays lean** — The entire backend is ~600 lines of TypeScript. No heavy frameworks, no ORMs. Complexity is the enemy of reliability.

The nano agent philosophy: *build the smallest thing that's genuinely useful, make it fast, and make it interoperable.*

---

## What Briefly Does

Briefly monitors five live intelligence sources on a rolling 6-hour schedule:

| Source | Content |
|--------|---------|
| **The Rundown AI** | Daily AI newsletter digest |
| **The Neuron Daily** | Startup and product AI news |
| **Futurepedia** | Curated AI tools directory |
| **Product Hunt** | Newly launched AI products |
| **Arena.ai Leaderboard** | Live model performance rankings |

That intelligence is surfaced through three interfaces:

1. **Chat UI** — Ask questions like *"what's the best AI video tool for a campaign brief?"* and get sourced, grounded answers from Gemma 4.
2. **MCP endpoint** — Claude Desktop, Cursor, or any MCP-compatible client can add Briefly as a tool server and call its 4 tools directly.
3. **A2A endpoint** — Other agents can delegate tasks to Briefly via the Agent-to-Agent protocol, polling for results or streaming via SSE.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Cloudflare Worker                      │
│                                                         │
│   Hono Router                                           │
│   ├── /            → React SPA (Workers Assets)         │
│   ├── /mcp         → MCP Streamable HTTP (stateless)    │
│   ├── /a2a/*       → A2A task protocol                  │
│   ├── /api/*       → REST feed / search API             │
│   └── /agents/*    → Agent WebSocket routing            │
│                                                         │
│   Durable Objects                                       │
│   ├── BrieflyAgent   → Conversational AI + briefs       │
│   └── ScraperAgent   → Source scraping + SQLite store   │
│                                                         │
│   Cloudflare Workers AI  (Gemma 4)                      │
│   Cloudflare KV          (A2A task state, 24h TTL)      │
└─────────────────────────────────────────────────────────┘
```

```
briefly/
├── src/
│   ├── server.ts            # Hono router — all routes
│   ├── types.ts             # Shared TypeScript interfaces
│   ├── agents/
│   │   ├── BrieflyAgent.ts  # Conversational agent with Gemma 4
│   │   └── ScraperAgent.ts  # Background scraper (6h schedule)
│   ├── mcp/
│   │   └── server.ts        # Stateless MCP server factory
│   ├── a2a/
│   │   ├── agentCard.ts     # Agent Card (/.well-known/agent-card.json)
│   │   ├── taskManager.ts   # Task lifecycle backed by KV
│   │   └── handler.ts       # A2A HTTP routes
│   ├── scrapers/            # One scraper per source
│   └── utils/               # agentFetch helper, HTML parsing
└── src/components/          # React UI (dark glassmorphism)
```

### Key Design Decisions

**Stateless MCP** — Instead of a Durable Object per MCP session, Briefly creates a fresh `McpServer` per request. This avoids DO hibernation edge cases and correctly exposes all tools on the first `tools/list` call without any warmup.

**ScraperAgent as the single source of truth** — All four MCP tools, all A2A skills, and the chat agent read from the same `ScraperAgent` Durable Object. One scrape cycle populates everything.

**Gemma 4 for inference** — `@cf/google/gemma-4-26b-a4b-it` runs natively on Cloudflare's GPU fleet. No API keys, no per-token billing beyond Workers AI usage.

---

## MCP Integration

Connect any MCP-compatible client to:

```
https://briefly.info-693.workers.dev/mcp
```

**Available tools:**

| Tool | Description |
|------|-------------|
| `search_ai_tools` | Find AI tools matching a project description or use case |
| `get_industry_news` | Latest AI headlines from The Rundown AI and The Neuron Daily |
| `get_model_leaderboard` | Current Arena.ai model performance rankings |
| `generate_brief` | Full innovation brief as structured JSON (powered by Gemma 4) |

**Example: Add to Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "briefly": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/client-cli",
        "https://briefly.info-693.workers.dev/mcp"
      ]
    }
  }
}
```

---

## A2A Integration

Briefly implements the [Agent-to-Agent (A2A) protocol](https://google.github.io/A2A/).

**Agent card** (auto-discovery):
```
GET https://briefly.info-693.workers.dev/.well-known/agent-card.json
```

**Task endpoints:**
```
POST   /a2a/tasks              Create task (202 Accepted or SSE stream)
GET    /a2a/tasks/:id          Poll task status
GET    /a2a/tasks/:id/stream   SSE stream for real-time updates
DELETE /a2a/tasks/:id          Cancel task
```

**Skills:**

| Skill | Input |
|-------|-------|
| `search_tools` | `{ query?, category?, limit? }` |
| `industry_summary` | `{ source?, limit? }` |
| `model_leaderboard` | `{ limit? }` |
| `generate_brief` | `{ topic }` |

**Example:**
```bash
curl -X POST https://briefly.info-693.workers.dev/a2a/tasks \
  -H "Content-Type: application/json" \
  -d '{"message": {"skill": "model_leaderboard", "input": {"limit": 5}}}'
```

---

## Setup & Deploy

### Prerequisites
- Node.js 18+
- Wrangler CLI authenticated with your Cloudflare account

### 1. Install dependencies
```bash
npm install
```

### 2. Create the KV namespace for A2A tasks
```bash
wrangler kv namespace create A2A_TASKS
```
Copy the output `id` and replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml`.

### 3. Local development
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173).

> **Note:** On first run, `ScraperAgent` will begin fetching from all 5 sources. The feed may be empty for the first minute.

### 4. Deploy to Cloudflare
```bash
npm run build
cd dist/briefly && npx wrangler deploy --config wrangler.json
```

The GitHub Actions workflow (`.github/workflows/deploy.yml`) handles KV namespace creation and deployment automatically on push to `main`.

---

## Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `AI` | Workers AI | Gemma 4 inference |
| `BRIEFLY_AGENT` | Durable Object | Conversational agent |
| `SCRAPER_AGENT` | Durable Object | Background scraper + SQLite |
| `A2A_TASKS` | KV Namespace | A2A task storage (24h TTL) |
| `ASSETS` | Static Assets | React SPA |

---

## Security

- No API keys in code — all bindings use Cloudflare's secure binding system
- User inputs sanitized and length-capped (500 chars max for queries)
- Prompt injection protection — user input is separated from system prompt at all times
- A2A webhooks — only HTTPS URLs accepted; Bearer tokens supported
- MCP tool inputs validated with Zod schemas before execution
- CORS open only on interoperability endpoints (`/mcp`, `/a2a/*`, `/.well-known/*`)

---

## Stack

- **Runtime**: Cloudflare Workers + Durable Objects (SQLite)
- **Routing**: Hono
- **UI**: React + Vite
- **AI**: Cloudflare Workers AI — Gemma 4 (`@cf/google/gemma-4-26b-a4b-it`)
- **Agent SDK**: `agents` v0.9.0 (Cloudflare)
- **MCP**: `@modelcontextprotocol/sdk` v1.29.0
- **A2A**: Custom implementation following the Agent-to-Agent spec
- **Build**: Vite + `@cloudflare/vite-plugin`

---

MIT License · Built by Eduardo Arana
