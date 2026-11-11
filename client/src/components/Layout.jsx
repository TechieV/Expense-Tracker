import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const links = [
  ['/', '📊', 'Dashboard'],
  ['/transactions', '🧾', 'Transactions'],
  ['/upload', '📤', 'Import Statement'],
  ['/budgets', '🎯', 'Budgets'],
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon">💰</span><div><b>Smart Expense</b><small>Tracker</small></div></div>
        <nav>
          {links.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span>{icon}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="userbox">
          <div className="avatar">{user.name.charAt(0).toUpperCase()}</div>
          <div className="who"><b>{user.name}</b><small>{user.email}</small></div>
          <button className="btn ghost small" onClick={logout}>Log out</button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
