/**
 * All discounts are off for now (the owner's decision after an ad visitor got −20%): no first-video
 * offer from ads, no "second video −20%" message, no Telegram-link bonus, nothing applied at checkout.
 * Set to true to bring them back.
 */
export const DISCOUNTS_ON = false;

/** Price after a personal discount, rounded down to 10 ₸ (shared by the server and the order form). */
export const discounted = (kzt: number, percent: number) => Math.max(10, Math.floor((kzt * (100 - percent)) / 100 / 10) * 10);
