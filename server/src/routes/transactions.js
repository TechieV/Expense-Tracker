import { Router } from 'express';
import crypto from 'node:crypto';
import { Transaction } from '../models.js';
import { loadCategories } from '../db.js';
import { asyncH, HttpError, isId, isValidDate, validMonth, monthRange, round2, escapeRegex, oid } from '../util.js';
import { categorizeBatch } from '../services/categorizer.js';
import { markAnomalies } from '../services/anomaly.js';
import { getAvailableBalance } from '../services/stats.js';

const r = Router();

export const serializeTxn = (t, cats) => {
  const c = t.categoryId ? cats.byId.get(String(t.categoryId)) : null;
  return {
    id: String(t._id),
    date: t.date,
    month: t.month || t.date.slice(0, 7),
    amount: t.amount,
    balance: t.balance != null ? round2(t.balance) : null,
    description: t.description,
    type: t.type,
    isAnomaly: !!t.isAnomaly,
    userDismissedAnomaly: !!t.userDismissedAnomaly,
    uploadId: t.uploadId ? String(t.uploadId) : null,
    categoryId: t.categoryId ? String(t.categoryId) : null,
    category: c?.name || null,
    categoryColor: c?.color || null,
  };
};

async function validate(userId, body) {
  const { date, amount, description = '', type, categoryId } = body || {};
  if (!isValidDate(date)) throw new HttpError(400, 'Please enter a valid date');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 999999999) throw new HttpError(400, 'Amount must be a positive number');
  if (!['income', 'expense'].includes(type)) throw new HttpError(400, 'Type must be income or expense');
  if (typeof description !== 'string' || description.length > 255) throw new HttpError(400, 'Description is too long');
  const cats = await loadCategories();
  let catId = null;
  if (categoryId) {
    const c = isId(String(categoryId)) ? cats.byId.get(String(categoryId)) : null;
    if (!c || c.type !== type) throw new HttpError(400, `Category does not match a ${type} category`);
    catId = c.id;
  } else {
    const [pred] = await categorizeBatch(userId, [{ description, type }]);
    catId = pred.category_id;
  }
  return { date, month: date.slice(0, 7), amount: round2(amt), description: description.trim(), type, categoryId: catId };
}

r.get('/months', asyncH(async (req, res) => {
  const stats = await Transaction.aggregate([
    { $match: { userId: oid(req.userId) } },
    {
      $group: {
        _id: '$month',
        count: { $sum: 1 },
        income: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0] } },
        expense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } },
        anomalyCount: { $sum: { $cond: [{ $eq: ['$isAnomaly', true] }, 1, 0] } },
      },
    },
    { $sort: { _id: -1 } },
  ]);

  const allTime = stats.reduce(
    (acc, m) => ({
      count: acc.count + m.count,
      income: acc.income + m.income,
      expense: acc.expense + m.expense,
      anomalyCount: acc.anomalyCount + m.anomalyCount,
    }),
    { count: 0, income: 0, expense: 0, anomalyCount: 0 }
  );

  const [availAll, ...monthBalances] = await Promise.all([
    getAvailableBalance(req.userId),
    ...stats.map((s) => getAvailableBalance(req.userId, s._id)),
  ]);

  res.json({
    months: stats.map((s, idx) => ({
      month: s._id,
      count: s.count,
      income: round2(s.income),
      expense: round2(s.expense),
      savings: round2(s.income - s.expense),
      balance: monthBalances[idx]?.balance ?? null,
      balanceSource: monthBalances[idx]?.source ?? null,
      anomalyCount: s.anomalyCount,
    })),
    allTime: {
      count: allTime.count,
      income: round2(allTime.income),
      expense: round2(allTime.expense),
      savings: round2(allTime.income - allTime.expense),
      balance: availAll.balance,
      balanceSource: availAll.source,
      balanceAsOf: availAll.asOfDate,
      anomalyCount: allTime.anomalyCount,
    },
  });
}));

r.get('/', asyncH(async (req, res) => {
  const { month, type, categoryId, q, anomaly } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const filter = { userId: req.userId };
  if (month) {
    if (!validMonth(month)) throw new HttpError(400, 'Invalid month');
    const [a, b] = monthRange(month);
    filter.date = { $gte: a, $lt: b };
  }
  if (type === 'income' || type === 'expense') filter.type = type;
  if (categoryId) {
    if (!isId(String(categoryId))) throw new HttpError(400, 'Invalid category');
    filter.categoryId = categoryId;
  }
  if (q) filter.description = { $regex: escapeRegex(String(q).slice(0, 60)), $options: 'i' };
  if (anomaly === 'true' || anomaly === '1') filter.isAnomaly = true;

  const [total, rows, cats] = await Promise.all([
    Transaction.countDocuments(filter),
    Transaction.find(filter).sort({ date: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    loadCategories(),
  ]);
  res.json({ items: rows.map((t) => serializeTxn(t, cats)), total, page, limit });
}));

r.post('/', asyncH(async (req, res) => {
  const v = await validate(req.userId, req.body);
  const doc = await Transaction.create({ ...v, userId: req.userId, dedupeKey: `manual:${crypto.randomUUID()}` });
  await markAnomalies(req.userId);
  res.status(201).json(serializeTxn((await Transaction.findById(doc._id).lean()), await loadCategories()));
}));

r.put('/:id/anomaly', asyncH(async (req, res) => {
  if (!isId(req.params.id)) throw new HttpError(404, 'Transaction not found');
  const doc = await Transaction.findOne({ _id: req.params.id, userId: req.userId });
  if (!doc) throw new HttpError(404, 'Transaction not found');

  const nextIsAnomaly = typeof req.body.isAnomaly === 'boolean' ? req.body.isAnomaly : !doc.isAnomaly;
  doc.isAnomaly = nextIsAnomaly;
  doc.userDismissedAnomaly = !nextIsAnomaly;
  await doc.save();

  const cats = await loadCategories();
  res.json(serializeTxn(doc, cats));
}));

r.put('/:id', asyncH(async (req, res) => {
  if (!isId(req.params.id)) throw new HttpError(404, 'Transaction not found');
  const doc = await Transaction.findOne({ _id: req.params.id, userId: req.userId });
  if (!doc) throw new HttpError(404, 'Transaction not found');
  doc.set(await validate(req.userId, req.body));
  await doc.save();
  await markAnomalies(req.userId);
  res.json(serializeTxn((await Transaction.findById(doc._id).lean()), await loadCategories()));
}));

r.delete('/:id', asyncH(async (req, res) => {
  if (!isId(req.params.id)) throw new HttpError(404, 'Transaction not found');
  const result = await Transaction.deleteOne({ _id: req.params.id, userId: req.userId });
  if (!result.deletedCount) throw new HttpError(404, 'Transaction not found');
  await markAnomalies(req.userId);
  res.json({ ok: true });
}));

export default r;
