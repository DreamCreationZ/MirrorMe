import { HarvesterDataset } from "@/lib/birddog/types";

type Provider = "PG" | "PBR";
type LoadOptions = {
  tournamentId?: string;
};

type CacheEntry = {
  dataset: HarvesterDataset;
  fetchedAt: number;
};

const CACHE_TTL_MS = 45 * 1000;
const PBR_CACHE_TTL_MS = 45 * 1000;
const SESSION_PREFIX = "bird_dog_dataset_";
const memoryCache: Partial<Record<Provider, CacheEntry>> = {};

function cacheTtl(company: Provider) {
  return company === "PBR" ? PBR_CACHE_TTL_MS : CACHE_TTL_MS;
}

function isFresh(entry: CacheEntry, company: Provider) {
  return Date.now() - entry.fetchedAt < cacheTtl(company);
}

function sessionKey(company: Provider) {
  return `${SESSION_PREFIX}${company}`;
}

function readSessionCache(company: Provider): CacheEntry | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(sessionKey(company));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.dataset || typeof parsed.fetchedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(company: Provider, entry: CacheEntry) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(sessionKey(company), JSON.stringify(entry));
}

export async function loadHarvestDataset(company: Provider, forceRefresh = false, options?: LoadOptions) {
  const tournamentId = company === "PBR" ? (options?.tournamentId || "").trim() : "";
  const skipReadCache = Boolean(tournamentId);

  if (!forceRefresh && !skipReadCache) {
    const memoryEntry = memoryCache[company];
    if (memoryEntry && isFresh(memoryEntry, company)) {
      return { dataset: memoryEntry.dataset, fromCache: true };
    }

    const sessionEntry = readSessionCache(company);
    if (sessionEntry && isFresh(sessionEntry, company)) {
      memoryCache[company] = sessionEntry;
      return { dataset: sessionEntry.dataset, fromCache: true };
    }
  }

  const params = new URLSearchParams({
    company
  });
  if (forceRefresh) {
    params.set("refresh", "1");
  }
  if (tournamentId) {
    params.set("tournamentId", tournamentId);
  }

  const res = await fetch(`/api/harvest?${params.toString()}`, {
    cache: company === "PBR" ? "no-store" : "default"
  });
  if (!res.ok) {
    throw new Error(`Failed to load tournament data (${res.status}).`);
  }

  const data = (await res.json()) as { dataset?: HarvesterDataset };
  if (!data?.dataset) {
    throw new Error("Tournament dataset is missing.");
  }

  const entry: CacheEntry = {
    dataset: data.dataset,
    fetchedAt: Date.now()
  };

  memoryCache[company] = entry;
  writeSessionCache(company, entry);
  return { dataset: entry.dataset, fromCache: false };
}
