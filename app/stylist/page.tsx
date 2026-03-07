"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { localStore } from "@/lib/localStore";
import { loadCloset, loadProfile } from "@/lib/persistence";
import {
  ClosetItem,
  StylistConfig,
  StylistMessage,
  StylistRecommendation,
  UserProfile
} from "@/types/models";

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

  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const recognizerRef = useRef<SpeechRec | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);

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

  function persist(next: StylistMessage[]) {
    setMessages(next);
    if (userId) localStore.setStylistMessages(userId, next);
  }

  function persistConfig(next: StylistConfig) {
    if (!userId) return;
    localStore.setStylistConfig(userId, next);
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

  async function onImageAttach(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const images = await Promise.all(files.map((f) => fileToDataUrl(f)));
    setPendingImages((prev) => [...prev, ...images].slice(0, 6));
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
    if ((!input.trim() && !pendingImages.length) || loading) return;

    const images = pendingImages;
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
      setPendingImages([]);
      speak(assistant.content);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    chatListRef.current?.scrollTo({ top: chatListRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  function clearConversation() {
    const reset = [introMessage(stylistName)];
    persist(reset);
  }

  return (
    <section className="grid">
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

        <div
          ref={chatListRef}
          className="grid"
          style={{
            maxHeight: "62vh",
            minHeight: "62vh",
            overflow: "auto",
            marginBottom: 12,
            padding: 10,
            border: "1px solid #ead8c4",
            borderRadius: 12,
            background: "#fff8ef"
          }}
        >
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === "user" ? "end" : "start",
                maxWidth: "85%",
                background: m.role === "user" ? "#d76f58" : "#efe3d5",
                color: m.role === "user" ? "#fff" : "#1d1b19",
                borderRadius: 14,
                padding: "10px 12px"
              }}
            >
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
          {loading ? (
            <div
              style={{
                alignSelf: "start",
                maxWidth: "85%",
                background: "#efe3d5",
                borderRadius: 14,
                padding: "10px 12px"
              }}
            >
              <p className="small" style={{ margin: 0 }}>
                {stylistName} is typing...
              </p>
            </div>
          ) : null}
        </div>

        <form onSubmit={send} className="grid">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (loading) return;
                const form = e.currentTarget.form;
                if (form) {
                  form.requestSubmit();
                }
              }
            }}
            rows={2}
            placeholder={mode === "talk" ? `Speak or type to ${stylistName}...` : "Describe your planned outfit, colors, and mood..."}
          />

          <label>
            Upload outfit image(s) (optional)
            <input type="file" accept="image/*" multiple onChange={onImageAttach} />
          </label>
          {pendingImages.length ? <p className="small">Attached images: {pendingImages.length}</p> : null}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" disabled={loading}>{loading ? "Thinking..." : mode === "talk" ? `Ask ${stylistName}` : "Ask Stylist"}</button>
            <button type="button" className="secondary" onClick={clearConversation}>Clear Chat</button>
            <button type="button" className="secondary" onClick={() => router.push("/try-on")}>Open Try-On</button>
          </div>
        </form>
      </article>
    </section>
  );
}
