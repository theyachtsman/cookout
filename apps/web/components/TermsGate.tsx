"use client";

import { useState } from "react";
import { api } from "../lib/api";

/**
 * The terms + age acknowledgement, shown when the server refuses a session for
 * that reason and only that reason.
 *
 * Deliberately a blocking screen rather than a checkbox tucked into the login
 * flow. This is the record that gets produced if anyone ever asks what the
 * player agreed to and what they said their age was, so it should be as hard
 * to click through absent-mindedly as it is honest about what it is.
 *
 * A region or sanctions refusal never lands here — those are flat rejections,
 * and offering an "accept" button would read as a way around them.
 */
export function TermsGate({
  termsVersion,
  minimumAge,
  privyToken,
  onAccepted,
  onCancel,
}: {
  termsVersion: number;
  minimumAge: number;
  privyToken: string;
  onAccepted: () => void;
  onCancel: () => void;
}) {
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [risk, setRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = age && terms && risk;

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/compliance/accept", { body: { token: privyToken, age: minimumAge } });
      onAccepted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-zinc-900 p-6 ring-1 ring-white/10">
        <h2 className="text-xl font-black text-zinc-50">Before you play</h2>
        <p className="mt-1 text-xs text-zinc-500">Terms v{termsVersion}</p>

        <div className="mt-4 space-y-3">
          {[
            [
              age,
              setAge,
              `I am ${minimumAge} or older.`,
              "We record this, the date, and the region you're in.",
            ],
            [
              terms,
              setTerms,
              "I accept the Terms of Service and Privacy Policy.",
              "Available from the footer at any time.",
            ],
            [
              risk,
              setRisk,
              "I understand I can lose everything I put in.",
              "Coins launched here can go to zero, and most do. Only use money you can afford to lose entirely.",
            ],
          ].map(([checked, set, label, note], i) => (
            <label key={i} className="flex cursor-pointer gap-3 rounded-xl bg-zinc-950/50 p-3">
              <input
                type="checkbox"
                checked={checked as boolean}
                onChange={(e) => (set as (v: boolean) => void)(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-lime-400"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-zinc-200">{label as string}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                  {note as string}
                </span>
              </span>
            </label>
          ))}
        </div>

        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            className="rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:bg-zinc-700"
          >
            Not now
          </button>
          <button
            disabled={!ready || busy}
            onClick={() => void accept()}
            className="flex-1 rounded-xl bg-lime-400 px-4 py-2.5 text-sm font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-40"
          >
            {busy ? "Confirming…" : "Agree and continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
