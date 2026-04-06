/**
 * Briefly MCP Server — stateless factory approach.
 *
 * Creates a fresh McpServer instance per request via createBrieflyMcpServer().
 * Used with createMcpHandler() from agents/mcp for a Streamable HTTP endpoint.
 *
 * Connect via: https://briefly.info-693.workers.dev/mcp
 *
 * Exposes 4 tools — all return raw scraped data, no LLM calls:
 *   - search_ai_tools      — find AI tools by keyword
 *   - get_industry_news    — latest AI news headlines
 *   - get_model_leaderboard — Arena.ai model rankings
 *   - generate_brief        — structured innovation brief from scraped data
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, ScrapedItem } from "../types";
import { agentFetch } from "../utils/agentFetch";

async function queryScraperAgentMcp(
  env: Env,
  opts: { query?: string; category?: string; source?: string; limit?: number }
): Promise<ScrapedItem[]> {
  const stub = env.SCRAPER_AGENT.get(env.SCRAPER_AGENT.idFromName("global"));
  return (await agentFetch(stub, "/call/queryItems", opts)) as ScrapedItem[];
}

/**
 * Normalise a free-form category string to one of the valid DB values.
 * Accepts fuzzy inputs like "Tool", "NEWS", "arena", etc.
 */
function normaliseCategory(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (s.includes("leader") || s.includes("arena") || s.includes("rank") || s.includes("model")) return "leaderboard";
  if (s.includes("news") || s.includes("newsletter") || s.includes("article")) return "news";
  if (s.includes("tool") || s.includes("app") || s.includes("product")) return "tool";
  if (s === "any" || s === "all") return undefined;
  return undefined; // unknown → no filter
}

/**
 * Normalise a free-form source string to one of the valid DB values.
 */
function normaliseSource(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (s.includes("rundown") || s === "therundown") return "therundown";
  if (s.includes("neuron") || s === "theneuron") return "theneuron";
  if (s.includes("futurepedia")) return "futurepedia";
  if (s.includes("producthunt") || s.includes("product hunt") || s === "ph") return "producthunt";
  if (s.includes("arena")) return "arena";
  if (s === "all" || s === "any") return undefined;
  return undefined; // unknown → no filter
}

/**
 * Creates a fresh McpServer with all 4 Briefly tools registered.
 * Call this once per request — do NOT reuse instances across requests.
 */
export function createBrieflyMcpServer(env: Env): McpServer {
  const server = new McpServer({
    name: "briefly",
    version: "1.0.0",
  });

  // ── Tool 1: Search AI tools ───────────────────────────────────────────────
  server.tool(
    "search_ai_tools",
    "Find AI tools from Futurepedia and Product Hunt that match a given project description or use case.",
    {
      query: z.string().describe("Keywords or project description to search for"),
      category: z.string().optional().describe("Filter: 'tool', 'news', 'leaderboard', or 'any'"),
      limit: z.number().min(1).max(20).default(10).describe("Maximum number of results"),
    },
    async ({ query, category, limit }) => {
      const items = await queryScraperAgentMcp(env, {
        query,
        category: normaliseCategory(category),
        limit,
      });

      if (items.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No matching tools found. Data may still be loading — try again in a moment, or try a broader search.",
          }],
        };
      }

      const formatted = items
        .map((item) =>
          `**${item.title}** [${item.source.toUpperCase()}]\n` +
          `${item.summary}\n` +
          `URL: ${item.url}\n` +
          `Tags: ${item.tags.join(", ")}`
        )
        .join("\n\n---\n\n");

      return { content: [{ type: "text" as const, text: formatted }] };
    }
  );

  // ── Tool 2: Get industry news ─────────────────────────────────────────────
  server.tool(
    "get_industry_news",
    "Retrieve the latest AI industry news from The Rundown AI and The Neuron Daily newsletters.",
    {
      source: z.string().optional().describe("Filter by source: 'therundown', 'theneuron', or omit for all"),
      limit: z.number().min(1).max(20).default(10).describe("Maximum number of articles"),
    },
    async ({ source, limit }) => {
      const items = await queryScraperAgentMcp(env, {
        category: "news",
        source: normaliseSource(source),
        limit,
      });

      if (items.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No news available yet. Check back in a few minutes." }],
        };
      }

      const formatted = items
        .map((item) =>
          `**${item.title}** (${item.source})\n` +
          `${item.summary}\n` +
          `Read: ${item.url}\n` +
          `Published: ${new Date(item.publishedAt).toLocaleDateString()}`
        )
        .join("\n\n---\n\n");

      return { content: [{ type: "text" as const, text: formatted }] };
    }
  );

  // ── Tool 3: Get model leaderboard ─────────────────────────────────────────
  server.tool(
    "get_model_leaderboard",
    "Retrieve the current AI model leaderboard from Arena.ai showing ranked models with scores.",
    {
      limit: z.number().min(1).max(20).default(10).describe("Number of top models to return"),
    },
    async ({ limit }) => {
      const items = await queryScraperAgentMcp(env, {
        category: "leaderboard",
        limit,
      });

      if (items.length === 0) {
        return {
          content: [{ type: "text" as const, text: "Leaderboard data not available yet — the scraper runs every 6 hours." }],
        };
      }

      const formatted =
        "# AI Model Leaderboard (Arena.ai)\n\n" +
        items.map((item) => `${item.title}\n${item.summary}`).join("\n\n");

      return { content: [{ type: "text" as const, text: formatted }] };
    }
  );

  // ── Tool 4: Generate brief (raw data, no LLM) ─────────────────────────────
  server.tool(
    "generate_brief",
    "Generate a structured AI innovation brief for a topic. Returns raw scraped data as structured JSON — no AI generation, just real intelligence from monitored sources.",
    {
      topic: z.string().max(500).describe("Project or topic to build the brief for"),
    },
    async ({ topic }) => {
      const [tools, news, leaderboard] = await Promise.all([
        queryScraperAgentMcp(env, { query: topic, category: "tool", limit: 5 }),
        queryScraperAgentMcp(env, { category: "news", limit: 5 }),
        queryScraperAgentMcp(env, { category: "leaderboard", limit: 5 }),
      ]);

      const brief = {
        topic,
        generatedAt: new Date().toISOString(),
        dataSource: "Live scrape from Futurepedia, Product Hunt, The Rundown AI, The Neuron Daily, Arena.ai",
        recommendedTools: tools.map((t) => ({
          name: t.title,
          summary: t.summary,
          source: t.source,
          url: t.url,
          tags: t.tags,
        })),
        keyNews: news.map((n) => ({
          title: n.title,
          summary: n.summary,
          source: n.source,
          url: n.url,
          publishedAt: n.publishedAt,
        })),
        leaderboardSnapshot: leaderboard.slice(0, 5).map((l, i) => ({
          rank: i + 1,
          model: l.title.replace(/^#\d+\s/, ""),
          summary: l.summary,
        })),
        status: (tools.length + news.length + leaderboard.length) === 0
          ? "no_data — scraper may still be populating"
          : "ok",
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(brief, null, 2) }],
      };
    }
  );

  return server;
}
