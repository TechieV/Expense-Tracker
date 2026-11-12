import { Transaction, Budget } from '../models.js';
import { loadCategories } from '../db.js';
import { oid, round2, monthRange } from '../util.js';

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

/**
 * Resolves the true Available Balance for a user:
 * 1. Finds the latest transaction with a verified bank statement balance (date, balance).
 * 2. Adds income and subtracts expenses that occurred strictly after that verified transaction date.
 * 3. If no statement balance exists, falls back to total income minus total expense.
 */
export async function getAvailableBalance(userId, asOfMonth = null) {
  const dateFilter = { userId: oid(userId), balance: { $ne: null } };
  if (asOfMonth) {
    const nextMonthStart = monthRange(asOfMonth)[1];
    dateFilter.date = { $lt: nextMonthStart };
  }
  const latestWithBal = await Transaction.findOne(dateFilter).sort({ date: -1, _id: -1 }).lean();

  if (latestWithBal && latestWithBal.balance != null) {
    const subsequentFilter = {
      userId: oid(userId),
      $or: [
        { date: { $gt: latestWithBal.date } },
        { date: latestWithBal.date, _id: { $gt: latestWithBal._id } },
      ],
    };
    if (asOfMonth) {
      const nextMonthStart = monthRange(asOfMonth)[1];
      subsequentFilter.date = { $gt: latestWithBal.date, $lt: nextMonthStart };
    }
    const [subsequent] = await Transaction.aggregate([
      { $match: subsequentFilter },
      {
        $group: {
          _id: null,
          inc: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0] } },
          exp: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } },
        },
      },
    ]);
    const inc = subsequent?.inc || 0;
    const exp = subsequent?.exp || 0;
    return {
      balance: round2(latestWithBal.balance + inc - exp),
      source: 'statement',
      asOfDate: latestWithBal.date,
      statementBalance: latestWithBal.balance,
    };
  }

  // Fallback to all.income - all.expense
  const [all] = await Transaction.aggregate([
    { $match: { userId: oid(userId) } },
    {
      $group: {
        _id: null,
        inc: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0] } },
        exp: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } },
      },
    },
  ]);
  const inc = all?.inc || 0;
  const exp = all?.exp || 0;
  return {
    balance: round2(inc - exp),
    source: 'calculated',
    asOfDate: null,
    statementBalance: null,
  };
}
