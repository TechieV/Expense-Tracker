import { useEffect, useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { api } from '../api.js';
import { money, money2, fmtDate, monthLabel, thisMonth, getCatIcon } from '../format.js';

const ICON = { bad: '🚨', warn: '⚠️', good: '✅', info: '💡' };

function Stat({ label, value, tone, hint }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <span>{label}</span>
      <b>{value}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export default function Dashboard() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [insights, setInsights] = useState([]);
  const [error, setError] = useState('');
  const [tableTypeFilter, setTableTypeFilter] = useState('');
  const [anomalyOnly, setAnomalyOnly] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const userSelectedMonth = useRef(false);

  useEffect(() => {
    let live = true;
    setError('');
    const queryMonth = month || 'all';
    Promise.all([
      api(`/dashboard/summary?month=${queryMonth}`),
      api(`/insights?month=${queryMonth === 'all' ? thisMonth() : queryMonth}`),
    ])
      .then(([d, i]) => {
        if (!live) return;
        setData(d);
        setInsights(i);

        // Smart auto-select: if current month has zero activity on first load,
        // and there is an earlier month with data, auto-switch so the user sees their data.
        if (!userSelectedMonth.current && month !== 'all' && d.totals.income === 0 && d.totals.expense === 0) {
          const activeMonths = (d.allMonths || []).filter((m) => m.count > 0);
          if (activeMonths.length > 0) {
            const latestActive = activeMonths[0].month;
            if (latestActive && latestActive !== month) {
              setMonth(latestActive);
            }
          }
        }
      })
      .catch((e) => live && setError(e.message));

    return () => {
      live = false;
    };
  }, [month]);

  const handleSelectMonth = (m) => {
    userSelectedMonth.current = true;
    setShowAllRows(false);
    setMonth(m);
  };

  async function toggleAnomaly(t) {
    try {
      const updated = await api(`/transactions/${t.id}/anomaly`, {
        method: 'PUT',
        body: { isAnomaly: !t.isAnomaly },
      });
      setData((prev) => ({
        ...prev,
        transactions: prev.transactions.map((r) => (r.id === t.id ? updated : r)),
        recent: (prev.recent || []).map((r) => (r.id === t.id ? updated : r)),
      }));
    } catch (e) {
      setError(e.message);
    }
  }

  const allTxns = data?.transactions || data?.recent || [];

  const filteredTxns = useMemo(() => {
    return allTxns.filter((t) => {
      if (tableTypeFilter && t.type !== tableTypeFilter) return false;
      if (anomalyOnly && !t.isAnomaly) return false;
      return true;
    });
  }, [allTxns, tableTypeFilter, anomalyOnly]);

  const visibleTxns = showAllRows ? filteredTxns : filteredTxns.slice(0, 15);

  if (error) return <div className="alert bad">{error}</div>;
  if (!data) return <div className="muted">Loading your dashboard…</div>;

  const { totals, byCategory, monthly, budgets } = data;
  const spent = byCategory.reduce((s, c) => s + c.total, 0);

  // Month tabs: "All Months" + distinct months from allMonths/monthly
  const curM = thisMonth();
  const rawMonths = [...(data.allMonths || [])];
  if (!rawMonths.some((m) => m.month === curM)) {
    rawMonths.unshift({ month: curM, count: 0, income: 0, expense: 0 });
  }
  rawMonths.sort((a, b) => b.month.localeCompare(a.month));

  const anomalyCount = allTxns.filter((t) => t.isAnomaly).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Your money at a glance for {monthLabel(month)}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ margin: 0, flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748b' }}>
            <span>Jump to:</span>
            <input
              type="month"
              value={month === 'all' ? '' : month}
              max={thisMonth()}
              onChange={(e) => e.target.value && handleSelectMonth(e.target.value)}
            />
          </label>
        </div>
      </div>

      {/* Month Pill Button Tabs Bar */}
      <div className="month-tabs-container">
        <div className="month-tabs-track">
          <button
            type="button"
            className={`month-tab-btn ${month === 'all' ? 'active' : ''}`}
            onClick={() => handleSelectMonth('all')}
          >
            <span>All Months</span>
            <span className="month-badge">{data.totalCount ?? allTxns.length}</span>
          </button>

          {rawMonths.map((m) => (
            <button
              key={m.month}
              type="button"
              className={`month-tab-btn ${month === m.month ? 'active' : ''}`}
              onClick={() => handleSelectMonth(m.month)}
            >
              <span>{monthLabel(m.month)}</span>
              <span className="month-badge">{m.count}</span>
            </button>
          ))}
        </div>

        <Link
          to={month === 'all' ? '/transactions?all=true' : `/transactions?month=${month}`}
          className="btn ghost small"
        >
          Open in Transactions →
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="stats">
        <Stat label="Income" value={money(totals.income)} tone="green" />
        <Stat label="Expenses" value={money(totals.expense)} tone="red" />
        <Stat
          label={month === 'all' ? 'Net Cashflow' : 'Savings this month'}
          value={money(totals.savings)}
          tone={totals.savings >= 0 ? 'teal' : 'red'}
          hint={totals.income ? `${Math.round((totals.savings / totals.income) * 100)}% of income` : ''}
        />
        <Stat
          label="Available balance"
          value={money(totals.balance)}
          tone={totals.balance >= 0 ? 'navy' : 'red'}
          hint={
            totals.balanceSource === 'statement'
              ? (totals.balanceAsOf ? `Bank statement (${fmtDate(totals.balanceAsOf)})` : 'Verified from bank statement')
              : 'Calculated (Income − Expenses)'
          }
        />
      </div>

      {/* Grid 2: Spending by Category & Income vs Expenses */}
      <div className="grid-2">
        <section className="card">
          <h3>Spending by category</h3>
          {byCategory.length === 0 ? (
            <p className="muted empty">No expenses recorded for {monthLabel(month)}.</p>
          ) : (
            <div className="donut-wrap">
              <div className="donut">
                <ResponsiveContainer width="100%" height={210}>
                  <PieChart>
                    <Pie
                      data={byCategory}
                      dataKey="total"
                      nameKey="name"
                      innerRadius={62}
                      outerRadius={92}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {byCategory.map((c) => (
                        <Cell key={c.name} fill={c.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => money2(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center">
                  <small>Spent</small>
                  <b>{money(spent)}</b>
                </div>
              </div>
              <ul className="legend">
                {byCategory.map((c) => (
                  <li key={c.name}>
                    <i style={{ background: c.color }} />
                    <span>
                      {getCatIcon(c.name)} {c.name}
                    </span>
                    <b>{Math.round((c.total / (spent || 1)) * 100)}%</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Income vs expenses</h3>
            <small className="muted">Click any bar to switch month</small>
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart
              data={(monthly || []).map((m) => ({ ...m, label: monthLabel(m.month) }))}
              margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
              onClick={(state) => {
                if (state && state.activePayload?.[0]?.payload?.month) {
                  handleSelectMonth(state.activePayload[0].payload.month);
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={12}
                tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)}
              />
              <Tooltip formatter={(v) => money2(v)} />
              <Legend />
              <Bar dataKey="income" name="Income" fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      {/* Grid 2: Budgets & Smart Insights */}
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3>Budgets ({monthLabel(month)})</h3>
            <Link to="/budgets">Manage</Link>
          </div>
          {budgets.length === 0 ? (
            <p className="muted empty">
              {month === 'all'
                ? 'Select a specific month above to track monthly category budgets.'
                : `No budgets set for ${monthLabel(month)} yet.`}
            </p>
          ) : (
            budgets.map((b) => (
              <div className="budget-row" key={b.id}>
                <div className="budget-top">
                  <span>
                    <i className="dot" style={{ background: b.color }} />
                    {getCatIcon(b.category)} {b.category}
                  </span>
                  <span className={`pill ${b.status}`}>
                    {b.status === 'over' ? 'Over budget' : b.status === 'warning' ? 'Almost there' : 'On track'}
                  </span>
                </div>
                <div className="bar">
                  <div
                    className={`fill ${b.status}`}
                    style={{ width: `${Math.min(100, b.percent)}%` }}
                  />
                </div>
                <small className="muted">
                  {money(b.spent)} of {money(b.limitAmount)} ({b.percent}%)
                </small>
              </div>
            ))
          )}
        </section>

        <section className="card">
          <h3>Smart insights</h3>
          <ul className="insights">
            {insights.length === 0 ? (
              <li className="info">
                <span>💡</span>
                <p>Everything looks normal! Keep tracking your spending to unlock personalized spending insights.</p>
              </li>
            ) : (
              insights.map((i, k) => (
                <li key={k} className={i.severity}>
                  <span>{ICON[i.severity]}</span>
                  <p>{i.message}</p>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      {/* Transactions Section - Shows ALL transactions of that month / all months */}
      <section className="card">
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>
              Transactions ({monthLabel(month)})
            </h3>
            <small className="muted">
              Showing {filteredTxns.length} of {allTxns.length} transaction{allTxns.length === 1 ? '' : 's'}
            </small>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="filter-pills">
              <button
                type="button"
                className={`filter-pill ${!tableTypeFilter && !anomalyOnly ? 'active' : ''}`}
                onClick={() => { setTableTypeFilter(''); setAnomalyOnly(false); }}
              >
                All ({allTxns.length})
              </button>
              <button
                type="button"
                className={`filter-pill ${tableTypeFilter === 'expense' && !anomalyOnly ? 'active' : ''}`}
                onClick={() => { setTableTypeFilter('expense'); setAnomalyOnly(false); }}
              >
                Expenses
              </button>
              <button
                type="button"
                className={`filter-pill ${tableTypeFilter === 'income' && !anomalyOnly ? 'active' : ''}`}
                onClick={() => { setTableTypeFilter('income'); setAnomalyOnly(false); }}
              >
                Income
              </button>
              {anomalyCount > 0 && (
                <button
                  type="button"
                  className={`filter-pill warning-pill ${anomalyOnly ? 'active' : ''}`}
                  onClick={() => setAnomalyOnly((prev) => !prev)}
                >
                  ⚠️ Unusual ({anomalyCount})
                </button>
              )}
            </div>

            <Link
              to={month === 'all' ? '/transactions?all=true' : `/transactions?month=${month}`}
              className="btn ghost small"
            >
              Full Page view →
            </Link>
          </div>
        </div>

        {filteredTxns.length === 0 ? (
          <p className="muted empty">
            {allTxns.length === 0
              ? `No transactions recorded for ${monthLabel(month)}.`
              : 'No transactions match the selected filter.'}
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTxns.map((t) => (
                    <tr key={t.id}>
                      <td className="nowrap muted">{fmtDate(t.date)}</td>
                      <td>
                        <span>{t.description || '—'}</span>
                        {t.isAnomaly && (
                          <span
                            className="anomaly-pill"
                            title="Flagged as unusually high. Click ✕ to dismiss."
                            onClick={() => toggleAnomaly(t)}
                          >
                            ⚠️ Unusual
                            <span className="dismiss-btn" title="Dismiss">✕</span>
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className="cat-badge"
                          style={{
                            background: (t.categoryColor || '#64748b') + '1c',
                            color: t.categoryColor || '#334155',
                          }}
                        >
                          <span className="cat-icon">{getCatIcon(t.category)}</span>
                          <span>{t.category || 'Uncategorized'}</span>
                        </span>
                      </td>
                      <td className={`right nowrap amt ${t.type}`}>
                        <div>{t.type === 'income' ? '+' : '−'}{money2(t.amount)}</div>
                        {t.balance != null && (
                          <small className="muted" style={{ fontSize: 11, fontWeight: 500, display: 'block' }}>
                            Bal: {money2(t.balance)}
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredTxns.length > 15 && (
              <div style={{ padding: '12px 16px', textAlign: 'center', borderTop: '1px solid var(--line)' }}>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setShowAllRows((prev) => !prev)}
                >
                  {showAllRows
                    ? '▲ Show top 15 only'
                    : `▼ Show all ${filteredTxns.length} transactions`}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
