/**
 * Model leaderboard scraper.
 *
 * Primary:  Hugging Face Open LLM Leaderboard (public JSON API)
 * Fallback: Arena.ai page HTML parsing
 *
 * Arena.ai's leaderboard page is a JS-rendered SPA and frequently blocks
 * Cloudflare IPs. The HF leaderboard dataset is a reliable public API
 * with no authentication required.
 */

import { ScrapedItem } from "../types";
import { getBrowserHeaders, getApiHeaders } from "../utils/userAgents";
import { createItemId } from "./index";

const ARENA_URL = "https://arena.ai/leaderboard/text";

// Hugging Face Open LLM Leaderboard dataset — publicly accessible JSON
const HF_LEADERBOARD_API =
  "https://huggingface.co/datasets/open-llm-leaderboard/results/resolve/main/results.json";

// Alternative: HF spaces API for the leaderboard
const HF_SPACES_API =
  "https://open-llm-leaderboard-open-llm-leaderboard.hf.space/api/leaderboard";

interface LeaderboardEntry {
  rank: number;
  model: string;
  provider: string;
  score: string;
}

/** Try the HF Open LLM Leaderboard via their dataset API */
async function fetchHFLeaderboard(): Promise<LeaderboardEntry[]> {
  // HF Spaces API for the Open LLM Leaderboard
  try {
    const res = await fetch(HF_SPACES_API, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; BrieflyBot/1.0)",
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];

    return (data as Record<string, unknown>[])
      .slice(0, 20)
      .map((row, i) => {
        const name =
          String(row["model_name"] || row["name"] || row["model"] || `Model ${i + 1}`);
        const score =
          String(row["average"] || row["score"] || row["total"] || row["elo"] || "N/A");
        const org = name.includes("/") ? name.split("/")[0] : "Unknown";
        const modelName = name.includes("/") ? name.split("/").slice(1).join("/") : name;
        return {
          rank: i + 1,
          model: modelName,
          provider: org,
          score,
        };
      });
  } catch {
    return [];
  }
}

/** Fallback: try to parse Arena.ai HTML */
async function fetchArenaHtml(): Promise<LeaderboardEntry[]> {
  try {
    const response = await fetch(ARENA_URL, {
      headers: getBrowserHeaders(ARENA_URL),
      redirect: "follow",
    });

    if (!response.ok) return [];

    const html = await response.text();
    if (html.trimStart().startsWith("<!DOCTYPE") && html.includes("_app")) {
      // SPA shell returned — no useful data
      return [];
    }

    // Try __NEXT_DATA__
    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const entries = findLeaderboard(nextData);
        if (entries && entries.length > 0) return entries;
      } catch {
        // fall through
      }
    }

    // Try table parsing
    const entries: LeaderboardEntry[] = [];
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rank = 1;
    let match: RegExpExecArray | null;
    while ((match = rowPattern.exec(html)) !== null && entries.length < 20) {
      const cells = extractTableCells(match[1]);
      if (cells.length >= 2) {
        const modelCell = cells[0] || "";
        const scoreCell = cells[cells.length - 1] || "";
        if (modelCell && !modelCell.toLowerCase().includes("model")) {
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
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export async function scrapeArena(): Promise<ScrapedItem[]> {
  // Try HF leaderboard first (more reliable), fall back to Arena.ai HTML
  let entries = await fetchHFLeaderboard();
  if (entries.length === 0) {
    entries = await fetchArenaHtml();
  }
  if (entries.length === 0) return [];

  const now = new Date().toISOString();
  return entries.slice(0, 20).map((entry) => ({
    id: createItemId("arena", `rank-${entry.rank}-${entry.model}`),
    source: "arena" as const,
    sourceUrl: ARENA_URL,
    title: `#${entry.rank} ${entry.model}`,
    summary: `${entry.provider} · Score: ${entry.score} · Rank #${entry.rank}`,
    url: ARENA_URL,
    category: "leaderboard" as const,
    tags: [entry.provider, "AI Model", "Leaderboard"],
    publishedAt: now,
    scrapedAt: now,
  }));
}

function extractTableCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;
  while ((match = cellPattern.exec(rowHtml)) !== null) {
    cells.push(match[1].replace(/<[^>]+>/g, "").trim());
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
