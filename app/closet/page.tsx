"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { enrollBiometric, verifyBiometric } from "@/lib/biometric";
import { localStore } from "@/lib/localStore";
import { addClosetItem, loadCloset, markClosetItemWorn } from "@/lib/persistence";
import { hasActiveSubscription, loadBilling } from "@/lib/subscription";
import { AppSettings, ClosetItem } from "@/types/models";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function closetKey(item: Pick<ClosetItem, "category" | "name" | "imageUrl">) {
  return `${item.category}|${(item.name || "").trim().toLowerCase()}|${(item.imageUrl || "").trim()}`;
}

const ASSISTANT_IDLE_MS = 60 * 1000;

const CATEGORY_ORDER: ClosetItem["category"][] = [
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "sandal",
  "accessory"
];

const CATEGORY_LABEL: Record<ClosetItem["category"], string> = {
  top: "Tops",
  bottom: "Bottoms",
  dress: "Dresses",
  outerwear: "Outerwear",
  shoes: "Shoes",
  sandal: "Sandals",
  accessory: "Accessories"
};

export default function ClosetPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [pageMode, setPageMode] = useState<"view" | "add">("view");
  const [form, setForm] = useState({
    category: "top" as ClosetItem["category"],
    name: "",
    color: "",
    tags: "",
    imageUrl: ""
  });
  const [uploadPreview, setUploadPreview] = useState("");
  const [normalizing, setNormalizing] = useState(false);
  const [normalizeNote, setNormalizeNote] = useState("");
  const [status, setStatus] = useState("");
  const [settings, setSettings] = useState<AppSettings>({
    preferredVendors: [],
    personaNotes: "",
    assistantName: "MirrorMe",
    showOverlayRecommendations: true,
    authMethod: "passcode",
    passcode: "",
    authConfigured: false,
    authTimeoutMinutes: 45,
    biometricSetup: false
  });

  const [closetPasscode, setClosetPasscode] = useState("");
  const [setupPasscode, setSetupPasscode] = useState("");
  const [setupPasscodeConfirm, setSetupPasscodeConfirm] = useState("");
  const [bioBusy, setBioBusy] = useState(false);
  const [wardrobeUnlocked, setWardrobeUnlocked] = useState(false);
  const [doorOpening, setDoorOpening] = useState(false);
  const [assistantPromptOpen, setAssistantPromptOpen] = useState(false);
  const [assistantMessage, setAssistantMessage] = useState("");
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantChat, setAssistantChat] = useState<Array<{ role: "assistant" | "user"; content: string }>>([]);
  const idleTimerRef = useRef<number | null>(null);

  const grouped = useMemo(() => {
    const map: Record<ClosetItem["category"], ClosetItem[]> = {
      top: [],
      bottom: [],
      dress: [],
      outerwear: [],
      shoes: [],
      sandal: [],
      accessory: []
    };
    for (const item of items) {
      map[item.category].push(item);
    }
    return map;
  }, [items]);

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    utter.pitch = 1.08;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  function touchActivity() {
    if (!wardrobeUnlocked || pageMode !== "view") return;
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setAssistantPromptOpen(true);
      setAssistantMessage("I can see you are taking time choosing. Do you want me to pick a look for you?");
      speak("Need help choosing? I can pick a look for you.");
    }, ASSISTANT_IDLE_MS);
  }

  function pickAssistantOutfit() {
    const sortedByNotWorn = [...items].sort((a, b) => {
      const aw = a.lastWornAt || 0;
      const bw = b.lastWornAt || 0;
      return aw - bw;
    });

    const top = sortedByNotWorn.find((x) => x.category === "top");
    const bottom = sortedByNotWorn.find((x) => x.category === "bottom");
    const dress = sortedByNotWorn.find((x) => x.category === "dress");
    const shoes = sortedByNotWorn.find((x) => x.category === "shoes" || x.category === "sandal");
    const accessory = sortedByNotWorn.find((x) => x.category === "accessory");

    let sentence = "I suggest this look for you: ";
    if (dress) {
      sentence += `${dress.name}`;
    } else {
      sentence += `${top?.name || "a clean top"} with ${bottom?.name || "well-fitted bottoms"}`;
    }
    if (shoes) sentence += `, with ${shoes.name}`;
    if (accessory) sentence += ` and ${accessory.name}`;
    sentence += ". This will look great for your occasion.";

    setAssistantMessage(sentence);
    setAssistantChat((prev) => [...prev, { role: "assistant", content: sentence }]);
    setAssistantPromptOpen(false);
    setStatus(sentence);
    speak(sentence);
  }

  function suggestFromCloset() {
    const sortedByNotWorn = [...items].sort((a, b) => (a.lastWornAt || 0) - (b.lastWornAt || 0));
    const top = sortedByNotWorn.find((x) => x.category === "top");
    const bottom = sortedByNotWorn.find((x) => x.category === "bottom");
    const dress = sortedByNotWorn.find((x) => x.category === "dress");
    const shoes = sortedByNotWorn.find((x) => x.category === "shoes" || x.category === "sandal");
    if (dress) return `${dress.name}${shoes ? ` with ${shoes.name}` : ""}`;
    if (top || bottom) return `${top?.name || "a clean top"} with ${bottom?.name || "well-fitted bottoms"}${shoes ? ` and ${shoes.name}` : ""}`;
    return "";
  }

  function assistantReply(userText: string) {
    const text = userText.toLowerCase();
    const occasion = userId ? localStore.getOccasion(userId) || "casual" : "casual";
    const look = suggestFromCloset();
    if (!items.length) {
      return "Your closet is still empty. Upload a few pieces and I will build a full look for your occasion.";
    }
    if (text.includes("choose") || text.includes("pick") || text.includes("suggest") || text.includes("what should")) {
      return look
        ? `For your ${occasion} plan, I recommend ${look}. This fits your vibe better than repeating a recently worn look.`
        : `For your ${occasion} plan, share what you want to wear and I will give you honest advice.`;
    }
    if (text.includes("again") || text.includes("repeat") || text.includes("same")) {
      return "You can repeat if needed, but a fresher option will look better. I can pick a less recently worn piece now.";
    }
    if (text.includes("color")) {
      return "Keep one anchor color and one contrast piece. I can suggest exact items from your closet if you ask me to pick now.";
    }
    return "I am here with you in the wardrobe. Ask me to pick a full look, or tell me what you are planning to wear and I will be brutally honest.";
  }

  function sendAssistantMessage() {
    const text = assistantInput.trim();
    if (!text) return;
    const userMsg = { role: "user" as const, content: text };
    const reply = assistantReply(text);
    setAssistantChat((prev) => [...prev, userMsg, { role: "assistant", content: reply }]);
    setAssistantInput("");
    setAssistantMessage(reply);
    speak(reply);
    touchActivity();
  }

  useEffect(() => {
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
      setUserId(user.id);
      const loaded = await loadCloset(user.id);
      setItems(loaded);
      const loadedSettings = localStore.getAppSettings(user.id);
      if (loadedSettings) {
        setSettings(loadedSettings);
      }

      const authKey = `fashion_closet_unlock_at:${user.id}`;
      const lastUnlock = Number(localStorage.getItem(authKey) || "0");
      const ttlMs = (loadedSettings?.authTimeoutMinutes || 45) * 60 * 1000;
      if (lastUnlock && Date.now() - lastUnlock < ttlMs) {
        setWardrobeUnlocked(true);
      }
      if (loadedSettings?.authConfigured) {
        setAssistantChat([
          {
            role: "assistant",
            content: `Hey, I am ${loadedSettings.assistantName || "MirrorMe"}. I am ready to guide you inside your wardrobe.`
          }
        ]);
      }
      if (typeof window !== "undefined") {
        const section = new URLSearchParams(window.location.search).get("section");
        setPageMode(section === "add" ? "add" : "view");
      }
    });
  }, [router]);

  useEffect(() => {
    if (!wardrobeUnlocked) return;
    touchActivity();
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardrobeUnlocked, pageMode, items.length]);

  async function unlockWardrobe() {
    if (!userId) return;
    if (!settings.authConfigured) {
      setStatus("Set up authentication below first, then open wardrobe.");
      return;
    }

    if (settings.authMethod === "passcode") {
      if (!settings.passcode || settings.passcode !== closetPasscode.trim()) {
        setStatus("Incorrect passcode. Please try again.");
        return;
      }
    } else {
      const result = await verifyBiometric(`fashion_bio_cred:${userId}`);
      if (!result.ok) {
        setStatus(result.error || "Biometric verification failed.");
        return;
      }
    }
    setStatus("");
    setDoorOpening(true);
    setTimeout(() => {
      setWardrobeUnlocked(true);
      setDoorOpening(false);
      localStorage.setItem(`fashion_closet_unlock_at:${userId}`, String(Date.now()));
      setAssistantMessage(`Hey, I am ${settings.assistantName || "MirrorMe"}. I am here to guide your wardrobe choices.`);
      speak(`Welcome. I am ${settings.assistantName || "MirrorMe"}. I can help you choose faster.`);
      touchActivity();
    }, 900);
  }

  async function setupBiometric() {
    if (!userId) return;
    setBioBusy(true);
    const result = await enrollBiometric(`fashion_bio_cred:${userId}`, "MirrorMe Wardrobe");
    setBioBusy(false);
    if (!result.ok) {
      setStatus(result.error || "Biometric setup failed.");
      return;
    }
    const next = { ...settings, biometricSetup: true, authConfigured: true };
    setSettings(next);
    localStore.setAppSettings(userId, next);
    setStatus("Biometric authentication is set.");
  }

  function saveClosetAuthSetup() {
    if (!userId) return;
    if (settings.authMethod === "passcode") {
      if (setupPasscode.trim().length < 4) {
        setStatus("Passcode should be at least 4 digits.");
        return;
      }
      if (setupPasscode !== setupPasscodeConfirm) {
        setStatus("Passcode confirmation does not match.");
        return;
      }
      const next = {
        ...settings,
        passcode: setupPasscode.trim(),
        authConfigured: true,
        biometricSetup: false
      };
      setSettings(next);
      localStore.setAppSettings(userId, next);
      setSetupPasscode("");
      setSetupPasscodeConfirm("");
      setStatus("Passcode setup complete.");
      return;
    }
    if (!settings.biometricSetup) {
      setStatus(`Please complete ${settings.authMethod} setup first.`);
      return;
    }
    const next = { ...settings, authConfigured: true };
    setSettings(next);
    localStore.setAppSettings(userId, next);
    setStatus(`${settings.authMethod} setup complete.`);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    touchActivity();
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
      imageUrl: form.imageUrl || undefined,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      createdAt: Date.now()
    };

    const duplicate = items.find((x) => closetKey(x) === closetKey(payload));
    if (duplicate) {
      setStatus("This exact item already exists in your wardrobe.");
      return;
    }

    await addClosetItem(userId, payload);
    setItems((prev) => [payload, ...prev]);
    setForm((f) => ({ ...f, name: "", color: "", tags: "", imageUrl: "" }));
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
    touchActivity();
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
    touchActivity();
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

  if (!wardrobeUnlocked) {
    return (
      <section className="grid phone-grid">
        <article className="card phone-card">
          <h2>My Wardrobe</h2>
          <p className="small">Authenticate to open your magic wardrobe door.</p>
          <div className={doorOpening ? "virtual-room single-door doors-open" : "virtual-room single-door"} style={{ marginBottom: 12 }}>
            <div className="door glass" />
            <div className="room-content">
              <p className="door-message">Your wardrobe is secured. Enter passcode to open.</p>
            </div>
          </div>
          {!settings.authConfigured ? (
            <div className="grid" style={{ marginBottom: 12 }}>
              <label>
                Auth method
                <select
                  value={settings.authMethod}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      authMethod: e.target.value as AppSettings["authMethod"],
                      authConfigured: false
                    }))
                  }
                >
                  <option value="passcode">Passcode</option>
                  <option value="fingerprint">Fingerprint</option>
                  <option value="face">Face unlock</option>
                </select>
              </label>
              {settings.authMethod === "passcode" ? (
                <>
                  <label>
                    Create passcode
                    <input value={setupPasscode} onChange={(e) => setSetupPasscode(e.target.value)} placeholder="Minimum 4 digits" />
                  </label>
                  <label>
                    Confirm passcode
                    <input value={setupPasscodeConfirm} onChange={(e) => setSetupPasscodeConfirm(e.target.value)} placeholder="Re-enter passcode" />
                  </label>
                </>
              ) : (
                <button type="button" className="secondary" onClick={setupBiometric} disabled={bioBusy}>
                  {bioBusy ? "Setting up..." : `Set Up ${settings.authMethod}`}
                </button>
              )}
              <button type="button" onClick={saveClosetAuthSetup}>Save Authentication Setup</button>
            </div>
          ) : null}
          {settings.authMethod === "passcode" ? (
            <label>
              Wardrobe passcode
              <input value={closetPasscode} onChange={(e) => setClosetPasscode(e.target.value)} placeholder="Enter passcode" />
            </label>
          ) : (
            <p className="small">Method: {settings.authMethod}. Click open to verify with device biometric.</p>
          )}
          <button type="button" onClick={unlockWardrobe}>Open My Wardrobe</button>
          {status ? <p className="small">{status}</p> : null}
        </article>
      </section>
    );
  }

  return (
    <section className="grid phone-grid" onMouseMove={touchActivity} onClick={touchActivity} onKeyDown={touchActivity}>
      {assistantPromptOpen && pageMode === "view" ? (
        <article className="card phone-card">
          <h3>{settings.assistantName || "MirrorMe"} Assistant</h3>
          <p>{assistantMessage}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={pickAssistantOutfit}>Yes, choose for me</button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setAssistantPromptOpen(false);
                setAssistantMessage("No problem, take your time.");
                touchActivity();
              }}
            >
              No, I will choose
            </button>
          </div>
        </article>
      ) : null}

      {pageMode === "view" ? (
        <>
          <article className="card phone-card" id="closet-view-block">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Choose Your Outfit</h2>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setPageMode("add");
                  router.push("/closet?section=add");
                }}
              >
                Add Closet
              </button>
            </div>

            <div className="grid" style={{ gap: 10 }}>
              {CATEGORY_ORDER.map((cat) => (
                <div key={cat} style={{ border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: 10, background: "rgba(255,255,255,0.04)" }}>
                  <strong style={{ display: "inline-block", marginBottom: 8 }}>{CATEGORY_LABEL[cat]}</strong>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
                    {grouped[cat].slice(0, 3).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="secondary"
                        style={{ borderRadius: 10, padding: 6, textAlign: "left", minHeight: 96 }}
                        onClick={() => void markWorn(item.id)}
                      >
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.name} style={{ width: "100%", borderRadius: 8, height: 72, objectFit: "cover" }} />
                        ) : (
                          <div className="wardrobe-placeholder small" style={{ minHeight: 72 }}>No image</div>
                        )}
                      </button>
                    ))}
                    {!grouped[cat].length ? <div className="small">No items</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="card phone-card">
            <h3>{settings.assistantName || "MirrorMe"} Assistant</h3>
            <div style={{ display: "grid", gap: 8, maxHeight: 220, overflow: "auto", marginBottom: 10 }}>
              {assistantChat.map((msg, idx) => (
                <div
                  key={`${msg.role}-${idx}`}
                  style={{
                    justifySelf: msg.role === "user" ? "end" : "start",
                    maxWidth: "86%",
                    borderRadius: 12,
                    padding: "8px 10px",
                    background: msg.role === "user" ? "linear-gradient(135deg,var(--brand),var(--brand-2))" : "rgba(255,255,255,0.08)",
                    color: msg.role === "user" ? "#1b130d" : "#eef2fa"
                  }}
                >
                  {msg.content}
                </div>
              ))}
              {!assistantChat.length ? <p className="small">Ask me to pick a look and I will guide you live.</p> : null}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={assistantInput}
                onChange={(e) => setAssistantInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendAssistantMessage();
                  }
                }}
                placeholder="Ask your stylist: what should I wear?"
              />
              <button type="button" onClick={sendAssistantMessage}>Send</button>
              <button type="button" className="secondary" onClick={pickAssistantOutfit}>Pick for me</button>
            </div>
          </article>
        </>
      ) : (
        <article className="card phone-card" id="closet-add-block">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0 }}>Add Closet Item</h2>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setPageMode("view");
                router.push("/closet?section=view");
              }}
            >
              My Closet
            </button>
          </div>
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
              Label (shirt, top, pant, etc.)
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Example: White Shirt" />
            </label>
            <label>
              Color
              <input value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} placeholder="Optional" />
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
              Upload Garment Photo
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
          </form>
          {status ? <p className="small">{status}</p> : null}
        </article>
      )}
    </section>
  );
}
