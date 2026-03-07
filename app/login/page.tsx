"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, login, logout, signup, waitForAuthInit } from "@/lib/auth";
import { loadProfile, saveProfile } from "@/lib/persistence";
import { COUNTRY_OPTIONS } from "@/lib/location";
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
  const [pincode, setPincode] = useState("");
  const [country, setCountry] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState("+91");
  const [mobileNumber, setMobileNumber] = useState("");
  const [status, setStatus] = useState("");
  const [locationStatus, setLocationStatus] = useState("");
  const [activeSessionName, setActiveSessionName] = useState("");

  useEffect(() => {
    waitForAuthInit().then(async (session) => {
      if (!session) return;
      setActiveSessionName(session.name || getCurrentUser()?.name || "");
    });
  }, []);

  const detectLocationFromPincode = useCallback(async () => {
    const normalized = pincode.trim();
    if (normalized.length < 4) return;

    setLocationStatus("Detecting country and state from pincode...");
    try {
      const res = await fetch(`/api/location/pincode?pincode=${encodeURIComponent(normalized)}`);
      const data = (await res.json()) as {
        state?: string;
        countryName?: string;
        phoneCountryCode?: string;
        found?: boolean;
      };
      if (data?.found) {
        if (data.state) setStateName(data.state);
        if (data.countryName) setCountry(data.countryName);
        if (data.phoneCountryCode) setPhoneCountryCode(data.phoneCountryCode);
        setLocationStatus("Country and state detected from pincode.");
      } else {
        setLocationStatus("Could not detect location from pincode. Please enter country/state manually.");
      }
    } catch {
      setLocationStatus("Could not detect location from pincode. Please enter country/state manually.");
    }
  }, [pincode]);

  useEffect(() => {
    if (mode !== "signup") return;
    const normalized = pincode.trim();
    if (normalized.length < 4) return;
    const timer = setTimeout(() => {
      void detectLocationFromPincode();
    }, 350);
    return () => clearTimeout(timer);
  }, [detectLocationFromPincode, mode, pincode]);

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
          pincode: pincode.trim(),
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
      {activeSessionName ? (
        <div style={{ marginBottom: 12 }}>
          <p className="small">Currently signed in as {activeSessionName}. You can continue, sign out, or switch account below.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="secondary" onClick={() => router.push("/occasion")}>
              Continue
            </button>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                await logout();
                setActiveSessionName("");
                setStatus("Signed out. You can now log in with another account.");
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className={mode === "login" ? "" : "secondary"} onClick={() => setMode("login")} type="button">Log In</button>
        <button className={mode === "signup" ? "" : "secondary"} onClick={() => setMode("signup")} type="button">Sign Up</button>
      </div>

      <form onSubmit={onSubmit} className="grid">
        {mode === "signup" ? (
          <>
            <label>
              Name
              <input className="auth-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Height (cm)
              <input
                type="number"
                min={100}
                value={heightCm}
                onChange={(e) => setHeightCm(Number(e.target.value))}
                className="auth-input"
                required
              />
            </label>
            <label>
              Color / Skin tone
              <input className="auth-input" value={skinTone} onChange={(e) => setSkinTone(e.target.value)} required />
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
                className="auth-input"
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
              <input className="auth-input" value={stateName} onChange={(e) => setStateName(e.target.value)} required />
            </label>
            <label>
              Pincode
              <input
                className="auth-input"
                inputMode="numeric"
                pattern="[0-9A-Za-z -]{4,12}"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                onBlur={detectLocationFromPincode}
                required
              />
            </label>
            <label>
              Country code
              <select className="auth-input" value={phoneCountryCode} onChange={(e) => setPhoneCountryCode(e.target.value)} required>
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
                className="auth-input"
                required
              />
            </label>
            {locationStatus ? <p className="small">{locationStatus}</p> : null}
          </>
        ) : null}

        <label>
          Email
          <input className="auth-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label>
          Password
          <input className="auth-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={4} />
        </label>

        <button type="submit">{mode === "login" ? "Log In" : "Create and Continue"}</button>
      </form>

      {status ? <p className="small text-bad">{status}</p> : null}
    </section>
  );
}
