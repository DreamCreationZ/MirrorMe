import { Game, Tournament } from "@/lib/birddog/types";

const PBR_EVENTS_URL = "https://tournaments.prepbaseballreport.com";
const PBR_AJAX_EVENTS_URL = `${PBR_EVENTS_URL}/ajax-events`;
const PBR_SCHEDULE_AJAX_URL = `${PBR_EVENTS_URL}/schedule_ajax`;
const CACHE_TTL_MS = 2 * 60 * 1000;
const SCHEDULE_CACHE_TTL_MS = 45 * 1000;
const MAX_AJAX_PAGES = 10;
const MAX_TOURNAMENTS = 60;

type PbrCache = {
  fetchedAt: number;
  tournaments: Tournament[];
};

type PbrAjaxEvent = {
  id?: number | string;
  event_id?: number | string;
  name?: string;
  start_date?: string;
  end_date?: string;
  city?: string;
  state?: string;
  display_location?: string;
  schedule_link?: string;
};

type PbrAjaxResponse = {
  eventlist?: PbrAjaxEvent[];
};

type PbrScheduleDivision = {
  event_price_id?: number | string;
  schedule_id?: number | string;
};

type PbrScheduleAjaxTeam = {
  schedule_game_id?: number | string;
  game_number?: number | string;
  division?: string;
  location?: string;
  field_name?: string;
  time?: string;
  schedule_time?: string;
  team_name_1?: string;
  team_name_2?: string;
  team_score_1?: number | string;
  team_score_2?: number | string;
};

type PbrScheduleAjaxDay = {
  date?: string;
  date_short?: string;
  teams?: PbrScheduleAjaxTeam[] | Record<string, PbrScheduleAjaxTeam>;
};

type PbrScheduleAjaxResponse = {
  schedules?: Record<string, PbrScheduleAjaxDay>;
};

type PbrScheduleCacheEntry = {
  fetchedAt: number;
  games: Game[];
};

function getCacheRef() {
  const g = globalThis as unknown as { __BIRD_DOG_PBR_CACHE__?: PbrCache };
  if (!g.__BIRD_DOG_PBR_CACHE__) {
    g.__BIRD_DOG_PBR_CACHE__ = { fetchedAt: 0, tournaments: [] };
  }
  return g;
}

function getScheduleCacheRef() {
  const g = globalThis as unknown as { __BIRD_DOG_PBR_SCHEDULE_CACHE__?: Record<string, PbrScheduleCacheEntry> };
  if (!g.__BIRD_DOG_PBR_SCHEDULE_CACHE__) {
    g.__BIRD_DOG_PBR_SCHEDULE_CACHE__ = {};
  }
  return g;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/");
}

function normalizeSpace(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function stripTags(value: string) {
  return normalizeSpace(value.replace(/<[^>]*>/g, " "));
}

function safeString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 240);
}

function toIsoDate(raw: string) {
  const normalized = raw.trim();
  if (!normalized) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const slash = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slash) return "";

  const month = slash[1].padStart(2, "0");
  const day = slash[2].padStart(2, "0");
  const year = slash[3];
  return `${year}-${month}-${day}`;
}

function absoluteUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith("/")) return `${PBR_EVENTS_URL}/${url}`;
  return `${PBR_EVENTS_URL}${url}`;
}

function mapAjaxEventToTournament(event: PbrAjaxEvent): Tournament | null {
  const name = normalizeSpace(safeString(event.name));
  if (!name) return null;

  const startDate = toIsoDate(safeString(event.start_date));
  const endDate = toIsoDate(safeString(event.end_date));

  const cityRaw = normalizeSpace(safeString(event.display_location));
  const city = cityRaw || [safeString(event.city), safeString(event.state)].filter(Boolean).join(", ") || "TBD";

  const sourceUrlRaw = safeString(event.schedule_link);
  const sourceUrl = sourceUrlRaw ? absoluteUrl(sourceUrlRaw) : undefined;

  const idValue = safeString(event.id || event.event_id);
  const idDate = startDate || "undated";
  const id = idValue
    ? `pbr-live-${slugify(idValue)}`
    : `pbr-live-${slugify(name)}-${slugify(city || "city-tbd")}-${idDate}`;

  return {
    id,
    name,
    city,
    date: startDate || new Date().toISOString().slice(0, 10),
    endDate: endDate || undefined,
    sourceUrl,
    source: "pbr-live",
    games: []
  };
}

function sortTournaments(tournaments: Tournament[]) {
  return tournaments.sort((a, b) => {
    const left = `${a.date} ${a.name}`;
    const right = `${b.date} ${b.name}`;
    return left.localeCompare(right);
  });
}

