"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { localStore } from "@/lib/localStore";
import { loadProfile, saveProfile } from "@/lib/persistence";
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
  assistantName: "Meera",
  showOverlayRecommendations: true,
  authMethod: "passcode",
  passcode: "1234"
};

export default function WelcomePage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [authResolved, setAuthResolved] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [passcode, setPasscode] = useState("");
  const [authOk, setAuthOk] = useState(false);
  const [status, setStatus] = useState("");
  const [doorsOpen, setDoorsOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [doorMessageIndex, setDoorMessageIndex] = useState(0);
  const [quoteIndex, setQuoteIndex] = useState(0);

  const doorMessages = useMemo(() => {
    const name = profile?.name || "there";
    return [
      `Hey ${name}, welcome to your personal dressing room.`,
      "I will be your personal assistant throughout your personal dressing room. Go to the occasion page to select your occasion. Once you select the occasion, the stylist page will open and I will be there with better suggestions for your day. Let's go."
    ];
  }, [profile?.name]);

  const motivationQuotes = useMemo(
    () => [
      { text: "Take the stones people throw at you and use them to build a monument.", by: "Ratan Tata" },
      { text: "Dream, dream, dream. Dreams transform into thoughts and thoughts result in action.", by: "A. P. J. Abdul Kalam" },
      { text: "In the middle of difficulty lies opportunity.", by: "Albert Einstein" },
      { text: "Style is a way to say who you are without speaking.", by: "Rachel Zoe" },
      { text: "Your confidence is your best outfit. Wear it every day.", by: "MirrorMe" }
    ],
    []
  );

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
      setSettings(loadedSettings);
      setAuthResolved(true);
    });
  }, [router]);

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
    setDoorMessageIndex(0);
    const timer = setTimeout(() => setDoorMessageIndex(1), 4300);
    return () => clearTimeout(timer);
  }, [authOk]);

  useEffect(() => {
    if (!authOk) return;
    const timer = setInterval(() => {
      setQuoteIndex((v) => (v + 1) % motivationQuotes.length);
    }, 4200);
    return () => clearInterval(timer);
  }, [authOk, motivationQuotes.length]);

  async function authenticate() {
    if (settings.authMethod === "passcode" && passcode !== (settings.passcode || "1234")) {
      setStatus("Invalid passcode.");
      return;
    }
    setStatus("");
    setAuthOk(true);
    setTimeout(() => setDoorsOpen(true), 320);
  }

  async function continueToOccasion() {
    if (!userId || !profile) return;
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
          {!authOk ? (
            <div className="grid">
              <p className="small">Authenticate to enter your personal dressing room.</p>
              <label>
                Auth method
                <select
                  value={settings.authMethod}
                  onChange={(e) => setSettings((s) => ({ ...s, authMethod: e.target.value as AppSettings["authMethod"] }))}
                >
                  <option value="passcode">Passcode</option>
                  <option value="fingerprint">Fingerprint</option>
                  <option value="face">Face unlock</option>
                </select>
              </label>
              {settings.authMethod === "passcode" ? (
                <label>
                  Passcode
                  <input value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Enter passcode" />
                </label>
              ) : (
                <p className="small">Tap authenticate to simulate {settings.authMethod} unlock on web.</p>
              )}
              <button type="button" onClick={authenticate}>Authenticate</button>
            </div>
          ) : (
            <div className="grid">
              <div className={doorsOpen ? "virtual-room single-door doors-open" : "virtual-room single-door"}>
                <div className="door glass" />
                <div className="room-content">
                  <p key={doorMessageIndex} className="door-message">{doorMessages[doorMessageIndex]}</p>
                </div>
              </div>

              <div className="welcome-quote">
                <p key={quoteIndex} className="welcome-quote-text">“{motivationQuotes[quoteIndex].text}”</p>
                <p className="welcome-quote-author">- {motivationQuotes[quoteIndex].by}</p>
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
