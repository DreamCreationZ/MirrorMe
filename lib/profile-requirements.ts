import type { UserProfile } from "@/types/models";

type SignupProfileInput = Partial<Pick<
  UserProfile,
  | "name"
  | "age"
  | "heightCm"
  | "skinTone"
  | "country"
  | "state"
  | "pincode"
  | "phoneCountryCode"
  | "mobileNumber"
  | "profession"
  | "styleGoals"
>>;

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRangeNumber(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function missingSignupFields(profile: SignupProfileInput | null | undefined): string[] {
  if (!profile) {
    return [
      "Name",
      "Age",
      "Height (cm)",
      "Color / Skin tone",
      "Country",
      "State",
      "Pincode",
      "Country code",
      "Mobile number",
      "Profession",
      "Style goals"
    ];
  }

  const missing: string[] = [];

  if (!hasText(profile.name)) missing.push("Name");
  if (!hasRangeNumber(profile.age, 13, 120)) missing.push("Age");
  if (!hasRangeNumber(profile.heightCm, 100, 250)) missing.push("Height (cm)");
  if (!hasText(profile.skinTone)) missing.push("Color / Skin tone");
  if (!hasText(profile.country)) missing.push("Country");
  if (!hasText(profile.state)) missing.push("State");
  if (!hasText(profile.pincode)) missing.push("Pincode");
  if (!hasText(profile.phoneCountryCode)) missing.push("Country code");
  if (!hasText(profile.mobileNumber)) missing.push("Mobile number");
  if (!hasText(profile.profession)) missing.push("Profession");
  if (!hasText(profile.styleGoals)) missing.push("Style goals");

  return missing;
}

export function hasSignupProfile(profile: SignupProfileInput | null | undefined) {
  return missingSignupFields(profile).length === 0;
}
