import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180)
});

function weatherCodeLabel(code: number) {
  const map: Record<number, string> = {
    0: "clear sky",
    1: "mostly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "foggy",
    48: "foggy",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    56: "freezing drizzle",
    57: "heavy freezing drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    66: "freezing rain",
    67: "heavy freezing rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    77: "snow grains",
    80: "rain showers",
    81: "heavy rain showers",
    82: "violent rain showers",
    85: "snow showers",
    86: "heavy snow showers",
    95: "thunderstorm",
    96: "thunderstorm with hail",
    99: "severe thunderstorm with hail"
  };
  return map[code] || "variable weather";
}

function outfitAdvice(tempC: number, condition: string, windKmh: number, precipitationMm: number) {
  const notes: string[] = [];
  const conditionText = condition.toLowerCase();

  if (tempC >= 34) {
    notes.push("Choose breathable cotton or linen pieces in lighter shades.");
    notes.push("Prefer relaxed fits and avoid heavy layers.");
  } else if (tempC >= 27) {
    notes.push("Use light fabrics with one clean layer max.");
  } else if (tempC >= 20) {
    notes.push("A balanced look works: one base layer plus a light overshirt/jacket.");
  } else if (tempC >= 12) {
    notes.push("Add a medium outer layer like a jacket or knit.");
  } else {
    notes.push("Go for warm layers, full-length bottoms, and closed shoes.");
  }

  if (precipitationMm > 0 || /rain|drizzle|thunderstorm/.test(conditionText)) {
    notes.push("Carry a water-resistant outer layer and avoid long dragging hems.");
  }

  if (windKmh >= 24) {
    notes.push("Use a wind-blocking layer and avoid flowy loose silhouettes.");
  }

  return notes.join(" ");
}

export async function GET(req: NextRequest) {
  try {
    const query = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = querySchema.parse(query);

    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    weatherUrl.searchParams.set("latitude", String(parsed.lat));
    weatherUrl.searchParams.set("longitude", String(parsed.lon));
    weatherUrl.searchParams.set(
      "current",
      "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m"
    );
    weatherUrl.searchParams.set("timezone", "auto");

    const weatherRes = await fetch(weatherUrl.toString(), { cache: "no-store" });
    if (!weatherRes.ok) {
      return NextResponse.json({ error: "Failed to fetch weather." }, { status: 502 });
    }

    const weatherJson = (await weatherRes.json()) as {
      current?: {
        temperature_2m?: number;
        apparent_temperature?: number;
        weather_code?: number;
        wind_speed_10m?: number;
        precipitation?: number;
      };
    };

    const current = weatherJson.current || {};
    const temperatureC = Number(current.temperature_2m ?? 0);
    const feelsLikeC = Number(current.apparent_temperature ?? temperatureC);
    const windKmh = Number(current.wind_speed_10m ?? 0);
    const precipitationMm = Number(current.precipitation ?? 0);
    const code = Number(current.weather_code ?? 0);
    const condition = weatherCodeLabel(code);

    let locationLabel = "your area";
    try {
      const reverseUrl = new URL("https://geocoding-api.open-meteo.com/v1/reverse");
      reverseUrl.searchParams.set("latitude", String(parsed.lat));
      reverseUrl.searchParams.set("longitude", String(parsed.lon));
      reverseUrl.searchParams.set("language", "en");
      reverseUrl.searchParams.set("count", "1");
      const reverseRes = await fetch(reverseUrl.toString(), { cache: "no-store" });
      if (reverseRes.ok) {
        const reverseJson = (await reverseRes.json()) as {
          results?: Array<{ name?: string; admin1?: string; country?: string }>;
        };
        const r = reverseJson.results?.[0];
        if (r?.name && r?.country) {
          locationLabel = `${r.name}, ${r.country}`;
        } else if (r?.admin1 && r?.country) {
          locationLabel = `${r.admin1}, ${r.country}`;
        }
      }
    } catch {
      // best-effort reverse geocoding
    }

    return NextResponse.json({
      locationLabel,
      latitude: parsed.lat,
      longitude: parsed.lon,
      temperatureC,
      feelsLikeC,
      windKmh,
      precipitationMm,
      weatherCode: code,
      condition,
      styleAdvice: outfitAdvice(temperatureC, condition, windKmh, precipitationMm),
      fetchedAt: Date.now()
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected weather error." },
      { status: 400 }
    );
  }
}

