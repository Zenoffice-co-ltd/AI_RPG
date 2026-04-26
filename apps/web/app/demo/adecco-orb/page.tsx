import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type DemoPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LegacyAdeccoOrbPage({ searchParams }: DemoPageProps) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    const firstValue = Array.isArray(value) ? value[0] : value;
    if (firstValue) {
      params.set(key, firstValue);
    }
  }
  const query = params.toString();
  const path = `/demo/adecco-roleplay${query ? `?${query}` : ""}`;
  redirect(path as never);
}
