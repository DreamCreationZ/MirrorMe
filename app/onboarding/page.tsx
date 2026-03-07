"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { loadProfile, saveProfile } from "@/lib/persistence";
import { UserProfile } from "@/types/models";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [form, setForm] = useState({
    name: "",
    age: 24,
    heightCm: 165,
    skinTone: "medium",
    profession: "",
    styleGoals: "",
    notes: ""
  });
  const [status, setStatus] = useState("");
  const [existingProfile, setExistingProfile] = useState(false);

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
        profession: profile.profession,
        styleGoals: profile.styleGoals,
        notes: profile.notes ?? ""
      });
    });
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("Saving profile...");

    const payload: UserProfile = {
      id: uid(),
      ...form,
      createdAt: Date.now()
    };

    if (!userId) return;

    await saveProfile(userId, payload);
    setExistingProfile(true);
    setStatus("Saved. You can move to closet or occasion.");
  }

  return (
    <section className="card">
      <h1>Personal Style Profile</h1>
      <p className="small">This profile is used even when users skip closet uploads.</p>
      {existingProfile ? (
        <p className="small text-good">
          Profile already saved for this account. You can edit it below or continue directly.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="grid cols-2">
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
          Skin tone
          <input value={form.skinTone} onChange={(e) => setForm((f) => ({ ...f, skinTone: e.target.value }))} required />
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
