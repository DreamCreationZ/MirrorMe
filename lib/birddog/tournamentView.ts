import { Game, Player, Tournament } from "@/lib/birddog/types";

export type TeamSummary = {
  slug: string;
  name: string;
  from: string;
  record: string;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseTeamName(raw: string) {
  return raw.replace(/\s*\([^)]*\)\s*$/g, "").trim();
}

function parseRecord(raw: string) {
  const match = raw.match(/\(([^)]*)\)\s*$/);
  return match ? match[1].trim() : "-";
}

function playerKey(player: Player) {
  return player.id || `${player.name}-${player.school}-${player.position}`;
}

export function findTournament(tournaments: Tournament[], idOrSlug: string) {
  const byId = tournaments.find((t) => t.id === idOrSlug);
  if (byId) return byId;
  return tournaments.find((t) => slugify(t.name) === idOrSlug) || null;
}

export function buildTeamSummaries(tournament: Tournament): TeamSummary[] {
  const map = new Map<string, TeamSummary>();
  for (const game of tournament.games) {
    const homeName = parseTeamName(game.homeTeam);
    const awayName = parseTeamName(game.awayTeam);

    if (!map.has(homeName)) {
      map.set(homeName, {
        slug: slugify(homeName),
        name: homeName,
        from: "-",
        record: parseRecord(game.homeTeam)
      });
    }
    if (!map.has(awayName)) {
      map.set(awayName, {
        slug: slugify(awayName),
        name: awayName,
        from: "-",
        record: parseRecord(game.awayTeam)
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function teamGames(tournament: Tournament, teamName: string): Game[] {
  return tournament.games
    .filter((g) => parseTeamName(g.homeTeam) === teamName || parseTeamName(g.awayTeam) === teamName)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

export function teamRosterFromGames(games: Game[]): Player[] {
  const map = new Map<string, Player>();
  for (const game of games) {
    for (const player of game.players) {
      const key = playerKey(player);
      if (!map.has(key)) {
        map.set(key, player);
      }
    }
  }
  return Array.from(map.values());
}

export function matchOpponent(game: Game, teamName: string) {
  const homeName = parseTeamName(game.homeTeam);
  const awayName = parseTeamName(game.awayTeam);
  return homeName === teamName ? awayName : homeName;
}
