"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { localStore } from "@/lib/localStore";
import { loadCloset, loadProfile } from "@/lib/persistence";
import {
  ClosetItem,
  SavedLook,
  SessionFeedback,
  StylistConfig,
  StylistMessage,
  StylistRecommendation,
  TryOnPreset,
  UserProfile
} from "@/types/models";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function introMessage(name: string): StylistMessage {
  return {
    role: "assistant",
    content: `Hi, I am ${name}, your personal AI stylist. I can be brutally honest and practical. If you want to rename me, set any name you like and I will use it.`,
    recommendation: {
      verdict: "GOOD",
      confidence: 78,
      whyThisWorks: [
        "I use your profile and occasion to personalize suggestions.",
        "I explain clearly why an outfit works or fails."
      ],
      alternatives: ["Share one outfit idea and I will start styling."],
      timeSavingTip: "Use Talk mode when you want quick voice interaction."
    }
  };
}

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecCtor = new () => SpeechRec;

export default function StylistPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [closet, setCloset] = useState<ClosetItem[]>([]);
  const [occasion, setOccasion] = useState("casual");

  const [stylistName, setStylistName] = useState("Meera");
  const [renameInput, setRenameInput] = useState("Meera");
  const [mode, setMode] = useState<"chat" | "talk">("chat");
  const [preferredLanguage, setPreferredLanguage] = useState("auto");
  const [listening, setListening] = useState(false);

  const [messages, setMessages] = useState<StylistMessage[]>([introMessage("Meera")]);
  const [savedLooks, setSavedLooks] = useState<SavedLook[]>([]);

  const [input, setInput] = useState("");
  const [userPhoto, setUserPhoto] = useState("");
  const [dressPhoto, setDressPhoto] = useState("");
  const [outfitPieceUrls, setOutfitPieceUrls] = useState("");
  const [outfitPieceImages, setOutfitPieceImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [rating, setRating] = useState(4);
  const [liked, setLiked] = useState(true);
  const [comment, setComment] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("");

  const recognizerRef = useRef<SpeechRec | null>(null);

  useEffect(() => {
    waitForAuthInit().then(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      setUserId(user.id);
      setProfile(await loadProfile(user.id));
      setCloset(await loadCloset(user.id));
      setOccasion(localStore.getOccasion(user.id) || "casual");
      setSavedLooks(localStore.getSavedLooks(user.id));

      const config = localStore.getStylistConfig(user.id);
      if (config) {
        setStylistName(config.name);
        setRenameInput(config.name);
        setMode(config.mode);
        setPreferredLanguage(config.preferredLanguage || "auto");
      } else {
        const firstConfig: StylistConfig = { name: "Meera", mode: "chat", preferredLanguage: "auto", createdAt: Date.now() };
        localStore.setStylistConfig(user.id, firstConfig);
      }

      const saved = localStore.getStylistMessages(user.id);
      if (saved.length) {
        setMessages(saved);
      } else {
        const initial = [introMessage(config?.name || "Meera")];
        setMessages(initial);
        localStore.setStylistMessages(user.id, initial);
      }
    });
  }, [router]);

  useEffect(() => {
    if (mode !== "talk") {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (recognizerRef.current) {
        recognizerRef.current.stop();
        recognizerRef.current = null;
      }
      setListening(false);
    }
  }, [mode]);

  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  function persist(next: StylistMessage[]) {
    setMessages(next);
    if (userId) localStore.setStylistMessages(userId, next);
  }

  function persistConfig(next: StylistConfig) {
    if (!userId) return;
    localStore.setStylistConfig(userId, next);
  }

  function persistLooks(next: SavedLook[]) {
    setSavedLooks(next);
    if (userId) localStore.setSavedLooks(userId, next);
  }

  function speak(text: string) {
    if (mode !== "talk") return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/\n+/g, " "));
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image."));
      reader.readAsDataURL(file);
    });
  }

  async function onFileChange(e: ChangeEvent<HTMLInputElement>, setImage: (value: string) => void) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setImage(dataUrl);
  }

  async function onOutfitPiecesChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const images = await Promise.all(files.map((f) => fileToDataUrl(f)));
    setOutfitPieceImages((prev) => [...prev, ...images].slice(0, 8));
  }

  function useForFullTryOn() {
    if (!userId) return;
    const urlPieces = outfitPieceUrls
      .split(/\n|,/g)
      .map((x) => x.trim())
      .filter(Boolean);
    const allPieces = [...outfitPieceImages, ...urlPieces].slice(0, 8);
    if (!allPieces.length) return;

    const preset: TryOnPreset = {
      personImage: userPhoto || undefined,
      garmentImages: allPieces,
      createdAt: Date.now()
    };
    localStore.setTryOnPreset(userId, preset);
    router.push("/try-on");
  }

  function saveStylistName() {
    const name = renameInput.trim();
    if (!name) return;
    setStylistName(name);
    persistConfig({ name, mode, preferredLanguage, createdAt: Date.now() });

    const note: StylistMessage = {
      role: "assistant",
      content: `Done. You can call me ${name}. I will introduce myself as ${name} from now.`
    };
    persist([...messages, note]);
    speak(note.content);
  }

  function setConversationMode(nextMode: "chat" | "talk") {
    setMode(nextMode);
    persistConfig({ name: stylistName, mode: nextMode, preferredLanguage, createdAt: Date.now() });
  }

  function setLanguage(nextLanguage: string) {
    setPreferredLanguage(nextLanguage);
    persistConfig({ name: stylistName, mode, preferredLanguage: nextLanguage, createdAt: Date.now() });
  }

  function startVoiceInput() {
    if (typeof window === "undefined") return;

    const speechWindow = window as unknown as {
      SpeechRecognition?: SpeechRecCtor;
      webkitSpeechRecognition?: SpeechRecCtor;
    };

    const Ctor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Ctor) {
      alert("Voice input is not supported in this browser.");
      return;
    }

    const rec = new Ctor();
    recognizerRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    setListening(true);

    rec.onresult = (event: unknown) => {
      const ev = event as { results?: ArrayLike<ArrayLike<{ transcript: string }>> };
      const text = ev.results?.[0]?.[0]?.transcript?.trim() || "";
      if (text) setInput((prev) => (prev ? `${prev} ${text}` : text));
      setListening(false);
      rec.stop();
    };

    rec.onerror = () => {
      setListening(false);
      rec.stop();
    };

    rec.start();
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if ((!input.trim() && !userPhoto && !dressPhoto) || loading) return;

    const images = [userPhoto, dressPhoto].filter(Boolean);
    const userMessage: StylistMessage = {
      role: "user",
      content: input.trim() || "Please review these images honestly.",
      images
    };

    const next = [...messages, userMessage];
    persist(next);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/stylist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          profile,
          closet,
          occasion,
          stylistName,
          conversationMode: mode,
          preferredLanguage
        })
      });

      const data = (await res.json()) as {
        reply?: string;
        error?: string;
        recommendation?: StylistRecommendation;
      };

      const assistant: StylistMessage = {
        role: "assistant",
        content: data.reply ?? data.error ?? "Stylist is temporarily unavailable.",
        recommendation: data.recommendation
      };

      const withReply = [...next, assistant];
      persist(withReply);
      setUserPhoto("");
      setDressPhoto("");
      speak(assistant.content);
    } finally {
      setLoading(false);
    }
  }

  function clearConversation() {
    const reset = [introMessage(stylistName)];
    persist(reset);
  }

  function setMessageFeedback(index: number, value: "up" | "down") {
    const next = messages.map((m, i) => (i === index ? { ...m, feedback: value } : m));
    persist(next);
  }

  function saveLookFromMessage(index: number) {
    const assistant = messages[index];
    if (!assistant?.recommendation) return;

    let prompt = "Outfit recommendation";
    for (let i = index - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") {
        prompt = messages[i].content;
        break;
      }
    }

    const look: SavedLook = {
      id: uid(),
      occasion,
      createdAt: Date.now(),
      userPrompt: prompt,
      recommendation: assistant.recommendation
    };

    persistLooks([look, ...savedLooks]);
  }

  function markAsWorn(lookId: string) {
    const next = savedLooks.map((look) => (look.id === lookId ? { ...look, wornAt: Date.now() } : look));
    persistLooks(next);
  }

  function submitSessionFeedback(e: FormEvent) {
    e.preventDefault();
    if (!userId) return;

    const payload: SessionFeedback = {
      rating,
      liked,
      comment,
      createdAt: Date.now()
    };

    localStore.addSessionFeedback(userId, payload);
    setComment("");
    setFeedbackStatus("Thanks. Your feedback is saved.");
  }

  return (
    <section className="grid cols-2">
      <article className="card">
        <h2>{stylistName} - AI Stylist</h2>
        <p className="small">Occasion: <strong>{occasion || "casual"}</strong></p>

        <div className="grid cols-2" style={{ marginBottom: 10 }}>
          <label>
            Stylist name
            <input value={renameInput} onChange={(e) => setRenameInput(e.target.value)} placeholder="Ex: Meera, Sera" />
          </label>
          <label>
            Language
            <select value={preferredLanguage} onChange={(e) => setLanguage(e.target.value)}>
              <option value="auto">Auto (user language)</option>
              <option value="English">English</option>
              <option value="Hindi">Hindi</option>
              <option value="Marathi">Marathi</option>
              <option value="Tamil">Tamil</option>
              <option value="Telugu">Telugu</option>
              <option value="Bengali">Bengali</option>
              <option value="Gujarati">Gujarati</option>
              <option value="Kannada">Kannada</option>
              <option value="Punjabi">Punjabi</option>
              <option value="Urdu">Urdu</option>
              <option value="Spanish">Spanish</option>
              <option value="French">French</option>
              <option value="Arabic">Arabic</option>
            </select>
          </label>
          <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
            <button type="button" className="secondary" onClick={saveStylistName}>Save Name</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button type="button" className={mode === "chat" ? "" : "secondary"} onClick={() => setConversationMode("chat")}>Chat with AI Stylist</button>
          <button type="button" className={mode === "talk" ? "" : "secondary"} onClick={() => setConversationMode("talk")}>Talk with AI Stylist</button>
          {mode === "talk" ? (
            <button type="button" className="secondary" onClick={startVoiceInput} disabled={listening}>
              {listening ? "Listening..." : "Speak"}
            </button>
          ) : null}
        </div>

        <div style={{ border: "1px solid #ead8c4", borderRadius: 12, padding: 10, marginBottom: 12 }}>
          <h3 style={{ marginBottom: 8 }}>Full Outfit Overlay (Multiple Pieces)</h3>
          <p className="small" style={{ marginTop: 0 }}>
            Add shirt, pants, saree, blouse, etc. Then send to Try-On for full look layering.
          </p>
          <label>
            Upload multiple outfit pieces
            <input type="file" accept="image/*" multiple onChange={onOutfitPiecesChange} />
          </label>
          <label>
            Or paste piece image URLs (one per line)
            <textarea
              rows={3}
              value={outfitPieceUrls}
              onChange={(e) => setOutfitPieceUrls(e.target.value)}
              placeholder="https://...shirt.jpg&#10;https://...pants.jpg"
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="secondary" onClick={useForFullTryOn}>
              Send Pieces to Try-On
            </button>
            <span className="small">Pieces ready: {outfitPieceImages.length + outfitPieceUrls.split(/\n|,/g).map((x) => x.trim()).filter(Boolean).length}</span>
          </div>
        </div>

        <div className="grid" style={{ maxHeight: 440, overflow: "auto", marginBottom: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === "user" ? "end" : "start", maxWidth: "85%", background: m.role === "user" ? "#f0d8cf" : "#f6ecdf", borderRadius: 12, padding: "10px 12px" }}>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{m.content}</p>

              {m.recommendation ? (
                <div style={{ marginTop: 8, background: "#fff8ef", border: "1px solid #ebd7bf", borderRadius: 10, padding: 8 }}>
                  <p className="small" style={{ margin: 0 }}>
                    Verdict: <strong>{m.recommendation.verdict}</strong> · Confidence: <strong>{m.recommendation.confidence}%</strong>
                  </p>
                  <p className="small" style={{ marginBottom: 6 }}>Why this works for you:</p>
                  <ul style={{ margin: "0 0 8px 18px", padding: 0 }}>
                    {m.recommendation.whyThisWorks.map((point, idx) => (<li key={idx} className="small">{point}</li>))}
                  </ul>
                  <p className="small" style={{ marginBottom: 6 }}>Alternative option:</p>
                  <ul style={{ margin: "0 0 8px 18px", padding: 0 }}>
                    {m.recommendation.alternatives.map((alt, idx) => (<li key={idx} className="small">{alt}</li>))}
                  </ul>
                  <p className="small" style={{ margin: 0 }}>Time-saving tip: <strong>{m.recommendation.timeSavingTip}</strong></p>
                  {m.role === "assistant" ? (
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="secondary" onClick={() => setMessageFeedback(i, "up")}>Helpful</button>
                      <button type="button" className="secondary" onClick={() => setMessageFeedback(i, "down")}>Not Useful</button>
                      <button type="button" className="secondary" onClick={() => saveLookFromMessage(i)}>Save This Look</button>
                    </div>
                  ) : null}
                  {m.feedback ? <p className="small" style={{ marginTop: 6, marginBottom: 0 }}>Feedback saved: {m.feedback === "up" ? "Helpful" : "Not Useful"}</p> : null}
                </div>
              ) : null}

              {m.images?.length ? (
                <div className="grid cols-2" style={{ marginTop: 8 }}>
                  {m.images.map((img, idx) => (
                    <img key={`${i}-${idx}`} src={img} alt="Uploaded for stylist review" style={{ width: "100%", borderRadius: 8 }} />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <form onSubmit={send} className="grid">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder={mode === "talk" ? `Speak or type to ${stylistName}...` : "Describe your planned outfit, colors, and mood..."}
          />

          <label>
            Upload your photo (optional)
            <input type="file" accept="image/*" onChange={(e) => onFileChange(e, setUserPhoto)} />
          </label>
          <label>
            Upload dress/outfit photo (optional)
            <input type="file" accept="image/*" onChange={(e) => onFileChange(e, setDressPhoto)} />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" disabled={loading}>{loading ? "Thinking..." : mode === "talk" ? `Ask ${stylistName}` : "Ask Stylist"}</button>
            <button type="button" className="secondary" onClick={clearConversation}>Clear Chat</button>
          </div>
        </form>

        {lastAssistantIndex >= 0 ? (
          <form onSubmit={submitSessionFeedback} style={{ marginTop: 16, borderTop: "1px solid #ead8c4", paddingTop: 12 }}>
            <h3 style={{ marginBottom: 8 }}>Quick Session Feedback</h3>
            <label>
              Rating (1-5)
              <input type="number" min={1} max={5} value={rating} onChange={(e) => setRating(Number(e.target.value))} required />
            </label>
            <label>
              Did you like this session?
              <select value={liked ? "yes" : "no"} onChange={(e) => setLiked(e.target.value === "yes")}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label>
              Comment
              <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What felt useful or missing?" />
            </label>
            <button type="submit" className="secondary">Submit Feedback</button>
            {feedbackStatus ? <p className="small text-good">{feedbackStatus}</p> : null}
          </form>
        ) : null}
      </article>

      <article className="card">
        <h2>Saved Looks & Wear History</h2>
        <p className="small">Save good recommendations and mark them worn to build trusted personal style memory.</p>
        <div className="grid" style={{ maxHeight: 360, overflow: "auto" }}>
          {!savedLooks.length ? <p className="small">No saved looks yet.</p> : null}
          {savedLooks.map((look) => (
            <div key={look.id} style={{ border: "1px solid #ebd7bf", borderRadius: 10, padding: 10 }}>
              <p style={{ margin: 0 }}><strong>{look.recommendation.verdict}</strong> · {look.recommendation.confidence}% · {look.occasion}</p>
              <p className="small" style={{ margin: "6px 0" }}>{look.userPrompt}</p>
              <p className="small" style={{ margin: "0 0 6px" }}>
                {new Date(look.createdAt).toLocaleString()}
                {look.wornAt ? ` · Worn on ${new Date(look.wornAt).toLocaleDateString()}` : " · Not marked worn"}
              </p>
              {!look.wornAt ? <button type="button" className="secondary" onClick={() => markAsWorn(look.id)}>Mark as Worn</button> : null}
            </div>
          ))}
        </div>

        <h3 style={{ marginTop: 16 }}>Session Context</h3>
        <p className="small">Recommendations use your saved profile, closet, occasion, conversation memory, and stylist name/mode.</p>
        <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify({ profile, closetCount: closet.length, occasion, messages: messages.length, savedLooks: savedLooks.length, stylistName, mode, preferredLanguage }, null, 2)}
        </pre>
        <Link href="/try-on">
          <button>Go to Virtual Try-On</button>
        </Link>
      </article>
    </section>
  );
}
