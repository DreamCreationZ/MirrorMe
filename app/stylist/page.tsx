"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { localStore } from "@/lib/localStore";
import { loadCloset, loadProfile } from "@/lib/persistence";
import { ClosetItem, SavedLook, SessionFeedback, StylistMessage, StylistRecommendation, UserProfile } from "@/types/models";

const INITIAL_MESSAGE: StylistMessage = {
  role: "assistant",
  content:
    "I am your brutally honest stylist. Share your outfit idea and upload your dress or your photo. I will give direct, practical feedback.",
  recommendation: {
    verdict: "GOOD",
    confidence: 75,
    whyThisWorks: [
      "I will use your saved profile and occasion for personalized recommendations.",
      "I will explain exactly why an outfit works or fails."
    ],
    alternatives: ["Share one outfit idea to get your first recommendation."],
    timeSavingTip: "Use clear outfit details and your occasion to get faster suggestions."
  }
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function StylistPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [closet, setCloset] = useState<ClosetItem[]>([]);
  const [occasion, setOccasion] = useState("casual");

  const [messages, setMessages] = useState<StylistMessage[]>([INITIAL_MESSAGE]);
  const [savedLooks, setSavedLooks] = useState<SavedLook[]>([]);

  const [input, setInput] = useState("");
  const [userPhoto, setUserPhoto] = useState("");
  const [dressPhoto, setDressPhoto] = useState("");
  const [loading, setLoading] = useState(false);

  const [rating, setRating] = useState(4);
  const [liked, setLiked] = useState(true);
  const [comment, setComment] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("");

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

      const saved = localStore.getStylistMessages(user.id);
      if (saved.length) {
        setMessages(saved);
      } else {
        localStore.setStylistMessages(user.id, [INITIAL_MESSAGE]);
      }
    });
  }, [router]);

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

  function persistLooks(next: SavedLook[]) {
    setSavedLooks(next);
    if (userId) localStore.setSavedLooks(userId, next);
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
        body: JSON.stringify({ messages: next, profile, closet, occasion })
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
    } finally {
      setLoading(false);
    }
  }

  function clearConversation() {
    const reset = [INITIAL_MESSAGE];
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
        <h2>AI Stylist Chat</h2>
        <p className="small">
          Occasion: <strong>{occasion || "casual"}</strong>
        </p>
        <div className="grid" style={{ maxHeight: 440, overflow: "auto", marginBottom: 12 }}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === "user" ? "end" : "start",
                maxWidth: "85%",
                background: m.role === "user" ? "#f0d8cf" : "#f6ecdf",
                borderRadius: 12,
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
                    {m.recommendation.whyThisWorks.map((point, idx) => (
                      <li key={idx} className="small">{point}</li>
                    ))}
                  </ul>
                  <p className="small" style={{ marginBottom: 6 }}>Alternative option:</p>
                  <ul style={{ margin: "0 0 8px 18px", padding: 0 }}>
                    {m.recommendation.alternatives.map((alt, idx) => (
                      <li key={idx} className="small">{alt}</li>
                    ))}
                  </ul>
                  <p className="small" style={{ margin: 0 }}>
                    Time-saving tip: <strong>{m.recommendation.timeSavingTip}</strong>
                  </p>
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
            placeholder="Describe your planned outfit, colors, and mood..."
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
            <button type="submit" disabled={loading}>{loading ? "Thinking..." : "Ask Stylist"}</button>
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
              {!look.wornAt ? (
                <button type="button" className="secondary" onClick={() => markAsWorn(look.id)}>Mark as Worn</button>
              ) : null}
            </div>
          ))}
        </div>

        <h3 style={{ marginTop: 16 }}>Session Context</h3>
        <p className="small">Recommendations use your saved profile, closet, occasion, and conversation memory.</p>
        <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify({ profile, closetCount: closet.length, occasion, messages: messages.length, savedLooks: savedLooks.length }, null, 2)}
        </pre>
        <Link href="/try-on">
          <button>Go to Virtual Try-On</button>
        </Link>
      </article>
    </section>
  );
}
