/**
 * Briefly MCP Server — stateless factory, live-scraping tools.
 *
 * Every tool call scrapes its source(s) live on demand.
 * No cached/scheduled data dependency — tools always return fresh results.
 *
 * After scraping, results are stored to ScraperAgent SQLite in the background
 * so the REST API and UI also stay current.
 *
 * Endpoints: POST /mcp (Streamable HTTP, 2025 spec)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, ScrapedItem } from "../types";
import { agentFetch } from "../utils/agentFetch";
import { scrapeArena } from "../scrapers/arena";
import { scrapeFuturepedia } from "../scrapers/futurepedia";
import { scrapeProductHunt } from "../scrapers/producthunt";
import { scrapeTheRundown, scrapeTheNeuron } from "../scrapers/rss";
import { filterItems } from "../scrapers/index";

/**
 * Store freshly scraped items to ScraperAgent SQLite in the background.
 * Fire-and-forget — tool responses don't wait for this.
 */
function storeToCache(env: Env, items: ScrapedItem[]): void {
  if (items.length === 0) return;
  try {
    const stub = env.SCRAPER_AGENT.get(env.SCRAPER_AGENT.idFromName("global"));
    // Best-effort: call storeItems callable if it exists, or scrapeAll to refresh
    agentFetch(stub, "/call/storeItems", { items }).catch(() => {});
  } catch {
    // Non-fatal — cache miss is acceptable
  }
}

/**
 * Normalise a free-form source string to a valid DB value.
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
  return undefined;
}

/**
 * Creates a fresh McpServer with all 4 Briefly tools registered.
 * Each tool scrapes its source(s) live on every invocation.
 */
export function createBrieflyMcpServer(env: Env): McpServer {
  const server = new McpServer({ name: "briefly", version: "1.0.0" });

  // ── Tool 1: Search AI tools (live scrape Futurepedia + Product Hunt) ───────
  server.tool(
    "search_ai_tools",
    "Find AI tools from Futurepedia and Product Hunt. Scrapes sources live on each call.",
    {
      query: z.string().describe("Keywords or project description to search for"),
      limit: z.number().min(1).max(20).default(10).describe("Maximum number of results"),
    },
    async ({ query, limit }) => {
      const [futurepedia, producthunt] = await Promise.all([
        scrapeFuturepedia(env).catch(() => [] as ScrapedItem[]),
        scrapeProductHunt().catch(() => [] as ScrapedItem[]),
      ]);

      const all = [...futurepedia, ...producthunt];
      storeToCache(env, all);

      const results = filterItems(all, { query, limit });

      if (results.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No tools found matching "${query}". Both Futurepedia and Product Hunt were scraped live — try a broader search term.`,
          }],
        };
      }

      const formatted = results
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

  // ── Tool 2: Get industry news (live scrape The Rundown + The Neuron) ───────
  server.tool(
    "get_industry_news",
    "Retrieve the latest AI industry news from The Rundown AI and The Neuron Daily. Scrapes RSS feeds live on each call.",
    {
      source: z.string().optional().describe("Filter: 'therundown', 'theneuron', or omit for both"),
      limit: z.number().min(1).max(20).default(10).describe("Maximum number of articles"),
    },
    async ({ source, limit }) => {
      const normSource = normaliseSource(source);

      const [rundown, neuron] = await Promise.all([
        (normSource === undefined || normSource === "therundown")
          ? scrapeTheRundown().catch(() => [] as ScrapedItem[])
          : Promise.resolve([] as ScrapedItem[]),
        (normSource === undefined || normSource === "theneuron")
          ? scrapeTheNeuron().catch(() => [] as ScrapedItem[])
          : Promise.resolve([] as ScrapedItem[]),
      ]);

      const all = [...rundown, ...neuron];
      storeToCache(env, all);

      const results = filterItems(all, { source: normSource, limit });

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No news fetched from RSS feeds — sources may be temporarily unavailable." }],
        };
      }

      const formatted = results
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

  // ── Tool 3: Get model leaderboard (live scrape Arena.ai / HuggingFace) ────
  server.tool(
    "get_model_leaderboard",
    "Retrieve current AI model rankings. Scrapes Arena.ai live (headless browser), falls back to HuggingFace trending models.",
    {
      limit: z.number().min(1).max(20).default(10).describe("Number of top models to return"),
    },
    async ({ limit }) => {
      const items = await scrapeArena(env).catch(() => [] as ScrapedItem[]);
      storeToCache(env, items);

      const results = items.slice(0, limit);

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "Leaderboard sources unreachable — please try again." }],
        };
      }

      const formatted =
        "# AI Model Leaderboard\n\n" +
        results.map((item) => `${item.title}\n${item.summary}`).join("\n\n");

      return { content: [{ type: "text" as const, text: formatted }] };
    }
  );

  // ── Tool 4: Generate brief (live scrape all sources) ──────────────────────
  server.tool(
    "generate_brief",
    "Generate a structured AI innovation brief. Scrapes all sources live — no cached data.",
    {
      topic: z.string().max(500).describe("Project or topic to build the brief for"),
    },
    async ({ topic }) => {
      const [tools, news, leaderboard] = await Promise.all([
        Promise.all([
          scrapeFuturepedia(env).catch(() => [] as ScrapedItem[]),
          scrapeProductHunt().catch(() => [] as ScrapedItem[]),
        ]).then(([f, p]) => filterItems([...f, ...p], { query: topic, limit: 5 })),
        Promise.all([
          scrapeTheRundown().catch(() => [] as ScrapedItem[]),
          scrapeTheNeuron().catch(() => [] as ScrapedItem[]),
        ]).then(([r, n]) => [...r, ...n].slice(0, 5)),
        scrapeArena(env).catch(() => [] as ScrapedItem[]).then((r) => r.slice(0, 5)),
      ]);

      const allItems = [...tools, ...news, ...leaderboard];
      storeToCache(env, allItems);

      const brief = {
        topic,
        generatedAt: new Date().toISOString(),
        dataSource: "Live scrape: Futurepedia, Product Hunt, The Rundown AI, The Neuron Daily, Arena.ai / HuggingFace",
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
        leaderboardSnapshot: leaderboard.map((l, i) => ({
          rank: i + 1,
          model: l.title.replace(/^#\d+\s/, ""),
          summary: l.summary,
          url: l.url,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(brief, null, 2) }],
      };
    }
  );

  return server;
}
