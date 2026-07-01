import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const payload = await req.json();

  return NextResponse.json({
    ok: true,
    receivedAt: new Date().toISOString(),
    counts: {
      notes: Array.isArray(payload?.notes) ? payload.notes.length : 0,
      pulses: Array.isArray(payload?.pulses) ? payload.pulses.length : 0
    }
  });
}
