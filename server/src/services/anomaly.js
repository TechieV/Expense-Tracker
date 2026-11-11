import { Transaction } from '../models.js';

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Flags unusually large expenses using a robust z-score (median + MAD) inside each category.
 * A category needs at least 6 expenses before anything in it can be flagged.
 */
export async function markAnomalies(userId) {
  const rows = await Transaction.find({ userId, type: 'expense', categoryId: { $ne: null } }, 'categoryId amount description').lean();
  const byCat = new Map();
  for (const r of rows) { const k = String(r.categoryId); if (!byCat.has(k)) byCat.set(k, []); byCat.get(k).push(r); }
  // Recurring bills (same description, similar amount, seen at least 3 times, e.g. monthly rent) are never "unusual"
  const key = (d) => String(d || '').toLowerCase().replace(/[\d\W_]+/g, ' ').trim();
  const recurring = (r, list) => {
    const k = key(r.description);
    return k.length > 2 && list.filter((o) => key(o.description) === k && Math.abs(o.amount - r.amount) <= 0.15 * r.amount).length >= 3;
  };
  const flagged = [];
  for (const list of byCat.values()) {
    if (list.length < 6) continue;
    const amts = list.map((r) => r.amount);
    const med = median(amts);
    const mad = median(amts.map((a) => Math.abs(a - med)));
    const scale = Math.max(1.4826 * mad, 0.15 * med);
    for (const r of list) if (r.amount > med + 3.5 * scale && !recurring(r, list)) flagged.push(r._id);
  }
  await Transaction.updateMany({ userId, isAnomaly: true }, { $set: { isAnomaly: false } });
  if (flagged.length) await Transaction.updateMany({ userId, _id: { $in: flagged } }, { $set: { isAnomaly: true } });
  return flagged.length;
}
