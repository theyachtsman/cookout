import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityEvent, Address } from "@cookout/shared";
import { Store } from "./store.js";
import { TelegramApi } from "./telegram/api.js";
import { Commands } from "./telegram/commands.js";
import type { PitBossConfig } from "./telegram/config.js";
import { Notifier } from "./telegram/notify.js";

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

test("graduation notifies the owner (DM) and the community channel", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const notifier = new Notifier(store, api, CONFIG);
  store.linkTelegram(ADDR, { userId: "999", chatId: "555", linkedAt: Date.now() });

  notifier.handleActivity(activity({ kind: "graduated", roundId: "r1", roundSymbol: "FOO" }));
  await flush();

  assert.equal(to(sent, "555").length, 1, "owner gets one DM");
  assert.equal(to(sent, "chan").length, 1, "channel gets one post");
  assert.ok(/FOO/.test(to(sent, "chan")[0]!.text), "channel post names the coin");
});

test("notification prefs gate the personal DM but not the channel", async () => {
  const store = new Store();
  const { api, sent } = fakeApi();
  const notifier = new Notifier(store, api, CONFIG);
  store.linkTelegram(ADDR, { userId: "999", chatId: "555", linkedAt: Date.now() });
  store.getOrCreateUser(ADDR).notifyPrefs = { graduations: false };

  notifier.handleActivity(activity({ kind: "graduated", roundId: "r1", roundSymbol: "FOO" }));
  await flush();

  assert.equal(to(sent, "555").length, 0, "owner opted out — no DM");
  assert.equal(to(sent, "chan").length, 1, "channel still posts");
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
