/**
 * BrieflyAgent — AI-powered conversational agent using the base Agent class.
 * Handles HTTP requests with streaming SSE responses from Gemma 4.
 * Stores conversation history in Durable Object SQLite.
 */

import { Agent, callable } from "agents";
import type { Env, ScrapedItem, GeneratedBrief, ChatMessage } from "../types";

const SYSTEM_PROMPT = `You are the Innovation Director of a leading creative agency called Briefly.

You have real-time access to AI industry intelligence from:
- The Rundown AI (therundown.ai) — daily AI newsletter
- The Neuron Daily (theneurondaily.com) — AI news digest
- Futurepedia (futurepedia.io) — comprehensive AI tools directory
- Product Hunt (producthunt.com) — latest product launches
- Arena.ai Leaderboard (arena.ai/leaderboard/text) — AI model performance rankings

Your mission:
1. RECOMMEND specific AI tools that match the user's project — always explain WHY it matches and cite the exact source URL
2. SYNTHESIZE key industry changes with strategic context relevant to creative agencies
3. IDENTIFY emerging trends before they go mainstream
4. When asked to generate a brief, output a JSON block wrapped in \`\`\`json ... \`\`\`

Communication style:
- Direct, strategic, insightful
- Focus on ROI and creative agency value
- Always cite sources with URLs
- Be specific — generic advice is worthless`;

interface BrieflyState {
  requestCount: number;
  lastRequestAt: string | null;
}

async function queryScraperAgent(
  env: Env,
  opts: { query?: string; category?: string; source?: string; limit?: number }
): Promise<ScrapedItem[]> {
  try {
    const id = env.SCRAPER_AGENT.idFromName("global");
    const stub = env.SCRAPER_AGENT.get(id);
    const res = await stub.fetch(
      new Request("https://internal/call/queryItems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      })
    );
    return res.ok ? ((await res.json()) as ScrapedItem[]) : [];
  } catch {
    return [];
  }
}

function sanitizeInput(input: string): string {
  return input.slice(0, 2000).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

export class BrieflyAgent extends Agent<Env, BrieflyState> {
  initialState: BrieflyState = {
    requestCount: 0,
    lastRequestAt: null,
  };

  async onStart() {
    this.sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id         TEXT PRIMARY KEY,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `;
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Callable dispatch (internal agent-to-agent calls)
    if (url.pathname.startsWith("/call/")) {
      return super.onRequest(request);
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let body: { messages?: Array<{ role: string; content: string }> };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const userMessages = (body.messages ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: sanitizeInput(m.content),
      }));

    if (userMessages.length === 0) {
      return new Response("No messages provided", { status: 400 });
    }

    // Rate limiting: 50 req/hour per instance
    const now = Date.now();
    const lastHour = this.state.lastRequestAt
      ? now - new Date(this.state.lastRequestAt).getTime()
      : Infinity;
    if (lastHour < 3_600_000 && this.state.requestCount >= 50) {
      return new Response("Rate limit exceeded", { status: 429 });
    }
    this.setState({
      requestCount: lastHour > 3_600_000 ? 1 : this.state.requestCount + 1,
      lastRequestAt: new Date().toISOString(),
    });

    // Extract the last user message for tool resolution
    const lastUserMsg = [...userMessages].reverse().find((m) => m.role === "user");
    const userQuery = lastUserMsg?.content ?? "";

    // Gather relevant context from ScraperAgent
    const [toolResults, newsResults] = await Promise.all([
      queryScraperAgent(this.env, { query: userQuery, category: "tool", limit: 5 }),
      queryScraperAgent(this.env, { category: "news", limit: 5 }),
    ]);

    // Build context injection
    let contextBlock = "";
    if (toolResults.length > 0) {
      contextBlock +=
        "\n\n[TOOL INTELLIGENCE — cite these when recommending tools]\n" +
        toolResults
          .map(
            (t) =>
              `• ${t.title} [${t.source.toUpperCase()}]\n  ${t.summary}\n  URL: ${t.url}\n  Tags: ${t.tags.join(", ")}`
          )
          .join("\n\n");
    }
    if (newsResults.length > 0) {
      contextBlock +=
        "\n\n[LATEST INDUSTRY NEWS — use for trend analysis]\n" +
        newsResults.map((n) => `• ${n.title} (${n.source}) — ${n.url}`).join("\n");
    }

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT + contextBlock },
      ...userMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    // Stream from Llama 3.3 70B
    let aiStream: ReadableStream;
    try {
      aiStream = (await this.env.AI.run(
        "@cf/google/gemma-4-26b-a4b-it" as Parameters<Ai["run"]>[0],
        { messages, stream: true } as Parameters<Ai["run"]>[1]
      )) as ReadableStream;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Return the raw AI stream with SSE headers
    return new Response(aiStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  @callable()
  async generateBrief(topic: string): Promise<GeneratedBrief> {
    const sanitized = sanitizeInput(topic).slice(0, 500);

    const [tools, news, leaderboard] = await Promise.all([
      queryScraperAgent(this.env, { query: sanitized, category: "tool", limit: 5 }),
      queryScraperAgent(this.env, { category: "news", limit: 5 }),
      queryScraperAgent(this.env, { category: "leaderboard", limit: 5 }),
    ]);

    let aiSummary = "";
    try {
      const result = await this.env.AI.run(
        "@cf/google/gemma-4-26b-a4b-it" as Parameters<Ai["run"]>[0],
        {
          messages: [
            { role: "system" as const, content: "You are an innovation director. Be concise." },
            {
              role: "user" as const,
              content: `Write a 3-sentence executive summary for an innovation brief about: "${sanitized}"`,
            },
          ],
        } as Parameters<Ai["run"]>[1]
      );
      aiSummary =
        typeof result === "string"
          ? result
          : (result as { response?: string }).response ?? "";
    } catch {
      aiSummary = `Innovation brief for: ${sanitized}`;
    }

    return {
      topic: sanitized,
      generatedAt: new Date().toISOString(),
      summary: aiSummary,
      recommendedTools: tools.map((t) => ({
        name: t.title,
        source: t.source,
        sourceUrl: t.sourceUrl,
        matchReason: `Relevant to "${sanitized}" — Tags: ${t.tags.join(", ")}`,
        toolUrl: t.url,
      })),
      keyNews: news.map((n) => ({ title: n.title, source: n.source, url: n.url })),
      leaderboardSnapshot: leaderboard.slice(0, 5).map((l, i) => ({
        rank: i + 1,
        model: l.title.replace(/^#\d+\s/, ""),
        provider: l.tags[0] || "Unknown",
        score: l.summary.match(/Score: ([^\s·]+)/)?.[1] || "N/A",
      })),
    };
  }
}
