"use client";

import { useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { waitForAuthInit } from "@/lib/auth";
import { localStore } from "@/lib/localStore";
import { loadProfile } from "@/lib/persistence";
import { Occasion } from "@/types/models";

const options: Occasion[] = ["casual", "party", "festival", "work", "date"];

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
      setUserId(user.id);
      const saved = localStore.getOccasion(user.id) as Occasion;
      if (saved) setOccasion(saved);
    });
  }, [router]);

  function continueToStylist() {
    if (!userId) return;
    localStore.setOccasion(userId, occasion);
    router.push("/stylist");
  }

  return (
    <section className="card phone-single">
      <h1>Select Occasion</h1>
      <p className="small">The stylist uses this context for suggestions and dress feedback.</p>

      <div className="grid cols-3">
        {options.map((o) => (
          <button key={o} className={o === occasion ? "" : "secondary"} onClick={() => setOccasion(o)}>
            {o}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={continueToStylist}>Continue to AI Stylist Chat</button>
      </div>
    </section>
  );
}
