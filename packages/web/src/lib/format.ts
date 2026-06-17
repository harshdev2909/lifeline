/** Compact, consistent number formatting for the mono readouts. */
export const ms = (n?: number): string => (typeof n === "number" && isFinite(n) ? `${Math.round(n)}` : "—");

export const toks = (n?: number): string => (typeof n === "number" && isFinite(n) ? n.toFixed(1) : "—");

export const int = (n?: number): string => (typeof n === "number" && isFinite(n) ? String(Math.round(n)) : "—");

/** Shorten a 64-char hex key for display, keeping it recognizable. */
export const shortKey = (k?: string): string => (k && k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-4)}` : k ?? "—");
