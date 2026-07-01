import { redirect } from "next/navigation";

export default async function TournamentRootRedirectPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const companyRaw = query.company;
  const company = Array.isArray(companyRaw) ? companyRaw[0] : companyRaw;
  redirect(`/bird-dog/tournament/${encodeURIComponent(id)}/teams?company=${encodeURIComponent(company || "PG")}`);
}
