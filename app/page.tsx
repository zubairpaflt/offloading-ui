"use client";

import { useState } from "react";

type ApiResponse =
  | {
      ok: true;
      userTurns: number;
      suppressed: true;
      reason: string;
      qualitative: { summary: string };
    }
  | {
      ok: true;
      userTurns: number;
      suppressed: false;
      scores: { E: number; CP: number; CI: number };
      note?: string;
    }
  | {
      ok: false;
      error: string;
    };

export default function Home() {
  const [transcript, setTranscript] = useState(
    "User: 1\nAssistant: a\nUser: 2\nAssistant: b\nUser: 3\nAssistant: c\nUser: 4\nAssistant: d\nUser: 5\nAssistant: e"
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);

  async function onAnalyze() {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });

      const data = (await res.json()) as ApiResponse;
      setResult(data);
    } catch {
      setResult({ ok: false, error: "Network error while calling /api/analyze" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>
        Cognitive Engagement Analyzer
      </h1>

      <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
        Transcript
      </label>
      <textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        rows={12}
        style={{
          width: "100%",
          padding: 12,
          borderRadius: 10,
          border: "1px solid #ccc",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
        }}
      />

      <button
        onClick={onAnalyze}
        disabled={loading}
        style={{
          marginTop: 12,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #111",
          cursor: loading ? "not-allowed" : "pointer",
          fontWeight: 700,
        }}
      >
        {loading ? "Analyzing..." : "Analyze"}
      </button>

      <div style={{ marginTop: 18 }}>
        {result?.ok === true && result.suppressed === true && (
          <div style={{ padding: 12, border: "1px solid #ccc", borderRadius: 10 }}>
            <div><b>User turns:</b> {result.userTurns}</div>
            <div style={{ marginTop: 8 }}><b>Suppressed:</b> Yes</div>
            <div style={{ marginTop: 8 }}><b>Reason:</b> {result.reason}</div>
            <div style={{ marginTop: 8 }}><b>Summary:</b> {result.qualitative.summary}</div>
          </div>
        )}

        {result?.ok === true && result.suppressed === false && (
          <div style={{ padding: 12, border: "1px solid #ccc", borderRadius: 10 }}>
            <div><b>User turns:</b> {result.userTurns}</div>
            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10, minWidth: 160 }}>
                <div style={{ fontWeight: 700 }}>Engagement (E)</div>
                <div style={{ fontSize: 22 }}>{result.scores.E.toFixed(3)}</div>
              </div>
              <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10, minWidth: 160 }}>
                <div style={{ fontWeight: 700 }}>Conceptual (CP)</div>
                <div style={{ fontSize: 22 }}>{result.scores.CP.toFixed(3)}</div>
              </div>
              <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10, minWidth: 160 }}>
                <div style={{ fontWeight: 700 }}>Collaborative (CI)</div>
                <div style={{ fontSize: 22 }}>{result.scores.CI.toFixed(3)}</div>
              </div>
            </div>

            {result.note && (
              <div style={{ marginTop: 10, opacity: 0.8 }}>
                <b>Note:</b> {result.note}
              </div>
            )}
          </div>
        )}

        {result?.ok === false && (
          <div style={{ padding: 12, border: "1px solid #f2caca", borderRadius: 10 }}>
            <b>Error:</b> {result.error}
          </div>
        )}
      </div>
    </main>
  );
}