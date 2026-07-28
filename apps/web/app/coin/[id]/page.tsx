import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { TokenConcept } from "@cookout/shared";
import { CoinCard } from "../../../components/CoinCard";

/**
 * A shareable, server-rendered landing page for a single coin concept. Its
 * whole job is to unfurl beautifully when someone shills the coin on X or
 * Telegram: per-coin OpenGraph/Twitter tags point og:image at the API's image
 * endpoint (a real, fetchable file — crawlers can't read a data-URL buried in
 * JSON), so the tweet card shows the coin's art. Humans get the coin card and a
 * one-tap route to vote.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thecookout.fun").replace(/\/$/, "");
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

async function getConcept(id: string): Promise<TokenConcept | null> {
  try {
    const res = await fetch(`${API_URL}/api/concepts/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as TokenConcept;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const c = await getConcept(id);
  if (!c) return { title: "Coin not found · The Cookout" };
  const title = `$${c.symbol} · ${c.name} · Vote it onto the grill`;
  const description = `${c.theme}. Up for a vote at The Cookout. Send $${c.symbol} to the Cook Out and get ready.`;
  // The rendered coin card (same image the Telegram broadcasts lead with).
  const image = `${SITE_URL}/coin/${c.id}/opengraph-image`;
  const url = `${SITE_URL}/coin/${c.id}`;
  return {
    title,
    description,
    openGraph: {
      type: "website",
      siteName: "The Cookout",
      url,
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: `$${c.symbol} ${c.name}` }],
    },
    twitter: {
      card: "summary_large_image",
      site: "@hoodcookout",
      title,
      description,
      images: [image],
    },
  };
}

export default async function CoinSharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getConcept(id);
  if (!c) notFound();

  const voteHref = `/vote#coin-${c.id}`;

  return (
    <div className="mx-auto max-w-md space-y-5 py-6">
      <div className="text-center">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">
          Fresh on the grill
        </div>
        <h1 className="mt-2 text-2xl font-black tracking-tight">
          ${c.symbol} is up for a vote.
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Hit the vote bar and {c.name} heads straight to the Cook Out. Get ready.
        </p>
      </div>

      <CoinCard coin={c} />

      <div className="flex flex-col gap-2">
        <Link
          href={voteHref}
          className="rounded-xl bg-lime-400 px-6 py-3 text-center font-black text-zinc-950 transition hover:bg-lime-300"
        >
          🗳️ Vote for ${c.symbol}
        </Link>
        <Link
          href="/matches"
          className="rounded-xl border border-zinc-700 px-6 py-3 text-center font-bold text-zinc-200 transition hover:border-zinc-500"
        >
          🔥 Watch the Cook Out
        </Link>
      </div>
    </div>
  );
}
