"use client";

import { useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, waitForAuthInit } from "@/lib/auth";
import { localStore } from "@/lib/localStore";
import { loadProfile } from "@/lib/persistence";
import { hasActiveSubscription, loadBilling } from "@/lib/subscription";
import { Occasion } from "@/types/models";

const options: Occasion[] = ["casual", "party", "festival", "work", "date"];
const labels: Record<Occasion, { icon: string; title: string }> = {
  work: { icon: "💼", title: "Work" },
  casual: { icon: "👕", title: "Casual" },
  party: { icon: "🎉", title: "Party" },
  festival: { icon: "✨", title: "Festival" },
  date: { icon: "❤️", title: "Date Night" }
};

export default function OccasionPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [occasion, setOccasion] = useState<Occasion>("casual");

  useEffect(() => {
    waitForAuthInit().then(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      const profile = await loadProfile(user.id);
      if (!profile?.frontImageUrl) {
        router.replace("/welcome");
        return;
      }
      const billing = await loadBilling(user.id);
      if (!hasActiveSubscription(billing)) {
        router.replace("/subscribe");
        return;
      }
      setUserId(user.id);
      const saved = localStore.getOccasion(user.id) as Occasion;
      if (saved) setOccasion(saved);
    });
  }, [router]);

  function continueToStylist() {
    const resolvedUserId = userId || getCurrentUser()?.id || "";
    if (!resolvedUserId) return;
    localStore.setOccasion(resolvedUserId, occasion);
    localStore.setStylistOccasionHandoff(resolvedUserId, occasion);
    router.push(`/stylist?from=occasion&occasion=${encodeURIComponent(occasion)}`);
  }

  return (
    <section className="lux-stage">
      <article className="lux-phone lux-occasion-phone">
        <h4>What&apos;s the Occasion?</h4>
        <div className="lux-tile-grid">
          {options.map((o) => (
            <button
              key={o}
              className={o === occasion ? "lux-tile lux-tile-active" : "lux-tile"}
              onClick={() => setOccasion(o)}
            >
              <span>{labels[o].icon}</span>
              {labels[o].title}
            </button>
          ))}
          <button className="lux-tile secondary" type="button">
            <span>🎯</span>
            Custom
          </button>
        </div>
        <button className="lux-footer" onClick={continueToStylist}>Continue</button>
      </article>
    </section>
  );
}
