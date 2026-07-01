import { NextRequest, NextResponse } from "next/server";
import { getHarvestData, getImportedCount, getImportedTournaments } from "@/lib/birddog/importStore";
import { fetchLivePbrTournaments, fetchPbrTournamentGames } from "@/lib/birddog/pbrLive";
import { fetchLivePgTournaments } from "@/lib/birddog/pgLive";
import { HarvesterDataset, Tournament } from "@/lib/birddog/types";

type Provider = "PG" | "PBR";

function sortByDateThenName(tournaments: Tournament[]) {
  return [...tournaments].sort((a, b) => {
    const left = `${a.date} ${a.name}`;
    const right = `${b.date} ${b.name}`;
    return left.localeCompare(right);
  });
}

async function getPbrDataset(forceRefresh: boolean): Promise<{
  dataset: HarvesterDataset;
  liveCount: number;
  source: "pbr-live" | "fallback";
}> {
  const imported = getImportedTournaments("PBR");
  let live: Tournament[] = [];

  try {
    const liveResult = await fetchLivePbrTournaments(forceRefresh);
    live = liveResult.tournaments;
  } catch {
    live = [];
  }

  if (live.length) {
    const map = new Map<string, Tournament>();
    live.forEach((t) => map.set(t.id, t));
    imported.forEach((t) => map.set(t.id, t));
    return {
      dataset: {
        company: "PBR",
        tournaments: sortByDateThenName(Array.from(map.values()))
      },
      liveCount: live.length,
      source: "pbr-live"
    };
  }

  const fallback = getHarvestData().find((d) => d.company === "PBR");
  return {
    dataset: fallback || { company: "PBR", tournaments: imported },
    liveCount: 0,
    source: "fallback"
  };
}

async function getPgDataset(forceRefresh: boolean): Promise<{
  dataset: HarvesterDataset;
  liveCount: number;
  source: "pg-live" | "fallback";
}> {
  const imported = getImportedTournaments("PG");
  let live: Tournament[] = [];

  try {
    const liveResult = await fetchLivePgTournaments(forceRefresh);
    live = liveResult.tournaments;
  } catch {
    live = [];
  }

  if (live.length) {
    const map = new Map<string, Tournament>();
    live.forEach((t) => map.set(t.id, t));
    imported.forEach((t) => map.set(t.id, t));

    return {
      dataset: {
        company: "PG",
        tournaments: sortByDateThenName(Array.from(map.values()))
      },
      liveCount: live.length,
      source: "pg-live"
    };
  }

  const fallback = getHarvestData().find((d) => d.company === "PG");
  return {
    dataset: fallback || { company: "PG", tournaments: imported },
    liveCount: 0,
    source: "fallback"
  };
}

function clean(value: string | null) {
  return (value || "").trim();
}

export async function GET(req: NextRequest) {
  const harvestData = getHarvestData();
  const company = req.nextUrl.searchParams.get("company") as Provider | null;
  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";
  const tournamentId = clean(req.nextUrl.searchParams.get("tournamentId"));

  if (!company) {
    return NextResponse.json({
      companies: harvestData.map((d) => d.company),
      note: "Supports built-in demo data + imported JSON/CSV upload.",
      imported: {
        PG: getImportedCount("PG"),
        PBR: getImportedCount("PBR")
      }
    });
  }

  const dataset = harvestData.find((d) => d.company === company);
  if (company === "PG") {
    const pg = await getPgDataset(forceRefresh);
    return NextResponse.json({
      dataset: pg.dataset,
      antiBlock: {
        strategy: "live_pg_source_with_fallback",
        status: pg.source === "pg-live" ? "live_synced" : "fallback_active"
      },
      importedCount: getImportedCount("PG"),
      liveCount: pg.liveCount,
      syncedAt: new Date().toISOString()
    });
  }

  if (company === "PBR") {
    const pbr = await getPbrDataset(forceRefresh);
    if (tournamentId) {
      const tournaments = [...(pbr.dataset.tournaments || [])];
      const targetIndex = tournaments.findIndex((item) => item.id === tournamentId);

      if (targetIndex >= 0) {
        const target = tournaments[targetIndex];
        if (target?.sourceUrl) {
          try {
            const games = await fetchPbrTournamentGames(target, forceRefresh);
            tournaments[targetIndex] = {
              ...target,
              games
            };
          } catch {
            // Keep existing tournament data if live schedule sync fails.
          }
        }
      }

      pbr.dataset = {
        ...pbr.dataset,
        tournaments
      };
    }

    return NextResponse.json({
      dataset: pbr.dataset,
      antiBlock: {
        strategy: "live_pbr_source_with_fallback",
        status: pbr.source === "pbr-live" ? "live_synced" : "fallback_active"
      },
      importedCount: getImportedCount("PBR"),
      liveCount: pbr.liveCount,
      hydratedTournamentId: tournamentId || undefined,
      syncedAt: new Date().toISOString()
    });
  }

  if (!dataset) {
    return NextResponse.json({ error: "Unknown company" }, { status: 404 });
  }

  return NextResponse.json({
    dataset,
    antiBlock: {
      strategy: "import_or_worker_pipeline",
      status: "import_enabled"
    },
    importedCount: getImportedCount(company)
  });
}
