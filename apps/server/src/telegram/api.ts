/**
 * A tiny, zero-dependency Telegram Bot API client over global fetch (Node 18+).
 *
 * We deliberately avoid a bot framework: the surface we need is small, and a
 * hand-rolled client keeps the dependency tree flat, the behaviour obvious, and
 * everything injectable for tests (pass a fake `fetchImpl`). Every call is
 * failure-tolerant — a network hiccup logs and returns null, never throws, so a
 * dropped message can't take down the poller or the game server.
 */

export interface InlineButton {
  text: string;
  /** A deep link out to the website (most of our buttons). */
  url?: string;
  /** A callback the bot handles in-chat (answered via answerCallbackQuery). */
  callback_data?: string;
}
export type InlineKeyboard = InlineButton[][];

export interface SendOpts {
  chatId: string | number;
  text: string;
  keyboard?: InlineKeyboard;
  /** HTML is our default so we can bold/italicise without escaping every dot. */
  parseMode?: "HTML" | "MarkdownV2";
  disablePreview?: boolean;
  /** Forum topic (message thread) to post into, for the community group. */
  messageThreadId?: number;
  silent?: boolean;
}

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  username?: string;
}
export interface TgChat {
  id: number;
  type: string;
  title?: string;
}
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  message_thread_id?: number;
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

type FetchLike = typeof fetch;

export class TelegramApi {
  constructor(
    private token: string,
    private fetchImpl: FetchLike = fetch,
  ) {}

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T | null> {
    try {
      const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        // getUpdates long-polls up to 50s; give everything else a short leash.
        signal: AbortSignal.timeout(method === "getUpdates" ? 60_000 : 12_000),
      });
      const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
      if (!json.ok) {
        console.warn(`[pitboss] ${method} failed: ${json.description ?? "unknown"}`);
        return null;
      }
      return json.result ?? null;
    } catch (e) {
      // AbortError on a long-poll is normal (no updates in the window).
      if (method !== "getUpdates") console.warn(`[pitboss] ${method} error:`, (e as Error).message);
      return null;
    }
  }

  sendMessage(o: SendOpts): Promise<TgMessage | null> {
    return this.call<TgMessage>("sendMessage", {
      chat_id: o.chatId,
      text: o.text,
      parse_mode: o.parseMode ?? "HTML",
      disable_web_page_preview: o.disablePreview ?? true,
      disable_notification: o.silent ?? false,
      ...(o.messageThreadId ? { message_thread_id: o.messageThreadId } : {}),
      ...(o.keyboard ? { reply_markup: { inline_keyboard: o.keyboard } } : {}),
    });
  }

  answerCallbackQuery(id: string, text?: string): Promise<unknown> {
    return this.call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  }

  getUpdates(offset: number, timeoutSec = 50): Promise<TgUpdate[] | null> {
    return this.call<TgUpdate[]>("getUpdates", {
      offset,
      timeout: timeoutSec,
      allowed_updates: ["message", "callback_query"],
    });
  }

  setMyCommands(commands: { command: string; description: string }[]): Promise<unknown> {
    return this.call("setMyCommands", { commands });
  }

  getMe(): Promise<TgUser | null> {
    return this.call<TgUser>("getMe", {});
  }

  pinChatMessage(chatId: string | number, messageId: number): Promise<unknown> {
    return this.call("pinChatMessage", { chat_id: chatId, message_id: messageId, disable_notification: true });
  }
}
