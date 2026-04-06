import React, { useState, useRef, useEffect, useCallback } from "react";
import type { GeneratedBrief } from "../types";
import { PDFExport } from "./PDFExport";

/** Minimal markdown → React elements (no external library needed) */
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  const inlineMarkdown = (raw: string): React.ReactNode => {
    // Split on bold, italic, inline code, links
    const parts = raw.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
    return parts.map((p, idx) => {
      if (p.startsWith("**") && p.endsWith("**")) return <strong key={idx}>{p.slice(2, -2)}</strong>;
      if (p.startsWith("*") && p.endsWith("*")) return <em key={idx}>{p.slice(1, -1)}</em>;
      if (p.startsWith("`") && p.endsWith("`")) return <code key={idx} style={{ background: "rgba(255,255,255,.08)", padding: "1px 5px", borderRadius: 3, fontSize: "0.9em" }}>{p.slice(1, -1)}</code>;
      const linkMatch = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) return <a key={idx} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" style={{ color: "#7dd3fc", textDecoration: "underline" }}>{linkMatch[1]}</a>;
      return p;
    });
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      elements.push(<h3 key={i} style={{ fontSize: "1em", fontWeight: 700, marginTop: "1.1em", marginBottom: "0.3em" }}>{inlineMarkdown(line.slice(4))}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} style={{ fontSize: "1.1em", fontWeight: 700, marginTop: "1.2em", marginBottom: "0.4em" }}>{inlineMarkdown(line.slice(3))}</h2>);
    } else if (line.startsWith("# ")) {
      elements.push(<h1 key={i} style={{ fontSize: "1.2em", fontWeight: 700, marginTop: "1.3em", marginBottom: "0.4em" }}>{inlineMarkdown(line.slice(2))}</h1>);
    } else if (line.match(/^[*-] /)) {
      // Collect consecutive list items
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[*-] /)) {
        items.push(lines[i].replace(/^[*-] /, ""));
        i++;
      }
      elements.push(<ul key={`ul-${i}`} style={{ margin: "0.4em 0", paddingLeft: "1.4em" }}>{items.map((item, j) => <li key={j} style={{ marginBottom: "0.2em" }}>{inlineMarkdown(item)}</li>)}</ul>);
      continue;
    } else if (line.match(/^\d+\. /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(<ol key={`ol-${i}`} style={{ margin: "0.4em 0", paddingLeft: "1.4em" }}>{items.map((item, j) => <li key={j} style={{ marginBottom: "0.2em" }}>{inlineMarkdown(item)}</li>)}</ol>);
      continue;
    } else if (line === "---" || line === "***") {
      elements.push(<hr key={i} style={{ border: "none", borderTop: "1px solid rgba(255,255,255,.12)", margin: "1em 0" }} />);
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: "0.5em" }} />);
    } else {
      elements.push(<p key={i} style={{ margin: "0.15em 0" }}>{inlineMarkdown(line)}</p>);
    }
    i++;
  }
  return <div style={{ lineHeight: 1.6 }}>{elements}</div>;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface ChatInterfaceProps {
  initialQuery?: string;
  agentId: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="action-btn"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }).catch(() => {});
      }}
      title="Copy to clipboard"
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function parseBriefFromContent(content: string): GeneratedBrief | null {
  try {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ||
      content.match(/(\{[\s\S]*"topic"[\s\S]*"generatedAt"[\s\S]*\})/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]) as GeneratedBrief;
    }
  } catch {
    // Not a brief JSON
  }
  return null;
}

export function ChatInterface({ initialQuery, agentId }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [brief, setBrief] = useState<GeneratedBrief | null>(null);
  const [showPDF, setShowPDF] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initSent = useRef(false);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(scrollToBottom, [messages, scrollToBottom]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: content.trim(),
      };

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setIsLoading(true);

      try {
        const response = await fetch(`/agents/briefly-agent/${agentId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              ...messages.map((m) => ({ role: m.role, content: m.content })),
              { role: "user", content: content.trim() },
            ],
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "(unreadable)");
          const errMsg = `HTTP ${response.status} ${response.statusText}: ${errorBody.slice(0, 300)}`;
          console.error("[ChatInterface] Agent error:", errMsg);
          throw new Error(errMsg);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            // Parse SSE data lines
            for (const line of chunk.split("\n")) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(data) as {
                    type?: string;
                    textDelta?: string;
                    text?: string;
                    response?: string;
                    // OpenAI-compatible (Cloudflare Workers AI)
                    choices?: Array<{ delta?: { content?: string } }>;
                  };
                  if (parsed.choices?.[0]?.delta?.content) {
                    accumulated += parsed.choices[0].delta.content;
                  } else if (parsed.type === "text-delta" && parsed.textDelta) {
                    accumulated += parsed.textDelta;
                  } else if (parsed.response) {
                    accumulated += parsed.response;
                  } else if (parsed.text) {
                    accumulated += parsed.text;
                  }
                } catch {
                  if (data && data !== "[DONE]") accumulated += data;
                }
              }
            }

            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: accumulated }
                  : m
              )
            );
          }
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: accumulated, isStreaming: false }
              : m
          )
        );

        // Check if a brief was generated
        const parsed = parseBriefFromContent(accumulated);
        if (parsed) setBrief(parsed);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[ChatInterface] Caught error:", errMsg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content: `Error: ${errMsg}`,
                  isStreaming: false,
                }
              : m
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [agentId, isLoading, messages]
  );

  // Fire initial query once
  useEffect(() => {
    if (initialQuery && !initSent.current) {
      initSent.current = true;
      sendMessage(initialQuery);
    }
  }, [initialQuery, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  return (
    <>
      <div className="chat-container">
        {/* Header */}
        <div className="chat-header">
          <span className="chat-title">Innovation Director · Gemma 4</span>
          {brief && (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: "6px 12px" }}
              onClick={() => setShowPDF(true)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Export Brief
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="chat-messages" aria-live="polite" aria-label="Conversation">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">💡</div>
              <p className="empty-state-text">
                Ask me about AI tools, industry trends, or request a strategic brief
                for your project.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === "user" ? "👤" : "✦"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={`message-bubble${msg.isStreaming ? " streaming-cursor" : ""}`}>
                  {msg.content
                    ? (msg.role === "assistant"
                        ? <Markdown text={msg.content} />
                        : msg.content)
                    : (msg.isStreaming && (
                        <span className="loading-dots">
                          <span /><span /><span />
                        </span>
                      ))}
                </div>

                {/* Actions after assistant message */}
                {msg.role === "assistant" && !msg.isStreaming && msg.content && (
                  <div className="chat-actions">
                    <CopyButton text={msg.content} />
                    <button
                      className="action-btn"
                      onClick={() => {
                        const q = `Generate a brief based on: ${messages.find(m => m.role === "user")?.content ?? "our project"}`;
                        sendMessage(q);
                      }}
                    >
                      Generate Brief
                    </button>
                    <button
                      className="action-btn"
                      onClick={() => sendMessage("What are the latest industry trends related to this?")}
                    >
                      Industry Trends
                    </button>
                    {brief && (
                      <button className="action-btn primary" onClick={() => setShowPDF(true)}>
                        Export PDF
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="chat-input-area">
          <form
            className="chat-input-form"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
          >
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask about tools, trends, or describe your project…"
              rows={1}
              disabled={isLoading}
              aria-label="Chat message"
              maxLength={2000}
            />
            <button
              type="submit"
              className="chat-send-btn"
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
        </div>
      </div>

      {showPDF && (
        <PDFExport brief={brief} onClose={() => setShowPDF(false)} />
      )}
    </>
  );
}
