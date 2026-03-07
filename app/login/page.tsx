"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { login, signup, waitForAuthInit } from "@/lib/auth";
import { loadProfile } from "@/lib/persistence";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    waitForAuthInit().then(async (session) => {
      if (!session) return;
      const profile = await loadProfile(session.id);
      router.replace(profile ? "/occasion" : "/onboarding");
    });
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("");

    try {
      const user = mode === "signup" ? await signup(name, email, password) : await login(email, password);
      const profile = await loadProfile(user.id);
      router.push(profile ? "/occasion" : "/onboarding");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authentication failed.");
    }
  }

  return (
    <section className="card" style={{ maxWidth: 560, margin: "0 auto" }}>
      <h1>{mode === "login" ? "Log In" : "Create Account"}</h1>
      <p className="small">Login is required to keep profile, closet, and stylist memory per user.</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className={mode === "login" ? "" : "secondary"} onClick={() => setMode("login")} type="button">Log In</button>
        <button className={mode === "signup" ? "" : "secondary"} onClick={() => setMode("signup")} type="button">Sign Up</button>
      </div>

      <form onSubmit={onSubmit} className="grid">
        {mode === "signup" ? (
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        ) : null}

        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={4} />
        </label>

        <button type="submit">{mode === "login" ? "Log In" : "Create and Continue"}</button>
      </form>

      {status ? <p className="small text-bad">{status}</p> : null}
    </section>
  );
}
