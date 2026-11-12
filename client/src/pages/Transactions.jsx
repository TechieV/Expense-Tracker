import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { money2, fmtDate, monthLabel, thisMonth, today, getCatIcon } from '../format.js';

const emptyForm = () => ({ date: today(), type: 'expense', amount: '', description: '', categoryId: '' });

export default function Transactions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [monthsData, setMonthsData] = useState({ months: [], allTime: { count: 0, income: 0, expense: 0, anomalyCount: 0 } });
  const [selectedMonth, setSelectedMonth] = useState(() => {
    if (searchParams.get('all') === 'true') return '';
    return searchParams.get('month') || null;
  });
  const [typeFilter, setTypeFilter] = useState('');
  const [anomalyOnly, setAnomalyOnly] = useState(searchParams.get('anomaly') === 'true');
  const [catFilter, setCatFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, limit: 25 });
  const [cats, setCats] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  // Load categories
  useEffect(() => {
    api('/categories').then(setCats).catch((e) => setError(e.message));
  }, []);

  // Load months overview
  const loadMonths = useCallback(async () => {
    try {
      const res = await api('/transactions/months');
      setMonthsData(res);
      // If no month was explicitly requested, pick smart default
      setSelectedMonth((cur) => {
        if (cur !== null) return cur;
        const now = thisMonth();
        const hasNow = res.months?.some((m) => m.month === now);
        if (hasNow) return now;
        if (res.months?.length) return res.months[0].month;
        return now;
      });
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadMonths();
  }, [loadMonths]);

  // Load transaction list
  const load = useCallback(() => {
    if (selectedMonth === null) return;
    const p = new URLSearchParams({ page, limit: 25 });
    if (selectedMonth) p.set('month', selectedMonth);
    if (typeFilter) p.set('type', typeFilter);
    if (catFilter) p.set('categoryId', catFilter);
    if (searchQuery.trim()) p.set('q', searchQuery.trim());
    if (anomalyOnly) p.set('anomaly', 'true');

    api(`/transactions?${p}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [selectedMonth, typeFilter, catFilter, searchQuery, anomalyOnly, page]);

  useEffect(() => {
    setError('');
    load();
  }, [load]);

  const selectMonthTab = (m) => {
    setPage(1);
    setSelectedMonth(m);
    const nextParams = new URLSearchParams();
    if (!m) nextParams.set('all', 'true');
    else nextParams.set('month', m);
    if (anomalyOnly) nextParams.set('anomaly', 'true');
    setSearchParams(nextParams);
  };

  const toggleAnomalyFilter = () => {
    setPage(1);
    setAnomalyOnly((prev) => !prev);
  };

  async function remove(t) {
    if (!window.confirm(`Delete "${t.description || 'this transaction'}"?`)) return;
    try {
      await api(`/transactions/${t.id}`, { method: 'DELETE' });
      load();
      loadMonths();
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleAnomaly(t) {
    try {
      const updated = await api(`/transactions/${t.id}/anomaly`, {
        method: 'PUT',
        body: { isAnomaly: !t.isAnomaly },
      });
      setData((prev) => ({
        ...prev,
        items: prev.items.map((item) => (item.id === t.id ? updated : item)),
      }));
      loadMonths();
    } catch (e) {
      setError(e.message);
    }
  }

  // Active month's financial metrics
  const activeStats = selectedMonth
    ? monthsData.months.find((m) => m.month === selectedMonth) || { count: 0, income: 0, expense: 0, savings: 0, anomalyCount: 0 }
    : monthsData.allTime;

  // Build month tabs array: All time + current month + distinct months from DB
  const curMonth = thisMonth();
  const distinctMonths = [...(monthsData.months || [])];
  if (!distinctMonths.some((m) => m.month === curMonth)) {
    distinctMonths.unshift({ month: curMonth, count: 0, income: 0, expense: 0, savings: 0, anomalyCount: 0 });
  }
  distinctMonths.sort((a, b) => b.month.localeCompare(a.month));

  const pages = Math.max(1, Math.ceil(data.total / 25));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Transactions</h1>
          <p className="muted">
            {selectedMonth ? `${monthLabel(selectedMonth)} • ` : 'All Time • '}
            {data.total} transaction{data.total === 1 ? '' : 's'}
          </p>
        </div>
        <button className="btn primary" onClick={() => setEditing(emptyForm())}>+ Add transaction</button>
      </div>

      {/* Month Tabs Bar */}
      <div className="month-tabs-container">
        <div className="month-tabs-track">
          <button
            type="button"
            className={`month-tab-btn ${selectedMonth === '' ? 'active' : ''}`}
            onClick={() => selectMonthTab('')}
          >
            <span>All Time</span>
            <span className="month-badge">{monthsData.allTime?.count || 0}</span>
          </button>

          {distinctMonths.map((m) => (
            <button
              key={m.month}
              type="button"
              className={`month-tab-btn ${selectedMonth === m.month ? 'active' : ''}`}
              onClick={() => selectMonthTab(m.month)}
            >
              <span>{monthLabel(m.month)}</span>
              <span className="month-badge">{m.count}</span>
            </button>
          ))}
        </div>

        <div className="month-custom-picker">
          <label style={{ margin: 0, flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748b' }}>
            <span>Jump to:</span>
            <input
              type="month"
              value={selectedMonth || ''}
              onChange={(e) => e.target.value && selectMonthTab(e.target.value)}
            />
          </label>
        </div>
      </div>

      {/* Financial Summary Strip */}
      <div className="summary-strip">
        <div className="summary-card">
          <div className="summary-card-title">
            <span>Income</span>
            <span style={{ color: 'var(--green)' }}>↗</span>
          </div>
          <div className="summary-card-val income">+{money2(activeStats.income)}</div>
          <div className="summary-card-sub">{selectedMonth ? monthLabel(selectedMonth) : 'All time'}</div>
        </div>

        <div className="summary-card">
          <div className="summary-card-title">
            <span>Expenses</span>
            <span style={{ color: 'var(--red)' }}>↘</span>
          </div>
          <div className="summary-card-val expense">−{money2(activeStats.expense)}</div>
          <div className="summary-card-sub">{selectedMonth ? monthLabel(selectedMonth) : 'All time'}</div>
        </div>

        <div className="summary-card">
          <div className="summary-card-title">
            <span>Net Cashflow</span>
            <span>{activeStats.income >= activeStats.expense ? '💎' : '📉'}</span>
          </div>
          <div className={`summary-card-val savings ${activeStats.income < activeStats.expense ? 'negative' : ''}`}>
            {activeStats.income >= activeStats.expense ? '+' : '−'}
            {money2(Math.abs((activeStats.income || 0) - (activeStats.expense || 0)))}
          </div>
          <div className="summary-card-sub">
            {activeStats.income > 0
              ? `${Math.round(((activeStats.income - activeStats.expense) / activeStats.income) * 100)}% savings rate`
              : 'Cashflow'}
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-card-title">
            <span>Available Balance</span>
            <span>🏦</span>
          </div>
          <div className={`summary-card-val ${activeStats.balance < 0 ? 'expense' : 'income'}`}>
            {money2(activeStats.balance != null ? activeStats.balance : (activeStats.income - activeStats.expense))}
          </div>
          <div className="summary-card-sub">
            {activeStats.balanceSource === 'statement'
              ? (activeStats.balanceAsOf ? `Bank statement (${fmtDate(activeStats.balanceAsOf)})` : 'Verified statement')
              : 'Statement balance'}
          </div>
        </div>

        <div
          className={`summary-card ${activeStats.anomalyCount ? 'clickable' : ''}`}
          onClick={activeStats.anomalyCount ? toggleAnomalyFilter : undefined}
          title={activeStats.anomalyCount ? 'Click to toggle unusual expenses' : undefined}
        >
          <div className="summary-card-title">
            <span>Anomalies</span>
            <span>{activeStats.anomalyCount ? '⚠️' : '🛡️'}</span>
          </div>
          <div className="summary-card-val" style={{ color: activeStats.anomalyCount ? '#b91c1c' : '#64748b' }}>
            {activeStats.anomalyCount ? `${activeStats.anomalyCount} Flagged` : '0 Clean'}
          </div>
          <div className="summary-card-sub">
            {activeStats.anomalyCount ? (anomalyOnly ? 'Showing flagged only (click to clear)' : 'Click to review') : 'No unusual spikes'}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-bar">
        <div className="filter-pills">
          <button
            type="button"
            className={`filter-pill ${!typeFilter && !anomalyOnly ? 'active' : ''}`}
            onClick={() => { setPage(1); setTypeFilter(''); setAnomalyOnly(false); }}
          >
            All
          </button>
          <button
            type="button"
            className={`filter-pill ${typeFilter === 'expense' && !anomalyOnly ? 'active' : ''}`}
            onClick={() => { setPage(1); setTypeFilter('expense'); setAnomalyOnly(false); }}
          >
            Expenses
          </button>
          <button
            type="button"
            className={`filter-pill ${typeFilter === 'income' && !anomalyOnly ? 'active' : ''}`}
            onClick={() => { setPage(1); setTypeFilter('income'); setAnomalyOnly(false); }}
          >
            Income
          </button>
          {activeStats.anomalyCount > 0 && (
            <button
              type="button"
              className={`filter-pill warning-pill ${anomalyOnly ? 'active' : ''}`}
              onClick={toggleAnomalyFilter}
            >
              ⚠️ Unusual ({activeStats.anomalyCount})
            </button>
          )}
        </div>

        <select
          value={catFilter}
          onChange={(e) => { setPage(1); setCatFilter(e.target.value); }}
          style={{ width: 170, fontSize: 13, padding: '7px 10px' }}
        >
          <option value="">All Categories</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {getCatIcon(c.name)} {c.name}
            </option>
          ))}
        </select>

        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            placeholder="Search description…"
            value={searchQuery}
            onChange={(e) => { setPage(1); setSearchQuery(e.target.value); }}
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => { setPage(1); setSearchQuery(''); }}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert bad">{error}</div>}

      {/* Transactions Table */}
      <section className="card flush">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th className="right">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted empty">
                    {anomalyOnly
                      ? 'No unusual transactions found in this view.'
                      : 'No transactions found. Try selecting another month or "All Time".'}
                  </td>
                </tr>
              )}
              {data.items.map((t) => (
                <tr key={t.id}>
                  <td className="nowrap muted">{fmtDate(t.date)}</td>
                  <td>
                    <span>{t.description || '—'}</span>
                    {t.isAnomaly && (
                      <span
                        className="anomaly-pill"
                        title="Flagged as unusually high for this category. Click ✕ to dismiss as normal expense."
                        onClick={() => toggleAnomaly(t)}
                      >
                        ⚠️ Unusual
                        <span className="dismiss-btn" title="Dismiss anomaly">✕</span>
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
                  <td className="right nowrap">
                    <button
                      className="icon-btn"
                      title="Edit"
                      onClick={() =>
                        setEditing({
                          id: t.id,
                          date: t.date,
                          type: t.type,
                          amount: t.amount,
                          description: t.description,
                          categoryId: t.categoryId || '',
                        })
                      }
                    >
                      ✏️
                    </button>
                    <button className="icon-btn" title="Delete" onClick={() => remove(t)}>
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="pager">
            <button className="btn ghost small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ← Prev
            </button>
            <span>Page {page} of {pages}</span>
            <button className="btn ghost small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next →
            </button>
          </div>
        )}
      </section>

      {editing && (
        <TxnModal
          initial={editing}
          cats={cats}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            loadMonths();
          }}
        />
      )}
    </>
  );
}

function TxnModal({ initial, cats, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const options = cats.filter((c) => c.type === f.type);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const body = {
      date: f.date,
      type: f.type,
      amount: Number(f.amount),
      description: f.description,
      categoryId: f.categoryId || null,
    };
    try {
      if (f.id) await api(`/transactions/${f.id}`, { method: 'PUT', body });
      else await api('/transactions', { method: 'POST', body });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={f.id ? 'Edit transaction' : 'Add transaction'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <div className="seg">
          {['expense', 'income'].map((t) => (
            <button
              type="button"
              key={t}
              className={f.type === t ? `on ${t}` : ''}
              onClick={() => setF({ ...f, type: t, categoryId: '' })}
            >
              {t === 'expense' ? 'Expense' : 'Income'}
            </button>
          ))}
        </div>
        <div className="row2">
          <label>
            Amount (₹)
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={f.amount}
              onChange={set('amount')}
              required
              autoFocus
            />
          </label>
          <label>
            Date
            <input type="date" value={f.date} onChange={set('date')} required />
          </label>
        </div>
        <label>
          Description
          <input
            value={f.description}
            onChange={set('description')}
            placeholder="e.g. Swiggy dinner"
            maxLength={255}
          />
        </label>
        <label>
          Category
          <select value={f.categoryId} onChange={set('categoryId')}>
            <option value="">🤖 Auto-detect with AI</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {getCatIcon(c.name)} {c.name}
              </option>
            ))}
          </select>
        </label>
        {error && <div className="alert bad">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
