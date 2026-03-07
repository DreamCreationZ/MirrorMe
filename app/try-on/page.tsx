"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { waitForAuthInit } from "@/lib/auth";
import { storage } from "@/lib/firebase";

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type TryOnJob = {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
};

export default function TryOnPage() {
  const [personImageUrl, setPersonImageUrl] = useState("");
  const [garmentImageUrl, setGarmentImageUrl] = useState("");
  const [personPreview, setPersonPreview] = useState("");
  const [garmentPreview, setGarmentPreview] = useState("");
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [garmentFile, setGarmentFile] = useState<File | null>(null);

  const [resultUrl, setResultUrl] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [useUrlOnlyMode, setUseUrlOnlyMode] = useState(true);

  const personImage = useMemo(() => personPreview || personImageUrl, [personPreview, personImageUrl]);
  const garmentImage = useMemo(() => garmentPreview || garmentImageUrl, [garmentPreview, garmentImageUrl]);

  async function compressImage(file: File, maxSide = 1280, quality = 0.82): Promise<File> {
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
    setFile: (file: File | null) => void,
    setPreview: (value: string) => void,
    setUrl: (value: string) => void
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFile(file);
    setPreview(await fileToDataUrl(file));
    setUrl("");
  }

  async function uploadForTryOn(file: File, type: "person" | "garment") {
    if (!storage) {
      throw new Error("Firebase Storage is not configured. Add NEXT_PUBLIC_FIREBASE_* values.");
    }

    const user = await waitForAuthInit();
    if (!user?.id) {
      throw new Error("Please log in before virtual try-on so images can be uploaded securely.");
    }
    const owner = user.id;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `tryon/${owner}/${Date.now()}-${type}-${makeId()}.${ext}`;
    const fileRef = ref(storage, path);

    const uploadPromise = (async () => {
      await uploadBytes(fileRef, file, { contentType: file.type || "image/jpeg" });
      return getDownloadURL(fileRef);
    })();

    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error("Image upload timed out. Use URL-only mode to continue testing.")), 30000);
    });

    return Promise.race([uploadPromise, timeoutPromise]);
  }

  async function pollTryOn(job: TryOnJob, personPayload: string, garmentPayload: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const params = new URLSearchParams({
        requestId: job.requestId,
        responseUrl: job.responseUrl,
        personImage: personPayload,
        garmentImage: garmentPayload
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
        setResultUrl(pollData.resultUrl);
        setStatus("Done. Realistic overlay generated.");
        return;
      }

      if (String(pollData.state || "").toLowerCase() === "completed") {
        throw new Error("Try-on job completed but no image URL was returned. Please retry once.");
      }

      if (pollData.state === "failed") {
        throw new Error(pollData.error || "Virtual try-on failed.");
      }

      setStatus(`Try-on ${pollData.state || "running"}... ${pollData.status ? `(${pollData.status})` : ""}`);
      await sleep(2500);
    }

    throw new Error("Try-on is still processing. Please retry in a minute.");
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

      const hasDirectUrls = Boolean(personImageUrl.trim() && garmentImageUrl.trim());

      if (useUrlOnlyMode || hasDirectUrls) {
        personPayload = personImageUrl.trim() || personPayload;
        garmentPayload = garmentImageUrl.trim() || garmentPayload;
      } else {
        if (!(personFile && garmentFile)) {
          throw new Error("Please upload both images or provide both URLs.");
        }

        setStatus("Optimizing images for faster try-on...");
        const compressedPerson = await compressImage(personFile);
        const compressedGarment = await compressImage(garmentFile);

        setStatus("Uploading images...");
        const [personUploaded, garmentUploaded] = await Promise.all([
          uploadForTryOn(compressedPerson, "person"),
          uploadForTryOn(compressedGarment, "garment")
        ]);

        personPayload = personUploaded;
        garmentPayload = garmentUploaded;
      }

      setStatus("Submitting virtual try-on job...");

      const res = await fetch("/api/tryon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personImage: personPayload, garmentImage: garmentPayload, awaitResult: false })
      });

      const data = (await res.json()) as {
        state?: string;
        requestId?: string;
        statusUrl?: string;
        responseUrl?: string;
        resultUrl?: string;
        error?: string;
        note?: string;
      };

      if (data.resultUrl) {
        setResultUrl(data.resultUrl);
        setStatus(data.note || "Done. Realistic overlay generated.");
        return;
      }

      if (!data.requestId || !data.responseUrl) {
        throw new Error(data.error || "Try-on job could not be created.");
      }

      setStatus("Job submitted. Waiting for model output...");
      await pollTryOn(
        {
          requestId: data.requestId,
          statusUrl: data.statusUrl || "",
          responseUrl: data.responseUrl
        },
        personPayload,
        garmentPayload
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Try-on failed during upload or generation.";
      if (message.includes("storage/retry-limit-exceeded")) {
        setStatus(
          "Image upload timed out. Check Firebase Storage bucket/rules and internet, then retry with smaller images."
        );
      } else {
        setStatus(message);
      }
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
            Try-on mode
            <select
              value={useUrlOnlyMode ? "url" : "upload"}
              onChange={(e) => setUseUrlOnlyMode(e.target.value === "url")}
            >
              <option value="url">URL only (recommended for now)</option>
              <option value="upload">Upload files via Firebase Storage</option>
            </select>
          </label>

          <label>
            User photo upload
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onFileChange(e, setPersonFile, setPersonPreview, setPersonImageUrl)}
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
                  setPersonFile(null);
                }
              }}
            />
          </label>
          <label>
            Garment photo upload
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onFileChange(e, setGarmentFile, setGarmentPreview, setGarmentImageUrl)}
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
                  setGarmentFile(null);
                }
              }}
            />
          </label>
          <button type="submit" disabled={loading}>{loading ? "Working..." : "Generate Try-On"}</button>
        </form>

        {status ? <p className="small">{status}</p> : null}
        {useUrlOnlyMode ? <p className="small">Using direct image URLs skips Firebase upload delays.</p> : null}
      </article>

      <article className="card">
        <h2>Inputs</h2>
        <div className="grid cols-2">
          <div>
            <p className="small">User photo</p>
            {personImage ? <img src={personImage} alt="User input" style={{ width: "100%", borderRadius: 12 }} /> : <p className="small">None</p>}
          </div>
          <div>
            <p className="small">Garment photo</p>
            {garmentImage ? <img src={garmentImage} alt="Garment input" style={{ width: "100%", borderRadius: 12 }} /> : <p className="small">None</p>}
          </div>
        </div>
      </article>

      <article className="card" style={{ gridColumn: "1 / -1" }}>
        <h2>Output</h2>
        {!resultUrl ? <p className="small">No output yet.</p> : <img src={resultUrl} alt="Try-on result" style={{ width: "100%", borderRadius: 12 }} />}
      </article>
    </section>
  );
}
