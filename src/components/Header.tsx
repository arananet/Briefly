import React from "react";

const SOURCES = [
  { id: "therundown", label: "The Rundown" },
  { id: "theneuron", label: "The Neuron" },
  { id: "futurepedia", label: "Futurepedia" },
  { id: "producthunt", label: "Product Hunt" },
  { id: "arena", label: "Arena.ai" },
];

interface HeaderProps {
  feedCount: number;
}

export function Header({ feedCount }: HeaderProps) {
  return (
    <header className="header">
      <a className="header-logo" href="/" aria-label="Briefly home">
        <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="28" height="28" rx="8" fill="url(#logo-grad)" />
          <path d="M8 9h8a3 3 0 010 6H8V9z" fill="white" fillOpacity="0.9" />
          <path d="M8 15h10a3 3 0 010 6H8v-6z" fill="white" fillOpacity="0.6" />
          <defs>
            <linearGradient id="logo-grad" x1="0" y1="0" x2="28" y2="28">
              <stop stopColor="#667eea" />
              <stop offset="1" stopColor="#764ba2" />
            </linearGradient>
          </defs>
        </svg>
        <span className="logo-text">briefly</span>
      </a>

      <span className="header-tagline">
        Innovation Intelligence · {feedCount > 0 ? `${feedCount} items indexed` : "Indexing sources…"}
      </span>

      <div className="header-right">
        {SOURCES.map((s) => (
          <div key={s.id} className="source-badge">
            <span className="source-dot" />
            {s.label}
          </div>
        ))}
      </div>
    </header>
  );
}
