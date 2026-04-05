import React, { useState } from "react";

const EXAMPLE_QUERIES = [
  "AI tools for video production",
  "Automate social media content",
  "Build a chatbot for e-commerce",
  "Image generation for campaigns",
  "AI code review tools",
];

interface SearchHeroProps {
  onSearch: (query: string) => void;
}

export function SearchHero({ onSearch }: SearchHeroProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) onSearch(q);
  };

  return (
    <div className="search-hero">
      <h1 className="search-hero-title">What are you building?</h1>
      <p className="search-hero-subtitle">
        Describe your project and I'll recommend the best AI tools,
        summarize industry trends, and generate a strategic brief — all
        sourced from the latest intelligence.
      </p>

      <form className="search-form" onSubmit={handleSubmit} role="search">
        <div className="search-input-wrap">
          <input
            type="text"
            className="search-input"
            placeholder="e.g. AI tools for a social media agency…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Describe your project"
            autoFocus
            maxLength={500}
          />
          <button
            type="submit"
            className="search-submit"
            aria-label="Search"
            disabled={!query.trim()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </form>

      <div className="search-chips" role="list" aria-label="Example queries">
        {EXAMPLE_QUERIES.map((q) => (
          <button
            key={q}
            className="search-chip"
            role="listitem"
            onClick={() => {
              setQuery(q);
              onSearch(q);
            }}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
