import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createBooking,
  listBookingsForViewer,
  approveBooking,
  payBooking,
  rejectBooking,
  type CreateBookingInput,
  type PayBookingInput
} from "@/lib/birddog/bookingStore";
import { resolveBirdDogActor } from "@/lib/birddog/requestAuth";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(req: NextRequest) {
  const tournamentId = clean(req.nextUrl.searchParams.get("tournamentId"));
  if (!tournamentId) {
    return NextResponse.json({ error: "Missing tournamentId" }, { status: 400 });
  }

  try {
    const actor = await resolveBirdDogActor(req);
    const bookings = await listBookingsForViewer(tournamentId, actor.email);
    return NextResponse.json({
      bookings,
      policy: "same_domain_full_access_otherwise_restricted"
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}

type Body = {
  action?: string;
  bookingId?: string;
  approverEmail?: string;
  reason?: string;
  booking?: CreateBookingInput;
  payment?: PayBookingInput;
};

const createBookingSchema: z.ZodType<CreateBookingInput> = z.object({
  tournamentId: z.string().min(1),
  tournamentName: z.string().min(1),
  teamName: z.string().min(1),
  coachId: z.string().min(1),
  coachName: z.string().min(1),
  coachEmail: z.string().email(),
  travelMode: z.enum(["flight", "bus"]),
  origin: z.string().min(1),
  destination: z.string().min(1),
  departureAt: z.string().min(1),
  operatorName: z.string().min(1),
  serviceCode: z.string().min(1),
  seatClass: z.string().min(1),
  seatsRequested: z.number().int().min(1),
  baggage: z.string().min(1),
  cancellationPolicy: z.string().min(1),
  inclusions: z.array(z.string()),
  fare: z.object({
    base: z.number().min(0),
    taxes: z.number().min(0),
    convenienceFee: z.number().min(0),
    total: z.number().min(0),
    currency: z.literal("INR")
  })
});

const paySchema = z.object({
  method: z.enum(["saved_card", "new_card", "upi"]),
  amount: z.number().min(0),
  currency: z.literal("INR"),
  savedCardId: z.string().optional(),
  cardLast4: z.string().optional(),
  cardNetwork: z.string().optional(),
  upiId: z.string().optional()
});

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
    const body = (await req.json()) as Body;
    const action = clean(body.action).toLowerCase() || "create";

    if (action === "create") {
      if (!body.booking) {
        return NextResponse.json({ error: "Missing booking payload." }, { status: 400 });
      }
      const parsed = createBookingSchema.safeParse(body.booking);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid booking payload.", issues: parsed.error.flatten() },
          { status: 400 }
        );
      }
      if (clean(parsed.data.coachEmail).toLowerCase() !== actorEmail) {
        return NextResponse.json(
          { error: "You can only create bookings for your own coach account." },
          { status: 403 }
        );
      }
      const created = await createBooking(parsed.data);
      return NextResponse.json({ ok: true, booking: created });
    }

    if (action === "approve") {
      const bookingId = clean(body.bookingId);
      if (!bookingId) {
        return NextResponse.json({ error: "Missing bookingId." }, { status: 400 });
      }
      const updated = await approveBooking(bookingId, actorEmail);
      return NextResponse.json({ ok: true, booking: updated });
    }

    if (action === "reject") {
      const bookingId = clean(body.bookingId);
      if (!bookingId) {
        return NextResponse.json({ error: "Missing bookingId." }, { status: 400 });
      }
      const updated = await rejectBooking(bookingId, actorEmail, clean(body.reason));
      return NextResponse.json({ ok: true, booking: updated });
    }

    if (action === "pay") {
      const bookingId = clean(body.bookingId);
      if (!bookingId || !body.payment) {
        return NextResponse.json({ error: "Missing bookingId or payment payload." }, { status: 400 });
      }
      const parsed = paySchema.safeParse(body.payment);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid payment payload.", issues: parsed.error.flatten() },
          { status: 400 }
        );
      }
      const paymentPayload: PayBookingInput = {
        ...parsed.data,
        payerEmail: actorEmail
      };
      const updated = await payBooking(bookingId, paymentPayload);
      return NextResponse.json({ ok: true, booking: updated });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Booking request failed." },
      { status: 500 }
    );
  }
}
