export type DataProvider = "PG" | "PBR";

export type Player = {
  id: string;
  name: string;
  school: string;
  position: string;
  mustSee?: boolean;
  number?: string;
  batsThrows?: string;
  grad?: string;
  height?: string;
  weight?: string;
  hometown?: string;
  commitment?: string;
};

export type Game = {
  id: string;
  field: string;
  startTime: string;
  homeTeam: string;
  awayTeam: string;
  dayLabel?: string;
  timeLabel?: string;
  gameNo?: string;
  ageDiv?: string;
  homeScore?: string;
  awayScore?: string;
  players: Player[];
};

export type Tournament = {
  id: string;
  name: string;
  city: string;
  date: string;
  endDate?: string;
  venue?: string;
  sourceUrl?: string;
  source?: "mock" | "import" | "pbr-live" | "pg-live";
  games: Game[];
};

export type HarvesterDataset = {
  company: DataProvider;
  tournaments: Tournament[];
};

export type OrgBrand = {
  orgId: string;
  name: string;
  domain: string;
  primary: string;
  accent: string;
  logoText: string;
};

export type ScoutNote = {
  id: string;
  gameId: string;
  playerId?: string;
  transcript: string;
  audioUrl?: string;
  createdAt: string;
  synced: boolean;
};

export type PulseEvent = {
  id: string;
  gameId: string;
  message: string;
  createdAt: string;
  synced: boolean;
};

export type ItineraryStop = {
  gameId: string;
  field: string;
  at: string;
  watchlistCount: number;
  players: string[];
};
