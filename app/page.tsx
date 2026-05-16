"use client";

import React, { useMemo, useState } from "react";

type Band =
  | "very_low"
  | "low"
  | "mild_moderate"
  | "moderate"
  | "moderate_high"
  | "high"
  | "very_high"
  | "advanced";

type Dims7 = {
  R: number;
  K: number;
  M: number;
  C: number;
  I: number;
  G: number;
  D: number;
};

type TurnScore = {
  turnId: string;
  tag: "operational" | "conceptual" | "mixed";
  dims: Dims7;
};

type Segment = {
  segmentId: string;
  label: string;
  turnIds: string[];
  shareUserTurns?: number;
};

type ApiResponse =
  | {
      ok: false;
      error: string;
    }
  | {
      ok: true;
      mode: "qual_only" | "quant_qual" | "no_report";
      meta: {
        userTurnsCount: number;
        segmentsCount?: number;
        quantitativeSuppressed: boolean;
        suppressedReason?: string;
      };
      qualitativeSummary?: string;
      segmentSummaries?: Array<{ segmentId: string; summary: string }>;
      segments?: Segment[];
      level1?: {
        E: number;
        engagementBand: Band;
        engagementLabel: string;
        CP: number;
        CPBand: Band;
        CPLabel: string;
        collaborativeIndex: number;
        collaborativeBand: Band;
        collaborativeLabel: string;
        trajectory: "increasing" | "decreasing" | "stable";
        userTurns: number;
      };
      quickInterpretation?: string;
      scoreAlignedSummary?: string;
      advanced?: {
        dimensionMeans?: { Ut?: number } & Partial<Dims7>;
        UtSeries?: Array<{ turnId: string; Ut: number; dims: Dims7 }>;
        turnScores?: TurnScore[];
        segments?: Segment[];
        segmentSummaries?: Array<{ segmentId: string; summary: string }>;
        components?: {
          Sd?: number;
          St?: number;
          Sc?: number;
          Sp?: number;
          Ecore?: number;
          durationBonus?: number;
          qualityGate?: number;
        };
      };
    };

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function fmt(x: number) {
  return clamp01(x).toFixed(2);
}

function bandToColor(band: Band): string {
  switch (band) {
    case "very_low":
      return "bg-red-500";
    case "low":
      return "bg-orange-500";
    case "mild_moderate":
      return "bg-amber-500";
    case "moderate":
      return "bg-yellow-500";
    case "moderate_high":
      return "bg-lime-500";
    case "high":
      return "bg-green-500";
    case "very_high":
      return "bg-emerald-500";
    case "advanced":
      return "bg-teal-500";
  }
}

function tagPillClasses(tag: TurnScore["tag"]) {
  switch (tag) {
    case "conceptual":
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/40";
    case "mixed":
      return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/40";
    case "operational":
    default:
      return "bg-neutral-50 text-neutral-700 border-neutral-200 dark:bg-neutral-900/30 dark:text-neutral-200 dark:border-neutral-800";
  }
}

