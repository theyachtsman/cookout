import { FOUNDER_CAP, type Address, type Round } from "@cookout/shared";
import { BOT_ADDRESSES } from "../bots.js";
import type { Store } from "../store.js";
import type { InlineKeyboard, TelegramApi, TgCallbackQuery, TgMessage } from "./api.js";
import type { PitBossConfig } from "./config.js";
import { makeKeyboards, type Keyboards } from "./keyboards.js";
import { esc, gate, signoff } from "./voice.js";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The slash commands, also registered with Telegram for the in-app menu. */
export const COMMANDS: { command: string; description: string }[] = [
  { command: "pullup", description: "What's cooking right now" },
  { command: "profile", description: "Your stats" },
  { command: "leaderboard", description: "Who's cooking this week" },
  { command: "jackpot", description: "The weekly pot" },
  { command: "coin", description: "The coin on the grill" },
  { command: "creator", description: "Your launches & reputation" },
  { command: "founders", description: "Founding Members" },
];

/**
 * The Pit Boss command desk. Parses slash commands and the /start linking
 * handshake, and answers stray callback queries. All replies stay in the Pit
 * Boss voice and carry a button back to the site.
 */
export class Commands {
  private kb: Keyboards;

  constructor(
    private store: Store,
    private api: TelegramApi,
    private config: PitBossConfig,
  ) {
    this.kb = makeKeyboards(config.webBase);
  }

  private reply(chatId: number, text: string, keyboard?: InlineKeyboard, threadId?: number): void {
    void this.api.sendMessage({ chatId, text, keyboard, messageThreadId: threadId });
  }

  async handleMessage(msg: TgMessage): Promise<void> {
    // Service messages first: greet joiners, (optionally) send off leavers.
    if (msg.new_chat_members?.length) return this.welcome(msg);
    if (msg.left_chat_member) return this.goodbye(msg);

    const text = msg.text?.trim();
    if (!text || !text.startsWith("/")) return;
    const [raw, ...args] = text.split(/\s+/);
    const cmd = raw!.replace(/@.+$/, "").toLowerCase();
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id ?? "");
    const thread = msg.message_thread_id;

