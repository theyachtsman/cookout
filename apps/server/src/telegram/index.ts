/**
 * The Pit Boss — The Cookout's Telegram companion.
 *
 * Modular by design: a zero-dep API client (api), the voice (voice), inline
 * keyboards (keyboards), the notification dispatcher (notify), the command desk
 * (commands), and the orchestrator (bot). Everything is env-gated: with no
 * TELEGRAM_BOT_TOKEN, createPitBoss returns null and the game runs untouched.
 */
export { PitBoss, createPitBoss } from "./bot.js";
export { Notifier } from "./notify.js";
export { linkDeepLink, type PitBossConfig } from "./config.js";
export { COMMANDS } from "./commands.js";
export { TelegramApi } from "./api.js";
