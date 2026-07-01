import { redirect } from "next/navigation";

export default async function LegacyTournamentRoutePage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const companyRaw = params.company;
  const idRaw = params.tournamentId || params.id || params.inventorySlug;

  const company = Array.isArray(companyRaw) ? companyRaw[0] : companyRaw;
  const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;

  if (id) {
    redirect(`/bird-dog/tournament/${encodeURIComponent(id)}/teams?company=${encodeURIComponent(company || "PG")}`);
  }

  redirect("/bird-dog");
}
