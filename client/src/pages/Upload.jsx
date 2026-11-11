import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { money2, fmtDate } from '../format.js';

export default function Upload() {
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const input = useRef();

  const loadHistory = () => api('/statements').then(setHistory).catch(() => {});
  useEffect(() => { loadHistory(); }, []);

  const pick = (f) => { if (!f) return; setResult(null); setError(''); setFile(f); };

  async function submit() {
    setBusy(true); setError(''); setResult(null);
    const form = new FormData(); form.append('file', file);
    try { setResult(await api('/statements', { method: 'POST', form })); setFile(null); loadHistory(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head"><div><h1>Import bank statement</h1><p className="muted">Upload a CSV or text-based PDF statement. Transactions are extracted, de-duplicated and categorized automatically.</p></div></div>

      <section className="card">
        <div className={`dropzone ${drag ? 'drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }} onClick={() => input.current.click()}>
          <div className="dz-icon">📄</div>
          {file ? <b>{file.name}</b> : <b>Drag & drop your statement here, or click to browse</b>}
          <small className="muted">CSV or PDF, up to 5 MB</small>
          <input ref={input} type="file" accept=".csv,.pdf" hidden onChange={(e) => pick(e.target.files[0])} />
        </div>
        {error && <div className="alert bad">{error}</div>}
        <div className="upload-actions">
          <button className="btn primary" disabled={!file || busy} onClick={submit}>{busy ? 'Processing…' : 'Upload & import'}</button>
        </div>
      </section>

      {result && (
        <section className="card">
          <h3>Import complete ✅</h3>
          <div className="stats small">
            <div className="stat"><span>Rows found</span><b>{result.found}</b></div>
            <div className="stat green"><span>Imported</span><b>{result.imported}</b></div>
            <div className="stat"><span>Duplicates skipped</span><b>{result.duplicates}</b></div>
            <div className="stat red"><span>Flagged unusual</span><b>{result.anomalies}</b></div>
          </div>
          <p className="muted">Categorized by {result.categorizedBy === 'ai' ? 'the AI model 🤖' : 'keyword rules (AI service is offline)'}.</p>
          {result.preview.length > 0 && (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="right">Amount</th></tr></thead>
              <tbody>{result.preview.map((t, i) => (<tr key={i}><td className="nowrap muted">{fmtDate(t.date)}</td><td>{t.description}</td><td><span className="badge">{t.category}</span></td><td className={`right nowrap amt ${t.type}`}>{t.type === 'income' ? '+' : '−'}{money2(t.amount)}</td></tr>))}</tbody>
            </table></div>
          )}
          <p><Link to="/transactions">See all transactions →</Link></p>
        </section>
      )}

      {history.length > 0 && (
        <section className="card">
          <h3>Recent imports</h3>
          <table className="table"><thead><tr><th>File</th><th>Status</th><th className="right">Imported</th><th className="right">Duplicates</th></tr></thead>
            <tbody>{history.map((h) => (<tr key={h.id}><td>{h.fileName}</td><td><span className={`pill ${h.status === 'completed' ? 'ok' : 'over'}`}>{h.status}</span></td><td className="right">{h.imported} / {h.found}</td><td className="right">{h.duplicates}</td></tr>))}</tbody>
          </table>
        </section>
      )}
    </>
  );
}
