import { Router } from 'express';
import { Transaction } from '../models.js';
import { loadCategories } from '../db.js';
import { asyncH, HttpError, validMonth, monthRange, currentMonth, shiftMonth, round2, oid } from '../util.js';
import { budgetStatus, sumsByCategory, totalsBetween } from '../services/stats.js';
import { serializeTxn } from './transactions.js';

const r = Router();

r.get('/summary', asyncH(async (req, res) => {
  const month = req.query.month || currentMonth();
  if (!validMonth(month)) throw new HttpError(400, 'Invalid month');
  const uid = req.userId;
  const [from, to] = monthRange(month);
  const cats = await loadCategories();

  const m = await totalsBetween(uid, from, to);
  const all = await totalsBetween(uid, '0000-01-01', '9999-12-31');

  const byCategory = [...(await sumsByCategory(uid, from, to)).entries()]
    .map(([id, total]) => ({ name: cats.byId.get(id)?.name || 'Uncategorized', color: cats.byId.get(id)?.color || '#64748b', total }))
    .sort((a, b) => b.total - a.total);

  const start = monthRange(shiftMonth(month, -5))[0];
  const rows = await Transaction.aggregate([
    { $match: { userId: oid(uid), date: { $gte: start, $lt: to } } },
    { $group: { _id: { month: '$month', type: '$type' }, total: { $sum: '$amount' } } },
  ]);
  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const k = shiftMonth(month, -i);
    const get = (type) => round2(rows.find((x) => x._id.month === k && x._id.type === type)?.total || 0);
    monthly.push({ month: k, income: get('income'), expense: get('expense') });
  }

  const recent = (await Transaction.find({ userId: uid, date: { $gte: from, $lt: to } }).sort({ date: -1, _id: -1 }).limit(6).lean()).map((t) => serializeTxn(t, cats));

  res.json({
    month,
    totals: { income: m.income, expense: m.expense, savings: round2(m.income - m.expense), balance: round2(all.income - all.expense) },
    byCategory,
    monthly,
    budgets: await budgetStatus(uid, month, [from, to]),
    recent,
  });
}));

export default r;
