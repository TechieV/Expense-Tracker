import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectDb } from './db.js';
import { requireAuth } from './auth.js';
import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';
import transactionRoutes from './routes/transactions.js';
import budgetRoutes from './routes/budgets.js';
import dashboardRoutes from './routes/dashboard.js';
import insightRoutes from './routes/insights.js';
import statementRoutes from './routes/statements.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false }), authRoutes);
app.use('/api/categories', requireAuth, categoryRoutes);
app.use('/api/transactions', requireAuth, transactionRoutes);
app.use('/api/budgets', requireAuth, budgetRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/insights', requireAuth, insightRoutes);
app.use('/api/statements', requireAuth, statementRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// In production the built React app is served by this same server
const dist = path.join(here, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof mongoose.Error.ValidationError) return res.status(400).json({ error: Object.values(err.errors)[0]?.message || 'Invalid data' });
  if (err instanceof mongoose.Error.CastError) return res.status(400).json({ error: 'Invalid value' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large (max 5 MB)' });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong on the server' : err.message });
});

const port = Number(process.env.PORT || 5000);
connectDb()
  .then(() => app.listen(port, () => console.log(`Expense Tracker API running on http://localhost:${port}`)))
  .catch((e) => { console.error('Could not start. Is MongoDB running? Check MONGODB_URI in server/.env\n', e.message); process.exit(1); });
