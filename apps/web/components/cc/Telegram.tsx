"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TELEGRAM_EVENTS,
  TELEGRAM_PLACEHOLDERS,
  TELEGRAM_TOPICS,
  nextDue,
  renderTemplate,
  type ScheduledPost,
  type TelegramLogEntry,
  type TelegramSettings,
  type TopicKey,
} from "@cookout/shared";
import { cc } from "../../lib/cc";
import { Panel } from "./CcModules";

/**
 * Telegram operations.
 *
 * Everything here layers over the bot's environment configuration rather than
 * replacing it: a blank field falls through to the env value the process booted
 * with, so a fresh deployment works before anyone opens this page.
 *
 * The player-facing Telegram notification preferences are deliberately NOT
 * here — those live on each player's own Settings page, because they're
 * personal choices rather than platform operations.
 */

interface TelegramData {
  settings: TelegramSettings;
  env: {
    tokenSet: boolean;
    botUsername: string;
    groupChatId: string;
    announcementChatId: string;
    webBase: string;
  };
  connected: boolean;
  botUsername?: string;
  botId?: number;
  logCount: number;
}

type Tab = "bot" | "automation" | "scheduled" | "commands" | "moderation" | "logs";

export function TelegramModule() {
  const [data, setData] = useState<TelegramData | null>(null);
  const [tab, setTab] = useState<Tab>("bot");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    cc<TelegramData>("/api/cc/telegram")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const patch = useCallback(
    async (body: Record<string, unknown>, message?: string) => {
      setError("");
      setNote("");
      try {
        await cc("/api/cc/telegram", { method: "PATCH", body });
        if (message) setNote(message);
        load();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [load],
  );

  if (!data) return <Panel title="Telegram"><div className="text-sm text-zinc-500">Loading…</div></Panel>;
  const s = data.settings;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-zinc-950/95 p-2 ring-1 ring-white/10">
        {(
          [
            ["bot", "Bot & Channels"],
            ["automation", "Notifications"],
            ["scheduled", "Scheduled Posts"],
            ["commands", "Commands"],
            ["moderation", "Moderation"],
            ["logs", "Logs"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${
              tab === k ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => void patch({ enabled: !s.enabled }, s.enabled ? "Automation paused." : "Automation resumed.")}
          className={`ml-auto rounded-lg px-4 py-1.5 text-xs font-black ${
            s.enabled ? "bg-lime-400 text-zinc-950" : "bg-amber-400 text-zinc-950"
          }`}
          title="Master switch for every automated post"
        >
          {s.enabled ? "Automation ON" : "PAUSED"}
        </button>
      </div>

      {tab === "bot" && <BotTab data={data} patch={patch} onError={setError} onNote={setNote} />}
      {tab === "automation" && <AutomationTab settings={s} patch={patch} />}
      {tab === "scheduled" && <ScheduledTab settings={s} reload={load} onError={setError} onNote={setNote} />}
      {tab === "commands" && <CommandsTab settings={s} patch={patch} />}
      {tab === "moderation" && <ModerationTab settings={s} patch={patch} />}
      {tab === "logs" && <LogsTab />}
    </div>
  );
}

type Patch = (body: Record<string, unknown>, message?: string) => Promise<void>;

function Field({
  label,
  value,
  placeholder,
  onSave,
  hint,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold text-zinc-400">{label}</span>
      <input
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(e) => e.target.value !== value && onSave(e.target.value)}
        className="mt-0.5 w-full rounded-lg bg-zinc-900 px-3 py-2 font-mono text-sm outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
      />
      {hint && <span className="mt-0.5 block text-[10px] text-zinc-600">{hint}</span>}
    </label>
  );
}

function BotTab({
  data,
  patch,
  onError,
  onNote,
}: {
  data: TelegramData;
  patch: Patch;
  onError: (m: string) => void;
  onNote: (m: string) => void;
}) {
  const s = data.settings;
  const [testTopic, setTestTopic] = useState<TopicKey>("general");
  const [testText, setTestText] = useState("");

  return (
    <div className="space-y-4">
      <Panel
        title="Connection"
        subtitle="The bot token stays in the server environment — it is never editable or readable from here"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-zinc-950/60 p-3">
            <div className="text-[10px] uppercase text-zinc-500">Status</div>
            <div className={`font-mono text-lg font-black ${data.connected ? "text-lime-300" : "text-red-300"}`}>
              {data.connected ? "online" : data.env.tokenSet ? "not responding" : "no token"}
            </div>
            {!data.env.tokenSet && (
              <div className="text-[10px] text-zinc-600">Set TELEGRAM_BOT_TOKEN and restart</div>
            )}
          </div>
          <div className="rounded-xl bg-zinc-950/60 p-3">
            <div className="text-[10px] uppercase text-zinc-500">Bot</div>
            <div className="truncate font-mono text-lg font-black text-zinc-100">
              {data.botUsername ? `@${data.botUsername}` : "—"}
            </div>
            {data.botId && <div className="text-[10px] text-zinc-600">id {data.botId}</div>}
          </div>
          <div className="rounded-xl bg-zinc-950/60 p-3">
            <div className="text-[10px] uppercase text-zinc-500">Automated posts</div>
            <div className={`font-mono text-lg font-black ${s.enabled ? "text-lime-300" : "text-amber-300"}`}>
              {s.enabled ? "on" : "paused"}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Channels & groups" subtitle="Leave a field blank to keep using the environment value">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Group chat id"
            value={s.groupChatId}
            placeholder={data.env.groupChatId || "-1001234567890"}
            hint={data.env.groupChatId ? `Env: ${data.env.groupChatId}` : "Not set in the environment"}
            onSave={(v) => void patch({ groupChatId: v }, "Group updated.")}
          />
          <Field
            label="Announcement channel id"
            value={s.announcementChatId}
            placeholder={data.env.announcementChatId || "(optional, separate channel)"}
            hint="Only if Announcements is a separate channel rather than a topic"
            onSave={(v) => void patch({ announcementChatId: v }, "Channel updated.")}
          />
          <Field
            label="Bot username"
            value={s.botUsername}
            placeholder={data.env.botUsername}
            hint="Used to build account-link deep links"
            onSave={(v) => void patch({ botUsername: v })}
          />
          <Field
            label="Website base URL"
            value={s.webBase}
            placeholder={data.env.webBase || "https://www.thecookout.fun"}
            onSave={(v) => void patch({ webBase: v })}
          />
          <Field
            label="Group invite link"
            value={s.groupInvite}
            placeholder="https://t.me/+…"
            hint="Shown as a one-tap Join button after a player links their account"
            onSave={(v) => void patch({ groupInvite: v })}
          />
        </div>
      </Panel>

      <Panel
        title="Forum topics"
        subtitle="Thread ids inside the group. Anything unset falls back to General."
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {TELEGRAM_TOPICS.map((t) => (
            <Field
              key={t.key}
              label={t.label}
              value={s.topics[t.key] === undefined ? "" : String(s.topics[t.key])}
              placeholder="thread id"
              hint={t.description}
              onSave={(v) => void patch({ topics: { [t.key]: v === "" ? null : Number(v) } })}
            />
          ))}
        </div>
      </Panel>

      <Panel title="Send a test message" subtitle="Confirms the chat id, the topic and the bot's posting rights">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-400">Topic</span>
            <select
              value={testTopic}
              onChange={(e) => setTestTopic(e.target.value as TopicKey)}
              className="mt-0.5 rounded-lg bg-zinc-900 px-2 py-2 text-sm ring-1 ring-white/10"
            >
              {TELEGRAM_TOPICS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <input
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="🔧 Command Center test message."
            className="min-w-[16rem] flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
          />
          <button
            onClick={() =>
              void cc("/api/cc/telegram/test", { body: { topic: testTopic, text: testText } })
                .then(() => onNote("Test message delivered."))
                .catch((e) => onError((e as Error).message))
            }
            className="rounded-lg bg-lime-400 px-4 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
          >
            Send test
          </button>
        </div>
      </Panel>
    </div>
  );
}

function AutomationTab({ settings, patch }: { settings: TelegramSettings; patch: Patch }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = [...new Set(TELEGRAM_EVENTS.map((e) => e.group))];
  return (
    <div className="space-y-4">
      <Panel title="Placeholders" subtitle="Usable in any template below">
        <div className="flex flex-wrap gap-1.5">
          {TELEGRAM_PLACEHOLDERS.map((p) => (
            <span
              key={p.key}
              title={p.description}
              className="rounded bg-zinc-800 px-2 py-1 font-mono text-[11px] text-lime-300"
            >
              {`{${p.key}}`}
            </span>
          ))}
        </div>
      </Panel>

      {groups.map((group) => (
        <Panel key={group} title={group}>
          <div className="space-y-2">
            {TELEGRAM_EVENTS.filter((e) => e.group === group).map((e) => {
              const cfg = settings.events[e.key] ?? { enabled: true, template: "" };
              const expanded = open === e.key;
              return (
                <div key={e.key} className="rounded-xl bg-zinc-950/50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black text-zinc-100">{e.label}</div>
                      <div className="text-[11px] text-zinc-500">{e.description}</div>
                    </div>
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-400">
                      → {cfg.topic ?? e.topic}
                    </span>
                    <button
                      onClick={() => setOpen(expanded ? null : e.key)}
                      className="rounded bg-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-300 hover:bg-zinc-700"
                    >
                      {expanded ? "Close" : "Template"}
                    </button>
                    <button
                      onClick={() => void patch({ events: { [e.key]: { enabled: !cfg.enabled } } })}
                      className={`rounded-full px-3 py-1 text-[11px] font-black ${
                        cfg.enabled ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {cfg.enabled ? "ON" : "OFF"}
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-3 space-y-2">
                      <div className="text-[11px] text-zinc-500">
                        Leave blank to keep the bot&apos;s built-in copy, which carries buttons and
                        the rendered coin card — a plain template can&apos;t. Available here:{" "}
                        {e.placeholders.map((p) => `{${p}}`).join(" ") || "none"}
                      </div>
                      <textarea
                        defaultValue={cfg.template}
                        rows={3}
                        placeholder="(built-in copy)"
                        onBlur={(ev) =>
                          ev.target.value !== cfg.template &&
                          void patch({ events: { [e.key]: { template: ev.target.value } } }, "Template saved.")
                        }
                        className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
                      />
                      {cfg.template && (
                        <div className="rounded-lg bg-zinc-900/60 p-2 text-[11px] text-zinc-300">
                          <span className="font-bold text-zinc-500">Preview: </span>
                          {renderTemplate(
                            cfg.template,
                            Object.fromEntries(e.placeholders.map((p) => [p, `[${p}]`])),
                          )}
                        </div>
                      )}
                      <label className="block">
                        <span className="text-[11px] font-bold text-zinc-400">Post to</span>
                        <select
                          value={cfg.topic ?? e.topic}
                          onChange={(ev) => void patch({ events: { [e.key]: { topic: ev.target.value } } })}
                          className="ml-2 rounded-lg bg-zinc-900 px-2 py-1 text-xs ring-1 ring-white/10"
                        >
                          {TELEGRAM_TOPICS.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      ))}
    </div>
  );
}

function ScheduledTab({
  settings,
  reload,
  onError,
  onNote,
}: {
  settings: TelegramSettings;
  reload: () => void;
  onError: (m: string) => void;
  onNote: (m: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    text: "",
    topic: "announcements" as TopicKey,
    cadence: "daily" as ScheduledPost["cadence"],
    hourUtc: 12,
    minuteUtc: 0,
    weekday: 1,
    dayOfMonth: 1,
  });

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    onError("");
    try {
      await fn();
      if (message) onNote(message);
      reload();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <div className="space-y-4">
      <Panel
        title="Scheduled posts"
        subtitle="All times are UTC, so the schedule doesn't drift with daylight saving"
        action={
          <button
            onClick={() => setCreating((v) => !v)}
            className="rounded-lg bg-lime-400 px-3 py-1.5 text-xs font-black text-zinc-950 hover:bg-lime-300"
          >
            {creating ? "Cancel" : "+ New post"}
          </button>
        }
      >
        {creating && (
          <div className="mb-4 grid gap-2 rounded-xl bg-zinc-950/60 p-3 sm:grid-cols-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Name (for your reference)"
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
            />
            <select
              value={form.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value as TopicKey })}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm ring-1 ring-white/10"
            >
              {TELEGRAM_TOPICS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <textarea
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              rows={3}
              placeholder="Message text — {jackpot}, {coin}, {site} are substituted"
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10 sm:col-span-2"
            />
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <select
                value={form.cadence}
                onChange={(e) => setForm({ ...form, cadence: e.target.value as ScheduledPost["cadence"] })}
                className="rounded-lg bg-zinc-900 px-2 py-2 text-sm ring-1 ring-white/10"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              {form.cadence === "weekly" && (
                <select
                  value={form.weekday}
                  onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}
                  className="rounded-lg bg-zinc-900 px-2 py-2 text-sm ring-1 ring-white/10"
                >
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
              {form.cadence === "monthly" && (
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={form.dayOfMonth}
                  onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })}
                  className="w-20 rounded-lg bg-zinc-900 px-2 py-2 font-mono text-sm ring-1 ring-white/10"
                />
              )}
              <span className="text-xs text-zinc-500">at</span>
              <input
                type="number"
                min={0}
                max={23}
                value={form.hourUtc}
                onChange={(e) => setForm({ ...form, hourUtc: Number(e.target.value) })}
                className="w-16 rounded-lg bg-zinc-900 px-2 py-2 font-mono text-sm ring-1 ring-white/10"
              />
              <span className="text-xs text-zinc-500">:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={form.minuteUtc}
                onChange={(e) => setForm({ ...form, minuteUtc: Number(e.target.value) })}
                className="w-16 rounded-lg bg-zinc-900 px-2 py-2 font-mono text-sm ring-1 ring-white/10"
              />
              <span className="text-xs text-zinc-500">UTC</span>
              <button
                onClick={() =>
                  void act(() => cc("/api/cc/telegram/scheduled", { body: form }), "Scheduled.").then(() => {
                    setCreating(false);
                    setForm({ ...form, name: "", text: "" });
                  })
                }
                className="ml-auto rounded-lg bg-lime-400 px-4 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
              >
                Create
              </button>
            </div>
          </div>
        )}

        {settings.scheduled.length === 0 ? (
          <div className="rounded-xl bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">
            Nothing scheduled. Daily reminders, the weekly jackpot, event countdowns.
          </div>
        ) : (
          <div className="space-y-2">
            {settings.scheduled.map((p) => {
              const due = nextDue(p, Date.now());
              return (
                <div key={p.id} className="rounded-xl bg-zinc-950/50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black text-zinc-100">{p.name}</div>
                      <div className="truncate text-[11px] text-zinc-500">{p.text}</div>
                      <div className="font-mono text-[10px] text-zinc-600">
                        {p.cadence}
                        {p.cadence === "weekly" && ` · ${DAYS[p.weekday ?? 1]}`}
                        {p.cadence === "monthly" && ` · day ${p.dayOfMonth ?? 1}`} ·{" "}
                        {String(p.hourUtc).padStart(2, "0")}:{String(p.minuteUtc).padStart(2, "0")} UTC → {p.topic}
                        {due ? ` · next ${new Date(due).toLocaleString()}` : " · not scheduled"}
                        {p.lastSentAt && ` · last sent ${new Date(p.lastSentAt).toLocaleString()}`}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        void act(() =>
                          cc(`/api/cc/telegram/scheduled/${p.id}`, { method: "PATCH", body: { enabled: !p.enabled } }),
                        )
                      }
                      className={`rounded-full px-3 py-1 text-[11px] font-black ${
                        p.enabled ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {p.enabled ? "ON" : "OFF"}
                    </button>
                    <button
                      onClick={() => {
                        if (!confirm(`Delete the scheduled post "${p.name}"?`)) return;
                        void act(() => cc(`/api/cc/telegram/scheduled/${p.id}`, { method: "DELETE" }), "Deleted.");
                      }}
                      className="rounded bg-red-500/15 px-2 py-1 text-[11px] font-black text-red-300 hover:bg-red-500/25"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

function CommandsTab({ settings, patch }: { settings: TelegramSettings; patch: Patch }) {
  return (
    <Panel
      title="Bot commands"
      subtitle="Disabling one stops the bot answering it. Leave a response blank for the built-in, data-driven answer."
    >
      <div className="space-y-2">
        {Object.entries(settings.commands).map(([name, cfg]) => (
          <div key={name} className="rounded-xl bg-zinc-950/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-black text-lime-300">/{name}</span>
              <input
                defaultValue={cfg.description}
                onBlur={(e) =>
                  e.target.value !== cfg.description &&
                  void patch({ commands: { [name]: { description: e.target.value } } })
                }
                className="min-w-[12rem] flex-1 rounded-lg bg-zinc-900 px-2 py-1.5 text-xs outline-none ring-1 ring-white/10"
              />
              <button
                onClick={() => void patch({ commands: { [name]: { adminOnly: !cfg.adminOnly } } })}
                className={`rounded px-2 py-1 text-[11px] font-bold ${
                  cfg.adminOnly ? "bg-amber-400/20 text-amber-300" : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {cfg.adminOnly ? "Admins only" : "Everyone"}
              </button>
              <button
                onClick={() => void patch({ commands: { [name]: { enabled: !cfg.enabled } } })}
                className={`rounded-full px-3 py-1 text-[11px] font-black ${
                  cfg.enabled ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {cfg.enabled ? "ON" : "OFF"}
              </button>
            </div>
            <textarea
              defaultValue={cfg.response}
              rows={2}
              placeholder="(built-in answer)"
              onBlur={(e) =>
                e.target.value !== cfg.response &&
                void patch({ commands: { [name]: { response: e.target.value } } }, "Response saved.")
              }
              className="mt-2 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-xs outline-none ring-1 ring-white/10"
            />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ModerationTab({ settings, patch }: { settings: TelegramSettings; patch: Patch }) {
  const m = settings.moderation;
  const toggle = (key: keyof typeof m, label: string, hint: string) => (
    <button
      onClick={() => void patch({ moderation: { [key]: !m[key] } })}
      className={`flex items-center justify-between gap-3 rounded-xl p-3 text-left ring-1 transition ${
        m[key] ? "bg-lime-400/[0.07] ring-lime-400/40" : "bg-zinc-950/50 ring-white/10"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-black text-zinc-100">{label}</span>
        <span className="block text-[11px] text-zinc-500">{hint}</span>
      </span>
      <span
        className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black ${
          m[key] ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"
        }`}
      >
        {m[key] ? "ON" : "OFF"}
      </span>
    </button>
  );

  return (
    <div className="space-y-4">
      <Panel title="Group protection" subtitle="These need the bot to hold restrict and delete rights in the group">
        <div className="grid gap-2 sm:grid-cols-2">
          {toggle("captcha", "Captcha on join", "Mute → verify → unmute, kick on timeout")}
          {toggle("spamFilter", "Anti-spam", "Blocks scam phrases, foreign invites and new-member links")}
          {toggle("goodbye", "Goodbye messages", "Post when someone leaves (off by default — it's noise)")}
        </div>
      </Panel>

      <Panel title="Welcome message" subtitle="Blank uses the bot's own greeting">
        <textarea
          defaultValue={m.welcomeMessage}
          rows={3}
          placeholder="(built-in greeting)"
          onBlur={(e) =>
            e.target.value !== m.welcomeMessage &&
            void patch({ moderation: { welcomeMessage: e.target.value } }, "Welcome message saved.")
          }
          className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
        />
      </Panel>

      <Panel title="Limits">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-400">Link cooldown (minutes)</span>
            <input
              type="number"
              min={0}
              max={1440}
              defaultValue={m.linkCooldownMinutes}
              onBlur={(e) => void patch({ moderation: { linkCooldownMinutes: Number(e.target.value) } })}
              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-3 py-2 font-mono text-sm outline-none ring-1 ring-white/10"
            />
            <span className="text-[10px] text-zinc-600">
              Members newer than this can&apos;t post links. 0 = allow immediately.
            </span>
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-400">Slow mode (seconds)</span>
            <input
              type="number"
              min={0}
              max={3600}
              defaultValue={m.slowModeSeconds}
              onBlur={(e) => void patch({ moderation: { slowModeSeconds: Number(e.target.value) } })}
              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-3 py-2 font-mono text-sm outline-none ring-1 ring-white/10"
            />
            <span className="text-[10px] text-zinc-600">0 = off.</span>
          </label>
        </div>
      </Panel>

      <Panel title="Blocked words" subtitle="Lowercased substring match, one per line, on top of the built-in scam list">
        <textarea
          defaultValue={m.blocklist.join("\n")}
          rows={6}
          onBlur={(e) =>
            void patch(
              { moderation: { blocklist: e.target.value.split("\n").map((w) => w.trim()).filter(Boolean) } },
              "Blocklist saved.",
            )
          }
          className="w-full rounded-lg bg-zinc-900 px-3 py-2 font-mono text-xs outline-none ring-1 ring-white/10"
        />
      </Panel>
    </div>
  );
}

function LogsTab() {
  const [entries, setEntries] = useState<TelegramLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (kind) params.set("kind", kind);
      cc<{ entries: TelegramLogEntry[]; total: number }>(`/api/cc/telegram/logs?${params}`)
        .then((d) => {
          setEntries(d.entries);
          setTotal(d.total);
        })
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q, kind]);

  const TONE: Record<string, string> = {
    sent: "text-lime-300",
    failed: "text-red-300",
    error: "text-red-400",
    command: "text-sky-300",
  };

  return (
    <Panel
      title="Delivery log"
      subtitle={`${total} recorded · newest first`}
      action={
        <div className="flex gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-lg bg-zinc-900 px-2 py-1.5 text-xs ring-1 ring-white/10"
          >
            <option value="">All</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="command">Commands</option>
            <option value="error">Errors</option>
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs outline-none ring-1 ring-white/10"
          />
        </div>
      }
    >
      {entries.length === 0 ? (
        <div className="rounded-xl bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">
          Nothing logged yet.
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map((e) => (
            <div key={e.id} className="flex flex-wrap items-baseline gap-2 rounded-lg bg-zinc-950/50 px-3 py-1.5 text-xs">
              <span className="w-36 shrink-0 font-mono text-[10px] text-zinc-600">
                {new Date(e.at).toLocaleString()}
              </span>
              <span className={`w-16 shrink-0 font-black ${TONE[e.kind] ?? "text-zinc-400"}`}>{e.kind}</span>
              {e.target && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{e.target}</span>}
              {e.source && <span className="text-[11px] text-zinc-500">{e.source}</span>}
              <span className="min-w-0 flex-1 truncate text-zinc-400">{e.error ?? e.text}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
