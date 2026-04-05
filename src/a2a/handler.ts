/**
 * A2A Protocol HTTP route handler (Hono sub-router).
 * Mount at /a2a in server.ts via: app.route("/a2a", a2aRouter)
 *
 * Routes:
 *   POST   /a2a/tasks           Create a task (202 or SSE stream)
 *   GET    /a2a/tasks/:id       Poll task status
 *   GET    /a2a/tasks/:id/stream SSE stream for task
 *   DELETE /a2a/tasks/:id       Cancel task
 */

import { Hono } from "hono";
import type { Env, A2APushConfig } from "../types";
import {
  createTask,
  getTask,
  cancelTask,
  executeSkill,
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
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const message = (body as Record<string, unknown>)?.message as Record<
    string,
    unknown
  >;

  const skill = message?.skill as string | undefined;
  const input = message?.input;
  const pushNotificationConfig = message?.pushNotificationConfig as
    | A2APushConfig
    | undefined;

  // Validate skill
  if (!skill || !VALID_SKILLS.includes(skill as (typeof VALID_SKILLS)[number])) {
    return c.json(
      {
        error: "Unknown skill",
        validSkills: VALID_SKILLS,
      },
      400
    );
  }

  if (input === undefined || input === null) {
    return c.json({ error: "input is required" }, 400);
  }

  // Sanitize webhook URL (must be HTTPS)
  if (
    pushNotificationConfig?.url &&
    !pushNotificationConfig.url.startsWith("https://")
  ) {
    return c.json({ error: "pushNotificationConfig.url must use HTTPS" }, 400);
  }

  const task = await createTask(c.env.A2A_TASKS, skill, input);

  // Execute skill asynchronously — don't block the response
  c.executionCtx.waitUntil(
    executeSkill(task, c.env, pushNotificationConfig)
  );

  // If client accepts SSE, stream updates inline
  const acceptsSSE = c.req.header("Accept")?.includes("text/event-stream");
  if (acceptsSSE) {
    return streamTaskUpdates(task.sessionId, c.env.A2A_TASKS);
  }

  // Otherwise return 202 Accepted with the task object
  return c.json(task, 202);
});

// ── GET /a2a/tasks/:id ─────────────────────────────────────────────────────
a2aRouter.get("/tasks/:id", async (c) => {
  const task = await getTask(c.env.A2A_TASKS, c.req.param("id"));
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }
  return c.json(task);
});

// ── GET /a2a/tasks/:id/stream ──────────────────────────────────────────────
a2aRouter.get("/tasks/:id/stream", async (c) => {
  const task = await getTask(c.env.A2A_TASKS, c.req.param("id"));
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }
  return streamTaskUpdates(c.req.param("id"), c.env.A2A_TASKS);
});

// ── DELETE /a2a/tasks/:id ──────────────────────────────────────────────────
a2aRouter.delete("/tasks/:id", async (c) => {
  const task = await getTask(c.env.A2A_TASKS, c.req.param("id"));
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }
  await cancelTask(c.env.A2A_TASKS, c.req.param("id"));
  return new Response(null, { status: 204 });
});