function ProgressBar({ value, band }: { value: number; band: Band }) {
  const pct = Math.round(clamp01(value) * 100);
  const color = bandToColor(band);

  return (
    <div className="w-full">
      <div className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
        <div className={`h-2 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
        {pct}% ({fmt(value)})
      </div>
    </div>
  );
}

function ScoreRow({
  label,
  value,
  band,
  bandLabel,
}: {
  label: string;
  value: number;
  band: Band;
  bandLabel: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{label}</div>
        <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 tabular-nums">
          {fmt(value)}{" "}
          <span className="text-neutral-500 dark:text-neutral-400 font-medium">— {bandLabel}</span>
        </div>
      </div>
      <ProgressBar value={value} band={band} />
    </div>
  );
}

function SmallBar({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const pct = Math.round(clamp01(value) * 100);
  return (
    <div className="grid grid-cols-[36px_1fr_44px] items-center gap-3">
      <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{label}</div>
      <div className="h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
        <div className="h-2 bg-neutral-900 dark:bg-neutral-100" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs tabular-nums text-neutral-600 dark:text-neutral-400 text-right">
        {fmt(value)}
      </div>
    </div>
  );
}

function LineChart({
  values,
  height = 120,
}: {
  values: number[];
  height?: number;
}) {
  const w = 560; // logical width; scales via viewBox
  const h = height;
  const pad = 10;

  const arr = (values ?? []).map(clamp01);
  if (arr.length < 2) {
    return (
      <div className="text-xs text-neutral-600 dark:text-neutral-400">
        Not enough points to plot a trajectory.
      </div>
    );
  }

  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const span = Math.max(1e-6, max - min);

  const xStep = (w - pad * 2) / (arr.length - 1);
  const pts = arr.map((v, i) => {
    const x = pad + i * xStep;
    const y = pad + (1 - (v - min) / span) * (h - pad * 2);
    return { x, y };
  });

  const d = pts
    .map((p, i) => (i === 0 ? `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}` : `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`))
    .join(" ");

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto"
        role="img"
        aria-label="Ut trajectory chart"
      >
        {/* background */}
        <rect x="0" y="0" width={w} height={h} rx="10" className="fill-neutral-50 dark:fill-neutral-900/30" />
        {/* midline */}
        <line
          x1={pad}
          y1={h / 2}
          x2={w - pad}
          y2={h / 2}
          className="stroke-neutral-200 dark:stroke-neutral-800"
          strokeWidth="1"
        />
        {/* path */}
        <path d={d} className="stroke-neutral-900 dark:stroke-neutral-100" strokeWidth="2" fill="none" />
        {/* points */}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.5" className="fill-neutral-900 dark:fill-neutral-100" />
        ))}
      </svg>

      <div className="mt-2 flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400 tabular-nums">
        <div>min {fmt(min)}</div>
        <div>max {fmt(max)}</div>
        <div>n={arr.length}</div>
      </div>
    </div>
  );
}

export default function Page() {
  const [transcript, setTranscript] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const [advancedTab, setAdvancedTab] = useState<"overview" | "trajectory" | "dimensions" | "turns" | "segments">(
    "overview"
  );

  const [turnSearch, setTurnSearch] = useState("");
  const [turnTagFilter, setTurnTagFilter] = useState<"all" | TurnScore["tag"]>("all");
  const [turnLimit, setTurnLimit] = useState(20);

  const hasQuant = useMemo(() => {
    return !!(
      data &&
      "ok" in data &&
      data.ok &&
      data.mode === "quant_qual" &&
      data.level1 &&
      !data.meta.quantitativeSuppressed
    );
  }, [data]);

  const suppressed = useMemo(() => {
    return !!(data && "ok" in data && data.ok && data.meta.quantitativeSuppressed);
  }, [data]);

  const advanced = useMemo(() => {
    if (!data || !("ok" in data) || !data.ok) return null;
    return data.advanced ?? null;
  }, [data]);

  const utValues = useMemo(() => {
    const series = advanced?.UtSeries ?? [];
    return series.map((x) => clamp01(x.Ut));
  }, [advanced]);

  const dimsMeans = useMemo(() => {
    const m = advanced?.dimensionMeans ?? {};
    return {
      R: clamp01((m as any).R ?? 0),
      K: clamp01((m as any).K ?? 0),
      M: clamp01((m as any).M ?? 0),
      C: clamp01((m as any).C ?? 0),
      I: clamp01((m as any).I ?? 0),
      G: clamp01((m as any).G ?? 0),
      D: clamp01((m as any).D ?? 0),
      Ut: clamp01((m as any).Ut ?? 0),
    };
  }, [advanced]);

  const turnsFiltered = useMemo(() => {
    const arr = advanced?.turnScores ?? [];
    const q = (turnSearch ?? "").trim().toLowerCase();

    // we don't have raw turn text here; filter by id/tag only (keeps UI light).
    // if you later want text, we can return turn texts from API too.
    let out = arr;

    if (turnTagFilter !== "all") {
      out = out.filter((t) => t.tag === turnTagFilter);
    }

    if (q) {
      out = out.filter((t) => (t.turnId ?? "").toLowerCase().includes(q));
    }

    return out.slice(0, Math.max(5, Math.min(200, turnLimit)));
  }, [advanced, turnSearch, turnTagFilter, turnLimit]);

  async function onAnalyze() {
    setErr(null);
    setShowAdvanced(false);
    setShowRaw(false);
    setAdvancedTab("overview");
    setLoading(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });

      const json = (await res.json()) as ApiResponse;
      if (!json || (json as any).ok === false) {
        setData(json);
        setErr((json as any).error ?? "Unknown error");
      } else {
        setData(json);
      }
    } catch (e: any) {
      setErr(e?.message || "Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const rightTitle = suppressed ? "Session Results (Qualitative Only)" : "Session Results";

  const tabBtn = (id: typeof advancedTab, label: string) => {
    const active = advancedTab === id;
    return (
      <button
        onClick={() => setAdvancedTab(id)}
        className={[
          "rounded-xl px-3 py-2 text-xs font-semibold border",
          active
            ? "bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:border-neutral-100"
            : "border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900/40",
        ].join(" ")}
      >
        {label}
      </button>
    );
  };

  return (
    <main className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Cognitive Engagement Analyzer
          </h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Measure how actively a person participates in thinking during human–AI interaction.
          </p>
        </div>

        {/* Two-column first window */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: input */}
          <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-sm">
            <div className="p-5">
              <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                Paste Conversation / Transcript
              </h2>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Paste a chat, discussion, or learning interaction below to analyze cognitive engagement and collaboration quality.
              </p>

              <div className="mt-4">
                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  Transcript Input
                </label>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder={`User: Why does depression affect sleep?\nAssistant: ...\nUser: So does that mean...`}
                  className="w-full min-h-[240px] resize-y rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
                />
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={onAnalyze}
                  disabled={loading || !transcript.trim()}
                  className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold
                             bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed
                             dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                >
                  {loading ? "Analyzing..." : "Analyze"}
                </button>

                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  Quantitative scoring requires at least <span className="font-semibold">5</span> meaningful user turns.
                </div>
              </div>

              {err && (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                  {err}
                </div>
              )}
            </div>
          </section>

          {/* Right: results */}
          <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-sm">
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                    {rightTitle}
                  </h2>
                  <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                    {data && "ok" in data && data.ok ? (
                      <>
                        Mode: <span className="font-medium">{data.mode}</span> • User turns:{" "}
                        <span className="font-medium">{data.meta.userTurnsCount}</span>
                        {typeof data.meta.segmentsCount === "number" ? (
                          <>
                            {" "}
                            • Segments: <span className="font-medium">{data.meta.segmentsCount}</span>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <>Run analysis to see Level-1 results here.</>
                    )}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {/* Suppressed view */}
                {suppressed && data && "ok" in data && data.ok ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/30 p-3">
                      <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                        Quantitative scoring suppressed
                      </div>
                      <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                        {data.meta.suppressedReason ?? "Quantitative scoring is unavailable for this session."}
                      </div>
                    </div>

                    {data.qualitativeSummary ? (
                      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
                        <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                          Qualitative Summary
                        </div>
                        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200 leading-relaxed">
                          {data.qualitativeSummary}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Level 1 (Quant) */}
                {hasQuant && data && "ok" in data && data.ok && data.level1 ? (
                  <>
                    <div className="space-y-4">
                      <ScoreRow
                        label="Engagement Score (E)"
                        value={data.level1.E}
                        band={data.level1.engagementBand}
                        bandLabel={data.level1.engagementLabel}
                      />
                      <ScoreRow
                        label="Conceptual Participation (CP)"
                        value={data.level1.CP}
                        band={data.level1.CPBand}
                        bandLabel={data.level1.CPLabel}
                      />
                      <ScoreRow
                        label="Collaborative Index (CI)"
                        value={data.level1.collaborativeIndex}
                        band={data.level1.collaborativeBand}
                        bandLabel={data.level1.collaborativeLabel}
                      />
                    </div>

                    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/30 p-3">
                      <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        Quick Interpretation
                      </div>
                      <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200 leading-relaxed">
                        {data.quickInterpretation ?? "—"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
                      <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        Summary (aligned with scores)
                      </div>
                      <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200 leading-relaxed">
                        {data.scoreAlignedSummary ?? "—"}
                      </p>

                      {data.qualitativeSummary ? (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200">
                            Read qualitative summary
                          </summary>
                          <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-200 leading-relaxed">
                            {data.qualitativeSummary}
                          </p>
                        </details>
                      ) : null}
                    </div>

                    <div className="pt-1 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setShowAdvanced((v) => !v)}
                        className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs font-semibold
                                   hover:bg-neutral-50 dark:hover:bg-neutral-900/40"
                      >
                        {showAdvanced ? "Hide Advanced" : "Show Advanced Details"}
                      </button>
                      <button
                        onClick={() => setShowRaw((v) => !v)}
                        className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs font-semibold
                                   hover:bg-neutral-50 dark:hover:bg-neutral-900/40"
                      >
                        {showRaw ? "Hide Raw JSON" : "Show Raw JSON"}
                      </button>
                    </div>

                    {/* FULL Advanced View (collapsed by default) */}
                    {showAdvanced ? (
                      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                              Advanced Details
                            </div>
                            <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                              Full breakdown (kept organized to avoid overwhelm).
                            </div>
                          </div>
                          <div className="text-xs text-neutral-600 dark:text-neutral-400">
                            Trajectory:{" "}
                            <span className="font-medium text-neutral-800 dark:text-neutral-200">
                              {data.level1.trajectory}
                            </span>
                          </div>
                        </div>

                        {/* Tabs */}
                        <div className="flex flex-wrap gap-2">
                          {tabBtn("overview", "Overview")}
                          {tabBtn("trajectory", "Ut Trajectory")}
                          {tabBtn("dimensions", "Dimensions")}
                          {tabBtn("turns", "Per-turn")}
                          {tabBtn("segments", "Segments")}
                        </div>

                        {/* Tab panels */}
                        {advancedTab === "overview" ? (
                          <div className="space-y-3">
                            {/* Components card */}
                            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/30 p-3">
                              <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                                Session Components (from your E model)
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-neutral-700 dark:text-neutral-200 tabular-nums">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-neutral-600 dark:text-neutral-400">Sd</span>
                                  <span className="font-semibold">{fmt(advanced?.components?.Sd ?? 0)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-neutral-600 dark:text-neutral-400">St</span>
                                  <span className="font-semibold">{fmt(advanced?.components?.St ?? 0)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-neutral-600 dark:text-neutral-400">Sc</span>
                                  <span className="font-semibold">{fmt(advanced?.components?.Sc ?? 0)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-neutral-600 dark:text-neutral-400">Sp</span>
                                  <span className="font-semibold">{fmt(advanced?.components?.Sp ?? 0)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-neutral-600 dark:text-neutral-400">Ecore</span>
                                  <span className="font-semibold">{fmt(advanced?.components?.Ecore ?? 0)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-neutral-600 dark:text-neutral-400">qualityGate</span>
                                  <span className="font-semibold">{fmt(advanced?.components?.qualityGate ?? 0)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-neutral-600 dark:text-neutral-400">durationBonus</span>
                                  <span className="font-semibold">{fmt(advanced?.components?.durationBonus ?? 0)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-neutral-600 dark:text-neutral-400">Ut mean</span>
                                  <span className="font-semibold">{fmt((dimsMeans as any).Ut ?? 0)}</span>
                                </div>
                              </div>
                            </div>

                            {/* Dimension mini-bars */}
                            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
                              <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                                7-Dimension Means (quick view)
                              </div>
                              <div className="mt-3 space-y-2">
                                <SmallBar label="R" value={dimsMeans.R} />
                                <SmallBar label="K" value={dimsMeans.K} />
                                <SmallBar label="M" value={dimsMeans.M} />
                                <SmallBar label="C" value={dimsMeans.C} />
                                <SmallBar label="I" value={dimsMeans.I} />
                                <SmallBar label="G" value={dimsMeans.G} />
                                <SmallBar label="D" value={dimsMeans.D} />
                              </div>
                              <div className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                                Note: Ut = mean(R,K,M,C,I,G). Dependency (D) is calibrated separately.
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {advancedTab === "trajectory" ? (
                          <div className="space-y-3">
                            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
                              <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                                Ut Trajectory
                              </div>
                              <div className="mt-2">
                                <LineChart values={utValues} height={140} />
                              </div>
                              <div className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                                Ut reflects per-turn cognitive engagement (mean of R/K/M/C/I/G).
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {advancedTab === "dimensions" ? (
                          <div className="space-y-3">
                            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
                              <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                                Dimension Means (detailed)
                              </div>
                              <div className="mt-3 space-y-2">
                                <SmallBar label="R" value={dimsMeans.R} />
                                <SmallBar label="K" value={dimsMeans.K} />
                                <SmallBar label="M" value={dimsMeans.M} />
                                <SmallBar label="C" value={dimsMeans.C} />
                                <SmallBar label="I" value={dimsMeans.I} />
                                <SmallBar label="G" value={dimsMeans.G} />
                                <SmallBar label="D" value={dimsMeans.D} />
                              </div>

                              <details className="mt-3">
                                <summary className="cursor-pointer text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200">
                                  Show dimension definitions (short)
                                </summary>
                                <div className="mt-2 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed space-y-1">
                                  <div><span className="font-semibold text-neutral-700 dark:text-neutral-300">R</span>: Reasoning / causal thinking</div>
                                  <div><span className="font-semibold text-neutral-700 dark:text-neutral-300">K</span>: Knowledge engagement / use</div>
                                  <div><span className="font-semibold text-neutral-700 dark:text-neutral-300">M</span>: Metacognition / reflection</div>
                                  <div><span className="font-semibold text-neutral-700 dark:text-neutral-300">C</span>: Critical evaluation / comparison</div>
                                  <div><span className="font-semibold text-neutral-700 dark:text-neutral-300">I</span>: Initiative / self-directed engagement</div>
                                  <div><span className="font-semibold text-neutral-700 dark:text-neutral-300">G</span>: Generative integration / synthesis</div>
                                  <div><span className="font-semibold text-neutral-700 dark:text-neutral-300">D</span>: Dependency / delegation (offloading)</div>
                                </div>
                              </details>
                            </div>
                          </div>
                        ) : null}

                        {advancedTab === "turns" ? (
                          <div className="space-y-3">
                            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                                    Per-turn Breakdown
                                  </div>
                                  <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                                    Filter by tag or turn ID. (Kept compact.)
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                  <select
                                    value={turnTagFilter}
                                    onChange={(e) => setTurnTagFilter(e.target.value as any)}
                                    className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2 py-2 text-xs"
                                  >
                                    <option value="all">All tags</option>
                                    <option value="conceptual">Conceptual</option>
                                    <option value="mixed">Mixed</option>
                                    <option value="operational">Operational</option>
                                  </select>

                                  <input
                                    value={turnSearch}
                                    onChange={(e) => setTurnSearch(e.target.value)}
                                    placeholder="Search by turnId…"
                                    className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-xs w-[160px]"
                                  />

                                  <select
                                    value={turnLimit}
                                    onChange={(e) => setTurnLimit(parseInt(e.target.value, 10))}
                                    className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2 py-2 text-xs"
                                  >
                                    <option value={20}>Show 20</option>
                                    <option value={50}>Show 50</option>
                                    <option value={100}>Show 100</option>
                                  </select>
                                </div>
                              </div>

                              <div className="mt-3 overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
                                <table className="min-w-[720px] w-full text-xs">
                                  <thead className="bg-neutral-50 dark:bg-neutral-900/30">
                                    <tr className="text-neutral-700 dark:text-neutral-300">
                                      <th className="text-left p-2 font-semibold">Turn</th>
                                      <th className="text-left p-2 font-semibold">Tag</th>
                                      <th className="text-right p-2 font-semibold">Ut</th>
                                      <th className="text-right p-2 font-semibold">R</th>
                                      <th className="text-right p-2 font-semibold">K</th>
                                      <th className="text-right p-2 font-semibold">M</th>
                                      <th className="text-right p-2 font-semibold">C</th>
                                      <th className="text-right p-2 font-semibold">I</th>
                                      <th className="text-right p-2 font-semibold">G</th>
                                      <th className="text-right p-2 font-semibold">D</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {turnsFiltered.map((t) => {
                                      const dims = t.dims ?? ({} as any);
                                      const Ut = clamp01(
                                        (clamp01(dims.R) +
                                          clamp01(dims.K) +
                                          clamp01(dims.M) +
                                          clamp01(dims.C) +
                                          clamp01(dims.I) +
                                          clamp01(dims.G)) /
                                          6
                                      );
                                      return (
                                        <tr key={t.turnId} className="border-t border-neutral-200 dark:border-neutral-800">
                                          <td className="p-2 text-neutral-700 dark:text-neutral-200 tabular-nums">
                                            {t.turnId}
                                          </td>
                                          <td className="p-2">
                                            <span
                                              className={[
                                                "inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold",
                                                tagPillClasses(t.tag),
                                              ].join(" ")}
                                            >
                                              {t.tag}
                                            </span>
                                          </td>
                                          <td className="p-2 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
                                            {fmt(Ut)}
                                          </td>
                                          <td className="p-2 text-right tabular-nums">{fmt(dims.R)}</td>
                                          <td className="p-2 text-right tabular-nums">{fmt(dims.K)}</td>
                                          <td className="p-2 text-right tabular-nums">{fmt(dims.M)}</td>
                                          <td className="p-2 text-right tabular-nums">{fmt(dims.C)}</td>
                                          <td className="p-2 text-right tabular-nums">{fmt(dims.I)}</td>
                                          <td className="p-2 text-right tabular-nums">{fmt(dims.G)}</td>
                                          <td className="p-2 text-right tabular-nums">{fmt(dims.D)}</td>
                                        </tr>
                                      );
                                    })}

                                    {turnsFiltered.length === 0 ? (
                                      <tr>
                                        <td colSpan={10} className="p-3 text-neutral-600 dark:text-neutral-400">
                                          No turns match your filters.
                                        </td>
                                      </tr>
                                    ) : null}
                                  </tbody>
                                </table>
                              </div>

                              <div className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                                Tip: This table is intentionally compact to keep the page readable.
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {advancedTab === "segments" ? (
                          <div className="space-y-3">
                            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
                              <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                                Segments & Coherence
                              </div>
                              <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                                Topic segmentation + per-segment summaries (if provided).
                              </div>

                              <div className="mt-3 space-y-2">
                                {(advanced?.segments ?? []).map((s) => {
                                  const summary = (advanced?.segmentSummaries ?? []).find((x) => x.segmentId === s.segmentId);
                                  const share =
                                    typeof s.shareUserTurns === "number"
                                      ? clamp01(s.shareUserTurns)
                                      : clamp01((s.turnIds?.length ?? 0) / Math.max(data.level1?.userTurns ?? 1, 1));
                                  const pct = Math.round(share * 100);

                                  return (
                                    <div
                                      key={s.segmentId}
                                      className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/30 p-3"
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                                          {s.label || "Segment"}
                                        </div>
                                        <div className="text-xs text-neutral-600 dark:text-neutral-400 tabular-nums">
                                          Share: <span className="font-semibold text-neutral-800 dark:text-neutral-200">{pct}%</span>
                                        </div>
                                      </div>

                                      <div className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                                        Turn IDs:{" "}
                                        <span className="font-medium text-neutral-700 dark:text-neutral-200">
                                          {(s.turnIds ?? []).slice(0, 14).join(", ")}
                                          {(s.turnIds ?? []).length > 14 ? " …" : ""}
                                        </span>
                                      </div>

                                      {summary?.summary ? (
                                        <div className="mt-2 text-sm text-neutral-700 dark:text-neutral-200 leading-relaxed">
                                          {summary.summary}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}

                                {(advanced?.segments ?? []).length === 0 ? (
                                  <div className="text-sm text-neutral-600 dark:text-neutral-400">
                                    No segment data returned.
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {showRaw ? (
                      <pre className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-950 text-neutral-100 p-3 text-xs overflow-auto max-h-[260px]">
                        {JSON.stringify(data, null, 2)}
                      </pre>
                    ) : null}
                  </>
                ) : null}

                {/* Empty state */}
                {!data ? (
                  <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/30 p-4">
                    <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Ready when you are</div>
                    <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                      Paste a transcript on the left and click <span className="font-semibold">Analyze</span>.
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}