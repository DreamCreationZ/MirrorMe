import { getAdminDb } from "@/lib/firebaseAdmin";
import { domainFromEmail, isSameDomainEmail, maskEmail } from "@/lib/birddog/security";

const COLLECTION = "birdDogCoachSchedules";

export type CoachRouteStep = {
  id: string;
  at: string;
  from: string;
  to: string;
  game: string;
  recommendation: "flight" | "bus/train" | "car" | "walk/local";
  field: string;
};

export type CoachScheduleRecord = {
  id: string;
  tournamentId: string;
  tournamentName: string;
  coachId: string;
  coachName: string;
  coachEmail: string;
  origin: string;
  generatedAt: string;
  steps: CoachRouteStep[];
  selectedPlayerIds: string[];
  selectedPlayerNames: string[];
  liveLocation?: {
    lat: number;
    lng: number;
    updatedAt: string;
  };
};

export type CoachScheduleVisibility = "full" | "restricted";

export type CoachScheduleView = Omit<
  CoachScheduleRecord,
  "coachEmail" | "steps" | "selectedPlayerIds" | "selectedPlayerNames" | "liveLocation"
> & {
  coachEmailMasked: string;
  coachDomain: string;
  visibility: CoachScheduleVisibility;
  steps: CoachRouteStep[];
  selectedPlayerIds: string[];
  selectedPlayerNames: string[];
  liveLocation?: CoachScheduleRecord["liveLocation"];
};

type ScheduleState = {
  byTournament: Record<string, CoachScheduleRecord[]>;
};

function nowIso() {
  return new Date().toISOString();
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function safeDocId(tournamentId: string, coachId: string) {
  return `${tournamentId}__${coachId}`.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 240);
}

function normalizeRecord(raw: Partial<CoachScheduleRecord>): CoachScheduleRecord {
  return {
    id: clean(raw.id) || safeDocId(clean(raw.tournamentId), clean(raw.coachId)),
    tournamentId: clean(raw.tournamentId),
    tournamentName: clean(raw.tournamentName),
    coachId: clean(raw.coachId),
    coachName: clean(raw.coachName),
    coachEmail: clean(raw.coachEmail).toLowerCase(),
    origin: clean(raw.origin),
    generatedAt: clean(raw.generatedAt) || nowIso(),
    steps: (raw.steps || []).map((step) => ({
      id: clean(step.id),
      at: clean(step.at),
      from: clean(step.from),
      to: clean(step.to),
      game: clean(step.game),
      recommendation: (step.recommendation || "car") as CoachRouteStep["recommendation"],
      field: clean(step.field)
    })),
    selectedPlayerIds: (raw.selectedPlayerIds || []).map((item) => clean(item)).filter(Boolean),
    selectedPlayerNames: (raw.selectedPlayerNames || []).map((item) => clean(item)).filter(Boolean),
    liveLocation: raw.liveLocation
      ? {
          lat: Number(raw.liveLocation.lat) || 0,
          lng: Number(raw.liveLocation.lng) || 0,
          updatedAt: clean(raw.liveLocation.updatedAt) || nowIso()
        }
      : undefined
  };
}

function sortByNewest(list: CoachScheduleRecord[]) {
  return list.slice().sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

function getMemoryState(): ScheduleState {
  const g = globalThis as unknown as { __BIRD_DOG_COACH_SCHEDULES__?: ScheduleState };
  if (!g.__BIRD_DOG_COACH_SCHEDULES__) {
    g.__BIRD_DOG_COACH_SCHEDULES__ = { byTournament: {} };
  }
  return g.__BIRD_DOG_COACH_SCHEDULES__;
}

function upsertMemory(record: CoachScheduleRecord) {
  const state = getMemoryState();
  const current = state.byTournament[record.tournamentId] || [];
  const filtered = current.filter((item) => item.coachId !== record.coachId);
  filtered.unshift(record);
  state.byTournament[record.tournamentId] = sortByNewest(filtered);
}

function listMemory(tournamentId: string) {
  const state = getMemoryState();
  return sortByNewest(state.byTournament[tournamentId] || []);
}

export async function listCoachSchedules(tournamentId: string): Promise<CoachScheduleRecord[]> {
  const cleanTournamentId = clean(tournamentId);
  const db = getAdminDb();
  if (!db) {
    return listMemory(cleanTournamentId);
  }

  try {
    const snap = await db
      .collection(COLLECTION)
      .where("tournamentId", "==", cleanTournamentId)
      .get();
    const rows = snap.docs.map((doc) => normalizeRecord(doc.data() as Partial<CoachScheduleRecord>));
    return sortByNewest(rows);
  } catch {
    return listMemory(cleanTournamentId);
  }
}

export async function listCoachSchedulesForViewer(
  tournamentId: string,
  viewerEmail: string
): Promise<CoachScheduleView[]> {
  const viewer = clean(viewerEmail).toLowerCase();
  const schedules = await listCoachSchedules(tournamentId);
  return schedules.map((schedule) => {
    const owner = schedule.coachEmail.trim().toLowerCase();
    const sameCoach = viewer && viewer === owner;
    const allowed = sameCoach || isSameDomainEmail(owner, viewer);
    const coachDomain = domainFromEmail(owner);

    if (allowed) {
      return {
        ...schedule,
        coachEmailMasked: maskEmail(owner),
        coachDomain,
        visibility: "full"
      };
    }

    return {
      ...schedule,
      coachName: "External Coach",
      origin: "Private",
      coachEmailMasked: maskEmail(owner),
      coachDomain,
      visibility: "restricted",
      steps: [],
      selectedPlayerIds: [],
      selectedPlayerNames: [],
      liveLocation: undefined
    };
  });
}

export async function upsertCoachSchedule(input: CoachScheduleRecord): Promise<CoachScheduleRecord> {
  const normalized = normalizeRecord(input);
  upsertMemory(normalized);

  const db = getAdminDb();
  if (!db) return normalized;

  try {
    const id = clean(normalized.id) || safeDocId(normalized.tournamentId, normalized.coachId);
    await db.collection(COLLECTION).doc(id).set(
      {
        ...normalized,
        id,
        updatedAt: nowIso()
      },
      { merge: true }
    );
    return { ...normalized, id };
  } catch {
    return normalized;
  }
}
