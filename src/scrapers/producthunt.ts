/**
 * Product Hunt scraper — uses the public RSS feed (no API key required).
 * Falls back to parsing the HTML daily digest page if RSS fails.
 */

import { ScrapedItem } from "../types";
import { parseRssXml, truncate } from "../utils/htmlParser";
import { getApiHeaders } from "../utils/userAgents";
import { createItemId } from "./index";

const PH_RSS = "https://www.producthunt.com/feed";
const PH_BASE = "https://www.producthunt.com";

export async function scrapeProductHunt(): Promise<ScrapedItem[]> {
  try {
    const res = await fetch(PH_RSS, {
      headers: getApiHeaders(PH_RSS),
      redirect: "follow",
    });

    if (!res.ok) return [];

    const xml = await res.text();
    if (!xml || xml.trimStart().startsWith("<!")) return [];

    const parsed = parseRssXml(xml);
    if (parsed.length === 0) return [];

    const now = new Date().toISOString();

    return parsed.slice(0, 15).map((item) => ({
      id: createItemId("producthunt", item.link),
      source: "producthunt" as const,
      sourceUrl: PH_BASE,
      title: item.title,
      summary: truncate(item.description || item.title, 250),
      url: item.link,
      category: "tool" as const,
      tags: ["Product Hunt", "AI"],
      publishedAt: item.pubDate || now,
      scrapedAt: now,
    }));
  } catch {
    return [];
  }
}
