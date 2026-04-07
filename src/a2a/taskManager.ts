/**
 * A2A Task lifecycle manager backed by Cloudflare KV.
 * Tasks expire after 24 hours automatically.
 *
 * Resilient design: computeSkillOutput is exported so the HTTP handler
 * can fall back to synchronous execution when KV is unavailable.
 */

import type { A2ATask, A2ATaskStatus, A2APushConfig, Env, ScrapedItem } from "../types";
import { scrapeArena } from "../scrapers/arena";
import { scrapeFuturepedia } from "../scrapers/futurepedia";
import { scrapeProductHunt } from "../scrapers/producthunt";
import { scrapeTheRundown, scrapeTheNeuron } from "../scrapers/rss";
import { filterItems } from "../scrapers/index";

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
 * Core skill computation — no KV, just returns the output.
 * Called by executeSkill (with KV) and the inline fallback (without KV).
 */
export async function computeSkillOutput(
  skill: string,
  input: unknown,
  env: Env
): Promise<unknown> {
  switch (skill) {
    case "search_tools": {
      const inp = input as { query?: string; limit?: number };
      const [futurepedia, producthunt] = await Promise.all([
        scrapeFuturepedia(env).catch(() => [] as ScrapedItem[]),
        scrapeProductHunt().catch(() => [] as ScrapedItem[]),
      ]);
      const all = [...futurepedia, ...producthunt];
      const results = filterItems(all, { query: inp.query, limit: inp.limit ?? 10 });
      return results.length > 0
        ? results
        : { message: "No tools found. Both Futurepedia and Product Hunt were scraped live." };
    }

    case "industry_summary": {
      const inp = input as { source?: string; limit?: number };
      const [rundown, neuron] = await Promise.all([
        scrapeTheRundown().catch(() => [] as ScrapedItem[]),
        scrapeTheNeuron().catch(() => [] as ScrapedItem[]),
      ]);
      const all = [...rundown, ...neuron];
      const filtered = inp.source && inp.source !== "all"
        ? all.filter((i) => i.source === inp.source)
        : all;
      return filtered.slice(0, inp.limit ?? 10).length > 0
        ? filtered.slice(0, inp.limit ?? 10)
        : { message: "No news fetched — RSS feeds may be temporarily unavailable." };
    }

    case "model_leaderboard": {
      const inp = input as { limit?: number };
      const results = await scrapeArena(env).catch(() => [] as ScrapedItem[]);
      return results.slice(0, inp.limit ?? 10).length > 0
        ? results.slice(0, inp.limit ?? 10)
        : { message: "Leaderboard sources unreachable — please try again." };
    }

    case "generate_brief": {
      const inp = input as { topic?: string; query?: string };
      const topic = inp.topic || inp.query || "AI industry";
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

      let aiSummary = "";
      try {
        const aiResult = await env.AI.run("@cf/google/gemma-4-26b-a4b-it" as Parameters<Ai["run"]>[0], {
          messages: [
            { role: "system" as const, content: "You are an innovation director. Be concise and strategic." },
            { role: "user" as const, content: `Write a 3-sentence executive summary for an innovation brief about: "${topic}"` },
          ],
        } as Parameters<Ai["run"]>[1]);
        aiSummary =
          typeof aiResult === "string"
            ? aiResult
            : (aiResult as { response?: string }).response ?? "";
      } catch {
        aiSummary = `Innovation brief for: ${topic}`;
      }

      return {
        topic,
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
    }

    default:
      throw new Error(`Unknown skill: ${skill}`);
  }
}

/**
 * Deliver a push notification to the client's webhook URL.
 */
export async function deliverWebhook(
  config: A2APushConfig,
  task: A2ATask,
  event: "task-started" | "progress" | "task-completed" | "task-error"
): Promise<void> {
  if (!config.url.startsWith("https://")) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Briefly-A2A/1.0",
  };
  if (config.token) headers["Authorization"] = `Bearer ${config.token}`;

  try {
    await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: task.sessionId, event, task, timestamp: new Date().toISOString() }),
    });
  } catch {
    // Webhook delivery failure is non-fatal
  }
}

/**
 * Execute a named skill with KV state tracking.
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

    const output = await computeSkillOutput(task.skill, task.input, env);

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
 * SSE stream that polls KV until the task completes (60s timeout).
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
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      const deadline = Date.now() + 60_000;
      let lastStatus: string | null = null;

      while (Date.now() < deadline) {
        const raw = await kv.get(`task:${sessionId}`);
        if (!raw) {
          send("task-error", { error: "Task not found", sessionId });
          break;
        }

        const parsed = JSON.parse(raw) as A2ATask;

        if (parsed.status !== lastStatus) {
          lastStatus = parsed.status;
          const eventName =
            parsed.status === "completed" ? "task-completed" :
            parsed.status === "failed" ? "task-error" :
            parsed.status === "running" ? "task-started" : "progress";
          send(eventName, parsed);
        }

        if (["completed", "failed", "cancelled"].includes(parsed.status)) break;

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
