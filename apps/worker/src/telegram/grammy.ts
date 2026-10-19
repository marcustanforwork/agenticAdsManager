// grammY glue: the real Bot API client and long polling (BLUEPRINT §5.15). Kept apart from bot.ts so the logic
// there is tested against a fake API. Exactly one poller runs: the leader's (Telegram allows one getUpdates
// consumer per bot).
import { Api, Bot } from 'grammy';
import { type BotContext, type TelegramApi, handleCallback } from './bot.ts';
import { MENU } from './commands.ts';
import { handleMessage } from './decide.ts';

export function grammyApi(token: string): TelegramApi {
  const api = new Api(token);
  return {
    sendMessage: (chatId, text, other) => api.sendMessage(chatId, text, other),
    answerCallbackQuery: (id, other) => api.answerCallbackQuery(id, other),
    editMessageReplyMarkup: (chatId, messageId, other) => api.editMessageReplyMarkup(chatId, messageId, other),
    editMessageText: (chatId, messageId, text, other) => api.editMessageText(chatId, messageId, text, other),
  };
}

/** Starts long polling for button presses and text messages (the replies a card asks for). Anything else is not
 *  even fetched (`allowed_updates`). */
export function startGrammyPolling(token: string, ctx: BotContext): { stop(): Promise<void> } {
  const bot = new Bot(token);
  bot.on('callback_query:data', async (c) => {
    const outcome = await handleCallback(ctx, c.callbackQuery);
    ctx.logger?.info({ outcome }, 'button press handled');
  });
  bot.on('message:text', async (c) => {
    const outcome = await handleMessage(ctx, c.message);
    ctx.logger?.info({ outcome }, 'message handled');
  });
  bot.catch((err) => ctx.logger?.error({ err: err.error }, 'Telegram update failed'));
  // The menu under "/" in Marcus's chat. Best effort: the commands work without it.
  bot.api
    .setMyCommands(MENU, { scope: { type: 'chat', chat_id: ctx.ownerId } })
    .catch((err: unknown) => ctx.logger?.error({ err }, 'setting the command menu failed'));
  bot
    .start({ allowed_updates: ['callback_query', 'message'] })
    .catch((err: unknown) => ctx.logger?.error({ err }, 'Telegram polling stopped with an error'));
  return { stop: () => bot.stop() };
}
