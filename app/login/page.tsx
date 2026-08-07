"use client";

import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { APP_ROUTES } from "@/core/routing/routes";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  getCurrentUser,
  login,
  loginWithApple,
  loginWithGoogle,
  logout,
  requestPasswordReset,
  signup,
  waitForAuthInit,
  type AuthUser
} from "@/lib/auth";
import { loadProfile, saveProfileLocal, syncProfileToCloud } from "@/lib/persistence";
import { missingSignupFields } from "@/lib/profile-requirements";
import { hasActiveSubscription, loadBilling } from "@/lib/subscription";
import { COUNTRY_OPTIONS } from "@/lib/location";
import type { UserProfile } from "@/models";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const SKIN_TONE_OPTIONS = [
  "Very fair",
  "Fair",
  "Light medium",
  "Medium",
  "Olive",
  "Tan",
  "Deep",
  "Dark"
] as const;

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [age, setAge] = useState(24);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [heightCm, setHeightCm] = useState(165);
  const [skinTone, setSkinTone] = useState("");
  const [stateName, setStateName] = useState("");
  const [pincode, setPincode] = useState("");
  const [country, setCountry] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState("+91");
  const [mobileNumber, setMobileNumber] = useState("");
  const [profession, setProfession] = useState("");
  const [styleGoals, setStyleGoals] = useState("");
  const [status, setStatus] = useState("");
  const [locationStatus, setLocationStatus] = useState("");
  const [activeSessionName, setActiveSessionName] = useState("");
  const [busy, setBusy] = useState(false);
  const [socialBusy, setSocialBusy] = useState<"" | "google" | "apple">("");
  const locationLookupIdRef = useRef(0);

  const safeNextPath = (() => {
    const next = searchParams.get("next");
    if (!next || !next.startsWith("/") || next.startsWith("//")) return "";
    return next;
  })();

  useEffect(() => {
    waitForAuthInit().then(async (session) => {
      if (!session) return;
      setActiveSessionName(session.name || getCurrentUser()?.name || "");
    });
  }, []);

  const detectLocationFromPincode = useCallback(async () => {
    const normalized = pincode.trim();
    if (normalized.length < 4) {
      setLocationStatus("");
      return;
    }

    const requestId = ++locationLookupIdRef.current;
    const selectedCountryIso = COUNTRY_OPTIONS.find((item) => item.name === country)?.iso || "";
    const params = new URLSearchParams({ pincode: normalized });
    if (selectedCountryIso) {
      params.set("country", selectedCountryIso);
    }

    setLocationStatus("Detecting country and state from pincode...");
    try {
      const res = await fetch(`/api/location/pincode?${params.toString()}`);
      const data = (await res.json()) as {
        state?: string;
        countryName?: string;
        phoneCountryCode?: string;
        found?: boolean;
      };
      if (requestId !== locationLookupIdRef.current) return;
      if (data?.found) {
        if (data.state) setStateName(data.state);
        if (data.countryName) setCountry(data.countryName);
        if (data.phoneCountryCode) setPhoneCountryCode(data.phoneCountryCode);
        setLocationStatus("Country and state detected from pincode.");
      } else {
        setLocationStatus("Could not detect location from pincode. Please enter country/state manually.");
      }
    } catch {
      if (requestId !== locationLookupIdRef.current) return;
      setLocationStatus("Could not detect location from pincode. Please enter country/state manually.");
    }
  }, [country, pincode]);

  useEffect(() => {
    if (mode !== "signup") return;
    const normalized = pincode.trim();
    if (normalized.length < 4) return;
    const timer = setTimeout(() => {
      void detectLocationFromPincode();
    }, 350);
    return () => clearTimeout(timer);
  }, [detectLocationFromPincode, mode, pincode]);

  async function resolveNextRoute(user: AuthUser) {
    const profile = await loadProfile(user.id);
    if (!profile) {
      return APP_ROUTES.onboarding;
    }
    const billing = await loadBilling(user.id);
    if (!hasActiveSubscription(billing)) {
      return APP_ROUTES.subscribe;
    }
    return profile.frontImageUrl ? APP_ROUTES.occasion : APP_ROUTES.welcome;
  }

  function routeAfterAuth(fallback: string) {
    if (safeNextPath && safeNextPath !== APP_ROUTES.login) {
      return safeNextPath;
    }
    return fallback;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("");
    setBusy(true);

    try {
      if (mode === "signup") {
        const missing = missingSignupFields({
          name: name.trim(),
          age: Number(age),
          heightCm: Number(heightCm),
          skinTone: skinTone.trim(),
          country: country.trim(),
          state: stateName.trim(),
          pincode: pincode.trim(),
          phoneCountryCode: phoneCountryCode.trim(),
          mobileNumber: mobileNumber.trim(),
          profession: profession.trim(),
          styleGoals: styleGoals.trim()
        });
        if (missing.length) {
          setStatus(`Please fill all required fields before creating account: ${missing.join(", ")}.`);
          return;
        }
      }

      const user = mode === "signup" ? await signup(name, email, password) : await login(email, password);
      if (mode === "signup") {
        const payload: UserProfile = {
          id: uid(),
          name: name.trim(),
          age: Number(age) || 24,
          heightCm: Number(heightCm) || 165,
          skinTone: skinTone.trim(),
          frontImageUrl: "",
          country: country.trim(),
          state: stateName.trim(),
          pincode: pincode.trim(),
          phoneCountryCode: phoneCountryCode.trim(),
          mobileNumber: mobileNumber.trim(),
          profession: profession.trim(),
          styleGoals: styleGoals.trim(),
          notes: "",
          createdAt: Date.now()
        };
        saveProfileLocal(user.id, payload);
        void syncProfileToCloud(user.id, payload).catch(() => undefined);
        router.push(routeAfterAuth(APP_ROUTES.subscribe));
        return;
      }
      const nextRoute = await resolveNextRoute(user);
      router.push(routeAfterAuth(nextRoute));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onSocialLogin(provider: "google" | "apple") {
    setStatus("");
    setSocialBusy(provider);
    try {
      const user = provider === "google" ? await loginWithGoogle() : await loginWithApple();
      const nextRoute = await resolveNextRoute(user);
      router.push(routeAfterAuth(nextRoute));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Social login failed.");
    } finally {
      setSocialBusy("");
    }
  }

  async function onForgotPassword() {
    setStatus("");
    try {
      await requestPasswordReset(email);
      setStatus("Password reset link sent. Check your inbox.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to send reset link.");
    }
  }

  return (
    <Card as="section" variant="premium" className="phone-single auth-shell">
      <h1>{mode === "login" ? "Log In" : "Create Account"}</h1>
      <p className="small">Login is required to keep profile, closet, and stylist memory per user.</p>
      {safeNextPath ? <p className="small">After login, you will continue to: <strong>{safeNextPath}</strong></p> : null}
      {activeSessionName ? (
        <div className="stack-sm">
          <p className="small">Currently signed in as {activeSessionName}. You can continue, sign out, or switch account below.</p>
          <div className="action-row">
            <Button type="button" variant="secondary" onClick={() => router.push(APP_ROUTES.occasion)}>
              Continue
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await logout();
                setActiveSessionName("");
                setStatus("Signed out. You can now log in with another account.");
              }}
              disabled={busy || Boolean(socialBusy)}
            >
              Sign Out
            </Button>
          </div>
        </div>
      ) : null}

      <div className="action-row">
        <Button variant={mode === "login" ? "gradient" : "secondary"} onClick={() => setMode("login")} type="button">Log In</Button>
        <Button variant={mode === "signup" ? "gradient" : "secondary"} onClick={() => setMode("signup")} type="button">Sign Up</Button>
      </div>

      <div className="action-row">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void onSocialLogin("google")}
          disabled={busy || Boolean(socialBusy)}
        >
          {socialBusy === "google" ? "Connecting Google..." : "Continue with Google"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void onSocialLogin("apple")}
          disabled={busy || Boolean(socialBusy)}
        >
          {socialBusy === "apple" ? "Connecting Apple..." : "Continue with Apple"}
        </Button>
      </div>

      <form onSubmit={onSubmit} className="grid">
        {mode === "signup" ? (
          <>
            <label>
              Name
              <input className="auth-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Age
              <input
                type="number"
                min={13}
                max={120}
                value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="auth-input"
                required
              />
            </label>
            <label>
              Height (cm)
              <input
                type="number"
                min={100}
                max={250}
                value={heightCm}
                onChange={(e) => setHeightCm(Number(e.target.value))}
                className="auth-input"
                required
              />
            </label>
            <label>
              Color / Skin tone
              <select className="auth-input" value={skinTone} onChange={(e) => setSkinTone(e.target.value)} required>
                <option value="">Select skin tone</option>
                {SKIN_TONE_OPTIONS.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone}
                  </option>
                ))}
              </select>
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
                onChange={(e) => setPincode(e.target.value.replace(/[^0-9A-Za-z -]/g, ""))}
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
            <label>
              Profession
              <input className="auth-input" value={profession} onChange={(e) => setProfession(e.target.value)} required />
            </label>
            <label>
              Style goals
              <input
                className="auth-input"
                placeholder="ex: elegant, minimal, streetwear"
                value={styleGoals}
                onChange={(e) => setStyleGoals(e.target.value)}
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

        {mode === "login" ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void onForgotPassword()}
            disabled={busy || Boolean(socialBusy)}
          >
            Forgot Password
          </Button>
        ) : null}

        <Button type="submit" variant="gradient" disabled={busy || Boolean(socialBusy)}>
          {busy ? "Please wait..." : mode === "login" ? "Log In" : "Create and Continue"}
        </Button>
      </form>

      {status ? <p className="small text-bad">{status}</p> : null}
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Card as="section" variant="premium" className="phone-single auth-shell">Loading login...</Card>}>
      <LoginPageContent />
    </Suspense>
  );
}
