import { Router } from 'express';
import crypto from 'node:crypto';
import { Transaction } from '../models.js';
import { loadCategories } from '../db.js';
import { asyncH, HttpError, isId, isValidDate, validMonth, monthRange, round2, escapeRegex } from '../util.js';
import { categorizeBatch } from '../services/categorizer.js';
import { markAnomalies } from '../services/anomaly.js';

const r = Router();

export const serializeTxn = (t, cats) => {
  const c = t.categoryId ? cats.byId.get(String(t.categoryId)) : null;
  return { id: String(t._id), date: t.date, amount: t.amount, description: t.description, type: t.type, isAnomaly: !!t.isAnomaly,
    uploadId: t.uploadId ? String(t.uploadId) : null, categoryId: t.categoryId ? String(t.categoryId) : null,
    category: c?.name || null, categoryColor: c?.color || null };
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

r.get('/', asyncH(async (req, res) => {
  const { month, type, categoryId, q } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const filter = { userId: req.userId };
  if (month) { if (!validMonth(month)) throw new HttpError(400, 'Invalid month'); const [a, b] = monthRange(month); filter.date = { $gte: a, $lt: b }; }
  if (type === 'income' || type === 'expense') filter.type = type;
  if (categoryId) { if (!isId(String(categoryId))) throw new HttpError(400, 'Invalid category'); filter.categoryId = categoryId; }
  if (q) filter.description = { $regex: escapeRegex(String(q).slice(0, 60)), $options: 'i' };
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
