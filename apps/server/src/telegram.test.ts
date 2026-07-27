import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityEvent, Address, RoundSummary } from "@cookout/shared";
import { Store } from "./store.js";
import { TelegramApi } from "./telegram/api.js";
import { Commands } from "./telegram/commands.js";
import { normalizeTopics, type PitBossConfig } from "./telegram/config.js";
import { Notifier } from "./telegram/notify.js";
import { SpamGuard } from "./telegram/spamguard.js";

const ADDR = "0x1111111111111111111111111111111111111111" as Address;
const CONFIG: PitBossConfig = {
  botUsername: "pitboss_thecookout_bot",
  webBase: "https://www.thecookout.fun",
  groupChatId: "group",
  announcementChatId: "chan",
};

/** A fake Telegram API that records every sendMessage instead of hitting the net. */
function fakeApi() {
  const sent: { chat_id: string | number; text: string; message_thread_id?: number }[] = [];
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    const method = String(url).split("/").pop()!;
    const body = JSON.parse(init.body);
    calls.push({ method, body });
    if (method === "sendMessage") sent.push(body);
    return {
      json: async () => ({
        ok: true,
        result:
          method === "getMe"
            ? { id: 1, is_bot: true, username: "pitboss_thecookout_bot" }
            : { message_id: 1, chat: { id: body.chat_id } },
      }),
    };
  }) as unknown as typeof fetch;
  return { api: new TelegramApi("test-token", fetchImpl), sent, calls };
}

/** Build a join/leave chat_member update for the tests. */
const memberUpdate = (
  user: { id: number; is_bot: boolean; first_name?: string; username?: string },
  oldStatus: string,
  newStatus: string,
  chatId = -100,
) => ({
  chat: { id: chatId, type: "supergroup" },
  from: user,
  old_chat_member: { status: oldStatus, user },
  new_chat_member: { status: newStatus, user },
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const to = (sent: { chat_id: string | number }[], chat: string) =>
  sent.filter((m) => String(m.chat_id) === chat);

const activity = (over: Partial<ActivityEvent>): ActivityEvent => ({
  id: "e1",
  kind: "graduated",
  address: ADDR,
  text: "served up",
  at: Date.now(),
  ...over,
});

test("deep-link token links a Telegram account to the profile", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const commands = new Commands(store, api, CONFIG);
  const token = store.createTelegramLinkToken(ADDR);

  await commands.handleMessage({
    message_id: 1,
    chat: { id: 555, type: "private" },
    from: { id: 999, is_bot: false, username: "bob" },
    text: `/start ${token}`,
  });
  await flush();

  assert.equal(store.resolveTelegram("999"), ADDR);
  assert.equal(store.getOrCreateUser(ADDR).telegram?.chatId, "555");
  assert.ok(to(sent, "555").some((m) => /linked/i.test(m.text)), "sends a linked confirmation");
});

test("a spent or bogus token does not link", async () => {
  const store = new Store();
  const { api } = fakeApi();
  const commands = new Commands(store, api, CONFIG);
  const token = store.createTelegramLinkToken(ADDR);
  assert.equal(store.consumeTelegramLinkToken(token), ADDR); // spend it
  await commands.handleMessage({
    message_id: 1,
    chat: { id: 555, type: "private" },
    from: { id: 999, is_bot: false },
    text: `/start ${token}`,
  });
  assert.equal(store.resolveTelegram("999"), undefined);
});

/** A finished-round summary, enough to build the results scoreboard post. */
const summary = (over: Partial<RoundSummary> = {}): RoundSummary => ({
  roundId: "r1",
  endReason: "graduated",
  graduated: true,
  durationSeconds: 132,
  totalVolume: 5.5,
  peakMcap: 10,
  finalMcap: 9,
  holderCount: 3,
  averageReturnPct: 12,
  leaderboard: [{ address: ADDR, pnl: 0.5 }],
  ...over,
});

test("graduation DMs the owner; the results event posts the scoreboard", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const notifier = new Notifier(store, api, CONFIG);
  store.linkTelegram(ADDR, { userId: "999", chatId: "555", linkedAt: Date.now() });
  store.summaries.set("r1", summary());

  notifier.handleActivity(activity({ kind: "graduated", roundId: "r1", roundSymbol: "FOO" }));
  notifier.handleRoundEvent({ kind: "results", roundId: "r1", symbol: "FOO" });
  await flush();

  assert.equal(to(sent, "555").length, 1, "owner gets one DM");
  const chan = to(sent, "chan");
  assert.equal(chan.length, 1, "one results post to the channel");
  assert.ok(/Round Results/.test(chan[0]!.text), "it's the scoreboard");
  assert.ok(/FOO/.test(chan[0]!.text), "names the coin");
  assert.ok(/Top 5/.test(chan[0]!.text), "lists the top finishers");
});

