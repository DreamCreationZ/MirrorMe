import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  CoachScheduleRecord,
  listCoachSchedulesForViewer,
  upsertCoachSchedule
} from "@/lib/birddog/coachScheduleStore";
import { resolveBirdDogActor } from "@/lib/birddog/requestAuth";

function safeString(value: unknown) {
  return String(value ?? "").trim();
}

const routeStepSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  game: z.string().min(1),
  recommendation: z.enum(["flight", "bus/train", "car", "walk/local"]),
  field: z.string().min(1)
});

const postSchema = z.object({
  id: z.string().optional().default(""),
  tournamentId: z.string().min(1),
  tournamentName: z.string().min(1),
  coachId: z.string().min(1),
  coachName: z.string().min(1),
  coachEmail: z.string().email(),
  origin: z.string().min(1),
  generatedAt: z.string().optional().default(""),
  steps: z.array(routeStepSchema),
  selectedPlayerIds: z.array(z.string()),
  selectedPlayerNames: z.array(z.string()),
  liveLocation: z
    .object({
      lat: z.number(),
      lng: z.number(),
      updatedAt: z.string()
    })
    .optional()
});

export async function GET(req: NextRequest) {
  const tournamentId = safeString(req.nextUrl.searchParams.get("tournamentId"));
  if (!tournamentId) {
    return NextResponse.json({ error: "Missing tournamentId" }, { status: 400 });
  }

  try {
    const actor = await resolveBirdDogActor(req);
    const schedules = await listCoachSchedulesForViewer(tournamentId, actor.email);
    return NextResponse.json({
      schedules,
      policy: "same_domain_full_access_otherwise_restricted"
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}

export async function POST(req: NextRequest) {
  let actorEmail = "";

  try {
    const actor = await resolveBirdDogActor(req);
    actorEmail = actor.email;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data as CoachScheduleRecord;
    const tournamentId = safeString(body.tournamentId);
    const coachId = safeString(body.coachId);
    const coachEmail = safeString(body.coachEmail).toLowerCase();
    if (!tournamentId || !coachId) {
      return NextResponse.json({ error: "Missing tournamentId or coachId" }, { status: 400 });
    }

    if (actorEmail !== coachEmail) {
      return NextResponse.json(
        { error: "You can only save schedules for your own account." },
        { status: 403 }
      );
    }

    const saved = await upsertCoachSchedule({
      ...body,
      id: safeString(body.id) || `${tournamentId}:${coachId}`,
      coachEmail,
      tournamentId,
      coachId,
      generatedAt: safeString(body.generatedAt) || new Date().toISOString()
    });

    return NextResponse.json({ ok: true, schedule: saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save schedule" },
      { status: 500 }
    );
  }
}
