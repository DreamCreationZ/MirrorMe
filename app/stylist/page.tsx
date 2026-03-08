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
    const femalePriority = /(samantha|veena|karen|moira|tessa|zira|google uk english female|female|woman|ava|serena)/i;
    const enFemale = availableVoices.find((v) => /en/i.test(v.lang) && femalePriority.test(v.name));
    const hiFemale = availableVoices.find((v) => /hi/i.test(v.lang) && femalePriority.test(v.name));
    const fallbackFemale = availableVoices.find((v) => femalePriority.test(v.name));
    const picked = enFemale || hiFemale || fallbackFemale || availableVoices[0];
    if (picked) setSelectedVoiceUri(picked.voiceURI);
  }, [availableVoices, selectedVoiceUri]);

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
    if (!voiceReady) {
      setTalkStatus("Voice is not enabled yet. Click Enable Voice once.");
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
    const langHint = preferredLanguage === "Hindi" ? "hi" : "en";
    const stylistLower = stylistName.toLowerCase();
    const profileLower = (profile?.name || "").toLowerCase();
    const wantsFemale =
      /(meera|sera|sara|riya|priya|anita|swati)/i.test(stylistLower) ||
      /(swati|priya|riya|anita)/i.test(profileLower);
    const femaleHint = /(female|woman|samantha|veena|zira|karen|moira|tessa|ava|serena|victoria|allison|google uk english female)/i;
    const selectedVoice = selectedVoiceUri ? voices.find((v) => v.voiceURI === selectedVoiceUri) : null;
    const femaleLangVoice = voices.find((v) => v.lang.toLowerCase().startsWith(langHint) && femaleHint.test(v.name.toLowerCase()));
    const femaleAnyVoice = voices.find((v) => femaleHint.test(v.name.toLowerCase()));
    const langVoice = voices.find((v) => v.lang.toLowerCase().startsWith(langHint));
    const pickedVoice =
      selectedVoice ||
      (wantsFemale ? femaleLangVoice || femaleAnyVoice || langVoice : langVoice) ||
      voices[0];
    if (pickedVoice) {
      utterance.voice = pickedVoice;
      utterance.lang = pickedVoice.lang;
    }
    utterance.rate = preferredLanguage === "Hindi" ? 0.92 : 0.94;
    utterance.pitch = wantsFemale ? 1.06 : 1.0;
    utterance.volume = 1;
    utterance.onstart = () => {
      speakingRef.current = true;
      setTalkStatus("Speaking...");
    };
    utterance.onerror = () => setTalkStatus("Speech output failed. Click Enable Voice and try again.");
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
    if (nextMode === "talk") {
      enableVoice();
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

    const images = pendingImages;
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
          conversationMode: mode,
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
      speak(assistant.content);
      setTalkStatus(modeRef.current === "talk" ? "Reply ready." : "");
      return assistant.content;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stylist is temporarily unavailable.";
      const failMessage: StylistMessage = {
        role: "assistant",
        content: message
      };
      persist([...next, failMessage]);
      speak(failMessage.content);
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
          {mode === "talk" ? (
            <label>
              Voice
              <select value={selectedVoiceUri} onChange={(e) => setSelectedVoiceUri(e.target.value)}>
                <option value="">Auto (female preferred)</option>
                {availableVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
          {mode === "talk" ? (
            <button type="button" className="secondary" onClick={enableVoice}>
              Enable Voice
            </button>
          ) : null}
          {mode === "talk" ? (
            <button type="button" className="secondary" onClick={() => speak("Hi, I am your stylist. I am ready.")}>
              Test Voice
            </button>
          ) : null}
          {mode === "talk" ? (
            <button
              type="button"
              className="secondary"
              onClick={() => setHandsFreeTalk((v) => !v)}
            >
              {handsFreeTalk ? "Hands-free On" : "Hands-free Off"}
            </button>
          ) : null}
        </div>
        {mode === "talk" ? <p className="small">Talk mode is Alexa-style. Say &quot;{stylistName}&quot; first, then your message.</p> : null}
        {mode === "talk" && talkStatus ? <p className="small">{talkStatus}</p> : null}

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