test("round results post to the Leaderboards topic with the top 5", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const cfg: PitBossConfig = {
    botUsername: "b",
    webBase: "https://w",
    groupChatId: "group",
    topics: { leaderboards: 20 },
  };
  const n = new Notifier(store, api, cfg);
  store.getOrCreateUser(ADDR).displayName = "alice";
  store.summaries.set("r1", summary({ endReason: "timer", graduated: false, leaderboard: [{ address: ADDR, pnl: 0.42 }] }));
  n.handleRoundEvent({ kind: "results", roundId: "r1", symbol: "FOO", mode: "blitz" });
  await flush();

  const g = to(sent, "group") as unknown as { text: string; message_thread_id?: number }[];
  assert.equal(g.length, 1, "one post");
  assert.equal(g[0]!.message_thread_id, 20, "lands in Leaderboards (topic 20)");
  assert.ok(/alice/.test(g[0]!.text), "names the top finisher");
  assert.ok(/\+0\.420 pETH/.test(g[0]!.text), "shows their PnL");
  assert.ok(/Blitz/.test(g[0]!.text), "names the game mode");
});

test("notification prefs gate the personal DM but not the community post", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const notifier = new Notifier(store, api, CONFIG);
  store.linkTelegram(ADDR, { userId: "999", chatId: "555", linkedAt: Date.now() });
  store.getOrCreateUser(ADDR).notifyPrefs = { graduations: false };
  store.summaries.set("r1", summary());

  notifier.handleActivity(activity({ kind: "graduated", roundId: "r1", roundSymbol: "FOO" }));
  notifier.handleRoundEvent({ kind: "results", roundId: "r1", symbol: "FOO" });
  await flush();

  assert.equal(to(sent, "555").length, 0, "owner opted out, so no DM");
  assert.equal(to(sent, "chan").length, 1, "the results post still goes to the channel");
});

test("followers who opted in get DM'd about a followed player", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const notifier = new Notifier(store, api, CONFIG);
  const fan = "0x2222222222222222222222222222222222222222" as Address;
  store.linkTelegram(fan, { userId: "222", chatId: "222chat", linkedAt: Date.now() });
  store.setFollowing(fan, ADDR, true);

  notifier.handleActivity(activity({ kind: "won", roundSymbol: "FOO" }));
  await flush();

  assert.ok(to(sent, "222chat").length >= 1, "the follower is pinged");
});

test("founder numbers are permanent, idempotent, and capped", () => {
  const store = new Store();
  const a = "0xaaaa000000000000000000000000000000000000" as Address;
  const bb = "0xbbbb000000000000000000000000000000000000" as Address;
  assert.equal(store.claimFounder(a), 1);
  assert.equal(store.claimFounder(a), 1, "claiming again keeps the same number");
  assert.equal(store.claimFounder(bb), 2, "next founder gets the next number");
  assert.equal(store.founders().length, 2);
});

test("round-lifecycle events fan out to the community feed", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const notifier = new Notifier(store, api, CONFIG);
  // The engine/seed emit these; the notifier is subscribed via onRoundEvent.
  store.onRoundEvent((e) => notifier.handleRoundEvent(e));
  store.emitRoundEvent({ kind: "fair_open", roundId: "r1", symbol: "FOO" });
  store.emitRoundEvent({ kind: "live", roundId: "r1", symbol: "FOO" });
  store.emitRoundEvent({ kind: "burnt", roundId: "r1", symbol: "FOO" });
  store.emitRoundEvent({ kind: "votes_hit", roundId: "r2", symbol: "BAR", votes: 10 });
  await flush();

  const chan = to(sent, "chan");
  assert.equal(chan.length, 4, "four feed posts");
  assert.ok(chan.some((m) => /LIVE/.test(m.text)), "trading-live post");
  assert.ok(chan.some((m) => /burnt/i.test(m.text)), "burn post");
  assert.ok(chan.some((m) => /10 votes/.test(m.text)), "votes-hit post");
});

