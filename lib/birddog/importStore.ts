import { HARVEST_DATA } from "@/lib/birddog/mockData";
import { HarvesterDataset, Tournament } from "@/lib/birddog/types";

type Provider = "PG" | "PBR";

type ImportState = {
  PG: Tournament[];
  PBR: Tournament[];
};

function cloneTournament(t: Tournament): Tournament {
  return {
    ...t,
    games: t.games.map((g) => ({
      ...g,
      players: g.players.map((p) => ({ ...p }))
    }))
  };
}

function cloneDataset(d: HarvesterDataset): HarvesterDataset {
  return {
    company: d.company,
    tournaments: d.tournaments.map(cloneTournament)
  };
}

function getState(): ImportState {
  const g = globalThis as unknown as { __BIRD_DOG_IMPORTED__?: ImportState };
  if (!g.__BIRD_DOG_IMPORTED__) {
    g.__BIRD_DOG_IMPORTED__ = { PG: [], PBR: [] };
  }
  return g.__BIRD_DOG_IMPORTED__;
}

export function addImportedTournaments(company: Provider, tournaments: Tournament[]) {
  const state = getState();
  const existing = state[company];
  const map = new Map(existing.map((t) => [t.id, t]));
  tournaments.forEach((t) => map.set(t.id, cloneTournament(t)));
  state[company] = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  return state[company].length;
}

export function getHarvestData(): HarvesterDataset[] {
  const state = getState();
  const base = HARVEST_DATA.map(cloneDataset);

  return base.map((d) => {
    const imported = state[d.company as Provider] ?? [];
    if (!imported.length) return d;

    const map = new Map(d.tournaments.map((t) => [t.id, cloneTournament(t)]));
    imported.forEach((t) => map.set(t.id, cloneTournament(t)));
    return {
      company: d.company,
      tournaments: Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
    };
  });
}

export function getImportedCount(company: Provider) {
  const state = getState();
  return state[company].length;
}

export function getImportedTournaments(company: Provider): Tournament[] {
  const state = getState();
  return (state[company] || []).map(cloneTournament);
}
