"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/welcome");
  }, [router]);

  return (
    <section className="card phone-single">
      <h1>MirrorMe</h1>
      <p className="small">Loading your welcome room...</p>
    </section>
  );
}
