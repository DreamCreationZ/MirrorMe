"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { localStore } from "@/lib/localStore";
import { loadCloset, loadProfile } from "@/lib/persistence";
import { ClosetItem, StylistConfig, StylistMessage, StylistRecommendation, UserProfile } from "@/types/models";

const APP_NAME = "MirrorMe";

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous?: boolean;
  maxAlternatives?: number;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend?: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecCtor = new () => SpeechRec;

function introMessage(name: string): StylistMessage {
  return {
    role: "assistant",
    content: `Hey, I am ${APP_NAME}, your personal stylist. Current chat nickname is ${name || APP_NAME}. You can give me a nickname and I will use it while chatting.`
  };
}

function occasionGreeting(userName: string, occ: string): StylistMessage {
  return {
    role: "assistant",
    content: `Hey ${userName}, welcome back. I see you are planning for ${occ}. Tell me what you have in mind and I will style you honestly.`
  };
}

function directWelcome(userName: string): StylistMessage {
  return {
    role: "assistant",
    content: `Hey ${userName}, welcome back. I am ${APP_NAME}. How may I style you today?`
  };
}

function localFallbackReply(userName: string, occ: string, text: string) {
  const t = text.toLowerCase();
  if (t.includes("hi") || t.includes("hello")) {
    return `Hey ${userName}, I am ${APP_NAME}. For your ${occ} plan, I can suggest a full look right now.`;
  }
  if (t.includes("casual") || t.includes("outing") || t.includes("day")) {
    return "Go with a clean fitted top, straight jeans or trousers, low-contrast shoes, and one subtle accessory. This will look practical and confident.";
  }
  if (t.includes("party")) {
    return "Use one statement piece and keep the rest clean. Too many loud elements together will reduce the overall look.";
  }
  if (t.includes("makeup")) {
    return "Keep base natural, define eyes, and use a lip shade slightly deeper than your natural tone for a polished look.";
  }
  return "Tell me your occasion and what pieces you have in mind. I will give you honest, practical styling advice.";
}

function speechText(input: string) {
  const cleaned = input
    .replace(/\n+/g, ". ")
    .replace(/Verdict:\s*(NOT GOOD|GOOD|BEST)/gi, "")
    .replace(/Confidence:\s*\d+%?/gi, "")
    .replace(/Why this works for you:/gi, "Why this works:")
    .replace(/Alternative option:/gi, "Alternative:")
    .replace(/Time-saving tip:/gi, "Quick tip:")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || input.trim();
}

function pickPreferredVoice(voices: SpeechSynthesisVoice[], femalePreferred: boolean): SpeechSynthesisVoice | undefined {
  const femaleHint = /(female|woman|samantha|veena|zira|karen|moira|tessa|ava|serena|victoria|allison|google uk english female|aria|siri)/i;
  const femaleEn = voices.find((v) => v.lang.toLowerCase().startsWith("en") && femaleHint.test(v.name.toLowerCase()));
  const femaleAny = voices.find((v) => femaleHint.test(v.name.toLowerCase()));
  const english = voices.find((v) => v.lang.toLowerCase().startsWith("en"));
  if (femalePreferred) return femaleEn || femaleAny || english || voices[0];
  return english || voices[0];
}

