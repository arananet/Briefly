/**
 * Arena.ai leaderboard scraper using HTMLRewriter.
 * Extracts model rankings from the text leaderboard page.
 */

import { ScrapedItem } from "../types";
import { getBrowserHeaders } from "../utils/userAgents";
import { createItemId } from "./index";

const ARENA_URL = "https://arena.ai/leaderboard/text";

interface LeaderboardEntry {
  rank: number;
  model: string;
  provider: string;
  score: string;
}

export async function scrapeArena(): Promise<ScrapedItem[]> {
  const entries: LeaderboardEntry[] = [];

  try {
    const response = await fetch(ARENA_URL, {
      headers: getBrowserHeaders(ARENA_URL),
      redirect: "follow",
    });

    if (!response.ok) return [];

    const html = await response.text();

    // Try to extract JSON data embedded in Next.js __NEXT_DATA__ or similar
    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        // Traverse for leaderboard data
        const leaderboard = findLeaderboard(nextData);
        if (leaderboard && leaderboard.length > 0) {
          entries.push(...leaderboard);
        }
      } catch {
        // Parse failed — fall through to HTML extraction
      }
    }

    // Fallback: parse table rows from HTML
    if (entries.length === 0) {
      const rowPattern =
        /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rank = 1;
      let match: RegExpExecArray | null;

      while (
        (match = rowPattern.exec(html)) !== null &&
        entries.length < 20
      ) {
        const cells = extractTableCells(match[1]);
        if (cells.length >= 2) {
          const modelCell = cells[0] || "";
          const scoreCell = cells[cells.length - 1] || "";
          if (modelCell && !modelCell.toLowerCase().includes("model")) {
            const [provider, ...modelParts] = modelCell.includes("/")
              ? modelCell.split("/")
              : ["Unknown", modelCell];
            entries.push({
              rank,
              model: (modelParts.join("/") || modelCell).trim(),
              provider: provider.trim(),
              score: scoreCell.trim(),
            });
            rank++;
          }
        }
      }
    }
  } catch {
    return [];
  }

  if (entries.length === 0) return [];

  const now = new Date().toISOString();

  return entries.slice(0, 20).map((entry) => ({
    id: createItemId("arena", `rank-${entry.rank}-${entry.model}`),
    source: "arena" as const,
    sourceUrl: ARENA_URL,
    title: `#${entry.rank} ${entry.model}`,
    summary: `${entry.provider} · Score: ${entry.score} · Rank #${entry.rank} on Arena.ai text leaderboard`,
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

  // Look for arrays that look like leaderboard data
  for (const val of Object.values(obj as Record<string, unknown>)) {
    if (Array.isArray(val) && val.length > 0) {
      const first = val[0];
      if (
        first &&
        typeof first === "object" &&
        ("model" in first || "name" in first || "elo" in first || "score" in first)
      ) {
        return val.slice(0, 20).map((item: Record<string, unknown>, i: number) => ({
          rank: (item.rank as number) || i + 1,
          model:
            (item.model as string) ||
            (item.name as string) ||
            `Model ${i + 1}`,
          provider:
            (item.provider as string) ||
            (item.organization as string) ||
            "Unknown",
          score:
            String(item.elo || item.score || item.rating || "N/A"),
        }));
      }
    }
    const nested = findLeaderboard(val);
    if (nested) return nested;
  }
  return null;
}
