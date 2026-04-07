/**
 * AI Model Leaderboard scraper.
 *
 * Tries Arena.ai first (headless Chromium via CrawlerAgent, then plain fetch).
 * Falls back to HuggingFace trending models API — pure JSON, always accessible.
 *
 * Validation: Arena.ai data is only accepted when model names look real
 * (not bare numbers from a bot-protection challenge page).
 */

import type { Env, ScrapedItem } from "../types";
import { getBrowserHeaders } from "../utils/userAgents";
import { callAgent } from "../utils/agentFetch";
import { createItemId } from "./index";

const ARENA_URL = "https://arena.ai/leaderboard/text";

// HuggingFace models API — no auth, always returns JSON
const HF_API =
  "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=20&pipeline_tag=text-generation";

interface LeaderboardEntry {
  rank: number;
  model: string;
  provider: string;
  score: string;
  url: string;
  fromHF?: boolean;
}

// ── Validation ─────────────────────────────────────────────────────────────

/** A valid model name has letters, is at least 4 chars, is not just a number. */
function isValidEntry(e: LeaderboardEntry): boolean {
  return e.model.length >= 4 && /[a-zA-Z]/.test(e.model) && !/^\d+$/.test(e.model);
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

// ── 2. Arena.ai HTML parsing ───────────────────────────────────────────────

function parseNextData(html: string): LeaderboardEntry[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  try {
    return findLeaderboard(JSON.parse(m[1])) ?? [];
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
    if (!modelCell || modelCell.toLowerCase() === "model" || modelCell.toLowerCase() === "name") continue;

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

// ── 3. HuggingFace Trending Models — reliable JSON fallback ────────────────

interface HFModel {
  id?: string;
  modelId?: string;
  likes?: number;
  downloads?: number;
  trendingScore?: number;
}

async function scrapeHuggingFace(): Promise<LeaderboardEntry[]> {
  try {
    const res = await fetch(HF_API, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; Briefly/1.0)" },
    });
    if (!res.ok) return [];

    const models = await res.json() as HFModel[];
    if (!Array.isArray(models) || models.length === 0) return [];

    return models
      .map((m, i) => {
        const rawId = (m.modelId || m.id || "").toString();
        if (!rawId || /^\d+$/.test(rawId)) return null; // skip numeric-only IDs

        const slashIdx = rawId.indexOf("/");
        const provider = slashIdx > 0 ? rawId.slice(0, slashIdx) : "Community";
        const modelName = slashIdx > 0 ? rawId.slice(slashIdx + 1) : rawId;

        // Format score: prefer trendingScore, fall back to likes
        const score =
          typeof m.trendingScore === "number" && m.trendingScore > 0
            ? m.trendingScore.toFixed(1)
            : typeof m.likes === "number"
            ? `${m.likes.toLocaleString()} ♥`
            : "N/A";

        return {
          rank: i + 1,
          model: modelName,
          provider,
          score,
          url: `https://huggingface.co/${rawId}`,
          fromHF: true,
        } as LeaderboardEntry;
      })
      .filter((e): e is LeaderboardEntry => e !== null && isValidEntry(e));
  } catch {
    return [];
  }
}

// ── Main export ─────────────────────────────────────────────────────────────

export async function scrapeArena(env: Env): Promise<ScrapedItem[]> {
  let entries: LeaderboardEntry[] = [];

  // 1. CrawlerAgent headless render of Arena.ai
  const crawledHtml = await crawlArena(env);
  if (crawledHtml) {
    entries = parseNextData(crawledHtml);
    if (entries.length === 0) entries = parseTableHtml(crawledHtml);
    // Reject bot-protection garbage: model names must look real
    entries = entries.filter(isValidEntry);
  }

  // 2. Plain fetch Arena.ai (may be blocked by CF bot protection on Worker IPs)
  if (entries.length === 0) {
    try {
      const res = await fetch(ARENA_URL, { headers: getBrowserHeaders(ARENA_URL), redirect: "follow" });
      if (res.ok) {
        const html = await res.text();
        const parsed = parseNextData(html);
        entries = (parsed.length > 0 ? parsed : parseTableHtml(html)).filter(isValidEntry);
      }
    } catch {
      // ignore
    }
  }

  // 3. HuggingFace trending models — always reliable JSON source
  if (entries.length === 0) {
    entries = await scrapeHuggingFace();
  }

  if (entries.length === 0) return [];

  const fromHF = entries[0]?.fromHF === true;
  const sourceLabel = fromHF ? "HuggingFace Trending" : "Arena.ai";
  const sourceUrl = fromHF ? "https://huggingface.co" : ARENA_URL;

  const now = new Date().toISOString();
  return entries.slice(0, 20).map((e) => ({
    id: createItemId("arena", e.fromHF ? `hf-${e.model}` : `arena-${e.rank}-${e.model}`),
    source: "arena" as const,
    sourceUrl,
    title: `#${e.rank} ${e.provider}/${e.model}`,
    summary: `${e.provider} · Score: ${e.score} · Rank #${e.rank} on ${sourceLabel}`,
    url: e.url,
    category: "leaderboard" as const,
    tags: [e.provider, "AI Model", "Leaderboard", sourceLabel],
    publishedAt: now,
    scrapedAt: now,
  }));
}
