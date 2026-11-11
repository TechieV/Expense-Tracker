import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { StatementUpload, Transaction } from '../models.js';
import { asyncH, HttpError } from '../util.js';
import { parseStatement } from '../services/parser.js';
import { categorizeBatch } from '../services/categorizer.js';
import { markAnomalies } from '../services/anomaly.js';

const r = Router();
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (/\.(csv|pdf)$/i.test(file.originalname) ? cb(null, true) : cb(new HttpError(400, 'Only CSV and PDF files are supported'))),
});

const keyFor = (uid, row, occ) =>
  crypto.createHash('sha1').update(`${uid}|${row.date}|${row.type}|${row.amount.toFixed(2)}|${row.description.toLowerCase().replace(/\s+/g, ' ')}|${occ}`).digest('hex');

r.post('/', upload.single('file'), asyncH(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Please choose a CSV or PDF file');
  const ext = path.extname(req.file.originalname).slice(1).toLowerCase();
  const { rows, skipped } = await parseStatement(req.file.buffer, ext);

  // The same row appearing twice in one statement gets occurrence 1, 2, ... so only RE-uploads are treated as duplicates
  const seen = new Map();
  rows.forEach((row) => { const base = `${row.date}|${row.type}|${row.amount}|${row.description}`; const n = (seen.get(base) || 0) + 1; seen.set(base, n); row.key = keyFor(req.userId, row, n); });

  const up = await StatementUpload.create({ userId: req.userId, fileName: req.file.originalname.slice(0, 200), fileType: ext, rowsFound: rows.length });
  const preds = await categorizeBatch(req.userId, rows);

  let imported = 0; let duplicates = 0; const importedRows = [];
  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        await Transaction.create({ userId: req.userId, categoryId: preds[i].category_id, uploadId: up._id, date: row.date, month: row.date.slice(0, 7),
          amount: row.amount, description: row.description, type: row.type, dedupeKey: row.key });
        imported++; importedRows.push({ date: row.date, amount: row.amount, type: row.type, description: row.description, category: preds[i].category });
      } catch (e) {
        if (e.code === 11000) duplicates++; else throw e; // 11000 = unique index hit = this row was imported before
      }
    }
    up.set({ status: 'completed', rowsImported: imported, rowsDuplicate: duplicates });
    await up.save();
  } catch (e) {
    await StatementUpload.updateOne({ _id: up._id }, { $set: { status: 'failed' } });
    throw e;
  }

  const anomalies = await markAnomalies(req.userId);
  res.status(201).json({
    uploadId: String(up._id), fileName: req.file.originalname, found: rows.length, imported, duplicates, skipped, anomalies,
    categorizedBy: preds[0]?.source || 'rules', preview: importedRows.slice(0, 15),
  });
}));

r.get('/', asyncH(async (req, res) => {
  const list = await StatementUpload.find({ userId: req.userId }).sort({ _id: -1 }).limit(10).lean();
  res.json(list.map((u) => ({ id: String(u._id), fileName: u.fileName, fileType: u.fileType, status: u.status, found: u.rowsFound, imported: u.rowsImported, duplicates: u.rowsDuplicate, uploadedAt: u.uploadedAt })));
}));

export default r;
