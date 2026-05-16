// app/api/analyze/route.ts
//
// Restored scoring engine (R/K/M/C/I/G/D + Ut + CP + E + CI) based on your real model.
// IMPORTANT BUILD FIX:
// - Do NOT instantiate OpenAI at module scope (can crash Vercel build if env missing).
// - Instantiate lazily inside request handler.
//
// Env required at runtime (Vercel / local):
// - OPENAI_API_KEY
// - (optional) SCORER_MODEL  e.g. "gpt-4.1-mini"

import OpenAI from "openai";

export const runtime = "nodejs";

type AnalyzeRequestBody = {
  transcript?: string;
};

type Speaker = "user" | "assistant";
type Turn = { id: string; speaker: Speaker; text: string };

type Band =
  | "very_low"
  | "low"
  | "mild_moderate"
  | "moderate"
  | "moderate_high"
  | "high"
  | "very_high"
  | "advanced";

type ReportMode = "qual_only" | "quant_qual" | "no_report";

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

type ModelScoreOutput = {
  segments: Segment[];
  segment_summaries: Array<{ segmentId: string; summary: string }>;
  turn_scores: TurnScore[];
  conceptual_share: number;
  qualitative_summary: string;
};

/* ------------------------------ OpenAI client (lazy) ------------------------------ */

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

