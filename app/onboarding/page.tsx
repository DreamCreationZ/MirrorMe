"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { COUNTRY_OPTIONS, findCountryByName } from "@/lib/location";
import { loadProfile, saveProfileLocal, syncProfileToCloud } from "@/lib/persistence";
import { UploadedImageMeta, UserProfile } from "@/types/models";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useImageUploadSlot } from "@/features/shared/presentation/use-image-upload-slot";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

type OnboardingFormState = {
  name: string;
  age: number;
  heightCm: number;
  skinTone: string;
  frontImageUrl: string;
  frontImageMeta?: UploadedImageMeta;
  sideImageUrl: string;
  sideImageMeta?: UploadedImageMeta;
  backImageUrl: string;
  backImageMeta?: UploadedImageMeta;
  country: string;
  state: string;
  pincode: string;
  phoneCountryCode: string;
  mobileNumber: string;
  profession: string;
  styleGoals: string;
  notes: string;
};

type ImageUrlField = "frontImageUrl" | "sideImageUrl" | "backImageUrl";
type ImageMetaField = "frontImageMeta" | "sideImageMeta" | "backImageMeta";
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
  const [form, setForm] = useState<OnboardingFormState>({
    name: "",
    age: 24,
    heightCm: 165,
    skinTone: "medium",
    frontImageUrl: "",
    frontImageMeta: undefined,
    sideImageUrl: "",
    sideImageMeta: undefined,
    backImageUrl: "",
    backImageMeta: undefined,
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

  const frontUpload = useImageUploadSlot("person-front");
  const sideUpload = useImageUploadSlot("person-side");
  const backUpload = useImageUploadSlot("person-back");

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
        frontImageMeta: profile.frontImageMeta,
        sideImageUrl: profile.sideImageUrl || "",
        sideImageMeta: profile.sideImageMeta,
        backImageUrl: profile.backImageUrl || "",
        backImageMeta: profile.backImageMeta,
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

  function applyUploadedImage(urlField: ImageUrlField, metaField: ImageMetaField, uploaded: UploadedImageMeta) {
    setDirty(true);
    setForm((prev) => ({
      ...prev,
      [urlField]: uploaded.url,
      [metaField]: uploaded
    }));
    if (uploaded.source === "inline-data") {
      setStatus("Cloud upload unavailable. Image stored as secure local fallback.");
      return;
    }
    setStatus("Image uploaded securely.");
  }

  async function onPersonImageChange(
    e: ChangeEvent<HTMLInputElement>,
    slot: typeof frontUpload,
    urlField: ImageUrlField,
    metaField: ImageMetaField
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!userId) {
      setStatus("Session is initializing. Please wait a moment and retry.");
      return;
    }

    slot.clearError();
    const uploaded = await slot.start(file, {
      userId,
      allowInlineFallback: true
    });
    if (uploaded) {
      applyUploadedImage(urlField, metaField, uploaded);
    }
  }

  async function retryPersonImage(
    slot: typeof frontUpload,
    urlField: ImageUrlField,
    metaField: ImageMetaField
  ) {
    if (!userId) {
      setStatus("Session is initializing. Please wait a moment and retry.");
      return;
    }
    const uploaded = await slot.retry({
      userId,
      allowInlineFallback: true
    });
    if (uploaded) {
      applyUploadedImage(urlField, metaField, uploaded);
    }
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
      const normalizedSide =
        form.sideImageMeta?.source === "inline-data"
          ? { sideImageUrl: "", sideImageMeta: undefined }
          : { sideImageUrl: form.sideImageUrl, sideImageMeta: form.sideImageMeta };
      const normalizedBack =
        form.backImageMeta?.source === "inline-data"
          ? { backImageUrl: "", backImageMeta: undefined }
          : { backImageUrl: form.backImageUrl, backImageMeta: form.backImageMeta };
      const payload: UserProfile = {
        id: existingProfileRecord?.id || uid(),
        name: form.name.trim(),
        age: Number(form.age),
        heightCm: Number(form.heightCm),
        skinTone: form.skinTone.trim(),
        frontImageUrl: form.frontImageUrl,
        frontImageMeta: form.frontImageMeta,
        ...normalizedSide,
        ...normalizedBack,
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
    <Card as="section" variant="premium" className="phone-single">
      <h1>Guided Setup</h1>
      <p className="small">Step 1: build your persona. Step 2: enter virtual room auth. Step 3: pick occasion and style.</p>
      <div className="grid cols-3 stack-sm">
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
        <label className="full-span upload6-field">
          Upload front standing photo (required)
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="user"
            onChange={(e) => void onPersonImageChange(e, frontUpload, "frontImageUrl", "frontImageMeta")}
            required={!form.frontImageUrl}
            disabled={frontUpload.state.busy}
          />
          <div className="upload6-status-row">
            {frontUpload.state.busy ? (
              <>
                <div className="upload6-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={frontUpload.state.progress}>
                  <span style={{ width: `${frontUpload.state.progress}%` }} />
                </div>
                <small>{frontUpload.state.message || `Processing ${frontUpload.state.progress}%`}</small>
                <Button type="button" size="sm" variant="ghost" onClick={frontUpload.cancel}>Cancel</Button>
              </>
            ) : null}
            {frontUpload.state.error ? <small className="text-bad">{frontUpload.state.error}</small> : null}
            {!frontUpload.state.busy && frontUpload.state.error && frontUpload.canRetry ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => void retryPersonImage(frontUpload, "frontImageUrl", "frontImageMeta")}>Retry Upload</Button>
            ) : null}
          </div>
        </label>
        {form.frontImageUrl ? (
          <div className="full-span">
            <img src={form.frontImageUrl} alt="Front profile preview" className="front-preview" />
          </div>
        ) : null}

        <label className="full-span upload6-field">
          Upload side standing photo (optional)
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="user"
            onChange={(e) => void onPersonImageChange(e, sideUpload, "sideImageUrl", "sideImageMeta")}
            disabled={sideUpload.state.busy}
          />
          <div className="upload6-status-row">
            {sideUpload.state.busy ? (
              <>
                <div className="upload6-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={sideUpload.state.progress}>
                  <span style={{ width: `${sideUpload.state.progress}%` }} />
                </div>
                <small>{sideUpload.state.message || `Processing ${sideUpload.state.progress}%`}</small>
                <Button type="button" size="sm" variant="ghost" onClick={sideUpload.cancel}>Cancel</Button>
              </>
            ) : null}
            {sideUpload.state.error ? <small className="text-bad">{sideUpload.state.error}</small> : null}
            {!sideUpload.state.busy && sideUpload.state.error && sideUpload.canRetry ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => void retryPersonImage(sideUpload, "sideImageUrl", "sideImageMeta")}>Retry Upload</Button>
            ) : null}
          </div>
        </label>
        {form.sideImageUrl ? (
          <div className="full-span">
            <img src={form.sideImageUrl} alt="Side profile preview" className="front-preview" />
          </div>
        ) : null}

        <label className="full-span upload6-field">
          Upload back standing photo (optional)
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="user"
            onChange={(e) => void onPersonImageChange(e, backUpload, "backImageUrl", "backImageMeta")}
            disabled={backUpload.state.busy}
          />
          <div className="upload6-status-row">
            {backUpload.state.busy ? (
              <>
                <div className="upload6-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={backUpload.state.progress}>
                  <span style={{ width: `${backUpload.state.progress}%` }} />
                </div>
                <small>{backUpload.state.message || `Processing ${backUpload.state.progress}%`}</small>
                <Button type="button" size="sm" variant="ghost" onClick={backUpload.cancel}>Cancel</Button>
              </>
            ) : null}
            {backUpload.state.error ? <small className="text-bad">{backUpload.state.error}</small> : null}
            {!backUpload.state.busy && backUpload.state.error && backUpload.canRetry ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => void retryPersonImage(backUpload, "backImageUrl", "backImageMeta")}>Retry Upload</Button>
            ) : null}
          </div>
        </label>
        {form.backImageUrl ? (
          <div className="full-span">
            <img src={form.backImageUrl} alt="Back profile preview" className="front-preview" />
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
        <label className="full-span">
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
        {locationStatus ? <p className="small full-span">{locationStatus}</p> : null}
        <div className="full-span action-row">
          <Button type="submit" variant="gradient" disabled={saving}>{saving ? "Saving..." : "Save Profile"}</Button>
          <Button type="button" variant="secondary" onClick={() => router.push("/closet")}>Go to Closet</Button>
          <Button type="button" variant="secondary" onClick={() => router.push("/occasion")}>Pick Occasion</Button>
        </div>
      </form>

      {status ? <p className="small">{status}</p> : null}
    </Card>
  );
}
