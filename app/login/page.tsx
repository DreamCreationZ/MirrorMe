"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { login, signup, waitForAuthInit } from "@/lib/auth";
import { loadProfile, saveProfile } from "@/lib/persistence";
import { COUNTRY_OPTIONS, findCountryByIso } from "@/lib/location";
import { UserProfile } from "@/types/models";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [heightCm, setHeightCm] = useState(165);
  const [skinTone, setSkinTone] = useState("");
  const [stateName, setStateName] = useState("");
  const [country, setCountry] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState("+91");
  const [mobileNumber, setMobileNumber] = useState("");
  const [status, setStatus] = useState("");
  const [locationStatus, setLocationStatus] = useState("");
  const [locationAutoAttempted, setLocationAutoAttempted] = useState(false);

  useEffect(() => {
    waitForAuthInit().then(async (session) => {
      if (!session) return;
      const profile = await loadProfile(session.id);
      router.replace(profile ? "/occasion" : "/onboarding");
    });
  }, [router]);

  const autoDetectLocation = useCallback(async () => {
    setLocationStatus("Detecting country and state...");
    try {
      const response = await fetch("https://ipapi.co/json/");
      if (!response.ok) throw new Error("Location lookup failed.");
      const data = (await response.json()) as {
        country_code?: string;
        country_name?: string;
        region?: string;
      };

      const matched = findCountryByIso(data.country_code);
      if (matched) {
        setCountry(matched.name);
        setPhoneCountryCode(matched.dialCode);
      } else if (data.country_name) {
        setCountry(data.country_name);
      }
      setStateName(data.region || "");
      setLocationStatus("Detected location. You can edit if needed.");
    } catch {
      setLocationStatus("Could not auto-detect location. Please select manually.");
    }
  }, []);

  useEffect(() => {
    if (mode !== "signup" || locationAutoAttempted) return;
    setLocationAutoAttempted(true);
    void autoDetectLocation();
  }, [autoDetectLocation, locationAutoAttempted, mode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("");

    try {
      const user = mode === "signup" ? await signup(name, email, password) : await login(email, password);
      if (mode === "signup") {
        const payload: UserProfile = {
          id: uid(),
          name: name.trim(),
          age: 24,
          heightCm: Number(heightCm) || 165,
          skinTone: skinTone.trim(),
          country: country.trim(),
          state: stateName.trim(),
          phoneCountryCode: phoneCountryCode.trim(),
          mobileNumber: mobileNumber.trim(),
          profession: "Not set",
          styleGoals: "Not set",
          notes: "",
          createdAt: Date.now()
        };
        await saveProfile(user.id, payload);
      }
      const profile = await loadProfile(user.id);
      router.push(profile ? "/occasion" : "/onboarding");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authentication failed.");
    }
  }

  return (
    <section className="card" style={{ maxWidth: 560, margin: "0 auto" }}>
      <h1>{mode === "login" ? "Log In" : "Create Account"}</h1>
      <p className="small">Login is required to keep profile, closet, and stylist memory per user.</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className={mode === "login" ? "" : "secondary"} onClick={() => setMode("login")} type="button">Log In</button>
        <button className={mode === "signup" ? "" : "secondary"} onClick={() => setMode("signup")} type="button">Sign Up</button>
      </div>

      <form onSubmit={onSubmit} className="grid">
        {mode === "signup" ? (
          <>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Height (cm)
              <input
                type="number"
                min={100}
                value={heightCm}
                onChange={(e) => setHeightCm(Number(e.target.value))}
                required
              />
            </label>
            <label>
              Color / Skin tone
              <input value={skinTone} onChange={(e) => setSkinTone(e.target.value)} required />
            </label>
            <label>
              Country
              <select
                value={country}
                onChange={(e) => {
                  const nextCountry = e.target.value;
                  const matched = COUNTRY_OPTIONS.find((item) => item.name === nextCountry);
                  setCountry(nextCountry);
                  if (matched) setPhoneCountryCode(matched.dialCode);
                }}
                required
              >
                <option value="">Select country</option>
                {COUNTRY_OPTIONS.map((item) => (
                  <option key={item.iso} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              State
              <input value={stateName} onChange={(e) => setStateName(e.target.value)} required />
            </label>
            <label>
              Country code
              <select value={phoneCountryCode} onChange={(e) => setPhoneCountryCode(e.target.value)} required>
                {Array.from(new Map(COUNTRY_OPTIONS.map((item) => [item.dialCode, item])).values()).map((item) => (
                  <option key={item.dialCode} value={item.dialCode}>
                    {item.dialCode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mobile number
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]{6,15}"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value.replace(/[^\d]/g, ""))}
                required
              />
            </label>
            <button type="button" className="secondary" onClick={autoDetectLocation}>
              Auto Detect Country & State
            </button>
            {locationStatus ? <p className="small">{locationStatus}</p> : null}
          </>
        ) : null}

        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={4} />
        </label>

        <button type="submit">{mode === "login" ? "Log In" : "Create and Continue"}</button>
      </form>

      {status ? <p className="small text-bad">{status}</p> : null}
    </section>
  );
}
