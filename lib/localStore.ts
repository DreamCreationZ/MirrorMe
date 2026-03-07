import { ClosetItem, SavedLook, SessionFeedback, StylistMessage, UserProfile } from "@/types/models";

const PROFILE_KEY = "fashion_profile";
const CLOSET_KEY = "fashion_closet";
const OCCASION_KEY = "fashion_occasion";
const STYLIST_MESSAGES_KEY = "fashion_stylist_messages";
const SAVED_LOOKS_KEY = "fashion_saved_looks";
const SESSION_FEEDBACK_KEY = "fashion_session_feedback";

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const localStore = {
  makeKey: (base: string, userId: string) => `${base}:${userId}`,
  getProfile: (userId: string): UserProfile | null => safeRead<UserProfile | null>(`${PROFILE_KEY}:${userId}`, null),
  setProfile: (userId: string, profile: UserProfile) => {
    localStorage.setItem(`${PROFILE_KEY}:${userId}`, JSON.stringify(profile));
  },
  getCloset: (userId: string): ClosetItem[] => safeRead<ClosetItem[]>(`${CLOSET_KEY}:${userId}`, []),
  setCloset: (userId: string, items: ClosetItem[]) => {
    localStorage.setItem(`${CLOSET_KEY}:${userId}`, JSON.stringify(items));
  },
  getOccasion: (userId: string): string => safeRead<string>(`${OCCASION_KEY}:${userId}`, "casual"),
  setOccasion: (userId: string, occasion: string) => {
    localStorage.setItem(`${OCCASION_KEY}:${userId}`, JSON.stringify(occasion));
  },
  getStylistMessages: (userId: string): StylistMessage[] =>
    safeRead<StylistMessage[]>(`${STYLIST_MESSAGES_KEY}:${userId}`, []),
  setStylistMessages: (userId: string, messages: StylistMessage[]) => {
    localStorage.setItem(`${STYLIST_MESSAGES_KEY}:${userId}`, JSON.stringify(messages));
  },
  getSavedLooks: (userId: string): SavedLook[] => safeRead<SavedLook[]>(`${SAVED_LOOKS_KEY}:${userId}`, []),
  setSavedLooks: (userId: string, looks: SavedLook[]) => {
    localStorage.setItem(`${SAVED_LOOKS_KEY}:${userId}`, JSON.stringify(looks));
  },
  getSessionFeedback: (userId: string): SessionFeedback[] =>
    safeRead<SessionFeedback[]>(`${SESSION_FEEDBACK_KEY}:${userId}`, []),
  addSessionFeedback: (userId: string, feedback: SessionFeedback) => {
    const current = safeRead<SessionFeedback[]>(`${SESSION_FEEDBACK_KEY}:${userId}`, []);
    localStorage.setItem(`${SESSION_FEEDBACK_KEY}:${userId}`, JSON.stringify([feedback, ...current]));
  }
};
