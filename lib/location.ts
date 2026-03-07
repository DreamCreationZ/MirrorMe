export interface CountryOption {
  iso: string;
  name: string;
  dialCode: string;
}

export const COUNTRY_OPTIONS: CountryOption[] = [
  { iso: "IN", name: "India", dialCode: "+91" },
  { iso: "US", name: "United States", dialCode: "+1" },
  { iso: "GB", name: "United Kingdom", dialCode: "+44" },
  { iso: "CA", name: "Canada", dialCode: "+1" },
  { iso: "AU", name: "Australia", dialCode: "+61" },
  { iso: "AE", name: "United Arab Emirates", dialCode: "+971" },
  { iso: "SA", name: "Saudi Arabia", dialCode: "+966" },
  { iso: "SG", name: "Singapore", dialCode: "+65" },
  { iso: "MY", name: "Malaysia", dialCode: "+60" },
  { iso: "TH", name: "Thailand", dialCode: "+66" },
  { iso: "ID", name: "Indonesia", dialCode: "+62" },
  { iso: "PH", name: "Philippines", dialCode: "+63" },
  { iso: "VN", name: "Vietnam", dialCode: "+84" },
  { iso: "JP", name: "Japan", dialCode: "+81" },
  { iso: "KR", name: "South Korea", dialCode: "+82" },
  { iso: "DE", name: "Germany", dialCode: "+49" },
  { iso: "FR", name: "France", dialCode: "+33" },
  { iso: "IT", name: "Italy", dialCode: "+39" },
  { iso: "ES", name: "Spain", dialCode: "+34" },
  { iso: "NL", name: "Netherlands", dialCode: "+31" },
  { iso: "SE", name: "Sweden", dialCode: "+46" },
  { iso: "NO", name: "Norway", dialCode: "+47" },
  { iso: "CH", name: "Switzerland", dialCode: "+41" },
  { iso: "BR", name: "Brazil", dialCode: "+55" },
  { iso: "MX", name: "Mexico", dialCode: "+52" },
  { iso: "ZA", name: "South Africa", dialCode: "+27" }
];

export function findCountryByIso(iso?: string | null): CountryOption | undefined {
  if (!iso) return undefined;
  const normalized = iso.trim().toUpperCase();
  return COUNTRY_OPTIONS.find((item) => item.iso === normalized);
}

export function findCountryByName(name?: string | null): CountryOption | undefined {
  if (!name) return undefined;
  const normalized = name.trim().toLowerCase();
  return COUNTRY_OPTIONS.find((item) => item.name.toLowerCase() === normalized);
}
