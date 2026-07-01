"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { loadProfile } from "@/lib/persistence";
import {
  BillingState,
  SUBSCRIPTION_PRICE_USD_MONTHLY,
  TRYON_PACK_CREDITS,
  TRYON_PACK_PRICE_USD,
  activateMonthlySubscription,
  addTryOnPack,
  hasActiveSubscription,
  loadBilling
} from "@/lib/subscription";

function formatDate(value: number) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

export default function SubscribePage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("there");
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [readyPath, setReadyPath] = useState("/welcome");

  useEffect(() => {
    waitForAuthInit().then(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserId(user.id);
      setName(user.name || "there");

      const profile = await loadProfile(user.id);
      setReadyPath(profile?.frontImageUrl ? "/occasion" : "/welcome");

      const loaded = await loadBilling(user.id);
      setBilling(loaded);
    });
  }, [router]);

  const active = useMemo(() => (billing ? hasActiveSubscription(billing) : false), [billing]);

  async function activatePlan() {
    if (!userId) return;
    setBusy(true);
    const next = await activateMonthlySubscription(userId);
    setBilling(next);
    setStatus(`Subscription activated. Access valid until ${formatDate(next.subscriptionEndsAt)}.`);
    setBusy(false);
  }

  async function buyTryOnPack() {
    if (!userId || !active) return;
    setBusy(true);
    const next = await addTryOnPack(userId, 1);
    setBilling(next);
    setStatus(`Payment test successful. ${TRYON_PACK_CREDITS} try-on credits added.`);
    setBusy(false);
  }

  return (
    <section className="card phone-single" style={{ maxWidth: 560, margin: "0 auto" }}>
      <h1>Subscription</h1>
      <p className="small">Hi {name}, active plan is required to use MirrorMe features.</p>
      <p className="small">Monthly: ${SUBSCRIPTION_PRICE_USD_MONTHLY}/month · Try-on pack: ${TRYON_PACK_PRICE_USD} for {TRYON_PACK_CREDITS} tries.</p>

      <div className="grid" style={{ marginTop: 10 }}>
        <div className="badge">
          Status: {active ? "Active" : "Inactive"}
        </div>
        <p className="small">Plan valid till: {formatDate(billing?.subscriptionEndsAt || 0)}</p>
        <p className="small">Try-on credits: {billing?.tryOnCredits ?? 0}</p>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" onClick={activatePlan} disabled={busy}>
          {busy ? "Processing..." : `Pay $${SUBSCRIPTION_PRICE_USD_MONTHLY}/month (Test)`}
        </button>
        <button type="button" className="secondary" onClick={buyTryOnPack} disabled={busy || !active}>
          {busy ? "Processing..." : `Pay $${TRYON_PACK_PRICE_USD} for ${TRYON_PACK_CREDITS} Try-Ons (Test)`}
        </button>
      </div>

      {!active ? (
        <p className="small">Activate subscription first. Try-on packs are available only for active subscribers.</p>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="secondary" onClick={() => router.push(readyPath)} disabled={!active}>
          Continue to App
        </button>
        <Link href="/welcome">
          <button type="button" className="secondary">Back to Welcome</button>
        </Link>
      </div>

      {status ? <p className="small">{status}</p> : null}
    </section>
  );
}