    switch (cmd) {
      case "/start":
        return this.start(msg, args[0]);
      case "/pullup":
      case "/coin":
        return this.pullup(chatId, thread, cmd === "/coin");
      case "/profile":
        return this.profile(chatId, userId, thread);
      case "/creator":
        return this.creator(chatId, userId, thread);
      case "/leaderboard":
        return this.leaderboard(chatId, thread);
      case "/jackpot":
        return this.jackpot(chatId, thread);
      case "/founders":
        return this.founders(chatId, userId, thread);
      case "/help":
        return this.help(chatId, thread);
    }
  }

  async handleCallback(q: TgCallbackQuery): Promise<void> {
    // Every button we send is a URL deep link, so there's nothing to compute —
    // just clear the client's loading spinner.
    await this.api.answerCallbackQuery(q.id);
  }

  // ---- welcome / goodbye ---------------------------------------------------

  private welcome(msg: TgMessage): void {
    const thread = this.config.topics?.general ?? msg.message_thread_id;
    for (const m of msg.new_chat_members ?? []) {
      if (m.is_bot) continue;
      const label = esc(m.first_name || m.username || "friend");
      const mention = `<a href="tg://user?id=${m.id}">${label}</a>`;
      this.reply(msg.chat.id, gate.welcome(mention), this.kb.playNow(), thread);
    }
  }

  private goodbye(msg: TgMessage): void {
    if (!this.config.goodbye) return; // off by default — leave-spam is noise
    const m = msg.left_chat_member;
    if (!m || m.is_bot) return;
    this.reply(
      msg.chat.id,
      gate.goodbye(m.first_name || m.username || "someone"),
      undefined,
      this.config.topics?.general,
    );
  }

  // ---- account linking via deep link ---------------------------------------

  private start(msg: TgMessage, token?: string): void {
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id ?? "");
    if (!token) {
      this.reply(
        chatId,
        `🔥 Welcome to The Cookout. I'm the ${esc("Pit Boss")}, the host of the pit.\n\n` +
          `Link your account from your profile on the website and I'll ping you when something's cooking. ${signoff()}`,
        this.kb.openCookout(),
      );
      return;
    }
    const address = this.store.consumeTelegramLinkToken(token);
    if (!address) {
      this.reply(
        chatId,
        `⏳ That link's cold — expired or already used. Grab a fresh one from your profile on the website.`,
        this.kb.openCookout(),
      );
      return;
    }
    const u = this.store.linkTelegram(address, {
      userId,
      username: msg.from?.username,
      chatId: String(chatId),
      linkedAt: Date.now(),
    });
    const name = u.displayName ?? short(u.address);
    this.reply(
      chatId,
      `🔥 You're linked, <b>${esc(name)}</b>. I'll holler when something's cooking. ` +
        `Tune what I ping you about back on your profile. ${signoff()}`,
      this.kb.openCookout(),
    );
  }

  // ---- read commands -------------------------------------------------------

  private currentRound(): Round | undefined {
    const rounds = [...this.store.rounds.values()];
    const order: Round["state"][] = ["live", "queue_open", "lobby", "settling", "scheduled"];
    for (const state of order) {
      const r = rounds
        .filter((x) => x.state === state)
        .sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
      if (r) return r;
    }
    return undefined;
  }

  private pullup(chatId: number, thread?: number, coinFocus = false): void {
    const r = this.currentRound();
    if (!r) {
      this.reply(
        chatId,
        `🍳 Grill's between servings. Somebody needs to launch a coin. Wanna be that somebody?`,
        this.kb.vote(),
        thread,
      );
      return;
    }
    const sym = esc(r.token.symbol);
    const name = esc(r.token.name);
    let line: string;
    if (r.state === "live") line = `🔥 $${sym} is <b>LIVE</b> right now. Fresh serving on the grill — pull up.`;
    else if (r.state === "queue_open") line = `⚖️ $${sym} is in the <b>Fair Open</b>. One price, no snipers. Get your bid in.`;
    else if (r.state === "lobby") line = `⏳ $${sym} is in the lobby. Gather your people before the Pull Up.`;
    else if (r.state === "settling") line = `⏳ $${sym} just closed its queue — settling the one fair price now.`;
    else line = `📅 Next on the grill: $${sym} (${name}). Booked and heating up.`;
    if (coinFocus) line += `\n${esc(r.token.theme)}`;
    this.reply(chatId, line, this.kb.round(r.id, r.token.symbol), thread);
  }

  private profile(chatId: number, userId: string, thread?: number): void {
    const address = this.store.resolveTelegram(userId);
    if (!address) return this.notLinked(chatId, thread);
    const u = this.store.getOrCreateUser(address);
    const name = u.displayName ?? short(u.address);
    const founder = u.founderNumber ? `\n🥇 Founding Member <b>#${u.founderNumber}</b>` : "";
    this.reply(
      chatId,
      `👤 <b>${esc(name)}</b>\n` +
        `🍖 Level <b>${u.level}</b> · ${esc(u.title)}\n` +
        `⭐ ${u.xp.toLocaleString()} XP · 🏅 ${u.achievements.length} achievements` +
        founder,
      this.kb.profile(u.address),
      thread,
    );
  }

  private creator(chatId: number, userId: string, thread?: number): void {
    const address = this.store.resolveTelegram(userId);
    if (!address) return this.notLinked(chatId, thread);
    const u = this.store.getOrCreateUser(address);
    const launches = [...this.store.concepts.values()].filter(
      (c) => c.creatorAddress === u.address,
    ).length;
    this.reply(
      chatId,
      `🍳 <b>${esc(u.displayName ?? short(u.address))}</b> — creator kitchen\n` +
        `🔥 ${launches} coin${launches === 1 ? "" : "s"} launched\n` +
        `📈 Reputation <b>${u.creatorReputation}</b>\n\n` +
        `Cook clean and the reputation climbs. Burn your own bag and it doesn't.`,
      [[{ text: "🍳 Launch a Coin", url: this.config.webBase.replace(/\/$/, "") + "/submissions" }]],
      thread,
    );
  }

  private leaderboard(chatId: number, thread?: number): void {
    const top = [...this.store.users.values()]
      .filter((u) => !BOT_ADDRESSES.has(u.address as Address))
      .sort((a, b) => b.level - a.level || b.xp - a.xp)
      .slice(0, 5);
    if (top.length === 0) {
      this.reply(chatId, `🏆 Board's empty. Be the first to cook.`, this.kb.openCookout(), thread);
      return;
    }
    const medals = ["🥇", "🥈", "🥉", "4.", "5."];
    const lines = top.map(
      (u, i) => `${medals[i]} <b>${esc(u.displayName ?? short(u.address))}</b> — Lvl ${u.level}, ${u.xp.toLocaleString()} XP`,
    );
    this.reply(chatId, `🏆 <b>Top of the pit</b>\n\n${lines.join("\n")}`, this.kb.leaderboard(), thread);
  }

  private jackpot(chatId: number, thread?: number): void {
    const eth = this.store.jackpotPool;
    const usd = this.store.ethUsd ? eth * this.store.ethUsd : undefined;
    this.reply(
      chatId,
      `💰 <b>Weekly jackpot</b>: ${eth.toFixed(2)} pETH` +
        `${usd ? ` (≈ $${Math.round(usd).toLocaleString()})` : ""}\n\n` +
        `Climb the weekly board and you're in for a cut. ${signoff()}`,
      this.kb.jackpot(),
      thread,
    );
  }

  private founders(chatId: number, userId: string, thread?: number): void {
    const claimed = this.store.founders().length;
    const address = this.store.resolveTelegram(userId);
    const mine = address ? this.store.getOrCreateUser(address).founderNumber : undefined;
    const yours = mine
      ? `\n\n🥇 You're Founding Member <b>#${mine}</b>. Permanent. Nobody takes that seat.`
      : `\n\nClaim your number on your profile — first come, permanent seat.`;
    this.reply(
      chatId,
      `🥇 <b>Founding Members</b>\n${claimed} of ${FOUNDER_CAP} seats claimed.${yours}`,
      this.kb.openCookout(),
      thread,
    );
  }

  private help(chatId: number, thread?: number): void {
    const lines = COMMANDS.map((c) => `/${c.command} — ${c.description}`).join("\n");
    this.reply(chatId, `🔥 <b>Pit Boss commands</b>\n\n${lines}`, this.kb.openCookout(), thread);
  }

  private notLinked(chatId: number, thread?: number): void {
    this.reply(
      chatId,
      `🔗 You're not linked yet. Head to your profile on the website and connect Telegram, then I'll know who you are.`,
      this.kb.openCookout(),
      thread,
    );
  }
}
