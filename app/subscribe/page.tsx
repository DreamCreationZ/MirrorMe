"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { loadProfile } from "@/lib/persistence";
import {
  BillingState,
  TRYON_PACK_CREDITS,
  TRYON_PACK_PRICE_USD,
  activateMonthlySubscription,
  activateYearlySubscription,
  addTryOnPack,
  availableTryOnAttempts,
  cancelAutoRenew,
  checkoutUrlForPlan,
  hasActiveSubscription,
  loadBilling,
  restoreSubscription
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
  const availableTries = useMemo(() => (billing ? availableTryOnAttempts(billing) : 0), [billing]);
  const continuePath = active ? readyPath : "/try-on";

  function isWebPlatform() {
    if (typeof navigator === "undefined") return true;
    const ua = navigator.userAgent.toLowerCase();
    return !(ua.includes("android") || ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod"));
  }

  function startWebCheckout(planCode: "monthly" | "yearly") {
    const checkoutUrl = checkoutUrlForPlan(planCode, userId);
    if (!checkoutUrl) {
      setStatus(
        "Secure checkout is not configured yet for this environment. Set NEXT_PUBLIC_STRIPE_CHECKOUT_MONTHLY_URL / NEXT_PUBLIC_STRIPE_CHECKOUT_YEARLY_URL."
      );
      return;
    }
    setStatus("Redirecting to secure checkout...");
    window.location.href = checkoutUrl;
  }

  async function runAndRefresh(task: () => Promise<BillingState>, successMessage: (next: BillingState) => string) {
    setBusy(true);
    try {
      const next = await task();
      setBilling(next);
      setStatus(successMessage(next));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Subscription action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card phone-single" style={{ maxWidth: 620, margin: "0 auto" }}>
      <h1>Subscription</h1>
      <p className="small">Hi {name}, premium unlocks unlimited session access with paid try-on credits and server-verified entitlement checks.</p>
      <p className="small">
        Monthly: ${billing?.monthlyPriceUsd ?? "-"} · Yearly: ${billing?.yearlyPriceUsd ?? "-"} · Try-on pack: ${billing?.packPriceUsd ?? TRYON_PACK_PRICE_USD} for {billing?.packCredits ?? TRYON_PACK_CREDITS} tries.
      </p>

      <div className="grid" style={{ marginTop: 10 }}>
        <div className="badge">Status: {active ? "Active" : "Free"}</div>
        <p className="small">Entitlement: {billing?.entitlementStatus || "inactive"}</p>
        <p className="small">Plan: {billing?.planCode || "free"}</p>
        <p className="small">Plan valid till: {formatDate(billing?.subscriptionEndsAt || 0)}</p>
        <p className="small">Auto-renew: {billing?.autoRenew ? "On" : "Off"}</p>
        <p className="small">Cancellation requested: {billing?.cancellationRequested ? "Yes" : "No"}</p>
        <p className="small">Try-on credits: {billing?.tryOnCredits ?? 0}</p>
        <p className="small">Available try-on attempts now: {availableTries}</p>
        <p className="small">Server-verified entitlement: {billing?.verifiedServerSide ? "Yes" : "No"}</p>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button
          type="button"
          onClick={() => {
            if (isWebPlatform()) {
              startWebCheckout("monthly");
              return;
            }
            void runAndRefresh(
              () => activateMonthlySubscription(userId),
              (next) => `Monthly subscription active until ${formatDate(next.subscriptionEndsAt)}.`
            );
          }}
          disabled={busy || !userId}
        >
          {busy ? "Processing..." : `Buy Monthly`}
        </button>

        <button
          type="button"
          className="secondary"
          onClick={() => {
            if (isWebPlatform()) {
              startWebCheckout("yearly");
              return;
            }
            void runAndRefresh(
              () => activateYearlySubscription(userId),
              (next) => `Yearly subscription active until ${formatDate(next.subscriptionEndsAt)}.`
            );
          }}
          disabled={busy || !userId}
        >
          {busy ? "Processing..." : "Buy Yearly"}
        </button>

        <button
          type="button"
          className="secondary"
          onClick={() => void runAndRefresh(() => restoreSubscription(userId), () => "Purchases restored.")}
          disabled={busy || !userId}
        >
          {busy ? "Processing..." : "Restore Purchases"}
        </button>

        <button
          type="button"
          className="secondary"
          onClick={() => void runAndRefresh(() => cancelAutoRenew(userId), () => "Auto-renew cancelled.")}
          disabled={busy || !active || !userId}
        >
          {busy ? "Processing..." : "Cancel Auto-Renew"}
        </button>

        <button
          type="button"
          className="secondary"
          onClick={() =>
            void runAndRefresh(
              () => addTryOnPack(userId, 1),
              (next) => `${next.packCredits} try-on credits added. Current balance: ${next.tryOnCredits}.`
            )
          }
          disabled={busy || !active || !userId}
        >
          {busy ? "Processing..." : `Buy Try-On Pack`}
        </button>
      </div>

      {!active ? (
        <p className="small">
          Free tier is active. You currently have {billing?.freeTryOnRemaining ?? 0} free try-on attempt(s) remaining in this monthly window.
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="secondary" onClick={() => router.push(continuePath)}>
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
