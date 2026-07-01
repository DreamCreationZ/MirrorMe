import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 120;

const postSchema = z.object({
  personImage: z.string().min(1),
  garmentImage: z.string().min(1),
  garmentType: z.enum(["auto", "upper_body", "lower_body", "dresses"]).optional(),
  awaitResult: z.boolean().optional()
});

const pollSchema = z.object({
  requestId: z.string().min(1),
  statusUrl: z.string().url().optional(),
  responseUrl: z.string().url().optional(),
  personImage: z.string().optional(),
  garmentImage: z.string().optional()
});

type FalJobMeta = {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
};

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isDataUrl(value: string) {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);
}

function getImageInput(value: string): string {
  if (isHttpUrl(value) || isDataUrl(value)) return value;
  throw new Error("Invalid image input. Use image URL or uploaded image.");
}

function findFirstHttpUrl(node: unknown, depth: number, forbiddenUrls: Set<string>): string | null {
  if (depth > 6 || node == null) return null;

  if (typeof node === "string") {
    if (!/^https?:\/\//i.test(node)) return null;
    return forbiddenUrls.has(node) ? null : node;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstHttpUrl(item, depth + 1, forbiddenUrls);
      if (found) return found;
    }
    return null;
  }

  if (typeof node === "object") {
    for (const value of Object.values(node as Record<string, unknown>)) {
      const found = findFirstHttpUrl(value, depth + 1, forbiddenUrls);
      if (found) return found;
    }
  }

  return null;
}

function extractResultUrl(payload: unknown, forbiddenUrls: Set<string> = new Set()): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  const direct =
    (typeof data.result_url === "string" && data.result_url) ||
    (typeof data.image_url === "string" && data.image_url) ||
    (typeof data.output_url === "string" && data.output_url);
  if (direct && !forbiddenUrls.has(direct)) return direct;

  if (Array.isArray(data.images) && data.images.length) {
    const first = data.images[0];
    if (typeof first === "string" && !forbiddenUrls.has(first)) return first;
    if (first && typeof first === "object") {
      const obj = first as Record<string, unknown>;
      if (typeof obj.url === "string" && !forbiddenUrls.has(obj.url)) return obj.url;
      if (typeof obj.image_url === "string" && !forbiddenUrls.has(obj.image_url)) return obj.image_url;
    }
  }

  if (data.output && typeof data.output === "object") {
    const output = data.output as Record<string, unknown>;
    if (typeof output.url === "string" && !forbiddenUrls.has(output.url)) return output.url;
    if (typeof output.image_url === "string" && !forbiddenUrls.has(output.image_url)) return output.image_url;
  }

  return findFirstHttpUrl(data, 0, forbiddenUrls);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getFalConfig() {
  const apiKey = process.env.TRYON_PROVIDER_API_KEY || process.env.FAL_KEY;
  if (!apiKey) throw new Error("TRYON_PROVIDER_API_KEY (or FAL_KEY) is required for fal_idm_vton.");

  const submitUrl = process.env.TRYON_PROVIDER_API_URL || "https://queue.fal.run/fal-ai/idm-vton";
  return { apiKey, submitUrl };
}

