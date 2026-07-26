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
  /** Service message: members who just joined. */
  new_chat_members?: TgUser[];
  /** Service message: a member who left. */
  left_chat_member?: TgUser;
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}
export interface TgChatMember {
  status: string; // creator | administrator | member | restricted | left | kicked
  user: TgUser;
}
export interface TgChatMemberUpdated {
  chat: TgChat;
  from: TgUser;
  old_chat_member: TgChatMember;
  new_chat_member: TgChatMember;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  chat_member?: TgChatMemberUpdated;
}

/** Telegram ChatPermissions — the muteable message rights. */
export interface ChatPermissions {
  can_send_messages: boolean;
  can_send_audios: boolean;
  can_send_documents: boolean;
  can_send_photos: boolean;
  can_send_videos: boolean;
  can_send_video_notes: boolean;
  can_send_voice_notes: boolean;
  can_send_polls: boolean;
  can_send_other_messages: boolean;
  can_add_web_page_previews: boolean;
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
      // chat_member needs the bot to be admin; it's the reliable join/leave
      // signal (invite-link joins don't always emit a service message).
      allowed_updates: ["message", "callback_query", "chat_member"],
    });
  }

  editMessageText(
    chatId: string | number,
    messageId: number,
    text: string,
    keyboard?: InlineKeyboard,
  ): Promise<unknown> {
    return this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  deleteMessage(chatId: string | number, messageId: number): Promise<unknown> {
    return this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  restrictChatMember(
    chatId: string | number,
    userId: number,
    permissions: ChatPermissions,
  ): Promise<unknown> {
    return this.call("restrictChatMember", { chat_id: chatId, user_id: userId, permissions });
  }

  banChatMember(chatId: string | number, userId: number): Promise<unknown> {
    return this.call("banChatMember", { chat_id: chatId, user_id: userId });
  }

  unbanChatMember(chatId: string | number, userId: number): Promise<unknown> {
    return this.call("unbanChatMember", { chat_id: chatId, user_id: userId, only_if_banned: true });
  }

  setMyCommands(commands: { command: string; description: string }[]): Promise<unknown> {
    return this.call("setMyCommands", { commands });
  }

  getMe(): Promise<TgUser | null> {
    return this.call<TgUser>("getMe", {});
  }

  getChatAdministrators(chatId: string | number): Promise<TgChatMember[] | null> {
    return this.call<TgChatMember[]>("getChatAdministrators", { chat_id: chatId });
  }

  pinChatMessage(chatId: string | number, messageId: number): Promise<unknown> {
    return this.call("pinChatMessage", { chat_id: chatId, message_id: messageId, disable_notification: true });
  }
}
