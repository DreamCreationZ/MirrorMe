"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { COUNTRY_OPTIONS, findCountryByName } from "@/lib/location";
import { loadProfile, saveProfileLocal, syncProfileToCloud } from "@/lib/persistence";
import type { UserProfile } from "@/types/models";

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

export default function OnboardingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [form, setForm] = useState({
    name: "",
    age: 24,
    heightCm: 165,
    skinTone: "medium",
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
  const [existingProfileRecord, setExistingProfileRecord] = useState<UserProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const locationLookupIdRef = useRef(0);

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
      setExistingProfileRecord(profile);
      setForm({
        name: profile.name,
        age: profile.age,
        heightCm: profile.heightCm,
        skinTone: profile.skinTone,
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
      setDirty(false);
    });
  }, [router]);

  const detectLocationFromPincode = useCallback(async () => {
    const normalized = form.pincode.trim();
    if (normalized.length < 4) return;

    const requestId = ++locationLookupIdRef.current;
    const selectedCountryIso = COUNTRY_OPTIONS.find((item) => item.name === form.country)?.iso || "";
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
      if (requestId !== locationLookupIdRef.current) return;
      setLocationStatus("Could not detect location from pincode. Please enter country/state manually.");
    }
  }, [form.country, form.pincode]);

  useEffect(() => {
    const normalized = form.pincode.trim();
    if (normalized.length < 4) return;
    const timer = setTimeout(() => {
      void detectLocationFromPincode();
    }, 350);
    return () => clearTimeout(timer);
  }, [detectLocationFromPincode, form.pincode]);

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image."));
      reader.readAsDataURL(file);
    });
  }

  async function onFrontImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const image = await fileToDataUrl(file);
    setDirty(true);
    setForm((f) => ({ ...f, frontImageUrl: image }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!userId) {
      setStatus("Session is initializing. Please wait 2 seconds and click save again.");
      return;
    }
    if (!form.frontImageUrl) {
      setStatus("Front standing photo is required before saving profile.");
      return;
    }
    if (existingProfile && !dirty) {
      setStatus("Profile already up to date.");
      router.push("/subscribe");
      return;
    }

    setSaving(true);
    setStatus("Saving profile...");

    try {
      const payload: UserProfile = {
        id: existingProfileRecord?.id || uid(),
        name: form.name.trim(),
        age: Number(form.age),
        heightCm: Number(form.heightCm),
        skinTone: form.skinTone.trim(),
        frontImageUrl: form.frontImageUrl,
        country: form.country.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
        phoneCountryCode: form.phoneCountryCode.trim(),
        mobileNumber: form.mobileNumber.trim(),
        profession: form.profession.trim(),
        styleGoals: form.styleGoals.trim(),
        notes: form.notes.trim(),
        createdAt: existingProfileRecord?.createdAt || Date.now()
      };

      saveProfileLocal(userId, payload);
      void syncProfileToCloud(userId, payload).catch(() => undefined);
      setExistingProfile(true);
      setExistingProfileRecord(payload);
      setDirty(false);
      setStatus("Profile saved.");
      setSaving(false);
      router.push("/subscribe");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save profile. Please retry.");
      setSaving(false);
    }
  }

  return (
    <section className="card phone-single">
      <h1>Guided Setup</h1>
      <p className="small">Step 1: build your persona. Step 2: enter virtual room auth. Step 3: pick occasion and style.</p>
      <div className="grid cols-3" style={{ marginBottom: 10 }}>
        <div className="badge">1. Persona</div>
        <div className="badge">2. Welcome Auth</div>
        <div className="badge">3. Closet + Stylist</div>
      </div>
      {existingProfile ? (
        <p className="small text-good">
          Profile already saved for this account. You can edit it below or continue directly.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="grid cols-2">
        <label style={{ gridColumn: "1 / -1" }}>
          Upload your front standing photo (required)
          <input type="file" accept="image/*" onChange={onFrontImageChange} required={!form.frontImageUrl} />
        </label>
        {form.frontImageUrl ? (
          <div style={{ gridColumn: "1 / -1" }}>
            <img src={form.frontImageUrl} alt="Front profile preview" className="front-preview" />
          </div>
        ) : null}
        <label>
          Name
          <input
            value={form.name}
            onChange={(e) => {
              setDirty(true);
              setForm((f) => ({ ...f, name: e.target.value }));
            }}
            required
          />
        </label>
        <label>
          Age
          <input
            type="number"
            min={13}
            max={120}
            value={form.age}
            onChange={(e) => {
              setDirty(true);
              setForm((f) => ({ ...f, age: Number(e.target.value) }));
            }}
            required
          />
        </label>
        <label>
          Height (cm)
          <input
            type="number"
            min={100}
            max={250}
            value={form.heightCm}
            onChange={(e) => {
              setDirty(true);
              setForm((f) => ({ ...f, heightCm: Number(e.target.value) }));
            }}
            required
          />
        </label>
        <label>
          Color / Skin tone
          <select
            value={form.skinTone}
            onChange={(e) => {
              setDirty(true);
              setForm((f) => ({ ...f, skinTone: e.target.value }));
            }}
            required
          >
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
            value={form.country}
            onChange={(e) => {
              setDirty(true);
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
          <input
            value={form.state}
            onChange={(e) => {
              setDirty(true);
              setForm((f) => ({ ...f, state: e.target.value }));
            }}
            required
          />
        </label>
        <label>
          Pincode
          <input
            inputMode="numeric"
            pattern="[0-9A-Za-z -]{4,12}"
            value={form.pincode}
            onChange={(e) => {
              setDirty(true);
              setForm((f) => ({ ...f, pincode: e.target.value.replace(/[^0-9A-Za-z -]/g, "") }));
            }}
            onBlur={detectLocationFromPincode}
            required
          />
        </label>
        <label>
          Country code
          <select
            value={form.phoneCountryCode}
            onChange={(e) => {
              setDirty(true);
              setForm((f) => ({ ...f, phoneCountryCode: e.target.value }));
            }}
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
            onChange={(e) => {
              setDirty(true);
              setForm((f) => ({ ...f, mobileNumber: e.target.value.replace(/[^\d]/g, "") }));
            }}
            required
          />
        </label>
        <label>
          Profession
          <input
            value={form.profession}
            onChange={(e) => {
              setDirty(true);
              setForm((f) => ({ ...f, profession: e.target.value }));
            }}
            required
          />
        </label>
        <label>
          Style goals
          <input
            placeholder="ex: minimal, elegant, streetwear"
            value={form.styleGoals}
            onChange={(e) => {
              setDirty(true);
              setForm((f) => ({ ...f, styleGoals: e.target.value }));
            }}
            required
          />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Notes
          <textarea
            value={form.notes}
            onChange={(e) => {
              setDirty(true);
              setForm((f) => ({ ...f, notes: e.target.value }));
            }}
            rows={4}
          />
        </label>
        {locationStatus ? <p className="small" style={{ gridColumn: "1 / -1" }}>{locationStatus}</p> : null}
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Profile"}</button>
          <button type="button" className="secondary" onClick={() => router.push("/closet")}>Go to Closet</button>
          <button type="button" className="secondary" onClick={() => router.push("/occasion")}>Pick Occasion</button>
        </div>
      </form>

      {status ? <p className="small">{status}</p> : null}
    </section>
  );
}
