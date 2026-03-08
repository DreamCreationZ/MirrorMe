"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { waitForAuthInit } from "@/lib/auth";
import { loadProfile } from "@/lib/persistence";

export default function HomePage() {
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [hasFrontPhoto, setHasFrontPhoto] = useState(false);

  useEffect(() => {
    waitForAuthInit().then(async (session) => {
      if (!session) {
        setLoading(false);
        return;
      }
      setLoggedIn(true);
      const profile = await loadProfile(session.id);
      setHasProfile(Boolean(profile));
      setHasFrontPhoto(Boolean(profile?.frontImageUrl));
      setLoading(false);
    });
  }, []);

  return (
    <section className="card grid phone-single">
      <h1>MirrorMe</h1>
      <p>Welcome to your AI-powered virtual dressing room.</p>
      {loading ? <p className="small">Loading...</p> : null}
      {!loading ? (
        <div className="grid cols-2">
          {!loggedIn ? (
            <Link href="/login">
              <button>Start (Login / Sign Up)</button>
            </Link>
          ) : hasProfile && hasFrontPhoto ? (
            <Link href="/welcome">
              <button>Enter Virtual Room</button>
            </Link>
          ) : hasProfile ? (
            <Link href="/onboarding">
              <button>Continue Setup</button>
            </Link>
          ) : (
            <Link href="/onboarding">
              <button>Guided Setup</button>
            </Link>
          )}
          <Link href="/closet">
            <button className="secondary">My Closet</button>
          </Link>
        </div>
      ) : null}
    </section>
  );
}
