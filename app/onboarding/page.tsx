"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { COUNTRY_OPTIONS, findCountryByName } from "@/lib/location";
import { loadProfile, saveProfile } from "@/lib/persistence";
import { UserProfile } from "@/types/models";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function avatarSvg({ skin, hair, shirt, eyes }: { skin: string; hair: string; shirt: string; eyes: string }) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>
  <rect width='200' height='200' rx='26' fill='#1a1f2b'/>
  <circle cx='100' cy='78' r='42' fill='${skin}'/>
  <path d='M54 78c2-35 90-36 92 0v16H54z' fill='${hair}'/>
  <rect x='54' y='126' width='92' height='56' rx='20' fill='${shirt}'/>
  <circle cx='84' cy='80' r='5' fill='${eyes}'/><circle cx='116' cy='80' r='5' fill='${eyes}'/>
  <path d='M84 102q16 10 32 0' stroke='#9c5e53' stroke-width='4' fill='none' stroke-linecap='round'/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const AVATARS = [
  { id: "a1", imageUrl: avatarSvg({ skin: "#d3a17e", hair: "#1b2030", shirt: "#8c2f3c", eyes: "#2d4a7f" }) },
  { id: "a2", imageUrl: avatarSvg({ skin: "#f0c5a3", hair: "#25282e", shirt: "#355f86", eyes: "#4e311f" }) },
  { id: "a3", imageUrl: avatarSvg({ skin: "#a97552", hair: "#121827", shirt: "#4a7a4a", eyes: "#1c2f55" }) },
  { id: "a4", imageUrl: avatarSvg({ skin: "#e5b18c", hair: "#3a2a1f", shirt: "#6e517f", eyes: "#26375a" }) }
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [form, setForm] = useState({
    name: "",
    age: 24,
    heightCm: 165,
    skinTone: "medium",
    avatarEmoji: "a1",
    avatarImageUrl: AVATARS[0].imageUrl,
    frontImageUrl: "",
    country: "",
    state: "",
    pincode: "",
    phoneCountryCode: "+91",
    mobileNumber: "",
    profession: "",
    styleGoals: "",
    notes: ""
  });
  const [status, setStatus] = useState("");
  const [existingProfile, setExistingProfile] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");

  useEffect(() => {
    waitForAuthInit().then(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserId(user.id);

      const profile = await loadProfile(user.id);
      if (!profile) return;
      setExistingProfile(true);
      setForm({
        name: profile.name,
        age: profile.age,
        heightCm: profile.heightCm,
        skinTone: profile.skinTone,
        avatarEmoji: profile.avatarEmoji || "👩",
        avatarImageUrl: profile.avatarImageUrl || AVATARS[0].imageUrl,
        frontImageUrl: profile.frontImageUrl || "",
        country: profile.country || "",
        state: profile.state || "",
        pincode: profile.pincode || "",
        phoneCountryCode: profile.phoneCountryCode || findCountryByName(profile.country)?.dialCode || "+91",
        mobileNumber: profile.mobileNumber || "",
        profession: profile.profession,
        styleGoals: profile.styleGoals,
        notes: profile.notes ?? ""
      });
    });
  }, [router]);

  const detectLocationFromPincode = useCallback(async () => {
    const normalized = form.pincode.trim();
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
        setForm((f) => ({
          ...f,
          state: data.state || f.state,
          country: data.countryName || f.country,
          phoneCountryCode: data.phoneCountryCode || f.phoneCountryCode
        }));
        setLocationStatus("Country and state detected from pincode.");
      } else {
        setLocationStatus("Could not detect location from pincode. Please enter country/state manually.");
      }
    } catch {
      setLocationStatus("Could not detect location from pincode. Please enter country/state manually.");
    }
  }, [form.pincode]);

  useEffect(() => {
    const normalized = form.pincode.trim();
    if (normalized.length < 4) return;
    const timer = setTimeout(() => {
      void detectLocationFromPincode();
    }, 350);
    return () => clearTimeout(timer);
  }, [detectLocationFromPincode, form.pincode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId) {
      setStatus("Session is initializing. Please wait 2 seconds and click save again.");
      return;
    }
    setStatus("Saving profile...");

    const payload: UserProfile = {
      id: uid(),
      ...form,
      createdAt: Date.now()
    };

    await saveProfile(userId, payload);
    setExistingProfile(true);
    setStatus("Saved. Opening your stylist welcome...");
    router.push("/welcome");
  }

  return (
    <section className="card phone-single">
      <h1>Personal Style Profile</h1>
      <p className="small">This profile is used even when users skip closet uploads.</p>
      {existingProfile ? (
        <p className="small text-good">
          Profile already saved for this account. You can edit it below or continue directly.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="grid cols-2">
        <label>
          Choose avatar
          <div className="avatar-picker">
            {AVATARS.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                className={form.avatarEmoji === avatar.id ? "avatar-chip active avatar-chip-portrait" : "avatar-chip avatar-chip-portrait"}
                onClick={() => setForm((f) => ({ ...f, avatarEmoji: avatar.id, avatarImageUrl: avatar.imageUrl }))}
              >
                <img src={avatar.imageUrl} alt="Avatar option" className="avatar-portrait" />
              </button>
            ))}
          </div>
        </label>
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </label>
        <label>
          Age
          <input
            type="number"
            min={13}
            value={form.age}
            onChange={(e) => setForm((f) => ({ ...f, age: Number(e.target.value) }))}
            required
          />
        </label>
        <label>
          Height (cm)
          <input
            type="number"
            min={100}
            value={form.heightCm}
            onChange={(e) => setForm((f) => ({ ...f, heightCm: Number(e.target.value) }))}
            required
          />
        </label>
        <label>
          Color / Skin tone
          <input value={form.skinTone} onChange={(e) => setForm((f) => ({ ...f, skinTone: e.target.value }))} required />
        </label>
        <label>
          Country
          <select
            value={form.country}
            onChange={(e) => {
              const nextCountry = e.target.value;
              const matched = COUNTRY_OPTIONS.find((item) => item.name === nextCountry);
              setForm((f) => ({
                ...f,
                country: nextCountry,
                phoneCountryCode: matched?.dialCode || f.phoneCountryCode
              }));
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
          <input value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} required />
        </label>
        <label>
          Pincode
          <input
            inputMode="numeric"
            pattern="[0-9A-Za-z -]{4,12}"
            value={form.pincode}
            onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value }))}
            onBlur={detectLocationFromPincode}
            required
          />
        </label>
        <label>
          Country code
          <select
            value={form.phoneCountryCode}
            onChange={(e) => setForm((f) => ({ ...f, phoneCountryCode: e.target.value }))}
            required
          >
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
            value={form.mobileNumber}
            onChange={(e) => setForm((f) => ({ ...f, mobileNumber: e.target.value.replace(/[^\d]/g, "") }))}
            required
          />
        </label>
        <label>
          Profession
          <input value={form.profession} onChange={(e) => setForm((f) => ({ ...f, profession: e.target.value }))} required />
        </label>
        <label>
          Style goals
          <input
            placeholder="ex: minimal, elegant, streetwear"
            value={form.styleGoals}
            onChange={(e) => setForm((f) => ({ ...f, styleGoals: e.target.value }))}
            required
          />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Notes
          <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={4} />
        </label>
        {locationStatus ? <p className="small" style={{ gridColumn: "1 / -1" }}>{locationStatus}</p> : null}
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="submit">Save Profile</button>
          <button type="button" className="secondary" onClick={() => router.push("/closet")}>Go to Closet</button>
          <button type="button" className="secondary" onClick={() => router.push("/occasion")}>Pick Occasion</button>
        </div>
      </form>

      {status ? <p className="small">{status}</p> : null}
    </section>
  );
}
