import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
  images: z.array(z.string()).optional()
});

const schema = z.object({
  messages: z.array(messageSchema).min(1),
  profile: z
    .object({
      name: z.string().optional(),
      age: z.number().optional(),
      heightCm: z.number().optional(),
      skinTone: z.string().optional(),
      profession: z.string().optional(),
      styleGoals: z.string().optional(),
      notes: z.string().optional()
    })
    .nullable()
    .optional(),
  closet: z.array(z.any()).optional(),
  occasion: z.string().optional()
});

const recommendationSchema = z.object({
  verdict: z.enum(["NOT GOOD", "GOOD", "BEST"]),
  confidence: z.number().min(0).max(100),
  whyThisWorks: z.array(z.string()).min(2).max(4),
  alternatives: z.array(z.string()).min(1).max(3),
  timeSavingTip: z.string().min(8).max(220),
  reply: z.string().min(10)
});

const systemPrompt = `You are a personal AI fashion stylist.
Tone rules:
- Be brutally honest but never insulting.
- If something will look bad, say so directly and explain why.
- If something is good, say good. If excellent, say best.
- Never flatter by default.
Personalization rules:
- Always use saved profile details: height, skin tone, age, profession, style goals.
- Factor the occasion in every judgment.
- If images are provided, visually analyze them before giving verdict.
Output format rules:
- Return strict JSON only.
- Keys must be exactly: verdict, confidence, whyThisWorks, alternatives, timeSavingTip, reply.
- reply must end with: Verdict: NOT GOOD / GOOD / BEST`;

function normalizeVerdict(value: unknown, replyText: string): "NOT GOOD" | "GOOD" | "BEST" {
  const upper = String(value || "").toUpperCase();
  if (upper === "NOT GOOD" || upper === "GOOD" || upper === "BEST") return upper;

  const replyUpper = replyText.toUpperCase();
  if (replyUpper.includes("VERDICT: NOT GOOD")) return "NOT GOOD";
  if (replyUpper.includes("VERDICT: BEST")) return "BEST";
  return "GOOD";
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\n|;|•|,|\-/g)
      .map((v) => v.trim())
      .filter(Boolean);
  }

  return [];
}

function extractJsonBlock(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const codeBlock = trimmed.match(/```json\\s*([\\s\\S]*?)```/i);
  if (codeBlock?.[1]) return codeBlock[1].trim();

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);

  return trimmed;
}

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "OPENAI_API_KEY is missing." }, { status: 400 });
  }

  try {
    const body = schema.parse(await req.json());

    const client = new OpenAI({ apiKey: key });
    const contextSummary = {
      profile: body.profile ?? null,
      occasion: body.occasion ?? "casual",
      closetCount: body.closet?.length ?? 0,
      closet: body.closet?.slice(0, 25) ?? []
    };

    const input: any[] = [
      { role: "system", content: systemPrompt },
      {
        role: "system",
        content: `User context JSON:\n${JSON.stringify(contextSummary, null, 2)}`
      },
      ...body.messages.map((m) => {
        if (m.role === "user" && m.images?.length) {
          return {
            role: "user",
            content: [
              { type: "input_text", text: m.content || "Please review these outfit images." },
              ...m.images.map((imageUrl) => ({ type: "input_image", image_url: imageUrl }))
            ]
          };
        }

        return { role: m.role, content: m.content };
      })
    ];

    const completion = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input
    });

    const raw = completion.output_text || "";
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(extractJsonBlock(raw)) as Record<string, unknown>;
    } catch {
      parsed = {};
    }

    const replyText =
      typeof parsed.reply === "string" && parsed.reply.trim()
        ? parsed.reply.trim()
        : raw.trim() || "This can work with a few tweaks. Verdict: GOOD";

    const verdict = normalizeVerdict(parsed.verdict, replyText);

    const normalized = {
      verdict,
      confidence:
        typeof parsed.confidence === "string"
          ? Number(parsed.confidence)
          : typeof parsed.confidence === "number"
            ? parsed.confidence
            : 75,
      whyThisWorks: toList(parsed.whyThisWorks).slice(0, 4),
      alternatives: toList(parsed.alternatives).slice(0, 3),
      timeSavingTip:
        typeof parsed.timeSavingTip === "string" && parsed.timeSavingTip.trim()
          ? parsed.timeSavingTip.trim()
          : "Keep one go-to complete outfit ready for this occasion to save time.",
      reply: replyText.includes("Verdict:")
        ? replyText
        : `${replyText}\nVerdict: ${verdict}`
    };
    if (normalized.whyThisWorks.length < 2) {
      normalized.whyThisWorks = [
        "The recommendation is aligned with your occasion and personal profile details.",
        "The outfit balance is chosen to keep proportions and color harmony practical."
      ];
    }
    if (normalized.alternatives.length < 1) {
      normalized.alternatives = ["Switch to a simpler color combo from your closet for a safer option."];
    }

    const safe = recommendationSchema.safeParse(normalized);
    const json = safe.success
      ? safe.data
      : {
          verdict: "GOOD" as const,
          confidence: 72,
          whyThisWorks: [
            "This is a practical match for the occasion.",
            "It keeps the styling balanced and easy to carry."
          ],
          alternatives: ["Use a simpler, cleaner variant from your closet if unsure."],
          timeSavingTip: "Pre-save one tested outfit per occasion.",
          reply: `${replyText}\nVerdict: GOOD`
        };

    return NextResponse.json({
      reply: json.reply,
      recommendation: {
        verdict: json.verdict,
        confidence: json.confidence,
        whyThisWorks: json.whyThisWorks,
        alternatives: json.alternatives,
        timeSavingTip: json.timeSavingTip
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Stylist is temporarily having trouble formatting the response. Please try again."
      },
      { status: 500 }
    );
  }
}
