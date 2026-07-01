"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Game, Player, Tournament } from "@/lib/birddog/types";
import {
  buildTeamSummaries,
  findTournament,
  teamGames,
  teamRosterFromGames
} from "@/lib/birddog/tournamentView";
import { loadHarvestDataset } from "@/lib/birddog/clientHarvest";
import { domainFromEmail } from "@/lib/birddog/security";
import { auth } from "@/lib/firebase";

type Provider = "PG" | "PBR";
type TravelMode = "flight" | "bus";
type PaymentChoice = "saved_card" | "new_card" | "upi";

type CoachStep = {
  at: string;
  from: string;
  to: string;
  game: string;
  travel: string;
};

type CoachScheduleView = {
  id: string;
  tournamentId: string;
  tournamentName: string;
  coachId: string;
  coachName: string;
  coachEmailMasked: string;
  coachDomain: string;
  origin: string;
  generatedAt: string;
  visibility: "full" | "restricted";
  steps: {
    id: string;
    at: string;
    from: string;
    to: string;
    game: string;
    recommendation: "flight" | "bus/train" | "car" | "walk/local";
    field: string;
  }[];
  selectedPlayerIds: string[];
  selectedPlayerNames: string[];
};

type SavedCard = {
  id: string;
  holderName: string;
  last4: string;
  network: string;
  expiry: string;
  label: string;
};

type BookingStatus = "pending_approval" | "awaiting_payment" | "confirmed" | "rejected";

type BookingRecord = {
  id: string;
  tournamentId: string;
  tournamentName: string;
  teamName: string;
  coachId: string;
  coachName: string;
  coachEmail: string;
  coachDomain: string;
  travelMode: TravelMode;
  origin: string;
  destination: string;
  departureAt: string;
  operatorName: string;
  serviceCode: string;
  seatClass: string;
  seatsRequested: number;
  baggage: string;
  cancellationPolicy: string;
  inclusions: string[];
  fare: {
    base: number;
    taxes: number;
    convenienceFee: number;
    total: number;
    currency: "INR";
  };
  status: BookingStatus;
  approvalRequestedAt: string;
  approvedAt?: string;
  approvedByMasked?: string;
  rejectedAt?: string;
  rejectedByMasked?: string;
  rejectionReason?: string;
  payment?: {
    method: PaymentChoice;
    amount: number;
    currency: "INR";
    paidAt: string;
    reference: string;
    payerEmailMasked: string;
    cardLast4?: string;
    cardNetwork?: string;
    upiMasked?: string;
    savedCardId?: string;
  };
  confirmationRef?: string;
  createdAt: string;
  updatedAt: string;
};

type ManualPlayerForm = {
  number: string;
  name: string;
  position: string;
  school: string;
  grad: string;
  commitment: string;
};

type TeamView = "schedule" | "roster";

type FinalCartPlayer = Player & {
  cartKey: string;
  teamName: string;
  teamSlug: string;
  source: "imported" | "manual";
};

function finalCartStorageKey(tournamentId: string, coachEmail: string) {
  return `bird_dog_final_player_cart:${tournamentId}:${coachEmail.trim().toLowerCase()}`;
}

function globalFinalCartStorageKey(tournamentId: string) {
  return `bird_dog_final_player_cart:${tournamentId}:__global__`;
}

function normalizeFinalCartPlayers(input: unknown): FinalCartPlayer[] {
  return (Array.isArray(input) ? input : [])
    .map((player) => {
      const candidate = player as Partial<FinalCartPlayer>;
      return {
        ...(candidate as FinalCartPlayer),
        id: String(candidate.id || "").trim(),
        name: String(candidate.name || "").trim(),
        teamName: String(candidate.teamName || "").trim(),
        teamSlug: String(candidate.teamSlug || "").trim(),
        cartKey: String(candidate.cartKey || "").trim(),
        source: (candidate.source === "manual" ? "manual" : "imported") as "manual" | "imported"
      };
    })
    .filter((player) => player.id && player.name && player.teamName && player.teamSlug && player.cartKey);
}

function createCartKey(teamSlug: string, playerId: string) {
  return `${teamSlug}::${playerId}`;
}

function parseHourLabel(iso: string) {
  return new Date(iso).toLocaleString();
}

function asDateTimeInputValue(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

function cleanTeam(value: string) {
  return value.replace(/\s*\([^)]*\)\s*$/g, "").trim().toLowerCase();
}

function formatScheduleDay(game: Game) {
  if (game.dayLabel) return game.dayLabel;
  const d = new Date(game.startTime);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "2-digit",
    year: "numeric"
  });
}

