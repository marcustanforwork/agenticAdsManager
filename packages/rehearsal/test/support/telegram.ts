// Telegram, faked: the Bot API calls the worker makes are recorded as Marcus's chat would show them, and his
// presses and replies go to the bot's own handlers, as grammY's long polling would deliver them
// (`telegram/grammy.ts`). Only the leader's polling gets the bot context, as in production.
import type { BotContext, InlineKeyboard, SendOptions, TelegramApi } from '@ads/app-worker/telegram/bot.ts';
import { handleCallback } from '@ads/app-worker/telegram/bot.ts';
import { handleMessage } from '@ads/app-worker/telegram/decide.ts';

export const OWNER_ID = 424242;

export interface ChatMessage {
  id: number;
  text: string;
  keyboard: InlineKeyboard | null;
  forceReply: boolean;
}

export interface FakeTelegram {
  api: TelegramApi;
  startPolling: (ctx: BotContext) => { stop(): Promise<void> };
  /** Marcus's chat, oldest first; edits change the message in place. */
  chat: ChatMessage[];
  /** Pop-up answers to button presses. */
  toasts: string[];
  /** Whether a leader is polling now. */
  polling(): boolean;
  /** Marcus presses a button under a message. */
  press(message: ChatMessage, buttonText: string): Promise<string>;
  /** Marcus sends a message (a command, or a reply the bot asked for). */
  say(text: string): Promise<string>;
  /** The messages sent since `mark` (a length of `chat` taken earlier). */
  since(mark: number): ChatMessage[];
}

export function fakeTelegram(): FakeTelegram {
  const chat: ChatMessage[] = [];
  const toasts: string[] = [];
  let ctx: BotContext | null = null;
  let updates = 0;
  const find = (id: number): ChatMessage => {
    const m = chat.find((c) => c.id === id);
    if (m === undefined) throw new Error(`no message ${id}`);
    return m;
  };
  const api: TelegramApi = {
    sendMessage(chatId, text, other?: SendOptions) {
      if (chatId !== OWNER_ID) throw new Error(`sent to chat ${chatId}`);
      const markup = other?.reply_markup;
      const message: ChatMessage = {
        id: chat.length + 1,
        text,
        keyboard: markup !== undefined && 'inline_keyboard' in markup ? markup : null,
        forceReply: markup !== undefined && 'force_reply' in markup,
      };
      chat.push(message);
      return Promise.resolve({ message_id: message.id });
    },
    answerCallbackQuery(_id, other) {
      toasts.push(other?.text ?? '');
      return Promise.resolve(true);
    },
    editMessageReplyMarkup(_chat, messageId, other) {
      find(messageId).keyboard = other?.reply_markup ?? null;
      return Promise.resolve(true);
    },
    editMessageText(_chat, messageId, text, other) {
      const m = find(messageId);
      m.text = text;
      m.keyboard = other?.reply_markup ?? null;
      return Promise.resolve(true);
    },
  };
  const live = (): BotContext => {
    if (ctx === null) throw new Error('no leader is polling Telegram');
    return ctx;
  };
  return {
    api,
    chat,
    toasts,
    startPolling(c) {
      ctx = c;
      return {
        stop: () => {
          ctx = null;
          return Promise.resolve();
        },
      };
    },
    polling: () => ctx !== null,
    async press(message, buttonText) {
      const button = message.keyboard?.inline_keyboard.flat().find((b) => b.text.includes(buttonText));
      if (button === undefined) throw new Error(`no button "${buttonText}" under message ${message.id}`);
      updates += 1;
      return handleCallback(live(), {
        id: `cb${updates}`,
        from: { id: OWNER_ID },
        data: button.callback_data,
        message: { message_id: message.id, chat: { id: OWNER_ID, type: 'private' } },
      });
    },
    async say(text) {
      updates += 1;
      return handleMessage(live(), {
        message_id: 10_000 + updates,
        from: { id: OWNER_ID },
        chat: { id: OWNER_ID, type: 'private' },
        text,
      });
    },
    since: (mark) => chat.slice(mark),
  };
}
