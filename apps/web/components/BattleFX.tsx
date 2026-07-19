"use client";

/**
 * The battle FX layer — screen flashes and shockwaves over the chart column
 * so the live arena feels like a firefight. Rendered inside a relative
 * container; every effect self-expires (the page prunes the list).
 */

export type FxKind = "buy" | "sell" | "whale" | "milestone" | "rug" | "graduated" | "ath";

export interface FxEvent {
  id: number;
  kind: FxKind;
}

const FLASH: Record<Exclude<FxKind, "whale">, string> = {
  buy: "bg-gradient-to-t from-emerald-500/50 via-emerald-500/10 to-transparent",
  sell: "bg-gradient-to-t from-red-600/50 via-red-500/10 to-transparent",
  milestone: "bg-gradient-to-t from-amber-400/40 via-amber-400/10 to-transparent",
  rug: "bg-red-700/50",
  graduated: "bg-gradient-to-t from-lime-400/45 via-emerald-400/10 to-transparent",
  ath: "bg-gradient-to-b from-lime-300/35 via-transparent to-transparent",
};

export function BattleFX({ events }: { events: FxEvent[] }) {
  return (
    <>
      {events.map((e) =>
        e.kind === "whale" ? (
          <div key={e.id}>
            <div className="fx-ring border-amber-400" />
            <div className="fx-flash bg-amber-500/25" />
          </div>
        ) : (
          <div key={e.id} className={`fx-flash ${FLASH[e.kind]}`} />
        ),
      )}
    </>
  );
}
