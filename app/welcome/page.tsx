"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { localStore } from "@/lib/localStore";
import { loadCloset, loadProfile, saveProfile } from "@/lib/persistence";
import { AppSettings, ClosetItem, UserProfile } from "@/types/models";
import { LuxShowcase } from "@/components/LuxShowcase";

const defaultSettings: AppSettings = {
  preferredVendors: [],
  personaNotes: "",
  assistantName: "Meera",
  showOverlayRecommendations: true,
  authMethod: "passcode",
  passcode: "1234"
};

function preferredFemaleVoice(voices: SpeechSynthesisVoice[]) {
  const femaleHint = /(female|woman|samantha|veena|zira|karen|moira|tessa|ava|serena|victoria|allison|google uk english female|aria|siri)/i;
  return (
    voices.find((v) => /en|hi/i.test(v.lang) && femaleHint.test(v.name)) ||
    voices.find((v) => femaleHint.test(v.name)) ||
    voices.find((v) => /en|hi/i.test(v.lang)) ||
    voices[0]
  );
}

function weatherSummary(code?: number, temp?: number) {
  const conditions: Record<number, string> = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Cloudy",
    45: "Foggy",
    61: "Rainy",
    63: "Moderate rain",
    71: "Snowy"
  };
  const label = typeof code === "number" ? conditions[code] || "Mixed" : "Mixed";
  const t = typeof temp === "number" ? `${Math.round(temp)}°C` : "--";
  return `${label}, ${t}`;
}

