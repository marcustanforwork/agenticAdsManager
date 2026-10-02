// Which insights `actions` entries count as a product's conversions. The pack's settings name Meta events
// (FeedbackRoute.eventName, e.g. 'Lead'); insights report dataset events as `offsite_conversion.fb_pixel_<event>`.
// UNVERIFIED against live data (GOTCHAS): the M02 live recording confirms the action types a product's events
// produce. An event not listed here must be configured explicitly rather than guessed.

const STANDARD_EVENT_ACTION_TYPES: Readonly<Record<string, string>> = {
  AddPaymentInfo: 'offsite_conversion.fb_pixel_add_payment_info',
  AddToCart: 'offsite_conversion.fb_pixel_add_to_cart',
  AddToWishlist: 'offsite_conversion.fb_pixel_add_to_wishlist',
  CompleteRegistration: 'offsite_conversion.fb_pixel_complete_registration',
  InitiateCheckout: 'offsite_conversion.fb_pixel_initiate_checkout',
  Lead: 'offsite_conversion.fb_pixel_lead',
  Purchase: 'offsite_conversion.fb_pixel_purchase',
  Search: 'offsite_conversion.fb_pixel_search',
  ViewContent: 'offsite_conversion.fb_pixel_view_content',
};

/** The insights action types for these Meta event names. Throws on an event without a confirmed mapping. */
export function actionTypesForEvents(eventNames: readonly string[]): string[] {
  const out = new Set<string>();
  for (const name of eventNames) {
    const t = Object.hasOwn(STANDARD_EVENT_ACTION_TYPES, name) ? STANDARD_EVENT_ACTION_TYPES[name] : undefined;
    if (t === undefined) throw new Error(`no confirmed insights action type for Meta event ${JSON.stringify(name)}`);
    out.add(t);
  }
  return [...out].sort();
}
