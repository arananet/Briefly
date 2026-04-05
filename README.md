# Briefly — Innovation Intelligence

> AI-powered innovation director for creative agencies. Scrapes the AI industry's most important sources, synthesizes insights with Gemma 4, and delivers tool recommendations, industry summaries, and PDF briefs — all on Cloudflare's edge infrastructure.

---

## What It Does

**Briefly** acts as your agency's Innovation Director:

1. **Recommends AI tools** that match your specific project — with source citations and match reasoning
2. **Summarizes industry changes** from The Rundown AI, The Neuron Daily, Futurepedia, Product Hunt, and Arena.ai
3. **Generates downloadable PDF briefs** with executive summaries, tool recommendations, and model leaderboard snapshots
4. **Exposes an MCP server** so Claude Desktop and other MCP clients can access Briefly's intelligence
5. **Implements A2A protocol** for agent-to-agent interoperability

---

## Architecture

```
briefly/
├── src/
│   ├── server.ts          # Hono router — all routes
│   ├── types.ts           # Shared TypeScript interfaces
│   ├── agents/
│   │   ├── BrieflyAgent.ts    # AIChatAgent with Gemma 4 + 4 tools
│   │   └── ScraperAgent.ts    # Background scraper (6h schedule)
│   ├── mcp/
│   │   └── server.ts          # MCP server (Streamable HTTP + SSE)
│   ├── a2a/
│   │   ├── agentCard.ts       # A2A Agent Card (/.well-known/agent-card.json)
│   │   ├── taskManager.ts     # Task lifecycle backed by KV
│   │   └── handler.ts         # A2A HTTP routes
│   ├── scrapers/              # One file per source
│   ├── utils/                 # User agent rotation, HTML parsing
│   └── components/            # React UI (glassmorphism dark theme)
├── public/                    # Static assets + index.html
├── wrangler.toml
└── package.json
```

**Key Technologies:**
- **Cloudflare Workers** — globally distributed edge runtime
- **Cloudflare Agents SDK** — `AIChatAgent`, `Agent`, `McpAgent` backed by Durable Objects
- **Workers AI — Gemma 4** (`@cf/google/gemma-4-26b-a4b-it`) — 26B MoE model for inference
- **Cloudflare KV** — A2A task storage
- **HTMLRewriter** — Native Workers streaming HTML parser for scraping
- **Hono** — Lightweight HTTP router
- **React** — Frontend UI

---

## Data Sources

| Source | Type | Method |
|--------|------|--------|
| [The Rundown AI](https://www.therundown.ai) | Newsletter | RSS feed |
| [The Neuron Daily](https://theneurondaily.com) | Newsletter | RSS feed |
| [Futurepedia](https://futurepedia.io) | Tools directory | HTMLRewriter + sitemap |
| [Product Hunt](https://producthunt.com) | Product listings | GraphQL API |
| [Arena.ai Leaderboard](https://arena.ai/leaderboard/text) | Model rankings | HTMLRewriter |

Data is refreshed every 6 hours via a scheduled `ScraperAgent`. Browser headers are simulated (UA rotation + full `Sec-Fetch-*` header set) to reduce WAF blocking.

---

## Protocols

### MCP Server (Model Context Protocol)
Connect any MCP-compatible client (Claude Desktop, Cursor, etc.) to Briefly's intelligence:

```
Streamable HTTP: https://briefly.workers.dev/mcp
Legacy SSE:      https://briefly.workers.dev/sse
```

**Exposed tools:**
- `search_ai_tools` — find tools matching a project description
- `get_industry_news` — latest newsletter headlines
- `get_model_leaderboard` — Arena.ai model rankings
- `generate_brief` — structured JSON brief via Gemma 4

### A2A Protocol (Agent-to-Agent)
Auto-discover Briefly's capabilities:

```
GET /.well-known/agent-card.json
```

**Task endpoints:**
```
POST   /a2a/tasks              Create task (202 Accepted or SSE stream)
GET    /a2a/tasks/:id          Poll task status
GET    /a2a/tasks/:id/stream   SSE stream for real-time updates
DELETE /a2a/tasks/:id          Cancel task
```

**Skills:** `search_tools` · `industry_summary` · `generate_brief` · `model_leaderboard`

---

## Setup & Deploy

### Prerequisites
- [Node.js](https://nodejs.org) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) authenticated with your Cloudflare account

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
npm run deploy
```

Your app will be live at `https://briefly.workers.dev` (or your custom domain).

---

## Environment & Bindings

All bindings are declared in `wrangler.toml` — no `.env` file required.

| Binding | Type | Purpose |
|---------|------|---------|
| `AI` | Workers AI | Gemma 4 inference |
| `BROWSER` | Browser Rendering | Fallback for JS-heavy pages |
| `BRIEFLY_AGENT` | Durable Object | Chat agent (AIChatAgent) |
| `SCRAPER_AGENT` | Durable Object | Background scraper |
| `MCP_AGENT` | Durable Object | MCP server (McpAgent) |
| `A2A_TASKS` | KV Namespace | A2A task storage (24h TTL) |
| `ASSETS` | Static Assets | React SPA |

---

## API Reference

### REST

```
GET  /api/feed?category=&source=&limit=   Latest scraped items
POST /api/search                          { query, category, source, limit }
POST /api/scrape                          Trigger manual scrape refresh
```

### Agent WebSocket (BrieflyAgent)

```
WS   /agents/briefly/:id
POST /agents/briefly/:id   { messages: [{role, content}] }
```

Streams AI responses via Server-Sent Events. Powered by Gemma 4.

---

## Security

- **No secrets in code** — all bindings use Cloudflare's secure binding system
- **Input validation** — all user inputs sanitized and length-capped (500 chars for queries)
- **Prompt injection protection** — user input is separated from system prompt
- **A2A webhooks** — only HTTPS webhook URLs accepted; Bearer tokens supported
- **MCP tool inputs** — validated with Zod schemas before execution
- **CORS** — open only on interoperability endpoints (`/mcp`, `/a2a/*`, `/.well-known/*`)

---

## License

MIT

---

**Developer:** Eduardo Arana
