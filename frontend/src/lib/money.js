// INR display helper — Indian digit grouping (₹1,24,999), paise only if present.
const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const inr = (n) => `₹${fmt.format(Number(n) || 0)}`;
