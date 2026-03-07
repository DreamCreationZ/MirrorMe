import { NextRequest, NextResponse } from "next/server";
import { COUNTRY_OPTIONS, findCountryByIso } from "@/lib/location";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const country = (url.searchParams.get("country") || "").trim().toUpperCase();
  const pincode = (url.searchParams.get("pincode") || "").trim();

  if (!pincode) {
    return NextResponse.json({ error: "pincode is required." }, { status: 400 });
  }

  const searchOrder = [
    ...(country ? [country] : []),
    ...COUNTRY_OPTIONS.map((item) => item.iso).filter((iso) => iso !== country)
  ];

  try {
    for (const iso of searchOrder) {
      const lookup = await fetch(`https://api.zippopotam.us/${encodeURIComponent(iso)}/${encodeURIComponent(pincode)}`, {
        cache: "no-store"
      });

      if (!lookup.ok) continue;

      const data = (await lookup.json()) as {
        places?: Array<{ state?: string }>;
      };
      const state = data.places?.[0]?.state?.trim() || "";
      const countryInfo = findCountryByIso(iso);
      return NextResponse.json({
        state,
        countryIso: iso,
        countryName: countryInfo?.name || iso,
        phoneCountryCode: countryInfo?.dialCode || "",
        found: Boolean(state)
      });
    }

    return NextResponse.json({ state: "", countryIso: "", countryName: "", phoneCountryCode: "", found: false });
  } catch {
    return NextResponse.json({ state: "", countryIso: "", countryName: "", phoneCountryCode: "", found: false });
  }
}
