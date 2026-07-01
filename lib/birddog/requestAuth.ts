import { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";

export type BirdDogActor = {
  email: string;
  source: "firebase_token" | "dev_header";
};

function cleanEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function bearerToken(req: NextRequest) {
  const raw = req.headers.get("authorization") || "";
  const prefix = "Bearer ";
  if (!raw.startsWith(prefix)) return "";
  return raw.slice(prefix.length).trim();
}

export async function resolveBirdDogActor(req: NextRequest): Promise<BirdDogActor> {
  const token = bearerToken(req);
  const auth = getAdminAuth();

  if (token && auth) {
    const decoded = await auth.verifyIdToken(token);
    const email = cleanEmail(decoded.email);
    if (!email) throw new Error("Authenticated user does not have an email address.");
    return { email, source: "firebase_token" };
  }

  const headerEmail = cleanEmail(req.headers.get("x-bird-dog-email"));
  if (process.env.NODE_ENV !== "production" && headerEmail) {
    return { email: headerEmail, source: "dev_header" };
  }

  if (!token && !auth) {
    throw new Error("Server auth is not configured. Set FIREBASE_ADMIN_* env vars.");
  }
  if (!token) {
    throw new Error("Missing bearer token.");
  }
  throw new Error("Unable to verify bearer token.");
}
