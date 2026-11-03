// Small display helpers.
export const money = (n) => "$" + (n / 100).toFixed(2);
export const statusLabel = (s) => ({ in_transit: "on the way", none: "not shipped", unknown: "status unavailable" })[s] ?? s;
