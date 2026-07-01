"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { enrollBiometric, verifyBiometric } from "@/lib/biometric";
import { localStore } from "@/lib/localStore";
import { loadProfile, saveProfile } from "@/lib/persistence";
import { hasActiveSubscription, loadBilling } from "@/lib/subscription";
import { AppSettings, UserProfile } from "@/types/models";
import { LuxShowcase } from "@/components/LuxShowcase";

const GUEST_PHRASES = [
  "Hey, welcome to your personal dressing room.",
  "Looks like you are not checked in yet.",
  "Please log in and I will take you on a quick tour."
] as const;

const defaultSettings: AppSettings = {
  preferredVendors: [],
  personaNotes: "",
  assistantName: "MirrorMe",
  showOverlayRecommendations: true,
  authMethod: "passcode",
  passcode: "",
  authConfigured: false,
  authTimeoutMinutes: 45,
  biometricSetup: false
};

type WelcomeQuote = { text: string; by: string };

const DEFAULT_QUOTES: WelcomeQuote[] = [
  { text: "Take the stones people throw at you and use them to build a monument.", by: "Ratan Tata" },
  { text: "Dream, dream, dream. Dreams transform into thoughts and thoughts result in action.", by: "A. P. J. Abdul Kalam" },
  { text: "In the middle of difficulty lies opportunity.", by: "Albert Einstein" },
  { text: "Style is a way to say who you are without speaking.", by: "Rachel Zoe" },
  { text: "Your confidence is your best outfit. Wear it every day.", by: "MirrorMe" }
];

