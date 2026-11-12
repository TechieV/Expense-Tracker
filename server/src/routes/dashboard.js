import { Router } from 'express';
import { Transaction } from '../models.js';
import { loadCategories } from '../db.js';
import { asyncH, HttpError, validMonth, monthRange, currentMonth, shiftMonth, round2, oid } from '../util.js';
import { budgetStatus, sumsByCategory, totalsBetween, getAvailableBalance } from '../services/stats.js';
import { serializeTxn } from './transactions.js';

const r = Router();

r.get('/summary', asyncH(async (req, res) => {
  let month = req.query.month || currentMonth();
  const isAll = month === 'all' || month === '';
  if (!isAll && !validMonth(month)) throw new HttpError(400, 'Invalid month');

  const uid = req.userId;
  const cats = await loadCategories();
  const all = await totalsBetween(uid, '0000-01-01', '9999-12-31');

  let from, to, totals, budgets;
  if (isAll) {
    from = '0000-01-01';
    to = '9999-12-31';
    const avail = await getAvailableBalance(uid);
    totals = {
      income: all.income,
      expense: all.expense,
      savings: round2(all.income - all.expense),
      balance: avail.balance,
      balanceSource: avail.source,
      balanceAsOf: avail.asOfDate,
    };
    budgets = [];
  } else {
    [from, to] = monthRange(month);
    const m = await totalsBetween(uid, from, to);
    const avail = await getAvailableBalance(uid, month);
    totals = {
      income: m.income,
      expense: m.expense,
      savings: round2(m.income - m.expense),
      balance: avail.balance,
      balanceSource: avail.source,
      balanceAsOf: avail.asOfDate,
    };
    budgets = await budgetStatus(uid, month, [from, to]);
  }

  // Spending by category
  const byCategory = [...(await sumsByCategory(uid, from, to)).entries()]
    .map(([id, total]) => ({
      name: cats.byId.get(id)?.name || 'Uncategorized',
      color: cats.byId.get(id)?.color || '#64748b',
      total,
    }))
    .sort((a, b) => b.total - a.total);

  // Active month trend and counts
  const refMonth = isAll ? currentMonth() : month;
  const start = monthRange(shiftMonth(refMonth, -5))[0];
  const [trendRows, countRows, allMonthsAgg] = await Promise.all([
    Transaction.aggregate([
      { $match: { userId: oid(uid), date: { $gte: start } } },
      { $group: { _id: { month: '$month', type: '$type' }, total: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      { $match: { userId: oid(uid) } },
      { $group: { _id: '$month', count: { $sum: 1 } } },
    ]),
    Transaction.aggregate([
      { $match: { userId: oid(uid) } },
      {
        $group: {
          _id: '$month',
          count: { $sum: 1 },
          income: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0] } },
          expense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } },
        },
      },
      { $sort: { _id: -1 } },
    ]),
  ]);

  const countMap = new Map(countRows.map((c) => [c._id, c.count]));
  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const k = shiftMonth(refMonth, -i);
    const get = (type) => round2(trendRows.find((x) => x._id.month === k && x._id.type === type)?.total || 0);
    monthly.push({
      month: k,
      income: get('income'),
      expense: get('expense'),
      count: countMap.get(k) || 0,
    });
  }

  // All transactions for the selected scope (filtered by month, or all time when month=all)
  const txFilter = { userId: uid };
  if (!isAll) {
    txFilter.date = { $gte: from, $lt: to };
  }
  const txDocs = await Transaction.find(txFilter).sort({ date: -1, _id: -1 }).lean();
  const transactions = txDocs.map((t) => serializeTxn(t, cats));

  res.json({
    month: isAll ? 'all' : month,
    totals,
    byCategory,
    monthly,
    allMonths: allMonthsAgg.map((m) => ({
      month: m._id,
      count: m.count,
      income: round2(m.income),
      expense: round2(m.expense),
    })),
    totalCount: allMonthsAgg.reduce((s, m) => s + m.count, 0),
    budgets,
    transactions,
    recent: transactions.slice(0, 10), // backward compatibility
  });
}));

export default r;
