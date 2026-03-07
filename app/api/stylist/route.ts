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
      country: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional(),
      phoneCountryCode: z.string().optional(),
      mobileNumber: z.string().optional(),
      profession: z.string().optional(),
      styleGoals: z.string().optional(),
      notes: z.string().optional()
    })
    .nullable()
    .optional(),
  closet: z.array(z.record(z.unknown())).optional(),
  occasion: z.string().optional(),
  stylistName: z.string().optional(),
  conversationMode: z.enum(["chat", "talk"]).optional(),
  preferredLanguage: z.string().optional()
});

type ResponsesCreateInput = NonNullable<Parameters<OpenAI["responses"]["create"]>[0]["input"]>;
type StylistInputMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | {
            type: "input_text";
            text: string;
          }
        | {
            type: "input_image";
            image_url: string;
          }
      >;
};

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
- If user shares only one clothing piece (for example only a shirt/top), ask a clear follow-up for the missing pieces (bottom/footwear/accessories) before finalizing.
- Also guide makeup honestly when user asks (base, lips, eyes, finish, shade direction).
- If user asks non-fashion personal chat, answer warmly but keep stylist personality.
- Reply in the user's language. If preferred language is set, prioritize that.
Output format rules:
- Return strict JSON only.
- If user asks for outfit/fashion recommendation, keys must be exactly: verdict, confidence, whyThisWorks, alternatives, timeSavingTip, reply.
- If user is doing normal conversation (not asking for styling decision), return only: { "reply": "..." } with natural conversational text and no verdict line.`;

function isRecommendationQuery(text: string, hasImages: boolean) {
  if (hasImages) return true;
  const t = text.toLowerCase();
  const keywords = [
    "wear",
    "outfit",
    "dress",
    "shirt",
    "jeans",
    "pants",
    "trouser",
    "saree",
    "blouse",
    "skirt",
    "kurta",
    "look",
    "style",
    "styling",
    "shoe",
    "sandal",
    "accessory",
    "makeup",
    "festival",
    "party",
    "casual",
    "wedding"
  ];
  return keywords.some((k) => t.includes(k));
}

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

function closetInsights(closet: Array<Record<string, unknown>>) {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const recentlyWorn = closet
    .filter((item) => typeof item.lastWornAt === "number" && now - Number(item.lastWornAt) <= sevenDaysMs)
    .map((item) => String(item.name || "Unknown item"))
    .slice(0, 12);

  const longNotWorn = closet
    .filter((item) => {
      if (typeof item.lastWornAt !== "number") return true;
      return now - Number(item.lastWornAt) >= thirtyDaysMs;
    })
    .map((item) => String(item.name || "Unknown item"))
    .slice(0, 12);

  return { recentlyWorn, longNotWorn };
}

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "OPENAI_API_KEY is missing." }, { status: 400 });
  }

  try {
    const body = schema.parse(await req.json());

    const client = new OpenAI({ apiKey: key });
    const lastUserMessage = [...body.messages].reverse().find((m) => m.role === "user");
    const shouldRecommend = isRecommendationQuery(
      lastUserMessage?.content || "",
      Boolean(lastUserMessage?.images?.length)
    );
    const contextSummary = {
      profile: body.profile ?? null,
      occasion: body.occasion ?? "casual",
      closetCount: body.closet?.length ?? 0,
      closet: body.closet?.slice(0, 25) ?? [],
      stylistName: body.stylistName || "Meera",
      conversationMode: body.conversationMode || "chat",
      preferredLanguage: body.preferredLanguage || "auto",
      closetInsights: closetInsights(body.closet ?? []),
      shouldRecommend
    };

    const input: StylistInputMessage[] = [
      { role: "system", content: systemPrompt },
      {
        role: "system",
        content: `Your stylist name is "${contextSummary.stylistName}". Talk like a natural human stylist. If mode is talk, keep reply shorter and conversational. Use language preference: "${contextSummary.preferredLanguage}".`
      },
      {
        role: "system",
        content:
          "Wardrobe rules: If closet has items, actively recommend specific items from closet. If user asks to repeat something worn recently, call it out honestly and suggest a better alternative from long-not-worn items. If closet is empty, ask user to share what they have in mind and upload photo for honest advice."
      },
      {
        role: "system",
        content: `User context JSON:\n${JSON.stringify(contextSummary, null, 2)}`
      },
      ...body.messages.map<StylistInputMessage>((m) => {
        if (m.role === "user" && m.images?.length) {
          return {
            role: "user" as const,
            content: [
              { type: "input_text" as const, text: m.content || "Please review these outfit images." },
              ...m.images.map((imageUrl) => ({ type: "input_image" as const, image_url: imageUrl }))
            ]
          };
        }

        return { role: m.role, content: m.content };
      })
    ];

    const completion = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: input as ResponsesCreateInput
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
        : raw.trim() || "This can work with a few tweaks.";

    const cleanedReply = replyText.replace(/\s*Verdict:\s*(NOT GOOD|GOOD|BEST)\s*$/i, "").trim();

    if (!shouldRecommend) {
      return NextResponse.json({
        reply: cleanedReply || "I am here. Tell me what mood or outfit you want today."
      });
    }

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
      reply: cleanedReply ? `${cleanedReply}\nVerdict: ${verdict}` : `Verdict: ${verdict}`
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
  } catch {
    return NextResponse.json(
      {
        error: "Stylist is temporarily having trouble formatting the response. Please try again."
      },
      { status: 500 }
    );
  }
}
