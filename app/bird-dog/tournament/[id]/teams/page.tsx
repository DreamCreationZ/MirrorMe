"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Tournament } from "@/lib/birddog/types";
import { buildTeamSummaries, findTournament } from "@/lib/birddog/tournamentView";
import { loadHarvestDataset } from "@/lib/birddog/clientHarvest";

type Provider = "PG" | "PBR";

export default function TournamentTeamsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();

  const company = (search.get("company") || "PG") as Provider;
  const tournamentId = decodeURIComponent(params.id);
  const dashboardHref = `/bird-dog?company=${encodeURIComponent(company)}`;

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading participating teams...");
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teamSearch, setTeamSearch] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const { dataset } = await loadHarvestDataset(
          company,
          false,
          company === "PBR" ? { tournamentId } : undefined
        );
        if (!active) return;
        const tournaments = (dataset.tournaments || []) as Tournament[];
        const found = findTournament(tournaments, tournamentId);
        setTournament(found);
        if (!found) {
          setStatus("Tournament not found.");
        } else {
          const teamCount = buildTeamSummaries(found).length;
          if (teamCount === 0) {
            setStatus(
              `Schedule and team roster data is not uploaded yet for this tournament. It will sync automatically once published on ${company}.`
            );
          } else {
            setStatus(`Teams in tournament: ${teamCount}`);
          }
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to load tournament teams.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [company, tournamentId]);

  const teams = useMemo(() => (tournament ? buildTeamSummaries(tournament) : []), [tournament]);
  const filteredTeams = useMemo(() => {
    const query = teamSearch.trim().toLowerCase();
    if (!query) return teams;
    return teams.filter((team) => team.name.toLowerCase().includes(query));
  }, [teamSearch, teams]);

  return (
    <main className="bd-root">
      <section className="panel">
        <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button type="button" className="secondary" onClick={() => router.push(dashboardHref)}>
            Back
          </button>
          <h1 style={{ margin: 0 }}>{tournament?.name || "Participating Teams"}</h1>
          <button
            type="button"
            className="secondary"
            onClick={() => router.push(dashboardHref)}
          >
            Dashboard
          </button>
        </div>
        <p className="muted">{status}</p>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Participating Teams</h2>
        <div className="row wrap">
          <label>
            Search Team (name only)
            <input
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              placeholder="Type team name..."
            />
          </label>
        </div>
        <p className="muted">
          Showing {filteredTeams.length} of {teams.length} teams. Search runs across all teams loaded for this tournament.
        </p>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>From</th>
              <th>Record</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredTeams.map((team) => (
              <tr key={team.slug}>
                <td>{team.name}</td>
                <td>{team.from}</td>
                <td>{team.record}</td>
                <td>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      router.push(
                        `/bird-dog/tournament/${encodeURIComponent(tournamentId)}/team/${encodeURIComponent(team.slug)}?company=${encodeURIComponent(company)}&teamView=roster`
                      )
                    }
                  >
                    Open Team
                  </button>
                </td>
              </tr>
            ))}
            {!loading && !filteredTeams.length ? (
              <tr>
                <td colSpan={4}>
                  {!teams.length
                    ? `Schedule and team roster data is not uploaded yet for this tournament. It will sync automatically once published on ${company}.`
                    : "No teams match this search."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
