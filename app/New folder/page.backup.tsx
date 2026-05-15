"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

type ApiResult = any;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
function toPct(n01: number) {
  return Math.round(clamp(n01, 0, 1) * 100);
}
function formatFixed5Range(center01: number) {
  const half = 0.025;
  const lo = clamp(center01 - half, 0, 1);
  const hi = clamp(center01 + half, 0, 1);
  return `${toPct(lo)}% – ${toPct(hi)}%`;
}

type Band = "LOW" | "MODERATE" | "HIGH" | "MIXED";

function bandLabelPretty(b: Band) {
  if (b === "LOW") return "Low";
  if (b === "MODERATE") return "Moderate";
  if (b === "HIGH") return "High";
  return "Mixed / fragmented";
}
function gradientForBand(band: Band) {
  if (band === "MIXED") return "from-purple-600 to-slate-700";
  if (band === "LOW") return "from-rose-600 to-orange-600";
  if (band === "MODERATE") return "from-amber-500 to-orange-600";
  return "from-emerald-500 to-indigo-600";
}
function aiUsageFromBand(band: Band, center: number | null | undefined) {
  if (band === "MIXED") return "—";
  if (band === "LOW") return center !== null && center <= 0.22 ? "Very heavy AI assistance" : "Heavy AI assistance";
  if (band === "MODERATE") return "Balanced AI assistance";
  return "Active collaboration";
}
function simpleInterpretationFromBand(band: Band) {
  if (band === "MIXED") return "Multiple unrelated topic shifts were detected, so only a qualitative result is shown.";
  if (band === "LOW") return "You mostly used AI to produce or edit output, with limited idea-building from your side.";
  if (band === "MODERATE") return "You used AI for support while still participating in the thinking process.";
  return "You actively explored ideas and used AI mainly to refine, test, and integrate your thinking.";
}

/** Deterministic hash */
function hashStringToUint32(str: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Local storage helpers */
function loadHistory(key: string): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x))
      .map((x) => clamp(x, 0, 1));
  } catch {
    return [];
  }
}
function saveHistory(key: string, arr: number[]) {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}
function median(arr: number[]) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}
function updateHistoryMedian(
  key: string,
  value: number,
  opts?: { maxN?: number; resetThreshold?: number; minNToReset?: number }
) {
  const maxN = opts?.maxN ?? 15;
  const resetThreshold = opts?.resetThreshold ?? 0.18;
  const minNToReset = opts?.minNToReset ?? 5;

  const hist = loadHistory(key);
  if (hist.length >= minNToReset) {
    const m = median(hist);
    if (Math.abs(m - value) >= resetThreshold) {
      const fresh = [value];
      saveHistory(key, fresh);
      return value;
    }
  }
  const withNew = [...hist, value].slice(-maxN);
  saveHistory(key, withNew);
  return median(withNew);
}

