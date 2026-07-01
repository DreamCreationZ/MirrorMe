import { getAdminDb } from "@/lib/firebaseAdmin";
import { domainFromEmail, isSameDomainEmail, maskEmail, maskUpiId } from "@/lib/birddog/security";

const COLLECTION = "birdDogBookings";

export type TravelMode = "flight" | "bus";
export type BookingStatus = "pending_approval" | "awaiting_payment" | "confirmed" | "rejected";
export type PaymentMethod = "saved_card" | "new_card" | "upi";

export type FareBreakdown = {
  base: number;
  taxes: number;
  convenienceFee: number;
  total: number;
  currency: "INR";
};

export type BookingPayment = {
  method: PaymentMethod;
  amount: number;
  currency: "INR";
  paidAt: string;
  reference: string;
  payerEmailMasked: string;
  cardLast4?: string;
  cardNetwork?: string;
  upiMasked?: string;
  savedCardId?: string;
};

export type TravelBookingRecord = {
  id: string;
  tournamentId: string;
  tournamentName: string;
  teamName: string;
  coachId: string;
  coachName: string;
  coachEmail: string;
  coachDomain: string;
  travelMode: TravelMode;
  origin: string;
  destination: string;
  departureAt: string;
  operatorName: string;
  serviceCode: string;
  seatClass: string;
  seatsRequested: number;
  baggage: string;
  cancellationPolicy: string;
  inclusions: string[];
  fare: FareBreakdown;
  status: BookingStatus;
  approvalRequestedAt: string;
  approvedAt?: string;
  approvedByMasked?: string;
  rejectedAt?: string;
  rejectedByMasked?: string;
  rejectionReason?: string;
  payment?: BookingPayment;
  confirmationRef?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateBookingInput = {
  tournamentId: string;
  tournamentName: string;
  teamName: string;
  coachId: string;
  coachName: string;
  coachEmail: string;
  travelMode: TravelMode;
  origin: string;
  destination: string;
  departureAt: string;
  operatorName: string;
  serviceCode: string;
  seatClass: string;
  seatsRequested: number;
  baggage: string;
  cancellationPolicy: string;
  inclusions: string[];
  fare: FareBreakdown;
};

export type PayBookingInput = {
  method: PaymentMethod;
  payerEmail: string;
  amount: number;
  currency: "INR";
  savedCardId?: string;
  cardLast4?: string;
  cardNetwork?: string;
  upiId?: string;
};

type BookingState = {
  byTournament: Record<string, TravelBookingRecord[]>;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function clampNonNegativeNumber(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(value));
}

function normalizeFare(fare: FareBreakdown): FareBreakdown {
  const base = clampNonNegativeNumber(fare.base);
  const taxes = clampNonNegativeNumber(fare.taxes);
  const convenienceFee = clampNonNegativeNumber(fare.convenienceFee);
  const total = clampNonNegativeNumber(fare.total || base + taxes + convenienceFee);
  return {
    base,
    taxes,
    convenienceFee,
    total,
    currency: "INR"
  };
}

function normalizeBooking(raw: Partial<TravelBookingRecord>): TravelBookingRecord {
  const coachEmail = clean(raw.coachEmail).toLowerCase();
  const createdAt = clean(raw.createdAt) || nowIso();
  const updatedAt = clean(raw.updatedAt) || createdAt;
  return {
    id: clean(raw.id) || uid("bd_booking"),
    tournamentId: clean(raw.tournamentId),
    tournamentName: clean(raw.tournamentName),
    teamName: clean(raw.teamName),
    coachId: clean(raw.coachId),
    coachName: clean(raw.coachName),
    coachEmail,
    coachDomain: clean(raw.coachDomain) || domainFromEmail(coachEmail),
    travelMode: (raw.travelMode || "flight") as TravelMode,
    origin: clean(raw.origin),
    destination: clean(raw.destination),
    departureAt: clean(raw.departureAt),
    operatorName: clean(raw.operatorName),
    serviceCode: clean(raw.serviceCode),
    seatClass: clean(raw.seatClass),
    seatsRequested: Math.max(1, Math.floor(Number(raw.seatsRequested) || 1)),
    baggage: clean(raw.baggage),
    cancellationPolicy: clean(raw.cancellationPolicy),
    inclusions: (raw.inclusions || []).map((item) => clean(item)).filter(Boolean),
    fare: normalizeFare(
      (raw.fare as FareBreakdown) || {
        base: 0,
        taxes: 0,
        convenienceFee: 0,
        total: 0,
        currency: "INR"
      }
    ),
    status: (raw.status || "pending_approval") as BookingStatus,
    approvalRequestedAt: clean(raw.approvalRequestedAt) || createdAt,
    approvedAt: clean(raw.approvedAt) || undefined,
    approvedByMasked: clean(raw.approvedByMasked) || undefined,
    rejectedAt: clean(raw.rejectedAt) || undefined,
    rejectedByMasked: clean(raw.rejectedByMasked) || undefined,
    rejectionReason: clean(raw.rejectionReason) || undefined,
    payment: raw.payment
      ? {
          ...raw.payment,
          method: (raw.payment.method || "new_card") as PaymentMethod,
          amount: clampNonNegativeNumber(Number(raw.payment.amount)),
          currency: "INR",
          paidAt: clean(raw.payment.paidAt),
          reference: clean(raw.payment.reference),
          payerEmailMasked: clean(raw.payment.payerEmailMasked),
          cardLast4: clean(raw.payment.cardLast4) || undefined,
          cardNetwork: clean(raw.payment.cardNetwork) || undefined,
          upiMasked: clean(raw.payment.upiMasked) || undefined,
          savedCardId: clean(raw.payment.savedCardId) || undefined
        }
      : undefined,
    confirmationRef: clean(raw.confirmationRef) || undefined,
    createdAt,
    updatedAt
  };
}

function sortByNewest(items: TravelBookingRecord[]) {
  return items.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function getMemoryState(): BookingState {
  const g = globalThis as unknown as { __BIRD_DOG_BOOKINGS__?: BookingState };
  if (!g.__BIRD_DOG_BOOKINGS__) {
    g.__BIRD_DOG_BOOKINGS__ = { byTournament: {} };
  }
  return g.__BIRD_DOG_BOOKINGS__;
}

function listMemory(tournamentId: string) {
  const state = getMemoryState();
  return sortByNewest(state.byTournament[tournamentId] || []);
}

function upsertMemory(record: TravelBookingRecord) {
  const state = getMemoryState();
  const current = state.byTournament[record.tournamentId] || [];
  const next = current.filter((item) => item.id !== record.id);
  next.unshift(record);
  state.byTournament[record.tournamentId] = sortByNewest(next);
}

function findMemory(bookingId: string): { tournamentId: string; booking: TravelBookingRecord } | null {
  const state = getMemoryState();
  const tournamentIds = Object.keys(state.byTournament);
  for (const tournamentId of tournamentIds) {
    const booking = (state.byTournament[tournamentId] || []).find((item) => item.id === bookingId);
    if (booking) return { tournamentId, booking };
  }
  return null;
}

async function findBookingById(
  bookingId: string
): Promise<{ booking: TravelBookingRecord; tournamentId: string } | null> {
  const db = getAdminDb();
  if (!db) {
    const memory = findMemory(bookingId);
    if (!memory) return null;
    return { booking: memory.booking, tournamentId: memory.tournamentId };
  }

  const snap = await db.collection(COLLECTION).doc(bookingId).get();
  if (!snap.exists) return null;
  const booking = normalizeBooking(snap.data() as Partial<TravelBookingRecord>);
  return { booking, tournamentId: booking.tournamentId };
}

export async function createBooking(input: CreateBookingInput): Promise<TravelBookingRecord> {
  const createdAt = nowIso();
  const booking = normalizeBooking({
    id: uid("bd_booking"),
    tournamentId: input.tournamentId,
    tournamentName: input.tournamentName,
    teamName: input.teamName,
    coachId: input.coachId,
    coachName: input.coachName,
    coachEmail: input.coachEmail,
    coachDomain: domainFromEmail(input.coachEmail),
    travelMode: input.travelMode,
    origin: input.origin,
    destination: input.destination,
    departureAt: input.departureAt,
    operatorName: input.operatorName,
    serviceCode: input.serviceCode,
    seatClass: input.seatClass,
    seatsRequested: input.seatsRequested,
    baggage: input.baggage,
    cancellationPolicy: input.cancellationPolicy,
    inclusions: input.inclusions,
    fare: input.fare,
    status: "pending_approval",
    approvalRequestedAt: createdAt,
    createdAt,
    updatedAt: createdAt
  });

  upsertMemory(booking);
  const db = getAdminDb();
  if (!db) return booking;

  try {
    await db.collection(COLLECTION).doc(booking.id).set(booking, { merge: true });
    return booking;
  } catch {
    return booking;
  }
}

export async function listBookings(tournamentId: string) {
  const normalizedTournamentId = clean(tournamentId);
  const db = getAdminDb();
  if (!db) return listMemory(normalizedTournamentId);

  try {
    const snap = await db
      .collection(COLLECTION)
      .where("tournamentId", "==", normalizedTournamentId)
      .get();
    const rows = snap.docs.map((doc) => normalizeBooking(doc.data() as Partial<TravelBookingRecord>));
    return sortByNewest(rows);
  } catch {
    return listMemory(normalizedTournamentId);
  }
}

export async function listBookingsForViewer(tournamentId: string, viewerEmail: string) {
  const viewer = clean(viewerEmail).toLowerCase();
  const bookings = await listBookings(tournamentId);
  return bookings.map((booking) => {
    const sameCoach = viewer && viewer === booking.coachEmail.toLowerCase();
    const allowed = sameCoach || isSameDomainEmail(booking.coachEmail, viewer);
    if (allowed) return booking;
    return {
      ...booking,
      coachName: "External Coach",
      coachEmail: "hidden",
      coachDomain: domainFromEmail(booking.coachEmail),
      origin: "Private",
      destination: "Private",
      departureAt: booking.departureAt,
      fare: { ...booking.fare, base: 0, taxes: 0, convenienceFee: 0, total: 0 },
      inclusions: [],
      cancellationPolicy: "Private",
      payment: undefined,
      approvedByMasked: undefined,
      rejectedByMasked: undefined,
      rejectionReason: undefined
    };
  });
}

export async function approveBooking(bookingId: string, approverEmail: string) {
  const actor = clean(approverEmail).toLowerCase();
  const found = await findBookingById(bookingId);
  if (!found) {
    throw new Error("Booking not found.");
  }

  if (actor !== found.booking.coachEmail.toLowerCase()) {
    throw new Error("Only the assigned coach can approve this booking.");
  }
  if (found.booking.status !== "pending_approval") {
    throw new Error("Only pending bookings can be approved.");
  }

  const next = normalizeBooking({
    ...found.booking,
    status: "awaiting_payment",
    approvedAt: nowIso(),
    approvedByMasked: maskEmail(actor),
    updatedAt: nowIso()
  });

  upsertMemory(next);
  const db = getAdminDb();
  if (!db) return next;

  try {
    await db.collection(COLLECTION).doc(next.id).set(next, { merge: true });
    return next;
  } catch {
    return next;
  }
}

export async function rejectBooking(bookingId: string, approverEmail: string, reason: string) {
  const actor = clean(approverEmail).toLowerCase();
  const found = await findBookingById(bookingId);
  if (!found) {
    throw new Error("Booking not found.");
  }

  if (actor !== found.booking.coachEmail.toLowerCase()) {
    throw new Error("Only the assigned coach can reject this booking.");
  }
  if (found.booking.status !== "pending_approval") {
    throw new Error("Only pending bookings can be rejected.");
  }

  const next = normalizeBooking({
    ...found.booking,
    status: "rejected",
    rejectedAt: nowIso(),
    rejectedByMasked: maskEmail(actor),
    rejectionReason: clean(reason) || "No reason provided.",
    updatedAt: nowIso()
  });

  upsertMemory(next);
  const db = getAdminDb();
  if (!db) return next;

  try {
    await db.collection(COLLECTION).doc(next.id).set(next, { merge: true });
    return next;
  } catch {
    return next;
  }
}

export async function payBooking(bookingId: string, input: PayBookingInput) {
  const actor = clean(input.payerEmail).toLowerCase();
  const found = await findBookingById(bookingId);
  if (!found) {
    throw new Error("Booking not found.");
  }

  if (actor !== found.booking.coachEmail.toLowerCase()) {
    throw new Error("Only the assigned coach can complete payment.");
  }
  if (found.booking.status !== "awaiting_payment") {
    throw new Error("Booking is not ready for payment.");
  }

  const payment: BookingPayment = {
    method: input.method,
    amount: clampNonNegativeNumber(input.amount),
    currency: "INR",
    paidAt: nowIso(),
    reference: uid("pay"),
    payerEmailMasked: maskEmail(actor),
    savedCardId: clean(input.savedCardId) || undefined,
    cardLast4: clean(input.cardLast4) || undefined,
    cardNetwork: clean(input.cardNetwork) || undefined,
    upiMasked: input.upiId ? maskUpiId(input.upiId) : undefined
  };

  const next = normalizeBooking({
    ...found.booking,
    status: "confirmed",
    payment,
    confirmationRef: uid(found.booking.travelMode === "flight" ? "PNR" : "BUS"),
    updatedAt: nowIso()
  });

  upsertMemory(next);
  const db = getAdminDb();
  if (!db) return next;

  try {
    await db.collection(COLLECTION).doc(next.id).set(next, { merge: true });
    return next;
  } catch {
    return next;
  }
}
