import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Project Bird Dog"
};

export default function BirdDogTournamentLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return children;
}