function detectRenameIntent(text: string) {
  const cleaned = text.trim();
  const patterns = [
    /(?:call yourself|your name is|i name you|i will call you|you are)\s+([a-zA-Z][a-zA-Z\s'-]{1,24})/i,
    /(?:name\s+you|name\s+u)\s+as\s+([a-zA-Z][a-zA-Z\s'-]{1,24})/i,
    /(?:call\s+you|call\s+u)\s+([a-zA-Z][a-zA-Z\s'-]{1,24})/i,
    /^name\s*:\s*([a-zA-Z][a-zA-Z\s'-]{1,24})$/i
  ];
  for (const pattern of patterns) {
    const hit = cleaned.match(pattern);
    if (hit?.[1]) return hit[1].trim();
  }
  return "";
}

export default function StylistPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [closet, setCloset] = useState<ClosetItem[]>([]);
  const [occasion, setOccasion] = useState("casual");

  const [stylistName, setStylistName] = useState(APP_NAME);
  const [mode, setMode] = useState<"chat" | "talk">("chat");
  const [messages, setMessages] = useState<StylistMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [talkStatus, setTalkStatus] = useState("");

  const chatListRef = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef<"chat" | "talk">("chat");
  const recognizerRef = useRef<SpeechRec | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    waitForAuthInit().then(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      setUserId(user.id);
      const loadedProfile = await loadProfile(user.id);
      setProfile(loadedProfile);
      setCloset(await loadCloset(user.id));
      const params =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : new URLSearchParams();
      const queryOccasion = params.get("occasion");
      const fromOccasion = params.get("from") === "occasion";
      if (fromOccasion && queryOccasion) {
        setOccasion(queryOccasion);
        localStore.setOccasion(user.id, queryOccasion);
        localStore.setStylistOccasionHandoff(user.id, queryOccasion);
      } else {
        setOccasion(localStore.getOccasion(user.id) || "casual");
      }

      const config = localStore.getStylistConfig(user.id);
      if (config) {
        setStylistName(config.name || "MirrorMe");
        setMode(config.mode || "chat");
      } else {
        localStore.setStylistConfig(user.id, {
          name: "MirrorMe",
          mode: "chat",
          preferredLanguage: "English",
          createdAt: Date.now()
        });
      }

      const saved = localStore.getStylistMessages(user.id);
      const seenKey = `fashion_stylist_seen:${user.id}`;
      const directWelcomeKey = `fashion_stylist_direct_welcome:${user.id}`;
      const seenBefore = typeof window !== "undefined" ? localStorage.getItem(seenKey) === "1" : false;
      const directWelcomeShown = typeof window !== "undefined" ? sessionStorage.getItem(directWelcomeKey) === "1" : false;
      const handoffOccasion = localStore.getStylistOccasionHandoff(user.id);
      const occasionFromEntry = fromOccasion && queryOccasion ? queryOccasion : handoffOccasion;
      const userName = loadedProfile?.name || user.name || "there";

      if (!saved.length && !seenBefore) {
        const initial = [introMessage(config?.name || "MirrorMe")];
        setMessages(initial);
        localStore.setStylistMessages(user.id, initial);
        if (typeof window !== "undefined") localStorage.setItem(seenKey, "1");
        return;
      }

      const base = saved.length ? saved : [introMessage(config?.name || "MirrorMe")];
      let next = base;

      // Occasion-selected flow: always greet once with chosen occasion and then clear handoff.
      if (occasionFromEntry) {
        next = [...base, occasionGreeting(userName, occasionFromEntry)];
        localStore.clearStylistOccasionHandoff(user.id);
      } else if (!directWelcomeShown) {
        // Direct open of stylist page: one welcome-back per tab session.
        next = [...base, directWelcome(userName)];
        if (typeof window !== "undefined") sessionStorage.setItem(directWelcomeKey, "1");
      }

      setMessages(next);
      localStore.setStylistMessages(user.id, next);
      if (typeof window !== "undefined") localStorage.setItem(seenKey, "1");
    });
  }, [router]);

  useEffect(() => {
    chatListRef.current?.scrollTo({ top: chatListRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

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
      setTalkStatus("");
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
    if (modeRef.current !== "talk") return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const speakable = speechText(text);
    if (!speakable) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speakable);
    const voices = window.speechSynthesis.getVoices();
    const wantsFemale = /(meera|sera|sara|riya|priya|anita|swati)/i.test(`${stylistName} ${profile?.name || ""}`);
    const picked = pickPreferredVoice(voices, wantsFemale);
    if (picked) {
      utterance.voice = picked;
      utterance.lang = picked.lang;
    }
    utterance.rate = 0.95;
    utterance.pitch = wantsFemale ? 1.15 : 1.0;
    utterance.onstart = () => setTalkStatus("Speaking...");
    utterance.onend = () => setTalkStatus("Tap mic to record again.");
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

  async function onAttachImages(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const images = await Promise.all(files.map((f) => fileToDataUrl(f)));
    setPendingImages((prev) => [...prev, ...images].slice(0, 8));
  }

  function startVoiceInput() {
    if (typeof window === "undefined") return;
    if (loading || listening) return;

    const speechWindow = window as unknown as {
      SpeechRecognition?: SpeechRecCtor;
      webkitSpeechRecognition?: SpeechRecCtor;
    };

    const Ctor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Ctor) {
      setTalkStatus("Voice input is not supported in this browser.");
      return;
    }

    const rec = new Ctor();
    recognizerRef.current = rec;
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    setListening(true);
    setTalkStatus("Listening...");
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    let latestText = "";

    rec.onresult = (event: unknown) => {
      const ev = event as {
        results?: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
      };
      if (!ev.results) return;
      let finalText = "";
      for (let i = 0; i < ev.results.length; i += 1) {
        const result = ev.results[i];
        const chunk = result?.[0]?.transcript?.trim() || "";
        if (!chunk) continue;
        if (result.isFinal) {
          finalText += `${chunk} `;
        } else {
          latestText = chunk;
        }
      }
      const merged = `${finalText}${latestText}`.trim();
      if (merged) {
        latestText = merged;
        setInput(merged);
      }
    };

    rec.onerror = () => {
      setListening(false);
      rec.stop();
      setTalkStatus("Mic error. Tap mic and try again.");
    };

    rec.onend = () => {
      setListening(false);
      const finalText = latestText.trim();
      if (finalText) {
        setInput(finalText);
        void sendMessage(finalText);
      } else {
        setTalkStatus("Could not hear clearly. Tap mic and try again.");
      }
    };

    rec.start();
  }

  async function sendMessage(overrideText?: string) {
    const messageText = (overrideText ?? input).trim();
    if ((!messageText && !pendingImages.length) || loading) return;

    const renameTo = detectRenameIntent(messageText);
    if (renameTo) {
      const renamed = renameTo.replace(/\s+/g, " ").trim();
      setStylistName(renamed);
      persistConfig({ name: renamed, mode: modeRef.current, preferredLanguage: "English", createdAt: Date.now() });

      const userMessage: StylistMessage = { role: "user", content: messageText };
      const assistantMessage: StylistMessage = { role: "assistant", content: `Done. You can call me ${renamed} in this chat. ${APP_NAME} remains your stylist app.` };
      const next = [...messages, userMessage, assistantMessage];
      persist(next);
      setInput("");
      if (modeRef.current === "talk") speak(assistantMessage.content);
      return;
    }

    const userMessage: StylistMessage = {
      role: "user",
      content: messageText || "Please review these images honestly.",
      images: pendingImages.length ? pendingImages : undefined
    };

    const next = [...messages, userMessage];
    persist(next);
    setInput("");
    setLoading(true);
    setTalkStatus(modeRef.current === "talk" ? "Thinking..." : "");

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
          conversationMode: modeRef.current,
          preferredLanguage: "English"
        })
      });

      const data = (await res.json()) as { reply?: string; error?: string; recommendation?: StylistRecommendation };
      if (!res.ok) throw new Error(data.error || "Stylist service failed.");

      const assistant: StylistMessage = {
        role: "assistant",
        content: data.reply ?? localFallbackReply(profile?.name || "there", occasion, messageText),
        recommendation: data.recommendation
      };

      persist([...next, assistant]);
      setPendingImages([]);
      if (modeRef.current === "talk") speak(assistant.content);
    } catch {
      const failMessage: StylistMessage = {
        role: "assistant",
        content: localFallbackReply(profile?.name || "there", occasion, messageText)
      };
      persist([...next, failMessage]);
      if (modeRef.current === "talk") speak(failMessage.content);
      setTalkStatus(modeRef.current === "talk" ? "Ready. Tap mic to continue." : "");
    } finally {
      setLoading(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    await sendMessage();
  }

  return (
    <section className="grid phone-grid">
      <article className="card phone-card" style={{ height: "calc(100vh - 190px)", display: "grid", gridTemplateRows: "auto 1fr" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h2 style={{ margin: 0 }}>{APP_NAME}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" className={mode === "chat" ? "" : "secondary"} onClick={() => setMode("chat")}>Chat</button>
            <button
              type="button"
              className={mode === "talk" ? "" : "secondary"}
              onClick={() => {
                setMode("talk");
                setTalkStatus("Talk mode on. Tap mic and speak.");
              }}
            >
              Talk
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: 10,
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 16,
            overflow: "hidden",
            display: "grid",
            gridTemplateRows: "1fr auto",
            minHeight: 0,
            background: "rgba(6,10,18,0.72)"
          }}
        >
          <div ref={chatListRef} style={{ overflow: "auto", padding: 10, display: "grid", gap: 8, alignContent: "start" }}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  justifySelf: m.role === "user" ? "end" : "start",
                  alignSelf: "start",
                  width: "fit-content",
                  maxWidth: "72%",
                  background: m.role === "user" ? "linear-gradient(135deg,var(--brand),var(--brand-2))" : "rgba(255,255,255,0.08)",
                  color: m.role === "user" ? "#1b130d" : "#eef2fa",
                  borderRadius: 14,
                  padding: "8px 10px"
                }}
              >
                <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.4 }}>{m.content}</p>
                {m.images?.length ? (
                  <div className="grid cols-2" style={{ marginTop: 8 }}>
                    {m.images.map((img, idx) => (
                      <img key={`${i}-${idx}`} src={img} alt="Uploaded" style={{ width: "100%", borderRadius: 8 }} />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {loading ? (
              <div
                style={{
                  justifySelf: "start",
                  maxWidth: "72%",
                  background: "rgba(255,255,255,0.08)",
                  borderRadius: 14,
                  padding: "8px 10px"
                }}
              >
                <p className="small" style={{ margin: 0 }}>{APP_NAME} is typing...</p>
              </div>
            ) : null}
          </div>

          <form onSubmit={send} style={{ borderTop: "1px solid rgba(255,255,255,0.16)", padding: 10 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onAttachImages}
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()} title="Attach image">
                📎
              </button>
              <button
                type="button"
                className="secondary"
                onClick={startVoiceInput}
                disabled={listening || loading}
                title="Record voice"
              >
                {listening ? "🎙️..." : "🎙️"}
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!loading) e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={`Message ${APP_NAME}...`}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="submit" disabled={loading}>Send</button>
            </div>
            <div className="small" style={{ marginTop: 6 }}>
              {pendingImages.length ? `${pendingImages.length} image(s) attached` : "No attachment"}
              {mode === "talk" && talkStatus ? ` · ${talkStatus}` : ""}
            </div>
          </form>
        </div>
      </article>
    </section>
  );
}
