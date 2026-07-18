"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuctionIntent, Round } from "@cookout/shared";
import { api } from "../lib/api";
import { chainClaimFill, chainRedeem, walletTokenBalanceWei } from "../lib/chainTx";
import { useSession } from "../lib/session";

/**
 * Post-settlement wallet actions for on-chain rounds — the contracts are
 * pull-based, so players claim rather than being pushed funds:
 *  - claim(id): auction tokens + refund for each of your intents
 *  - redeem(tokens): uniform-price exit after a non-graduated round ends
 * Rendered only for rounds with a chain block, from live through results.
 */
export function ChainActions({ round, onChanged }: { round: Round; onChanged: () => void }) {
  const { profile } = useSession();
  const [intents, setIntents] = useState<AuctionIntent[]>([]);
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [tokenBal, setTokenBal] = useState<bigint>(0n);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    if (!profile || !round.chain) return;
    api<{ intents: AuctionIntent[] }>(`/api/rounds/${round.id}/me`)
      .then((d) => setIntents(d.intents))
      .catch(() => {});
    walletTokenBalanceWei(round).then(setTokenBal).catch(() => {});
  }, [round, profile]);
  useEffect(refresh, [refresh, round.state]);

  if (!profile || !round.chain) return null;
  const settled = round.state === "live" || round.state === "ended" || round.state === "results";
  if (!settled) return null;

  const redeemable = round.state === "results" && !round.graduated && tokenBal > 0n;
  const claimable = intents.filter((i) => !claimed.has(i.id));
  if (claimable.length === 0 && !redeemable) return null;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setError("");
    setPending(key);
    try {
      await fn();
      refresh();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending("");
    }
  };

  return (
    <div className="rounded-xl border border-amber-400/40 bg-amber-500/[0.04] p-4">
      <div className="mb-2 text-sm font-black text-amber-300">⛓️ Your on-chain claims</div>
      <div className="space-y-2">
        {claimable.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-zinc-300">
              Auction intent <span className="font-mono">#{i.id}</span> ·{" "}
              <span className="font-mono">{i.ethAmount} ETH</span> — claim your tokens &amp; any
              refund
            </span>
            <button
              disabled={pending !== ""}
              onClick={() =>
                void run(`claim-${i.id}`, async () => {
                  await chainClaimFill(round, i.id);
                  setClaimed((s) => new Set(s).add(i.id));
                })
              }
              className="rounded bg-amber-400 px-3 py-1.5 text-xs font-black text-zinc-950 hover:bg-amber-300 disabled:opacity-50"
            >
              {pending === `claim-${i.id}` ? "Confirm in wallet…" : "Claim"}
            </button>
          </div>
        ))}
        {redeemable && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-zinc-300">
              Round over (no graduation) — redeem{" "}
              <span className="font-mono">{Number(tokenBal / 10n ** 18n).toLocaleString()}</span>{" "}
              tokens at the uniform exit price
            </span>
            <button
              disabled={pending !== ""}
              onClick={() => void run("redeem", () => chainRedeem(round, tokenBal))}
              className="rounded bg-amber-400 px-3 py-1.5 text-xs font-black text-zinc-950 hover:bg-amber-300 disabled:opacity-50"
            >
              {pending === "redeem" ? "Confirm in wallet…" : "Redeem all"}
            </button>
          </div>
        )}
      </div>
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
      <p className="mt-2 text-[11px] text-zinc-500">
        Pull-based by design: funds sit in the round&apos;s own contracts until you claim them.
        Approvals are exact-amount to this round&apos;s pool only.
      </p>
    </div>
  );
}
