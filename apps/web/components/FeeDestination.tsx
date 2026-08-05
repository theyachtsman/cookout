"use client";

import { useState } from "react";
import { GRADUATED_PROTOCOL_FEE_BPS } from "@cookout/shared";

/**
 * Where a coin's post-graduation trading fees are paid.
 *
 * Asked at launch rather than at graduation, and that is not a UX choice: the
 * address is burned into an immutable FeeSplitter when the coin graduates, and
 * from then on nobody — not the creator, not an admin, not us — can change it
 * or recover fees sent somewhere wrong. So the commitment has to be made while
 * the creator is still paying attention, and the consequence has to be said out
 * loud rather than buried in a tooltip.
 */
export function FeeDestination({
  value,
  onChange,
  walletAddress,
}: {
  value: string;
  onChange: (next: string) => void;
  walletAddress: string;
}) {
  const [mode, setMode] = useState<"wallet" | "custom">(value ? "custom" : "wallet");
  const creatorPct = (10_000 - GRADUATED_PROTOCOL_FEE_BPS) / 100;
  const valid = /^0x[0-9a-fA-F]{40}$/.test(value.trim());
  const isZero = /^0x0{40}$/i.test(value.trim());

  return (
    <div className="rounded-xl bg-zinc-900/60 p-3 ring-1 ring-white/5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">
        Creator fees after graduation
      </div>
      <p className="mt-1 text-[11px] leading-snug text-zinc-500">
        If this coin graduates, its liquidity locks forever and you keep{" "}
        <b className="text-zinc-300">{creatorPct}% of the pool&apos;s trading fees</b> for as long
        as people trade it. Choose where that gets paid.
      </p>

      <div className="mt-2 flex gap-1">
        {(
          [
            ["wallet", "My Cookout Wallet"],
            ["custom", "Another address"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setMode(k);
              if (k === "wallet") onChange("");
            }}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              mode === k
                ? "bg-lime-400 text-zinc-950"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "wallet" ? (
        <p className="mt-2 break-all font-mono text-[11px] text-zinc-600">
          {walletAddress || "your wallet"}
        </p>
      ) : (
        <div className="mt-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
            placeholder="0x… address that receives your fees"
            spellCheck={false}
            className={`w-full rounded-lg bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200 outline-none ring-1 focus:ring-lime-400/40 ${
              value && !valid ? "ring-red-500/50" : "ring-white/5"
            }`}
          />
          {value && !valid && (
            <p className="mt-1 text-[11px] text-red-400">
              That isn&apos;t a valid address — it should be 0x followed by 40 characters.
            </p>
          )}
          {isZero && (
            <p className="mt-1 text-[11px] text-red-400">
              That address burns the fees. Use one you control.
            </p>
          )}
          <p className="mt-1.5 text-[11px] leading-snug text-amber-300/80">
            ⚠ This is permanent. Once the coin graduates the address is locked into the contract
            forever — a typo, or a wallet you lose access to, means those fees can never be
            recovered by anyone.
          </p>
        </div>
      )}
    </div>
  );
}
