import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  imageDataUrl: z.string().min(1)
});

function splitDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const parsed = splitDataUrl(body.imageDataUrl);

    if (!parsed) {
      return NextResponse.json({ error: "Invalid image data URL." }, { status: 400 });
    }

    const removeBgKey = process.env.REMOVE_BG_API_KEY;
    if (!removeBgKey) {
      return NextResponse.json({
        processedImageDataUrl: body.imageDataUrl,
        provider: "local",
        note: "REMOVE_BG_API_KEY not set, using local normalization only."
      });
    }

    const formData = new FormData();
    formData.append("image_file_b64", parsed.base64);
    formData.append("size", "auto");
    formData.append("format", "png");

    const upstream = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: {
        "X-Api-Key": removeBgKey
      },
      body: formData
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      return NextResponse.json(
        {
          processedImageDataUrl: body.imageDataUrl,
          provider: "local",
          note: `remove.bg failed, using local normalization fallback. ${txt}`
        },
        { status: 200 }
      );
    }

    const contentType = upstream.headers.get("content-type") || "image/png";
    const arr = await upstream.arrayBuffer();
    const base64 = Buffer.from(arr).toString("base64");

    return NextResponse.json({
      processedImageDataUrl: `data:${contentType};base64,${base64}`,
      provider: "removebg"
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected server error"
      },
      { status: 500 }
    );
  }
}
