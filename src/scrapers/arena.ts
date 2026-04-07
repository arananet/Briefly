/**
 * AI Model Leaderboard scraper.
 *
 * Fallback chain (most reliable first):
 *   1. CrawlerAgent headless render of Arena.ai (requires BROWSER binding)
 *   2. Plain fetch Arena.ai + __NEXT_DATA__ parse (works if SSR is present)
 *   3. HuggingFace Trending Models API — pure JSON, no JS, always accessible
 *
 * The HuggingFace fallback guarantees leaderboard data is always available,
 * even before the CrawlerAgent is deployed or when Arena.ai blocks CF IPs.
 */

import type { Env, ScrapedItem } from "../types";
import { getBrowserHeaders } from "../utils/userAgents";
import { callAgent } from "../utils/agentFetch";
import { createItemId } from "./index";

const ARENA_URL = "https://arena.ai/leaderboard/text";

// HuggingFace models API — returns JSON without auth, always accessible
const HF_MODELS_API =
  "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=20&filter=text-generation";

interface LeaderboardEntry {
  rank: number;
  model: string;
  provider: string;
  score: string;
  url: string;
}

// ── 1. CrawlerAgent headless render ────────────────────────────────────────

async function crawlArena(env: Env): Promise<string | null> {
  try {
    const stub = env.CRAWLER_AGENT.get(env.CRAWLER_AGENT.idFromName("global"));
    return await callAgent<string>(stub, "/call/renderPage", {
      url: ARENA_URL,
      waitFor: "table, [class*='leaderboard'], [class*='ranking']",
      timeout: 25_000,
    });
  } catch {
    return null;
  }
}

// ── 2. Arena.ai plain fetch + HTML parsing ─────────────────────────────────

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
      url: ARENA_URL,
    });
    rank++;
  }
  return entries;
}

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
          url: ARENA_URL,
        }));
      }
    }
    const nested = findLeaderboard(val);
    if (nested) return nested;
  }
  return null;
}

// ── 3. HuggingFace Trending Models API ────────────────────────────────────
// Returns pure JSON without any JS rendering. Ranks models by trending score.

interface HFModel {
  id?: string;
  modelId?: string;
  downloads?: number;
  likes?: number;
  trendingScore?: number;
  pipeline_tag?: string;
  lastModified?: string;
}

async function scrapeHuggingFaceTrending(): Promise<LeaderboardEntry[]> {
  try {
    const res = await fetch(HF_MODELS_API, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; Briefly/1.0)",
      },
    });

    if (!res.ok) return [];

    const models = await res.json() as HFModel[];
    if (!Array.isArray(models) || models.length === 0) return [];

    return models.slice(0, 20).map((m, i) => {
      const id = m.modelId || m.id || `model-${i}`;
      const [provider, ...rest] = id.includes("/") ? id.split("/") : ["Community", id];
      const modelName = rest.join("/") || id;
      const score = m.trendingScore != null
        ? m.trendingScore.toFixed(1)
        : m.downloads != null
        ? `${(m.downloads / 1000).toFixed(0)}k dl`
        : "N/A";

      return {
        rank: i + 1,
        model: modelName,
        provider,
        score,
        url: `https://huggingface.co/${id}`,
      };
    });
  } catch {
    return [];
  }
}

// ── Main export ─────────────────────────────────────────────────────────────

export async function scrapeArena(env: Env): Promise<ScrapedItem[]> {
  let entries: LeaderboardEntry[] = [];

  // 1. Try CrawlerAgent headless render
  const html = await crawlArena(env);
  if (html) {
    entries = parseNextData(html);
    if (entries.length === 0) entries = parseTableHtml(html);
  }

  // 2. Plain fetch Arena.ai (may work if SSR, often blocked on CF IPs)
  if (entries.length === 0) {
    try {
      const res = await fetch(ARENA_URL, {
        headers: getBrowserHeaders(ARENA_URL),
        redirect: "follow",
      });
      if (res.ok) {
        const fetchedHtml = await res.text();
        entries = parseNextData(fetchedHtml);
        if (entries.length === 0) entries = parseTableHtml(fetchedHtml);
      }
    } catch {
      // ignore
    }
  }

  // 3. Reliable fallback: HuggingFace trending models (always accessible JSON)
  if (entries.length === 0) {
    entries = await scrapeHuggingFaceTrending();
  }

  if (entries.length === 0) return [];

  const now = new Date().toISOString();
  const source = entries[0]?.url?.includes("huggingface")
    ? "Trending on HuggingFace"
    : "Arena.ai";

  return entries.slice(0, 20).map((e) => ({
    id: createItemId("arena", `rank-${e.rank}-${e.model}`),
    source: "arena" as const,
    sourceUrl: e.url?.includes("huggingface") ? "https://huggingface.co" : ARENA_URL,
    title: `#${e.rank} ${e.model}`,
    summary: `${e.provider} · Score: ${e.score} · Rank #${e.rank} on ${source}`,
    url: e.url,
    category: "leaderboard" as const,
    tags: [e.provider, "AI Model", "Leaderboard"],
    publishedAt: now,
    scrapedAt: now,
  }));
}
