"use client";

import { useCallback, useEffect, useState } from "react";
import type { CosmeticDef, EquippedCosmetics } from "@cookout/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

const SLOT_OF: Record<string, keyof EquippedCosmetics> = {
  title: "title",
  badge: "badge",
  chat_color: "chatColor",
  frame: "frame",
};

const TYPE_LABEL: Record<string, string> = {
  badge: "Badges",
  title: "Titles",
  chat_color: "Chat Colors",
  frame: "Profile Frames",
};

export function CosmeticsLocker() {
  const { profile } = useSession();
  const [all, setAll] = useState<CosmeticDef[]>([]);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [equipped, setEquipped] = useState<EquippedCosmetics>({});

  const load = useCallback(() => {
    if (!profile) return;
    api<{ unlocked: CosmeticDef[]; equipped: EquippedCosmetics; all: CosmeticDef[] }>(
      "/api/me/cosmetics",
    )
      .then((d) => {
        setAll(d.all);
        setUnlocked(new Set(d.unlocked.map((c) => c.id)));
        setEquipped(d.equipped);
      })
      .catch(() => {});
  }, [profile]);
  useEffect(load, [load]);

  if (!profile) return null;

  const toggle = async (c: CosmeticDef) => {
    const slot = SLOT_OF[c.type]!;
    const next = equipped[slot] === c.id ? null : c.id;
    await api("/api/me/cosmetics", { method: "PATCH", body: { [slot]: next } });
    load();
  };

  const unlockText = (c: CosmeticDef) =>
    c.unlock.level !== undefined
      ? `level ${c.unlock.level}`
      : c.unlock.achievement !== undefined
        ? `achievement: ${c.unlock.achievement.replace(/_/g, " ")}`
        : `season top ${c.unlock.seasonTop}`;

  return (
    <div>
      <h2 className="mb-1 text-lg font-bold">Cosmetics</h2>
      <p className="mb-3 text-xs text-zinc-500">
        Cosmetic only — unlocked by playing, never purchasable, never pay-to-win.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {(["badge", "title", "chat_color", "frame"] as const).map((type) => (
          <div key={type} className="rounded-xl border border-zinc-800 p-4">
            <h3 className="mb-2 text-sm font-bold text-zinc-300">{TYPE_LABEL[type]}</h3>
            <div className="flex flex-wrap gap-2">
              {all
                .filter((c) => c.type === type)
                .map((c) => {
                  const isUnlocked = unlocked.has(c.id);
                  const isEquipped = equipped[SLOT_OF[c.type]!] === c.id;
                  return (
                    <button
                      key={c.id}
                      disabled={!isUnlocked}
                      onClick={() => void toggle(c)}
                      title={isUnlocked ? (isEquipped ? "click to unequip" : "click to equip") : `unlocks at ${unlockText(c)}`}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                        isEquipped
                          ? "border-amber-500 bg-amber-500/15 font-bold"
                          : isUnlocked
                            ? "border-zinc-700 hover:border-zinc-500"
                            : "border-zinc-800 opacity-40"
                      }`}
                    >
                      {type === "chat_color" ? (
                        <span style={{ color: c.value }}>■ {c.name}</span>
                      ) : type === "badge" ? (
                        <span>
                          {c.value} {c.name}
                        </span>
                      ) : (
                        c.name
                      )}
                      {!isUnlocked && <span className="ml-1.5 text-[10px] text-zinc-500">🔒 {unlockText(c)}</span>}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
