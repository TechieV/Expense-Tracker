import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { api } from '../api.js';
import { money, money2, fmtDate, monthLabel, thisMonth } from '../format.js';

const ICON = { bad: '🚨', warn: '⚠️', good: '✅', info: '💡' };

function Stat({ label, value, tone, hint }) {
  return (<div className={`stat ${tone || ''}`}><span>{label}</span><b>{value}</b>{hint && <small>{hint}</small>}</div>);
}

export default function Dashboard() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [insights, setInsights] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true; setError('');
    Promise.all([api(`/dashboard/summary?month=${month}`), api(`/insights?month=${month}`)])
      .then(([d, i]) => { if (live) { setData(d); setInsights(i); } })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [month]);

  if (error) return <div className="alert bad">{error}</div>;
  if (!data) return <div className="muted">Loading your dashboard…</div>;
  const { totals, byCategory, monthly, budgets, recent } = data;
  const spent = byCategory.reduce((s, c) => s + c.total, 0);

  return (
    <>
      <div className="page-head">
        <div><h1>Dashboard</h1><p className="muted">Your money at a glance</p></div>
        <input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>

      <div className="stats">
        <Stat label="Income" value={money(totals.income)} tone="green" />
        <Stat label="Expenses" value={money(totals.expense)} tone="red" />
        <Stat label="Savings this month" value={money(totals.savings)} tone={totals.savings >= 0 ? 'teal' : 'red'} hint={totals.income ? `${Math.round((totals.savings / totals.income) * 100)}% of income` : ''} />
        <Stat label="Available balance" value={money(totals.balance)} tone="navy" hint="All time" />
      </div>

      <div className="grid-2">
        <section className="card">
          <h3>Spending by category</h3>
          {byCategory.length === 0 ? <p className="muted empty">No expenses this month.</p> : (
            <div className="donut-wrap">
              <div className="donut">
                <ResponsiveContainer width="100%" height={210}>
                  <PieChart>
                    <Pie data={byCategory} dataKey="total" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="none">
                      {byCategory.map((c) => <Cell key={c.name} fill={c.color} />)}
                    </Pie>
                    <Tooltip formatter={(v) => money2(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center"><small>Spent</small><b>{money(spent)}</b></div>
              </div>
              <ul className="legend">
                {byCategory.map((c) => (<li key={c.name}><i style={{ background: c.color }} /><span>{c.name}</span><b>{Math.round((c.total / spent) * 100)}%</b></li>))}
              </ul>
            </div>
          )}
        </section>
        <section className="card">
          <h3>Income vs expenses</h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={monthly.map((m) => ({ ...m, label: monthLabel(m.month) }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
              <Tooltip formatter={(v) => money2(v)} />
              <Legend />
              <Bar dataKey="income" name="Income" fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h3>Budgets</h3><Link to="/budgets">Manage</Link></div>
          {budgets.length === 0 ? <p className="muted empty">No budgets set for this month yet.</p> : budgets.map((b) => (
            <div className="budget-row" key={b.id}>
              <div className="budget-top"><span><i className="dot" style={{ background: b.color }} />{b.category}</span><span className={`pill ${b.status}`}>{b.status === 'over' ? 'Over budget' : b.status === 'warning' ? 'Almost there' : 'On track'}</span></div>
              <div className="bar"><div className={`fill ${b.status}`} style={{ width: `${Math.min(100, b.percent)}%` }} /></div>
              <small className="muted">{money(b.spent)} of {money(b.limitAmount)} ({b.percent}%)</small>
            </div>
          ))}
        </section>
        <section className="card">
          <h3>Smart insights</h3>
          <ul className="insights">
            {insights.map((i, k) => (<li key={k} className={i.severity}><span>{ICON[i.severity]}</span><p>{i.message}</p></li>))}
          </ul>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h3>Recent transactions</h3><Link to="/transactions">View all</Link></div>
        {recent.length === 0 ? <p className="muted empty">Nothing yet. Add a transaction or import a statement.</p> : (
          <div className="table-wrap"><table className="table">
            <tbody>
              {recent.map((t) => (
                <tr key={t.id}>
                  <td className="nowrap muted">{fmtDate(t.date)}</td>
                  <td>{t.description || '—'} {t.isAnomaly ? <span className="pill over" title="Much higher than usual for this category">Unusual</span> : null}</td>
                  <td><span className="badge" style={{ background: (t.categoryColor || '#64748b') + '22', color: t.categoryColor || '#64748b' }}>{t.category || 'Uncategorized'}</span></td>
                  <td className={`right nowrap amt ${t.type}`}>{t.type === 'income' ? '+' : '−'}{money2(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