test("greets a new member in General with a tappable mention (captcha off)", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const cfg: PitBossConfig = {
    botUsername: "b",
    webBase: "https://w",
    groupChatId: "group",
    topics: { general: 5 },
  };
  const commands = new Commands(store, api, cfg);
  await commands.handleChatMember(memberUpdate({ id: 42, is_bot: false, first_name: "Sam" }, "left", "member"));
  await flush();

  const g = to(sent, "-100");
  assert.equal(g.length, 1, "one welcome");
  assert.ok(/welcome/i.test(g[0]!.text), "says welcome");
  assert.equal(g[0]!.message_thread_id, 5, "posts to the General topic");
  assert.ok(/tg:\/\/user\?id=42/.test(g[0]!.text), "mentions the joiner");
});

test("does not greet joining bots", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const commands = new Commands(store, api, CONFIG);
  await commands.handleChatMember(memberUpdate({ id: 7, is_bot: true, username: "spam_bot" }, "left", "member"));
  await flush();
  assert.equal(sent.length, 0, "no welcome for a bot");
});

const CAPTCHA_CFG: PitBossConfig = {
  botUsername: "b",
  webBase: "https://w",
  groupChatId: "group",
  topics: { general: 5 },
  captcha: true,
};

test("captcha mutes a joiner and posts a verify gate", async () => {
  const store = new Store();
  const { api, sent, calls } = fakeApi();
  const commands = new Commands(store, api, CAPTCHA_CFG);
  await commands.handleChatMember(memberUpdate({ id: 42, is_bot: false, first_name: "Sam" }, "left", "member"));
  await flush();

  const restrict = calls.find((c) => c.method === "restrictChatMember");
  assert.ok(restrict, "muted the joiner");
  assert.equal((restrict!.body.permissions as { can_send_messages: boolean }).can_send_messages, false, "muted");
  const gate = to(sent, "-100")[0];
  assert.ok(gate && /human/i.test(gate.text), "posts a captcha gate");
});

test("captcha unmutes the joiner when they tap their own button", async () => {
  const store = new Store();
  const { api, calls } = fakeApi();
  const commands = new Commands(store, api, CAPTCHA_CFG);
  await commands.handleChatMember(memberUpdate({ id: 42, is_bot: false, first_name: "Sam" }, "left", "member"));
  await flush();
  await commands.handleCallback({
    id: "cb1",
    from: { id: 42, is_bot: false, first_name: "Sam" },
    data: "verify:42",
    message: { message_id: 1, chat: { id: -100, type: "supergroup" } },
  });
  await flush();

  const unmute = calls.filter((c) => c.method === "restrictChatMember").at(-1);
  assert.equal((unmute!.body.permissions as { can_send_messages: boolean }).can_send_messages, true, "unmuted");
  assert.ok(calls.some((c) => c.method === "editMessageText"), "gate becomes the welcome");
});

const SPAM_CFG: PitBossConfig = {
  botUsername: "b",
  webBase: "https://w",
  groupChatId: "-100",
  topics: { general: 5 },
  spamFilter: true,
};
const groupMsg = (text: string, fromId = 42) => ({
  message_id: 10,
  chat: { id: -100, type: "supergroup" },
  from: { id: fromId, is_bot: false, first_name: "Sam" },
  text,
});

test("spam guard deletes + mutes phishing (blocklist)", async () => {
  const { api, calls } = fakeApi();
  const g = new SpamGuard(api, SPAM_CFG);
  assert.equal(await g.check(groupMsg("dm me your seed phrase to verify")), true);
  assert.ok(calls.some((c) => c.method === "deleteMessage"), "deleted");
  assert.ok(calls.some((c) => c.method === "restrictChatMember"), "muted the scammer");
});

test("spam guard removes foreign group invites", async () => {
  const { api, calls } = fakeApi();
  const g = new SpamGuard(api, SPAM_CFG);
  assert.equal(await g.check(groupMsg("join us https://t.me/+abc123")), true);
  assert.ok(calls.some((c) => c.method === "deleteMessage"), "deleted the invite");
});

