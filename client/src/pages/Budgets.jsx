import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, thisMonth, monthLabel, getCatIcon } from '../format.js';

export default function Budgets() {
  const [month, setMonth] = useState(thisMonth());
  const [cats, setCats] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [inputs, setInputs] = useState({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    api('/categories')
      .then((c) => setCats(c.filter((x) => x.type === 'expense')))
      .catch((e) => setError(e.message));
  }, []);

  const load = useCallback(
    () =>
      api(`/budgets?month=${month}`)
        .then((b) => {
          setBudgets(b);
          setInputs({});
        })
        .catch((e) => setError(e.message)),
    [month]
  );

  useEffect(() => {
    setError('');
    setSaved('');
    load();
  }, [load]);

  async function save(c) {
    setError('');
    setSaved('');
    try {
      setBudgets(
        await api('/budgets', {
          method: 'POST',
          body: { categoryId: c.id, month, limitAmount: Number(inputs[c.id]) },
        })
      );
      setInputs({ ...inputs, [c.id]: undefined });
      setSaved(`${c.name} budget saved for ${monthLabel(month)}`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(b) {
    try {
      await api(`/budgets/${b.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Budgets</h1>
          <p className="muted">Set a monthly limit per category and get alerted before you overspend ({monthLabel(month)})</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </div>

      {error && <div className="alert bad">{error}</div>}
      {saved && <div className="alert good">{saved}</div>}

      <section className="card flush">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Progress ({monthLabel(month)})</th>
                <th>Monthly limit (₹)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => {
                const b = budgets.find((x) => x.categoryId === c.id);
                return (
                  <tr key={c.id}>
                    <td>
                      <span className="cat-badge" style={{ background: (c.color || '#64748b') + '1c', color: c.color || '#334155' }}>
                        <span className="cat-icon">{getCatIcon(c.name)}</span>
                        <span>{c.name}</span>
                      </span>
                    </td>
                    <td style={{ minWidth: 220 }}>
                      {b ? (
                        <>
                          <div className="bar">
                            <div className={`fill ${b.status}`} style={{ width: `${Math.min(100, b.percent)}%` }} />
                          </div>
                          <small className="muted">
                            {money(b.spent)} of {money(b.limitAmount)} ({b.percent}%)
                          </small>
                        </>
                      ) : (
                        <small className="muted">No budget set</small>
                      )}
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        type="number"
                        min="1"
                        placeholder={b ? String(b.limitAmount) : 'Set limit'}
                        value={inputs[c.id] ?? ''}
                        onChange={(e) => setInputs({ ...inputs, [c.id]: e.target.value })}
                      />
                    </td>
                    <td className="right nowrap">
                      <button
                        className="btn primary small"
                        disabled={!inputs[c.id]}
                        onClick={() => save(c)}
                      >
                        {b ? 'Update' : 'Set'}
                      </button>
                      {b && (
                        <button className="icon-btn" title="Remove budget" onClick={() => remove(b)}>
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