export default function WelcomePage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [authResolved, setAuthResolved] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [passcode, setPasscode] = useState("");
  const [setupPasscode, setSetupPasscode] = useState("");
  const [setupPasscodeConfirm, setSetupPasscodeConfirm] = useState("");
  const [authOk, setAuthOk] = useState(false);
  const [status, setStatus] = useState("");
  const [doorsOpen, setDoorsOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [motivationQuotes, setMotivationQuotes] = useState<WelcomeQuote[]>(DEFAULT_QUOTES);
  const [quoteStartIndex, setQuoteStartIndex] = useState(0);
  const [bioBusy, setBioBusy] = useState(false);

  const roomMessages = useMemo(() => {
    const name = profile?.name || "there";
    const quotePool = motivationQuotes.length ? motivationQuotes : DEFAULT_QUOTES;
    const orderedQuotes = quotePool.map((_, idx) => quotePool[(quoteStartIndex + idx) % quotePool.length]);
    return [
      `Hey ${name}, welcome to your personal dressing room.`,
      "I will be your personal assistant throughout your personal dressing room. Go to the occasion page to select your occasion. Once you select the occasion, the stylist page will open and I will be there with better suggestions for your day. Let's go.",
      ...orderedQuotes.map((q) => `“${q.text}” - ${q.by}`)
    ];
  }, [motivationQuotes, profile?.name, quoteStartIndex]);

  const authCacheKey = useMemo(() => (userId ? `fashion_welcome_auth_at:${userId}` : ""), [userId]);
  const biometricCredentialKey = useMemo(() => (userId ? `fashion_bio_cred:${userId}` : ""), [userId]);

  const effectiveSettings = useMemo(
    () => ({ ...defaultSettings, ...settings }),
    [settings]
  );

  const isConfigured = Boolean(
    effectiveSettings.authConfigured &&
      ((effectiveSettings.authMethod === "passcode" && effectiveSettings.passcode) ||
        ((effectiveSettings.authMethod === "fingerprint" || effectiveSettings.authMethod === "face") &&
          effectiveSettings.biometricSetup))
  );

  const loadDynamicQuotes = useCallback(async (activeUserId: string, activeName: string) => {
    if (typeof window === "undefined") return;
    const cacheKey = `fashion_welcome_quotes:${activeUserId}`;
    const now = Date.now();
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { updatedAt?: number; quotes?: WelcomeQuote[] };
        if (parsed.updatedAt && now - parsed.updatedAt < 6 * 60 * 60 * 1000 && Array.isArray(parsed.quotes) && parsed.quotes.length >= 3) {
          setMotivationQuotes(parsed.quotes);
          setQuoteStartIndex(Math.floor(Math.random() * parsed.quotes.length));
          return;
        }
      }
    } catch {
      // ignore malformed cache and continue
    }

    try {
      const res = await fetch("/api/welcome-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: activeName || undefined })
      });
      const data = (await res.json()) as { quotes?: WelcomeQuote[] };
      const quotes = (data.quotes || [])
        .map((q) => ({
          text: String(q.text || "").trim(),
          by: String(q.by || "MirrorMe").trim() || "MirrorMe"
        }))
        .filter((q) => q.text.length >= 8)
        .slice(0, 8);

      if (quotes.length) {
        setMotivationQuotes(quotes);
        setQuoteStartIndex(Math.floor(Math.random() * quotes.length));
        localStorage.setItem(cacheKey, JSON.stringify({ updatedAt: now, quotes }));
        return;
      }
    } catch {
      // fallback below
    }

    setQuoteStartIndex(Math.floor(Math.random() * DEFAULT_QUOTES.length));
  }, []);

  useEffect(() => {
    waitForAuthInit().then(async (user) => {
      if (!user) {
        setGuestMode(true);
        setAuthResolved(true);
        return;
      }
      setGuestMode(false);
      setUserId(user.id);
      const loadedProfile = await loadProfile(user.id);
      if (!loadedProfile) {
        router.replace("/onboarding");
        return;
      }
      setProfile(loadedProfile);
      const loadedSettings = localStore.getAppSettings(user.id) || defaultSettings;
      setSettings({ ...defaultSettings, ...loadedSettings });
      await loadDynamicQuotes(user.id, loadedProfile.name || user.name || "");
      const raw = typeof window !== "undefined" ? localStorage.getItem(`fashion_welcome_auth_at:${user.id}`) : null;
      const lastAuth = raw ? Number(raw) : 0;
      const ttl = (loadedSettings?.authTimeoutMinutes || 45) * 60 * 1000;
      if (lastAuth && Date.now() - lastAuth < ttl) {
        setAuthOk(true);
        setDoorsOpen(true);
      }
      setAuthResolved(true);
    });
  }, [router, loadDynamicQuotes]);

  useEffect(() => {
    if (!guestMode) return;
    const phrase = GUEST_PHRASES[phraseIndex] || "";
    let i = 0;
    setTyped("");
    const timer = setInterval(() => {
      i += 1;
      setTyped(phrase.slice(0, i));
      if (i >= phrase.length) {
        clearInterval(timer);
        setTimeout(() => setPhraseIndex((v) => (v + 1) % GUEST_PHRASES.length), 900);
      }
    }, 26);
    return () => clearInterval(timer);
  }, [guestMode, phraseIndex]);

  useEffect(() => {
    if (!authOk) return;
    setMessageIndex(0);
    const timer1 = setTimeout(() => setMessageIndex(1), 5000);
    const timer2 = setTimeout(() => setMessageIndex(2), 12000);
    const quoteInterval = setInterval(() => {
      setMessageIndex((prev) => {
        if (prev < 2) return 2;
        return prev >= roomMessages.length - 1 ? 2 : prev + 1;
      });
    }, 60000);
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearInterval(quoteInterval);
    };
  }, [authOk, roomMessages.length]);

  async function saveAuthSetup() {
    if (!userId) return;
    const method = effectiveSettings.authMethod;

    if (method === "passcode") {
      if (setupPasscode.length < 4) {
        setStatus("Set a passcode with at least 4 digits.");
        return;
      }
      if (setupPasscode !== setupPasscodeConfirm) {
        setStatus("Passcode confirmation does not match.");
        return;
      }
      const next: AppSettings = {
        ...effectiveSettings,
        passcode: setupPasscode,
        authConfigured: true,
        biometricSetup: false
      };
      setSettings(next);
      localStore.setAppSettings(userId, next);
      setSetupPasscode("");
      setSetupPasscodeConfirm("");
      setStatus("Passcode authentication configured.");
      return;
    }

    if (!effectiveSettings.biometricSetup) {
      setStatus(`Please set up ${method} first.`);
      return;
    }

    const next: AppSettings = {
      ...effectiveSettings,
      authConfigured: true,
      passcode: effectiveSettings.passcode || ""
    };
    setSettings(next);
    localStore.setAppSettings(userId, next);
    setStatus(`${method} authentication configured.`);
  }

  async function setupBiometric() {
    if (!userId || !profile) return;
    setBioBusy(true);
    const result = await enrollBiometric(biometricCredentialKey, profile.name || "MirrorMe User");
    setBioBusy(false);
    if (!result.ok) {
      setStatus(result.error || "Biometric setup failed.");
      return;
    }
    const next: AppSettings = { ...effectiveSettings, biometricSetup: true };
    setSettings(next);
    localStore.setAppSettings(userId, next);
    setStatus("Biometric setup successful.");
  }

  async function authenticate() {
    if (!isConfigured) {
      setStatus("Please complete authentication setup first.");
      return;
    }

    if (effectiveSettings.authMethod === "passcode") {
      if (passcode !== effectiveSettings.passcode) {
        setStatus("Invalid passcode.");
        return;
      }
    } else {
      const result = await verifyBiometric(biometricCredentialKey);
      if (!result.ok) {
        setStatus(result.error || "Biometric verification failed.");
        return;
      }
    }

    setStatus("");
    setAuthOk(true);
    if (authCacheKey && typeof window !== "undefined") {
      localStorage.setItem(authCacheKey, String(Date.now()));
    }
    setTimeout(() => setDoorsOpen(true), 320);
  }

  async function continueToOccasion() {
    if (!userId || !profile) return;
    const billing = await loadBilling(userId);
    if (!hasActiveSubscription(billing)) {
      setStatus("Subscription is required before entering the app.");
      router.push("/subscribe");
      return;
    }
    if (!(profile.frontImageUrl || "").trim()) {
      setStatus("Please add your front photo in Menu > Account first.");
      return;
    }
    await saveProfile(userId, profile);
    router.push("/occasion");
  }

  return (
    <section className="grid phone-grid">
      {!authResolved ? (
        <article className="card phone-card">
          <h1>Welcome</h1>
          <p className="small">Preparing your virtual room...</p>
        </article>
      ) : null}

      {guestMode ? (
        <>
          <article className="card phone-card mirror-hero">
            <h1>Welcome</h1>
            <p className="welcome-dynamic">{typed}<span className="welcome-cursor">|</span></p>
            <div className="grid cols-2" style={{ marginTop: 10 }}>
              <Link href="/login">
                <button>Check In</button>
              </Link>
              <Link href="/login">
                <button className="secondary">Take the Tour</button>
              </Link>
            </div>
          </article>
          <LuxShowcase />
        </>
      ) : null}

      {!guestMode && authResolved ? (
        <article className="card phone-card">
          <h1>Welcome</h1>

          {!isConfigured ? (
            <div className="grid">
              <p className="small">Set up your authentication first.</p>
              <label>
                Auth method
                <select
                  value={effectiveSettings.authMethod}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      authMethod: e.target.value as AppSettings["authMethod"],
                      authConfigured: false
                    }))
                  }
                >
                  <option value="passcode">Passcode</option>
                  <option value="fingerprint">Fingerprint</option>
                  <option value="face">Face unlock</option>
                </select>
              </label>

              {effectiveSettings.authMethod === "passcode" ? (
                <>
                  <label>
                    Create passcode
                    <input value={setupPasscode} onChange={(e) => setSetupPasscode(e.target.value)} placeholder="Minimum 4 digits" />
                  </label>
                  <label>
                    Confirm passcode
                    <input value={setupPasscodeConfirm} onChange={(e) => setSetupPasscodeConfirm(e.target.value)} placeholder="Re-enter passcode" />
                  </label>
                </>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="secondary" onClick={setupBiometric} disabled={bioBusy}>
                    {bioBusy ? "Setting up..." : `Set Up ${effectiveSettings.authMethod}`}
                  </button>
                  <span className="small">
                    {effectiveSettings.biometricSetup ? "Biometric is configured." : "Complete biometric setup first."}
                  </span>
                </div>
              )}

              <button type="button" onClick={saveAuthSetup}>Save Authentication Setup</button>
            </div>
          ) : !authOk ? (
            <div className="grid">
              <p className="small">Authenticate to enter your personal dressing room.</p>
              <p className="small">Method: <strong>{effectiveSettings.authMethod}</strong></p>

              {effectiveSettings.authMethod === "passcode" ? (
                <label>
                  Passcode
                  <input value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Enter passcode" />
                </label>
              ) : (
                <p className="small">Use your device {effectiveSettings.authMethod} authentication when prompted.</p>
              )}

              <button type="button" onClick={authenticate}>Authenticate</button>
            </div>
          ) : (
            <div className="grid">
              <div className={doorsOpen ? "virtual-room single-door doors-open" : "virtual-room single-door"}>
                <div className="door glass" />
                <div className="room-content">
                  <p key={messageIndex} className="door-message">{roomMessages[messageIndex]}</p>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={continueToOccasion}>Go to Occasion</button>
                <button type="button" className="secondary" onClick={() => router.push("/stylist")}>Open Stylist</button>
              </div>
            </div>
          )}

          {status ? <p className="small">{status}</p> : null}
        </article>
      ) : null}
    </section>
  );
}
