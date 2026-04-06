import React, { useState, useEffect, useCallback } from "react";
import { Header } from "./Header";
import { IndustryFeed } from "./IndustryFeed";
import { SearchHero } from "./SearchHero";
import { ChatInterface } from "./ChatInterface";
import type { ScrapedItem } from "../types";

// Stable agent ID for this session (anonymous users share a global instance)
const AGENT_ID = "global";
const FEED_POLL_INTERVAL = 60_000;
const FEED_POLL_FAST = 8_000; // Poll fast while feed is empty

export function App() {
  const [feedItems, setFeedItems] = useState<ScrapedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [chatQuery, setChatQuery] = useState<string | undefined>(undefined);
  const [chatActive, setChatActive] = useState(false);
  const feedItemsRef = React.useRef(feedItems);
  feedItemsRef.current = feedItems;

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/feed?limit=50");
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("application/json")) return;
        const data = (await res.json()) as ScrapedItem[];
        setFeedItems(data);
      }
    } catch {
      // Silently fail — show empty state
    } finally {
      setFeedLoading(false);
    }
  }, []);

  // Trigger an immediate scrape on first load so the ScraperAgent wakes up
  useEffect(() => {
    fetch("/api/scrape", { method: "POST" }).catch(() => {});
  }, []);

  // Initial load + adaptive polling (fast while empty, slow once populated)
  useEffect(() => {
    fetchFeed();
    const tick = () => {
      fetchFeed();
      const delay = feedItemsRef.current.length === 0 ? FEED_POLL_FAST : FEED_POLL_INTERVAL;
      timer = setTimeout(tick, delay);
    };
    let timer = setTimeout(tick, FEED_POLL_FAST);
    return () => clearTimeout(timer);
  }, [fetchFeed]);

  const handleSearch = (query: string) => {
    setChatQuery(query);
    setChatActive(true);
  };

  const handleFeedItemClick = (item: ScrapedItem) => {
    const q = `Tell me more about "${item.title}" from ${item.source}. How could it benefit a creative agency project?`;
    setChatQuery(q);
    setChatActive(true);
  };

  return (
    <div className="app-layout">
      <Header feedCount={feedItems.length} />

      <main className="app-main">
        <IndustryFeed
          items={feedItems}
          loading={feedLoading}
          onItemClick={handleFeedItemClick}
        />

        <section className="chat-panel">
          {chatActive ? (
            <ChatInterface
              key={chatQuery} // remount when query changes
              initialQuery={chatQuery}
              agentId={AGENT_ID}
            />
          ) : (
            <SearchHero onSearch={handleSearch} />
          )}
        </section>
      </main>
    </div>
  );
}
