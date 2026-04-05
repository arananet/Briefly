/**
 * ScraperAgent — Cloudflare Durable Object backed by the Agents SDK.
 * Runs on a 6-hour schedule to refresh data from all sources.
 * Stores results in embedded SQLite; exposes queryItems via @callable.
 */

import { Agent, callable } from "agents";
import type { Env, ScrapedItem } from "../types";
import { scrapeAllSources, filterItems } from "../scrapers/index";

interface ScraperState {
  lastScrapedAt: string | null;
  itemCount: number;
}

export class ScraperAgent extends Agent<Env, ScraperState> {
  initialState: ScraperState = {
    lastScrapedAt: null,
    itemCount: 0,
  };

  async onStart() {
    // Create the SQLite table if not present
    this.sql`
      CREATE TABLE IF NOT EXISTS items (
        id         TEXT PRIMARY KEY,
        source     TEXT NOT NULL,
        sourceUrl  TEXT NOT NULL,
        title      TEXT NOT NULL,
        summary    TEXT NOT NULL,
        url        TEXT NOT NULL,
        category   TEXT NOT NULL,
        tags       TEXT NOT NULL,
        publishedAt TEXT NOT NULL,
        scrapedAt  TEXT NOT NULL
      )
    `;

    // Schedule a scrape every 6 hours
    await this.schedule("0 */6 * * *", "scrapeAll", {});

    // Run an immediate scrape if no data yet
    if (!this.state.lastScrapedAt) {
      await this.scrapeAll();
    }
  }

  @callable()
  async scrapeAll(): Promise<{ count: number; scrapedAt: string }> {
    const items = await scrapeAllSources();
    const now = new Date().toISOString();

    for (const item of items) {
      this.sql`
        INSERT OR REPLACE INTO items
          (id, source, sourceUrl, title, summary, url, category, tags, publishedAt, scrapedAt)
        VALUES
          (${item.id}, ${item.source}, ${item.sourceUrl}, ${item.title},
           ${item.summary}, ${item.url}, ${item.category},
           ${JSON.stringify(item.tags)}, ${item.publishedAt}, ${item.scrapedAt})
      `;
    }

    this.setState({ lastScrapedAt: now, itemCount: items.length });
    return { count: items.length, scrapedAt: now };
  }

  @callable()
  async queryItems(opts: {
    query?: string;
    category?: string;
    source?: string;
    limit?: number;
  }): Promise<ScrapedItem[]> {
    const rows = this.sql<{
      id: string;
      source: string;
      sourceUrl: string;
      title: string;
      summary: string;
      url: string;
      category: string;
      tags: string;
      publishedAt: string;
      scrapedAt: string;
    }>`SELECT * FROM items ORDER BY scrapedAt DESC LIMIT 500`;

    const items: ScrapedItem[] = rows.map((r) => ({
      ...r,
      source: r.source as ScrapedItem["source"],
      category: r.category as ScrapedItem["category"],
      tags: JSON.parse(r.tags) as string[],
    }));

    return filterItems(items, opts);
  }

  @callable()
  async getStatus(): Promise<ScraperState> {
    return this.state;
  }
}
