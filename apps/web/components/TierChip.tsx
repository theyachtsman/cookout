import type { RiskTier } from "@cookout/shared";

/** Compact risk-tier badge shown wherever a concept or match is listed. */
const STYLE: Record<RiskTier, string> = {
  rookie: "bg-zinc-800 text-zinc-400",
  standard: "bg-amber-500/15 text-amber-300",
  degen: "bg-red-500/15 text-red-300",
};

export function TierChip({ tier }: { tier?: RiskTier }) {
  const t: RiskTier = tier ?? "rookie";
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${STYLE[t]}`}>
      {t}
    </span>
  );
}