test("spam guard holds new-member links but lets established members post", async () => {
  const { api } = fakeApi();
  const g = new SpamGuard(api, SPAM_CFG);
  // Established member (no join noted) → link allowed.
  assert.equal(await g.check(groupMsg("gm, chart at https://coingecko.com", 7)), false);
  // Brand-new member → link held.
  g.noteJoin(42);
  assert.equal(await g.check(groupMsg("check https://foo.xyz", 42)), true);
});

test("spam guard exempts admins", async () => {
  const { api } = fakeApi();
  const g = new SpamGuard(api, SPAM_CFG);
  g.setAdmins([42]);
  g.noteJoin(42);
  assert.equal(await g.check(groupMsg("https://t.me/+abc", 42)), false, "admins post freely");
});

test("captcha rejects someone else tapping your button", async () => {
  const store = new Store();
  const { api, calls } = fakeApi();
  const commands = new Commands(store, api, CAPTCHA_CFG);
  await commands.handleChatMember(memberUpdate({ id: 42, is_bot: false, first_name: "Sam" }, "left", "member"));
  await flush();
  const before = calls.filter((c) => c.method === "restrictChatMember").length;
  await commands.handleCallback({
    id: "cb2",
    from: { id: 99, is_bot: false, first_name: "Imposter" },
    data: "verify:42",
    message: { message_id: 1, chat: { id: -100, type: "supergroup" } },
  });
  await flush();

  const after = calls.filter((c) => c.method === "restrictChatMember").length;
  assert.equal(after, before, "no unmute for the wrong user");
  const answer = calls.find((c) => c.method === "answerCallbackQuery");
  assert.ok(/yours/i.test(String(answer!.body.text ?? "")), "tells them it isn't their button");
});

test("General topic (id 1) is normalized to the forum root so posts don't 404", () => {
  const topics = normalizeTopics({ general: 1, trading: 24, announcements: 33 })!;
  assert.equal(topics.general, undefined, "general=1 → root (no thread)");
  assert.equal(topics.trading, 24, "real threads are untouched");
  assert.equal(topics.announcements, 33, "real threads are untouched");
});

test("a new member is welcomed in General when General is the forum root", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const cfg: PitBossConfig = {
    botUsername: "b",
    webBase: "https://w",
    groupChatId: "group",
    // General swapped to the root id 1 → normalized away, so the welcome posts
    // to the group with no thread (which Telegram delivers to General).
    topics: normalizeTopics({ general: 1 }),
  };
  const commands = new Commands(store, api, cfg);
  await commands.handleChatMember(
    memberUpdate({ id: 77, is_bot: false, first_name: "Ada" }, "left", "member"),
  );
  await flush();

  const g = to(sent, "-100") as unknown as { text: string; message_thread_id?: number }[];
  assert.equal(g.length, 1, "one welcome");
  assert.ok(/welcome/i.test(g[0]!.text), "says welcome");
  assert.equal(g[0]!.message_thread_id, undefined, "no thread → lands in General");
});

test("a new submission posts to the Vote Shilling pit with a card + X-share button", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const cfg: PitBossConfig = {
    botUsername: "b",
    webBase: "https://www.thecookout.fun",
    groupChatId: "group",
    topics: { voteshill: 191, launch: 26 },
  };
  const n = new Notifier(store, api, cfg);
  n.handleRoundEvent({ kind: "submitted", roundId: "c9", symbol: "FOO", name: "Foo Coin", by: "chef" });
  await flush();

  const g = to(sent, "group") as unknown as {
    text: string;
    message_thread_id?: number;
    reply_markup?: { inline_keyboard: { text: string; url: string }[][] };
  }[];
  assert.equal(g.length, 1, "one shill post");
  assert.equal(g[0]!.message_thread_id, 191, "→ Vote Shilling thread");
  assert.ok(/up for a vote/i.test(g[0]!.text), "shill copy");
  const btns = g[0]!.reply_markup!.inline_keyboard.flat();
  const card = btns.find((b) => /Vote \$FOO/.test(b.text))!;
  assert.ok(card.url.endsWith("/vote#coin-c9"), "vote button deep-links the card");
  const x = btns.find((b) => /Shill on X/.test(b.text))!;
  assert.ok(x.url.startsWith("https://twitter.com/intent/tweet?text="), "X intent button");
  assert.ok(
    decodeURIComponent(x.url).includes("/vote#coin-c9"),
    "prefilled tweet carries the card link",
  );
});

