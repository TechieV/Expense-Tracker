import { loadCategories } from '../db.js';
import { Transaction } from '../models.js';

// Keyword rules: used as the fallback when the Python AI service is not running.
const RULES = {
  Food: [
    'swiggy', 'zomato', 'domino', 'mcdonald', 'kfc', 'starbucks', 'cafe', 'coffee',
    'restaurant', 'grocery', 'groceries', 'big basket', 'bigbasket', 'blinkit', 'zepto',
    'instamart', 'dmart', 'avenue supermarts', 'bakery', 'biryani', 'pizza', 'burger',
    'dhaba', 'haldiram', 'chai', 'canteen', 'supermarket', 'vegetable', 'fruit',
    'bishamber sahai', 'rajwani', 'nathu mal', 'suresh chand', 'sweets', 'confectionery',
    'kitchen', 'dining', 'food', 'meals', 'snack'
  ],
  Travel: [
    'uber', 'ola ', 'olacabs', 'rapido', 'irctc', 'indian railway', 'railway', 'train',
    'dmrc', 'metro', 'delhi metro', 'indigo', 'air india', 'makemytrip', 'redbus',
    'petrol', 'fuel', 'cng', 'indraprastha', 'indraprastha service', 'fastag', 'toll',
    'parking', 'cab ', 'taxi', 'auto ', 'bus ', 'flight', 'airline', 'iocl', 'hpcl', 'bpcl', 'shell'
  ],
  Bills: [
    'electricity', 'bses', 'tata power', 'airtel', 'jio', 'vodafone', 'bsnl',
    'broadband', 'onebroadband', 'water bill', 'gas', 'rent', 'insurance', 'tata aig',
    'lic ', 'premium', 'emi', 'loan', 'credit card', 'recharge', 'dth', 'maintenance',
    'wifi', 'postpaid', 'prepaid', 'milesweb', 'program fee', 'super program', 'subscription'
  ],
  Shopping: [
    'amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'meesho', 'decathlon', 'croma',
    'zara', 'h&m', 'lifestyle', 'shoppers', 'westside', 'pantaloons', 'ikea', 'lenskart',
    'tata cliq', 'snapdeal', 'mall', 'store', 'rahul store', 'jaiswal store', 'paytm'
  ],
  Entertainment: [
    'netflix', 'prime video', 'spotify', 'hotstar', 'disney', 'bookmyshow', 'pvr',
    'inox', 'youtube', 'steam', 'playstation', 'game', 'gaming', 'movie', 'cinema', 'concert', 'zee5', 'sonyliv', 'gaana'
  ],
  Health: [
    'pharmacy', 'apollo', 'medplus', '1mg', 'pharmeasy', 'hospital', 'clinic', 'doctor',
    'pathlab', 'lab ', 'gym', 'cult', 'netmeds', 'dental', 'medical', 'practo', 'diagnostic'
  ],
  Education: [
    'udemy', 'coursera', 'tuition', 'college', 'school', 'fees', 'fee ', 'byju',
    'unacademy', 'books', 'stationery', 'exam', 'upgrad', 'course', 'library'
  ],
  Transfer: [
    'sentimps', 'imps', 'neft', 'rtgs', 'fund transfer', 'self transfer', 'trf to',
    'upi/mr vinay', 'upi/vinay', 'upi/mithilesh', 'upi/mr rohit', 'upi/sangeeta',
    'upi/suresh', 'upi/drig', 'idibx', '/sent upi', '/upi upi', '/na upi', 'idib', 'upi/'
  ],
};

const RULES_INCOME = {
  Salary: ['salary', 'payroll', 'stipend', 'wages'],
  Transfer: ['kotak811', 'upi/mr vinay', 'upi/vinay', 'upi/drig', 'recdimps', 'imps', 'neft', 'rtgs', 'trf from', 'idib', '/sent upi', '/na upi', 'upi/'],
  Cashback: ['cashback', 'super cashback', 'reward', 'bonus', 'cash back'],
  Investment: ['int.pd', 'interest', 'dividend'],
};

export function ruleCategory(description, type) {
  const d = ` ${String(description || '').toLowerCase()} `;
  if (type === 'income') {
    for (const [cat, words] of Object.entries(RULES_INCOME)) {
      if (words.some((k) => d.includes(k))) return cat;
    }
    return 'Other Income';
  }
  for (const cat of ['Food', 'Travel', 'Bills', 'Entertainment', 'Health', 'Education', 'Shopping', 'Transfer']) {
    const words = RULES[cat];
    if (words.some((w) => d.includes(w))) return cat;
  }
  return 'Other';
}

async function callAi(items, examples) {
  const url = process.env.AI_SERVICE_URL;
  if (!url) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const res = await fetch(`${url}/categorize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ items, examples }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.predictions) && data.predictions.length === items.length ? data.predictions : null;
  } catch {
    return null; // AI service down: fall back to keyword rules
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Categorize a batch of {description, type}. Returns [{category_id, category, source}] in the same order.
 * source is 'ai' (ML model) or 'rules' (keyword fallback).
 */
export async function categorizeBatch(userId, items) {
  if (!items.length) return [];
  const cats = await loadCategories();
  const idOf = (name, type) => (cats.find(name, type) || cats.find(name))?.id ?? null;
  // The user's own labelled history teaches the model their habits (e.g. a local shop they always code as Food)
  const labelled = cats.list.filter((c) => c.name !== 'Other' && c.name !== 'Other Income').map((c) => c.id);
  const history = await Transaction.find({ userId, categoryId: { $in: labelled } }, 'description categoryId').sort({ _id: -1 }).limit(300).lean();
  const examples = history.map((t) => ({ description: t.description, category: cats.byId.get(String(t.categoryId))?.name })).filter((e) => e.category);
  const ai = await callAi(items.map((i) => ({ description: i.description, type: i.type })), examples);
  return items.map((it, k) => {
    const name = ai ? ai[k].category : ruleCategory(it.description, it.type);
    return { category: name, category_id: idOf(name, it.type), source: ai ? 'ai' : 'rules' };
  });
}
