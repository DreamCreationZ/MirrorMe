import { AppSettings, ClosetItem, SavedLook, SessionFeedback, StylistConfig, StylistMessage, TryOnPreset, UserProfile } from "@/types/models";

const PROFILE_KEY = "fashion_profile";
const CLOSET_KEY = "fashion_closet";
const OCCASION_KEY = "fashion_occasion";
const STYLIST_MESSAGES_KEY = "fashion_stylist_messages";
const SAVED_LOOKS_KEY = "fashion_saved_looks";
const SESSION_FEEDBACK_KEY = "fashion_session_feedback";
const STYLIST_CONFIG_KEY = "fashion_stylist_config";
const TRYON_PRESET_KEY = "fashion_tryon_preset";
const APP_SETTINGS_KEY = "fashion_app_settings";

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
  },
  getStylistConfig: (userId: string): StylistConfig | null =>
    safeRead<StylistConfig | null>(`${STYLIST_CONFIG_KEY}:${userId}`, null),
  setStylistConfig: (userId: string, config: StylistConfig) => {
    localStorage.setItem(`${STYLIST_CONFIG_KEY}:${userId}`, JSON.stringify(config));
  },
  getTryOnPreset: (userId: string): TryOnPreset | null =>
    safeRead<TryOnPreset | null>(`${TRYON_PRESET_KEY}:${userId}`, null),
  setTryOnPreset: (userId: string, preset: TryOnPreset) => {
    localStorage.setItem(`${TRYON_PRESET_KEY}:${userId}`, JSON.stringify(preset));
  },
  clearTryOnPreset: (userId: string) => {
    localStorage.removeItem(`${TRYON_PRESET_KEY}:${userId}`);
  },
  getAppSettings: (userId: string): AppSettings | null =>
    safeRead<AppSettings | null>(`${APP_SETTINGS_KEY}:${userId}`, null),
  setAppSettings: (userId: string, settings: AppSettings) => {
    localStorage.setItem(`${APP_SETTINGS_KEY}:${userId}`, JSON.stringify(settings));
  }
};
