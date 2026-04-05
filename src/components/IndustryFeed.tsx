import React, { useState } from "react";
import type { ScrapedItem } from "../types";
import { NewsCard } from "./NewsCard";

type FilterTab = "all" | "news" | "tool" | "leaderboard" | "therundown" | "theneuron" | "futurepedia" | "producthunt" | "arena";

const TABS: Array<{ id: FilterTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "news", label: "News" },
  { id: "tool", label: "Tools" },
  { id: "leaderboard", label: "Rankings" },
  { id: "therundown", label: "Rundown" },
  { id: "theneuron", label: "Neuron" },
  { id: "futurepedia", label: "Futurepedia" },
  { id: "producthunt", label: "PH" },
  { id: "arena", label: "Arena" },
];

interface IndustryFeedProps {
  items: ScrapedItem[];
  loading: boolean;
  onItemClick?: (item: ScrapedItem) => void;
}

export function IndustryFeed({ items, loading, onItemClick }: IndustryFeedProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const filtered = items.filter((item) => {
    if (activeTab === "all") return true;
    if (["news", "tool", "leaderboard"].includes(activeTab)) {
      return item.category === activeTab;
    }
    return item.source === activeTab;
  });

  return (
    <aside className="feed-panel">
      <div className="feed-header">
        <p className="feed-title">Industry Feed</p>
        <div className="feed-tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`tab-btn${activeTab === tab.id ? " active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="feed-list" role="feed" aria-label="Industry news and tools">
        {loading && items.length === 0 ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="news-card glass-card">
                <div className="skeleton" style={{ height: 12, width: "60%", marginBottom: 10 }} />
                <div className="skeleton" style={{ height: 16, marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 12, width: "80%" }} />
              </div>
            ))}
          </>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📡</div>
            <p className="empty-state-text">
              {items.length === 0
                ? "Scraping sources… check back in a moment."
                : "No items match this filter."}
            </p>
          </div>
        ) : (
          filtered.map((item) => (
            <NewsCard
              key={item.id}
              item={item}
              onClick={() => onItemClick?.(item)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
