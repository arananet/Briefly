import React, { useState, useRef, useEffect, useCallback } from "react";
import type { GeneratedBrief } from "../types";
import { PDFExport } from "./PDFExport";

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
        const response = await fetch(`/agents/briefly/${agentId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              ...messages.map((m) => ({ role: m.role, content: m.content })),
              { role: "user", content: content.trim() },
            ],
          }),
        });

        if (!response.ok) throw new Error("Agent request failed");

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
                  const parsed = JSON.parse(data) as { type?: string; textDelta?: string; text?: string; response?: string };
                  if (parsed.type === "text-delta" && parsed.textDelta) {
                    accumulated += parsed.textDelta;
                  } else if (parsed.response) {
                    accumulated += parsed.response;
                  } else if (parsed.text) {
                    accumulated += parsed.text;
                  }
                } catch {
                  // Not JSON — might be plain text chunk
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

        // Finalize the message
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
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content:
                    "Sorry, I encountered an error. Please try again.",
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
          <span className="chat-title">Innovation Director · Llama 3.3</span>
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
              <div>
                <div
                  className={`message-bubble${msg.isStreaming ? " streaming-cursor" : ""}`}
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {msg.content || (msg.isStreaming && (
                    <span className="loading-dots">
                      <span /><span /><span />
                    </span>
                  ))}
                </div>

                {/* Actions after last assistant message */}
                {msg.role === "assistant" && !msg.isStreaming && msg.content && (
                  <div className="chat-actions">
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
                      <button
                        className="action-btn primary"
                        onClick={() => setShowPDF(true)}
                      >
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
