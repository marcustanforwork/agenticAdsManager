// No personal data in prompts or traces (BLUEPRINT §5.18). Prompts are built from aggregates, so this is the
// backstop for what slips into platform text (a search term that is an email address, an ad name with a phone
// number): every prompt is redacted before it is sent, and the trace exporter masks the same patterns again.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** International numbers only (a leading +, then 8 to 15 digits with optional spaces or dashes): metric values and
 *  ids in a prompt never start with a +. */
const PHONE = /\+\d(?:[ -]?\d){7,14}/g;

export const EMAIL_PLACEHOLDER = '[email removed]';
export const PHONE_PLACEHOLDER = '[phone removed]';

export interface Redacted {
  text: string;
  /** How many values were replaced. */
  redactions: number;
}

export function redactPersonalData(text: string): Redacted {
  let redactions = 0;
  const out = text
    .replace(EMAIL, () => {
      redactions += 1;
      return EMAIL_PLACEHOLDER;
    })
    .replace(PHONE, () => {
      redactions += 1;
      return PHONE_PLACEHOLDER;
    });
  return { text: out, redactions };
}
