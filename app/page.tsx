// C:\Users\Administrator\Desktop\offloading-ui\app\page.tsx
"use client";

import React, { useMemo, useState } from "react";

type BandCode =
  | "very_low"
  | "low"
  | "mild_moderate"
  | "moderate"
  | "moderate_high"
  | "high"
  | "very_high"
  | "advanced";

type AnalyzeResponse =
  | {
      ok: true;
      meta: {
        userTurnsCount: number;
        segmentsCount: number;
        quantitativeSuppressed: boolean;
        suppressedReason?: string;
        scorerModel?: string | null;
      };
      qualitativeSummary?: string;
      rawModelSummary?: string;

      // present when NOT suppressed
      level1?: {
        E: number;
        engagementBand: BandCode | string;
        engagementLabel: string;
        CP: number;
        CPBand?: BandCode | string;
        collaborativeIndex: number;
        collaborativeBand?: BandCode | string;
        userTurns: number;
      };
      advanced?: {
        dimensionMeans?: Record<string, number>;
        dependencyMean?: number;
        series?: {
          chart?: {
            labels: string[];
            Ut: number[];
            R: number[];
            K: number[];
            M: number[];
            C: number[];
            I: number[];
            G: number[];
            D: number[];
          };
        };
        components?: Record<string, any>;
      };
    }
  | { ok: false; error: string };

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE && process.env.NEXT_PUBLIC_API_BASE.trim()) ||
  "http://localhost:8787";

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function bandLabel10(xRaw: number) {
  const x = clamp01(xRaw);
  if (x <= 0.10) return "Very Low";
  if (x <= 0.20) return "Low";
  if (x <= 0.30) return "Mild–Moderate";
  if (x <= 0.40) return "Moderate";
  if (x <= 0.50) return "Moderate–High";
  if (x <= 0.60) return "High";
  if (x <= 0.70) return "Very High";
  return "Advanced";
}

function colorClassForBandLabel(lbl: string) {
  // Tailwind classes (simple, consistent)
  const t = (lbl || "").toLowerCase();
  if (t.includes("very low")) return "border-red-500/30 bg-red-500/10";
  if (t === "low") return "border-orange-500/30 bg-orange-500/10";
  if (t.includes("mild")) return "border-yellow-500/30 bg-yellow-500/10";
  if (t === "moderate") return "border-yellow-400/30 bg-yellow-400/10";
  if (t.includes("moderate–high") || t.includes("moderate-high"))
    return "border-green-500/30 bg-green-500/10";
  if (t === "high") return "border-green-400/30 bg-green-400/10";
  if (t.includes("very high")) return "border-cyan-400/30 bg-cyan-400/10";
  if (t.includes("advanced")) return "border-violet-400/30 bg-violet-400/10";
  return "border-slate-700 bg-slate-900/40";
}

function niceNum(x: number, digits = 3) {
  const v = Number.isFinite(x) ? x : 0;
  return v.toFixed(digits);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-extrabold tracking-wide text-slate-200">{children}</h2>;
}

