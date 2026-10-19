// The brief's feedback buttons (M07): 👍 useful and 💡 new to me, under each weekly brief. Each press toggles that
// answer (bot.ts records it as a `brief_feedback` request).
import type { Brief } from '@ads/db';
import type { InlineKeyboard, RenderedNotification } from './bot.ts';
import { chunkHtml, markdownLiteToHtml } from './format.ts';

/** Callback data `v1:<verb>:<briefId>:<version>` (§5.15): at most 49 bytes, under Telegram's 64. Stable: old cards
 *  must keep working. Briefs have no versions; it is always 0. */
export const FEEDBACK_VERBS = { useful: 'useful', newInfo: 'new' } as const;

export function feedbackData(verb: 'useful' | 'new', briefId: string): string {
  return `v1:${verb}:${briefId}:0`;
}

export function parseFeedbackData(data: string): { verb: 'useful' | 'new'; briefId: string } | null {
  const m = /^v1:(useful|new):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):0$/.exec(data);
  return m === null ? null : { verb: m[1] as 'useful' | 'new', briefId: m[2] as string };
}

export function feedbackKeyboard(
  briefId: string,
  state: { useful: boolean | null; newInfo: boolean | null } = { useful: null, newInfo: null },
): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: `${state.useful === true ? '✅' : '👍'} useful`, callback_data: feedbackData('useful', briefId) },
        { text: `${state.newInfo === true ? '✅' : '💡'} new to me`, callback_data: feedbackData('new', briefId) },
      ],
    ],
  };
}

/** A brief as messages: its markdown as HTML chunks, and the feedback buttons as last answered. Sent by the outbox and
 *  again by `/brief` (M09b). */
export function briefMessage(brief: Brief): RenderedNotification {
  return {
    chunks: chunkHtml(markdownLiteToHtml(brief.markdown)),
    keyboard: feedbackKeyboard(brief.id, { useful: brief.feedbackUseful, newInfo: brief.feedbackNewInfo }),
    briefId: brief.id,
  };
}
