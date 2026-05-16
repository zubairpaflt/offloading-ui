type AnalyzeRequestBody = {
  transcript?: string;
};

function countUserTurns(transcript: string): number {
  // Accept common formats:
  // "User: ..." lines OR "U: ..." lines OR "USER:" etc.
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
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const transcript = (body.transcript ?? "").trim();

  if (!transcript) {
    return Response.json(
      { ok: false, error: "Missing transcript string" },
      { status: 400 }
    );
  }

  const userTurns = countUserTurns(transcript);

  // RULE: suppress quantitative scoring if user turns < 5
  if (userTurns < 5) {
    return Response.json({
      ok: true,
      userTurns,
      suppressed: true,
      reason: "Need at least 5 user turns for quantitative scoring reliability.",
      qualitative: {
        summary:
          "Session too short for reliable numeric estimates. Provide more user turns.",
      },
    });
  }

  // Placeholder until we plug real scoring:
  const E = 0.25;
  const CP = 0.25;
  const CI = 0.25;

  return Response.json({
    ok: true,
    userTurns,
    suppressed: false,
    scores: {
      E,
      CP,
      CI,
    },
    note: "Placeholder scores. Next step: implement real scoring logic.",
  });
}