import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text = typeof body?.text === "string" ? body.text : "";

    if (!text.trim()) {
      return NextResponse.json({ ok: false, error: "Provide { text }" }, { status: 400 });
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const userTurns = lines.filter((l) => /^user\s*:/i.test(l)).length;

    const MIN_USER_TURNS = 5;

    if (userTurns < MIN_USER_TURNS) {
      return NextResponse.json({
        ok: true,
        meta: {
          userTurnsCount: userTurns,
          quantitativeSuppressed: true,
          suppressedReason: `Quantitative estimates require at least ${MIN_USER_TURNS} user turns.`,
        },
        qualitativeSummary: "Qual-only mode: not enough user turns for numeric scoring.",
      });
    }

    return NextResponse.json({
      ok: true,
      meta: { userTurnsCount: userTurns, quantitativeSuppressed: false },
      level1: { E: 0.35, CP: 0.38, collaborativeIndex: 0.37 },
      qualitativeSummary: "API route working. Next: plug real scoring here.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}