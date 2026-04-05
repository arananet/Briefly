/**
 * Briefly — Cloudflare Worker Entry Point
 *
 * Hono router handles:
 *   - Static asset serving (React SPA)
 *   - A2A agent discovery + task endpoints
 *   - MCP server (Streamable HTTP + legacy SSE)
 *   - REST API for the frontend
 *   - Agent WebSocket/HTTP routing
 *
 * Exports BrieflyAgent, ScraperAgent, BrieflyMcpAgent as Durable Object
 * classes so Wrangler can bind them.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { routeAgentRequest } from "agents";
import type { Env } from "./types";
import { buildAgentCard } from "./a2a/agentCard";
import { a2aRouter } from "./a2a/handler";
import { BrieflyAgent } from "./agents/BrieflyAgent";
import { ScraperAgent } from "./agents/ScraperAgent";
import { BrieflyMcpAgent } from "./mcp/server";

// Re-export Durable Object classes for Wrangler binding
export { BrieflyAgent, ScraperAgent, BrieflyMcpAgent };

const app = new Hono<{ Bindings: Env }>();

// ── CORS ───────────────────────────────────────────────────────────────────
// Open CORS for public interoperability endpoints
app.use(
  "/mcp/*",
  cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] })
);
app.use(
  "/sse/*",
  cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] })
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

// ── MCP: Streamable HTTP transport (modern, 2025+) ─────────────────────────
app.all("/mcp", (c) => {
  return BrieflyMcpAgent.serve("/mcp").fetch(
    c.req.raw,
    c.env,
    c.executionCtx
  );
});
app.all("/mcp/*", (c) => {
  return BrieflyMcpAgent.serve("/mcp").fetch(
    c.req.raw,
    c.env,
    c.executionCtx
  );
});

// ── MCP: Legacy SSE transport (backwards compatibility) ────────────────────
app.all("/sse", (c) => {
  return BrieflyMcpAgent.serveSSE("/sse").fetch(
    c.req.raw,
    c.env,
    c.executionCtx
  );
});
app.all("/sse/*", (c) => {
  return BrieflyMcpAgent.serveSSE("/sse").fetch(
    c.req.raw,
    c.env,
    c.executionCtx
  );
});

// ── REST API ───────────────────────────────────────────────────────────────

// GET /api/feed — latest scraped items (for the industry feed panel)
app.get("/api/feed", async (c) => {
  try {
    const url = new URL(c.req.url);
    const category = url.searchParams.get("category") ?? undefined;
    const source = url.searchParams.get("source") ?? undefined;
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") ?? "20", 10),
      50
    );

    const id = c.env.SCRAPER_AGENT.idFromName("global");
    const stub = c.env.SCRAPER_AGENT.get(id);
    const res = await stub.fetch(
      new Request("https://internal/call/queryItems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, source, limit }),
      })
    );

    if (!res.ok) return c.json([], 200);
    const items = await res.json();
    return c.json(items);
  } catch {
    return c.json([], 200);
  }
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

    // Sanitize input
    const query = typeof body.query === "string"
      ? body.query.slice(0, 500).replace(/[^\w\s\-.,!?]/g, "")
      : undefined;

    const id = c.env.SCRAPER_AGENT.idFromName("global");
    const stub = c.env.SCRAPER_AGENT.get(id);
    const res = await stub.fetch(
      new Request("https://internal/call/queryItems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          category: body.category,
          source: body.source,
          limit: Math.min(body.limit ?? 20, 50),
        }),
      })
    );

    if (!res.ok) return c.json([], 200);
    return c.json(await res.json());
  } catch {
    return c.json({ error: "Search failed" }, 500);
  }
});

// POST /api/scrape — manually trigger a scrape refresh (admin use)
app.post("/api/scrape", async (c) => {
  try {
    const id = c.env.SCRAPER_AGENT.idFromName("global");
    const stub = c.env.SCRAPER_AGENT.get(id);
    const res = await stub.fetch(
      new Request("https://internal/call/scrapeAll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    return c.json(await res.json());
  } catch {
    return c.json({ error: "Scrape trigger failed" }, 500);
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
