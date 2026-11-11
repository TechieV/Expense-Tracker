import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { money2, fmtDate, thisMonth, today } from '../format.js';

const emptyForm = () => ({ date: today(), type: 'expense', amount: '', description: '', categoryId: '' });

export default function Transactions() {
  const [filters, setFilters] = useState({ month: thisMonth(), type: '', categoryId: '', q: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, limit: 25 });
  const [cats, setCats] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | {id?, ...form}

  useEffect(() => { api('/categories').then(setCats).catch((e) => setError(e.message)); }, []);

  const load = useCallback(() => {
    const p = new URLSearchParams({ page, limit: 25 });
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    api(`/transactions?${p}`).then(setData).catch((e) => setError(e.message));
  }, [filters, page]);
  useEffect(() => { setError(''); load(); }, [load]);

  const setF = (k) => (e) => { setPage(1); setFilters({ ...filters, [k]: e.target.value }); };
  const pages = Math.max(1, Math.ceil(data.total / 25));

  async function remove(t) {
    if (!window.confirm(`Delete "${t.description || 'this transaction'}"?`)) return;
    try { await api(`/transactions/${t.id}`, { method: 'DELETE' }); load(); } catch (e) { setError(e.message); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Transactions</h1><p className="muted">{data.total} transaction{data.total === 1 ? '' : 's'}</p></div>
        <button className="btn primary" onClick={() => setEditing(emptyForm())}>+ Add transaction</button>
      </div>

      <div className="filters card">
        <label>Month<input type="month" value={filters.month} onChange={setF('month')} /></label>
        <label>Type<select value={filters.type} onChange={setF('type')}><option value="">All</option><option value="income">Income</option><option value="expense">Expense</option></select></label>
        <label>Category<select value={filters.categoryId} onChange={setF('categoryId')}><option value="">All</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="grow">Search<input placeholder="Search description…" value={filters.q} onChange={setF('q')} /></label>
        <button className="btn ghost small" onClick={() => { setPage(1); setFilters({ month: '', type: '', categoryId: '', q: '' }); }}>Show all time</button>
      </div>

      {error && <div className="alert bad">{error}</div>}
      <section className="card flush">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="right">Amount</th><th /></tr></thead>
            <tbody>
              {data.items.length === 0 && <tr><td colSpan={5} className="muted empty">No transactions found.</td></tr>}
              {data.items.map((t) => (
                <tr key={t.id}>
                  <td className="nowrap muted">{fmtDate(t.date)}</td>
                  <td>{t.description || '—'} {t.isAnomaly ? <span className="pill over" title="Much higher than usual for this category">Unusual</span> : null}</td>
                  <td><span className="badge" style={{ background: (t.categoryColor || '#64748b') + '22', color: t.categoryColor || '#64748b' }}>{t.category || 'Uncategorized'}</span></td>
                  <td className={`right nowrap amt ${t.type}`}>{t.type === 'income' ? '+' : '−'}{money2(t.amount)}</td>
                  <td className="right nowrap">
                    <button className="icon-btn" title="Edit" onClick={() => setEditing({ id: t.id, date: t.date, type: t.type, amount: t.amount, description: t.description, categoryId: t.categoryId || '' })}>✏️</button>
                    <button className="icon-btn" title="Delete" onClick={() => remove(t)}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="pager">
            <button className="btn ghost small" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
            <span>Page {page} of {pages}</span>
            <button className="btn ghost small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        )}
      </section>

      {editing && <TxnModal initial={editing} cats={cats} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
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
    e.preventDefault(); setError(''); setBusy(true);
    const body = { date: f.date, type: f.type, amount: Number(f.amount), description: f.description, categoryId: f.categoryId || null };
    try {
      if (f.id) await api(`/transactions/${f.id}`, { method: 'PUT', body }); else await api('/transactions', { method: 'POST', body });
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title={f.id ? 'Edit transaction' : 'Add transaction'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <div className="seg">
          {['expense', 'income'].map((t) => (<button type="button" key={t} className={f.type === t ? `on ${t}` : ''} onClick={() => setF({ ...f, type: t, categoryId: '' })}>{t === 'expense' ? 'Expense' : 'Income'}</button>))}
        </div>
        <div className="row2">
          <label>Amount (₹)<input type="number" step="0.01" min="0.01" value={f.amount} onChange={set('amount')} required autoFocus /></label>
          <label>Date<input type="date" value={f.date} onChange={set('date')} required /></label>
        </div>
        <label>Description<input value={f.description} onChange={set('description')} placeholder="e.g. Swiggy dinner" maxLength={255} /></label>
        <label>Category
          <select value={f.categoryId} onChange={set('categoryId')}>
            <option value="">🤖 Auto-detect with AI</option>
            {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {error && <div className="alert bad">{error}</div>}
        <div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}
