/**
 * Scraper orchestrator — runs all source scrapers in parallel,
 * deduplicates by URL, and returns a combined ScrapedItem[].
 */

import type { Env, ScrapedItem } from "../types";
import { scrapeTheRundown, scrapeTheNeuron } from "./rss";
import { scrapeFuturepedia } from "./futurepedia";
import { scrapeProductHunt } from "./producthunt";
import { scrapeArena } from "./arena";

/**
 * Deterministic ID from source name + URL.
 * Used as the SQLite primary key (INSERT OR REPLACE deduplicates).
 */
export function createItemId(source: string, url: string): string {
  // Simple stable hash — enough for deduplication
  const raw = `${source}::${url}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit int
  }
  return `${source}_${Math.abs(hash).toString(36)}`;
}

/**
 * Run all scrapers concurrently. Failures in individual scrapers
 * do not affect others (Promise.allSettled).
 */
export async function scrapeAllSources(env: Env): Promise<ScrapedItem[]> {
  const results = await Promise.allSettled([
    scrapeTheRundown(),
    scrapeTheNeuron(),
    scrapeFuturepedia(env),
    scrapeProductHunt(),
    scrapeArena(env),
  ]);

  const all: ScrapedItem[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const item of result.value) {
        // Deduplicate by canonical URL
        const key = item.url.toLowerCase().replace(/\/$/, "");
        if (!seen.has(key)) {
          seen.add(key);
          all.push(item);
        }
      }
    }
  }

  // Sort: newest first
  return all.sort(
    (a, b) =>
      new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime()
  );
}

/** Filter helper used by agents and A2A handler */
export function filterItems(
  items: ScrapedItem[],
  opts: {
    query?: string;
    category?: string;
    source?: string;
    limit?: number;
  }
): ScrapedItem[] {
  let filtered = items;

  if (opts.query) {
    const q = opts.query.toLowerCase();
    filtered = filtered.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.summary.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  if (opts.category) {
    filtered = filtered.filter((i) => i.category === opts.category);
  }

  if (opts.source) {
    filtered = filtered.filter((i) => i.source === opts.source);
  }

  return filtered.slice(0, opts.limit ?? 20);
}
