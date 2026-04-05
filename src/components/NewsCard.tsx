import React from "react";
import type { ScrapedItem } from "../types";

const CATEGORY_ICONS: Record<string, string> = {
  tool: "🔧",
  news: "📰",
  leaderboard: "🏆",
};

interface NewsCardProps {
  item: ScrapedItem;
  onClick?: () => void;
}

export function NewsCard({ item, onClick }: NewsCardProps) {
  const date = new Date(item.publishedAt);
  const isToday = date.toDateString() === new Date().toDateString();
  const dateLabel = isToday
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <article className="news-card glass-card" onClick={onClick} role="button" tabIndex={0}>
      <div className="news-card-meta">
        <span className={`source-pill ${item.source}`}>
          {item.source === "therundown"
            ? "The Rundown"
            : item.source === "theneuron"
            ? "The Neuron"
            : item.source === "futurepedia"
            ? "Futurepedia"
            : item.source === "producthunt"
            ? "Product Hunt"
            : "Arena.ai"}
        </span>
        <span className="category-icon" title={item.category}>
          {CATEGORY_ICONS[item.category]}
        </span>
        <span className="news-card-date">{dateLabel}</span>
      </div>

      <h3 className="news-card-title">{item.title}</h3>
      <p className="news-card-summary">{item.summary}</p>

      <div className="news-card-footer">
        <div className="news-card-tags">
          {item.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="news-card-link"
          onClick={(e) => e.stopPropagation()}
        >
          View →
        </a>
      </div>
    </article>
  );
}
