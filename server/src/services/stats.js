import { Transaction, Budget } from '../models.js';
import { loadCategories } from '../db.js';
import { oid, round2 } from '../util.js';

/** Total spent per category between two dates. Returns Map(categoryId -> total). */
export async function sumsByCategory(userId, from, to, type = 'expense') {
  const rows = await Transaction.aggregate([
    { $match: { userId: oid(userId), type, date: { $gte: from, $lt: to } } },
    { $group: { _id: '$categoryId', total: { $sum: '$amount' } } },
  ]);
  return new Map(rows.map((r) => [r._id ? String(r._id) : 'none', round2(r.total)]));
}

/** Total income and expense between two dates. */
export async function totalsBetween(userId, from, to) {
  const rows = await Transaction.aggregate([
    { $match: { userId: oid(userId), date: { $gte: from, $lt: to } } },
    { $group: { _id: '$type', total: { $sum: '$amount' } } },
  ]);
  const t = { income: 0, expense: 0 };
  for (const r of rows) t[r._id] = round2(r.total);
  return t;
}

/** Budgets for a month with how much has been spent so far. */
export async function budgetStatus(userId, month, range) {
  const [from, to] = range;
  const [budgets, spent, cats] = await Promise.all([
    Budget.find({ userId, month }).lean(), sumsByCategory(userId, from, to), loadCategories(),
  ]);
  return budgets.map((b) => {
    const cat = cats.byId.get(String(b.categoryId));
    const s = spent.get(String(b.categoryId)) || 0;
    const pct = b.limitAmount > 0 ? (s / b.limitAmount) * 100 : 0;
    return { id: String(b._id), categoryId: String(b.categoryId), category: cat?.name || 'Unknown', color: cat?.color || '#64748b',
      limitAmount: b.limitAmount, spent: round2(s), percent: Math.round(pct), status: pct >= 100 ? 'over' : pct >= 80 ? 'warning' : 'ok' };
  }).sort((a, b) => a.category.localeCompare(b.category));
}
