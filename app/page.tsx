"use client";

import { useState } from "react";

type SuppressedResponse = {
  ok: true;
  userTurns: number;
  suppressed: true;
  reason: string;
};

type ScoredResponse = {
  ok: true;
  userTurns: number;
  suppressed: false;
  scores: { E: number; CP: number; CI: number };
  bands: { E: string; CP: string; CI: string };
  dims: {
    inquiry: number;
    conceptual: number;
    evidence: number;
    application: number;
    creation: number;
    critical: number;
    sustain: number;
  };
  signals: {
    whyHow: number;
    evidence: number;
    quantify: number;
    example: number;
    compare: number;
    synth: number;
    plan: number;
    create: number;
    reflect: number;
    challenge: number;
    qmarks: number;
  };
  perUserTurn: Array<{
    turn: number;
    words: number;
    dims: Record<string, number>;
    raw: { E: number; CP: number; CI: number };
    signals: Record<string, number>;
  }>;
};

type ErrorResponse = { ok: false; error: string };

type ApiResponse = SuppressedResponse | ScoredResponse | ErrorResponse;

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10, minWidth: 170 }}>
      <div style={{ fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 22 }}>{value}</div>
    </div>
  );
}

function KVGrid({ obj }: { obj: Record<string, any> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} style={{ padding: 10, border: "1px solid #eee", borderRadius: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{k}</div>
          <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
            {typeof v === "number" ? v.toFixed(3) : String(v)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [transcript, setTranscript] = useState(
    "User: I think this is happening because the algorithm rewards attention. Why does that increase anxiety?\n" +
      "Assistant: ...\n" +
      "User: Can you give an example and then compare it with offline learning?\n" +
      "Assistant: ...\n" +
      "User: How would you design a step-by-step plan to reduce doomscrolling?\n" +
      "Assistant: ...\n" +
      "User: Summarize the key points and connect them to cognitive offloading.\n" +
      "Assistant: ...\n" +
      'User: I want to create a small experiment method to test this.\n' +
      "Assistant: ..."
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
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>Cognitive Engagement Analyzer</h1>

      <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>Transcript</label>

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
            <div>
              <b>User turns:</b> {result.userTurns}
            </div>
            <div style={{ marginTop: 8 }}>
              <b>Suppressed:</b> Yes
            </div>
            <div style={{ marginTop: 8 }}>
              <b>Reason:</b> {result.reason}
            </div>
          </div>
        )}

        {result?.ok === true && result.suppressed === false && (
          <div style={{ padding: 12, border: "1px solid #ccc", borderRadius: 10 }}>
            <div>
              <b>User turns:</b> {result.userTurns}
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Card title={`Engagement (E) — ${result.bands.E}`} value={result.scores.E.toFixed(3)} />
              <Card title={`Conceptual (CP) — ${result.bands.CP}`} value={result.scores.CP.toFixed(3)} />
              <Card title={`Collaborative (CI) — ${result.bands.CI}`} value={result.scores.CI.toFixed(3)} />
            </div>

            <h2 style={{ marginTop: 18, marginBottom: 8, fontSize: 18 }}>7-Dimension Detail</h2>
            <KVGrid obj={result.dims as Record<string, any>} />

            <h2 style={{ marginTop: 18, marginBottom: 8, fontSize: 18 }}>Signals (Totals)</h2>
            <KVGrid
              obj={Object.fromEntries(
                Object.entries(result.signals).map(([k, v]) => [k, typeof v === "number" ? v : 0])
              )}
            />

            <h2 style={{ marginTop: 18, marginBottom: 8, fontSize: 18 }}>Per-User-Turn Breakdown</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {result.perUserTurn.map((t) => (
                <div key={t.turn} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>
                    Turn {t.turn} — words: {t.words}
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Raw (per turn)</div>
                    <KVGrid obj={t.raw as Record<string, any>} />
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Dims (per turn)</div>
                    <KVGrid obj={t.dims as Record<string, any>} />
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Signals (per turn)</div>
                    <KVGrid obj={t.signals as Record<string, any>} />
                  </div>
                </div>
              ))}
            </div>
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