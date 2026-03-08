"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCurrentUser, logout, onAuthChange } from "@/lib/auth";
import { loadProfile, saveProfile } from "@/lib/persistence";
import { UserProfile } from "@/types/models";

const links = [
  ["Home", "/"],
  ["Occasion", "/occasion"],
  ["Stylist", "/stylist"],
  ["Try-On", "/try-on"]
] as const;

export function AppNav() {
  const [userName, setUserName] = useState("");
  const [userId, setUserId] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("✨");
  const [avatarImageUrl, setAvatarImageUrl] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    const sync = async () => {
      const user = getCurrentUser();
      setUserName(user?.name || "");
      setUserId(user?.id || "");
      if (!user) {
        setAvatarEmoji("✨");
        setAvatarImageUrl("");
        setProfile(null);
        return;
      }
      const loaded = await loadProfile(user.id);
      setProfile(loaded);
      setAvatarEmoji(loaded?.avatarEmoji || "✨");
      setAvatarImageUrl(loaded?.avatarImageUrl || "");
    };
    void sync();
    return onAuthChange(async (user) => {
      setUserName(user?.name || "");
      setUserId(user?.id || "");
      if (!user) {
        setAvatarEmoji("✨");
        setAvatarImageUrl("");
        setProfile(null);
        return;
      }
      const loaded = await loadProfile(user.id);
      setProfile(loaded);
      setAvatarEmoji(loaded?.avatarEmoji || "✨");
      setAvatarImageUrl(loaded?.avatarImageUrl || "");
    });
  }, []);

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image."));
      reader.readAsDataURL(file);
    });
  }

  async function onUserPhotoChange(file?: File | null) {
    if (!file || !userId || !profile) return;
    const image = await fileToDataUrl(file);
    const next: UserProfile = { ...profile, frontImageUrl: image };
    setProfile(next);
    await saveProfile(userId, next);
  }

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", position: "relative" }}>
      <nav className="nav" aria-label="Main navigation">
        {links.map(([label, href]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
      </nav>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="avatar-nav" aria-label="Selected avatar">
          {avatarImageUrl ? <img src={avatarImageUrl} alt="Avatar" className="avatar-nav-img" /> : avatarEmoji}
        </span>
        {userName ? <span className="small">Signed in as {userName}</span> : null}
        {!userName ? (
          <Link href="/login">
            <button className="secondary">Log In</button>
          </Link>
        ) : (
          <>
            <button className="secondary" onClick={() => setMenuOpen((v) => !v)}>
              Menu
            </button>
          </>
        )}
      </div>
      {menuOpen && userName ? (
        <div className="menu-panel">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div className="profile-photo-wrap">
              {profile?.frontImageUrl ? (
                <img src={profile.frontImageUrl} alt="Profile" className="profile-photo" />
              ) : (
                <span className="small">No Photo</span>
              )}
            </div>
            <label className="small" style={{ margin: 0 }}>
              Change photo
              <input type="file" accept="image/*" onChange={(e) => void onUserPhotoChange(e.target.files?.[0])} />
            </label>
          </div>
          <h3 style={{ margin: 0 }}>My Details</h3>
          <p className="small" style={{ margin: "6px 0 0" }}>Name: {profile?.name || "-"}</p>
          <p className="small" style={{ margin: "2px 0 0" }}>Height: {profile?.heightCm ? `${profile.heightCm} cm` : "-"}</p>
          <p className="small" style={{ margin: "2px 0 0" }}>Skin tone: {profile?.skinTone || "-"}</p>
          <p className="small" style={{ margin: "2px 0 0" }}>Country: {profile?.country || "-"}</p>
          <p className="small" style={{ margin: "2px 0 0" }}>State: {profile?.state || "-"}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <Link href="/closet?section=add">
              <button className="secondary" onClick={() => setMenuOpen(false)}>Add Closet</button>
            </Link>
            <Link href="/closet?section=view">
              <button className="secondary" onClick={() => setMenuOpen(false)}>My Closet</button>
            </Link>
            <button
              className="secondary"
              onClick={async () => {
                await logout();
                window.location.href = "/login";
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
