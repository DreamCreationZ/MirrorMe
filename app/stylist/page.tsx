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

function speechText(input: string) {
  return input
    .replace(/\n+/g, ". ")
    .replace(/Verdict:\s*(NOT GOOD|GOOD|BEST)/gi, "")
    .replace(/Confidence:\s*\d+%?/gi, "")
    .replace(/Why this works for you:/gi, "Why this works:")
    .replace(/Alternative option:/gi, "Alternative:")
    .replace(/Time-saving tip:/gi, "Quick tip:")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function pickPreferredVoice(
  voices: SpeechSynthesisVoice[],
  language: string,
  femalePreferred: boolean
): SpeechSynthesisVoice | undefined {
  const langHint = language === "Hindi" ? "hi" : "en";
  const femaleHint = /(female|woman|samantha|veena|zira|karen|moira|tessa|ava|serena|victoria|allison|google uk english female|aria|siri)/i;
  const femaleLang = voices.find((v) => v.lang.toLowerCase().startsWith(langHint) && femaleHint.test(v.name.toLowerCase()));
  const femaleAny = voices.find((v) => femaleHint.test(v.name.toLowerCase()));
  const langAny = voices.find((v) => v.lang.toLowerCase().startsWith(langHint));
  if (femalePreferred) return femaleLang || femaleAny || langAny || voices[0];
  return langAny || voices[0];
}

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
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [pendingPersonImage, setPendingPersonImage] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [handsFreeTalk, setHandsFreeTalk] = useState(true);
  const [talkStatus, setTalkStatus] = useState("");
  const [voiceReady, setVoiceReady] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceUri, setSelectedVoiceUri] = useState("");

  const recognizerRef = useRef<SpeechRec | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef(mode);
  const handsFreeRef = useRef(handsFreeTalk);
  const loadingRef = useRef(loading);
  const listeningRef = useRef(listening);
  const speakingRef = useRef(false);
  const recognizerRunningRef = useRef(false);

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
        setMode("chat");
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
      setTalkStatus("");
    }
  }, [mode]);

  useEffect(() => {
    if (mode === "talk" && handsFreeTalk && !loadingRef.current && !listeningRef.current) {
      const timer = setTimeout(() => startVoiceInput(), 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [handsFreeTalk, mode]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setVoiceReady(true);
  }, [mode]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    handsFreeRef.current = handsFreeTalk;
  }, [handsFreeTalk]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const loadVoices = () => {
      const voices = synth.getVoices();
      if (voices.length) setAvailableVoices(voices);
    };
    loadVoices();
    synth.addEventListener("voiceschanged", loadVoices);
    return () => synth.removeEventListener("voiceschanged", loadVoices);
  }, []);

  useEffect(() => {
    if (!availableVoices.length || selectedVoiceUri) return;
    const picked = pickPreferredVoice(availableVoices, preferredLanguage, true);
    if (picked) setSelectedVoiceUri(picked.voiceURI);
  }, [availableVoices, preferredLanguage, selectedVoiceUri]);

  function persist(next: StylistMessage[]) {
    setMessages(next);
    if (userId) localStore.setStylistMessages(userId, next);
  }

  function persistConfig(next: StylistConfig) {
    if (!userId) return;
    localStore.setStylistConfig(userId, next);
  }

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!voiceReady) {
      setVoiceReady(true);
      return;
    }

    if (recognizerRef.current) {
      recognizerRef.current.stop();
      recognizerRef.current = null;
      recognizerRunningRef.current = false;
      setListening(false);
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText(text));
    const voices = availableVoices.length ? availableVoices : window.speechSynthesis.getVoices();
    const stylistLower = stylistName.toLowerCase();
    const profileLower = (profile?.name || "").toLowerCase();
    const wantsFemale =
      /(meera|sera|sara|riya|priya|anita|swati)/i.test(stylistLower) ||
      /(swati|priya|riya|anita)/i.test(profileLower);
    const selectedVoice = selectedVoiceUri ? voices.find((v) => v.voiceURI === selectedVoiceUri) : null;
    const pickedVoice = selectedVoice || pickPreferredVoice(voices, preferredLanguage, wantsFemale);
    if (pickedVoice) {
      utterance.voice = pickedVoice;
      utterance.lang = pickedVoice.lang;
    }
    utterance.rate = preferredLanguage === "Hindi" ? 0.92 : 0.94;
    utterance.pitch = wantsFemale ? 1.18 : 1.0;
    utterance.volume = 1;
    utterance.onstart = () => {
      speakingRef.current = true;
      if (mode === "talk") setTalkStatus("Speaking...");
    };
    utterance.onerror = () => {
      if (mode === "talk") setTalkStatus("Speech output failed. Click Enable Voice and try again.");
    };
    utterance.onend = () => {
      speakingRef.current = false;
      if (modeRef.current === "talk" && handsFreeRef.current && !loadingRef.current && !listeningRef.current) {
        startVoiceInput();
      }
    };
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

  async function onPersonImageAttach(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingPersonImage(await fileToDataUrl(file));
  }

  function openTryOnFromChat() {
    if (!userId) return;
    localStore.setTryOnPreset(userId, {
      personImage: pendingPersonImage || profile?.frontImageUrl,
      garmentImages: pendingImages,
      createdAt: Date.now()
    });
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
    if (modeRef.current === "talk") speak(note.content);
  }

  function setConversationMode(nextMode: "chat" | "talk") {
    setMode(nextMode);
    persistConfig({ name: stylistName, mode: nextMode, preferredLanguage, createdAt: Date.now() });
    if (nextMode === "talk") {
      enableVoice();
      setTalkStatus(`Talk mode on. Say "${stylistName}" and then your request.`);
      speak(`Talk mode is on. Say ${stylistName} and then your request.`);
    } else {
      setTalkStatus("");
    }
  }

  function setLanguage(nextLanguage: string) {
    setPreferredLanguage(nextLanguage);
    persistConfig({ name: stylistName, mode, preferredLanguage: nextLanguage, createdAt: Date.now() });
  }

  function enableVoice() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setTalkStatus("Speech output is not supported in this browser.");
      return;
    }
    try {
      window.speechSynthesis.cancel();
      setVoiceReady(true);
      setTalkStatus("Voice enabled.");
    } catch {
      setVoiceReady(false);
      setTalkStatus("Could not enable voice output.");
    }
  }

  function startVoiceInput() {
    if (typeof window === "undefined") return;
    if (loadingRef.current || listeningRef.current || speakingRef.current || recognizerRunningRef.current) return;

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
    recognizerRunningRef.current = true;
    rec.lang = preferredLanguage === "Hindi" ? "hi-IN" : preferredLanguage === "English" ? "en-US" : "en-IN";
    rec.interimResults = false;
    setListening(true);
    setTalkStatus("Listening...");

    rec.onresult = (event: unknown) => {
      const ev = event as { results?: ArrayLike<ArrayLike<{ transcript: string }>> };
      const text = ev.results?.[0]?.[0]?.transcript?.trim() || "";
      recognizerRunningRef.current = false;
      setListening(false);
      rec.stop();
      if (text) {
        const heard = text.trim();
        const normalized = heard.toLowerCase().replace(/[.,!?;:]+/g, " ").replace(/\s+/g, " ").trim();
        const name = stylistName.trim().toLowerCase();
        const parts = normalized.split(" ").filter(Boolean);
        const hasWake =
          parts[0] === name ||
          ((parts[0] === "hey" || parts[0] === "hi" || parts[0] === "ok") && parts[1] === name);

        // Strict wake-word mode: ignore everything unless it starts with stylist name.
        if (!hasWake) {
          setTalkStatus(`Listening for "${stylistName}"...`);
          if (modeRef.current === "talk" && handsFreeRef.current) {
            setTimeout(() => startVoiceInput(), 250);
          }
          return;
        }

        const stripped =
          parts[0] === name
            ? parts.slice(1).join(" ").trim()
            : parts.slice(2).join(" ").trim();
        if (!stripped) {
          setTalkStatus("Yes? I am listening.");
          speak("Yes? Tell me how I can style you.");
          return;
        }

        setInput(stripped);
        setTalkStatus(`Heard: ${stripped}`);
        void sendMessage(stripped);
      } else if (modeRef.current === "talk" && handsFreeRef.current) {
        setTalkStatus("Could not hear clearly. Listening again...");
        setTimeout(() => startVoiceInput(), 300);
      }
    };

    rec.onerror = () => {
      recognizerRunningRef.current = false;
      setListening(false);
      rec.stop();
      setTalkStatus("Mic error. Trying again...");
      if (modeRef.current === "talk" && handsFreeRef.current) {
        setTimeout(() => startVoiceInput(), 900);
      }
    };

    rec.start();
  }

  async function sendMessage(overrideText?: string) {
    const messageText = (overrideText ?? input).trim();
    if ((!messageText && !pendingImages.length) || loading) return;

    const images = pendingPersonImage ? [pendingPersonImage, ...pendingImages] : pendingImages;
    const userMessage: StylistMessage = {
      role: "user",
      content: messageText || "Please review these images honestly.",
      images
    };

    const next = [...messages, userMessage];
    persist(next);
    setInput("");
    setLoading(true);
    setTalkStatus("Thinking...");

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
          preferredLanguage
        })
      });

      const data = (await res.json()) as {
        reply?: string;
        error?: string;
        recommendation?: StylistRecommendation;
      };

      if (!res.ok) {
        throw new Error(data.error || "Stylist service failed.");
      }

      const assistant: StylistMessage = {
        role: "assistant",
        content: data.reply ?? data.error ?? "Stylist is temporarily unavailable.",
        recommendation: data.recommendation
      };

      const withReply = [...next, assistant];
      persist(withReply);
      setPendingImages([]);
      setPendingPersonImage("");
      if (modeRef.current === "talk") {
        speak(assistant.content);
      }
      setTalkStatus(modeRef.current === "talk" ? "Reply ready." : "");
      return assistant.content;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stylist is temporarily unavailable.";
      const failMessage: StylistMessage = {
        role: "assistant",
        content: message
      };
      persist([...next, failMessage]);
      if (modeRef.current === "talk") {
        speak(failMessage.content);
      }
      setTalkStatus(`Error: ${message}`);
      return failMessage.content;
    } finally {
      setLoading(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    await sendMessage();
  }

  useEffect(() => {
    chatListRef.current?.scrollTo({ top: chatListRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  function clearConversation() {
    const reset = [introMessage(stylistName)];
    persist(reset);
  }

  return (
    <section className="grid phone-grid">
      <article className="card phone-card">
        <h2>{stylistName}</h2>
        <p className="small">Occasion: <strong>{occasion || "casual"}</strong></p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button type="button" className={mode === "chat" ? "" : "secondary"} onClick={() => setConversationMode("chat")}>
            Chat
          </button>
          <button type="button" className={mode === "talk" ? "" : "secondary"} onClick={() => setConversationMode("talk")}>
            Talk
          </button>
          {mode === "talk" ? (
            <>
              <button type="button" className="secondary" onClick={startVoiceInput} disabled={listening}>
                {listening ? "Listening..." : "Speak"}
              </button>
              <button type="button" className="secondary" onClick={() => setHandsFreeTalk((v) => !v)}>
                {handsFreeTalk ? "Hands-free On" : "Hands-free Off"}
              </button>
              <button type="button" className="secondary" onClick={enableVoice}>
                Enable Voice
              </button>
            </>
          ) : null}
        </div>
        <div className="grid cols-2" style={{ marginBottom: 8 }}>
          <label>
            Stylist name
            <input value={renameInput} onChange={(e) => setRenameInput(e.target.value)} placeholder="Meera, Sera..." />
          </label>
          <label>
            Language
            <select value={preferredLanguage} onChange={(e) => setLanguage(e.target.value)}>
              <option value="auto">Auto</option>
              <option value="English">English</option>
              <option value="Hindi">Hindi</option>
              <option value="Marathi">Marathi</option>
              <option value="Tamil">Tamil</option>
              <option value="Telugu">Telugu</option>
              <option value="Bengali">Bengali</option>
              <option value="Gujarati">Gujarati</option>
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button type="button" className="secondary" onClick={saveStylistName}>Save Name</button>
          {mode === "talk" && availableVoices.length ? (
            <select value={selectedVoiceUri} onChange={(e) => setSelectedVoiceUri(e.target.value)}>
              <option value="">Auto voice</option>
              {availableVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
              ))}
            </select>
          ) : null}
        </div>
        {mode === "talk" ? <p className="small">Say &quot;{stylistName}&quot; then your request.</p> : null}
        {mode === "talk" && talkStatus ? <p className="small">{talkStatus}</p> : null}

        <div
          ref={chatListRef}
          className="grid"
          style={{
            maxHeight: "48vh",
            minHeight: "42vh",
            overflow: "auto",
            marginBottom: 12,
            padding: 10,
            border: "1px solid #ead8c4",
            borderRadius: 12,
            background: "rgba(9,13,20,0.7)"
          }}
        >
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === "user" ? "end" : "start",
                maxWidth: "85%",
                background: m.role === "user" ? "linear-gradient(135deg,#86603a,#c7a06b)" : "rgba(255,255,255,0.08)",
                color: m.role === "user" ? "#1b130d" : "#eef2fa",
                borderRadius: 14,
                padding: "10px 12px"
              }}
            >
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{m.content}</p>

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
                background: "rgba(255,255,255,0.08)",
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

        <form onSubmit={send} className="grid" style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" className="secondary" onClick={() => setAttachmentOpen((v) => !v)} title="Attach">
              📎
            </button>
            <div className="small">
              {pendingPersonImage ? "User photo attached" : "No user photo"} · Dress images: {pendingImages.length}
            </div>
          </div>
          {attachmentOpen ? (
            <div className="grid cols-2" style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 10 }}>
              <label>
                Upload dress photo(s)
                <input type="file" accept="image/*" multiple onChange={onImageAttach} />
              </label>
              <label>
                Upload your photo
                <input type="file" accept="image/*" onChange={onPersonImageAttach} />
              </label>
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                <button type="button" className="secondary" onClick={openTryOnFromChat}>
                  Try-On
                </button>
              </div>
            </div>
          ) : null}
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
            placeholder={`Reply to ${stylistName}... (Press Enter to send)`}
          />
          <div className="small">Press `Enter` to send, `Shift + Enter` for new line.</div>
        </form>
      </article>
    </section>
  );
}