function parseAjaxEventsFromJson(json: PbrAjaxResponse): Tournament[] {
  const events = Array.isArray(json?.eventlist) ? json.eventlist : [];
  const map = new Map<string, Tournament>();

  events.forEach((event) => {
    const tournament = mapAjaxEventToTournament(event);
    if (!tournament) return;
    if (!map.has(tournament.id)) {
      map.set(tournament.id, tournament);
    }
  });

  return sortTournaments(Array.from(map.values()));
}

async function fetchViaAjaxEvents(): Promise<Tournament[]> {
  const map = new Map<string, Tournament>();

  for (let page = 1; page <= MAX_AJAX_PAGES; page += 1) {
    const url = `${PBR_AJAX_EVENTS_URL}?page=${page}&layout=small&past_events=1&events_exits=&organization_id=`;
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "application/json,text/plain,*/*"
      },
      cache: "no-store"
    });

    if (!res.ok) {
      if (page === 1) {
        throw new Error(`PBR ajax-events returned ${res.status}.`);
      }
      break;
    }

    const payload = (await res.json()) as PbrAjaxResponse;
    const pageTournaments = parseAjaxEventsFromJson(payload);

    if (!pageTournaments.length) {
      break;
    }

    pageTournaments.forEach((tournament) => {
      if (!map.has(tournament.id) && map.size < MAX_TOURNAMENTS) {
        map.set(tournament.id, tournament);
      }
    });

    if (map.size >= MAX_TOURNAMENTS) {
      break;
    }
  }

  return sortTournaments(Array.from(map.values()));
}

function parsePbrEventsFromHtml(html: string): Tournament[] {
  const events: Tournament[] = [];
  const seen = new Set<string>();

  const eventPattern =
    /<meta itemprop="name" content="([^"]*)">[\s\S]*?<meta itemprop="startDate" content="([^"]*)">[\s\S]*?<meta itemprop="endDate" content="([^"]*)">[\s\S]*?<meta itemprop="addressLocality" content="([^"]*)">[\s\S]*?<meta itemprop="addressRegion" content="([^"]*)">[\s\S]*?<a href="([^"]*\/events\/[^\"]*)"[^>]*>\s*SCHEDULES\s*<\/a>/gi;

  let match: RegExpExecArray | null = eventPattern.exec(html);
  while (match) {
    const name = normalizeSpace(match[1]);
    const startDate = toIsoDate(match[2]);
    const endDate = toIsoDate(match[3]);
    const city = normalizeSpace(match[4]);
    const state = normalizeSpace(match[5]);
    const scheduleUrl = absoluteUrl(normalizeSpace(match[6]));
    const displayCity = [city, state].filter(Boolean).join(", ");
    const idDate = startDate || "undated";
    const id = `pbr-live-${slugify(name)}-${slugify(displayCity || city || "city-tbd")}-${idDate}`;

    if (name && !seen.has(id)) {
      seen.add(id);
      events.push({
        id,
        name,
        city: displayCity || city || "TBD",
        date: startDate || new Date().toISOString().slice(0, 10),
        endDate: endDate || undefined,
        sourceUrl: scheduleUrl,
        source: "pbr-live",
        games: []
      });
    }

    match = eventPattern.exec(html);
  }

  if (events.length) {
    return sortTournaments(events);
  }

  const fallbackPattern = /<div class="live-event-box[\s\S]*?<\/div>\s*<\/div>/gi;
  let fallbackMatch: RegExpExecArray | null = fallbackPattern.exec(html);

  while (fallbackMatch) {
    const card = fallbackMatch[0];
    const nameMatch = card.match(/<span class="list-title">\s*<b>([\s\S]*?)<\/b>/i);
    const cityMatch = card.match(/<b class="list-city">\s*([\s\S]*?)<\/b>/i);
    const startMatch = card.match(/<meta itemprop="startDate" content="([^"]*)">/i);
    const endMatch = card.match(/<meta itemprop="endDate" content="([^"]*)">/i);
    const hrefMatch = card.match(/<a href="([^"]*\/events\/[^\"]*)"[^>]*>\s*SCHEDULES\s*<\/a>/i);

    const name = stripTags(nameMatch?.[1] || "");
    const city = stripTags(cityMatch?.[1] || "");
    const startDate = toIsoDate(startMatch?.[1] || "");
    const endDate = toIsoDate(endMatch?.[1] || "");
    const scheduleUrl = hrefMatch?.[1] ? absoluteUrl(hrefMatch[1]) : "";
    const idDate = startDate || "undated";
    const id = `pbr-live-${slugify(name)}-${slugify(city || "city-tbd")}-${idDate}`;

    if (name && !seen.has(id)) {
      seen.add(id);
      events.push({
        id,
        name,
        city: city || "TBD",
        date: startDate || new Date().toISOString().slice(0, 10),
        endDate: endDate || undefined,
        sourceUrl: scheduleUrl || undefined,
        source: "pbr-live",
        games: []
      });
    }

    fallbackMatch = fallbackPattern.exec(html);
  }

  return sortTournaments(events);
}

