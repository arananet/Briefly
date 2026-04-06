// ─── Scraping ────────────────────────────────────────────────────────────────

export type SourceId =
  | "therundown"
  | "theneuron"
  | "futurepedia"
  | "producthunt"
  | "arena";

export type ItemCategory = "tool" | "news" | "leaderboard";

export interface ScrapedItem {
  id: string;
  source: SourceId;
  sourceUrl: string;
  title: string;
  summary: string;
  url: string;
  category: ItemCategory;
  tags: string[];
  publishedAt: string;
  scrapedAt: string;
}

// ─── Cloudflare Env ───────────────────────────────────────────────────────────

export interface Env {
  AI: Ai;
  BRIEFLY_AGENT: DurableObjectNamespace;
  SCRAPER_AGENT: DurableObjectNamespace;
  A2A_TASKS: KVNamespace;
  ASSETS: Fetcher;
}

// ─── A2A Protocol ─────────────────────────────────────────────────────────────

export type A2ATaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface A2AArtifact {
  id: string;
  type: "text" | "json" | "file" | "link";
  mimeType: string;
  data: unknown;
}

export interface A2ATask {
  sessionId: string;
  skill: string;
  status: A2ATaskStatus;
  input: unknown;
  output: unknown | null;
  error: { code: number; message: string } | null;
  artifacts: A2AArtifact[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface A2APushConfig {
  url: string;
  token?: string;
}

// ─── Chat / Brief ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface BriefSection {
  title: string;
  content: string;
}

export interface GeneratedBrief {
  topic: string;
  generatedAt: string;
  summary: string;
  recommendedTools: Array<{
    name: string;
    source: string;
    sourceUrl: string;
    matchReason: string;
    toolUrl: string;
  }>;
  keyNews: Array<{
    title: string;
    source: string;
    url: string;
  }>;
  leaderboardSnapshot: Array<{
    rank: number;
    model: string;
    provider: string;
    score: string;
  }>;
}
