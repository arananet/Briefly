/**
 * Briefly — Cloudflare Worker Entry Point
 *
 * Hono router handles:
 *   - Static asset serving (React SPA)
 *   - A2A agent discovery + task endpoints
 *   - MCP server (stateless Streamable HTTP)
 *   - REST API for the frontend
 *   - Agent WebSocket/HTTP routing
 *
 * Exports BrieflyAgent, ScraperAgent as Durable Object classes for Wrangler.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { routeAgentRequest } from "agents";
import { createMcpHandler } from "agents/mcp";
import type { Env } from "./types";
import { agentFetch } from "./utils/agentFetch";
import { buildAgentCard } from "./a2a/agentCard";
import { a2aRouter } from "./a2a/handler";
import { BrieflyAgent } from "./agents/BrieflyAgent";
import { ScraperAgent } from "./agents/ScraperAgent";
import { CrawlerAgent } from "./agents/CrawlerAgent";
import { createBrieflyMcpServer } from "./mcp/server";

// Re-export Durable Object classes for Wrangler binding
export { BrieflyAgent, ScraperAgent, CrawlerAgent };

const app = new Hono<{ Bindings: Env }>();

// ── CORS ───────────────────────────────────────────────────────────────────
// Open CORS for public interoperability endpoints
app.use(
  "/mcp",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Accept", "Mcp-Session-Id", "MCP-Protocol-Version"],
    exposeHeaders: ["Mcp-Session-Id"],
  })
);
app.use(
  "/.well-known/*",
  cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] })
);
app.use(
  "/a2a/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Accept", "Authorization"],
  })
);

// ── A2A: Agent Card ────────────────────────────────────────────────────────
app.get("/.well-known/agent-card.json", (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json(buildAgentCard(baseUrl));
});

// ── A2A: Task endpoints ────────────────────────────────────────────────────
app.route("/a2a", a2aRouter);

// ── MCP: Streamable HTTP transport (stateless, 2025+ standard) ────────────
// Creates a fresh McpServer per request — avoids DO lifecycle issues and
// correctly exposes all 4 tools via tools/list.
app.all("/mcp", (c) => {
  const server = createBrieflyMcpServer(c.env);
  const handler = createMcpHandler(server, { route: "/mcp" });
  return handler(c.req.raw, c.env, c.executionCtx);
});

// ── REST API ───────────────────────────────────────────────────────────────

// GET /api/feed — latest scraped items (for the industry feed panel)
app.get("/api/feed", async (c) => {
  const url = new URL(c.req.url);
  const stub = c.env.SCRAPER_AGENT.get(c.env.SCRAPER_AGENT.idFromName("global"));
  const items = await agentFetch(stub, "/call/queryItems", {
    category: url.searchParams.get("category") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    limit: Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 50),
  });
  return c.json(items);
});

// POST /api/search — search scraped items
app.post("/api/search", async (c) => {
  try {
    const body = await c.req.json<{
      query?: string;
      category?: string;
      source?: string;
      limit?: number;
    }>();
    const query = typeof body.query === "string"
      ? body.query.slice(0, 500).replace(/[^\w\s\-.,!?]/g, "")
      : undefined;
    const stub = c.env.SCRAPER_AGENT.get(c.env.SCRAPER_AGENT.idFromName("global"));
    const items = await agentFetch(stub, "/call/queryItems", {
      query,
      category: body.category,
      source: body.source,
      limit: Math.min(body.limit ?? 20, 50),
    });
    return c.json(items);
  } catch {
    return c.json({ error: "Search failed" }, 500);
  }
});

// POST /api/scrape — manually trigger a scrape refresh (admin use)
app.post("/api/scrape", async (c) => {
  try {
    const stub = c.env.SCRAPER_AGENT.get(c.env.SCRAPER_AGENT.idFromName("global"));
    const result = await agentFetch(stub, "/call/scrapeAll", {});
    return c.json(result);
  } catch {
    return c.json({ error: "Scrape trigger failed" }, 500);
  }
});

// GET /api/scraper-status — debug endpoint: reports scraper state + item counts
app.get("/api/scraper-status", async (c) => {
  try {
    const stub = c.env.SCRAPER_AGENT.get(c.env.SCRAPER_AGENT.idFromName("global"));
    const [status, tools, news, leaderboard] = await Promise.all([
      agentFetch(stub, "/call/getStatus", {}),
      agentFetch(stub, "/call/queryItems", { category: "tool", limit: 3 }),
      agentFetch(stub, "/call/queryItems", { category: "news", limit: 3 }),
      agentFetch(stub, "/call/queryItems", { category: "leaderboard", limit: 3 }),
    ]);
    return c.json({
      scraperStatus: status,
      sampleCounts: { tools: (tools as unknown[]).length, news: (news as unknown[]).length, leaderboard: (leaderboard as unknown[]).length },
      samples: { tools, news, leaderboard },
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// ── Agent routing (BrieflyAgent, ScraperAgent) ────────────────────────────
// routeAgentRequest adds the namespace/room headers the agents SDK requires.
app.all("/agents/*", async (c) => {
  return (
    (await routeAgentRequest(c.req.raw, c.env)) ??
    new Response("Agent not found", { status: 404 })
  );
});

// ── SPA Fallback: serve React app for all other routes ────────────────────
app.all("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
};
