// grammY glue: the real Bot API client and long polling (BLUEPRINT §5.15). Kept apart from bot.ts so the logic
// there is tested against a fake API. Exactly one poller runs: the leader's (Telegram allows one getUpdates
// consumer per bot).
import { Api, Bot } from 'grammy';
import { type BotContext, type CallbackQuery, type TelegramApi, handleCallback } from './bot.ts';

export function grammyApi(token: string): TelegramApi {
  const api = new Api(token);
  return {
    sendMessage: (chatId, text, other) => api.sendMessage(chatId, text, other),
    answerCallbackQuery: (id, other) => api.answerCallbackQuery(id, other),
    editMessageReplyMarkup: (chatId, messageId, other) => api.editMessageReplyMarkup(chatId, messageId, other),
  };
}

/** Starts long polling for button presses only. Other updates (messages, commands) arrive in M09. */
export function startGrammyPolling(token: string, ctx: BotContext): { stop(): Promise<void> } {
  const bot = new Bot(token);
  bot.on('callback_query:data', async (c) => {
    const outcome = await handleCallback(ctx, c.callbackQuery as CallbackQuery);
    ctx.logger?.info({ outcome }, 'button press handled');
  });
  bot.catch((err) => ctx.logger?.error({ err: err.error }, 'Telegram update failed'));
  bot
    .start({ allowed_updates: ['callback_query'] })
    .catch((err: unknown) => ctx.logger?.error({ err }, 'Telegram polling stopped with an error'));
  return { stop: () => bot.stop() };
}
