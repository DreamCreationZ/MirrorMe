import { NextRequest, NextResponse } from "next/server";
import { addImportedTournaments } from "@/lib/birddog/importStore";
import { Game, Player, Tournament } from "@/lib/birddog/types";

type Provider = "PG" | "PBR";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 240);
}

function parseBool(value: unknown) {
  const v = clean(value).toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "y";
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((h) => clean(h).toLowerCase());

  return rows
    .slice(1)
    .filter((r) => r.some((x) => clean(x)))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        obj[h] = clean(r[idx]);
      });
      return obj;
    });
}

function playerFromRaw(raw: Record<string, unknown>, fallbackId: string): Player | null {
  const name = clean(raw.player_name ?? raw.name ?? raw.player);
  if (!name) return null;

  return {
    id: clean(raw.player_id) || fallbackId,
    name,
    school: clean(raw.player_school ?? raw.hs ?? raw.school),
    position: clean(raw.player_position ?? raw.pos ?? raw.position),
    mustSee: parseBool(raw.player_must_see ?? raw.must_see)
  };
}

function normalizeTournament(raw: Record<string, unknown>, idx: number, provider: Provider): Tournament {
  const name = clean(raw.tournament_name ?? raw.name ?? raw.event_name) || `Imported Tournament ${idx + 1}`;
  const city = clean(raw.tournament_city ?? raw.city ?? raw.location) || "TBD";
  const date = clean(raw.tournament_date ?? raw.date ?? raw.event_date) || new Date().toISOString().slice(0, 10);

  const rawGames = Array.isArray(raw.games) ? (raw.games as Record<string, unknown>[]) : [];

  const games: Game[] = rawGames.map((g, gameIdx) => {
    const playersRaw = Array.isArray(g.players) ? (g.players as Record<string, unknown>[]) : [];
    const players = playersRaw
      .map((p, pIdx) => playerFromRaw(p, `${slugify(name)}-${gameIdx + 1}-p-${pIdx + 1}`))
      .filter((p): p is Player => Boolean(p));

    return {
      id: clean(g.id) || `${slugify(name)}-g-${gameIdx + 1}`,
      field: clean(g.field ?? g.location ?? "Field TBD"),
      startTime: clean(g.startTime ?? g.start_time) || `${date}T09:00:00`,
      homeTeam: clean(g.homeTeam ?? g.home_team ?? "Team A"),
      awayTeam: clean(g.awayTeam ?? g.away_team ?? "Team B"),
      players
    };
  });

  return {
    id: clean(raw.id) || `${provider.toLowerCase()}-${slugify(name)}-${date}`,
    name,
    city,
    date,
    games
  };
}

function tournamentsFromCsvRows(rows: Record<string, string>[], provider: Provider): Tournament[] {
  type GameAcc = {
    id: string;
    field: string;
    startTime: string;
    homeTeam: string;
    awayTeam: string;
    players: Player[];
  };

  type TournamentAcc = {
    id: string;
    name: string;
    city: string;
    date: string;
    games: Map<string, GameAcc>;
  };

  const tMap = new Map<string, TournamentAcc>();

  rows.forEach((row, rowIdx) => {
    const tName = clean(row.tournament_name || row.name || row.event_name) || `Imported Tournament`;
    const tCity = clean(row.tournament_city || row.city || row.location) || "TBD";
    const tDate = clean(row.tournament_date || row.date || row.event_date) || new Date().toISOString().slice(0, 10);
    const tId = clean(row.tournament_id) || `${provider.toLowerCase()}-${slugify(tName)}-${tDate}`;

    let t = tMap.get(tId);
    if (!t) {
      t = {
        id: tId,
        name: tName,
        city: tCity,
        date: tDate,
        games: new Map()
      };
      tMap.set(tId, t);
    }

    const gId = clean(row.game_id) || `${tId}-g-${clean(row.game_no) || rowIdx + 1}`;
    let g = t.games.get(gId);
    if (!g) {
      g = {
        id: gId,
        field: clean(row.field || row.location || row.venue || "Field TBD"),
        startTime: clean(row.game_start || row.start_time || row.time) || `${tDate}T09:00:00`,
        homeTeam: clean(row.home_team || row.team_name || "Team A"),
        awayTeam: clean(row.away_team || row.opponent || "Team B"),
        players: []
      };
      t.games.set(gId, g);
    }

    const player = playerFromRaw(row, `${gId}-p-${g.players.length + 1}`);
    if (player && !g.players.some((p) => p.id === player.id || p.name.toLowerCase() === player.name.toLowerCase())) {
      g.players.push(player);
    }
  });

  return Array.from(tMap.values()).map((t) => ({
    id: t.id,
    name: t.name,
    city: t.city,
    date: t.date,
    games: Array.from(t.games.values())
  }));
}

function parseImportPayload(payload: unknown, provider: Provider): Tournament[] {
  if (Array.isArray(payload)) {
    return payload.map((item, idx) => normalizeTournament((item || {}) as Record<string, unknown>, idx, provider));
  }

  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.tournaments)) {
      return obj.tournaments.map((item, idx) => normalizeTournament((item || {}) as Record<string, unknown>, idx, provider));
    }
    if (obj.dataset && typeof obj.dataset === "object" && Array.isArray((obj.dataset as Record<string, unknown>).tournaments)) {
      const wrapped = (obj.dataset as Record<string, unknown>).tournaments as Record<string, unknown>[];
      return wrapped.map((item, idx) => normalizeTournament(item, idx, provider));
    }
  }

  return [];
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    let provider: Provider = "PG";
    let tournaments: Tournament[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const fromCompany = clean(form.get("company")).toUpperCase();
      if (fromCompany === "PBR") provider = "PBR";

      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing file" }, { status: 400 });
      }

      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".csv")) {
        const rows = parseCsv(text);
        tournaments = tournamentsFromCsvRows(rows, provider);
      } else {
        const parsed = JSON.parse(text) as unknown;
        tournaments = parseImportPayload(parsed, provider);
      }
    } else {
      const body = (await req.json()) as Record<string, unknown>;
      const fromCompany = clean(body.company).toUpperCase();
      if (fromCompany === "PBR") provider = "PBR";
      tournaments = parseImportPayload(body, provider);
    }

    if (!tournaments.length) {
      return NextResponse.json(
        {
          error: "No tournaments found in uploaded file.",
          expected: "JSON with tournaments[] or CSV with tournament/game/player columns."
        },
        { status: 400 }
      );
    }

    addImportedTournaments(provider, tournaments);

    return NextResponse.json({
      ok: true,
      company: provider,
      importedCount: tournaments.length,
      tournaments: tournaments.map((t) => ({ id: t.id, name: t.name, city: t.city, date: t.date }))
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Import failed",
        detail: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
