/**
 * Arena.ai model leaderboard scraper.
 *
 * Uses CrawlerAgent (headless Chromium) to render the JS-driven SPA,
 * then parses the fully-rendered HTML table and __NEXT_DATA__ payload.
 *
 * Fallback chain:
 *   1. CrawlerAgent headless render (most reliable)
 *   2. Plain fetch + __NEXT_DATA__ extraction
 *   3. Plain fetch + table regex parsing
 */

import type { Env, ScrapedItem } from "../types";
import { getBrowserHeaders } from "../utils/userAgents";
import { callAgent } from "../utils/agentFetch";
import { createItemId } from "./index";

const ARENA_URL = "https://arena.ai/leaderboard/text";

interface LeaderboardEntry {
  rank: number;
  model: string;
  provider: string;
  score: string;
}

/** Use headless Chromium via CrawlerAgent to render the SPA. */
async function crawlArena(env: Env): Promise<string | null> {
  const stub = env.CRAWLER_AGENT.get(env.CRAWLER_AGENT.idFromName("global"));
  return callAgent<string>(stub, "/call/renderPage", {
    url: ARENA_URL,
    waitFor: "table, [class*='leaderboard'], [class*='ranking']",
    timeout: 25_000,
  });
}

/** Try to extract leaderboard from __NEXT_DATA__ embedded JSON. */
function parseNextData(html: string): LeaderboardEntry[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  try {
    const data = JSON.parse(m[1]);
    return findLeaderboard(data) ?? [];
  } catch {
    return [];
  }
}

/** Parse an HTML table for model rankings. */
function parseTableHtml(html: string): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rank = 1;
  let match: RegExpExecArray | null;

  while ((match = rowPattern.exec(html)) !== null && entries.length < 25) {
    const cells = extractCells(match[1]);
    if (cells.length < 2) continue;
    const modelCell = cells[0] ?? "";
    const scoreCell = cells[cells.length - 1] ?? "";
    if (!modelCell || modelCell.toLowerCase().includes("model")) continue;

    const [provider, ...parts] = modelCell.includes("/")
      ? modelCell.split("/")
      : ["Unknown", modelCell];

    entries.push({
      rank,
      model: (parts.join("/") || modelCell).trim(),
      provider: provider.trim(),
      score: scoreCell.trim(),
    });
    rank++;
  }
  return entries;
}

export async function scrapeArena(env: Env): Promise<ScrapedItem[]> {
  let html: string | null = null;

  // 1. Try headless render via CrawlerAgent
  html = await crawlArena(env);

  // 2. Fallback: plain fetch
  if (!html) {
    try {
      const res = await fetch(ARENA_URL, {
        headers: getBrowserHeaders(ARENA_URL),
        redirect: "follow",
      });
      if (res.ok) html = await res.text();
    } catch {
      // ignore
    }
  }

  if (!html) return [];

  // Parse: __NEXT_DATA__ first, then table regex
  let entries = parseNextData(html);
  if (entries.length === 0) entries = parseTableHtml(html);
  if (entries.length === 0) return [];

  const now = new Date().toISOString();
  return entries.slice(0, 20).map((e) => ({
    id: createItemId("arena", `rank-${e.rank}-${e.model}`),
    source: "arena" as const,
    sourceUrl: ARENA_URL,
    title: `#${e.rank} ${e.model}`,
    summary: `${e.provider} · Score: ${e.score} · Rank #${e.rank} on Arena.ai leaderboard`,
    url: ARENA_URL,
    category: "leaderboard" as const,
    tags: [e.provider, "AI Model", "Leaderboard"],
    publishedAt: now,
    scrapedAt: now,
  }));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const p = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = p.exec(rowHtml)) !== null) {
    cells.push(m[1].replace(/<[^>]+>/g, "").trim());
  }
  return cells;
}

function findLeaderboard(obj: unknown): LeaderboardEntry[] | null {
  if (!obj || typeof obj !== "object") return null;
  for (const val of Object.values(obj as Record<string, unknown>)) {
    if (Array.isArray(val) && val.length > 0) {
      const first = val[0];
      if (
        first &&
        typeof first === "object" &&
        ("model" in first || "name" in first || "elo" in first || "score" in first)
      ) {
        return (val as Record<string, unknown>[]).slice(0, 20).map((item, i) => ({
          rank: (item.rank as number) || i + 1,
          model: String(item.model || item.name || `Model ${i + 1}`),
          provider: String(item.provider || item.organization || "Unknown"),
          score: String(item.elo || item.score || item.rating || "N/A"),
        }));
      }
    }
    const nested = findLeaderboard(val);
    if (nested) return nested;
  }
  return null;
}
