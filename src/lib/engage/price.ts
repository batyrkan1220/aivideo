/** Price after a personal discount, rounded down to 10 ₸ (shared by the server and the order form). */
export const discounted = (kzt: number, percent: number) => Math.max(10, Math.floor((kzt * (100 - percent)) / 100 / 10) * 10);
