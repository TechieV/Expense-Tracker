import { Router } from 'express';
import { loadCategories } from '../db.js';
import { asyncH } from '../util.js';

const r = Router();
r.get('/', asyncH(async (_req, res) => {
  const { list } = await loadCategories();
  res.json(list.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : b.type.localeCompare(a.type))));
}));
export default r;
