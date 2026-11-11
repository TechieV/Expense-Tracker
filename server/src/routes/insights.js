import { Router } from 'express';
import { asyncH, HttpError, validMonth, currentMonth } from '../util.js';
import { buildInsights } from '../services/insights.js';

const r = Router();
r.get('/', asyncH(async (req, res) => {
  const month = req.query.month || currentMonth();
  if (!validMonth(month)) throw new HttpError(400, 'Invalid month');
  res.json(await buildInsights(req.userId, month));
}));
export default r;
