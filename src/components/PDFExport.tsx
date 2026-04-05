import React, { useRef } from "react";
import type { GeneratedBrief } from "../types";

interface PDFExportProps {
  brief: GeneratedBrief | null;
  onClose: () => void;
}

export function PDFExport({ brief, onClose }: PDFExportProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const handleDownload = async () => {
    if (!brief || !contentRef.current) return;

    try {
      // Dynamic import to keep bundle smaller
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);

      const canvas = await html2canvas(contentRef.current, {
        backgroundColor: "#0d0d1a",
        scale: 2,
        useCORS: true,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const fileName = `briefly-${brief.topic.replace(/\s+/g, "-").toLowerCase().slice(0, 40)}-${new Date().toISOString().split("T")[0]}.pdf`;
      pdf.save(fileName);
    } catch (err) {
      console.error("PDF generation failed:", err);
    }
  };

  if (!brief) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Export Brief">
      <div className="modal glass-card">
        <div className="modal-header">
          <h2 className="modal-title">Innovation Brief — {brief.topic}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {/* Printable content */}
          <div ref={contentRef} id="pdf-template">
            {/* Cover */}
            <div style={{ marginBottom: 32 }}>
              <div style={{
                background: "linear-gradient(135deg, #667eea, #764ba2)",
                padding: "24px",
                borderRadius: 12,
                marginBottom: 20,
              }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#fff", marginBottom: 4 }}>
                  briefly
                </div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                  Innovation Intelligence Report
                </div>
              </div>
              <div style={{ color: "#e8e8ff", fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
                {brief.topic}
              </div>
              <div style={{ color: "rgba(232,232,255,0.5)", fontSize: 12 }}>
                Generated {new Date(brief.generatedAt).toLocaleDateString("en-US", {
                  weekday: "long", year: "numeric", month: "long", day: "numeric"
                })}
              </div>
            </div>

            {/* Executive Summary */}
            <div className="brief-section">
              <div className="brief-section-title">Executive Summary</div>
              <p className="brief-summary">{brief.summary}</p>
            </div>

            {/* Recommended Tools */}
            {brief.recommendedTools.length > 0 && (
              <div className="brief-section">
                <div className="brief-section-title">Recommended Tools</div>
                {brief.recommendedTools.map((tool, i) => (
                  <div key={i} className="brief-tool">
                    <div className="brief-tool-name">{tool.name}</div>
                    <div className="brief-tool-reason">{tool.matchReason}</div>
                    <a
                      href={tool.toolUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="brief-tool-link"
                    >
                      {tool.toolUrl} ↗
                    </a>
                    <div style={{ fontSize: 10, color: "rgba(232,232,255,0.3)", marginTop: 4 }}>
                      Source: {tool.sourceUrl}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Key News */}
            {brief.keyNews.length > 0 && (
              <div className="brief-section">
                <div className="brief-section-title">Key Industry News</div>
                {brief.keyNews.map((news, i) => (
                  <div key={i} style={{
                    padding: "8px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2, color: "#e8e8ff" }}>
                      {news.title}
                    </div>
                    <a
                      href={news.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "#00d4ff", textDecoration: "none" }}
                    >
                      {news.source} ↗
                    </a>
                  </div>
                ))}
              </div>
            )}

            {/* Leaderboard */}
            {brief.leaderboardSnapshot.length > 0 && (
              <div className="brief-section">
                <div className="brief-section-title">Model Leaderboard Snapshot (Arena.ai)</div>
                {brief.leaderboardSnapshot.map((model) => (
                  <div key={model.rank} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "6px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    fontSize: 12,
                  }}>
                    <span style={{ color: "#667eea", fontWeight: 700, width: 24 }}>
                      #{model.rank}
                    </span>
                    <span style={{ flex: 1, color: "#e8e8ff" }}>{model.model}</span>
                    <span style={{ color: "rgba(232,232,255,0.5)" }}>{model.provider}</span>
                    <span style={{ color: "#00d4ff", fontWeight: 600 }}>{model.score}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div style={{
              marginTop: 32,
              paddingTop: 16,
              borderTop: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              color: "rgba(232,232,255,0.3)",
            }}>
              <span>Powered by Briefly · briefly.workers.dev</span>
              <span>Developer: Eduardo Arana</span>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleDownload}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}
