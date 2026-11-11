import { Transaction } from '../models.js';
import { loadCategories } from '../db.js';
import { monthRange, shiftMonth, currentMonth } from '../util.js';
import { sumsByCategory, totalsBetween, budgetStatus } from './stats.js';

const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

/** Builds readable insights for one month from the user's own transaction data. */
export async function buildInsights(userId, month) {
  const [from, to] = monthRange(month);
  const [pf, pt] = monthRange(shiftMonth(month, -1));
  const out = [];
  const tot = await totalsBetween(userId, from, to);
  if (!tot.income && !tot.expense) return [{ kind: 'info', severity: 'info', message: 'No transactions in this month yet. Add some or upload a bank statement to see insights.' }];

  const cats = await loadCategories();
  const nameOf = (id) => cats.byId.get(id)?.name || 'Uncategorized';
  const cur = [...(await sumsByCategory(userId, from, to)).entries()].map(([id, total]) => ({ name: nameOf(id), total })).sort((a, b) => b.total - a.total);
  const prevMap = new Map([...(await sumsByCategory(userId, pf, pt)).entries()].map(([id, total]) => [nameOf(id), total]));

  if (cur.length && tot.expense > 0) {
    out.push({ kind: 'top-category', severity: 'info', message: `${cur[0].name} is your biggest expense: ${inr(cur[0].total)}, ${Math.round((cur[0].total / tot.expense) * 100)}% of this month's spending.` });
  }
  for (const c of cur) {
    const p = prevMap.get(c.name);
    if (p && p > 0 && c.total > p * 1.2 && c.total - p > 500) out.push({ kind: 'category-up', severity: 'warn', message: `${c.name} spending is up ${Math.round(((c.total - p) / p) * 100)}% from last month (${inr(p)} to ${inr(c.total)}).` });
    if (p && p > 0 && c.total < p * 0.8 && p - c.total > 500) out.push({ kind: 'category-down', severity: 'good', message: `You spent ${Math.round(((p - c.total) / p) * 100)}% less on ${c.name} than last month. Nice.` });
  }

  for (const b of await budgetStatus(userId, month, [from, to])) {
    const pct = (b.spent / b.limitAmount) * 100;
    if (pct >= 100) out.push({ kind: 'budget-over', severity: 'bad', message: `You have exceeded your ${b.category} budget by ${inr(b.spent - b.limitAmount)} (${inr(b.spent)} of ${inr(b.limitAmount)}).` });
    else if (pct >= 80) out.push({ kind: 'budget-near', severity: 'warn', message: `${b.category} budget is ${Math.round(pct)}% used (${inr(b.spent)} of ${inr(b.limitAmount)}).` });
  }

  if (month === currentMonth()) {
    const now = new Date(); const day = now.getDate(); const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (day >= 7 && day < dim && tot.expense > 0) {
      out.push({ kind: 'projection', severity: 'info', message: `At this pace you will spend about ${inr((tot.expense / day) * dim)} by the end of the month.` });
    }
  }
  if (tot.income > 0) {
    const rate = ((tot.income - tot.expense) / tot.income) * 100;
    if (rate < 0) out.push({ kind: 'savings', severity: 'bad', message: `You spent ${inr(tot.expense - tot.income)} more than you earned this month.` });
    else if (rate < 10) out.push({ kind: 'savings', severity: 'warn', message: `Your savings rate is ${Math.round(rate)}%. A common target is 20% of income.` });
    else if (rate >= 20) out.push({ kind: 'savings', severity: 'good', message: `You saved ${Math.round(rate)}% of your income this month. Great discipline.` });
  }
  const unusual = await Transaction.find({ userId, isAnomaly: true, date: { $gte: from, $lt: to } }, 'description amount').sort({ amount: -1 }).limit(3).lean();
  for (const u of unusual) out.push({ kind: 'anomaly', severity: 'bad', message: `Unusual transaction: "${u.description || 'No description'}" for ${inr(u.amount)} is much higher than your normal spending in that category.` });
  return out;
}
