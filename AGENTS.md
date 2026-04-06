# AGENTS.md — Briefly Agent Architecture

This file documents the agents in this project for AI coding assistants (Codex, Claude, Copilot, etc.).

## Overview

Briefly exposes three Durable Object agents and is itself discoverable as an A2A agent.

---

## BrieflyAgent

**File**: `src/agents/BrieflyAgent.ts`  
**Route**: `/agents/BrieflyAgent/:id`  
**Binding**: `BRIEFLY_AGENT`

Conversational AI agent. Handles chat requests, streams Gemma 4 responses, generates innovation briefs.

### Callables
- `generateBrief(topic: string): Promise<GeneratedBrief>` — Creates a structured innovation brief with tools, news, and leaderboard data from ScraperAgent.

### State (SQLite)
- `conversations` table: `(id, role, content, created_at)`

### Rate Limiting
- 50 requests per hour per instance

---

## ScraperAgent

**File**: `src/agents/ScraperAgent.ts`  
**Route**: `/agents/ScraperAgent/:id`  
**Binding**: `SCRAPER_AGENT`

Background data scraper. Runs every 6 hours via cron. Stores all scraped items in SQLite. Central data store for BrieflyAgent and MCP tools.

### Callables
- `scrapeAll(): Promise<{ count, scrapedAt }>` — Triggers immediate scrape of all sources
- `queryItems(opts): Promise<ScrapedItem[]>` — Query with filters: `query`, `category`, `source`, `limit`
- `getStatus(): Promise<ScraperState>` — Returns `{ lastScrapedAt, itemCount }`

### State (SQLite)
- `items` table: `(id, source, sourceUrl, title, summary, url, category, tags, publishedAt, scrapedAt)`

### Cron
- `0 */6 * * *` — scrapes every 6 hours

### Sources
All scrapers are in `src/scrapers/`. They accept `env: Env` for CrawlerAgent access:
- `scrapeTheRundown()` — RSS
- `scrapeTheNeuron()` — RSS  
- `scrapeFuturepedia(env)` — JS SPA via CrawlerAgent
- `scrapeProductHunt()` — RSS
- `scrapeArena(env)` — JS SPA via CrawlerAgent

---

## CrawlerAgent

**File**: `src/agents/CrawlerAgent.ts`  
**Route**: `/agents/CrawlerAgent/:id`  
**Binding**: `CRAWLER_AGENT`  
**Requires**: `BROWSER` binding (Cloudflare Browser Rendering API)

Headless Chromium agent. Renders JavaScript-driven SPAs before HTML is extracted. Maintains a browser singleton per DO instance.

### Callables
- `renderPage(opts): Promise<string>` — Renders page, returns full HTML after JS execution
  - `opts.url: string` — Target URL
  - `opts.waitFor?: string` — CSS selector to wait for (optional)
  - `opts.timeout?: number` — Navigation timeout in ms (default 20s)
- `evaluatePage(opts): Promise<string>` — Renders page + evaluates JS expression, returns serialised result
  - `opts.url: string`, `opts.waitFor?: string`, `opts.timeout?: number`
  - `opts.expression: string` — JS to evaluate in page context

### Browser Lifecycle
- Browser is lazily launched on first request and reused across calls
- `onDestroy()` closes the browser when the DO is evicted

---

## MCP Server (Stateless)

**File**: `src/mcp/server.ts`  
**Route**: `POST /mcp`  
**Pattern**: Stateless — `createMcpHandler` creates a fresh McpServer per request

### Tools
1. **`search_ai_tools`** — Search AI tools by keyword and category
   - Params: `query: string`, `category?: string`, `limit?: number`
   - Returns: Array of matching `ScrapedItem` objects from ScraperAgent

2. **`get_industry_news`** — Latest AI industry headlines
   - Params: `source?: string` (therundown | theneuron), `limit?: number`
   - Returns: Array of news `ScrapedItem` objects

3. **`get_model_leaderboard`** — AI model performance rankings from Arena.ai
   - Params: `limit?: number`
   - Returns: Array of leaderboard `ScrapedItem` objects

4. **`generate_brief`** — Structured innovation brief for a topic
   - Params: `topic: string` (max 500 chars)
   - Returns: JSON object with `recommendedTools`, `keyNews`, `leaderboardSnapshot`
   - **No LLM call** — returns raw structured scraper data only

---

## A2A Agent

**Discovery**: `GET /.well-known/agent-card.json`  
**Tasks**: `POST /a2a/tasks`, `GET /a2a/tasks/:id`  
**Storage**: KV namespace `A2A_TASKS` (24h TTL)

### Skills
- `model_leaderboard` — Returns current leaderboard data
- `industry_news` — Returns latest news items
- `search_tools` — Searches AI tools by query

---

## Inter-Agent Communication

All DO-to-DO calls go through `src/utils/agentFetch.ts`:

```typescript
// Generic typed call (returns T | null on failure)
callAgent<T>(stub, "/call/methodName", bodyObject)

// Backwards-compatible array wrapper (returns [] on failure)
agentFetch(stub, "/call/methodName", bodyObject)
```

Both add the required `x-partykit-room: global` header.

---

## Data Flow

```
User request
    │
    ├─ MCP tool call → createBrieflyMcpServer → callAgent → ScraperAgent.queryItems → ScrapedItem[]
    │
    ├─ A2A task → taskManager → callAgent → ScraperAgent.queryItems → ScrapedItem[]
    │
    ├─ Chat message → BrieflyAgent.onRequest → agentFetch ScraperAgent → Gemma 4 stream
    │
    └─ /api/scrape → ScraperAgent.scrapeAll → scrapeAllSources(env)
                         │
                         ├─ rss.ts (plain fetch)
                         ├─ producthunt.ts (plain fetch RSS)
                         ├─ arena.ts → callAgent CrawlerAgent.renderPage → parse HTML
                         └─ futurepedia.ts → callAgent CrawlerAgent.renderPage → parse HTML
```
</content>
</invoke>