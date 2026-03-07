"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { waitForAuthInit } from "@/lib/auth";
import { loadProfile } from "@/lib/persistence";

export default function HomePage() {
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    waitForAuthInit().then(async (session) => {
      if (!session) {
        setLoading(false);
        return;
      }
      setLoggedIn(true);
      const profile = await loadProfile(session.id);
      setHasProfile(Boolean(profile));
      setLoading(false);
    });
  }, []);

  return (
    <section className="card grid">
      <h1>Brutal Stylist</h1>
      <p>
        Build your closet inventory, tell us who you are, pick an occasion, and chat with an AI stylist that gives
        honest fashion feedback.
      </p>
      {loading ? <p className="small">Loading...</p> : null}
      {!loading ? (
        <div className="grid cols-2">
          {!loggedIn ? (
            <Link href="/login">
              <button>Log In to Start</button>
            </Link>
          ) : hasProfile ? (
            <Link href="/occasion">
              <button>Continue Styling</button>
            </Link>
          ) : (
            <Link href="/onboarding">
              <button>Start Profile</button>
            </Link>
          )}
          <Link href="/closet">
            <button className="secondary">Open Closet</button>
          </Link>
        </div>
      ) : null}
      <p className="small">
        Virtual try-on is included via an API-ready pipeline so you can plug in your preferred realistic model provider.
      </p>
    </section>
  );
}
