type AnalyzeRequestBody = {
  transcript?: string;
};

function countUserTurns(transcript: string): number {
  const lines = transcript.split(/\r?\n/);

  let count = 0;

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) continue;

    if (
      /^user\s*:/i.test(line) ||
      /^u\s*:/i.test(line) ||
      /^human\s*:/i.test(line)
    ) {
      count += 1;
    }
  }

  return count;
}

export async function GET() {
  return Response.json({
    ok: true,
    message: "analyze route is live. Use POST with { transcript }",
  });
}

export async function POST(req: Request) {
  let body: AnalyzeRequestBody;

  try {
    body = (await req.json()) as AnalyzeRequestBody;
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Invalid JSON body",
      },
      {
        status: 400,
      }
    );
  }

  const transcript = (body.transcript ?? "").trim();

  if (!transcript) {
    return Response.json(
      {
        ok: false,
        error: "Missing transcript string",
      },
      {
        status: 400,
      }
    );
  }

  const userTurns = countUserTurns(transcript);

  // Suppress quantitative scoring if user turns < 5
  if (userTurns < 5) {
    return Response.json({
      ok: true,
      userTurns,
      suppressed: true,
      reason:
        "Need at least 5 user turns for quantitative scoring reliability.",
      qualitative: {
        summary:
          "Session too short for reliable numeric estimates. Provide more user turns.",
      },
    });
  }

  const text = transcript.toLowerCase();

  // Simple signals (v1)
  const whyHow = (text.match(/\b(why|how)\b/g) || []).length;

  const examples =
    (text.match(/\b(example|for example|e\.g\.)\b/g) || []).length;

  const compare =
    (text.match(/\b(compare|contrast|difference|similar)\b/g) || []).length;

  const synth =
    (text.match(/\b(summarize|synthesis|connect|integrate)\b/g) || []).length;

  const plan =
    (text.match(/\b(plan|steps|procedure|method)\b/g) || []).length;

  const reflect =
    (
      text.match(
        /\b(i think|i feel|i believe|in my view|reflect)\b/g
      ) || []
    ).length;

  const creativity =
    (text.match(/\b(create|design|build|draft|write)\b/g) || []).length;

  // Normalize by user turns
  const n = Math.max(1, userTurns);

  // Engagement (E)
  let E =
    0.12 +
    0.08 * (whyHow / n) +
    0.05 * (examples / n) +
    0.05 * (plan / n) +
    0.05 * (reflect / n);

  // Conceptual Participation (CP)
  let CP =
    0.10 +
    0.08 * (whyHow / n) +
    0.07 * (compare / n) +
    0.07 * (synth / n);

  // Collaborative Index (CI)
  let CI =
    0.10 +
    0.06 * (creativity / n) +
    0.06 * (plan / n) +
    0.04 * (examples / n);

  // Clamp 0..1
  const clamp01 = (x: number) =>
    Math.max(0, Math.min(1, x));

  E = clamp01(E);
  CP = clamp01(CP);
  CI = clamp01(CI);

  return Response.json({
    ok: true,
    userTurns,
    suppressed: false,
    scores: {
      E,
      CP,
      CI,
    },
    signals: {
      whyHow,
      examples,
      compare,
      synth,
      plan,
      reflect,
      creativity,
    },
    note:
      "v1 scoring (keyword-based). Next: turn-level scoring + 7-dimension model.",
  });
}