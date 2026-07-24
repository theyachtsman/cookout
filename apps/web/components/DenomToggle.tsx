"use client";

/** A compact native/USD pill toggle, used on the Arena Account displays. */
export function DenomToggle({
  usd,
  onChange,
  native = "pETH",
}: {
  usd: boolean;
  onChange: (v: boolean) => void;
  native?: string;
}) {
  return (
    <span className="flex overflow-hidden rounded-full border border-zinc-800 text-[10px] font-bold">
      {(
        [
          [false, native],
          [true, "USD"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(v)}
          className={`px-2 py-0.5 transition ${
            usd === v ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {label}
        </button>
      ))}
    </span>
  );
}
