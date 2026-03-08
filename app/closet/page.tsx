"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { localStore } from "@/lib/localStore";
import { addClosetItem, loadCloset, markClosetItemWorn } from "@/lib/persistence";
import { AppSettings, ClosetItem } from "@/types/models";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function ClosetPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [viewMode, setViewMode] = useState<"wardrobe" | "list">("wardrobe");
  const [form, setForm] = useState({
    category: "top" as ClosetItem["category"],
    name: "",
    color: "",
    brand: "",
    tags: "",
    imageUrl: ""
  });
  const [uploadPreview, setUploadPreview] = useState("");
  const [normalizing, setNormalizing] = useState(false);
  const [normalizeNote, setNormalizeNote] = useState("");
  const [status, setStatus] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    preferredVendors: [],
    personaNotes: "",
    assistantName: "Meera",
    showOverlayRecommendations: true,
    authMethod: "passcode",
    passcode: "1234"
  });
  const [vendorsText, setVendorsText] = useState("");

  useEffect(() => {
    waitForAuthInit().then(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserId(user.id);
      const loaded = await loadCloset(user.id);
      setItems(loaded);
      const loadedSettings = localStore.getAppSettings(user.id);
      if (loadedSettings) {
        setSettings(loadedSettings);
        setVendorsText(loadedSettings.preferredVendors.join(", "));
      }
    });
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const section = new URLSearchParams(window.location.search).get("section");
    if (section === "view") {
      setViewMode("wardrobe");
      setTimeout(() => {
        document.getElementById("closet-view-block")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
      return;
    }
    if (section === "add") {
      setTimeout(() => {
        document.getElementById("closet-add-block")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("");
    if (!userId) {
      setStatus("Session not ready yet. Please wait 2 seconds and try again.");
      return;
    }

    const payload: ClosetItem = {
      id: uid(),
      category: form.category,
      name: form.name.trim() || `${form.category} item`,
      color: form.color.trim() || "not set",
      brand: form.brand || undefined,
      imageUrl: form.imageUrl || undefined,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      createdAt: Date.now()
    };

    await addClosetItem(userId, payload);
    setItems((prev) => [payload, ...prev]);
    setForm((f) => ({ ...f, name: "", color: "", brand: "", tags: "", imageUrl: "" }));
    setUploadPreview("");
    setStatus("Added to your wardrobe.");
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image."));
      reader.readAsDataURL(file);
    });
  }

  async function normalizeGarmentImage(source: string): Promise<string> {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Invalid image file."));
      img.src = source;
    });

    const canvas = document.createElement("canvas");
    canvas.width = 760;
    canvas.height = 980;
    const ctx = canvas.getContext("2d");
    if (!ctx) return source;

    ctx.fillStyle = "#fffaf4";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const topGlow = ctx.createRadialGradient(canvas.width * 0.2, 90, 10, canvas.width * 0.2, 90, 280);
    topGlow.addColorStop(0, "rgba(255,245,229,0.9)");
    topGlow.addColorStop(1, "rgba(255,245,229,0)");
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, canvas.width, 320);

    const maxW = canvas.width * 0.82;
    const maxH = canvas.height * 0.76;
    const ratio = Math.min(maxW / image.width, maxH / image.height);
    const drawW = image.width * ratio;
    const drawH = image.height * ratio;
    const x = (canvas.width - drawW) / 2;
    const y = canvas.height * 0.12;

    // Subtle floor shadow to mimic hanger/product shoot consistency.
    ctx.beginPath();
    ctx.ellipse(canvas.width / 2, y + drawH + 26, drawW * 0.34, 16, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(58,40,20,0.14)";
    ctx.fill();

    ctx.filter = "contrast(1.08) saturate(1.04) brightness(1.03)";
    ctx.drawImage(image, x, y, drawW, drawH);
    ctx.filter = "none";

    return canvas.toDataURL("image/jpeg", 0.86);
  }

  async function onImageUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setNormalizing(true);
    setNormalizeNote("");
    try {
      const source = await fileToDataUrl(file);
      let processed = source;

      const aiRes = await fetch("/api/garment-normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: source })
      });
      const aiData = (await aiRes.json()) as { processedImageDataUrl?: string; provider?: string; note?: string };
      if (aiData.processedImageDataUrl) processed = aiData.processedImageDataUrl;
      if (aiData.provider === "removebg") {
        setNormalizeNote("Studio mode: AI background cleanup applied.");
      } else if (aiData.note) {
        setNormalizeNote(aiData.note);
      }

      const normalized = await normalizeGarmentImage(processed);
      setForm((f) => ({ ...f, imageUrl: normalized }));
      setUploadPreview(normalized);
    } finally {
      setNormalizing(false);
    }
  }

  async function markWorn(itemId: string) {
    if (!userId) return;
    await markClosetItemWorn(userId, itemId);
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              lastWornAt: Date.now(),
              wearCount: (item.wearCount ?? 0) + 1
            }
          : item
      )
    );
  }

  return (
    <section className="grid cols-2 phone-grid">
      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button type="button" className="secondary" onClick={() => setSettingsOpen((v) => !v)}>👤 Account</button>
        <button type="button" className="secondary" onClick={() => router.push("/stylist")}>🤖 Assistant</button>
      </div>
      {settingsOpen ? (
        <article className="card phone-card" style={{ gridColumn: "1 / -1" }}>
          <h3>Settings</h3>
          <div className="grid cols-2">
            <label>
              Preferred vendors (comma separated)
              <input value={vendorsText} onChange={(e) => setVendorsText(e.target.value)} />
            </label>
            <label>
              Assistant name
              <input value={settings.assistantName} onChange={(e) => setSettings((s) => ({ ...s, assistantName: e.target.value }))} />
            </label>
            <label>
              Persona notes
              <textarea value={settings.personaNotes} rows={3} onChange={(e) => setSettings((s) => ({ ...s, personaNotes: e.target.value }))} />
            </label>
            <label>
              Recommendation mode
              <select
                value={settings.showOverlayRecommendations ? "overlay" : "clothes"}
                onChange={(e) => setSettings((s) => ({ ...s, showOverlayRecommendations: e.target.value === "overlay" }))}
              >
                <option value="overlay">Overlay on user</option>
                <option value="clothes">Only clothes</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!userId) return;
              const next = { ...settings, preferredVendors: vendorsText.split(",").map((x) => x.trim()).filter(Boolean) };
              setSettings(next);
              localStore.setAppSettings(userId, next);
              setStatus("Settings saved.");
            }}
          >
            Save Settings
          </button>
        </article>
      ) : null}
      <article className="card phone-card" id="closet-add-block">
        <h2>Add Closet Item</h2>
        <form onSubmit={onSubmit}>
          <label>
            Category
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ClosetItem["category"] }))}>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
              <option value="dress">Dress</option>
              <option value="outerwear">Outerwear</option>
              <option value="shoes">Shoes</option>
              <option value="sandal">Sandal</option>
              <option value="accessory">Accessory</option>
            </select>
          </label>
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Optional. Auto-filled if empty." />
          </label>
          <label>
            Color
            <input value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} placeholder="Optional. Auto-filled if empty." />
          </label>
          <label>
            Brand
            <input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
          </label>
          <label>
            Tags (comma separated)
            <input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
          </label>
          <label>
            Image URL (optional)
            <input value={form.imageUrl} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))} />
          </label>
          <label>
            Upload Garment Photo (auto organized in wardrobe shelves)
            <input type="file" accept="image/*" onChange={onImageUpload} />
          </label>
          {normalizing ? <p className="small">Normalizing image for clean wardrobe layout...</p> : null}
          {normalizeNote ? <p className="small">{normalizeNote}</p> : null}
          {uploadPreview ? (
            <div style={{ border: "1px solid #e5d4bf", borderRadius: 10, padding: 8, marginBottom: 10 }}>
              <p className="small" style={{ marginTop: 0 }}>Normalized preview</p>
              <img src={uploadPreview} alt="Normalized garment preview" style={{ width: "100%", borderRadius: 8 }} />
            </div>
          ) : null}
          <button type="submit">Add Item</button>
          <button type="button" className="secondary" style={{ marginLeft: 8 }} onClick={() => router.push("/occasion")}>
            Skip for Now
          </button>
        </form>
        {status ? <p className="small">{status}</p> : null}
      </article>

      <article className="card phone-card" id="closet-view-block">
        <h2>Your Closet ({items.length})</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button type="button" className={viewMode === "wardrobe" ? "" : "secondary"} onClick={() => setViewMode("wardrobe")}>
            Wardrobe View
          </button>
          <button type="button" className={viewMode === "list" ? "" : "secondary"} onClick={() => setViewMode("list")}>
            List View
          </button>
        </div>
        <div className={viewMode === "wardrobe" ? "wardrobe-grid" : "grid"}>
          {items.map((item) => (
            <div key={item.id} className={viewMode === "wardrobe" ? "wardrobe-card" : ""} style={{ border: "1px solid #e7d4be", borderRadius: 12, padding: 12 }}>
              {viewMode === "wardrobe" ? (
                <div className="wardrobe-photo-wrap">
                  <div className="wardrobe-shelf-top" />
                  <div className="wardrobe-side left" />
                  <div className="wardrobe-side right" />
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="wardrobe-photo" />
                  ) : (
                    <div className="wardrobe-placeholder small">No image uploaded</div>
                  )}
                  <div className="wardrobe-shelf-bottom" />
                </div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{item.name}</strong>
                <span className="badge">{item.category}</span>
              </div>
              <p className="small" style={{ marginBottom: 6 }}>{item.color}{item.brand ? ` · ${item.brand}` : ""}</p>
              <p className="small">{item.tags.join(", ") || "No tags"}</p>
              <p className="small" style={{ marginBottom: 8 }}>
                {item.lastWornAt
                  ? `Last worn: ${new Date(item.lastWornAt).toLocaleDateString()} · Worn ${item.wearCount ?? 1} times`
                  : "Not marked worn yet"}
              </p>
              <button type="button" className="secondary" onClick={() => markWorn(item.id)}>
                Mark as Worn Today
              </button>
            </div>
          ))}
          {!items.length ? <p className="small">No items yet.</p> : null}
        </div>
      </article>
    </section>
  );
}
