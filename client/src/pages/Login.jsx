import { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="auth-page">
      <div className="auth-hero">
        <div className="hero-badge">AI-Powered</div>
        <h1>Smart Expense Tracker</h1>
        <p>Import your bank statement, let AI sort every transaction, and see exactly where your money goes.</p>
        <ul>
          <li>📤 Upload CSV / PDF statements</li>
          <li>🤖 Automatic expense categorization</li>
          <li>⚠️ Unusual spending detection</li>
          <li>🎯 Budgets and overspending alerts</li>
        </ul>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
        {mode === 'register' && (<label>Name<input value={form.name} onChange={set('name')} placeholder="Your name" required autoComplete="name" /></label>)}
        <label>Email<input type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" required autoComplete="email" /></label>
        <label>Password<input type="password" value={form.password} onChange={set('password')} placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'} required minLength={mode === 'register' ? 8 : undefined} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {error && <div className="alert bad">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}</button>
        <p className="switch">
          {mode === 'login' ? 'New here? ' : 'Already have an account? '}
          <a href="#" onClick={(e) => { e.preventDefault(); setError(''); setMode(mode === 'login' ? 'register' : 'login'); }}>{mode === 'login' ? 'Create an account' : 'Log in'}</a>
        </p>
      </form>
    </div>
  );
}
