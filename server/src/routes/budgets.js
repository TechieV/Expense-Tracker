import { Router } from 'express';
import { Budget } from '../models.js';
import { loadCategories } from '../db.js';
import { asyncH, HttpError, isId, validMonth, monthRange, currentMonth, round2 } from '../util.js';
import { budgetStatus } from '../services/stats.js';

const r = Router();

r.get('/', asyncH(async (req, res) => {
  const month = req.query.month || currentMonth();
  if (!validMonth(month)) throw new HttpError(400, 'Invalid month');
  res.json(await budgetStatus(req.userId, month, monthRange(month)));
}));

r.post('/', asyncH(async (req, res) => {
  const { categoryId, month, limitAmount } = req.body || {};
  if (!validMonth(month)) throw new HttpError(400, 'Invalid month');
  const lim = Number(limitAmount);
  if (!Number.isFinite(lim) || lim <= 0) throw new HttpError(400, 'Budget limit must be a positive number');
  const cat = isId(String(categoryId)) ? (await loadCategories()).byId.get(String(categoryId)) : null;
  if (!cat || cat.type !== 'expense') throw new HttpError(400, 'Choose an expense category');
  await Budget.findOneAndUpdate({ userId: req.userId, categoryId: cat.id, month }, { $set: { limitAmount: round2(lim) } }, { upsert: true });
  res.status(201).json(await budgetStatus(req.userId, month, monthRange(month)));
}));

r.delete('/:id', asyncH(async (req, res) => {
  if (!isId(req.params.id)) throw new HttpError(404, 'Budget not found');
  const result = await Budget.deleteOne({ _id: req.params.id, userId: req.userId });
  if (!result.deletedCount) throw new HttpError(404, 'Budget not found');
  res.json({ ok: true });
}));

export default r;
