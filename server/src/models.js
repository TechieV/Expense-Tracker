import mongoose from 'mongoose';
const { Schema, model, Types } = mongoose;

const oid = { type: Types.ObjectId };

export const User = model('User', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 150 },
  passwordHash: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } }));

export const Category = model('Category', (() => {
  const s = new Schema({
    name: { type: String, required: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    color: { type: String, default: '#64748b' },
  });
  s.index({ name: 1, type: 1 }, { unique: true });
  return s;
})());

export const StatementUpload = model('StatementUpload', new Schema({
  userId: { ...oid, required: true, index: true },
  fileName: { type: String, required: true },
  fileType: { type: String, required: true },
  status: { type: String, default: 'processing' },
  rowsFound: { type: Number, default: 0 },
  rowsImported: { type: Number, default: 0 },
  rowsDuplicate: { type: Number, default: 0 },
}, { timestamps: { createdAt: 'uploadedAt', updatedAt: false } }));

export const Transaction = model('Transaction', (() => {
  const s = new Schema({
    userId: { ...oid, required: true },
    categoryId: { ...oid, default: null },
    uploadId: { ...oid, default: null },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },   // 'YYYY-MM-DD' (sorts correctly as text)
    month: { type: String, required: true },                                  // 'YYYY-MM', makes monthly grouping simple
    amount: { type: Number, required: true, min: 0.01 },
    description: { type: String, default: '', maxlength: 255 },
    type: { type: String, enum: ['income', 'expense'], required: true },
    isAnomaly: { type: Boolean, default: false },
    // Every transaction has a key. Imported rows use a hash of their content, so re-uploading a statement is rejected
    // by the unique index below; manual entries get a random key and are never treated as duplicates.
    dedupeKey: { type: String, required: true },
  });
  s.index({ userId: 1, date: -1 });
  s.index({ userId: 1, dedupeKey: 1 }, { unique: true });
  return s;
})());

export const Budget = model('Budget', (() => {
  const s = new Schema({
    userId: { ...oid, required: true },
    categoryId: { ...oid, required: true },
    month: { type: String, required: true },
    limitAmount: { type: Number, required: true, min: 1 },
  });
  s.index({ userId: 1, categoryId: 1, month: 1 }, { unique: true });
  return s;
})());
