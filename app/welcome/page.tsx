"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { localStore } from "@/lib/localStore";
import { loadProfile, saveProfile } from "@/lib/persistence";
import { StylistConfig, UserProfile } from "@/types/models";

type ChatLine = { role: "assistant" | "user"; text: string };

function greeting(stylistName: string, userName: string) {
  const name = userName || "there";
  return `Hey ${name}, I am ${stylistName}, your personal stylist. You can rename me if you want. Upload your front standing photo and I will style you better.`;
}

function preferredFemaleVoice(voices: SpeechSynthesisVoice[]) {
  const femaleHint = /(female|woman|samantha|veena|zira|karen|moira|tessa|ava|serena|victoria|allison|google uk english female)/i;
  return (
    voices.find((v) => /en|hi/i.test(v.lang) && femaleHint.test(v.name)) ||
    voices.find((v) => femaleHint.test(v.name)) ||
    voices.find((v) => /en|hi/i.test(v.lang)) ||
    voices[0]
  );
}

export default function WelcomePage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stylistName, setStylistName] = useState("Meera");
  const [nameInput, setNameInput] = useState("Meera");
  const [frontImageUrl, setFrontImageUrl] = useState("");
  const [typing, setTyping] = useState("");
  const [status, setStatus] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [speaking, setSpeaking] = useState(false);

  const helloText = useMemo(
    () => greeting(stylistName, profile?.name || ""),
    [profile?.name, stylistName]
  );

  useEffect(() => {
    waitForAuthInit().then(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserId(user.id);
      const loaded = await loadProfile(user.id);
      if (!loaded) {
        router.replace("/onboarding");
        return;
      }
      setProfile(loaded);
      setFrontImageUrl(loaded.frontImageUrl || "");

      const config = localStore.getStylistConfig(user.id);
      const initialName = config?.name || "Meera";
      setStylistName(initialName);
      setNameInput(initialName);

      const text = greeting(initialName, loaded.name);
      setChat([{ role: "assistant", text }]);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        const speech = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const voice = preferredFemaleVoice(voices);
        if (voice) {
          speech.voice = voice;
          speech.lang = voice.lang;
        }
        speech.rate = 0.96;
        speech.pitch = 1.16;
        speech.onstart = () => setSpeaking(true);
        speech.onend = () => setSpeaking(false);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(speech);
      }
    });
  }, [router]);

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image."));
      reader.readAsDataURL(file);
    });
  }

  async function onImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const image = await fileToDataUrl(file);
    setFrontImageUrl(image);
  }

  async function saveStylistName() {
    if (!userId) return;
    const cleaned = nameInput.trim() || "Meera";
    setStylistName(cleaned);
    const config: StylistConfig = {
      name: cleaned,
      mode: "chat",
      preferredLanguage: "auto",
      createdAt: Date.now()
    };
    localStore.setStylistConfig(userId, config);
    setChat((prev) => [...prev, { role: "assistant", text: `Done. My name is now ${cleaned}.` }]);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const speech = new SpeechSynthesisUtterance(`Done. My name is now ${cleaned}.`);
      const voices = window.speechSynthesis.getVoices();
      const voice = preferredFemaleVoice(voices);
      if (voice) {
        speech.voice = voice;
        speech.lang = voice.lang;
      }
      speech.rate = 0.96;
      speech.pitch = 1.16;
      speech.onstart = () => setSpeaking(true);
      speech.onend = () => setSpeaking(false);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(speech);
    }
  }

  function sendLocalChat(e: FormEvent) {
    e.preventDefault();
    const message = typing.trim();
    if (!message) return;
    setTyping("");
    setChat((prev) => [...prev, { role: "user", text: message }]);
    const reply = `I got you. Save this setup and I will start styling you honestly in chat and try-on.`;
    setTimeout(() => {
      setChat((prev) => [...prev, { role: "assistant", text: reply }]);
    }, 300);
  }

  async function continueNext() {
    if (!userId || !profile) return;
    if (!frontImageUrl.trim()) {
      setStatus("Please upload your front standing photo first.");
      return;
    }
    const payload: UserProfile = { ...profile, frontImageUrl };
    await saveProfile(userId, payload);
    setStatus("Saved. Moving to occasion.");
    router.push("/occasion");
  }

  return (
    <section className="grid cols-2 phone-grid">
      <article className="card mirror-hero phone-card">
        <h1>Virtual Stylist Welcome</h1>
        <div className="receptionist">
          <div className={speaking ? "assistant-shell speaking" : "assistant-shell"} aria-hidden>
            <div className="assistant-aura" />
            {profile?.avatarImageUrl ? (
              <img src={profile.avatarImageUrl} alt="Selected avatar" className="assistant-avatar-art" />
            ) : (
            <svg viewBox="0 0 220 320" className="assistant-svg" role="img" aria-label="Virtual stylist assistant">
              <defs>
                <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#f5d2b4" />
                  <stop offset="100%" stopColor="#d5a27f" />
                </linearGradient>
                <linearGradient id="hair" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#3a281d" />
                  <stop offset="100%" stopColor="#15100d" />
                </linearGradient>
                <linearGradient id="dress" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#b85f43" />
                  <stop offset="100%" stopColor="#7e3024" />
                </linearGradient>
              </defs>
              <ellipse cx="110" cy="302" rx="56" ry="10" fill="rgba(0,0,0,0.2)" />
              <path d="M60 90 C65 45, 155 45, 160 90 L160 125 L60 125 Z" fill="url(#hair)" />
              <circle cx="110" cy="92" r="38" fill="url(#skin)" />
              <circle cx="97" cy="91" r="3.2" fill="#21160f" />
              <circle cx="124" cy="91" r="3.2" fill="#21160f" />
              <path d="M99 109 Q110 117, 121 109" stroke="#8f4f46" strokeWidth="3" fill="none" strokeLinecap="round" />
              <rect x="96" y="124" width="28" height="14" rx="7" fill="url(#skin)" />
              <path d="M60 154 C76 138, 144 138, 160 154 L176 268 C154 285, 66 285, 44 268 Z" fill="url(#dress)" />
              <path d="M64 157 C50 178, 44 196, 40 218" stroke="url(#skin)" strokeWidth="13" strokeLinecap="round" />
              <path d="M156 157 C170 178, 176 196, 180 218" stroke="url(#skin)" strokeWidth="13" strokeLinecap="round" />
              <path d="M95 286 L86 308 M125 286 L134 308" stroke="#261c16" strokeWidth="10" strokeLinecap="round" />
            </svg>
            )}
            <div className="assistant-wave">
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className="mirror-frame">
            <p>{helloText}</p>
          </div>
        </div>
        <div className="grid">
          <label>
            Name your stylist
            <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Meera, Sera, Ava..." />
          </label>
          <button type="button" onClick={saveStylistName}>Save Stylist Name</button>
          <label>
            Upload your front standing photo (required)
            <input type="file" accept="image/*" onChange={onImageChange} />
          </label>
          {frontImageUrl ? <img src={frontImageUrl} alt="Front profile" className="front-preview" /> : null}
          <button type="button" onClick={continueNext}>Save and Continue</button>
          {status ? <p className="small">{status}</p> : null}
        </div>
      </article>

      <article className="card phone-card">
        <h2>Chat with {stylistName}</h2>
        <div className="welcome-chat">
          {chat.map((line, idx) => (
            <p key={idx} className={line.role === "assistant" ? "bubble assistant" : "bubble user"}>
              {line.text}
            </p>
          ))}
        </div>
        <form onSubmit={sendLocalChat} className="grid">
          <input value={typing} onChange={(e) => setTyping(e.target.value)} placeholder={`Message ${stylistName}...`} />
          <button type="submit">Send</button>
        </form>
      </article>
    </section>
  );
}
