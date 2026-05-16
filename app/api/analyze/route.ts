type AnalyzeRequestBody = {
  transcript?: string;
};

type Turn = {
  role: "user" | "assistant" | "other";
  text: string;
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function splitTranscript(transcript: string): Turn[] {
  const lines = transcript.split(/\r?\n/);
  const turns: Turn[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const m = line.match(/^(user|u|human|assistant|a|bot)\s*:\s*(.*)$/i);
    if (!m) {
      turns.push({ role: "other", text: line });
      continue;
    }

    const who = m[1].toLowerCase();
    const text = (m[2] ?? "").trim();

    if (who === "assistant" || who === "a" || who === "bot") {
      turns.push({ role: "assistant", text });
    } else {
      turns.push({ role: "user", text });
    }
  }

  return turns;
}

function countUserTurns(turns: Turn[]) {
  return turns.filter((t) => t.role === "user" && t.text.trim().length > 0).length;
}

function countRegex(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function scoreUserTurn(t: string) {
  const text = t.toLowerCase();

  // Signals
  const whyHow = countRegex(text, /\b(why|how)\b/g);
  const evidence = countRegex(text, /\b(evidence|data|study|research|paper|citation|source)\b/g);
  const quantify = countRegex(text, /\b(percent|%|number|rate|effect size|correlation|r=|p<|p=)\b/g);
  const example = countRegex(text, /\b(example|for example|e\.g\.|case)\b/g);
  const compare = countRegex(text, /\b(compare|contrast|difference|similar|versus|vs)\b/g);
  const synth = countRegex(text, /\b(summarize|synthesis|connect|integrate|combine|link)\b/g);
  const plan = countRegex(text, /\b(plan|steps|procedure|method|protocol|design)\b/g);
  const create = countRegex(text, /\b(create|build|draft|write|make|develop)\b/g);
  const reflect = countRegex(text, /\b(i think|i feel|i believe|in my view|i wonder|reflect)\b/g);
  const challenge = countRegex(text, /\b(but|however|counter|challenge|limitation|weakness)\b/g);

  const qmarks = countRegex(t, /\?/g);
  const words = t.trim().split(/\s+/).filter(Boolean).length;

  // 7-dimension scores (heuristic)
  let dInquiry = 0.15 * Math.min(3, qmarks) + 0.10 * Math.min(2, whyHow);
  let dConcept = 0.10 * Math.min(2, whyHow) + 0.12 * Math.min(2, compare) + 0.12 * Math.min(2, synth);
  let dEvidence = 0.18 * Math.min(2, evidence) + 0.12 * Math.min(2, quantify);
  let dApply = 0.14 * Math.min(2, example) + 0.10 * Math.min(2, plan);
  let dCreate = 0.16 * Math.min(2, create) + 0.10 * Math.min(2, plan);
  let dCritical = 0.14 * Math.min(2, challenge);
  let dSustain = words >= 18 ? 0.25 : words >= 10 ? 0.15 : words >= 6 ? 0.08 : 0.03;

  // High-level indices (raw)
  let eRaw = dInquiry + dSustain + 0.08 * Math.min(2, reflect);
  let cpRaw = dConcept + 0.06 * Math.min(2, whyHow);
  let ciRaw = dCreate + dApply;

  return {
    words,
    signals: { whyHow, evidence, quantify, example, compare, synth, plan, create, reflect, challenge, qmarks },
    dims: {
      inquiry: dInquiry,
      conceptual: dConcept,
      evidence: dEvidence,
      application: dApply,
      creation: dCreate,
      critical: dCritical,
      sustain: dSustain,
    },
    raw: { E: eRaw, CP: cpRaw, CI: ciRaw },
  };
}

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function GET() {
  return Response.json({
    ok: true,
    message: "Use POST with { transcript }",
  });
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
  const userTurns = countUserTurns(turns);

  // Rule: suppress numeric scoring if < 5 user turns
  if (userTurns < 5) {
    return Response.json({
      ok: true,
      userTurns,
      suppressed: true,
      reason: "Need at least 5 user turns for quantitative scoring reliability.",
    });
  }

  const userTurnTexts = turns
    .filter((t) => t.role === "user")
    .map((t) => t.text)
    .filter((x) => x.trim().length > 0);

  const perTurn = userTurnTexts.map((t) => scoreUserTurn(t));

  // Scale + clamp to 0..1
  const E = clamp01(avg(perTurn.map((x) => x.raw.E)) / 1.2);
  const CP = clamp01(avg(perTurn.map((x) => x.raw.CP)) / 1.1);
  const CI = clamp01(avg(perTurn.map((x) => x.raw.CI)) / 1.1);

  // Dimension averages (7-dim detail)
  const dims = {
    inquiry: clamp01(avg(perTurn.map((x) => x.dims.inquiry)) / 0.7),
    conceptual: clamp01(avg(perTurn.map((x) => x.dims.conceptual)) / 0.7),
    evidence: clamp01(avg(perTurn.map((x) => x.dims.evidence)) / 0.7),
    application: clamp01(avg(perTurn.map((x) => x.dims.application)) / 0.7),
    creation: clamp01(avg(perTurn.map((x) => x.dims.creation)) / 0.7),
    critical: clamp01(avg(perTurn.map((x) => x.dims.critical)) / 0.5),
    sustain: clamp01(avg(perTurn.map((x) => x.dims.sustain)) / 0.25),
  };

  // Total signals for transparency
  const signalsTotal = perTurn.reduce(
    (acc, x) => {
      for (const k of Object.keys(x.signals) as (keyof typeof x.signals)[]) {
        acc[k] += x.signals[k];
      }
      return acc;
    },
    {
      whyHow: 0,
      evidence: 0,
      quantify: 0,
      example: 0,
      compare: 0,
      synth: 0,
      plan: 0,
      create: 0,
      reflect: 0,
      challenge: 0,
      qmarks: 0,
    }
  );

  function band(x: number) {
    if (x >= 0.75) return "high";
    if (x >= 0.45) return "medium";
    return "low";
  }

  return Response.json({
    ok: true,
    userTurns,
    suppressed: false,
    scores: { E, CP, CI },
    bands: { E: band(E), CP: band(CP), CI: band(CI) },
    dims,
    signals: signalsTotal,
    perUserTurn: perTurn.map((x, i) => ({
      turn: i + 1,
      words: x.words,
      dims: x.dims,
      raw: x.raw,
      signals: x.signals,
    })),
  });
}