function formatScheduleTime(game: Game) {
  if (game.timeLabel) return game.timeLabel;
  const d = new Date(game.startTime);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function travelSuggestion(from: string, to: string) {
  const a = from.toLowerCase();
  const b = to.toLowerCase();
  if (a === b) return "Walk/Local";
  if (a.includes("airport") || b.includes("airport")) return "Flight";
  if (a.includes("station") || b.includes("station")) return "Train/Bus";
  return "Car";
}

function recommendationFromTravel(travel: string): "flight" | "bus/train" | "car" | "walk/local" {
  const normalized = travel.toLowerCase();
  if (normalized.includes("flight")) return "flight";
  if (normalized.includes("train") || normalized.includes("bus")) return "bus/train";
  if (normalized.includes("walk")) return "walk/local";
  return "car";
}

function playerCheckedInGame(game: Game, selected: Set<string>) {
  return game.players.some((p) => selected.has(p.id));
}

function getCardNetwork(cardNumber: string) {
  const normalized = cardNumber.replace(/\s+/g, "");
  if (normalized.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(normalized)) return "Mastercard";
  if (normalized.startsWith("3")) return "Amex";
  if (normalized.startsWith("6")) return "RuPay";
  return "Card";
}

function savedCardKey(coachEmail: string) {
  return `bird_dog_saved_cards:${coachEmail.trim().toLowerCase()}`;
}

export default function TeamScheduleRosterPage() {
  const router = useRouter();
  const params = useParams<{ id: string; teamSlug: string }>();
  const search = useSearchParams();

  const company = (search.get("company") || "PG") as Provider;
  const tournamentId = decodeURIComponent(params.id);
  const teamSlug = decodeURIComponent(params.teamSlug);
  const initialTeamView = (search.get("teamView") === "schedule" ? "schedule" : "roster") as TeamView;

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading schedule + roster...");
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamViewTab, setTeamViewTab] = useState<TeamView>(initialTeamView);

  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [manualPlayers, setManualPlayers] = useState<Player[]>([]);
  const [finalCart, setFinalCart] = useState<FinalCartPlayer[]>([]);
  const [finalCartStatus, setFinalCartStatus] = useState("");
  const [manualPlayerForm, setManualPlayerForm] = useState<ManualPlayerForm>({
    number: "",
    name: "",
    position: "",
    school: "",
    grad: "",
    commitment: ""
  });
  const [playerFormStatus, setPlayerFormStatus] = useState("");
  const [origin, setOrigin] = useState("Current City");
  const [coachPlan, setCoachPlan] = useState<CoachStep[]>([]);

  const [coachName, setCoachName] = useState("Scout");
  const [coachEmail, setCoachEmail] = useState("scout@neutral.org");
  const [scheduleSyncBusy, setScheduleSyncBusy] = useState(false);
  const [scheduleSyncStatus, setScheduleSyncStatus] = useState("");
  const [sharedSchedules, setSharedSchedules] = useState<CoachScheduleView[]>([]);

  const [travelMode, setTravelMode] = useState<TravelMode>("flight");
  const [bookingOrigin, setBookingOrigin] = useState("Current City");
  const [bookingDestination, setBookingDestination] = useState("");
  const [bookingDepartureAt, setBookingDepartureAt] = useState("");
  const [operatorName, setOperatorName] = useState("IndiGo");
  const [serviceCode, setServiceCode] = useState("6E-204");
  const [seatClass, setSeatClass] = useState("Economy");
  const [seatsRequested, setSeatsRequested] = useState(1);
  const [baggage, setBaggage] = useState("15kg check-in + 7kg cabin");
  const [inclusionsText, setInclusionsText] = useState("Live alerts, Seat preference, SMS updates");
  const [cancellationPolicy, setCancellationPolicy] = useState("Free cancellation for 24 hours from booking.");
  const [baseFare, setBaseFare] = useState(5200);
  const [taxes, setTaxes] = useState(980);
  const [convenienceFee, setConvenienceFee] = useState(149);

  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingStatus, setBookingStatus] = useState("");
  const [activeBooking, setActiveBooking] = useState<BookingRecord | null>(null);

  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("saved_card");
  const [selectedSavedCardId, setSelectedSavedCardId] = useState("");
  const [newCardHolder, setNewCardHolder] = useState("");
  const [newCardNumber, setNewCardNumber] = useState("");
  const [newCardExpiry, setNewCardExpiry] = useState("");
  const [saveNewCard, setSaveNewCard] = useState(true);
  const [upiId, setUpiId] = useState("");
  const [rejectReason, setRejectReason] = useState("Need another timing slot.");

  const rosterSectionRef = useRef<HTMLDivElement | null>(null);
  const finalCartSectionRef = useRef<HTMLDivElement | null>(null);
  const coachDomain = useMemo(() => domainFromEmail(coachEmail), [coachEmail]);
  const finalCartKey = useMemo(() => finalCartStorageKey(tournamentId, coachEmail), [coachEmail, tournamentId]);
  const finalCartStorageKeys = useMemo(() => {
    const fallbackCoachKey = finalCartStorageKey(tournamentId, "scout@neutral.org");
    return Array.from(new Set([finalCartKey, globalFinalCartStorageKey(tournamentId), fallbackCoachKey]));
  }, [finalCartKey, tournamentId]);
  const teamsPageHref = useMemo(
    () => `/bird-dog/tournament/${encodeURIComponent(tournamentId)}/teams?company=${encodeURIComponent(company)}`,
    [company, tournamentId]
  );

  const selectedSet = useMemo(() => new Set(selectedPlayers), [selectedPlayers]);

  const totalFare = useMemo(
    () => Math.max(0, Number(baseFare) + Number(taxes) + Number(convenienceFee)),
    [baseFare, taxes, convenienceFee]
  );

  const buildAuthHeaders = useCallback(
    async (withJsonContentType = false) => {
      const headers: Record<string, string> = {};
      if (withJsonContentType) {
        headers["content-type"] = "application/json";
      }
      headers["x-bird-dog-email"] = coachEmail.trim().toLowerCase();
      if (!auth?.currentUser && process.env.NODE_ENV === "production") {
        throw new Error("Please log in before using coach schedule and booking APIs.");
      }
      if (auth?.currentUser) {
        try {
          const idToken = await auth.currentUser.getIdToken();
          headers.authorization = `Bearer ${idToken}`;
        } catch {
          // Dev fallback still works with x-bird-dog-email header.
        }
      }
      return headers;
    },
    [coachEmail]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("bird_dog_user");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { name?: string; email?: string };
      if (parsed.name) setCoachName(parsed.name);
      if (parsed.email) setCoachEmail(parsed.email);
    } catch {
      // Ignore malformed local storage.
    }
  }, []);

  useEffect(() => {
    setTeamViewTab(initialTeamView);
  }, [initialTeamView]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const byKey = new Map<string, FinalCartPlayer>();
    finalCartStorageKeys.forEach((storageKey) => {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as unknown;
        normalizeFinalCartPlayers(parsed).forEach((player) => {
          byKey.set(player.cartKey, player);
        });
      } catch {
        // Ignore malformed key and continue with other keys.
      }
    });
    if (!byKey.size) {
      setFinalCart([]);
      return;
    }
    setFinalCart(Array.from(byKey.values()));
  }, [finalCartStorageKeys]);

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
          return;
        }

        const teams = buildTeamSummaries(found);
        const matched = teams.find((t) => t.slug === teamSlug);
        setTeamName(matched?.name || "");
        setStatus("Schedule and roster loaded.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to load schedule + roster.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [company, tournamentId, teamSlug]);

  const scheduleRows = useMemo(() => {
    if (!tournament || !teamName) return [] as Game[];
    return teamGames(tournament, teamName);
  }, [teamName, tournament]);

  const rosterRows = useMemo(() => teamRosterFromGames(scheduleRows), [scheduleRows]);
  const allRosterRows = useMemo(() => [...rosterRows, ...manualPlayers], [manualPlayers, rosterRows]);
  const allRosterPlayerIdSet = useMemo(() => new Set(allRosterRows.map((player) => player.id)), [allRosterRows]);
  const allRosterById = useMemo(() => new Map(allRosterRows.map((player) => [player.id, player])), [allRosterRows]);
  const selectedPlayerOrder = useMemo(
    () => new Map(selectedPlayers.map((id, index) => [id, index])),
    [selectedPlayers]
  );
  const selectedPlayerRows = useMemo(
    () =>
      selectedPlayers
        .map((id) => allRosterById.get(id))
        .filter((player): player is Player => player !== undefined),
    [allRosterById, selectedPlayers]
  );
  const finalCartOrder = useMemo(
    () => new Map(finalCart.map((player, index) => [player.cartKey, index])),
    [finalCart]
  );
  const finalCartByKey = useMemo(() => new Set(finalCart.map((player) => player.cartKey)), [finalCart]);
  const selectedPlayersForSchedule = useMemo<FinalCartPlayer[]>(() => {
    if (finalCart.length) return finalCart;
    return selectedPlayerRows.map<FinalCartPlayer>((player) => ({
      ...player,
      cartKey: createCartKey(teamSlug, player.id),
      teamName: teamName || "Team",
      teamSlug,
      source: player.id.startsWith("manual-") ? "manual" : "imported"
    }));
  }, [finalCart, selectedPlayerRows, teamName, teamSlug]);
  const usingFinalCart = finalCart.length > 0;

  useEffect(() => {
    setSelectedPlayers((prev) => {
      const next = prev.filter((id) => allRosterPlayerIdSet.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [allRosterPlayerIdSet]);

  useEffect(() => {
    if (!bookingDestination && tournament?.city) {
      setBookingDestination(tournament.city);
    }
  }, [bookingDestination, tournament?.city]);

  useEffect(() => {
    if (!bookingDepartureAt && scheduleRows[0]?.startTime) {
      setBookingDepartureAt(asDateTimeInputValue(scheduleRows[0].startTime));
    }
  }, [bookingDepartureAt, scheduleRows]);

  useEffect(() => {
    if (!bookingOrigin) {
      setBookingOrigin(origin);
    }
  }, [bookingOrigin, origin]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(savedCardKey(coachEmail));
    if (!raw) {
      setSavedCards([]);
      setSelectedSavedCardId("");
      setPaymentChoice("new_card");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as SavedCard[];
      const normalized = Array.isArray(parsed) ? parsed : [];
      setSavedCards(normalized);
      setSelectedSavedCardId(normalized[0]?.id || "");
      setPaymentChoice(normalized.length ? "saved_card" : "new_card");
    } catch {
      setSavedCards([]);
      setSelectedSavedCardId("");
      setPaymentChoice("new_card");
    }
  }, [coachEmail]);

  const loadSharedSchedules = useCallback(async () => {
    if (!tournamentId || !coachEmail) return;
    try {
      const headers = await buildAuthHeaders(false);
      const res = await fetch(`/api/bird-dog/coach-schedules?tournamentId=${encodeURIComponent(tournamentId)}`, {
        headers
      });
      if (!res.ok) {
        throw new Error(`Failed to load shared schedules (${res.status}).`);
      }
      const data = (await res.json()) as { schedules?: CoachScheduleView[] };
      setSharedSchedules(data.schedules || []);
    } catch (error) {
      setScheduleSyncStatus(error instanceof Error ? error.message : "Failed to load shared schedules.");
    }
  }, [buildAuthHeaders, coachEmail, tournamentId]);

  useEffect(() => {
    void loadSharedSchedules();
  }, [loadSharedSchedules]);

  function togglePlayer(id: string) {
    setSelectedPlayers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function removeSelectedPlayer(id: string) {
    setSelectedPlayers((prev) => prev.filter((playerId) => playerId !== id));
  }

  function moveSelectedPlayer(id: string, direction: "up" | "down") {
    setSelectedPlayers((prev) => {
      const index = prev.indexOf(id);
      if (index < 0) return prev;

      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;

      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  function prioritizeSelectedPlayer(id: string) {
    setSelectedPlayers((prev) => {
      const index = prev.indexOf(id);
      if (index <= 0) return prev;
      const next = [...prev];
      next.splice(index, 1);
      next.unshift(id);
      return next;
    });
  }

  const persistFinalCart = useCallback((nextCart: FinalCartPlayer[]) => {
    setFinalCart(nextCart);
    if (typeof window !== "undefined") {
      finalCartStorageKeys.forEach((storageKey) => {
        window.localStorage.setItem(storageKey, JSON.stringify(nextCart));
      });
    }
  }, [finalCartStorageKeys]);

  const mergePlayersIntoFinalCart = useCallback(
    (players: Player[], announce = false) => {
      if (!players.length) {
        if (announce) {
          setFinalCartStatus("Select at least one player in Team Roster first.");
        }
        return;
      }

      const selectedForCart = players.map<FinalCartPlayer>((player) => ({
        ...player,
        cartKey: createCartKey(teamSlug, player.id),
        teamName: teamName || "Team",
        teamSlug,
        source: player.id.startsWith("manual-") ? "manual" : "imported"
      }));

      const existingIndex = new Map(finalCart.map((player, index) => [player.cartKey, index]));
      const nextCart = [...finalCart];
      let addedCount = 0;

      selectedForCart.forEach((player) => {
        const idx = existingIndex.get(player.cartKey);
        if (idx === undefined) {
          nextCart.push(player);
          addedCount += 1;
        } else {
          nextCart[idx] = player;
        }
      });

      persistFinalCart(nextCart);
      if (announce) {
        if (addedCount > 0) {
          setFinalCartStatus(
            `Added ${addedCount} player${addedCount === 1 ? "" : "s"} to final cart. Total: ${nextCart.length}.`
          );
        } else {
          setFinalCartStatus(`Selected players are already in final cart. Total: ${nextCart.length}.`);
        }
      }
    },
    [finalCart, persistFinalCart, teamName, teamSlug]
  );

  function addSelectedToFinalCart() {
    mergePlayersIntoFinalCart(selectedPlayerRows, true);
  }

  useEffect(() => {
    if (!selectedPlayerRows.length) return;
    mergePlayersIntoFinalCart(selectedPlayerRows, false);
  }, [mergePlayersIntoFinalCart, selectedPlayerRows]);

  const goToTeamsPage = useCallback(() => {
    if (selectedPlayerRows.length) {
      mergePlayersIntoFinalCart(selectedPlayerRows, false);
    }
    router.push(teamsPageHref);
  }, [mergePlayersIntoFinalCart, router, selectedPlayerRows, teamsPageHref]);

  function removeFromFinalCart(cartKey: string) {
    const nextCart = finalCart.filter((player) => player.cartKey !== cartKey);
    persistFinalCart(nextCart);
  }

  function moveFinalCartPlayer(cartKey: string, direction: "up" | "down") {
    const index = finalCart.findIndex((player) => player.cartKey === cartKey);
    if (index < 0) return;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= finalCart.length) return;

    const nextCart = [...finalCart];
    const [moved] = nextCart.splice(index, 1);
    nextCart.splice(target, 0, moved);
    persistFinalCart(nextCart);
  }

  function prioritizeFinalCartPlayer(cartKey: string) {
    const index = finalCart.findIndex((player) => player.cartKey === cartKey);
    if (index <= 0) return;
    const nextCart = [...finalCart];
    const [moved] = nextCart.splice(index, 1);
    nextCart.unshift(moved);
    persistFinalCart(nextCart);
  }

  function clearFinalCart() {
    persistFinalCart([]);
    setFinalCartStatus("Final cart cleared.");
  }

  function updateManualPlayerField(field: keyof ManualPlayerForm, value: string) {
    setManualPlayerForm((prev) => ({ ...prev, [field]: value }));
  }

  function addManualPlayer() {
    const name = manualPlayerForm.name.trim();
    if (!name) {
      setPlayerFormStatus("Enter player name before adding.");
      return;
    }

    const id = `manual-${Math.random().toString(36).slice(2, 10)}`;
    const nextPlayer: Player = {
      id,
      name,
      school: manualPlayerForm.school.trim() || "Manual Entry",
      position: manualPlayerForm.position.trim() || "-",
      number: manualPlayerForm.number.trim(),
      grad: manualPlayerForm.grad.trim(),
      commitment: manualPlayerForm.commitment.trim()
    };

    setManualPlayers((prev) => [nextPlayer, ...prev]);
    setSelectedPlayers((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setManualPlayerForm({
      number: "",
      name: "",
      position: "",
      school: "",
      grad: "",
      commitment: ""
    });
    setPlayerFormStatus("Player added to roster.");
  }

  function removeManualPlayer(id: string) {
    setManualPlayers((prev) => prev.filter((player) => player.id !== id));
    setSelectedPlayers((prev) => prev.filter((playerId) => playerId !== id));
    removeFromFinalCart(createCartKey(teamSlug, id));
  }

  function goBackToRoster() {
    rosterSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goToFinalCart() {
    finalCartSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function generateBestSchedule() {
    if (!tournament?.games.length) {
      setStatus("No tournament schedule found to generate route.");
      return;
    }

    if (!selectedPlayersForSchedule.length) {
      setStatus("Select players and add them to final cart before generating schedule.");
      return;
    }

    const selectedPriority = new Map<string, number>();
    selectedPlayersForSchedule.forEach((player, index) => {
      if (!selectedPriority.has(player.id)) {
        selectedPriority.set(player.id, index);
      }
    });

    const selectedTeamPriority = new Map<string, number>();
    selectedPlayersForSchedule.forEach((player, index) => {
      const teamKey = cleanTeam(player.teamName);
      if (teamKey && !selectedTeamPriority.has(teamKey)) {
        selectedTeamPriority.set(teamKey, index);
      }
    });

    const selectedRosterSet = new Set(selectedPlayersForSchedule.map((player) => player.id));
    const selectedTeams = new Set(selectedPlayersForSchedule.map((player) => cleanTeam(player.teamName)));
    const sourceRows = tournament.games.filter((game) => {
      const home = cleanTeam(game.homeTeam);
      const away = cleanTeam(game.awayTeam);
      if (selectedTeams.has(home) || selectedTeams.has(away)) return true;
      return playerCheckedInGame(game, selectedRosterSet);
    });

    if (!sourceRows.length) {
      setStatus("No schedule rows match the selected players yet.");
      return;
    }

    const prioritizedRows = sourceRows
      .map((game) => {
        let priority = game.players.reduce((minPriority, player) => {
          const index = selectedPriority.get(player.id);
          if (index === undefined) return minPriority;
          return Math.min(minPriority, index);
        }, Number.POSITIVE_INFINITY);

        const homeTeamPriority = selectedTeamPriority.get(cleanTeam(game.homeTeam));
        if (homeTeamPriority !== undefined) {
          priority = Math.min(priority, homeTeamPriority);
        }
        const awayTeamPriority = selectedTeamPriority.get(cleanTeam(game.awayTeam));
        if (awayTeamPriority !== undefined) {
          priority = Math.min(priority, awayTeamPriority);
        }

        return {
          game,
          // Selected player order takes precedence, then time.
          priority: Number.isFinite(priority) ? priority : Number.MAX_SAFE_INTEGER,
          startAt: new Date(game.startTime).getTime()
        };
      })
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.startAt - b.startAt;
      })
      .map((entry) => entry.game);

    let from = origin;
    const next = prioritizedRows
      .map((g) => {
        const to = g.field || tournament?.city || "Venue";
        const step: CoachStep = {
          at: g.startTime,
          from,
          to,
          game: `${g.homeTeam} vs ${g.awayTeam}`,
          travel: travelSuggestion(from, to)
        };
        from = to;
        return step;
      });

    if (next[0]) {
      const preferredMode = recommendationFromTravel(next[0].travel);
      if (preferredMode === "flight") {
        setTravelMode("flight");
        setOperatorName("IndiGo");
        setServiceCode("6E-204");
      } else if (preferredMode === "bus/train") {
        setTravelMode("bus");
        setOperatorName("RedBus Premium");
        setServiceCode("BUS-7421");
      }
      setBookingOrigin(next[0].from);
      setBookingDestination(next[0].to);
      setBookingDepartureAt(asDateTimeInputValue(next[0].at));
    }

    setCoachPlan(next);
    setStatus(
      next.length
        ? `Generated ${next.length} coach route steps from ${selectedPlayersForSchedule.length} selected players${usingFinalCart ? " in final cart." : "."}`
        : "No games match selected players."
    );
  }

  async function saveCoachSchedule() {
    if (!coachPlan.length) {
      setScheduleSyncStatus("Generate coach route first.");
      return;
    }

    setScheduleSyncBusy(true);
    setScheduleSyncStatus("");

    try {
      const selectedPlayerNames = selectedPlayersForSchedule
        .map((player) => `${player.name} (${player.teamName})`)
        .filter(Boolean);

      const payload = {
        id: `${tournamentId}:${coachEmail.toLowerCase()}`,
        tournamentId,
        tournamentName: tournament?.name || "Tournament",
        coachId: coachEmail.toLowerCase(),
        coachName,
        coachEmail,
        origin,
        generatedAt: new Date().toISOString(),
        steps: coachPlan.map((step, index) => ({
          id: `step-${index + 1}`,
          at: step.at,
          from: step.from,
          to: step.to,
          game: step.game,
          recommendation: recommendationFromTravel(step.travel),
          field: step.to
        })),
        selectedPlayerIds: selectedPlayersForSchedule.map((player) => player.cartKey),
        selectedPlayerNames
      };

      const headers = await buildAuthHeaders(true);
      const res = await fetch("/api/bird-dog/coach-schedules", {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || `Failed to save coach schedule (${res.status}).`);
      }

      await loadSharedSchedules();
      setScheduleSyncStatus("Coach schedule shared successfully.");
    } catch (error) {
      setScheduleSyncStatus(error instanceof Error ? error.message : "Failed to share coach schedule.");
    } finally {
      setScheduleSyncBusy(false);
    }
  }

  async function createBookingRequest() {
    if (!bookingOrigin || !bookingDestination || !bookingDepartureAt) {
      setBookingStatus("Add origin, destination and departure time before creating booking request.");
      return;
    }

    setBookingBusy(true);
    setBookingStatus("");

    try {
      const bookingPayload = {
        tournamentId,
        tournamentName: tournament?.name || "Tournament",
        teamName: teamName || "Team",
        coachId: coachEmail.toLowerCase(),
        coachName,
        coachEmail,
        travelMode,
        origin: bookingOrigin,
        destination: bookingDestination,
        departureAt: new Date(bookingDepartureAt).toISOString(),
        operatorName,
        serviceCode,
        seatClass,
        seatsRequested: Math.max(1, Number(seatsRequested) || 1),
        baggage,
        cancellationPolicy,
        inclusions: inclusionsText
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        fare: {
          base: Number(baseFare) || 0,
          taxes: Number(taxes) || 0,
          convenienceFee: Number(convenienceFee) || 0,
          total: totalFare,
          currency: "INR" as const
        }
      };

      const headers = await buildAuthHeaders(true);
      const res = await fetch("/api/bird-dog/bookings", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "create", booking: bookingPayload })
      });

      const data = (await res.json()) as { error?: string; booking?: BookingRecord };
      if (!res.ok || !data.booking) {
        throw new Error(data.error || `Failed to create booking request (${res.status}).`);
      }

      setActiveBooking(data.booking);
      setBookingStatus("Booking request created. Coach approval is required next.");
    } catch (error) {
      setBookingStatus(error instanceof Error ? error.message : "Failed to create booking request.");
    } finally {
      setBookingBusy(false);
    }
  }

  async function approveBookingRequest() {
    if (!activeBooking) return;
    setBookingBusy(true);
    setBookingStatus("");

    try {
      const headers = await buildAuthHeaders(true);
      const res = await fetch("/api/bird-dog/bookings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "approve",
          bookingId: activeBooking.id
        })
      });

      const data = (await res.json()) as { error?: string; booking?: BookingRecord };
      if (!res.ok || !data.booking) {
        throw new Error(data.error || `Approval failed (${res.status}).`);
      }

      setActiveBooking(data.booking);
      setBookingStatus("Coach approved. Payment step is now unlocked.");
    } catch (error) {
      setBookingStatus(error instanceof Error ? error.message : "Approval failed.");
    } finally {
      setBookingBusy(false);
    }
  }

  async function rejectBookingRequest() {
    if (!activeBooking) return;
    setBookingBusy(true);
    setBookingStatus("");

    try {
      const headers = await buildAuthHeaders(true);
      const res = await fetch("/api/bird-dog/bookings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "reject",
          bookingId: activeBooking.id,
          reason: rejectReason
        })
      });

      const data = (await res.json()) as { error?: string; booking?: BookingRecord };
      if (!res.ok || !data.booking) {
        throw new Error(data.error || `Rejection failed (${res.status}).`);
      }

      setActiveBooking(data.booking);
      setBookingStatus("Booking request rejected.");
    } catch (error) {
      setBookingStatus(error instanceof Error ? error.message : "Failed to reject booking request.");
    } finally {
      setBookingBusy(false);
    }
  }

  function persistSavedCards(nextCards: SavedCard[]) {
    setSavedCards(nextCards);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(savedCardKey(coachEmail), JSON.stringify(nextCards));
    }
  }

  async function payAndConfirmBooking() {
    if (!activeBooking) return;
    if (activeBooking.status !== "awaiting_payment") {
      setBookingStatus("Approve booking before payment.");
      return;
    }

    let paymentPayload:
      | {
          method: PaymentChoice;
          amount: number;
          currency: "INR";
          savedCardId?: string;
          cardLast4?: string;
          cardNetwork?: string;
          upiId?: string;
        }
      | null = null;

    if (paymentChoice === "saved_card") {
      const selectedCard = savedCards.find((card) => card.id === selectedSavedCardId);
      if (!selectedCard) {
        setBookingStatus("Select a saved card or switch to New Card / UPI.");
        return;
      }
      paymentPayload = {
        method: "saved_card",
        amount: activeBooking.fare.total,
        currency: "INR",
        savedCardId: selectedCard.id,
        cardLast4: selectedCard.last4,
        cardNetwork: selectedCard.network
      };
    }

    if (paymentChoice === "new_card") {
      const compact = newCardNumber.replace(/\s+/g, "");
      if (!newCardHolder.trim() || compact.length < 12 || !newCardExpiry.trim()) {
        setBookingStatus("Enter card holder name, valid card number and expiry.");
        return;
      }
      const network = getCardNetwork(compact);
      const last4 = compact.slice(-4);
      paymentPayload = {
        method: "new_card",
        amount: activeBooking.fare.total,
        currency: "INR",
        cardLast4: last4,
        cardNetwork: network
      };

      if (saveNewCard) {
        const nextCard: SavedCard = {
          id: `card_${Math.random().toString(36).slice(2, 10)}`,
          holderName: newCardHolder.trim(),
          last4,
          network,
          expiry: newCardExpiry.trim(),
          label: `${network} •••• ${last4}`
        };
        const deduped = [nextCard, ...savedCards.filter((card) => card.last4 !== last4 || card.expiry !== nextCard.expiry)];
        persistSavedCards(deduped);
        setSelectedSavedCardId(nextCard.id);
      }
    }

    if (paymentChoice === "upi") {
      if (!upiId.includes("@")) {
        setBookingStatus("Enter a valid UPI ID like coach@okaxis.");
        return;
      }
      paymentPayload = {
        method: "upi",
        amount: activeBooking.fare.total,
        currency: "INR",
        upiId
      };
    }

    if (!paymentPayload) {
      setBookingStatus("Choose a payment method.");
      return;
    }

    setBookingBusy(true);
    setBookingStatus("");

    try {
      const headers = await buildAuthHeaders(true);
      const res = await fetch("/api/bird-dog/bookings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "pay",
          bookingId: activeBooking.id,
          payment: paymentPayload
        })
      });

      const data = (await res.json()) as { error?: string; booking?: BookingRecord };
      if (!res.ok || !data.booking) {
        throw new Error(data.error || `Payment failed (${res.status}).`);
      }

      setActiveBooking(data.booking);
      setBookingStatus("Payment successful and booking confirmed.");
    } catch (error) {
      setBookingStatus(error instanceof Error ? error.message : "Payment failed.");
    } finally {
      setBookingBusy(false);
    }
  }

  return (
    <main className="bd-root">
      <section className="panel">
        <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button type="button" className="secondary" onClick={goToTeamsPage}>
            Back
          </button>
          <h1 style={{ margin: 0 }}>{teamName || "Team Schedule + Tournament Roster"}</h1>
          <button type="button" className="secondary" onClick={goToTeamsPage}>
            Teams
          </button>
        </div>
        <p className="muted">{status}</p>
      </section>

      <section className="panel">
        <div className="row wrap">
          <button
            type="button"
            className={teamViewTab === "schedule" ? "" : "secondary"}
            onClick={() => setTeamViewTab("schedule")}
          >
            Schedule
          </button>
          <button
            type="button"
            className={teamViewTab === "roster" ? "" : "secondary"}
            onClick={() => setTeamViewTab("roster")}
          >
            Team Roster
          </button>
        </div>
        <p className="muted">
          Open Team Roster to select players, add them to final cart, then switch teams and repeat.
        </p>
      </section>

      {teamViewTab === "schedule" ? (
        <section className="panel">
          <h2 style={{ marginTop: 0 }}>Tournament Schedule</h2>
          <table className="mini-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Time</th>
                <th>Game</th>
                <th>Field / Location</th>
                <th>Age / Div</th>
                <th>Team</th>
                <th>Score</th>
                <th>Team</th>
              </tr>
            </thead>
            <tbody>
              {scheduleRows.map((g) => (
                <tr key={g.id}>
                  <td>{formatScheduleDay(g)}</td>
                  <td>{formatScheduleTime(g)}</td>
                  <td>{g.gameNo ? `#${g.gameNo}` : "-"}</td>
                  <td>{g.field || "-"}</td>
                  <td>{g.ageDiv || "-"}</td>
                  <td style={{ fontWeight: cleanTeam(g.homeTeam) === cleanTeam(teamName) ? 700 : 400 }}>{g.homeTeam}</td>
                  <td>
                    {(g.homeScore || "00").padStart(2, "0")} - {(g.awayScore || "00").padStart(2, "0")}
                  </td>
                  <td style={{ fontWeight: cleanTeam(g.awayTeam) === cleanTeam(teamName) ? 700 : 400 }}>{g.awayTeam}</td>
                </tr>
              ))}
              {!loading && !scheduleRows.length ? (
                <tr>
                  <td colSpan={8}>No schedule loaded for this team yet. This tournament may still be syncing.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}

      {teamViewTab === "roster" ? (
        <section className="panel">
          <h2 style={{ marginTop: 0 }}>Tournament Roster (Select Players)</h2>
          <table className="mini-table">
            <thead>
              <tr>
                <th>Select</th>
                <th>Order</th>
                <th>No.</th>
                <th>Name</th>
                <th>Pos</th>
                <th>B/T</th>
                <th>Grad</th>
                <th>School</th>
                <th>Hometown</th>
                <th>Commitment</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {allRosterRows.map((p: Player, idx) => {
                const cartKey = createCartKey(teamSlug, p.id);
                const isInFinalCart = finalCartByKey.has(cartKey);
                return (
                  <tr key={`${p.id}-${idx}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedSet.has(p.id)}
                        onChange={() => togglePlayer(p.id)}
                      />
                    </td>
                    <td>{selectedPlayerOrder.has(p.id) ? (selectedPlayerOrder.get(p.id) || 0) + 1 : "-"}</td>
                    <td>{p.number || "-"}</td>
                    <td>{p.name || "-"}</td>
                    <td>{p.position || "-"}</td>
                    <td>{p.batsThrows || "-"}</td>
                    <td>{p.grad || "-"}</td>
                    <td>{p.school || "-"}</td>
                    <td>{p.hometown || "-"}</td>
                    <td>{p.commitment || "-"}</td>
                    <td>
                      {p.id.startsWith("manual-") ? (
                        <span className="inline-actions">
                          <span>Manual</span>
                          <button type="button" className="secondary small-btn" onClick={() => removeManualPlayer(p.id)}>
                            Remove
                          </button>
                        </span>
                      ) : (
                        "Imported"
                      )}
                      {isInFinalCart ? " • In Final Cart" : ""}
                    </td>
                    <td>
                      {selectedPlayerOrder.has(p.id) ? (
                        <span className="inline-actions">
                          <button type="button" className="secondary small-btn" onClick={() => prioritizeSelectedPlayer(p.id)}>
                            Top
                          </button>
                          <button
                            type="button"
                            className="secondary small-btn"
                            disabled={(selectedPlayerOrder.get(p.id) || 0) === 0}
                            onClick={() => moveSelectedPlayer(p.id, "up")}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className="secondary small-btn"
                            disabled={(selectedPlayerOrder.get(p.id) || 0) === selectedPlayers.length - 1}
                            onClick={() => moveSelectedPlayer(p.id, "down")}
                          >
                            Down
                          </button>
                          <button type="button" className="secondary small-btn" onClick={() => removeSelectedPlayer(p.id)}>
                            Remove
                          </button>
                        </span>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && !allRosterRows.length ? (
                <tr>
                  <td colSpan={12}>Team roster is not uploaded yet. Once available on PBR, it will sync here.</td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <div className="row wrap" style={{ marginTop: 12 }}>
            <button type="button" onClick={addSelectedToFinalCart}>
              View Selected Players List
            </button>
            <button type="button" className="secondary" onClick={goToFinalCart}>
              View Final Cart ({finalCart.length})
            </button>
            <button type="button" className="secondary" onClick={goToTeamsPage}>
              Pick Another Team
            </button>
          </div>
          <p className="muted">
            Team selections: {selectedPlayerRows.length} | Final cart (all teams): {finalCart.length}
          </p>
          {finalCartStatus ? <p className="muted">{finalCartStatus}</p> : null}

          <div className="panel" style={{ marginTop: 12 }} ref={rosterSectionRef}>
            <h3 style={{ marginTop: 0 }}>Add Player To This Team Roster</h3>
            <p className="muted">Use this when a player is missing in the imported roster.</p>
            <div className="row wrap">
              <label>
                Jersey No.
                <input value={manualPlayerForm.number} onChange={(e) => updateManualPlayerField("number", e.target.value)} />
              </label>
              <label>
                Player Name
                <input value={manualPlayerForm.name} onChange={(e) => updateManualPlayerField("name", e.target.value)} />
              </label>
              <label>
                Position
                <input value={manualPlayerForm.position} onChange={(e) => updateManualPlayerField("position", e.target.value)} />
              </label>
              <label>
                School
                <input value={manualPlayerForm.school} onChange={(e) => updateManualPlayerField("school", e.target.value)} />
              </label>
              <label>
                Grad Year
                <input value={manualPlayerForm.grad} onChange={(e) => updateManualPlayerField("grad", e.target.value)} />
              </label>
              <label>
                Commitment
                <input value={manualPlayerForm.commitment} onChange={(e) => updateManualPlayerField("commitment", e.target.value)} />
              </label>
              <button type="button" onClick={addManualPlayer}>
                Add Player
              </button>
            </div>
            {playerFormStatus ? <p className="muted">{playerFormStatus}</p> : null}
          </div>
        </section>
      ) : null}

      <section className="panel" ref={finalCartSectionRef}>
        <h2 style={{ marginTop: 0 }}>Final Player Cart</h2>
        <p className="muted">
          Add players from multiple teams, then generate one travel schedule for the full final cart.
        </p>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Team</th>
              <th>Player</th>
              <th>Pos</th>
              <th>School</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {finalCart.map((player) => {
              const order = (finalCartOrder.get(player.cartKey) || 0) + 1;
              return (
                <tr key={player.cartKey}>
                  <td>{order}</td>
                  <td>{player.teamName}</td>
                  <td>{player.name}</td>
                  <td>{player.position || "-"}</td>
                  <td>{player.school || "-"}</td>
                  <td>
                    <span className="inline-actions">
                      <button type="button" className="secondary small-btn" onClick={() => prioritizeFinalCartPlayer(player.cartKey)}>
                        Top
                      </button>
                      <button
                        type="button"
                        className="secondary small-btn"
                        disabled={order === 1}
                        onClick={() => moveFinalCartPlayer(player.cartKey, "up")}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="secondary small-btn"
                        disabled={order === finalCart.length}
                        onClick={() => moveFinalCartPlayer(player.cartKey, "down")}
                      >
                        Down
                      </button>
                      <button type="button" className="secondary small-btn" onClick={() => removeFromFinalCart(player.cartKey)}>
                        Remove
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {!finalCart.length ? (
              <tr>
                <td colSpan={6}>No players in final cart yet. Open Team Roster, select players, then tap View Selected Players List.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="row wrap" style={{ marginTop: 12 }}>
          <button type="button" className="secondary" onClick={clearFinalCart} disabled={!finalCart.length}>
            Clear Final Cart
          </button>
          <button type="button" className="secondary" onClick={goToTeamsPage}>
            Open Teams
          </button>
        </div>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Coach Route Generator</h2>
        <p className="muted">
          Coach: {coachName} ({coachEmail}) | Domain: {coachDomain || "not detected"}
        </p>
        <div className="panel" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Selected Players Review ({selectedPlayersForSchedule.length})</h3>
          <p className="muted">
            {usingFinalCart
              ? "Final cart is active. This route will use players selected across teams."
              : "Final cart is empty. This route will use selected players from current team roster only."}
          </p>
          {!selectedPlayersForSchedule.length ? (
            <p className="muted">No players selected yet.</p>
          ) : (
            <ul className="path-list" style={{ paddingLeft: 20 }}>
              {selectedPlayersForSchedule.map((player, index) => (
                <li key={player.cartKey}>
                  <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <span>
                      #{index + 1} {player.name} {player.position ? `(${player.position})` : ""} - {player.teamName}
                    </span>
                    <span className="inline-actions">
                      <button
                        type="button"
                        className="secondary small-btn"
                        disabled={index === 0}
                        onClick={() =>
                          usingFinalCart ? prioritizeFinalCartPlayer(player.cartKey) : prioritizeSelectedPlayer(player.id)
                        }
                      >
                        Top
                      </button>
                      <button
                        type="button"
                        className="secondary small-btn"
                        disabled={index === 0}
                        onClick={() =>
                          usingFinalCart ? moveFinalCartPlayer(player.cartKey, "up") : moveSelectedPlayer(player.id, "up")
                        }
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="secondary small-btn"
                        disabled={index === selectedPlayersForSchedule.length - 1}
                        onClick={() =>
                          usingFinalCart ? moveFinalCartPlayer(player.cartKey, "down") : moveSelectedPlayer(player.id, "down")
                        }
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        className="secondary small-btn"
                        onClick={() => (usingFinalCart ? removeFromFinalCart(player.cartKey) : removeSelectedPlayer(player.id))}
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {usingFinalCart ? (
            <button type="button" className="secondary" onClick={goToFinalCart}>
              Go Back To Final Cart
            </button>
          ) : (
            <button type="button" className="secondary" onClick={goBackToRoster}>
              Go Back To Roster
            </button>
          )}
        </div>
        <div className="row wrap">
          <label>
            Coach Start Location
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
          </label>
          <button type="button" onClick={generateBestSchedule}>
            Generate Schedule
          </button>
          <button type="button" className="secondary" onClick={() => void saveCoachSchedule()} disabled={scheduleSyncBusy}>
            {scheduleSyncBusy ? "Saving..." : "Save + Share Coach Schedule"}
          </button>
        </div>
        {scheduleSyncStatus ? <p className="muted">{scheduleSyncStatus}</p> : null}
        <table className="mini-table">
          <thead>
            <tr>
              <th>At</th>
              <th>From</th>
              <th>To</th>
              <th>Game</th>
              <th>Travel</th>
            </tr>
          </thead>
          <tbody>
            {coachPlan.map((step, index) => (
              <tr key={`${step.at}-${index}`}>
                <td>{parseHourLabel(step.at)}</td>
                <td>{step.from}</td>
                <td>{step.to}</td>
                <td>{step.game}</td>
                <td>{step.travel}</td>
              </tr>
            ))}
            {!coachPlan.length ? (
              <tr>
                <td colSpan={5}>Select players and click Generate Schedule.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Shared Coach Schedules</h2>
        <p className="muted">Same domain sees full details. Different domain sees restricted rows only.</p>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Generated</th>
              <th>Coach</th>
              <th>Email</th>
              <th>Domain</th>
              <th>Route Steps</th>
              <th>Selected Players</th>
            </tr>
          </thead>
          <tbody>
            {sharedSchedules.map((schedule) => (
              <tr key={schedule.id}>
                <td>{new Date(schedule.generatedAt).toLocaleString()}</td>
                <td>{schedule.coachName}</td>
                <td>{schedule.coachEmailMasked}</td>
                <td>{schedule.coachDomain || "-"}</td>
                <td>{schedule.visibility === "full" ? schedule.steps.length : "Restricted"}</td>
                <td>
                  {schedule.visibility === "full"
                    ? schedule.selectedPlayerNames.slice(0, 3).join(", ") || "-"
                    : "Restricted"}
                </td>
              </tr>
            ))}
            {!sharedSchedules.length ? (
              <tr>
                <td colSpan={6}>No shared coach schedules yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Travel Booking (Flight/Bus)</h2>
        <p className="muted">
          MakeMyTrip-style flow: create booking request {"->"} coach approval {"->"} payment (saved card/new card/UPI) {"->"} confirmation.
        </p>

        <div className="row wrap">
          <label>
            Travel Mode
            <select
              value={travelMode}
              onChange={(e) => {
                const next = e.target.value as TravelMode;
                setTravelMode(next);
                if (next === "flight") {
                  setOperatorName("IndiGo");
                  setServiceCode("6E-204");
                } else {
                  setOperatorName("RedBus Premium");
                  setServiceCode("BUS-7421");
                }
              }}
            >
              <option value="flight">Flight</option>
              <option value="bus">Bus</option>
            </select>
          </label>
          <label>
            Origin
            <input value={bookingOrigin} onChange={(e) => setBookingOrigin(e.target.value)} />
          </label>
          <label>
            Destination
            <input value={bookingDestination} onChange={(e) => setBookingDestination(e.target.value)} />
          </label>
          <label>
            Departure
            <input
              type="datetime-local"
              value={bookingDepartureAt}
              onChange={(e) => setBookingDepartureAt(e.target.value)}
            />
          </label>
        </div>

        <div className="row wrap">
          <label>
            {travelMode === "flight" ? "Airline" : "Operator"}
            <input value={operatorName} onChange={(e) => setOperatorName(e.target.value)} />
          </label>
          <label>
            Service Number
            <input value={serviceCode} onChange={(e) => setServiceCode(e.target.value)} />
          </label>
          <label>
            Class
            <input value={seatClass} onChange={(e) => setSeatClass(e.target.value)} />
          </label>
          <label>
            Coaches
            <input
              type="number"
              min={1}
              value={seatsRequested}
              onChange={(e) => setSeatsRequested(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>

        <div className="row wrap">
          <label>
            Baggage
            <input value={baggage} onChange={(e) => setBaggage(e.target.value)} />
          </label>
          <label>
            Base Fare (INR)
            <input type="number" min={0} value={baseFare} onChange={(e) => setBaseFare(Number(e.target.value) || 0)} />
          </label>
          <label>
            Taxes (INR)
            <input type="number" min={0} value={taxes} onChange={(e) => setTaxes(Number(e.target.value) || 0)} />
          </label>
          <label>
            Convenience Fee (INR)
            <input
              type="number"
              min={0}
              value={convenienceFee}
              onChange={(e) => setConvenienceFee(Number(e.target.value) || 0)}
            />
          </label>
        </div>

        <label>
          Inclusions (comma separated)
          <textarea value={inclusionsText} onChange={(e) => setInclusionsText(e.target.value)} />
        </label>

        <label>
          Cancellation Policy
          <textarea value={cancellationPolicy} onChange={(e) => setCancellationPolicy(e.target.value)} />
        </label>

        <p className="muted">
          Total Fare: ₹{totalFare.toLocaleString("en-IN")}
        </p>

        <button type="button" onClick={() => void createBookingRequest()} disabled={bookingBusy}>
          {bookingBusy ? "Processing..." : "Create Booking Request"}
        </button>

        {bookingStatus ? <p className="muted">{bookingStatus}</p> : null}

        {activeBooking ? (
          <>
            <h3>Current Booking Request</h3>
            <table className="mini-table">
              <tbody>
                <tr>
                  <th>Status</th>
                  <td>{activeBooking.status}</td>
                </tr>
                <tr>
                  <th>Route</th>
                  <td>{activeBooking.origin} {"->"} {activeBooking.destination}</td>
                </tr>
                <tr>
                  <th>Departure</th>
                  <td>{new Date(activeBooking.departureAt).toLocaleString()}</td>
                </tr>
                <tr>
                  <th>{activeBooking.travelMode === "flight" ? "Airline" : "Operator"}</th>
                  <td>{activeBooking.operatorName} ({activeBooking.serviceCode})</td>
                </tr>
                <tr>
                  <th>Class / Coaches</th>
                  <td>{activeBooking.seatClass} / {activeBooking.seatsRequested}</td>
                </tr>
                <tr>
                  <th>Baggage</th>
                  <td>{activeBooking.baggage}</td>
                </tr>
                <tr>
                  <th>Inclusions</th>
                  <td>{activeBooking.inclusions.join(", ") || "-"}</td>
                </tr>
                <tr>
                  <th>Fare</th>
                  <td>
                    Base ₹{activeBooking.fare.base.toLocaleString("en-IN")} + Taxes ₹{activeBooking.fare.taxes.toLocaleString("en-IN")} + Fee ₹{activeBooking.fare.convenienceFee.toLocaleString("en-IN")} = ₹{activeBooking.fare.total.toLocaleString("en-IN")}
                  </td>
                </tr>
                <tr>
                  <th>Cancellation</th>
                  <td>{activeBooking.cancellationPolicy}</td>
                </tr>
                {activeBooking.confirmationRef ? (
                  <tr>
                    <th>Confirmation</th>
                    <td>{activeBooking.confirmationRef}</td>
                  </tr>
                ) : null}
                {activeBooking.payment ? (
                  <tr>
                    <th>Payment</th>
                    <td>
                      {activeBooking.payment.method} | ref {activeBooking.payment.reference}
                    </td>
                  </tr>
                ) : null}
                {activeBooking.rejectionReason ? (
                  <tr>
                    <th>Rejection Reason</th>
                    <td>{activeBooking.rejectionReason}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            {activeBooking.status === "pending_approval" ? (
              <div className="row wrap">
                <button type="button" onClick={() => void approveBookingRequest()} disabled={bookingBusy}>
                  {bookingBusy ? "Working..." : "Approve Booking"}
                </button>
                <label>
                  Rejection Reason
                  <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                </label>
                <button type="button" className="secondary" onClick={() => void rejectBookingRequest()} disabled={bookingBusy}>
                  Reject Booking
                </button>
              </div>
            ) : null}

            {activeBooking.status === "awaiting_payment" ? (
              <div className="panel" style={{ marginTop: 12 }}>
                <h3 style={{ marginTop: 0 }}>Payment Details</h3>
                <label>
                  Payment Option
                  <select value={paymentChoice} onChange={(e) => setPaymentChoice(e.target.value as PaymentChoice)}>
                    <option value="saved_card">Saved Card</option>
                    <option value="new_card">New Card</option>
                    <option value="upi">UPI</option>
                  </select>
                </label>

                {paymentChoice === "saved_card" ? (
                  <label>
                    Saved Cards
                    <select value={selectedSavedCardId} onChange={(e) => setSelectedSavedCardId(e.target.value)}>
                      <option value="">Select saved card</option>
                      {savedCards.map((card) => (
                        <option key={card.id} value={card.id}>
                          {card.label} ({card.expiry})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {paymentChoice === "new_card" ? (
                  <>
                    <label>
                      Card Holder Name
                      <input value={newCardHolder} onChange={(e) => setNewCardHolder(e.target.value)} />
                    </label>
                    <label>
                      Card Number
                      <input
                        value={newCardNumber}
                        onChange={(e) => setNewCardNumber(e.target.value.replace(/[^\d\s]/g, ""))}
                        placeholder="1234 5678 9012 3456"
                      />
                    </label>
                    <label>
                      Expiry (MM/YY)
                      <input value={newCardExpiry} onChange={(e) => setNewCardExpiry(e.target.value)} placeholder="09/29" />
                    </label>
                    <label className="checkbox-row" style={{ fontWeight: 500 }}>
                      <input
                        type="checkbox"
                        checked={saveNewCard}
                        onChange={(e) => setSaveNewCard(e.target.checked)}
                      />
                      Save this card for next bookings
                    </label>
                  </>
                ) : null}

                {paymentChoice === "upi" ? (
                  <label>
                    UPI ID
                    <input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="coach@okaxis" />
                  </label>
                ) : null}

                <button type="button" onClick={() => void payAndConfirmBooking()} disabled={bookingBusy}>
                  {bookingBusy ? "Processing Payment..." : `Pay ₹${activeBooking.fare.total.toLocaleString("en-IN")} and Confirm`}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
