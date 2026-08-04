"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ROLE_MAP, type CcModule, type Permission, type SearchHit } from "@cookout/shared";
import { CcAuthError, can, cc, ccToken, setCcAdminKey, setCcToken, type CcSession } from "../../lib/cc";
import { CcLogin } from "../../components/cc/CcLogin";
import {
  AccountModule,
  AuditModule,
  BackupsModule,
  ComingSoon,
  DashboardModule,
  FlagsModule,
  TeamModule,
} from "../../components/cc/CcModules";
import { GameConfigModule } from "../../components/cc/GameConfig";
import { CopyEditorModule } from "../../components/cc/CopyEditor";
import { AnalyticsModule } from "../../components/cc/Analytics";
import { PlayersModule } from "../../components/cc/Players";
import { TelegramModule } from "../../components/cc/Telegram";
import { MediaModule } from "../../components/cc/MediaLibrary";
import { AudioModule, BrandingModule, ThemesModule } from "../../components/cc/Presentation";
import { LegacyOps } from "./LegacyOps";

/**
 * The Cookout Command Center — the platform's internal operations hub.
 *
 * This replaces the old single-page /admin. The shell owns sign-in, the module
 * nav, and global search; each module is an independent panel, so a new one is
 * an entry in MODULES plus a component, never a restructure.
 *
 * Authorization is advisory here and authoritative on the server: modules the
 * signed-in operator lacks the permission for are hidden, and every request
 * they do make is re-checked against their stored account.
 */

interface ModuleDef {
  key: CcModule | "account";
  label: string;
  icon: string;
  permission?: Permission;
  group: string;
}

const MODULES: ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", icon: "📊", group: "Overview" },
  { key: "users", label: "Players", icon: "👥", permission: "users.view", group: "Operations" },
  { key: "moderation", label: "Moderation", icon: "🛡️", permission: "users.moderate", group: "Operations" },
  { key: "game", label: "Game Configuration", icon: "🎛️", permission: "game.config", group: "Operations" },
  { key: "economy", label: "Economy & BURGERS", icon: "🍔", permission: "game.config", group: "Operations" },
  { key: "telegram", label: "Telegram", icon: "✈️", permission: "telegram.manage", group: "Operations" },
  { key: "goons", label: "Flame Goon Squad", icon: "🔥", permission: "content.manage", group: "Operations" },
  { key: "content", label: "Site Copy", icon: "📜", permission: "content.manage", group: "Content" },
  { key: "branding", label: "Branding", icon: "🎨", permission: "assets.manage", group: "Content" },
  { key: "themes", label: "Theme Studio", icon: "🎭", permission: "themes.manage", group: "Content" },
  { key: "media", label: "Media Library", icon: "🖼️", permission: "assets.manage", group: "Content" },
  { key: "audio", label: "Audio Manager", icon: "🔊", permission: "assets.manage", group: "Content" },
  { key: "nft", label: "NFTs", icon: "🃏", permission: "content.manage", group: "Content" },
  { key: "analytics", label: "Analytics", icon: "📈", permission: "analytics.view", group: "Platform" },
  { key: "flags", label: "Feature Flags", icon: "🚩", permission: "flags.manage", group: "Platform" },
  { key: "audit", label: "Audit Log", icon: "📋", permission: "audit.view", group: "Platform" },
  { key: "backups", label: "Backups", icon: "💾", permission: "backups.manage", group: "Platform" },
  { key: "team", label: "Team", icon: "🔑", permission: "staff.view", group: "Administration" },
  { key: "account", label: "Your Account", icon: "👤", group: "Administration" },
];

