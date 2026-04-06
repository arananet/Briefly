/**
 * A2A Task lifecycle manager backed by Cloudflare KV.
 * Tasks expire after 24 hours automatically.
 */

import type { A2ATask, A2ATaskStatus, A2APushConfig, Env, ScrapedItem } from "../types";
import { agentFetch } from "../utils/agentFetch";

const TTL_SECONDS = 86400; // 24 hours

export async function createTask(
  kv: KVNamespace,
  skill: string,
  input: unknown
): Promise<A2ATask> {
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const task: A2ATask = {
    sessionId,
    skill,
    status: "pending",
    input,
    output: null,
    error: null,
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  };
  await kv.put(`task:${sessionId}`, JSON.stringify(task), {
    expirationTtl: TTL_SECONDS,
  });
  return task;
}

export async function updateTask(
  kv: KVNamespace,
  sessionId: string,
  patch: Partial<A2ATask>
): Promise<A2ATask> {
  const raw = await kv.get(`task:${sessionId}`);
  if (!raw) throw new Error(`Task ${sessionId} not found`);
  const task: A2ATask = {
    ...JSON.parse(raw),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await kv.put(`task:${sessionId}`, JSON.stringify(task), {
    expirationTtl: TTL_SECONDS,
  });
  return task;
}

export async function getTask(
  kv: KVNamespace,
  sessionId: string
): Promise<A2ATask | null> {
  const raw = await kv.get(`task:${sessionId}`);
  return raw ? (JSON.parse(raw) as A2ATask) : null;
}

export async function cancelTask(
  kv: KVNamespace,
  sessionId: string
): Promise<void> {
  const task = await getTask(kv, sessionId);
  if (task && task.status === "running") {
    await updateTask(kv, sessionId, { status: "cancelled" });
  } else {
    await kv.delete(`task:${sessionId}`);
  }
}

/**
 * Deliver a push notification to the client's webhook URL.
 * Only sends to HTTPS endpoints. Includes Bearer token if provided.
 */
export async function deliverWebhook(
  config: A2APushConfig,
  task: A2ATask,
  event: "task-started" | "progress" | "task-completed" | "task-error"
): Promise<void> {
  // Security: only allow HTTPS webhook URLs
  if (!config.url.startsWith("https://")) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Briefly-A2A/1.0",
  };

  if (config.token) {
    headers["Authorization"] = `Bearer ${config.token}`;
  }

  try {
    await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId: task.sessionId,
        event,
        task,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Webhook delivery failure is non-fatal
  }
}

/**
 * Execute a named skill and update the task in KV when done.
 * Called via ctx.waitUntil to not block the HTTP response.
 */
export async function executeSkill(
  task: A2ATask,
  env: Env,
  pushConfig?: A2APushConfig
): Promise<void> {
  const kv = env.A2A_TASKS;

  try {
    await updateTask(kv, task.sessionId, { status: "running" });
    if (pushConfig) await deliverWebhook(pushConfig, task, "task-started");

    let output: unknown = null;

    const scraperStub = env.SCRAPER_AGENT.get(
      env.SCRAPER_AGENT.idFromName("global")
    );

    switch (task.skill) {
      case "search_tools": {
        const input = task.input as { query: string; category?: string; limit?: number };
        output = await agentFetch(scraperStub, "/call/queryItems", {
          query: input.query,
          category: input.category === "any" ? undefined : input.category,
          limit: input.limit ?? 10,
        });
        break;
      }

      case "industry_summary": {
        const input = task.input as { source?: string; limit?: number };
        output = await agentFetch(scraperStub, "/call/queryItems", {
          category: "news",
          source: input.source === "all" ? undefined : input.source,
          limit: input.limit ?? 10,
        });
        break;
      }

      case "model_leaderboard": {
        const input = task.input as { limit?: number };
        output = await agentFetch(scraperStub, "/call/queryItems", {
          category: "leaderboard",
          limit: input.limit ?? 10,
        });
        break;
      }

      case "generate_brief": {
        const input = task.input as { topic: string };
        const [tools, news, leaderboard] = await Promise.all([
          agentFetch(scraperStub, "/call/queryItems", { query: input.topic, category: "tool", limit: 5 }),
          agentFetch(scraperStub, "/call/queryItems", { category: "news", limit: 5 }),
          agentFetch(scraperStub, "/call/queryItems", { category: "leaderboard", limit: 5 }),
        ]);

        let aiSummary = "";
        try {
          const aiResult = await env.AI.run("@cf/google/gemma-4-26b-a4b-it" as Parameters<Ai["run"]>[0], {
            messages: [
              {
                role: "system" as const,
                content: "You are an innovation director. Be concise and strategic.",
              },
              {
                role: "user" as const,
                content: `Write a 3-sentence executive summary for an innovation brief about: "${input.topic}"`,
              },
            ],
          });
          aiSummary =
            typeof aiResult === "string"
              ? aiResult
              : (aiResult as { response?: string }).response ?? "";
        } catch {
          aiSummary = `Innovation brief for: ${input.topic}`;
        }

        output = {
          topic: input.topic,
          generatedAt: new Date().toISOString(),
          summary: aiSummary,
          recommendedTools: (tools as ScrapedItem[]).map((t) => ({
            name: t.title,
            source: t.source,
            sourceUrl: t.sourceUrl,
            matchReason: `Tags: ${t.tags?.join(", ")}`,
            toolUrl: t.url,
          })),
          keyNews: (news as ScrapedItem[]).map((n) => ({
            title: n.title,
            source: n.source,
            url: n.url,
          })),
          leaderboardSnapshot: (leaderboard as ScrapedItem[]).slice(0, 5).map((l, i) => ({
            rank: i + 1,
            model: l.title.replace(/^#\d+\s/, ""),
            provider: l.tags?.[0] || "Unknown",
            score: l.summary?.match(/Score: ([^\s·]+)/)?.[1] || "N/A",
          })),
        };
        break;
      }

      default:
        throw new Error(`Unknown skill: ${task.skill}`);
    }

    const completed = await updateTask(kv, task.sessionId, {
      status: "completed",
      output,
      completedAt: new Date().toISOString(),
    });

    if (pushConfig) await deliverWebhook(pushConfig, completed, "task-completed");
  } catch (err) {
    const failed = await updateTask(kv, task.sessionId, {
      status: "failed",
      error: {
        code: 500,
        message: err instanceof Error ? err.message : "Internal error",
      },
    });
    if (pushConfig) await deliverWebhook(pushConfig, failed, "task-error");
  }
}

/**
 * Create a Server-Sent Events stream that polls KV until the task
 * completes (or times out after 60 seconds).
 */
export function streamTaskUpdates(
  sessionId: string,
  kv: KVNamespace
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(
            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          )
        );
      };

      const deadline = Date.now() + 60_000; // 60s timeout
      let lastStatus: string | null = null;

      while (Date.now() < deadline) {
        const task = await kv.get(`task:${sessionId}`);
        if (!task) {
          send("task-error", { error: "Task not found", sessionId });
          break;
        }

        const parsed = JSON.parse(task) as A2ATask;

        if (parsed.status !== lastStatus) {
          lastStatus = parsed.status;
          const eventName =
            parsed.status === "completed"
              ? "task-completed"
              : parsed.status === "failed"
              ? "task-error"
              : parsed.status === "running"
              ? "task-started"
              : "progress";
          send(eventName, parsed);
        }

        if (
          parsed.status === "completed" ||
          parsed.status === "failed" ||
          parsed.status === "cancelled"
        ) {
          break;
        }

        // Poll every 500ms
        await new Promise((r) => setTimeout(r, 500));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
