"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { waitForAuthInit } from "@/lib/auth";
import { localStore } from "@/lib/localStore";

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
  const [personImageUrl, setPersonImageUrl] = useState("");
  const [garmentImageUrl, setGarmentImageUrl] = useState("");
  const [personPreview, setPersonPreview] = useState("");
  const [garmentPreview, setGarmentPreview] = useState("");

  const [resultUrl, setResultUrl] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [extraGarmentUrls, setExtraGarmentUrls] = useState("");
  const [presetGarments, setPresetGarments] = useState<string[]>([]);
  const [garmentType, setGarmentType] = useState<GarmentType>("auto");

  const personImage = useMemo(() => personPreview || personImageUrl, [personPreview, personImageUrl]);
  const garmentImage = useMemo(() => garmentPreview || garmentImageUrl, [garmentPreview, garmentImageUrl]);

  useEffect(() => {
    waitForAuthInit().then((user) => {
      if (!user) return;
      const preset = localStore.getTryOnPreset(user.id);
      if (!preset) return;
      if (preset.personImage && !personImageUrl) setPersonImageUrl(preset.personImage);
      if (preset.garmentImages.length) {
        setGarmentImageUrl(preset.garmentImages[0]);
        setPresetGarments(preset.garmentImages.slice(1));
      }
      localStore.clearTryOnPreset(user.id);
    });
  }, [personImageUrl]);

  async function compressImage(file: File, maxSide = 1024, quality = 0.75): Promise<File> {
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
    for (let attempt = 0; attempt < 90; attempt += 1) {
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
      await sleep(1400);
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
    const res = await fetch("/api/tryon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personImage: personPayload,
        garmentImage: garmentPayload,
        garmentType: stepType,
        awaitResult: false
      })
    });

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
    if (!personImage || !garmentImage) {
      setStatus("Please provide both user photo and garment photo.");
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Try-on failed during upload or generation.";
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="grid cols-2">
      <article className="card">
        <h1>Virtual Try-On</h1>
        <p className="small">
          Upload person photo + garment photo. Job runs asynchronously and updates when the model completes.
        </p>

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
            User photo upload
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onFileChange(e, setPersonPreview, setPersonImageUrl)}
            />
          </label>
          <label>
            User photo URL (optional alternative)
            <input
              value={personImageUrl}
              onChange={(e) => {
                setPersonImageUrl(e.target.value);
                if (e.target.value) {
                  setPersonPreview("");
                }
              }}
            />
          </label>
          <label>
            Garment photo upload
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onFileChange(e, setGarmentPreview, setGarmentImageUrl)}
            />
          </label>
          <label>
            Garment photo URL (optional alternative)
            <input
              value={garmentImageUrl}
              onChange={(e) => {
                setGarmentImageUrl(e.target.value);
                if (e.target.value) {
                  setGarmentPreview("");
                }
              }}
            />
          </label>
          <label>
            Additional garment URLs (shirt, pants, saree, blouse...) one per line
            <textarea
              rows={3}
              value={extraGarmentUrls}
              onChange={(e) => setExtraGarmentUrls(e.target.value)}
              placeholder="https://...shirt.jpg&#10;https://...pants.jpg"
            />
          </label>
          {presetGarments.length ? <p className="small">Preset pieces from stylist page: {presetGarments.length}</p> : null}
          <button type="submit" disabled={loading}>{loading ? "Working..." : "Generate Try-On"}</button>
        </form>

        {status ? <p className="small">{status}</p> : null}
        <p className="small">Both upload and URL inputs are supported. Uploaded files are sent directly for try-on.</p>
      </article>

      <article className="card" style={{ gridColumn: "1 / -1" }}>
        <h2>Output</h2>
        {!resultUrl ? <p className="small">No output yet.</p> : <img src={resultUrl} alt="Try-on result" style={{ width: "100%", borderRadius: 12 }} />}
      </article>
    </section>
  );
}