function tokenizeCount(s: string) {
  return (s || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}
function lc(s: string) {
  return (s || "").toLowerCase();
}
function countHits(hay: string, patterns: (string | RegExp)[]) {
  let c = 0;
  for (const p of patterns) {
    if (typeof p === "string") {
      const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      const m = hay.match(re);
      c += m ? m.length : 0;
    } else {
      const m = hay.match(p);
      c += m ? m.length : 0;
    }
  }
  return c;
}

/**
 * Parse conversation in U:/A: format.
 * IMPORTANT FIX: if no U:/A: markers exist, fallback to "user-only lines".
 */
function parseTurns(text: string) {
  const lines = text.split(/\r?\n/);

  const turns: { role: "U" | "A"; text: string }[] = [];
  let current: { role: "U" | "A"; text: string } | null = null;

  const pushCurrent = () => {
    if (current && current.text.trim()) turns.push({ ...current, text: current.text.trim() });
    current = null;
  };

  let sawMarkers = false;

  for (const raw of lines) {
    const line = raw ?? "";
    const uMatch = line.match(/^\s*U\s*:\s*(.*)$/i);
    const aMatch = line.match(/^\s*A\s*:\s*(.*)$/i);

    if (uMatch) {
      sawMarkers = true;
      pushCurrent();
      current = { role: "U", text: uMatch[1] ?? "" };
      continue;
    }
    if (aMatch) {
      sawMarkers = true;
      pushCurrent();
      current = { role: "A", text: aMatch[1] ?? "" };
      continue;
    }
    if (current) current.text += "\n" + line;
  }

  pushCurrent();

  // FALLBACK: no markers at all => treat each non-empty line as a USER turn
  if (!sawMarkers) {
    const userTurns = lines.map((l) => l.trim()).filter((l) => l.length > 0);
    return {
      turns: userTurns.map((t) => ({ role: "U" as const, text: t })),
      userTurns,
      assistantTurns: [] as string[],
      usedFallback: true,
    };
  }

  const userTurns = turns.filter((t) => t.role === "U").map((t) => t.text);
  const assistantTurns = turns.filter((t) => t.role === "A").map((t) => t.text);

  return { turns, userTurns, assistantTurns, usedFallback: false };
}

/**
 * Marker sets (student-realistic)
 */
const LOW_REWRITE_PHRASES: string[] = [
  "make it short",
  "make it shorter",
  "make it simple",
  "make it simpler",
  "make it easy",
  "important points only",
  "points only",
  "conclusion only",
  "summary only",
  "final answer only",
  "write in paragraph",
  "convert to paragraph",
  "convert to points",
  "write for exam",
  "for 3 marks",
  "for 5 marks",
  "mcq",
  "mcqs",
  "viva",
];

const LOW_DIRECTIVE_PATTERNS: (string | RegExp)[] = [
  "rewrite",
  "paraphrase",
  "simplify",
  "shorten",
  "expand",
  "summarize",
  "summary",
  "conclusion",
  "bullet",
  "points",
  "notes",
  "paragraph",
  "grammar",
  "correct",
  "fix",
  "easy",
  "simple",
  "concise",
  "provide",
  "give",
  "write",
  "generate",
  /(\b\d+\s*marks?\b)/i,
  "answer only",
  "final answer",
  "equation",
  "formula",
  "unit",
];

const LOW_ANSWER_EXTRACTION: (string | RegExp)[] = [
  /^what is\b/i,
  /^define\b/i,
  /^state\b/i,
  /^list\b/i,
  /^write\b/i,
  /^give\b/i,
  /^tell me\b/i,
  /^solve\b/i,
  /^find\b/i,
];

const HOC_CRIT: (string | RegExp)[] = [
  "limitations",
  "bias",
  "evidence",
  "verify",
  "counterexample",
  "alternative",
  "assumption",
  "validity",
  "reliability",
  "method",
  "methodology",
  "measure",
  "measurement",
  "operationalize",
  "testable",
  "replicate",
  "empirical",
  "scientific",
];

const HOC_COMPARE: (string | RegExp)[] = [
  "compare",
  "contrast",
  "difference",
  "vs",
  /versus/i,
  "whereas",
  "on the other hand",
  "rather than",
  "pros",
  "cons",
];

const HOC_INTEGR: (string | RegExp)[] = [
  "therefore",
  "thus",
  "implies",
  "suggests",
  "which means",
  "in other words",
  "this indicates",
  "this reflects",
  "framework",
  "model",
  "integrate",
  "synthesize",
  "connect",
  "link",
];

const HOC_META: (string | RegExp)[] = [
  "i might be wrong",
  "i am not sure",
  "uncertain",
  "let me revise",
  "let me rephrase",
  "i’m wondering",
  "i am wondering",
  "i think",
  "i believe",
];

const HOC_HYP: (string | RegExp)[] = [
  "what if",
  "could it be",
  "suppose",
  "hypothesis",
  "predict",
  "if then",
  "maybe",
  "perhaps",
];

const UCQ_EXAMPLE: (string | RegExp)[] = ["for example", "for instance", "in my case", "scenario"];

function rateTo01(count: number, turns: number, targetRate: number) {
  if (turns <= 0) return 0;
  const r = count / turns;
  return clamp(r / Math.max(1e-6, targetRate), 0, 1);
}

function medianTokenLen(texts: string[]) {
  const lens = texts.map(tokenizeCount).filter((x) => Number.isFinite(x));
  if (lens.length === 0) return 0;
  lens.sort((a, b) => a - b);
  const mid = Math.floor(lens.length / 2);
  if (lens.length % 2 === 1) return lens[mid];
  return (lens[mid - 1] + lens[mid]) / 2;
}

type FeaturePack = {
  turnsCount: number;
  userTurnsCount: number;
  assistantTurnsCount: number;
  userTokens: number;
  assistantTokens: number;
  A_dom: number;

  directiveTurns: number;
  rewriteTurns: number;
  answerExtractionTurns: number;
  contentfulTurns: number;
  ideaTurns: number;

  Cmd: number;
  Rewrite: number;
  ContentThin: number;

  Crit: number;
  Compare: number;
  Integr: number;
  Meta: number;
  Hyp: number;

  HOC: number;
  UCQ: number;
  DO: number;

  usedFallback: boolean;

  evidence: {
    directiveExamples: string[];
    hocExamples: string[];
    userIdeaExamples: string[];
  };
};

function computeFeaturesFromText(text: string): FeaturePack {
  const { turns, userTurns, assistantTurns, usedFallback } = parseTurns(text);

  const userTokens = userTurns.reduce((a, t) => a + tokenizeCount(t), 0);
  const assistantTokens = assistantTurns.reduce((a, t) => a + tokenizeCount(t), 0);
  const totalTokens = userTokens + assistantTokens;

  // If we have no assistant turns (fallback mode), treat dominance as 1.0 (user is delegating to AI implicitly)
  // because the user is asking for answers and the assistant output is simply absent in the pasted text.
  const A_dom = totalTokens > 0 ? assistantTokens / totalTokens : usedFallback ? 1.0 : 0;

  const directiveExamples: string[] = [];
  const hocExamples: string[] = [];
  const userIdeaExamples: string[] = [];

  let directiveTurns = 0;
  let rewriteTurns = 0;
  let answerExtractionTurns = 0;
  let contentfulTurns = 0;
  let ideaTurns = 0;

  let critHits = 0;
  let compareHits = 0;
  let integrHits = 0;
  let metaHits = 0;
  let hypHits = 0;

  for (const ut of userTurns) {
    const u = lc(ut.trim());

    const isDirective =
      countHits(u, LOW_DIRECTIVE_PATTERNS) > 0 || LOW_REWRITE_PHRASES.some((p) => u.includes(p));
    const isRewrite =
      LOW_REWRITE_PHRASES.some((p) => u.includes(p)) ||
      countHits(u, ["rewrite", "paraphrase", "simplify", "shorten", "expand"]) > 0;

    const isAnswerExtraction = countHits(u, LOW_ANSWER_EXTRACTION) > 0;

    const crit = countHits(u, HOC_CRIT);
    const comp = countHits(u, HOC_COMPARE);
    const integ = countHits(u, HOC_INTEGR);
    const meta = countHits(u, HOC_META);
    const hyp = countHits(u, HOC_HYP);

    critHits += crit;
    compareHits += comp;
    integrHits += integ;
    metaHits += meta;
    hypHits += hyp;

    if (isDirective) {
      directiveTurns += 1;
      if (directiveExamples.length < 4) directiveExamples.push(ut.slice(0, 120));
    }
    if (isRewrite) rewriteTurns += 1;
    if (isAnswerExtraction) answerExtractionTurns += 1;

    const tokens = tokenizeCount(ut);
    const hasExample = countHits(u, UCQ_EXAMPLE) > 0;
    const hasWhyHow =
      (/\bwhy\b/i.test(u) || /\bhow\b/i.test(u) || /\bcompare\b/i.test(u) || /\bdifference\b/i.test(u)) &&
      !/^\s*what is\b/i.test(u);

    const hasReasoningConnectors = countHits(u, ["because", "therefore", "thus", "implies", "suggests", "rather than"]) > 0;
    const hasStance = countHits(u, ["i think", "i believe", "i wonder", "maybe", "perhaps"]) > 0;

    const isContentful =
      tokens >= 10 &&
      (hasWhyHow || hasExample || hasReasoningConnectors || hasStance || (crit + comp + integ + meta + hyp > 0)) &&
      !isRewrite;

    if (isContentful) {
      contentfulTurns += 1;
      if (userIdeaExamples.length < 3) userIdeaExamples.push(ut.slice(0, 160));
    }

    const isIdeaTurn =
      tokens >= 12 && (hasStance || hasReasoningConnectors || hasExample || (crit + comp + integ + meta + hyp > 0)) && !isRewrite;

    if (isIdeaTurn) ideaTurns += 1;

    if (crit + comp + integ + meta + hyp > 0) {
      if (hocExamples.length < 4) hocExamples.push(ut.slice(0, 160));
    }
  }

  const userTurnsCount = userTurns.length;
  const assistantTurnsCount = assistantTurns.length;

  const Cmd = userTurnsCount > 0 ? directiveTurns / userTurnsCount : 0;
  const Rewrite = userTurnsCount > 0 ? rewriteTurns / userTurnsCount : 0;
  const ContentThin = userTurnsCount > 0 ? 1 - clamp(contentfulTurns / userTurnsCount, 0, 1) : 1;

  // HOC normalization targets (unchanged here)
  const Crit = rateTo01(critHits, userTurnsCount, 0.15);
  const Compare = rateTo01(compareHits, userTurnsCount, 0.12);
  const Integr = rateTo01(integrHits, userTurnsCount, 0.12);
  const Meta = rateTo01(metaHits, userTurnsCount, 0.10);
  const Hyp = rateTo01(hypHits, userTurnsCount, 0.12);

  const HOC = clamp(0.28 * Crit + 0.18 * Compare + 0.22 * Integr + 0.12 * Meta + 0.20 * Hyp, 0, 1);

  const ideaTurnsRatio = userTurnsCount > 0 ? ideaTurns / userTurnsCount : 0;
  const whyHowRate =
    userTurnsCount > 0
      ? userTurns.filter((t) => (/\bwhy\b|\bhow\b|\bcompare\b|\bdifference\b/i.test(t)) && !/^\s*what is\b/i.test(t)).length /
        userTurnsCount
      : 0;

  const selfExampleRate = userTurnsCount > 0 ? userTurns.filter((t) => countHits(lc(t), UCQ_EXAMPLE) > 0).length / userTurnsCount : 0;

  const medUserLen = medianTokenLen(userTurns);
  const UserLen = clamp(medUserLen / 45, 0, 1);

  const UCQ = clamp(
    0.50 * clamp(ideaTurnsRatio, 0, 1) +
      0.20 * UserLen +
      0.20 * clamp(whyHowRate / 0.20, 0, 1) +
      0.10 * clamp(selfExampleRate / 0.15, 0, 1),
    0,
    1
  );

  // DO: if fallback (user-only lines), treat it as operational by default
  const DO_raw = clamp(0.45 * A_dom + 0.25 * Cmd + 0.20 * Rewrite + 0.10 * ContentThin, 0, 1);
  const DO = usedFallback ? Math.max(DO_raw, 0.75) : DO_raw;

  return {
    turnsCount: turns.length,
    userTurnsCount,
    assistantTurnsCount,
    userTokens,
    assistantTokens,
    A_dom,

    directiveTurns,
    rewriteTurns,
    answerExtractionTurns,
    contentfulTurns,
    ideaTurns,

    Cmd,
    Rewrite,
    ContentThin,

    Crit,
    Compare,
    Integr,
    Meta,
    Hyp,

    HOC,
    UCQ,
    DO,

    usedFallback,

    evidence: { directiveExamples, hocExamples, userIdeaExamples },
  };
}

/**
 * HARD suppression:
 * IMPORTANT FIX: do NOT suppress tiny conversations (N too small).
 */
function computeHardSuppression(result: ApiResult | null) {
  const turns = Number(result?.meta?.turnsCount ?? 0);
  const segments = Number(result?.meta?.segmentsCount ?? 0);
  const fragRatio = turns > 0 ? segments / turns : 0;

  // if very short, segmentation is unstable -> never hard-suppress
  if (turns > 0 && turns < 8) {
    return { hardSuppressed: false, turns, segments, fragRatio };
  }

  const hardSuppressed =
    segments >= 6 ||
    (turns >= 10 && segments >= 5 && fragRatio >= 0.55) ||
    (turns >= 14 && fragRatio >= 0.65);

  return { hardSuppressed, turns, segments, fragRatio };
}

/** Hierarchical comparison: LOW → HIGH → MODERATE */
function classifyEngagement(fp: FeaturePack): { band: Band; reasons: string[] } {
  const reasons: string[] = [];

  const ideaRatio = fp.userTurnsCount > 0 ? fp.ideaTurns / fp.userTurnsCount : 0;

  // LOW triggers (robust baseline)
  const LOW_1 = fp.DO >= 0.60 && fp.HOC <= 0.32;
  const LOW_2 = fp.A_dom >= 0.75 && fp.Cmd >= 0.45;
  const LOW_3 = fp.Cmd >= 0.55 && ideaRatio <= 0.25;
  const LOW_4 = fp.Rewrite >= 0.40 && fp.HOC <= 0.30;
  const LOW_5 = fp.userTurnsCount <= 4 && fp.HOC <= 0.20; // short “define/unit/easy” patterns

  if (LOW_1 || LOW_2 || LOW_3 || LOW_4 || LOW_5) {
    if (LOW_1) reasons.push("High delegation/operational use with weak higher-order signals.");
    if (LOW_2) reasons.push("Assistant-dominant output with frequent directive prompts.");
    if (LOW_3) reasons.push("Mostly directive turns with minimal idea contribution.");
    if (LOW_4) reasons.push("Rewrite/format pressure is high with limited higher-order signals.");
    if (LOW_5) reasons.push("Very short, command-driven interaction with minimal higher-order evidence.");
    return { band: "LOW", reasons };
  }

  // HIGH triggers
  const highCore = fp.HOC >= 0.55 && fp.UCQ >= 0.55 && fp.DO <= 0.52;
  const strongSignals = [fp.Crit >= 0.55, fp.Integr >= 0.55, fp.Hyp >= 0.55, fp.Compare >= 0.55, fp.Meta >= 0.45].filter(Boolean).length;

  if (highCore && strongSignals >= 2) {
    reasons.push("Strong higher-order signals with meaningful user idea contribution.");
    return { band: "HIGH", reasons };
  }

  // MODERATE validity checks
  const modValid = fp.DO < 0.72 && (fp.HOC > 0.25 || fp.UCQ > 0.35);
  if (!modValid) {
    reasons.push("Insufficient evidence to escape LOW baseline; forcing LOW.");
    return { band: "LOW", reasons };
  }

  reasons.push("Escapes LOW baseline but does not meet strict HIGH criteria.");
  return { band: "MODERATE", reasons };
}

/** Build one final state for BOTH Level-1 and Advanced */
function buildFinalState(text: string, api: ApiResult | null) {
  const fp = computeFeaturesFromText(text);
  const cls = classifyEngagement(fp);

  const { hardSuppressed, turns, segments, fragRatio } = computeHardSuppression(api);

  const E_raw = typeof api?.session?.E === "number" ? (api.session.E as number) : null;

  // Feature-based center
  const E_from_features = clamp(0.52 * (1 - fp.DO) + 0.28 * fp.HOC + 0.20 * fp.UCQ, 0, 1);

  // IMPORTANT FIX: if short OR fallback, downweight backend to prevent inflated LOW scores
  const totalTurnsForWeight = Math.max(1, fp.userTurnsCount + fp.assistantTurnsCount);
  const shortChat = totalTurnsForWeight < 6;
  const usedFallback = fp.usedFallback || fp.assistantTurnsCount === 0;

  const backendWeight = typeof E_raw === "number"
    ? usedFallback
      ? 0.10
      : shortChat
        ? 0.20
        : 0.50
    : 0;

  const E_base =
    typeof E_raw === "number"
      ? clamp(backendWeight * E_raw + (1 - backendWeight) * E_from_features, 0, 1)
      : E_from_features;

  let band: Band = hardSuppressed ? "MIXED" : cls.band;

  // Band-consistent clamp (LOW tighter and lower)
  let center = E_base;

  if (band === "LOW") {
    // very low interactions (command-only / definition) should sit lower
    const veryLowStyle = fp.DO >= 0.80 || (fp.userTurnsCount <= 4 && fp.HOC <= 0.15);
    center = veryLowStyle ? clamp(center, 0.08, 0.28) : clamp(center, 0.10, 0.32);
  }
  if (band === "MODERATE") center = clamp(center, 0.40, 0.65);
  if (band === "HIGH") center = clamp(center, 0.66, 0.92);

  // Short-chat penalty (prevents small N from looking “too confident/high”)
  if (band !== "MIXED" && shortChat) {
    center = clamp(center * 0.85, 0, 1);
    if (band === "LOW") center = clamp(center, 0.08, 0.30);
  }

  const convoKey = `eng_hist_final_v3_${hashStringToUint32(text.trim())}`;
  const stableCenter =
    typeof window === "undefined"
      ? center
      : updateHistoryMedian(convoKey, center, { maxN: 15, resetThreshold: 0.18, minNToReset: 5 });

  // Dimensions (backend if present, else derived) then band caps
  const d = api?.dimensionMeans ?? {};
  const baseDims = {
    R: typeof d.R === "number" ? d.R : clamp(0.15 + 0.55 * fp.HOC, 0, 1),
    K: typeof d.K === "number" ? d.K : clamp(0.20 + 0.35 * (1 - fp.DO), 0, 1),
    M: typeof d.M === "number" ? d.M : clamp(0.10 + 0.45 * fp.Meta, 0, 1),
    C: typeof d.C === "number" ? d.C : clamp(0.10 + 0.55 * fp.Crit, 0, 1),
    I: typeof d.I === "number" ? d.I : clamp(0.15 + 0.55 * fp.UCQ, 0, 1),
    G: typeof d.G === "number" ? d.G : clamp(0.12 + 0.60 * fp.Integr, 0, 1),
    D: typeof d.D === "number" ? d.D : clamp(0.20 + 0.70 * fp.DO, 0, 1),
  };

  const capped = { ...baseDims };

  if (band === "LOW") {
    capped.R = Math.min(capped.R, 0.25);
    capped.C = Math.min(capped.C, 0.25);
    capped.M = Math.min(capped.M, 0.25);
    capped.G = Math.min(capped.G, 0.25);
    capped.K = Math.min(capped.K, 0.40);
    capped.I = Math.min(capped.I, 0.55);
    capped.D = Math.max(capped.D, 0.70);
  }
  if (band === "MODERATE") {
    capped.R = Math.min(capped.R, 0.60);
    capped.G = Math.min(capped.G, 0.60);
    capped.C = Math.min(capped.C, 0.50);
    capped.M = Math.min(capped.M, 0.50);
    capped.D = clamp(capped.D, 0.35, 0.70);
  }
  if (band === "HIGH") {
    capped.R = Math.max(capped.R, 0.65);
    capped.G = Math.max(capped.G, 0.65);
    capped.D = Math.min(capped.D, 0.55);
  }

  const narrative =
    band === "MIXED"
      ? "Unrelated topic switching appears high, so the report avoids precise scoring."
      : band === "LOW"
        ? "The user mainly requested direct answers or output simplification/formatting. Higher-order signals like critique, integration, or hypothesis-style reasoning are limited."
        : band === "MODERATE"
          ? "The user participates with clarifications and some idea-building, but higher-order critique/integration is present only intermittently."
          : "The user drives an analytical discussion: generating interpretations, using examples/counterexamples, raising critiques, and synthesizing a coherent position.";

  return {
    band,
    stableCenter,
    rangeLabel: band === "MIXED" ? "Qualitative only" : formatFixed5Range(stableCenter),
    aiUsage: aiUsageFromBand(band, stableCenter),
    interpretation: simpleInterpretationFromBand(band),
    narrative,
    reasons: cls.reasons,
    features: fp,
    backend: {
      E_raw,
      mode: api?.session?.mode ?? "—",
      trend: api?.session?.tr ?? "—",
      turns,
      segments,
      fragRatio,
      turnScores: Array.isArray(api?.turnScores) ? api.turnScores : [],
    },
    dims: capped,
  };
}

export default function HomePage() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const final = useMemo(() => buildFinalState(text, result), [text, result]);

  const chartData = useMemo(() => {
    const scores = final.backend.turnScores;
    if (!Array.isArray(scores)) return [];
    return scores.map((t: any, idx: number) => ({
      turn: t.turnId ?? `turn_${idx + 1}`,
      Ut: typeof t.Ut === "number" ? t.Ut : null,
    }));
  }, [final.backend.turnScores]);

  const dimensionData = useMemo(() => {
    const d = final.dims;
    return [
      { name: "R", value: d.R },
      { name: "K", value: d.K },
      { name: "M", value: d.M },
      { name: "C", value: d.C },
      { name: "I", value: d.I },
      { name: "G", value: d.G },
      { name: "D", value: d.D },
    ];
  }, [final.dims]);

  async function analyzeChat() {
    try {
      setLoading(true);
      setError("");
      setResult(null);
      setShowRaw(false);
      setShowAdvanced(false);

      const response = await fetch("http://localhost:8787/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Request failed");

      setResult(data);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 p-6">
      <div className="max-w-7xl mx-auto bg-white rounded-2xl shadow-lg p-6">
        <h1 className="text-3xl font-bold mb-2">Cognitive Engagement Analyzer</h1>
        <p className="text-gray-600 mb-6">Paste a chat in U:/A: format (or plain lines — fallback supported).</p>

        <textarea
          className="w-full h-56 border rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          placeholder="Paste conversation here..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="mt-4 flex gap-3">
          <button
            onClick={analyzeChat}
            disabled={loading || !text.trim()}
            className="px-6 py-3 rounded-xl bg-black text-white disabled:opacity-50"
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>

          <button onClick={() => setText("")} className="px-6 py-3 rounded-xl border bg-white">
            Clear
          </button>
        </div>

        {error && <div className="mt-6 p-4 rounded-xl bg-red-100 text-red-700">{error}</div>}

        {result && (
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-6">
              <section className={`p-5 rounded-2xl text-white shadow-md bg-gradient-to-r ${gradientForBand(final.band)}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-white/80 text-sm">Engagement</p>
                    <h2 className="text-2xl font-bold leading-tight">{bandLabelPretty(final.band)}</h2>
                    <p className="mt-2 text-lg font-semibold">{final.rangeLabel}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white/80 text-xs">AI usage</p>
                    <p className="font-semibold">{final.aiUsage}</p>
                  </div>
                </div>
                <div className="mt-4 text-sm text-white/95">{final.interpretation}</div>
              </section>

              <section className="p-4 rounded-2xl border bg-slate-50">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Advanced analysis</p>
                    <p className="text-xs text-slate-600 mt-1">Evidence + dimensions (same verdict as Level-1)</p>
                  </div>
                  <button onClick={() => setShowAdvanced((v) => !v)} className="px-4 py-2 rounded-xl border bg-white">
                    {showAdvanced ? "Hide" : "Show"}
                  </button>
                </div>
              </section>
            </div>

            <div className="lg:col-span-2 space-y-6">
              {!showAdvanced && (
                <section className="p-6 rounded-2xl border bg-white">
                  <h2 className="text-xl font-semibold mb-2">Result</h2>
                  <p className="text-sm text-slate-700">{final.narrative}</p>
                </section>
              )}

              {showAdvanced && (
                <>
                  <section className="p-4 rounded-xl border bg-white">
                    <h2 className="text-xl font-semibold mb-2">Summary</h2>
                    <div className="border rounded-2xl p-4 bg-slate-50">
                      <div className="text-xs text-slate-600">System verdict</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {bandLabelPretty(final.band)} ({final.rangeLabel})
                      </div>
                      <div className="mt-2 text-sm text-slate-700">{final.interpretation}</div>
                    </div>
                    <div className="mt-3 border rounded-2xl p-4 bg-white">
                      <div className="text-xs text-slate-600">Narrative (band-constrained)</div>
                      <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{final.narrative}</div>
                    </div>
                  </section>

                  <section className="p-4 rounded-xl border bg-white">
                    <h2 className="text-xl font-semibold mb-3">Evidence</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                      <div className="border rounded-2xl p-4 bg-slate-50">
                        <div className="text-xs text-slate-600">Delegation / Operational</div>
                        <div className="font-semibold text-slate-900">{toPct(final.features.DO)}%</div>
                        <div className="text-xs text-slate-600 mt-2">
                          Assistant dominance: {Math.round(final.features.A_dom * 100)}%
                        </div>
                        <div className="text-xs text-slate-600">
                          Directive turns: {final.features.directiveTurns}/{final.features.userTurnsCount}
                        </div>
                        <div className="text-xs text-slate-600">
                          Rewrite turns: {final.features.rewriteTurns}/{final.features.userTurnsCount}
                        </div>
                        <div className="text-xs text-slate-600 mt-2">
                          Parser: {final.features.usedFallback ? "fallback (no U:/A: markers)" : "U:/A: markers detected"}
                        </div>
                      </div>

                      <div className="border rounded-2xl p-4 bg-slate-50">
                        <div className="text-xs text-slate-600">Higher-order signals</div>
                        <div className="font-semibold text-slate-900">{toPct(final.features.HOC)}%</div>
                        <div className="text-xs text-slate-600 mt-2">
                          Crit: {toPct(final.features.Crit)}% · Integr: {toPct(final.features.Integr)}%
                        </div>
                        <div className="text-xs text-slate-600">
                          Compare: {toPct(final.features.Compare)}% · Hyp: {toPct(final.features.Hyp)}%
                        </div>
                        <div className="text-xs text-slate-600">
                          Meta: {toPct(final.features.Meta)}%
                        </div>
                      </div>

                      <div className="border rounded-2xl p-4 bg-slate-50">
                        <div className="text-xs text-slate-600">User contribution quality</div>
                        <div className="font-semibold text-slate-900">{toPct(final.features.UCQ)}%</div>
                        <div className="text-xs text-slate-600 mt-2">
                          Idea turns: {final.features.ideaTurns}/{final.features.userTurnsCount}
                        </div>
                        <div className="text-xs text-slate-600">
                          Contentful turns: {final.features.contentfulTurns}/{final.features.userTurnsCount}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 border rounded-2xl p-4 bg-white text-sm">
                      <div className="text-xs text-slate-600">Decision notes</div>
                      <ul className="mt-2 list-disc pl-5 text-slate-700">
                        {final.reasons.map((r, idx) => (
                          <li key={idx}>{r}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      <div className="border rounded-2xl p-4 bg-white">
                        <div className="text-xs text-slate-600">Backend</div>
                        <div className="font-semibold text-slate-900">
                          {final.backend.mode} · {final.backend.trend}
                        </div>
                        <div className="text-xs text-slate-600 mt-2">
                          Raw E (backend):{" "}
                          <span className="font-semibold text-slate-900">
                            {typeof final.backend.E_raw === "number" ? `${toPct(final.backend.E_raw)}%` : "—"}
                          </span>
                        </div>
                      </div>

                      <div className="border rounded-2xl p-4 bg-white">
                        <div className="text-xs text-slate-600">Segmentation</div>
                        <div className="font-semibold text-slate-900">
                          Turns {final.backend.turns} · Segments {final.backend.segments}
                        </div>
                        <div className="text-xs text-slate-600 mt-2">
                          Fragmentation:{" "}
                          <span className="font-semibold text-slate-900">
                            {final.backend.turns ? `${Math.round(final.backend.fragRatio * 100)}%` : "0%"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="p-4 rounded-xl border bg-white">
                    <h2 className="text-xl font-semibold mb-3">Dimensions (band-capped)</h2>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dimensionData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis domain={[0, 1]} />
                          <Tooltip />
                          <Bar dataKey="value" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </section>

                  <section className="p-4 rounded-xl border bg-white">
                    <h2 className="text-xl font-semibold mb-3">Ut trajectory (backend)</h2>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="turn" />
                          <YAxis domain={[0, 1]} />
                          <Tooltip />
                          <Line type="monotone" dataKey="Ut" dot />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </section>

                  <section className="p-4 rounded-xl border bg-white">
                    <div className="flex justify-between items-center">
                      <h2 className="text-xl font-semibold">Raw JSON</h2>
                      <button onClick={() => setShowRaw(!showRaw)} className="px-4 py-2 rounded-xl border bg-white">
                        {showRaw ? "Hide" : "Show"}
                      </button>
                    </div>
                    {showRaw && (
                      <pre className="mt-4 overflow-auto text-xs bg-gray-100 p-4 rounded-xl">
                        {JSON.stringify(result, null, 2)}
                      </pre>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}