function pbrFetchHeaders(accept: string) {
  return {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    accept
  };
}

function toScheduleAllUrl(sourceUrl: string) {
  try {
    const parsed = new URL(absoluteUrl(sourceUrl));
    const eventMatch = parsed.pathname.match(/\/events\/([^/]+)/i);
    if (eventMatch?.[1]) {
      parsed.pathname = `/events/${eventMatch[1]}/schedule/all`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    }
    return absoluteUrl(sourceUrl);
  } catch {
    return absoluteUrl(sourceUrl);
  }
}

function readEventIdFromScheduleHtml(html: string) {
  const match = html.match(/window\.EVENT_ID\s*=\s*"([^"]+)"/i);
  return safeString(match?.[1]);
}

function readDivisionsFromScheduleHtml(html: string): PbrScheduleDivision[] {
  const match = html.match(/window\.DIVISIONS\s*=\s*(\{[\s\S]*?\});/i);
  if (!match?.[1]) return [];
  try {
    const parsed = JSON.parse(match[1]) as Record<string, PbrScheduleDivision>;
    return Object.values(parsed || {});
  } catch {
    return [];
  }
}

async function requestScheduleAjax(
  eventId: string,
  eventPriceId: string,
  scheduleId: string
): Promise<PbrScheduleAjaxResponse | null> {
  const payload = new URLSearchParams({
    event_id: eventId,
    event_price_id: eventPriceId,
    event_registration_item_id: "0",
    schedule_id: scheduleId,
    data_type: "schedules"
  });

  const res = await fetch(PBR_SCHEDULE_AJAX_URL, {
    method: "POST",
    headers: {
      ...pbrFetchHeaders("application/json,text/plain,*/*"),
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
    },
    body: payload.toString(),
    cache: "no-store"
  });

  if (!res.ok) return null;
  const json = (await res.json()) as unknown;
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  return json as PbrScheduleAjaxResponse;
}

function hasScheduleRows(payload: PbrScheduleAjaxResponse | null) {
  if (!payload?.schedules) return false;
  return Object.values(payload.schedules).some((day) => {
    if (!day || typeof day !== "object") return false;
    const teams = day.teams;
    if (Array.isArray(teams)) return teams.length > 0;
    if (teams && typeof teams === "object") return Object.keys(teams).length > 0;
    return false;
  });
}

function normalizeScheduleTime(raw: string) {
  const value = safeString(raw);
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return value.replace(" ", "T");
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  return "";
}

function toIsoDateTimeFromLabel(dateShort: string, timeLabel: string) {
  const date = toIsoDate(dateShort);
  if (!date) return "";

  const time = safeString(timeLabel).toUpperCase();
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return `${date}T00:00:00`;

  let hour = Number(match[1]);
  const minute = match[2];
  const meridiem = match[3];
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return `${date}T${String(hour).padStart(2, "0")}:${minute}:00`;
}

function flattenDayTeams(day: PbrScheduleAjaxDay): PbrScheduleAjaxTeam[] {
  const teams = day.teams;
  if (Array.isArray(teams)) return teams;
  if (teams && typeof teams === "object") {
    return Object.values(teams);
  }
  return [];
}

