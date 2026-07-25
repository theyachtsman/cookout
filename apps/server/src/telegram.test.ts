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
  botUsername: "pitboss_cookout_bot",
  webBase: "https://www.thecookout.fun",
  groupChatId: "group",
  announcementChatId: "chan",
};

/** A fake Telegram API that records every sendMessage instead of hitting the net. */
function fakeApi() {
  const sent: { chat_id: string | number; text: string }[] = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    const method = String(url).split("/").pop();
    const body = JSON.parse(init.body);
    if (method === "sendMessage") sent.push(body);
    return {
      json: async () => ({
        ok: true,
        result:
          method === "getMe"
            ? { id: 1, is_bot: true, username: "pitboss_cookout_bot" }
            : { message_id: 1, chat: { id: body.chat_id } },
      }),
    };
  }) as unknown as typeof fetch;
  return { api: new TelegramApi("test-token", fetchImpl), sent };
}

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