/* ------------------------------ Utilities ------------------------------ */

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function mean(nums: number[]): number {
  const arr = (nums ?? []).filter((n) => Number.isFinite(n));
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function band10Code(xRaw: number): Band {
  const x = clamp01(xRaw);
  if (x <= 0.10) return "very_low";
  if (x <= 0.20) return "low";
  if (x <= 0.30) return "mild_moderate";
  if (x <= 0.40) return "moderate";
  if (x <= 0.50) return "moderate_high";
  if (x <= 0.60) return "high";
  if (x <= 0.70) return "very_high";
  return "advanced";
}

function labelFromBand(b: Band): string {
  switch (b) {
    case "very_low":
      return "Very Low";
    case "low":
      return "Low";
    case "mild_moderate":
      return "Mild–Moderate";
    case "moderate":
      return "Moderate";
    case "moderate_high":
      return "Moderate–High";
    case "high":
      return "High";
    case "very_high":
      return "Very High";
    case "advanced":
      return "Advanced";
  }
}

function buildTranscript(turns: Turn[]) {
  return turns.map((t) => `[${t.id}] ${t.speaker.toUpperCase()}: ${t.text}`).join("\n");
}

function splitTranscript(transcript: string): Turn[] {
  const rawLines = (transcript ?? "").replace(/\r\n/g, "\n").split("\n");
  const lines = rawLines
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^```/.test(l))
    .filter((l) => !/^text\s+id\s*=\s*".*"\s*$/i.test(l))
    .map((l) => l.replace(/^(>{1,3}|>>+|\s*\|\s*)\s*/g, "").trim())
    .filter(Boolean);

  const turns: Turn[] = [];
  let idx = 1;

  const userPrefix = /^(\s*(\d+[\)\.\-]\s*)?)(u(?:ser)?|human)\s*\d*\s*[:\-]\s*/i;
  const asstPrefix = /^(\s*(\d+[\)\.\-]\s*)?)(a(?:ssistant)?|bot|chatgpt)\s*\d*\s*[:\-]\s*/i;

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;

    let speaker: Speaker = "user";
    let textOut = raw;

    if (asstPrefix.test(raw)) {
      speaker = "assistant";
      textOut = raw.replace(asstPrefix, "");
    } else if (userPrefix.test(raw)) {
      speaker = "user";
      textOut = raw.replace(userPrefix, "");
    } else {
      speaker = "user";
      textOut = raw;
    }

    const clean = textOut.trim();
    if (!clean) continue;

    turns.push({ id: `turn_${idx++}`, speaker, text: clean });
  }

  return turns;
}

function countUserTurns(turns: Turn[]) {
  return turns.filter((t) => t.speaker === "user" && t.text.trim().length > 0).length;
}

/* --------------------- Participation Richness (Sp) --------------------- */

function computeSpFromTurnScores(turnScores: Array<{ tag: string }>) {
  const n = Math.max(1, (turnScores ?? []).length);
  const isConceptualish = (tag: string) => tag === "conceptual" || tag === "mixed";

  let conceptualishCount = 0;
  let longestStreak = 0;
  let currentStreak = 0;

  for (const t of turnScores ?? []) {
    if (isConceptualish(t.tag)) {
      conceptualishCount++;
      currentStreak++;
      if (currentStreak > longestStreak) longestStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  const ratio = conceptualishCount / n;
  const streakScore = clamp01((longestStreak - 1) / 4);

  let Sp = 0.65 * ratio + 0.35 * streakScore;

  const sizeFactor = clamp01(n / 6);
  Sp *= sizeFactor;

  return clamp01(Sp);
}

/* ------------------------ Ut series + mean dims ------------------------ */

function computeUtSeries(turnScores: TurnScore[]): Array<{
  turnId: string;
  Ut: number;
  dims: Dims7;
}> {
  const arr = Array.isArray(turnScores) ? turnScores : [];

  return arr.map((t, i) => {
    const dimsIn = (t?.dims ?? {}) as any;
    const dims: Dims7 = {
      R: clamp01(dimsIn.R),
      K: clamp01(dimsIn.K),
      M: clamp01(dimsIn.M),
      C: clamp01(dimsIn.C),
      I: clamp01(dimsIn.I),
      G: clamp01(dimsIn.G),
      D: clamp01(dimsIn.D),
    };

    const Ut = clamp01(mean([dims.R, dims.K, dims.M, dims.C, dims.I, dims.G]));

    return {
      turnId: String(t?.turnId ?? `turn_${i + 1}`),
      Ut,
      dims,
    };
  });
}

function meanDims(series: Array<{ Ut: number; dims: Dims7 }>) {
  const arr = Array.isArray(series) ? series : [];
  if (arr.length === 0) {
    return { Ut: 0, R: 0, K: 0, M: 0, C: 0, I: 0, G: 0, D: 0 };
  }

  return {
    Ut: clamp01(mean(arr.map((x) => clamp01(x.Ut)))),
    R: clamp01(mean(arr.map((x) => clamp01(x.dims.R)))),
    K: clamp01(mean(arr.map((x) => clamp01(x.dims.K)))),
    M: clamp01(mean(arr.map((x) => clamp01(x.dims.M)))),
    C: clamp01(mean(arr.map((x) => clamp01(x.dims.C)))),
    I: clamp01(mean(arr.map((x) => clamp01(x.dims.I)))),
    G: clamp01(mean(arr.map((x) => clamp01(x.dims.G)))),
    D: clamp01(mean(arr.map((x) => clamp01(x.dims.D)))),
  };
}

/* -------------------------- Session E computation -------------------------- */

function computeSessionE(input: {
  dimMeans: Record<string, number>;
  UtSeries: number[];
  conceptualShare: number;
  participationRichness: number;
  userTurnsCount: number;
}) {
  const dimMeans = input?.dimMeans ?? {};
  const ut = Array.isArray(input?.UtSeries) ? input.UtSeries : [];
  const conceptualShare = clamp01(input?.conceptualShare ?? 0);
  const participationRichness = clamp01(input?.participationRichness ?? 0);
  const userTurnsCount = Math.max(0, Number(input?.userTurnsCount ?? 0));

  const UtMean = clamp01(mean(ut.map(clamp01)));

  const Sd = clamp01(mean([dimMeans.R, dimMeans.K, dimMeans.M, dimMeans.C, dimMeans.I, dimMeans.G].map(clamp01)));
  const St = UtMean;
  const Sc = conceptualShare;
  const Sp = participationRichness;

  const Ecore = clamp01(0.40 * Sd + 0.25 * Sc + 0.20 * Sp + 0.15 * St);

  const durationBonus = clamp01((userTurnsCount - 5) / 25) * 0.08;
  const qualityGate = clamp01(0.65 + 0.35 * Sc);

  const E = clamp01((Ecore + durationBonus) * qualityGate);

  let tr: "increasing" | "decreasing" | "stable" = "stable";
  if (ut.length >= 3) {
    const first = mean(ut.slice(0, Math.ceil(ut.length / 3)));
    const last = mean(ut.slice(Math.floor((2 * ut.length) / 3)));
    const diff = last - first;
    if (diff > 0.07) tr = "increasing";
    else if (diff < -0.07) tr = "decreasing";
  }

  return { E, Sd, St, Sc, Sp, Ecore, durationBonus, qualityGate, nTurns: userTurnsCount, tr };
}

/* ----------------------- Cognitive discontinuity mode ----------------------- */

function norm(s: string) {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function segmentCategory(label: string): "topic" | "email" | "code" | "formatting" | "translation" | "admin" {
  const t = norm(label);

  if (/\b(email|mail|letter|cover letter|recommendation|application|subject line|reply)\b/.test(t)) return "email";
  if (/\b(code|coding|debug|bug|error|stack|typescript|javascript|python|node|react|next|api|server|vercel|git|github)\b/.test(t)) return "code";
  if (/\b(rewrite|rephrase|paraphrase|summarize|shorten|condense|bullet|format|proofread|grammar|tone|style)\b/.test(t)) return "formatting";
  if (/\b(translate|translation|urdu|english)\b/.test(t)) return "translation";
  if (/\b(schedule|meeting|appointment|deadline|reminder|invoice|billing|account|login)\b/.test(t)) return "admin";

  return "topic";
}

function decideReportMode(segments: Segment[], userTurnsCount: number, minUserTurnsForQuant = 5): { mode: ReportMode; reason?: string } {
  if (userTurnsCount < minUserTurnsForQuant) {
    return { mode: "qual_only", reason: `Too few user turns (${userTurnsCount}) for reliable quantitative scoring (requires ≥ ${minUserTurnsForQuant}).` };
  }

  const segs = (segments ?? []).map((s) => ({
    ...s,
    shareUserTurns:
      typeof s.shareUserTurns === "number"
        ? clamp01(s.shareUserTurns)
        : clamp01((s.turnIds?.length ?? 0) / Math.max(userTurnsCount, 1)),
  }));

  const substantial = segs.filter((s) => (s.shareUserTurns ?? 0) >= 0.15);
  const dominant = substantial.find((s) => (s.shareUserTurns ?? 0) >= 0.70);
  if (dominant) return { mode: "quant_qual" };

  const categories = substantial.map((s) => segmentCategory(s.label));
  const distinct = Array.from(new Set(categories));

  if (distinct.length === 1 && distinct[0] === "topic") return { mode: "quant_qual" };

  const hasUtility = distinct.some((c) => c !== "topic");

  if (hasUtility && distinct.length >= 3) {
    return { mode: "no_report", reason: "Session contains multiple unrelated task segments (cognitive discontinuity); a single quantitative score would be misleading." };
  }

  if (hasUtility && distinct.length >= 2) {
    return { mode: "qual_only", reason: "Unrelated task shift detected (topic → utility); quantitative scoring is suppressed for reliability." };
  }

  return { mode: "quant_qual" };
}

/* ------------------- Operational suppression + dependency calibration ------------------- */

function cap(x: number, max: number) {
  return Math.min(clamp01(x), max);
}

function buildUserTurnTextMap(turns: Turn[]) {
  const map = new Map<string, string>();
  for (const t of turns) {
    if (t.speaker === "user") map.set(t.id, t.text ?? "");
  }
  return map;
}

function normText(s: string) {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

const OPERATIONAL_PATTERNS: RegExp[] = [
  /^(define|definition of)\b/,
  /^what is\b/,
  /^whats\b/,
  /^meaning of\b/,
  /^explain\b/,
  /^tell me\b/,
  /\bsummarize\b/,
  /\bshort(en)?\b/,
  /\bconcise\b/,
  /\bone line\b/,
  /\bmain points?\b/,
  /\bkey points?\b/,
  /\bbullets?\b/,
  /\brewrite\b/,
  /\brephrase\b/,
  /\bparaphrase\b/,
  /\bsimplif(y|ication)\b/,
  /\beasy (words|language)\b/,
  /\bmake it easy\b/,
  /\bmake it simpler\b/,
  /\bgrammar\b/,
  /\bproofread\b/,
  /\btone\b/,
  /\bstyle\b/,
  /\btranslate\b/,
];

const CONCEPTUAL_MARKERS: RegExp[] = [
  /\bwhy\b/,
  /\bhow\b/,
  /\bmechanism\b/,
  /\bcause\b/,
  /\beffect\b/,
  /\btrade[- ]?off\b/,
  /\bcompare\b/,
  /\bcontrast\b/,
  /\bdifference\b/,
  /\bimplication(s)?\b/,
  /\blimitation(s)?\b/,
  /\bevidence\b/,
  /\bcritique\b/,
  /\bevaluate\b/,
  /\bhypothesis\b/,
  /\bassumption\b/,
  /\bwhat if\b/,
  /\bi think\b/,
  /\bi wonder\b/,
  /\bi suspect\b/,
  /\bdoes that mean\b/,
  /\bis that reasonable\b/,
  /\bmy understanding\b/,
  /\bso\b/,
  /\btherefore\b/,
];

const ELABORATION_MARKERS: RegExp[] = [
  /\bi think\b/,
  /\bthis means\b/,
  /\bdoes that mean\b/,
  /\bso\b/,
  /\btherefore\b/,
  /\bin other words\b/,
  /\blet me\b/,
  /\bmy understanding\b/,
  /\bif i assume\b/,
  /\bif that assumption\b/,
  /\btest my understanding\b/,
  /\blimitation(s)?\b/,
  /\bevidence\b/,
  /\btrade[- ]?off\b/,
  /\bcounterexample\b/,
  /\bframework\b/,
  /\bloop\b/,
  /\bconnect\b/,
  /\brelationship\b/,
  /\bintegrat(e|ion)\b/,
];

function countMatches(text: string, patterns: RegExp[]) {
  let c = 0;
  for (const p of patterns) if (p.test(text)) c++;
  return c;
}

function isQuestionHeavy(textRaw: string) {
  const t = normText(textRaw);
  if (!t) return false;
  const qmarks = (t.match(/\?/g) || []).length;
  const words = t.split(" ").filter(Boolean).length;
  return qmarks >= 1 && words <= 28;
}

function classifyTurn(textRaw: string): {
  forcedTag: "operational" | "conceptual" | "mixed";
  formattingOnly: boolean;
  hasElaboration: boolean;
  questionHeavy: boolean;
} {
  const t = normText(textRaw);
  if (!t) return { forcedTag: "operational", formattingOnly: true, hasElaboration: false, questionHeavy: false };

  const opHits = countMatches(t, OPERATIONAL_PATTERNS);
  const conHits = countMatches(t, CONCEPTUAL_MARKERS);
  const hasElaboration = countMatches(t, ELABORATION_MARKERS) > 0;
  const questionHeavy = isQuestionHeavy(t);

  const hasQuestion = t.includes("?");
  const isShort = t.length <= 80;

  const formattingOnly = opHits > 0 && conHits === 0 && (isShort || !hasQuestion);

  const forcedOperational =
    formattingOnly ||
    (opHits > 0 && conHits === 0 && isShort) ||
    (/^(define|what is|explain)\b/.test(t) && conHits === 0);

  const forcedMixed = opHits > 0 && conHits > 0;
  const forcedConceptual = conHits > 0 && opHits === 0 && (!questionHeavy || hasElaboration);

  if (forcedOperational) return { forcedTag: "operational", formattingOnly, hasElaboration, questionHeavy };
  if (forcedMixed) return { forcedTag: "mixed", formattingOnly: false, hasElaboration, questionHeavy };
  if (forcedConceptual) return { forcedTag: "conceptual", formattingOnly: false, hasElaboration, questionHeavy };
  if (conHits > 0 && opHits === 0) return { forcedTag: "mixed", formattingOnly: false, hasElaboration, questionHeavy };

  return { forcedTag: "operational", formattingOnly: false, hasElaboration, questionHeavy };
}

const QUESTION_DEPTH_PATTERNS = {
  retrieval: [/^(what is|whats)\b/, /^\bdefine\b/, /\bmeaning of\b/, /\blist\b/],
  causal: [/\bwhy\b/, /\bwhat causes\b/, /\bcauses of\b/, /\bhow does\b/, /\bmechanism\b/],
  analytical: [/\bcompare\b/, /\bcontrast\b/, /\bdifference\b/, /\bevaluate\b/, /\bcritique\b/, /\blimitations?\b/, /\btrade[- ]?off\b/],
  integrative: [/\binteract\b/, /\bintegrat(e|ion)\b/, /\bcombine\b/, /\brelationship\b/, /\brelated\b/, /\bconnected\b/, /\bconnect\b/],
  reflective: [/\bi think\b/, /\bi wonder\b/, /\bi suspect\b/, /\bis that reasonable\b/, /\bdoes that mean\b/, /\bi'?m confused\b/, /\bmy understanding\b/],
  applied: [/\bhow can\b/, /\bhow should\b/, /\bwhat should\b/, /\bmanage\b/, /\bsolution\b/, /\badvise\b/],
};

function detectQuestionDepth(textRaw: string) {
  const t = normText(textRaw);
  return {
    retrieval: countMatches(t, QUESTION_DEPTH_PATTERNS.retrieval),
    causal: countMatches(t, QUESTION_DEPTH_PATTERNS.causal),
    analytical: countMatches(t, QUESTION_DEPTH_PATTERNS.analytical),
    integrative: countMatches(t, QUESTION_DEPTH_PATTERNS.integrative),
    reflective: countMatches(t, QUESTION_DEPTH_PATTERNS.reflective),
    applied: countMatches(t, QUESTION_DEPTH_PATTERNS.applied),
  };
}

function applyOperationalSuppression(out: ModelScoreOutput, turns: Turn[]) {
  const userTextById = buildUserTurnTextMap(turns);

  for (const ts of out.turn_scores) {
    const rawText = userTextById.get(ts.turnId) ?? "";
    const cls = classifyTurn(rawText);
    const qd = detectQuestionDepth(rawText);

    const higherOrderCount = qd.causal + qd.analytical + qd.integrative + qd.reflective + qd.applied;

    ts.tag = cls.forcedTag;

    if (ts.tag === "operational" && !cls.formattingOnly && higherOrderCount > 0 && qd.retrieval === 0) {
      ts.tag = "mixed";
    }

    ts.dims.R = clamp01(ts.dims.R);
    ts.dims.K = clamp01(ts.dims.K);
    ts.dims.M = clamp01(ts.dims.M);
    ts.dims.C = clamp01(ts.dims.C);
    ts.dims.I = clamp01(ts.dims.I);
    ts.dims.G = clamp01(ts.dims.G);
    ts.dims.D = clamp01(ts.dims.D);

    const isPureRetrieval =
      qd.retrieval > 0 &&
      qd.causal === 0 &&
      qd.analytical === 0 &&
      qd.integrative === 0 &&
      qd.reflective === 0 &&
      qd.applied === 0;

    const boostScale = cls.hasElaboration ? 1.0 : 0.55;
    const allowBoost = ts.tag !== "operational" || higherOrderCount > 0;

    if (allowBoost && !isPureRetrieval) {
      if (qd.causal > 0) ts.dims.R = clamp01(ts.dims.R + 0.18 * boostScale);

      if (qd.analytical > 0) {
        ts.dims.R = clamp01(ts.dims.R + 0.12 * boostScale);
        ts.dims.C = clamp01(ts.dims.C + 0.20 * boostScale);
      }

      if (qd.integrative > 0) {
        ts.dims.G = clamp01(ts.dims.G + 0.25 * boostScale);
        ts.dims.R = clamp01(ts.dims.R + 0.10 * boostScale);
      }

      if (qd.reflective > 0) {
        ts.dims.M = clamp01(ts.dims.M + 0.22 * boostScale);
        ts.dims.I = clamp01(ts.dims.I + 0.10 * boostScale);
      }

      if (qd.applied > 0) {
        ts.dims.I = clamp01(ts.dims.I + 0.18 * boostScale);
        ts.dims.R = clamp01(ts.dims.R + 0.10 * boostScale);
      }

      if (cls.questionHeavy && !cls.hasElaboration && ts.tag === "conceptual") {
        ts.tag = "mixed";
      }
    }

    if (isPureRetrieval) {
      ts.tag = "operational";
      ts.dims.R = cap(ts.dims.R, 0.20);
      ts.dims.C = cap(ts.dims.C, 0.15);
      ts.dims.G = cap(ts.dims.G, 0.15);
      ts.dims.M = cap(ts.dims.M, 0.15);
      ts.dims.I = cap(ts.dims.I, 0.25);
    }

    if (ts.tag === "operational") {
      ts.dims.R = cap(ts.dims.R, 0.20);
      ts.dims.K = cap(ts.dims.K, 0.20);
      ts.dims.M = cap(ts.dims.M, 0.20);
      ts.dims.C = cap(ts.dims.C, 0.20);
      ts.dims.G = cap(ts.dims.G, 0.20);
      if (cls.formattingOnly) ts.dims.I = cap(ts.dims.I, 0.35);
    }
  }

  const n = out.turn_scores.length || 1;
  const conceptualCount = out.turn_scores.reduce((acc, t) => {
    if (t.tag === "conceptual") return acc + 1;
    if (t.tag === "mixed") return acc + 0.5;
    return acc;
  }, 0);

  out.conceptual_share = clamp01(conceptualCount / n);

  // Dependency calibration (your rule)
  const D_ALPHA = 0.60;
  const W_CP = 0.60;
  const W_COG = 0.40;

  const cogProxy = clamp01(
    out.turn_scores.reduce((acc, ts) => {
      const c = (ts.dims.R + ts.dims.K + ts.dims.M + ts.dims.C + ts.dims.I + ts.dims.G) / 6;
      return acc + clamp01(c);
    }, 0) / n
  );

  const Q = clamp01(W_CP * out.conceptual_share + W_COG * cogProxy);
  const multiplier = clamp01(1 - D_ALPHA * Q);

  for (const ts of out.turn_scores) {
    ts.dims.D = clamp01(ts.dims.D * multiplier);
  }

  return out;
}

/* ------------------------------ Model schema ------------------------------ */

const SCORE_SCHEMA = {
  name: "offloading_session_score",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["segments", "turn_scores", "conceptual_share", "qualitative_summary", "segment_summaries"],
    properties: {
      segments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["segmentId", "label", "turnIds"],
          properties: {
            segmentId: { type: "string" },
            label: { type: "string" },
            turnIds: { type: "array", items: { type: "string" } },
          },
        },
      },
      segment_summaries: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["segmentId", "summary"],
          properties: {
            segmentId: { type: "string" },
            summary: { type: "string" },
          },
        },
      },
      turn_scores: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["turnId", "tag", "dims"],
          properties: {
            turnId: { type: "string" },
            tag: { type: "string", enum: ["operational", "conceptual", "mixed"] },
            dims: {
              type: "object",
              additionalProperties: false,
              required: ["R", "K", "M", "C", "I", "G", "D"],
              properties: {
                R: { type: "number", minimum: 0, maximum: 1 },
                K: { type: "number", minimum: 0, maximum: 1 },
                M: { type: "number", minimum: 0, maximum: 1 },
                C: { type: "number", minimum: 0, maximum: 1 },
                I: { type: "number", minimum: 0, maximum: 1 },
                G: { type: "number", minimum: 0, maximum: 1 },
                D: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
        },
      },
      conceptual_share: { type: "number", minimum: 0, maximum: 1 },
      qualitative_summary: { type: "string" },
    },
  },
} as const;

const RUBRIC = `
You are scoring USER cognitive engagement in a human–AI chat using 7 dimensions (R,K,M,C,I,G,D).
Cognitive engagement = observable participation in thinking (reasoning, reflection, evaluation, integration, knowledge use)
during interaction. Interaction quantity alone is NOT engagement.

IMPORTANT:
- Do NOT infer cognition from politeness, verbosity, persistence, repeated refinement, or topic continuity.
- Formatting, rewriting, summarizing, simplifying, or style-control requests alone are LOW cognitive engagement unless the user
  explicitly demonstrates conceptual reasoning/evaluation/integration in the same turn.

Tag definitions:
- operational: formatting/rewrite/summarize/simplify/style/output-generation/delegation WITHOUT explicit conceptual reasoning.
- conceptual: explicit cognitive moves (why/how, causal reasoning, implications, limitations, evidence critique, comparison,
  integration/synthesis, hypothesis, reflective confusion, testing alternatives).
- mixed: both operational + conceptual in the same turn.

Hard constraints:
- If tag = operational, do NOT inflate R,K,M,C,G unless the transcript explicitly demonstrates those cognitive moves.
  Operational turns normally keep: R,K,M,C,G <= 0.20
- If the turn is formatting-only (style/length/format edits with no conceptual content), keep Initiative low:
  formatting-only normally keeps: I <= 0.35
- D (Dependency) may be HIGH on operational turns if the user is delegating work.
`.trim();

async function scoreWithModel(turns: Turn[], client: OpenAI): Promise<ModelScoreOutput> {
  const transcript = buildTranscript(turns);

  const tasks = `
Tasks:
1) Segment the session into coherent topic segments. Unrelated topics MUST be separate segments.
   - segments[].turnIds MUST include only USER turn IDs.
2) For each USER turn, output dims (0..1) and tag (operational/conceptual/mixed).
3) conceptual_share = fraction of USER turns that are conceptual (mixed counts as 0.5).
4) qualitative_summary: 4-7 sentences summarizing engagement pattern for the whole session.
5) segment_summaries: 1-2 sentences per segment describing engagement in that segment.
`.trim();

  const prompt = `
