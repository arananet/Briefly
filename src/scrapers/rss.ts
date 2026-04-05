/**
 * RSS/Atom feed scrapers for newsletter sources.
 * Tries multiple feed URL patterns with browser header simulation.
 */

import { ScrapedItem, SourceId } from "../types";
import { getApiHeaders } from "../utils/userAgents";
import { parseRssXml, truncate } from "../utils/htmlParser";
import { createItemId } from "./index";

const FEED_URLS: Record<string, string[]> = {
  therundown: [
    "https://www.therundown.ai/feed",
    "https://www.therundown.ai/rss",
    "https://www.therundown.ai/feed.xml",
    "https://www.therundown.ai/api/rss",
  ],
  theneuron: [
    "https://theneurondaily.com/feed",
    "https://theneurondaily.com/rss",
    "https://theneurondaily.com/feed.xml",
    "https://theneurondaily.com/rss.xml",
  ],
};

async function tryFeedUrls(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: getApiHeaders(url),
        redirect: "follow",
      });
      if (response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        if (
          contentType.includes("xml") ||
          contentType.includes("rss") ||
          contentType.includes("atom") ||
          contentType.includes("text")
        ) {
          return await response.text();
        }
      }
    } catch {
      // Try next URL
    }
  }
  return null;
}

async function scrapeRssSource(
  source: SourceId,
  sourceUrl: string,
  feedUrls: string[]
): Promise<ScrapedItem[]> {
  const xml = await tryFeedUrls(feedUrls);
  if (!xml) return [];

  const parsed = parseRssXml(xml);
  const now = new Date().toISOString();

  return parsed.slice(0, 15).map((item) => ({
    id: createItemId(source, item.link),
    source,
    sourceUrl,
    title: item.title,
    summary: truncate(item.description || item.title, 250),
    url: item.link,
    category: "news" as const,
    tags: ["AI", "news"],
    publishedAt: item.pubDate || now,
    scrapedAt: now,
  }));
}

export async function scrapeTheRundown(): Promise<ScrapedItem[]> {
  return scrapeRssSource(
    "therundown",
    "https://www.therundown.ai",
    FEED_URLS.therundown
  );
}

export async function scrapeTheNeuron(): Promise<ScrapedItem[]> {
  return scrapeRssSource(
    "theneuron",
    "https://theneurondaily.com",
    FEED_URLS.theneuron
  );
}
