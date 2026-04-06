# Briefly — Technical Specification

**Tagline:** A Multi-Protocol Nano Agent powered by Gemma 4. The Edge-native intelligence layer for creative agencies.

---

## 1. Concept: Nano Agent

Briefly is a **nano agent** — a single-purpose, composable AI agent with a narrow, well-defined scope. Unlike general-purpose assistants, nano agents are:

- **Edge-native**: Deployed entirely on Cloudflare Workers + Durable Objects. No servers to manage, globally distributed.
- **Stateful at the edge**: Durable Objects provide embedded SQLite (via agents SDK). State lives where requests land.
- **Protocol-first**: Exposes its capabilities via MCP (Model Context Protocol) and A2A (Agent-to-Agent), making it composable into larger agentic pipelines.
- **Single domain**: Briefly's scope is AI industry intelligence for creative agencies. It does one thing well.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Cloudflare Worker                       │
│                    (Hono router)                         │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ /mcp     │  │ /a2a/*   │  │ /api/*   │  │ /agents│ │
│  │ MCP HTTP │  │ A2A tasks│  │ REST API │  │ WS/SSE │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘ │
└───────┼─────────────┼─────────────┼─────────────┼──────┘
        │             │             │             │
        ▼             ▼             ▼             ▼
┌───────────────────────────────────────────────────────┐
│              Durable Objects (SQLite)                  │
│                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ BrieflyAgent │  │ ScraperAgent │  │CrawlerAgent │ │
│  │ (chat, brief)│  │ (SQLite store│  │(headless    │ │
│  │              │  │  6h cron)    │  │ Chromium)   │ │
│  └──────────────┘  └──────┬───────┘  └─────────────┘ │
└─────────────────────────┼─────────────────────────────┘
                           │ scrapes
              ┌────────────┼────────────────┐
              ▼            ▼                ▼
         The Rundown    Futurepedia     Arena.ai
         The Neuron     Product Hunt    (JS SPA via
         (RSS feeds)    (RSS feed)       Chromium)
```

---

## 3. Protocols

### 3.1 MCP (Model Context Protocol)

- **Transport**: Streamable HTTP (`POST /mcp`)
- **Pattern**: Stateless — fresh `McpServer` instance per request via `createMcpHandler`
- **Tools**:
  1. `search_ai_tools` — Query AI tools by keyword/category
  2. `get_industry_news` — Latest AI headlines from The Rundown + The Neuron
  3. `get_model_leaderboard` — Arena.ai model performance rankings
  4. `generate_brief` — Structured innovation brief from raw scraped data (no LLM call — raw data only)
- **Discovery**: `GET /mcp` returns tool list

### 3.2 A2A (Agent-to-Agent)

- **Agent Card**: `GET /.well-known/agent-card.json`
- **Task lifecycle**: `POST /a2a/tasks` → poll `GET /a2a/tasks/:id` → `GET /a2a/tasks/:id/artifacts`
- **Storage**: Cloudflare KV (`A2A_TASKS`) with 24h TTL
- **Skills**:
  - `model_leaderboard` — Returns current AI model rankings
  - `industry_news` — Returns latest AI news items
  - `search_tools` — Searches AI tools by query

---

## 4. Data Pipeline

### 4.1 Sources

| Source | Type | Scraper | Refresh |
|--------|------|---------|---------|
| The Rundown AI | RSS | `rss.ts` | 6h cron |
| The Neuron Daily | RSS | `rss.ts` | 6h cron |
| Futurepedia | JS SPA | `futurepedia.ts` + CrawlerAgent | 6h cron |
| Product Hunt | RSS | `producthunt.ts` | 6h cron |
| Arena.ai Leaderboard | JS SPA | `arena.ts` + CrawlerAgent | 6h cron |

### 4.2 CrawlerAgent

- Maintains a headless Chromium singleton via `@cloudflare/puppeteer`
- `renderPage(url, waitFor?, timeout?)` — Renders full page HTML after JS execution
- `evaluatePage(url, expression, waitFor?, timeout?)` — Runs custom JS in page context
- Falls back gracefully: CrawlerAgent → plain fetch → empty

### 4.3 Storage

- `ScraperAgent` embeds SQLite via agents SDK
- Schema: `items(id, source, sourceUrl, title, summary, url, category, tags, publishedAt, scrapedAt)`
- Deduplication: `INSERT OR REPLACE` on deterministic `id = hash(source + url)`
- `BrieflyAgent` embeds SQLite for conversation history

---

## 5. Cloudflare Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `AI` | Workers AI | Gemma 4 (`@cf/google/gemma-4-26b-a4b-it`) |
| `BROWSER` | Browser Rendering API | Headless Chromium for CrawlerAgent |
| `BRIEFLY_AGENT` | Durable Object | Conversational AI + brief generation |
| `SCRAPER_AGENT` | Durable Object | Background scraper + SQLite |
| `CRAWLER_AGENT` | Durable Object | Headless browser rendering |
| `A2A_TASKS` | KV Namespace | A2A task lifecycle storage |
| `ASSETS` | Fetcher | React SPA static files |

---

## 6. MCP Tool Design Principles

- **No LLM calls inside tools**: Tools return raw scraped data, structured as JSON. The calling LLM synthesises.
- **Fuzzy input normalisation**: `normaliseCategory()` and `normaliseSource()` map free-form strings to valid values, avoiding validation errors when LLMs pass unexpected inputs.
- **Stateless**: Each MCP request creates a fresh server instance — no WebSocket state to manage.

---

## 7. DO Migration History

| Tag | Change |
|-----|--------|
| v1 | Created `BrieflyAgent`, `ScraperAgent`, `BrieflyMcpAgent` |
| v2 | Deleted `BrieflyMcpAgent` (replaced by stateless createMcpHandler) |
| v3 | Created `CrawlerAgent` (headless browser for JS SPA scraping) |
