import 'dotenv/config';
import mongoose from 'mongoose';
import { User, Category, StatementUpload, Transaction, Budget } from './models.js';

const DEFAULT_CATEGORIES = [
  ['Food', 'expense', '#f97316'], ['Travel', 'expense', '#0ea5e9'], ['Shopping', 'expense', '#a855f7'],
  ['Bills', 'expense', '#ef4444'], ['Entertainment', 'expense', '#ec4899'], ['Health', 'expense', '#10b981'],
  ['Education', 'expense', '#6366f1'], ['Other', 'expense', '#64748b'],
  ['Salary', 'income', '#16a34a'], ['Other Income', 'income', '#14b8a6'],
];

export async function connectDb() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/expense_tracker';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  // Build indexes (including the unique ones that stop duplicate imports) before serving requests
  await Promise.all([User, Category, StatementUpload, Transaction, Budget].map((m) => m.init()));
  await Category.bulkWrite(DEFAULT_CATEGORIES.map(([name, type, color]) => ({
    updateOne: { filter: { name, type }, update: { $setOnInsert: { name, type, color } }, upsert: true },
  })));
}

export const disconnectDb = () => mongoose.disconnect();

/** All categories (there are only ~10, so we keep them in memory per request instead of joining). */
export async function loadCategories() {
  const list = (await Category.find().lean()).map((c) => ({ id: String(c._id), name: c.name, type: c.type, color: c.color }));
  return { list, byId: new Map(list.map((c) => [c.id, c])), find: (name, type) => list.find((c) => c.name === name && (!type || c.type === type)) };
}
