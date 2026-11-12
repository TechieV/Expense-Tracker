import { Transaction } from '../models.js';
import { loadCategories } from '../db.js';

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const ESSENTIAL_WORDS = /\b(rent|tuition|fee|fees|insurance|lic|emi|loan|bill|electricity|maintenance|broadband|wifi|salary|tax|water|gas|recharge|dth)\b/i;
const key = (d) => String(d || '').toLowerCase().replace(/[\d\W_]+/g, ' ').trim();

const isRecurringOrEssential = (r, list) => {
  if (ESSENTIAL_WORDS.test(r.description || '')) return true;
  const k = key(r.description);
  if (k.length > 2) {
    const matches = list.filter((o) => key(o.description) === k && Math.abs(o.amount - r.amount) <= 0.15 * r.amount);
    if (matches.length >= 2) return true;
  }
  return false;
};

const CATEGORY_MIN_FLOOR = {
  Food: 2000,
  Travel: 3000,
  Shopping: 5000,
  Entertainment: 3000,
  Health: 5000,
  Bills: 8000,
  Other: 8000,
};

/**
 * Flags unusually large expenses using a robust z-score (median + MAD) inside each category.
 * A category needs at least 5 expenses before anything in it can be flagged.
 * Respects recurring bills, essential expenses, category-specific minimum floors,
 * and user-dismissed anomalies.
 */
export async function markAnomalies(userId) {
  const cats = await loadCategories();
  const rows = await Transaction.find(
    { userId, type: 'expense', categoryId: { $ne: null } },
    'categoryId amount description userDismissedAnomaly isAnomaly'
  ).lean();

  const byCat = new Map();
  for (const r of rows) {
    const k = String(r.categoryId);
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(r);
  }

  const flaggedIds = [];
  for (const [catId, list] of byCat.entries()) {
    if (list.length < 5) continue;
    const cat = cats.byId.get(catId);
    const catName = cat?.name || 'Other';
    const amts = list.map((r) => r.amount);
    const med = median(amts);
    const mad = median(amts.map((a) => Math.abs(a - med)));
    const scale = Math.max(1.4826 * mad, 0.25 * med, 200);

    const minAmount = CATEGORY_MIN_FLOOR[catName] || 5000;
    const multiplier = catName === 'Other' ? 4.5 : 3.5;

    for (const r of list) {
      if (r.userDismissedAnomaly) continue;
      if (
        r.amount >= minAmount &&
        r.amount > med + multiplier * scale &&
        r.amount >= 2.5 * med &&
        !isRecurringOrEssential(r, list)
      ) {
        flaggedIds.push(r._id);
      }
    }
  }

  // Clear anomaly flag on transactions that are not in flaggedIds
  await Transaction.updateMany(
    { userId, isAnomaly: true, _id: { $nin: flaggedIds } },
    { $set: { isAnomaly: false } }
  );

  // Mark newly flagged anomalies unless explicitly dismissed by user
  if (flaggedIds.length) {
    await Transaction.updateMany(
      { userId, _id: { $in: flaggedIds }, userDismissedAnomaly: { $ne: true } },
      { $set: { isAnomaly: true } }
    );
  }

  return flaggedIds.length;
}
