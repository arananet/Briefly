/**
 * Futurepedia.io scraper using HTMLRewriter.
 * Falls back to sitemap if HTML scraping yields no results.
 */

import { ScrapedItem } from "../types";
import { getBrowserHeaders } from "../utils/userAgents";
import { truncate, stripHtml } from "../utils/htmlParser";
import { createItemId } from "./index";

const BASE_URL = "https://futurepedia.io";

interface ToolEntry {
  title: string;
  description: string;
  url: string;
  tags: string[];
}

async function scrapeToolsPage(): Promise<ToolEntry[]> {
  const tools: ToolEntry[] = [];

  try {
    const response = await fetch(BASE_URL, {
      headers: getBrowserHeaders(BASE_URL),
      redirect: "follow",
    });

    if (!response.ok) return [];

    // Collect structured data from script tags (JSON-LD)
    const html = await response.text();

    // Try JSON-LD first
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

    // Fallback: extract from common HTML patterns
    if (tools.length === 0) {
      // Extract tool cards via regex patterns common in Next.js apps
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
    }
  } catch {
    // Network error — return empty
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

export async function scrapeFuturepedia(): Promise<ScrapedItem[]> {
  let tools = await scrapeToolsPage();
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
