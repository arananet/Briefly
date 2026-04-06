/**
 * Futurepedia.io scraper.
 *
 * Uses CrawlerAgent (headless Chromium) to render the JS-driven SPA,
 * then parses JSON-LD structured data and tool card HTML patterns.
 *
 * Fallback chain:
 *   1. CrawlerAgent headless render (most reliable for JS SPAs)
 *   2. Plain fetch + JSON-LD / HTML pattern extraction
 *   3. Sitemap-based URL extraction
 */

import type { Env, ScrapedItem } from "../types";
import { getBrowserHeaders } from "../utils/userAgents";
import { callAgent } from "../utils/agentFetch";
import { truncate, stripHtml } from "../utils/htmlParser";
import { createItemId } from "./index";

const BASE_URL = "https://futurepedia.io";

interface ToolEntry {
  title: string;
  description: string;
  url: string;
  tags: string[];
}

/** Use headless Chromium via CrawlerAgent to render the SPA. */
async function crawlFuturepedia(env: Env): Promise<string | null> {
  const stub = env.CRAWLER_AGENT.get(env.CRAWLER_AGENT.idFromName("global"));
  return callAgent<string>(stub, "/call/renderPage", {
    url: BASE_URL,
    waitFor: "[class*='tool'], article, .card, [data-testid]",
    timeout: 25_000,
  });
}

/** Parse tools from fully-rendered HTML. */
function parseToolsFromHtml(html: string): ToolEntry[] {
  const tools: ToolEntry[] = [];

  // Try JSON-LD first (structured data)
  const jsonLdMatches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const match of jsonLdMatches) {
    try {
      const data = JSON.parse(match[1]);
      if (Array.isArray(data["@graph"])) {
        for (const item of data["@graph"]) {
          if (item["@type"] === "SoftwareApplication" && item.name) {
            tools.push({
              title: item.name,
              description: item.description || "",
              url: item.url || item["@id"] || BASE_URL,
              tags: item.applicationCategory ? [item.applicationCategory] : ["AI Tool"],
            });
          }
        }
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  if (tools.length > 0) return tools;

  // Fallback: extract tool cards via regex patterns
  const cardPattern =
    /href=["'](\/ai-tools\/[^"']+)["'][^>]*>[\s\S]{0,500}?<[^>]*class[^>]*title[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = cardPattern.exec(html)) !== null && tools.length < 20) {
    const url = `${BASE_URL}${m[1]}`;
    const title = stripHtml(m[2]).trim();
    if (title && title.length > 2) {
      tools.push({ title, description: "", url, tags: ["AI Tool"] });
    }
  }

  return tools;
}

async function scrapeViaSitemap(): Promise<ToolEntry[]> {
  const tools: ToolEntry[] = [];
  const sitemapUrls = [
    `${BASE_URL}/sitemap.xml`,
    `${BASE_URL}/sitemap_index.xml`,
  ];

  for (const sitemapUrl of sitemapUrls) {
    try {
      const res = await fetch(sitemapUrl, {
        headers: getBrowserHeaders(sitemapUrl),
      });
      if (!res.ok) continue;

      const xml = await res.text();
      const urlPattern = /<loc>(https:\/\/futurepedia\.io\/ai-tools\/[^<]+)<\/loc>/gi;
      let m: RegExpExecArray | null;

      while ((m = urlPattern.exec(xml)) !== null && tools.length < 20) {
        const url = m[1];
        const slug = url.split("/").pop() ?? "";
        const title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        tools.push({ title, description: "", url, tags: ["AI Tool"] });
      }

      if (tools.length > 0) break;
    } catch {
      // Try next sitemap
    }
  }

  return tools;
}

export async function scrapeFuturepedia(env: Env): Promise<ScrapedItem[]> {
  let html: string | null = null;

  // 1. Try headless render via CrawlerAgent
  html = await crawlFuturepedia(env);

  // 2. Fallback: plain fetch
  if (!html) {
    try {
      const res = await fetch(BASE_URL, {
        headers: getBrowserHeaders(BASE_URL),
        redirect: "follow",
      });
      if (res.ok) html = await res.text();
    } catch {
      // ignore
    }
  }

  let tools: ToolEntry[] = [];

  if (html) {
    tools = parseToolsFromHtml(html);
  }

  // 3. Last resort: sitemap
  if (tools.length === 0) {
    tools = await scrapeViaSitemap();
  }

  const now = new Date().toISOString();
  return tools.slice(0, 20).map((tool) => ({
    id: createItemId("futurepedia", tool.url),
    source: "futurepedia" as const,
    sourceUrl: BASE_URL,
    title: tool.title,
    summary: truncate(tool.description || `AI tool: ${tool.title}`, 250),
    url: tool.url,
    category: "tool" as const,
    tags: tool.tags.length > 0 ? tool.tags : ["AI Tool"],
    publishedAt: now,
    scrapedAt: now,
  }));
}
