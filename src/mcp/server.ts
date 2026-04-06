/**
 * Briefly MCP Server — stateless factory approach.
 *
 * Creates a fresh McpServer instance per request via createBrieflyMcpServer().
 * Used with createMcpHandler() from agents/mcp for a Streamable HTTP endpoint.
 *
 * Connect via: https://briefly.info-693.workers.dev/mcp
 *
 * Exposes 4 tools:
 *   - search_ai_tools
 *   - get_industry_news
 *   - get_model_leaderboard
 *   - generate_brief
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, ScrapedItem } from "../types";
import { agentFetch } from "../utils/agentFetch";

const BRIEFLY_SYSTEM_PROMPT = `You are the Innovation Director of a leading creative agency.
Synthesize AI industry intelligence into actionable, ROI-focused recommendations for creative teams.`;

async function queryScraperAgentMcp(
  env: Env,
  opts: { query?: string; category?: string; source?: string; limit?: number }
): Promise<ScrapedItem[]> {
  const stub = env.SCRAPER_AGENT.get(env.SCRAPER_AGENT.idFromName("global"));
  return (await agentFetch(stub, "/call/queryItems", opts)) as ScrapedItem[];
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
    "Find AI tools from Futurepedia and Product Hunt that match a given project description or use case. Always returns source URL for citation.",
    {
      query: z.string().describe("Keywords or project description to match against"),
      category: z
        .enum(["tool", "news", "leaderboard", "any"])
        .default("tool")
        .describe("Filter results by category"),
      limit: z
        .number()
        .min(1)
        .max(20)
        .default(10)
        .describe("Maximum number of results"),
    },
    async ({ query, category, limit }) => {
      const items = await queryScraperAgentMcp(env, {
        query,
        category: category === "any" ? undefined : category,
        limit,
      });

      if (items.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No matching tools found. The scraper may still be populating data — try again in a moment.",
            },
          ],
        };
      }

      const formatted = items
        .map(
          (item) =>
            `**${item.title}** [${item.source.toUpperCase()}]\n` +
            `${item.summary}\n` +
            `URL: ${item.url}\n` +
            `Tags: ${item.tags.join(", ")}\n` +
            `Source: ${item.sourceUrl}`
        )
        .join("\n\n---\n\n");

      return {
        content: [{ type: "text" as const, text: formatted }],
      };
    }
  );

  // ── Tool 2: Get industry news ─────────────────────────────────────────────
  server.tool(
    "get_industry_news",
    "Retrieve the latest AI industry news from The Rundown AI and The Neuron Daily newsletters.",
    {
      source: z
        .enum(["therundown", "theneuron", "all"])
        .default("all")
        .describe("Which newsletter source to query"),
      limit: z
        .number()
        .min(1)
        .max(20)
        .default(10)
        .describe("Maximum number of articles"),
    },
    async ({ source, limit }) => {
      const items = await queryScraperAgentMcp(env, {
        category: "news",
        source: source === "all" ? undefined : source,
        limit,
      });

      if (items.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No news available right now." }],
        };
      }

      const formatted = items
        .map(
          (item) =>
            `**${item.title}** (${item.source})\n` +
            `${item.summary}\n` +
            `Read: ${item.url}\n` +
            `Published: ${new Date(item.publishedAt).toLocaleDateString()}`
        )
        .join("\n\n---\n\n");

      return {
        content: [{ type: "text" as const, text: formatted }],
      };
    }
  );

  // ── Tool 3: Get model leaderboard ─────────────────────────────────────────
  server.tool(
    "get_model_leaderboard",
    "Retrieve the current AI model leaderboard from Arena.ai. Shows ranked models with scores.",
    {
      limit: z
        .number()
        .min(1)
        .max(20)
        .default(10)
        .describe("Number of top models to return"),
    },
    async ({ limit }) => {
      const items = await queryScraperAgentMcp(env, {
        category: "leaderboard",
        limit,
      });

      if (items.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "Leaderboard data not available." },
          ],
        };
      }

      const formatted =
        "# Arena.ai Text Model Leaderboard\n\n" +
        items
          .map((item) => `${item.title}\n${item.summary}`)
          .join("\n\n");

      return {
        content: [{ type: "text" as const, text: formatted }],
      };
    }
  );

  // ── Tool 4: Generate brief ────────────────────────────────────────────────
  server.tool(
    "generate_brief",
    "Generate a structured AI innovation brief for a specific topic or project using Gemma 4. Returns JSON suitable for PDF export.",
    {
      topic: z
        .string()
        .max(500)
        .describe("Project or topic to generate the brief for"),
    },
    async ({ topic }) => {
      const [tools, news, leaderboard] = await Promise.all([
        queryScraperAgentMcp(env, { query: topic, category: "tool", limit: 5 }),
        queryScraperAgentMcp(env, { category: "news", limit: 5 }),
        queryScraperAgentMcp(env, { category: "leaderboard", limit: 5 }),
      ]);

      const context =
        `Tools: ${tools.map((t) => `${t.title}: ${t.summary}`).join("; ")}\n` +
        `News: ${news.map((n) => n.title).join("; ")}\n` +
        `Top Models: ${leaderboard.slice(0, 3).map((l) => l.title).join(", ")}`;

      let aiSummary = "";
      try {
        const result = await env.AI.run(
          "@cf/google/gemma-4-26b-a4b-it" as Parameters<Ai["run"]>[0],
          {
            messages: [
              { role: "system" as const, content: BRIEFLY_SYSTEM_PROMPT },
              {
                role: "user" as const,
                content: `Generate a concise executive summary (3-4 sentences) for an innovation brief about: "${topic}"\n\nContext:\n${context}`,
              },
            ],
          }
        );
        aiSummary =
          typeof result === "string"
            ? result
            : (result as { response?: string }).response ?? "";
      } catch {
        aiSummary = `Innovation brief for ${topic}: Strategic assessment of AI tools and industry trends for creative agency implementation.`;
      }

      const brief = {
        topic,
        generatedAt: new Date().toISOString(),
        summary: aiSummary,
        recommendedTools: tools.map((t) => ({
          name: t.title,
          source: t.source,
          sourceUrl: t.sourceUrl,
          matchReason: `Relevant to "${topic}" — Tags: ${t.tags.join(", ")}`,
          toolUrl: t.url,
        })),
        keyNews: news.map((n) => ({
          title: n.title,
          source: n.source,
          url: n.url,
        })),
        leaderboardSnapshot: leaderboard.slice(0, 5).map((l, i) => ({
          rank: i + 1,
          model: l.title.replace(/^#\d+\s/, ""),
          provider: l.tags[0] || "Unknown",
          score: l.summary.match(/Score: ([^\s·]+)/)?.[1] || "N/A",
        })),
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(brief, null, 2),
          },
        ],
      };
    }
  );

  return server;
}
