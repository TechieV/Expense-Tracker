const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => inr0.format(n || 0);
export const money2 = (n) => inr2.format(n || 0);
export const fmtDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
export const monthLabel = (m) => (!m || m === 'all' ? 'All Months' : new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }));
export const monthFull = (m) => (!m || m === 'all' ? 'All Months' : new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }));
export const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const today = () => { const d = new Date(); return `${thisMonth()}-${String(d.getDate()).padStart(2, '0')}`; };

export const shiftMonthStr = (m, delta) => {
  if (!m) return thisMonth();
  const [y, mon] = m.split('-').map(Number);
  const d = new Date(y, mon - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const CATEGORY_ICONS = {
  Food: '🍔',
  Travel: '✈️',
  Transport: '🚗',
  Shopping: '🛍️',
  Bills: '📄',
  Utilities: '⚡',
  Entertainment: '🎬',
  Health: '🏥',
  Medical: '💊',
  Education: '🎓',
  Salary: '💰',
  Investment: '📈',
  Other: '💳',
};

export const getCatIcon = (name) => {
  if (!name) return '💳';
  for (const [k, icon] of Object.entries(CATEGORY_ICONS)) {
    if (name.toLowerCase().includes(k.toLowerCase())) return icon;
  }
  return '💳';
};