function parseGamesFromSchedulePayload(payload: PbrScheduleAjaxResponse) {
  const games: Game[] = [];
  const seen = new Set<string>();
  const schedules = payload.schedules || {};

  Object.values(schedules).forEach((day) => {
    if (!day) return;
    const dayLabel = normalizeSpace(safeString(day.date));
    const dayShort = safeString(day.date_short);

    flattenDayTeams(day).forEach((team) => {
      const gameIdRaw =
        safeString(team.schedule_game_id) ||
        `${dayShort}-${safeString(team.game_number)}-${safeString(team.team_name_1)}-${safeString(team.team_name_2)}`;
      const gameId = `pbr-game-${slugify(gameIdRaw)}`;
      if (!gameId || seen.has(gameId)) return;
      seen.add(gameId);

      const startTime =
        normalizeScheduleTime(safeString(team.schedule_time)) || toIsoDateTimeFromLabel(dayShort, safeString(team.time));

      games.push({
        id: gameId,
        field: normalizeSpace(safeString(team.location) || safeString(team.field_name)),
        startTime: startTime || new Date().toISOString(),
        homeTeam: normalizeSpace(safeString(team.team_name_1) || "TBD"),
        awayTeam: normalizeSpace(safeString(team.team_name_2) || "TBD"),
        dayLabel,
        timeLabel: normalizeSpace(safeString(team.time)),
        gameNo: safeString(team.game_number),
        ageDiv: normalizeSpace(safeString(team.division)),
        homeScore: safeString(team.team_score_1),
        awayScore: safeString(team.team_score_2),
        players: []
      });
    });
  });

  return games.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function mergeGames(...groups: Game[][]) {
  const map = new Map<string, Game>();
  groups.flat().forEach((game) => {
    if (!map.has(game.id)) {
      map.set(game.id, game);
    }
  });
  return Array.from(map.values()).sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export async function fetchPbrTournamentGames(tournament: Tournament, forceRefresh = false): Promise<Game[]> {
  if (!tournament.sourceUrl) return tournament.games || [];

  const cacheRef = getScheduleCacheRef();
  const cache = cacheRef.__BIRD_DOG_PBR_SCHEDULE_CACHE__ || {};
  const key = tournament.id || tournament.sourceUrl;
  const entry = cache[key];
  const now = Date.now();

  if (!forceRefresh && entry && now - entry.fetchedAt < SCHEDULE_CACHE_TTL_MS && entry.games.length) {
    return entry.games;
  }

  const scheduleAllUrl = toScheduleAllUrl(tournament.sourceUrl);
  const res = await fetch(scheduleAllUrl, {
    headers: pbrFetchHeaders("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    cache: "no-store"
  });
  if (!res.ok) {
    return tournament.games || [];
  }

  const html = await res.text();
  const eventId = readEventIdFromScheduleHtml(html);
  if (!eventId) {
    return tournament.games || [];
  }

  const primaryPayload = await requestScheduleAjax(eventId, "0", "0");
  let games = primaryPayload ? parseGamesFromSchedulePayload(primaryPayload) : [];

  if (!games.length) {
    const divisions = readDivisionsFromScheduleHtml(html)
      .map((division) => ({
        eventPriceId: safeString(division.event_price_id),
        scheduleId: safeString(division.schedule_id)
      }))
      .filter((division) => division.eventPriceId && division.eventPriceId !== "0");

    const divisionGames: Game[][] = [];
    for (const division of divisions) {
      const payload = await requestScheduleAjax(eventId, division.eventPriceId, division.scheduleId || "0");
      if (!hasScheduleRows(payload)) continue;
      divisionGames.push(parseGamesFromSchedulePayload(payload as PbrScheduleAjaxResponse));
    }

    if (divisionGames.length) {
      games = mergeGames(...divisionGames);
    }
  }

  if (!games.length) {
    return tournament.games || [];
  }

  cacheRef.__BIRD_DOG_PBR_SCHEDULE_CACHE__ = {
    ...cache,
    [key]: {
      fetchedAt: now,
      games
    }
  };

  return games;
}

export async function fetchLivePbrTournaments(forceRefresh = false) {
  const ref = getCacheRef();
  const cache = ref.__BIRD_DOG_PBR_CACHE__!;
  const now = Date.now();
  const isFresh = now - cache.fetchedAt < CACHE_TTL_MS;

  if (!forceRefresh && isFresh && cache.tournaments.length) {
    return { tournaments: cache.tournaments, fromCache: true };
  }

  try {
    const ajaxTournaments = await fetchViaAjaxEvents();
    if (ajaxTournaments.length) {
      ref.__BIRD_DOG_PBR_CACHE__ = {
        fetchedAt: now,
        tournaments: ajaxTournaments
      };
      return { tournaments: ajaxTournaments, fromCache: false };
    }
  } catch {
    // Fall back to the homepage parser below.
  }

  const res = await fetch(PBR_EVENTS_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    cache: "no-store"
  });

  if (!res.ok) {
    if (cache.tournaments.length) {
      return { tournaments: cache.tournaments, fromCache: true };
    }
    throw new Error(`PBR source returned ${res.status}.`);
  }

  const html = await res.text();
  const tournaments = parsePbrEventsFromHtml(html);
  if (!tournaments.length) {
    if (cache.tournaments.length) {
      return { tournaments: cache.tournaments, fromCache: true };
    }
    throw new Error("Could not parse PBR tournaments from source HTML.");
  }

  ref.__BIRD_DOG_PBR_CACHE__ = {
    fetchedAt: now,
    tournaments
  };

  return { tournaments, fromCache: false };
}