You are scoring USER engagement in a human-AI chat session using 7 dimensions (R,K,M,C,I,G,D).
Score ONLY USER turns.

${tasks}

${RUBRIC}

Transcript:
${transcript}
`.trim();

  const resp = await client.responses.create({
    model: process.env.SCORER_MODEL ?? "gpt-4.1-mini",
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: SCORE_SCHEMA.name,
        schema: SCORE_SCHEMA.schema,
        strict: true,
      },
    },
  } as any);

  const outText = (resp as any).output_text ?? "";
  const parsed = JSON.parse(outText) as ModelScoreOutput;

  return applyOperationalSuppression(parsed, turns);
}

/* ---------------------- Score-aligned short summaries ---------------------- */

function quickInterpretationFromBands(Eb: Band, CPb: Band, CIb: Band) {
  const strength =
    Eb === "advanced" || Eb === "very_high" ? "strong" :
    Eb === "high" || Eb === "moderate_high" ? "good" :
    Eb === "moderate" ? "moderate" :
    "limited";

  const concept =
    CPb === "advanced" || CPb === "very_high" ? "high conceptual participation" :
    CPb === "high" || CPb === "moderate_high" ? "solid conceptual participation" :
    CPb === "moderate" ? "some conceptual participation" :
    "mostly operational engagement";

  const collab =
    CIb === "advanced" || CIb === "very_high" ? "high collaboration quality" :
    CIb === "high" || CIb === "moderate_high" ? "good collaboration quality" :
    CIb === "moderate" ? "moderate collaboration quality" :
    "low collaboration quality";

  return `${strength[0].toUpperCase() + strength.slice(1)} engagement with ${concept} and ${collab}.`;
}

function scoreSummary(E: number, CP: number, CI: number, tr: "increasing" | "decreasing" | "stable") {
  const trText = tr === "increasing" ? "Engagement increases across turns." : tr === "decreasing" ? "Engagement tapers over time." : "Engagement stays fairly stable.";
  const eTxt = E >= 0.61 ? "Overall engagement is high." : E >= 0.41 ? "Overall engagement is moderate." : "Overall engagement is low.";
  const cpTxt = CP >= 0.55 ? "Many turns show conceptual thinking (or mixed conceptual moves)." : CP >= 0.35 ? "Some conceptual turns appear, but operational turns remain common." : "Most turns are operational with limited conceptual processing.";
  const ciTxt = CI >= 0.60 ? "Collaboration looks strong (co-thinking rather than simple delegation)." : CI >= 0.40 ? "Collaboration is present but uneven." : "Interaction leans toward delegation/offloading rather than co-thinking.";
  return `${eTxt} ${trText} ${cpTxt} ${ciTxt}`;
}

/* ------------------------------- Handlers ------------------------------- */

export async function GET() {
  return Response.json({ ok: true, message: "Use POST with { transcript }" });
}

export async function POST(req: Request) {
  let body: AnalyzeRequestBody;

  try {
    body = (await req.json()) as AnalyzeRequestBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const transcript = (body.transcript ?? "").trim();
  if (!transcript) {
    return Response.json({ ok: false, error: "Missing transcript string" }, { status: 400 });
  }

  const turns = splitTranscript(transcript);
  const userTurnsCount = countUserTurns(turns);
  const MIN_USER_TURNS = 5;

  if (userTurnsCount < MIN_USER_TURNS) {
    return Response.json({
      ok: true,
      meta: {
        userTurnsCount,
        quantitativeSuppressed: true,
        suppressedReason: `Quantitative estimates require at least ${MIN_USER_TURNS} user turns.`,
      },
      mode: "qual_only" as ReportMode,
      qualitativeSummary: "Add more user turns (at least 5) to compute reliable quantitative scores.",
    });
  }

  // Build-safe: create client only at runtime
  const client = getClient();
  if (!client) {
    return Response.json(
      { ok: false, error: "OPENAI_API_KEY is not set on the server (Vercel env vars). Add it and redeploy." },
      { status: 500 }
    );
  }

  let scored: ModelScoreOutput;
  try {
    scored = await scoreWithModel(turns, client);
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message || "Scoring model error. Check OPENAI_API_KEY and SCORER_MODEL." },
      { status: 500 }
    );
  }

  const modeDecision = decideReportMode(scored.segments ?? [], userTurnsCount, MIN_USER_TURNS);

  const qualitativeSummary = scored.qualitative_summary ?? "";
  const segmentSummaries = scored.segment_summaries ?? [];

  if (modeDecision.mode === "qual_only" || modeDecision.mode === "no_report") {
    return Response.json({
      ok: true,
      meta: {
        userTurnsCount,
        segmentsCount: (scored.segments ?? []).length,
        quantitativeSuppressed: true,
        suppressedReason: modeDecision.reason ?? "Quantitative scoring suppressed.",
      },
      mode: modeDecision.mode,
      qualitativeSummary,
      segmentSummaries,
      segments: scored.segments ?? [],
    });
  }

  const utObjs = computeUtSeries(scored.turn_scores ?? []);
  const means = meanDims(utObjs);
  const Sp = computeSpFromTurnScores(scored.turn_scores ?? []);

  const session = computeSessionE({
    dimMeans: means,
    UtSeries: utObjs.map((x) => x.Ut),
    conceptualShare: clamp01(scored.conceptual_share ?? 0),
    participationRichness: Sp,
    userTurnsCount,
  });

  const E = session.E;
  const CP = clamp01(scored.conceptual_share ?? 0);
  const CI = clamp01((E + CP) / 2);

  const Eb = band10Code(E);
  const CPb = band10Code(CP);
  const CIb = band10Code(CI);

  return Response.json({
    ok: true,
    meta: {
      userTurnsCount,
      segmentsCount: (scored.segments ?? []).length,
      quantitativeSuppressed: false,
    },
    mode: "quant_qual" as ReportMode,
    level1: {
      E,
      engagementBand: Eb,
      engagementLabel: labelFromBand(Eb),
      CP,
      CPBand: CPb,
      CPLabel: labelFromBand(CPb),
      collaborativeIndex: CI,
      collaborativeBand: CIb,
      collaborativeLabel: labelFromBand(CIb),
      trajectory: session.tr,
      userTurns: userTurnsCount,
    },
    quickInterpretation: quickInterpretationFromBands(Eb, CPb, CIb),
    scoreAlignedSummary: scoreSummary(E, CP, CI, session.tr),
    qualitativeSummary,
    advanced: {
      dimensionMeans: means,
      UtSeries: utObjs,
      turnScores: scored.turn_scores ?? [],
      segments: scored.segments ?? [],
      segmentSummaries,
      components: {
        Sd: session.Sd,
        St: session.St,
        Sc: session.Sc,
        Sp: session.Sp,
        Ecore: session.Ecore,
        durationBonus: session.durationBonus,
        qualityGate: session.qualityGate,
      },
    },
  });
}