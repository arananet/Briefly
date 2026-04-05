/**
 * Product Hunt scraper using their public GraphQL API.
 * No authentication required for reading public posts.
 */

import { ScrapedItem } from "../types";
import { truncate } from "../utils/htmlParser";
import { createItemId } from "./index";

const PH_API = "https://api.producthunt.com/v2/api/graphql";

const QUERY = `
query TodaysPosts($after: DateTime!) {
  posts(first: 20, order: VOTES, postedAfter: $after) {
    edges {
      node {
        id
        name
        tagline
        description
        url
        votesCount
        website
        topics {
          edges {
            node {
              name
            }
          }
        }
        createdAt
      }
    }
  }
}
`;

interface PHNode {
  id: string;
  name: string;
  tagline: string;
  description: string | null;
  url: string;
  website: string | null;
  votesCount: number;
  topics: { edges: Array<{ node: { name: string } }> };
  createdAt: string;
}

export async function scrapeProductHunt(): Promise<ScrapedItem[]> {
  // Fetch posts from the last 48 hours (wider window for reliability)
  const after = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  try {
    const response = await fetch(PH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; BrieflyBot/1.0; +https://briefly.workers.dev)",
        Host: "api.producthunt.com",
      },
      body: JSON.stringify({ query: QUERY, variables: { after } }),
    });

    if (!response.ok) return [];

    const json = (await response.json()) as {
      data?: { posts?: { edges?: Array<{ node: PHNode }> } };
      errors?: unknown[];
    };

    if (!json.data?.posts?.edges) return [];

    const now = new Date().toISOString();

    return json.data.posts.edges
      .filter((e) => e.node)
      .map(({ node }) => {
        const tags = node.topics.edges.map((t) => t.node.name);
        if (tags.length === 0) tags.push("Product");

        return {
          id: createItemId("producthunt", node.url),
          source: "producthunt" as const,
          sourceUrl: "https://producthunt.com",
          title: node.name,
          summary: truncate(
            node.description || node.tagline || node.name,
            250
          ),
          url: node.url,
          category: "tool" as const,
          tags,
          publishedAt: node.createdAt || now,
          scrapedAt: now,
        };
      });
  } catch {
    return [];
  }
}
