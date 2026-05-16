export async function GET() {
  return Response.json({
    ok: true,
    message: "analyze route is live",
  });
}

export async function POST(req: Request) {
  const body = await req.json();

  return Response.json({
    success: true,
    received: body,
  });
}