export default function WelcomePage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [authResolved, setAuthResolved] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [closet, setCloset] = useState<ClosetItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [frontImageUrl, setFrontImageUrl] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [guideChoice, setGuideChoice] = useState<"idle" | "yes" | "skip">("idle");
  const [passcode, setPasscode] = useState("");
  const [authOk, setAuthOk] = useState(false);
  const [status, setStatus] = useState("");
  const [weather, setWeather] = useState("Loading weather...");
  const [doorsOpen, setDoorsOpen] = useState(false);
  const [showAllCloset, setShowAllCloset] = useState(false);
  const [typed, setTyped] = useState("");
  const [phraseIndex, setPhraseIndex] = useState(0);

  const guestPhrases = [
    "Hey, welcome to your personal dressing room.",
    "Looks like you are not checked in yet.",
    "Please log in and I will take you on a quick tour."
  ];

  const recommendations = useMemo(() => closet.slice(0, 5), [closet]);

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const speech = new SpeechSynthesisUtterance(text);
    const voice = preferredFemaleVoice(window.speechSynthesis.getVoices());
    if (voice) {
      speech.voice = voice;
      speech.lang = voice.lang;
    }
    speech.rate = 0.95;
    speech.pitch = 1.14;
    speech.onstart = () => setSpeaking(true);
    speech.onend = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(speech);
  }

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
      setFrontImageUrl(loadedProfile.frontImageUrl || "");
      const loadedCloset = await loadCloset(user.id);
      setCloset(loadedCloset);
      const loadedSettings = localStore.getAppSettings(user.id) || defaultSettings;
      setSettings(loadedSettings);
      setAuthResolved(true);
    });
  }, [router]);

  useEffect(() => {
    if (!guestMode) return;
    const phrase = guestPhrases[phraseIndex] || "";
    let i = 0;
    setTyped("");
    const timer = setInterval(() => {
      i += 1;
      setTyped(phrase.slice(0, i));
      if (i >= phrase.length) {
        clearInterval(timer);
        setTimeout(() => setPhraseIndex((v) => (v + 1) % guestPhrases.length), 900);
      }
    }, 26);
    return () => clearInterval(timer);
  }, [guestMode, phraseIndex]);

  useEffect(() => {
    if (!authOk || !profile) return;
    const greet = `Good morning ${profile.name}. Weather: ${weather}. Here are your recommendations for today.`;
    speak(greet);
  }, [authOk, profile, weather]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setWeather("Location disabled");
      return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        const data = (await res.json()) as {
          current_weather?: { temperature?: number; weathercode?: number };
        };
        setWeather(weatherSummary(data.current_weather?.weathercode, data.current_weather?.temperature));
      } catch {
        setWeather("Unavailable");
      }
    }, () => setWeather("Unavailable"));
  }, []);

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image."));
      reader.readAsDataURL(file);
    });
  }

  async function onImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const image = await fileToDataUrl(file);
    setFrontImageUrl(image);
  }

  async function authenticate() {
    if (settings.authMethod === "passcode") {
      if (passcode !== (settings.passcode || "1234")) {
        setStatus("Invalid passcode.");
        return;
      }
    }
    setAuthOk(true);
    setTimeout(() => setDoorsOpen(true), 280);
  }

  async function continueToOccasion() {
    if (!userId || !profile) return;
    if (!frontImageUrl.trim()) {
      setStatus("Please upload your front standing photo first.");
      return;
    }
    await saveProfile(userId, { ...profile, frontImageUrl });
    router.push("/occasion");
  }

  function chooseGuide(choice: "yes" | "skip") {
    setGuideChoice(choice);
    if (choice === "yes") {
      speak("I will guide you page by page. Start with occasion, then chat, then virtual try on.");
      return;
    }
    speak("That is fine. Please choose your occasion and I am ready to style you.");
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
            <p className="small">Authenticate to enter your virtual room.</p>
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
            <div className={doorsOpen ? "virtual-room doors-open" : "virtual-room"}>
              <div className="door left" />
              <div className="door right" />
              <div className="room-content">
                <p className="small">Weather: {weather}</p>
                <p>Good morning {profile?.name || "there"}.</p>
              </div>
            </div>

            <div className={speaking ? "assistant-shell speaking folded-hands" : "assistant-shell folded-hands"} aria-hidden>
              <div className="assistant-aura" />
              {profile?.avatarImageUrl ? <img src={profile.avatarImageUrl} alt="Assistant avatar" className="assistant-avatar-art" /> : <div className="assistant-placeholder">🙏</div>}
            </div>

            <div className="grid cols-2">
              <button type="button" onClick={() => chooseGuide("yes")}>Yes, guide me</button>
              <button type="button" className="secondary" onClick={() => chooseGuide("skip")}>Skip</button>
            </div>

            {guideChoice !== "idle" ? (
              <p className="small">
                {guideChoice === "yes"
                  ? "Step 1: pick occasion. Step 2: chat with stylist. Step 3: virtual try-on."
                  : "Choose your occasion. I am ready to style you."}
              </p>
            ) : null}

            <p className="small">Here are your recommendations for today:</p>
            <div className="grid cols-3">
              {recommendations.length ? recommendations.map((item) => (
                <div key={item.id} className="badge" style={{ padding: 8 }}>
                  {settings.showOverlayRecommendations && frontImageUrl ? (
                    <img src={frontImageUrl} alt="Overlay preview" style={{ width: "100%", borderRadius: 8 }} />
                  ) : item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} style={{ width: "100%", borderRadius: 8 }} />
                  ) : (
                    <div className="small">No image</div>
                  )}
                  <p className="small" style={{ margin: "6px 0 0" }}>{item.name}</p>
                </div>
              )) : <p className="small">No closet items yet. Add in closet.</p>}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="secondary" onClick={() => setShowAllCloset((v) => !v)}>
                {showAllCloset ? "Dismiss All" : "Show All Closet"}
              </button>
              <button type="button" onClick={continueToOccasion}>Choose Occasion</button>
              <button type="button" className="secondary" onClick={() => router.push("/stylist")}>Assistant</button>
            </div>
            {showAllCloset ? (
              <div className="grid cols-3">
                {closet.map((item) => (
                  <div key={`all-${item.id}`} className="badge" style={{ padding: 8 }}>
                    <p className="small" style={{ margin: 0 }}>{item.name}</p>
                    <p className="small" style={{ margin: 0 }}>{item.category}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
        <label>
          Upload your front standing photo (required)
          <input type="file" accept="image/*" onChange={onImageChange} />
        </label>
        {frontImageUrl ? <img src={frontImageUrl} alt="Front profile" className="front-preview" /> : null}
        {status ? <p className="small">{status}</p> : null}
      </article>
      ) : null}
    </section>
  );
}
