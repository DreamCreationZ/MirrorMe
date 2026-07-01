"use client";

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, firebaseReady } from "@/lib/firebase";

const BILLING_KEY = "fashion_billing";
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export const SUBSCRIPTION_PRICE_USD_MONTHLY = 12;
export const TRYON_PACK_PRICE_USD = 1;
export const TRYON_PACK_CREDITS = 2;

export interface BillingState {
  subscribed: boolean;
  subscriptionStartedAt: number;
  subscriptionEndsAt: number;
  tryOnCredits: number;
  updatedAt: number;
  currency: "USD";
  monthlyPriceUsd: number;
  packPriceUsd: number;
  packCredits: number;
}

function billingDefaults(now = Date.now()): BillingState {
  return {
    subscribed: false,
    subscriptionStartedAt: 0,
    subscriptionEndsAt: 0,
    tryOnCredits: 0,
    updatedAt: now,
    currency: "USD",
    monthlyPriceUsd: SUBSCRIPTION_PRICE_USD_MONTHLY,
    packPriceUsd: TRYON_PACK_PRICE_USD,
    packCredits: TRYON_PACK_CREDITS
  };
}

function billingKey(userId: string) {
  return `${BILLING_KEY}:${userId}`;
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBilling(raw: unknown): BillingState {
  const base = billingDefaults();
  if (!raw || typeof raw !== "object") return base;
  const data = raw as Record<string, unknown>;
  return {
    subscribed: Boolean(data.subscribed),
    subscriptionStartedAt: Math.max(0, toNumber(data.subscriptionStartedAt)),
    subscriptionEndsAt: Math.max(0, toNumber(data.subscriptionEndsAt)),
    tryOnCredits: Math.max(0, Math.floor(toNumber(data.tryOnCredits))),
    updatedAt: Math.max(0, toNumber(data.updatedAt, Date.now())),
    currency: "USD",
    monthlyPriceUsd: SUBSCRIPTION_PRICE_USD_MONTHLY,
    packPriceUsd: TRYON_PACK_PRICE_USD,
    packCredits: TRYON_PACK_CREDITS
  };
}

function readLocalBilling(userId: string): BillingState {
  if (typeof window === "undefined") return billingDefaults();
  try {
    const raw = localStorage.getItem(billingKey(userId));
    return raw ? normalizeBilling(JSON.parse(raw)) : billingDefaults();
  } catch {
    return billingDefaults();
  }
}

function writeLocalBilling(userId: string, billing: BillingState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(billingKey(userId), JSON.stringify(billing));
}

function getDocBilling(data: Record<string, unknown> | undefined): unknown {
  return data && typeof data.billing === "object" ? data.billing : null;
}

function withExpiryApplied(billing: BillingState, now = Date.now()): BillingState {
  if (billing.subscriptionEndsAt > now) return billing;
  if (!billing.subscribed) return billing;
  return {
    ...billing,
    subscribed: false,
    updatedAt: now
  };
}

async function writeCloudBilling(userId: string, billing: BillingState) {
  if (!firebaseReady() || !db) return;
  await setDoc(doc(db, "users", userId), { billing }, { merge: true });
}

export async function loadBilling(userId: string): Promise<BillingState> {
  const local = withExpiryApplied(readLocalBilling(userId));

  if (!firebaseReady() || !db) {
    writeLocalBilling(userId, local);
    return local;
  }

  try {
    const snap = await getDoc(doc(db, "users", userId));
    const cloudRaw = getDocBilling(snap.data() as Record<string, unknown> | undefined);
    const cloud = withExpiryApplied(normalizeBilling(cloudRaw));
    const useCloud = cloud.updatedAt > local.updatedAt;
    const chosen = useCloud ? cloud : local;
    writeLocalBilling(userId, chosen);
    if (!useCloud && local.updatedAt > cloud.updatedAt) {
      void writeCloudBilling(userId, chosen).catch(() => undefined);
    }
    return chosen;
  } catch {
    writeLocalBilling(userId, local);
    return local;
  }
}

export async function saveBilling(userId: string, next: BillingState): Promise<BillingState> {
  const normalized = withExpiryApplied({
    ...normalizeBilling(next),
    updatedAt: Date.now()
  });
  writeLocalBilling(userId, normalized);
  void writeCloudBilling(userId, normalized).catch(() => undefined);
  return normalized;
}

export function hasActiveSubscription(billing: BillingState, now = Date.now()) {
  return billing.subscribed && billing.subscriptionEndsAt > now;
}

export async function activateMonthlySubscription(userId: string): Promise<BillingState> {
  const current = await loadBilling(userId);
  const now = Date.now();
  const startAt = hasActiveSubscription(current, now) ? current.subscriptionEndsAt : now;
  const next: BillingState = {
    ...current,
    subscribed: true,
    subscriptionStartedAt: current.subscriptionStartedAt || now,
    subscriptionEndsAt: startAt + MONTH_MS,
    updatedAt: now
  };
  return saveBilling(userId, next);
}

export async function addTryOnPack(userId: string, packCount = 1): Promise<BillingState> {
  const current = await loadBilling(userId);
  const now = Date.now();
  const nextCredits = current.tryOnCredits + Math.max(0, Math.floor(packCount)) * TRYON_PACK_CREDITS;
  const next: BillingState = {
    ...current,
    tryOnCredits: nextCredits,
    updatedAt: now
  };
  return saveBilling(userId, next);
}

export async function consumeTryOnCredits(userId: string, amount = 1): Promise<BillingState> {
  const current = await loadBilling(userId);
  const now = Date.now();
  const next: BillingState = {
    ...current,
    tryOnCredits: Math.max(0, current.tryOnCredits - Math.max(1, Math.floor(amount))),
    updatedAt: now
  };
  return saveBilling(userId, next);
}