export default function CommandCenter() {
  const [session, setSession] = useState<CcSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [active, setActive] = useState<ModuleDef["key"]>("dashboard");
  const [navOpen, setNavOpen] = useState(false);

  const loadSession = useCallback(async () => {
    try {
      const me = await cc<CcSession>("/api/cc/me");
      setSession(me);
    } catch {
      setSession(null);
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // Deep links from search results: /admin?module=users
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("module");
    if (m && MODULES.some((x) => x.key === m)) setActive(m as ModuleDef["key"]);
  }, []);

  const visible = useMemo(
    () => MODULES.filter((m) => can(session, m.permission)),
    [session],
  );

  const signOut = async () => {
    try {
      if (ccToken()) await cc("/api/cc/logout", { body: {} });
    } catch {
      /* the session may already be gone — clearing locally is what matters */
    }
    setCcToken(null);
    setCcAdminKey(null);
    setSession(null);
  };

  if (!checked)
    return <div className="py-24 text-center text-sm text-zinc-600">Opening the Command Center…</div>;

  if (!session) return <CcLogin onSignedIn={() => void loadSession()} />;

  const current = visible.find((m) => m.key === active) ?? visible[0]!;

  return (
    <div className="flex min-h-[80vh] gap-5">
      {/* nav */}
      <aside
        className={`${navOpen ? "block" : "hidden"} w-56 shrink-0 lg:block`}
      >
        <div className="sticky top-4 space-y-4">
          <div className="rounded-2xl bg-zinc-950 p-3 ring-1 ring-white/10">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-lime-300">Command Center</div>
            <div className="mt-1 truncate text-sm font-black text-zinc-100">
              {session.account.displayName ?? session.account.username}
            </div>
            <div className="text-[11px] text-zinc-500">
              {ROLE_MAP[session.account.role]?.label ?? session.account.role}
              {session.viaKey && " · via admin key"}
            </div>
            <button
              onClick={() => void signOut()}
              className="mt-2 w-full rounded-lg bg-zinc-800 px-2 py-1.5 text-[11px] font-bold text-zinc-300 hover:bg-zinc-700"
            >
              Sign out
            </button>
          </div>

          {[...new Set(visible.map((m) => m.group))].map((group) => (
            <div key={group}>
              <div className="mb-1 px-2 text-[10px] font-black uppercase tracking-wide text-zinc-600">
                {group}
              </div>
              <div className="space-y-0.5">
                {visible
                  .filter((m) => m.group === group)
                  .map((m) => (
                    <button
                      key={m.key}
                      onClick={() => {
                        setActive(m.key);
                        setNavOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-bold transition ${
                        active === m.key
                          ? "bg-lime-400 text-zinc-950"
                          : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
                      }`}
                    >
                      <span>{m.icon}</span>
                      <span className="min-w-0 truncate">{m.label}</span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* content */}
      <main className="min-w-0 flex-1 space-y-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setNavOpen((v) => !v)}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold text-zinc-200 lg:hidden"
          >
            ☰
          </button>
          <h1 className="text-xl font-black text-zinc-50">
            {current.icon} {current.label}
          </h1>
          <div className="ml-auto w-full max-w-xs">
            <GlobalSearch onGo={(m) => setActive(m as ModuleDef["key"])} />
          </div>
        </div>

        {session.mustChangePassword && active !== "account" && (
          <div className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">
            Your password was set by an administrator.{" "}
            <button onClick={() => setActive("account")} className="font-black underline">
              Change it now
            </button>
            .
          </div>
        )}

        <ModuleBody
          module={current.key}
          session={session}
          onGo={(m) => setActive(m as ModuleDef["key"])}
          onSessionChanged={() => void loadSession()}
        />
      </main>
    </div>
  );
}

function ModuleBody({
  module,
  session,
  onGo,
  onSessionChanged,
}: {
  module: ModuleDef["key"];
  session: CcSession;
  onGo: (m: string) => void;
  onSessionChanged: () => void;
}) {
  switch (module) {
    case "dashboard":
      return <DashboardModule onGo={onGo} />;
    case "flags":
      return <FlagsModule />;
    case "audit":
      return <AuditModule />;
    case "team":
      return <TeamModule session={session} />;
    case "account":
      return <AccountModule session={session} onChanged={onSessionChanged} />;
    case "backups":
      return <BackupsModule />;
    case "game":
      return <GameConfigModule />;
    case "content":
      return <CopyEditorModule />;
    case "telegram":
      return <TelegramModule />;
    case "analytics":
      return <AnalyticsModule />;
    case "users":
      return <PlayersModule session={session} />;
    case "media":
      return <MediaModule />;
    case "branding":
      return <BrandingModule />;
    case "themes":
      return <ThemesModule />;
    case "audio":
      return <AudioModule />;
    // These run on the established ops surface — the panels that already
    // manage them are mounted here rather than rewritten.
    case "moderation":
    case "economy":
    case "goons":
      return (
        <div className="space-y-4">
          <div className="rounded-xl bg-zinc-900/40 p-3 text-[11px] text-zinc-500">
            Live ops console. These controls run against the existing operations API and are
            authenticated by your Command Center session.
          </div>
          <LegacyOps />
        </div>
      );
    case "nft":
      return (
        <ComingSoon
          title="NFTs"
          note="There is no player-facing NFT or Recruit Cooler system yet — only reward hooks (BURGER sources 'nft' and 'loot_box', both disabled). Both are behind feature flags; this module lands with the gameplay it manages."
        />
      );
    default:
      return null;
  }
}

/** One search box across players, coins, settings, flags, staff and the log. */
function GlobalSearch({ onGo }: { onGo: (module: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      cc<{ hits: SearchHit[] }>(`/api/cc/search?q=${encodeURIComponent(q)}`)
        .then((d) => setHits(d.hits))
        .catch((e) => {
          if (!(e instanceof CcAuthError)) setHits([]);
        });
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const ICON: Record<SearchHit["kind"], string> = {
    user: "👤",
    coin: "🪙",
    round: "🎮",
    setting: "🎛️",
    flag: "🚩",
    staff: "🔑",
    audit: "📋",
    module: "📦",
  };

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search everything…"
        className="w-full rounded-xl bg-zinc-900/70 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
      />
      {open && hits.length > 0 && (
        <div className="absolute right-0 z-40 mt-1 max-h-96 w-96 overflow-y-auto rounded-xl bg-zinc-950 p-1 shadow-2xl ring-1 ring-white/10">
          {hits.map((h) => (
            <button
              key={`${h.kind}-${h.id}`}
              onClick={() => {
                if (h.href?.startsWith("/round")) window.open(h.href, "_blank");
                else onGo(h.module);
                setQ("");
              }}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-800/70"
            >
              <span className="mt-0.5">{ICON[h.kind]}</span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-zinc-100">{h.title}</span>
                {h.subtitle && (
                  <span className="block truncate text-[11px] text-zinc-500">{h.subtitle}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
