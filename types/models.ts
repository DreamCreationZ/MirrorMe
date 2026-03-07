export type Occasion = "casual" | "party" | "festival" | "work" | "date";

export interface UserProfile {
  id: string;
  name: string;
  age: number;
  heightCm: number;
  skinTone: string;
  country: string;
  state: string;
  phoneCountryCode: string;
  mobileNumber: string;
  profession: string;
  styleGoals: string;
  notes?: string;
  createdAt: number;
}

export interface ClosetItem {
  id: string;
  category: "top" | "bottom" | "dress" | "outerwear" | "shoes" | "sandal" | "accessory";
  name: string;
  color: string;
  brand?: string;
  tags: string[];
  imageUrl?: string;
  createdAt: number;
  lastWornAt?: number;
  wearCount?: number;
}

export interface StylistMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
  recommendation?: StylistRecommendation;
  feedback?: "up" | "down";
}

export interface StylistRecommendation {
  verdict: "NOT GOOD" | "GOOD" | "BEST";
  confidence: number;
  whyThisWorks: string[];
  alternatives: string[];
  timeSavingTip: string;
}

export interface SavedLook {
  id: string;
  occasion: Occasion | string;
  createdAt: number;
  userPrompt: string;
  recommendation: StylistRecommendation;
  wornAt?: number;
}

export interface SessionFeedback {
  rating: number;
  liked: boolean;
  comment: string;
  createdAt: number;
}

export interface StylistConfig {
  name: string;
  mode: "chat" | "talk";
  preferredLanguage: string;
  createdAt: number;
}

export interface TryOnPreset {
  personImage?: string;
  garmentImages: string[];
  createdAt: number;
}
