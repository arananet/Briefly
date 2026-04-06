# CLAUDE.md — Briefly

This file provides essential context for Claude Code when working on this project.

## What This Project Is

**Briefly** is a nano agent — a single-purpose, composable AI agent for AI industry intelligence. It runs entirely on Cloudflare Workers + Durable Objects (edge-native). No traditional server infrastructure.

**Tagline**: _A Multi-Protocol Nano Agent powered by Gemma 4. The Edge-native intelligence layer for creative agencies._

## Critical Architecture Rules

### 1. Durable Object exports must stay in sync with wrangler.toml

`src/server.ts` re-exports all DO classes (`BrieflyAgent`, `ScraperAgent`, `CrawlerAgent`). `wrangler.toml` must have matching `[durable_objects]` bindings AND a `[[migrations]]` entry for any new class. Missing either causes deployment error code 10064.

### 2. All scrapers that need JS rendering must accept `env: Env`

`scrapeArena(env)` and `scrapeFuturepedia(env)` use `CrawlerAgent` via `callAgent`. `scrapeAllSources(env)` in `src/scrapers/index.ts` passes env to these. `ScraperAgent.scrapeAll()` passes `this.env`.

### 3. MCP server is stateless — never use McpAgent DO

The agents SDK `McpAgent` has a lifecycle bug where `reinitializeServer()` fires `onmessage` without a WebSocket, causing `send()` to throw silently. Solution: use `createMcpHandler(server, { route: "/mcp" })` which creates a fresh `McpServer` per request.

### 4. MCP tools must NOT make LLM calls

Tools return raw scraped data (JSON). The calling LLM synthesises. `generate_brief` returns a structured object of scraped data, no AI inference.

### 5. callAgent response format

The agents SDK callable endpoint (`POST /call/{method}`) returns the result directly as JSON. `callAgent<T>` in `src/utils/agentFetch.ts` handles HTML error pages (guards `text.startsWith("<")`).

### 6. CrawlerAgent callable response

`renderPage` returns a `string` (HTML). The agents SDK serialises this as a JSON string. `callAgent<string>` correctly parses it. The result is raw HTML, not JSON.

## File Map

| File | Role |
|------|------|
| `src/server.ts` | Hono entry point, DO exports, all routes |
| `src/agents/BrieflyAgent.ts` | Conversational AI, `/agents/BrieflyAgent/:id` |
| `src/agents/ScraperAgent.ts` | Background scraper, 6h cron, SQLite |
| `src/agents/CrawlerAgent.ts` | Headless Chromium singleton, `renderPage` callable |
| `src/mcp/server.ts` | `createBrieflyMcpServer()` — stateless MCP factory |
| `src/scrapers/index.ts` | `scrapeAllSources(env)` — orchestrates all scrapers |
| `src/scrapers/arena.ts` | Arena.ai leaderboard (JS SPA → CrawlerAgent) |
| `src/scrapers/futurepedia.ts` | Futurepedia (JS SPA → CrawlerAgent) |
| `src/scrapers/producthunt.ts` | Product Hunt RSS feed |
| `src/scrapers/rss.ts` | The Rundown + The Neuron RSS feeds |
| `src/utils/agentFetch.ts` | `callAgent<T>` + `agentFetch` DO helpers |
| `src/a2a/` | A2A task lifecycle + agent card |
| `src/types.ts` | `Env`, `ScrapedItem`, A2A types |
| `wrangler.toml` | Cloudflare bindings + DO migrations |

## Common Commands

```bash
npm run preview    # wrangler dev (local)
npm run build      # vite build (client)
npm run deploy     # wrangler deploy
```

## Key Dependencies

- `agents` v0.9.0 — `Agent`, `McpAgent`, `callable`, `routeAgentRequest`, `createMcpHandler`
- `@modelcontextprotocol/sdk` v1.10.2 — `McpServer`
- `@cloudflare/puppeteer` — Browser Rendering API (requires `[browser]` binding)
- `hono` — Worker router
- `zod` — MCP tool parameter schemas

## Known Gotchas

- `partyserver` base class requires `x-partykit-room` header on all DO fetch calls
- Strict Zod enums in MCP tools break when LLMs pass free-form strings — use `z.string().optional()` + fuzzy normalisation instead
- `@cloudflare/puppeteer` requires `[browser]` binding in `wrangler.toml` AND `nodejs_compat` compatibility flag
- KV namespace `A2A_TASKS` id is a placeholder in `wrangler.toml` — replace with real ID from `wrangler kv namespace create A2A_TASKS`