function Card({
  title,
  value,
  subtitle,
  badge,
}: {
  title: string;
  value: string;
  subtitle?: string;
  badge?: string;
}) {
  const bandClass = badge ? colorClassForBandLabel(badge) : "border-slate-700 bg-slate-900/40";
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${bandClass}`}>
      <div className="text-xs font-extrabold tracking-wide text-slate-300">{title}</div>
      <div className="mt-2 text-2xl font-black text-slate-50">{value}</div>
      <div className="mt-2 space-y-1">
        {badge ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-950/40 px-3 py-1 text-xs font-extrabold text-slate-200">
            <span className="h-2 w-2 rounded-full bg-slate-200/50" />
            {badge}
          </div>
        ) : null}
        {subtitle ? <div className="text-xs font-semibold text-slate-300">{subtitle}</div> : null}
      </div>
    </div>
  );
}

/**
 * Simple SVG line chart for Ut trajectory (no external libs)
 */
function LineChartSvg({
  values,
  height = 180,
}: {
  values: number[];
  height?: number;
}) {
  const w = 900;
  const h = height;
  const pad = 18;

  const pts = useMemo(() => {
    const v = (values ?? []).map(clamp01);
    if (v.length === 0) return [];
    const n = v.length;
    const xStep = n <= 1 ? 0 : (w - 2 * pad) / (n - 1);
    return v.map((y, i) => {
      const x = pad + i * xStep;
      const yy = pad + (1 - y) * (h - 2 * pad);
      return { x, y: yy, v: y };
    });
  }, [values, w, h, pad]);

  const d = pts.length
    ? "M " + pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")
    : "";

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-2 text-xs font-extrabold text-slate-200">Ut trajectory</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[180px] w-full">
        {/* grid */}
        {[0.25, 0.5, 0.75].map((t) => {
          const y = pad + (1 - t) * (h - 2 * pad);
          return (
            <line key={t} x1={pad} y1={y} x2={w - pad} y2={y} stroke="rgba(148,163,184,0.15)" />
          );
        })}
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgba(148,163,184,0.25)" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="rgba(148,163,184,0.25)" />

        {/* path */}
        {d ? <path d={d} fill="none" stroke="rgba(226,232,240,0.9)" strokeWidth="3" /> : null}

        {/* points */}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={5}
            fill="rgba(226,232,240,0.9)"
            opacity={0.9}
          />
        ))}
      </svg>

      <div className="mt-2 text-xs font-semibold text-slate-400">
        Higher line = stronger per-turn cognitive signal (Ut). This is a simple visual; the score is computed in backend.
      </div>
    </div>
  );
}

/**
 * Simple SVG bar chart for 7D means
 */
function BarChartSvg({
  dims,
  height = 220,
}: {
  dims: Record<string, number>;
  height?: number;
}) {
  const keys = ["R", "K", "M", "C", "I", "G", "D"];
  const data = keys.map((k) => ({ k, v: clamp01(dims?.[k] ?? 0) }));

  const w = 900;
  const h = height;
  const pad = 18;
  const barW = 80;
  const gap = 40;

  const totalW = pad * 2 + keys.length * barW + (keys.length - 1) * gap;
  const scaleX = w / totalW;

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-2 text-xs font-extrabold text-slate-200">7D dimension means</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[220px] w-full">
        {/* axes */}
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgba(148,163,184,0.25)" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="rgba(148,163,184,0.25)" />
        {[0.25, 0.5, 0.75].map((t) => {
          const y = pad + (1 - t) * (h - 2 * pad);
          return (
            <line key={t} x1={pad} y1={y} x2={w - pad} y2={y} stroke="rgba(148,163,184,0.15)" />
          );
        })}

        {data.map((d, i) => {
          const x = (pad + i * (barW + gap)) * scaleX;
          const barH = d.v * (h - 2 * pad);
          const y = h - pad - barH;

          return (
            <g key={d.k}>
              <rect
                x={x}
                y={y}
                width={barW * scaleX}
                height={barH}
                rx={12}
                fill="rgba(226,232,240,0.85)"
              />
              <text
                x={x + (barW * scaleX) / 2}
                y={h - 6}
                textAnchor="middle"
                fontSize="20"
                fill="rgba(226,232,240,0.85)"
                fontFamily="ui-sans-serif, system-ui"
                fontWeight="800"
              >
                {d.k}
              </text>
              <text
                x={x + (barW * scaleX) / 2}
                y={Math.max(pad + 22, y - 8)}
                textAnchor="middle"
                fontSize="18"
                fill="rgba(226,232,240,0.85)"
                fontFamily="ui-sans-serif, system-ui"
                fontWeight="700"
              >
                {niceNum(d.v, 2)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 text-xs font-semibold text-slate-400">
        D is dependency/delegation. Others reflect reasoning, knowledge use, metacognition, contribution, initiative, and synthesis (as defined in your rubric).
      </div>
    </div>
  );
}

export default function Page() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<AnalyzeResponse | null>(null);

  const suppressed = data && "ok" in data && data.ok && data.meta.quantitativeSuppressed;

  async function onAnalyze() {
    setErr(null);
    setLoading(true);
    setData(null);

    try {
      const resp = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const json = (await resp.json()) as AnalyzeResponse;
      setData(json);

      if (!json.ok) setErr(json.error || "Unknown error");
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const level1 = data && "ok" in data && data.ok ? data.level1 : undefined;
  const advanced = data && "ok" in data && data.ok ? data.advanced : undefined;

  const userTurnsCount =
    data && "ok" in data && data.ok ? Number(data.meta.userTurnsCount ?? 0) : 0;

  const E = level1 ? Number(level1.E ?? 0) : 0;
  const CP = level1 ? Number(level1.CP ?? 0) : 0;
  const CI = level1 ? Number(level1.collaborativeIndex ?? 0) : 0;

  const ELabel = level1?.engagementLabel ?? "—";
  const CPLabel = level1 ? bandLabel10(CP) : "—";
  const CILabel = level1 ? bandLabel10(CI) : "—";

  const chart = advanced?.series?.chart;
  const dimMeans = advanced?.dimensionMeans ?? {};

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-black tracking-tight">Cognitive Engagement Insight</h1>
          <p className="max-w-3xl text-sm font-semibold text-slate-300">
            Paste a conversation as plain text using prefixes like <span className="font-black">User:</span> and{" "}
            <span className="font-black">Assistant:</span> (or <span className="font-black">U:</span>,{" "}
            <span className="font-black">A:</span>). Backend API:{" "}
            <span className="font-black">{API_BASE}</span>
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Input */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/30 p-4 shadow-sm">
            <SectionTitle>Paste conversation</SectionTitle>

            <textarea
              className="mt-3 h-[280px] w-full resize-y rounded-2xl border border-slate-800 bg-slate-950/50 p-3 text-sm leading-relaxed text-slate-100 outline-none focus:border-slate-600"
              placeholder={`User: ...
Assistant: ...
User: ...`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />

            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={onAnalyze}
                disabled={loading || !text.trim()}
                className="rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm font-extrabold hover:bg-slate-800 disabled:opacity-60"
              >
                {loading ? "Analyzing..." : "Analyze"}
              </button>

              <div className="text-xs font-semibold text-slate-300">
                {loading ? "working..." : data ? (("ok" in data && data.ok) ? "done" : "error") : "idle"}
              </div>
            </div>

            {err ? (
              <div className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm font-semibold text-red-100">
                {err}
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="text-xs font-extrabold text-slate-200">Summary</div>
              <div className="mt-2 text-sm font-semibold leading-relaxed text-slate-100">
                {data && "ok" in data && data.ok
                  ? (data.qualitativeSummary || "(no summary)")
                  : "Paste text and click Analyze."}
              </div>
              {data && "ok" in data && data.ok && data.rawModelSummary ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-extrabold text-slate-300">
                    Raw model summary
                  </summary>
                  <pre className="mt-2 overflow-auto rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-100">
                    {data.rawModelSummary}
                  </pre>
                </details>
              ) : null}
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-extrabold text-slate-300">
                Raw JSON
              </summary>
              <pre className="mt-2 overflow-auto rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-100">
                {data ? JSON.stringify(data, null, 2) : "(empty)"}
              </pre>
            </details>
          </div>

          {/* Level 1 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/30 p-4 shadow-sm">
            <SectionTitle>Level 1 snapshot</SectionTitle>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* E */}
              <Card
                title="Cognitive Engagement"
                value={suppressed ? "—" : niceNum(E, 3)}
                subtitle={suppressed ? (data && "ok" in data && data.ok ? (data.meta.suppressedReason || "Quantitative estimates suppressed.") : "—") : ELabel}
                badge={suppressed ? "—" : ELabel}
              />

              {/* CP */}
              <Card
                title="Conceptual Participation"
                value={suppressed ? "—" : niceNum(CP, 2)}
                subtitle="Share of conceptual user turns"
                badge={suppressed ? "—" : CPLabel}
              />

              {/* CI */}
              <Card
                title="Collaborative Index"
                value={suppressed ? "—" : niceNum(CI, 2)}
                subtitle="Average of E and CP"
                badge={suppressed ? "—" : CILabel}
              />

              {/* Turns */}
              <Card
                title="User Turns"
                value={String(userTurnsCount || 0)}
                subtitle={userTurnsCount >= 10 ? "Sufficient turns for reliability" : "More turns increases stability"}
                badge={userTurnsCount >= 10 ? "Moderate" : userTurnsCount >= 5 ? "Low" : "Very Low"}
              />
            </div>

            {/* Advanced */}
            <div className="mt-4">
              <details>
                <summary className="cursor-pointer text-xs font-extrabold text-slate-300">
                  Advanced charts
                </summary>

                <div className="mt-3 space-y-4">
                  {suppressed ? (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-sm font-semibold text-slate-200">
                      Quantitative charts are hidden because numeric estimates are suppressed (need ≥ 5 user turns).
                    </div>
                  ) : (
                    <>
                      <LineChartSvg values={chart?.Ut ?? []} />
                      <BarChartSvg dims={dimMeans} />
                    </>
                  )}
                </div>
              </details>
            </div>
          </div>
        </div>

        <div className="mt-6 text-xs font-semibold text-slate-400">
          Tip: If you paste from ChatGPT, avoid including triple backticks. If you do include them, your backend parser should strip them.
        </div>
      </div>
    </main>
  );
}