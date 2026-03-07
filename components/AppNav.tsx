"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCurrentUser, logout, onAuthChange } from "@/lib/auth";

const links = [
  ["Home", "/"],
  ["Profile", "/onboarding"],
  ["Closet", "/closet"],
  ["Occasion", "/occasion"],
  ["Stylist", "/stylist"],
  ["Try-On", "/try-on"]
] as const;

export function AppNav() {
  const [userName, setUserName] = useState("");

  useEffect(() => {
    const sync = () => {
      const user = getCurrentUser();
      setUserName(user?.name || "");
    };
    sync();
    return onAuthChange((user) => {
      setUserName(user?.name || "");
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
