/**
 * A2A Protocol HTTP route handler (Hono sub-router).
 * Mount at /a2a in server.ts via: app.route("/a2a", a2aRouter)
 *
 * Routes:
 *   POST   /a2a/tasks            Create a task (202 async or 200 inline)
 *   GET    /a2a/tasks/:id        Poll task status
 *   GET    /a2a/tasks/:id/stream SSE stream for task
 *   DELETE /a2a/tasks/:id        Cancel task
 *
 * Resilience: if KV is unavailable, skills execute synchronously and the
 * result is returned inline in the POST response (no polling needed).
 * The handler ALWAYS returns JSON — never lets exceptions surface as HTML.
 */

import { Hono } from "hono";
import type { Env, A2ATask, A2APushConfig } from "../types";
import {
  createTask,
  getTask,
  cancelTask,
  executeSkill,
  computeSkillOutput,
  streamTaskUpdates,
} from "./taskManager";

export const a2aRouter = new Hono<{ Bindings: Env }>();

const VALID_SKILLS = [
  "search_tools",
  "industry_summary",
  "generate_brief",
  "model_leaderboard",
] as const;

// ── POST /a2a/tasks ────────────────────────────────────────────────────────
a2aRouter.post("/tasks", async (c) => {
  // Top-level catch: always return JSON, never HTML
  try {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const b = body as Record<string, unknown>;

    // Support two input formats:
    //   1. Custom: { message: { skill, input } }
    //   2. A2A spec parts: { skill, message: { role, parts: [{ text }] } }
    const skill = (b?.skill ?? (b?.message as Record<string, unknown>)?.skill) as string | undefined;
    const message = b?.message as Record<string, unknown> | undefined;

    // Extract text from A2A parts format for use as query
    const partText = (() => {
      const parts = message?.parts as Array<Record<string, unknown>> | undefined;
      return parts?.[0]?.text as string | undefined;
    })();

    // Merge structured input with parts-format text
    const structuredInput = (message?.input ?? {}) as Record<string, unknown>;
    const input = partText
      ? { ...structuredInput, query: partText, topic: partText }
      : structuredInput;

    const pushNotificationConfig = message?.pushNotificationConfig as A2APushConfig | undefined;

    if (!skill || !VALID_SKILLS.includes(skill as (typeof VALID_SKILLS)[number])) {
      return c.json({ error: "Unknown skill", validSkills: VALID_SKILLS }, 400);
    }

    if (pushNotificationConfig?.url && !pushNotificationConfig.url.startsWith("https://")) {
      return c.json({ error: "pushNotificationConfig.url must use HTTPS" }, 400);
    }

    const safeInput = input ?? {};
    const acceptsSSE = c.req.header("Accept")?.includes("text/event-stream");

    // ── Try KV-backed async path ─────────────────────────────────────────
    try {
      const task = await createTask(c.env.A2A_TASKS, skill, safeInput);

      c.executionCtx.waitUntil(
        executeSkill(task, c.env, pushNotificationConfig)
      );

      if (acceptsSSE) {
        return streamTaskUpdates(task.sessionId, c.env.A2A_TASKS);
      }

      return c.json(task, 202);

    } catch {
      // ── KV unavailable — execute synchronously, return inline ────────
      const now = new Date().toISOString();
      const sessionId = crypto.randomUUID();

      let output: unknown = null;
      let status: A2ATask["status"] = "completed";
      let error: A2ATask["error"] = null;

      try {
        output = await computeSkillOutput(skill, safeInput, c.env);
      } catch (execErr) {
        status = "failed";
        error = {
          code: 500,
          message: execErr instanceof Error ? execErr.message : "Skill execution failed",
        };
      }

      const inlineTask: A2ATask = {
        sessionId,
        skill,
        status,
        input: safeInput,
        output,
        error,
        artifacts: [],
        createdAt: now,
        updatedAt: now,
        completedAt: status === "completed" ? now : undefined,
      };

      return c.json(inlineTask, status === "completed" ? 200 : 500);
    }

  } catch (err) {
    // Absolute last resort — should never reach here
    return c.json({
      error: "Unexpected error",
      message: err instanceof Error ? err.message : "Internal server error",
    }, 500);
  }
});

// ── GET /a2a/tasks/:id ─────────────────────────────────────────────────────
a2aRouter.get("/tasks/:id", async (c) => {
  try {
    const task = await getTask(c.env.A2A_TASKS, c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    return c.json(task);
  } catch {
    return c.json({ error: "Task lookup unavailable" }, 503);
  }
});

// ── GET /a2a/tasks/:id/stream ──────────────────────────────────────────────
a2aRouter.get("/tasks/:id/stream", async (c) => {
  try {
    const task = await getTask(c.env.A2A_TASKS, c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    return streamTaskUpdates(c.req.param("id"), c.env.A2A_TASKS);
  } catch {
    return c.json({ error: "Streaming unavailable" }, 503);
  }
});

// ── DELETE /a2a/tasks/:id ──────────────────────────────────────────────────
a2aRouter.delete("/tasks/:id", async (c) => {
  try {
    const task = await getTask(c.env.A2A_TASKS, c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    await cancelTask(c.env.A2A_TASKS, c.req.param("id"));
    return new Response(null, { status: 204 });
  } catch {
    return c.json({ error: "Task cancellation unavailable" }, 503);
  }
});
