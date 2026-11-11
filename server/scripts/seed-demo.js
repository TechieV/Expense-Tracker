// Creates a demo account with ~3 months of realistic transactions: npm run seed
import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb, loadCategories } from '../src/db.js';
import { User, Transaction, Budget, StatementUpload } from '../src/models.js';
import { categorizeBatch } from '../src/services/categorizer.js';
import { markAnomalies } from '../src/services/anomaly.js';
import { currentMonth, shiftMonth, round2 } from '../src/util.js';

const EMAIL = 'demo@example.com'; const PASSWORD = 'Demo@1234';
let seed = 42; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a, b) => round2(a + rnd() * (b - a));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

await connectDb();
const old = await User.findOne({ email: EMAIL });
if (old) await Promise.all([Transaction.deleteMany({ userId: old._id }), Budget.deleteMany({ userId: old._id }), StatementUpload.deleteMany({ userId: old._id }), User.deleteOne({ _id: old._id })]);
const user = await User.create({ name: 'Demo Student', email: EMAIL, passwordHash: await bcrypt.hash(PASSWORD, 10) });
const uid = String(user._id);

const rows = [];
const now = new Date(); const thisMonth = currentMonth();
for (const delta of [-2, -1, 0]) {
  const m = shiftMonth(thisMonth, delta);
  const lastDay = delta === 0 ? Math.max(1, now.getDate()) : 28;
  const d = (day) => `${m}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
  rows.push({ date: d(1), amount: 55000, type: 'income', description: 'NEFT Salary Credit - Acme Pvt Ltd' });
  rows.push({ date: d(1), amount: 12000, type: 'expense', description: 'House Rent Payment' });
  rows.push({ date: d(3), amount: between(1500, 2100), type: 'expense', description: 'BSES Electricity Bill' });
  rows.push({ date: d(4), amount: 599, type: 'expense', description: 'Jio Recharge' });
  rows.push({ date: d(5), amount: 649, type: 'expense', description: 'Netflix Subscription' });
  for (let i = 0; i < 9; i++) rows.push({ date: d(2 + i * 3), amount: between(180, 650), type: 'expense', description: pick(['Swiggy Order', 'Zomato Dinner', 'Dominos Pizza', 'BigBasket Groceries', 'Starbucks Coffee', 'Blinkit Groceries']) });
  for (let i = 0; i < 7; i++) rows.push({ date: d(2 + i * 4), amount: between(90, 480), type: 'expense', description: pick(['Uber Trip', 'Ola Cab', 'Delhi Metro Recharge', 'Rapido Ride', 'Petrol Pump']) });
  for (let i = 0; i < 6; i++) rows.push({ date: d(3 + i * 4), amount: between(700, 2200), type: 'expense', description: pick(['Amazon Purchase', 'Flipkart Order', 'Myntra Fashion', 'Decathlon Sports']) });
  rows.push({ date: d(12), amount: between(300, 900), type: 'expense', description: 'BookMyShow Movie Tickets' });
  rows.push({ date: d(18), amount: between(400, 1200), type: 'expense', description: 'Apollo Pharmacy' });
  if (delta === 0) rows.push({ date: d(Math.max(2, lastDay - 1)), amount: 18499, type: 'expense', description: 'Amazon - Laptop Bag and Accessories' });
}
const preds = await categorizeBatch(uid, rows);
await Transaction.insertMany(rows.map((r, i) => ({ ...r, userId: user._id, month: r.date.slice(0, 7), categoryId: preds[i].category_id, dedupeKey: `manual:${crypto.randomUUID()}` })));
const cats = await loadCategories();
await Budget.insertMany([['Food', 5000], ['Shopping', 6000], ['Entertainment', 1500], ['Travel', 2500]].map(([n, lim]) => ({ userId: user._id, categoryId: cats.find(n).id, month: thisMonth, limitAmount: lim })));
const flagged = await markAnomalies(uid);
console.log(`Demo data ready: ${rows.length} transactions (${flagged} flagged as unusual, categorized by ${preds[0].source}).`);
console.log(`Log in with  ${EMAIL}  /  ${PASSWORD}`);
await disconnectDb();