async function submitFalJob(
  personImage: string,
  garmentImage: string,
  garmentType: "auto" | "upper_body" | "lower_body" | "dresses" = "auto"
): Promise<FalJobMeta> {
  const { apiKey, submitUrl } = getFalConfig();
  const basePayload: Record<string, unknown> = {
    human_image_url: personImage,
    garment_image_url: garmentImage,
    description:
      process.env.TRYON_DESCRIPTION ||
      "Realistic virtual try-on. Put the garment on the person naturally with accurate fit, pose, lighting, and no filters."
  };

  const clothTypeMap: Record<"upper_body" | "lower_body" | "dresses", "upper" | "lower" | "overall"> = {
    upper_body: "upper",
    lower_body: "lower",
    dresses: "overall"
  };

  const candidates: Array<Record<string, unknown>> = [];
  if (garmentType !== "auto") {
    candidates.push({ ...basePayload, category: garmentType });
    candidates.push({ ...basePayload, garment_type: garmentType });
    candidates.push({ ...basePayload, cloth_type: clothTypeMap[garmentType] });
  }
  candidates.push(basePayload);

  let submitRes: Response | null = null;
  let lastErrorText = "";
  for (const payload of candidates) {
    submitRes = await fetchWithTimeout(
      submitUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${apiKey}`
        },
        body: JSON.stringify(payload)
      },
      30000
    );

    if (submitRes.ok) break;
    lastErrorText = await submitRes.text();

    const payloadKeys = Object.keys(payload);
    const hasTypeField = payloadKeys.includes("category") || payloadKeys.includes("garment_type") || payloadKeys.includes("cloth_type");
    const looksLikeFieldError = /extra_forbidden|unknown|validation|field required|not permitted|invalid/i.test(lastErrorText);
    if (!hasTypeField || !looksLikeFieldError) {
      break;
    }
  }

  if (!submitRes || !submitRes.ok) {
    throw new Error(`fal submit error: ${lastErrorText || "unknown submit error"}`);
  }

  const submitJson = (await submitRes.json()) as Record<string, unknown>;
  const requestId = typeof submitJson.request_id === "string" ? submitJson.request_id : "";
  const statusUrl =
    typeof submitJson.status_url === "string"
      ? submitJson.status_url
      : requestId
        ? `${submitUrl}/requests/${requestId}/status`
        : "";
  const responseUrl =
    typeof submitJson.response_url === "string"
      ? submitJson.response_url
      : requestId
        ? `${submitUrl}/requests/${requestId}`
        : "";

  if (!requestId || !responseUrl) {
    throw new Error("fal request accepted but no request_id/response_url was returned.");
  }

  return { requestId, statusUrl, responseUrl };
}

async function pollFalOnce(job: FalJobMeta, forbidden: Set<string>) {
  const { apiKey } = getFalConfig();
  const pollTarget = job.statusUrl || job.responseUrl;

  const pollRes = await fetchWithTimeout(
    pollTarget,
    {
      headers: { Authorization: `Key ${apiKey}` },
      cache: "no-store"
    },
    12000
  );

  if (pollRes.status === 202) {
    return { state: "running" as const, status: "IN_PROGRESS" };
  }

  if (!pollRes.ok) {
    const text = await pollRes.text();
    if (text.toLowerCase().includes("still in progress")) {
      return { state: "running" as const, status: "IN_PROGRESS" };
    }
    throw new Error(`fal polling error: ${text}`);
  }

  const pollJson = (await pollRes.json()) as Record<string, unknown>;
  const status = String(pollJson.status || "").toUpperCase();

  if (status.includes("FAILED") || status.includes("ERROR")) {
    return { state: "failed" as const, status, error: `fal generation failed: ${JSON.stringify(pollJson)}` };
  }

  if (!(status.includes("COMPLETED") || status === "")) {
    return { state: "running" as const, status: status || "IN_PROGRESS" };
  }

  const responseRes = await fetchWithTimeout(
    job.responseUrl,
    {
      headers: { Authorization: `Key ${apiKey}` },
      cache: "no-store"
    },
    12000
  );

  const contentType = responseRes.headers.get("content-type") || "";

  if (contentType.startsWith("image/")) {
    const redirectedUrl = responseRes.url;
    if (redirectedUrl && !forbidden.has(redirectedUrl)) {
      return { state: "completed" as const, status: "COMPLETED", resultUrl: redirectedUrl };
    }
  }

  if (!responseRes.ok) {
    return {
      state: "failed" as const,
      status: "ERROR",
      error: `fal final response error: ${await responseRes.text()}`
    };
  }

  let finalPayload: Record<string, unknown> = {};
  if (contentType.includes("application/json")) {
    finalPayload = (await responseRes.json()) as Record<string, unknown>;
  } else {
    const txt = await responseRes.text();
    if (/^https?:\/\//i.test(txt.trim()) && !forbidden.has(txt.trim())) {
      return { state: "completed" as const, status: "COMPLETED", resultUrl: txt.trim() };
    }
    finalPayload = { raw_response: txt };
  }

  const resultUrl =
    extractResultUrl(finalPayload, forbidden) ||
    extractResultUrl(finalPayload.data, forbidden) ||
    extractResultUrl(pollJson.data, forbidden);

  if (resultUrl) {
    return { state: "completed" as const, status: "COMPLETED", resultUrl };
  }

  return {
    state: "failed" as const,
    status: "ERROR",
    error: `fal completed without output image URL. payload=${JSON.stringify(finalPayload)}`
  };
}

async function pollFalUntilComplete(job: FalJobMeta, forbidden: Set<string>) {
  const startedAt = Date.now();
  const hardDeadlineMs = 95000;

  while (Date.now() - startedAt <= hardDeadlineMs) {
    const polled = await pollFalOnce(job, forbidden);
    if (polled.state === "completed" && polled.resultUrl) return polled.resultUrl;
    if (polled.state === "failed") {
      throw new Error(polled.error || "fal generation failed.");
    }
    await sleep(1100);
  }

  throw new Error(
    `Virtual try-on timed out after ~95s. status_url=${job.statusUrl || "n/a"} response_url=${job.responseUrl}`
  );
}

async function callCustomProvider(personImage: string, garmentImage: string) {
  const apiUrl = process.env.TRYON_PROVIDER_API_URL;
  const apiKey = process.env.TRYON_PROVIDER_API_KEY;

  if (!apiUrl || !apiKey) {
    throw new Error("TRYON_PROVIDER_API_URL and TRYON_PROVIDER_API_KEY are required for custom provider.");
  }

  const upstream = await fetchWithTimeout(
    apiUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        person_image: personImage,
        garment_image: garmentImage,
        realism: "high",
        add_filters: false
      })
    },
    45000
  );

  if (!upstream.ok) {
    throw new Error(`Custom provider error: ${await upstream.text()}`);
  }

  const json = (await upstream.json()) as unknown;
  const forbidden = new Set([personImage, garmentImage]);
  const resultUrl = extractResultUrl(json, forbidden);
  if (!resultUrl) throw new Error("Custom provider did not return an output image URL.");

  return resultUrl;
}

export async function GET(req: NextRequest) {
  try {
    const provider = process.env.TRYON_PROVIDER || "mock";
    if (provider !== "fal_idm_vton") {
      return NextResponse.json({ error: "Polling endpoint is only used for fal_idm_vton." }, { status: 400 });
    }

    const query = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = pollSchema.parse(query);

    const submitUrl = process.env.TRYON_PROVIDER_API_URL || "https://queue.fal.run/fal-ai/idm-vton";
    const job: FalJobMeta = {
      requestId: parsed.requestId,
      statusUrl: parsed.statusUrl || `${submitUrl}/requests/${parsed.requestId}/status`,
      responseUrl: parsed.responseUrl || `${submitUrl}/requests/${parsed.requestId}`
    };

    const forbidden = new Set<string>([parsed.personImage || "", parsed.garmentImage || ""].filter(Boolean));
    const polled = await pollFalOnce(job, forbidden);

    return NextResponse.json({ ...job, ...polled });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = postSchema.parse(await req.json());
    const personImage = getImageInput(body.personImage);
    const garmentImage = getImageInput(body.garmentImage);

    const provider = process.env.TRYON_PROVIDER || "mock";

    if (provider === "mock") {
      return NextResponse.json({
        resultUrl: personImage,
        note: "Mock mode active: this is only your original photo, not an overlay. Set TRYON_PROVIDER=fal_idm_vton (or custom) for real virtual try-on."
      });
    }

    if (provider === "fal_idm_vton") {
      const job = await submitFalJob(personImage, garmentImage, body.garmentType || "auto");

      if (body.awaitResult) {
        const forbidden = new Set([personImage, garmentImage]);
        const resultUrl = await pollFalUntilComplete(job, forbidden);
        return NextResponse.json({ ...job, state: "completed", resultUrl });
      }

      return NextResponse.json({ ...job, state: "queued" });
    }

    const resultUrl = await callCustomProvider(personImage, garmentImage);
    return NextResponse.json({ state: "completed", resultUrl });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected server error"
      },
      { status: 500 }
    );
  }
}