test("a coin that passed the vote posts to Trading with an Enter-the-match button", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const cfg: PitBossConfig = {
    botUsername: "b",
    webBase: "https://www.thecookout.fun",
    groupChatId: "group",
    topics: { announcements: 33, trading: 24 },
  };
  const n = new Notifier(store, api, cfg);
  n.handleRoundEvent({ kind: "votes_hit", roundId: "r7", symbol: "BAR", votes: 10 });
  await flush();

  const g = to(sent, "group") as unknown as {
    text: string;
    message_thread_id?: number;
    reply_markup?: { inline_keyboard: { text: string; url: string }[][] };
  }[];
  assert.equal(g.length, 1, "one post");
  assert.equal(g[0]!.message_thread_id, 24, "votes-hit → Trading thread, not Announcements");
  const btn = g[0]!.reply_markup!.inline_keyboard.flat()[0]!;
  assert.ok(/Enter \$BAR/.test(btn.text), "button says Enter, not Vote");
  assert.ok(btn.url.endsWith("/round/r7"), "button enters the coin match");
});

test("with forum topics, feed posts target the right thread", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  // No separate channel — topics inside the group (the real setup).
  const cfg: PitBossConfig = {
    botUsername: "b",
    webBase: "https://w",
    groupChatId: "group",
    topics: { trading: 24, leaderboards: 20 },
  };
  const n = new Notifier(store, api, cfg);
  n.handleRoundEvent({ kind: "live", roundId: "r1", symbol: "FOO" }); // → trading (24)
  n.handleRoundEvent({ kind: "burnt", roundId: "r1", symbol: "FOO" }); // → leaderboards (20)
  await flush();

  const g = to(sent, "group");
  assert.equal(g.find((m) => /LIVE/.test(m.text))?.message_thread_id, 24, "live → trading thread");
  assert.equal(g.find((m) => /burnt/i.test(m.text))?.message_thread_id, 20, "burn → leaderboards thread");
});

const MOD_CFG: PitBossConfig = { botUsername: "b", webBase: "https://w", groupChatId: "-100" };
const modMsg = (fromId: number, text: string, targetId = 42) => ({
  message_id: 5,
  chat: { id: -100, type: "supergroup" },
  from: { id: fromId, is_bot: false, first_name: "U" + fromId },
  text,
  reply_to_message: {
    message_id: 4,
    chat: { id: -100, type: "supergroup" },
    from: { id: targetId, is_bot: false, first_name: "Target" },
    text: "spam",
  },
});

test("an admin can mute a replied-to user (timed)", async () => {
  const { api, calls } = fakeApi();
  const commands = new Commands(new Store(), api, MOD_CFG);
  commands.setAdmins([1]);
  await commands.handleMessage(modMsg(1, "/mute 1h"));
  await flush();
  const r = calls.find((c) => c.method === "restrictChatMember");
  assert.ok(r, "muted");
  assert.equal(r!.body.user_id, 42);
  assert.ok(r!.body.until_date, "timed mute set an until_date");
});

test("a non-admin cannot run mod commands", async () => {
  const { api, calls, sent } = fakeApi();
  const commands = new Commands(new Store(), api, MOD_CFG);
  commands.setAdmins([1]);
  await commands.handleMessage(modMsg(99, "/ban"));
  await flush();
  assert.ok(!calls.some((c) => c.method === "banChatMember"), "no ban from a non-admin");
  assert.ok(sent.some((m) => /admins only/i.test(m.text)), "told them admins only");
});

test("admins can't be moderated", async () => {
  const { api, calls, sent } = fakeApi();
  const commands = new Commands(new Store(), api, MOD_CFG);
  commands.setAdmins([1, 2]);
  await commands.handleMessage(modMsg(1, "/ban", 2));
  await flush();
  assert.ok(!calls.some((c) => c.method === "banChatMember"), "no ban of a fellow admin");
  assert.ok(sent.some((m) => /another admin/i.test(m.text)));
});

test("/warn mutes on the third warning", async () => {
  const { api, calls } = fakeApi();
  const commands = new Commands(new Store(), api, MOD_CFG);
  commands.setAdmins([1]);
  await commands.handleMessage(modMsg(1, "/warn"));
  await commands.handleMessage(modMsg(1, "/warn"));
  await commands.handleMessage(modMsg(1, "/warn"));
  await flush();
  assert.ok(calls.some((c) => c.method === "restrictChatMember"), "3rd warn auto-mutes");
});
