"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Tournament } from "@/lib/birddog/types";
import { loadHarvestDataset } from "@/lib/birddog/clientHarvest";
import { getOrgByEmail } from "@/lib/birddog/mockData";
import { domainFromEmail } from "@/lib/birddog/security";

type Provider = "PG" | "PBR";
const DASHBOARD_COMPANY_STORAGE_KEY = "bird_dog_dashboard_company";

function formatDateRange(date: string) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTournamentRange(start: string, end?: string) {
  const startLabel = formatDateRange(start);
  if (!end || end === start) return startLabel;
  return `${startLabel} - ${formatDateRange(end)}`;
}

export default function BirdDogDashboardPage() {
  const router = useRouter();
  const [company, setCompany] = useState<Provider>("PG");
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("scout@neutral.org");
  const [name, setName] = useState("Scout");
  const [orgName, setOrgName] = useState("Neutral Org");
  const [accessStatus, setAccessStatus] = useState("");
  const requestSeq = useRef(0);

  const domain = useMemo(() => domainFromEmail(email), [email]);

  const stats = useMemo(() => {
    const games = tournaments.reduce((sum, t) => sum + t.games.length, 0);
    const players = tournaments.reduce((sum, t) => sum + t.games.reduce((s, g) => s + g.players.length, 0), 0);
    return { games, players };
  }, [tournaments]);

  const loadData = useCallback(async (provider: Provider, forceRefresh = false, quiet = false) => {
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    if (!quiet) setLoading(true);
    try {
      const { dataset } = await loadHarvestDataset(provider, forceRefresh);
      if (requestId !== requestSeq.current) return;
      setTournaments((dataset.tournaments || []) as Tournament[]);
    } catch {
      if (!quiet && requestId === requestSeq.current) setTournaments([]);
    } finally {
      if (!quiet && requestId === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("company");
    if (fromQuery === "PG" || fromQuery === "PBR") {
      setCompany(fromQuery);
      return;
    }

    const saved = window.sessionStorage.getItem(DASHBOARD_COMPANY_STORAGE_KEY);
    if (saved === "PG" || saved === "PBR") {
      setCompany(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(DASHBOARD_COMPANY_STORAGE_KEY, company);

    const url = new URL(window.location.href);
    url.searchParams.set("company", company);
    const next = `${url.pathname}?${url.searchParams.toString()}`;
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [company]);

  useEffect(() => {
    void loadData(company);
  }, [company, loadData]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadData(company, false, true);
    }, 30 * 1000);

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void loadData(company, true, true);
    };

    const handlePageShow = () => {
      if (document.visibilityState !== "visible") return;
      void loadData(company, true, true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [company, loadData]);

  useEffect(() => {
    const org = getOrgByEmail(email);
    setOrgName(org.name);
  }, [email]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("bird_dog_user");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { name?: string; email?: string; orgName?: string };
      if (parsed.name) setName(parsed.name);
      if (parsed.email) setEmail(parsed.email);
      if (parsed.orgName) setOrgName(parsed.orgName);
    } catch {
      // Ignore malformed local data and keep defaults.
    }
  }, []);

  function saveCoachAccess() {
    const cleanName = name.trim() || "Scout";
    const cleanEmail = email.trim().toLowerCase();
    const org = getOrgByEmail(cleanEmail);
    setName(cleanName);
    setEmail(cleanEmail);
    setOrgName(org.name);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        "bird_dog_user",
        JSON.stringify({
          name: cleanName,
          email: cleanEmail,
          orgName: org.name
        })
      );
    }
    setAccessStatus(`Coach access saved for ${org.name}.`);
  }

  return (
    <main className="bd-root">
      <section className="bd-header">
        <div>
          <h1>Project Bird Dog</h1>
          <p className="muted">
            {name.toLowerCase()} ({email.toLowerCase()}) - {orgName}
          </p>
          <p className="muted">Status: Online</p>
        </div>
        <aside className="org-chip">
          <strong>ORG</strong>
          <span>{orgName}</span>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.localStorage.removeItem("bird_dog_user");
                window.location.href = "/login";
              }
            }}
          >
            Log Out
          </button>
        </aside>
      </section>

      <section className="panel">
        <h2>Coach Access</h2>
        <p className="muted">
          Coaches can view full shared schedules only inside the same email domain.
        </p>
        <div className="row wrap">
          <label>
            Coach Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Coach Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="coach@school.edu"
            />
          </label>
          <label>
            Organization
            <input value={orgName} readOnly />
          </label>
          <button type="button" onClick={saveCoachAccess}>
            Save Coach Access
          </button>
        </div>
        <p className="muted">Domain: {domain || "not detected"}</p>
        {accessStatus ? <p className="muted">{accessStatus}</p> : null}
      </section>

      <section className="panel">
        <h2>Tournament Dashboard</h2>
        <p className="muted">Scroll all tournaments below. Tap a tournament to open participating teams.</p>

        <div className="row wrap">
          <div>
            <p className="muted" style={{ margin: "0 0 6px" }}>Tournament Company</p>
            <div className="row wrap" style={{ gap: 6 }}>
              <button type="button" className={company === "PG" ? "" : "secondary"} onClick={() => setCompany("PG")}>
                Perfect Game (PG)
              </button>
              <button type="button" className={company === "PBR" ? "" : "secondary"} onClick={() => setCompany("PBR")}>
                Prep Baseball Report (PBR)
              </button>
            </div>
          </div>
          <button type="button" className="secondary" onClick={() => void loadData(company, true)}>
            {loading ? "Loading..." : "Refresh List"}
          </button>
        </div>

        {company === "PBR" ? (
          <>
            <p className="muted">
              {tournaments.length} PBR tournaments synced from live source.
            </p>
            <p className="muted">
              PBR updates tournament listings first. Team/game schedules appear after schedule ingest.
            </p>
          </>
        ) : (
          <>
            <p className="muted">
              {tournaments.length} PG tournaments synced from live Perfect Game sources.
            </p>
            <p className="muted">
              Live sync runs automatically about every 30 seconds while this tab is open.
            </p>
            <p className="muted">
              {stats.games} games | {stats.players} player entries
            </p>
          </>
        )}
      </section>

      <section className="dashboard-grid">
        {tournaments.map((t) => {
          const teams = new Set(t.games.flatMap((g) => [g.homeTeam, g.awayTeam])).size;
          return (
            <button
              key={t.id}
              type="button"
              className="tournament-card"
              onClick={() => router.push(`/bird-dog/tournament/${encodeURIComponent(t.id)}/teams?company=${encodeURIComponent(company)}`)}
            >
              <h3>{formatTournamentRange(t.date, t.endDate)}</h3>
              <p><strong>{t.name}</strong></p>
              <p>{t.city}</p>
              <p>{teams > 0 ? `${teams} teams` : company === "PBR" ? "Teams sync after schedule ingest" : "0 teams"}</p>
            </button>
          );
        })}

        {!loading && !tournaments.length ? (
          <article className="panel">
            <p className="muted">No tournaments available.</p>
          </article>
        ) : null}
      </section>
    </main>
  );
}
