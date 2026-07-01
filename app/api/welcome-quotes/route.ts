import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().optional()
});

const fallbackQuotes = [
  { text: "Progress in style starts with one clear choice, not ten rushed ones.", by: "MirrorMe" },
  { text: "Today is a fresh runway. Wear confidence first.", by: "MirrorMe" },
  { text: "Simple fits done right will always look expensive.", by: "MirrorMe" },
  { text: "Let your outfit support your day, not distract from it.", by: "MirrorMe" },
  { text: "Consistency in small style choices builds a signature look.", by: "MirrorMe" },
  { text: "Pick one hero piece and let everything else support it.", by: "MirrorMe" },
  { text: "When in doubt, fit and comfort beat trends.", by: "MirrorMe" },
  { text: "Dress for the life you are building, not the mood you woke up with.", by: "MirrorMe" }
];

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function fallbackSet(name?: string) {
  const intro = name?.trim() ? `${name.trim()}, ` : "";
  const dynamic = [
    { text: `${intro}your best outfit today is confidence with clean execution.`, by: "MirrorMe" },
    { text: `${intro}small upgrades in styling compound faster than you think.`, by: "MirrorMe" }
  ];
  return shuffle([...fallbackQuotes, ...dynamic]).slice(0, 5);
}

function extractJsonBlock(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json().catch(() => ({})));
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return NextResponse.json({ quotes: fallbackSet(body.name) });
    }

    const client = new OpenAI({ apiKey: key });
    const today = new Date().toISOString();
    const nameLine = body.name?.trim() ? `User first name: ${body.name.trim()}.` : "User name not provided.";
    const prompt = [
      "Generate 5 short motivational quotes for a fashion styling app welcome screen.",
      "Rules:",
      "- Each quote must be 8-18 words.",
      "- Keep tone modern, confident, positive, and practical.",
      "- No cliches like 'believe in yourself'.",
      "- Return strict JSON: {\"quotes\":[{\"text\":\"...\",\"by\":\"MirrorMe\"}]}",
      "- Ensure all 5 quotes are distinct.",
      nameLine,
      `Timestamp for variation: ${today}`
    ].join("\n");

    const completion = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: prompt
    });

    const parsed = JSON.parse(extractJsonBlock(completion.output_text || "{}")) as {
      quotes?: Array<{ text?: string; by?: string }>;
    };
    const quotes = (parsed.quotes || [])
      .map((q) => ({
        text: String(q.text || "").trim(),
        by: String(q.by || "MirrorMe").trim() || "MirrorMe"
      }))
      .filter((q) => q.text.length >= 8)
      .slice(0, 5);

    if (!quotes.length) {
      return NextResponse.json({ quotes: fallbackSet(body.name) });
    }

    return NextResponse.json({ quotes });
  } catch {
    return NextResponse.json({ quotes: fallbackSet() });
  }
}

