"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { localStore } from "@/lib/localStore";
import { loadProfile } from "@/lib/persistence";
import {
  TRYON_PACK_CREDITS,
  TRYON_PACK_PRICE_USD,
  addTryOnPack,
  consumeTryOnCredits,
  hasActiveSubscription,
  loadBilling
} from "@/lib/subscription";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type TryOnJob = {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
};

type GarmentType = "auto" | "upper_body" | "lower_body" | "dresses";

export default function TryOnPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [personImageUrl, setPersonImageUrl] = useState("");
  const [garmentImageUrl, setGarmentImageUrl] = useState("");
  const [personPreview, setPersonPreview] = useState("");
  const [garmentPreview, setGarmentPreview] = useState("");

  const [resultUrl, setResultUrl] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [tryCredits, setTryCredits] = useState(0);
  const [extraGarmentUrls, setExtraGarmentUrls] = useState("");
  const [presetGarments, setPresetGarments] = useState<string[]>([]);
  const [garmentType, setGarmentType] = useState<GarmentType>("auto");

  const personImage = useMemo(() => personPreview || personImageUrl, [personPreview, personImageUrl]);
  const garmentImage = useMemo(() => garmentPreview || garmentImageUrl, [garmentPreview, garmentImageUrl]);

  useEffect(() => {
    let mounted = true;
    waitForAuthInit().then(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      const billing = await loadBilling(user.id);
      if (!hasActiveSubscription(billing)) {
        router.replace("/subscribe");
        return;
      }
      if (!mounted) return;
      setUserId(user.id);
      setSubscriptionActive(true);
      setTryCredits(billing.tryOnCredits);
      const profile = await loadProfile(user.id);
      if (profile?.frontImageUrl) {
        setPersonImageUrl(profile.frontImageUrl);
        setPersonPreview("");
      }
      const preset = localStore.getTryOnPreset(user.id);
      if (!preset) return;
      if (preset.personImage && !profile?.frontImageUrl) setPersonImageUrl(preset.personImage);
      if (preset.garmentImages.length) {
        setGarmentImageUrl(preset.garmentImages[0]);
        setPresetGarments(preset.garmentImages.slice(1));
      }
      localStore.clearTryOnPreset(user.id);
    });
    return () => {
      mounted = false;
    };
  }, [router]);

  async function compressImage(file: File, maxSide = 896, quality = 0.72): Promise<File> {
    const dataUrl = await fileToDataUrl(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Failed to decode image."));
      el.src = dataUrl;
    });

    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });
    if (!blob) return file;

    const name = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image file."));
      reader.readAsDataURL(file);
    });
  }

  async function onFileChange(
    e: ChangeEvent<HTMLInputElement>,
    setPreview: (value: string) => void,
    setUrl: (value: string) => void
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressImage(file);
    setPreview(await fileToDataUrl(compressed));
    setUrl("");
  }

  function isHttpUrl(value: string) {
    return /^https?:\/\//i.test(value);
  }

  function isDataUrl(value: string) {
    return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);
  }

  async function ensurePublicImageUrl(source: string): Promise<string> {
    if (isHttpUrl(source) || isDataUrl(source)) return source;
    return source;
  }

  async function pollTryOn(job: TryOnJob) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const params = new URLSearchParams({
        requestId: job.requestId,
        responseUrl: job.responseUrl
      });
      if (job.statusUrl) {
        params.set("statusUrl", job.statusUrl);
      }

      const pollRes = await fetch(`/api/tryon?${params.toString()}`, { cache: "no-store" });
      const pollData = (await pollRes.json()) as {
        state?: string;
        status?: string;
        resultUrl?: string;
        error?: string;
      };

      if (pollData.resultUrl) {
        return pollData.resultUrl;
      }

      if (String(pollData.state || "").toLowerCase() === "completed") {
        throw new Error("Try-on job completed but no image URL was returned. Please retry once.");
      }

      if (pollData.state === "failed") {
        throw new Error(pollData.error || "Virtual try-on failed.");
      }

      setStatus(`Try-on ${pollData.state || "running"}... ${pollData.status ? `(${pollData.status})` : ""}`);
      await sleep(900);
    }

    throw new Error("Try-on is still processing. Please retry in a minute.");
  }

  function inferGarmentType(source: string, selected: GarmentType): GarmentType {
    if (selected !== "auto") return selected;
    const s = source.toLowerCase();
    if (/(dress|saree|gown|onepiece|one-piece)/i.test(s)) return "dresses";
    if (/(pant|jean|trouser|skirt|short|lehenga|bottom)/i.test(s)) return "lower_body";
    if (/(shirt|top|tshirt|t-shirt|blouse|kurta|jacket|hoodie|upper)/i.test(s)) return "upper_body";
    return "auto";
  }

  async function runTryOnStep(
    personPayload: string,
    garmentPayload: string,
    step: number,
    total: number,
    selectedType: GarmentType
  ) {
    setStatus(`Submitting overlay step ${step}/${total}...`);
    const stepType = inferGarmentType(garmentPayload, selectedType);
    const waitInline = total === 1;
    const res = await fetch("/api/tryon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personImage: personPayload,
        garmentImage: garmentPayload,
        garmentType: stepType,
        awaitResult: waitInline
      })
    });
    if (!res.ok) {
      throw new Error(`Try-on request failed with status ${res.status}.`);
    }
    const data = (await res.json()) as {
      requestId?: string;
      statusUrl?: string;
      responseUrl?: string;
      resultUrl?: string;
      error?: string;
      note?: string;
    };

    if (data.resultUrl) return data.resultUrl;
    if (!data.requestId || !data.responseUrl) {
      throw new Error(data.error || "Try-on job could not be created.");
    }

    setStatus(`Applying piece ${step}/${total}...`);
    return pollTryOn({
      requestId: data.requestId,
      statusUrl: data.statusUrl || "",
      responseUrl: data.responseUrl
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!subscriptionActive) {
      setStatus("An active $12/month subscription is required. Please subscribe to continue.");
      router.push("/subscribe");
      return;
    }
    if (tryCredits < 1) {
      setStatus("No try-on credits left. Pay $1 to add 2 try-ons.");
      return;
    }
    if (!personImage || !garmentImage) {
      setStatus("Please upload your outfit piece photo. Your saved profile photo is used automatically.");
      return;
    }

    setStatus("Preparing try-on job...");
    setResultUrl("");
    setLoading(true);

    try {
      let personPayload = personImage;
      let garmentPayload = garmentImage;

      personPayload = personImageUrl.trim() || personPayload;
      garmentPayload = garmentImageUrl.trim() || garmentPayload;

      const extraFromInput = extraGarmentUrls
        .split(/\n|,/g)
        .map((x) => x.trim())
        .filter(Boolean);
      const garmentSequenceRaw = [garmentPayload, ...presetGarments, ...extraFromInput].filter(Boolean);

      let currentPerson = personPayload;
      currentPerson = await ensurePublicImageUrl(currentPerson);
      const garmentSequence = await Promise.all(
        garmentSequenceRaw.map((piece) => ensurePublicImageUrl(piece))
      );

      for (let i = 0; i < garmentSequence.length; i += 1) {
        const piece = garmentSequence[i];
        const stepUrl = await runTryOnStep(currentPerson, piece, i + 1, garmentSequence.length, garmentType);
        currentPerson = stepUrl;
      }

      setResultUrl(currentPerson);
      setStatus("Done. Full outfit overlay generated.");
      if (userId) {
        const next = await consumeTryOnCredits(userId, 1);
        setTryCredits(next.tryOnCredits);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Try-on failed during upload or generation.";
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="lux-stage">
      <div className="lux-phone-grid">
        <article className="lux-phone">
          <h4>Virtual Try-On</h4>
          <p className="small">Paid try-on: ${TRYON_PACK_PRICE_USD} for {TRYON_PACK_CREDITS} tries · Credits: {tryCredits}</p>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              if (!userId) return;
              setBillingBusy(true);
              try {
                const next = await addTryOnPack(userId, 1);
                setTryCredits(next.tryOnCredits);
                setStatus(`Payment test successful. ${TRYON_PACK_CREDITS} try-on credits added.`);
              } catch {
                setStatus("Unable to add try-on credits right now. Please try again.");
              } finally {
                setBillingBusy(false);
              }
            }}
            style={{ marginBottom: 10 }}
            disabled={billingBusy || !subscriptionActive}
          >
            {billingBusy ? "Processing..." : `Pay $${TRYON_PACK_PRICE_USD} (Test) to Add ${TRYON_PACK_CREDITS} Tries`}
          </button>
          {!subscriptionActive ? (
            <p className="small">
              Subscription required. <Link href="/subscribe">Activate plan</Link>.
            </p>
          ) : null}
          <form onSubmit={onSubmit} className="grid">
            <label>
              Garment type
              <select value={garmentType} onChange={(e) => setGarmentType(e.target.value as GarmentType)}>
                <option value="auto">Auto detect</option>
                <option value="upper_body">Top / Upper body</option>
                <option value="lower_body">Bottom / Lower body</option>
                <option value="dresses">Full dress / Saree / Gown</option>
              </select>
            </label>
            <label>
              Upload garment image
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onFileChange(e, setGarmentPreview, setGarmentImageUrl)}
              />
            </label>
            <label>
              Garment URL (optional)
              <input
                value={garmentImageUrl}
                onChange={(e) => {
                  setGarmentImageUrl(e.target.value);
                  if (e.target.value) setGarmentPreview("");
                }}
              />
            </label>
            <label>
              Extra pieces URL (one per line)
              <textarea
                rows={3}
                value={extraGarmentUrls}
                onChange={(e) => setExtraGarmentUrls(e.target.value)}
                placeholder="https://...shirt.jpg&#10;https://...pants.jpg"
              />
            </label>
            <button type="submit" disabled={loading || !subscriptionActive}>{loading ? "Generating..." : "Confirm"}</button>
          </form>
          {presetGarments.length ? <p className="small">Preset pieces: {presetGarments.length}</p> : null}
          {status ? <p className="small">{status}</p> : null}
        </article>

        <article className="lux-phone">
          <h4>Mirror Preview</h4>
          <div className="lux-mirror lux-mirror-tall">
            {!resultUrl ? (
              <div className="lux-model-silhouette strong" />
            ) : (
              <img src={resultUrl} alt="Try-on result" className="lux-mirror-image" />
            )}
          </div>
          <div className="lux-actions">
            <button className="secondary" type="button">Adjust Fit</button>
            <button className="secondary" type="button">Save Look</button>
          </div>
        </article>
      </div>
    </section>
  );
}
