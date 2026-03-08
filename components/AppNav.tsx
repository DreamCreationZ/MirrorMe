"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCurrentUser, logout, onAuthChange } from "@/lib/auth";
import { loadProfile } from "@/lib/persistence";

const links = [
  ["Home", "/"],
  ["Profile", "/onboarding"],
  ["Welcome", "/welcome"],
  ["Closet", "/closet"],
  ["Occasion", "/occasion"],
  ["Stylist", "/stylist"],
  ["Try-On", "/try-on"]
] as const;

export function AppNav() {
  const [userName, setUserName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("✨");
  const [avatarImageUrl, setAvatarImageUrl] = useState("");

  useEffect(() => {
    const sync = async () => {
      const user = getCurrentUser();
      setUserName(user?.name || "");
      if (!user) {
        setAvatarEmoji("✨");
        setAvatarImageUrl("");
        return;
      }
      const profile = await loadProfile(user.id);
      setAvatarEmoji(profile?.avatarEmoji || "✨");
      setAvatarImageUrl(profile?.avatarImageUrl || "");
    };
    void sync();
    return onAuthChange(async (user) => {
      setUserName(user?.name || "");
      if (!user) {
        setAvatarEmoji("✨");
        setAvatarImageUrl("");
        return;
      }
      const profile = await loadProfile(user.id);
      setAvatarEmoji(profile?.avatarEmoji || "✨");
      setAvatarImageUrl(profile?.avatarImageUrl || "");
    });
  }, []);

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
            <Link href="/login">
              <button className="secondary">Switch Account</button>
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
          </>
        )}
      </div>
    </div>
  );
}
