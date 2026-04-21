/**
 * Crow Tasks — Recurrence advancement.
 *
 * Given a base date (YYYY-MM-DD) and a pattern/interval, returns the next
 * occurrence as YYYY-MM-DD. Patterns: daily, weekly, monthly, yearly.
 *
 * Kept deliberately simple — no RRULE, no BYDAY. If someone needs
 * "every weekday" or "third Thursday," we can upgrade to rrule later.
 */

function parseDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`invalid date: ${iso}`);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function advanceDate(baseIso, pattern, interval = 1) {
  const n = Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 1;
  const base = parseDate(baseIso);
  switch (pattern) {
    case "daily":
      base.setUTCDate(base.getUTCDate() + n);
      break;
    case "weekly":
      base.setUTCDate(base.getUTCDate() + n * 7);
      break;
    case "monthly":
      base.setUTCMonth(base.getUTCMonth() + n);
      break;
    case "yearly":
      base.setUTCFullYear(base.getUTCFullYear() + n);
      break;
    default:
      throw new Error(`unknown recurrence pattern: ${pattern}`);
  }
  return toIso(base);
}

export function isExhausted(nextIso, untilIso) {
  if (!untilIso) return false;
  return nextIso > untilIso;
}
