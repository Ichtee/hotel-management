import { useState } from 'react';
import { api } from './api/client.js';
import { useAuth } from './context/Auth.jsx';
import { Field, Notice } from './ui.jsx';

const Icon = ({ d }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const EYE = 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z';
const EYE_OFF = 'M3 3l18 18 M10.6 6.1A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4 M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 4.4-1';
const CHECK = 'M20 6L9 17l-5-5';

// Split layout: brand panel + form card. `staff` swaps the copy for the admin portal.
export function AuthShell({ staff, children }) {
  const points = staff
    ? ['Manage accounts, roles and promotions', 'Live revenue and occupancy reports', 'Role-based access for every team member']
    : ['Best-price guarantee on every room', 'Free cancellation up to 48 hours before', 'Manage all your bookings in one place'];
  return (
    <div className={`split ${staff ? 'staff' : ''}`}>
      <aside className="split-side">
        <a className="brand" href={staff ? '#/admin' : '#/'}>Grand<span>Stay</span></a>
        <div>
          <h2>{staff ? 'Run the hotel with confidence' : 'Your next stay, sorted'}</h2>
          <ul>{points.map((p) => <li key={p}><span className="tick"><Icon d={CHECK} /></span>{p}</li>)}</ul>
        </div>
        <small>© 2026 GrandStay</small>
      </aside>
      <section className="split-main">
        <div className="split-card">
          {staff && <a className="brand dark mobile-brand" href="#/admin">Grand<span>Stay</span></a>}
          {children}
        </div>
      </section>
    </div>
  );
}

export function AuthTabs({ mode, onChange }) {
  return (
    <div className="seg" role="tablist" aria-label="Account">
      {[['login', 'Sign in'], ['register', 'Create account']].map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

function PasswordField({ label, name, error, autoComplete, onChange, children }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} error={error}>
      <span className="pw">
        <input name={name} type={show ? 'text' : 'password'} autoComplete={autoComplete} onChange={onChange} required />
        <button type="button" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow(!show)}><Icon d={show ? EYE_OFF : EYE} /></button>
      </span>
      {children}
    </Field>
  );
}

export function SignIn({ onDone, hint }) {
  const { signIn } = useAuth();
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    setBusy(true);
    try { await signIn({ email: f.email, password: f.password }); setErr(null); onDone(); }
    catch (x) { setErr(x); setBusy(false); }
  };
  return (
    <form className="form one" onSubmit={submit}>
      <Field label="Email" error={err?.fields?.email}><input name="email" type="email" autoComplete="email" placeholder="you@example.com" autoFocus required /></Field>
      <PasswordField label="Password" name="password" autoComplete="current-password" error={err?.fields?.password} />
      <Notice error={err} />
      <button className="btn primary wide" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {hint}
    </form>
  );
}

const RULES = [['10+ characters', (p) => p.length >= 10], ['A letter', (p) => /[A-Za-z]/.test(p)], ['A number', (p) => /\d/.test(p)]];

export function Register({ onDone, hint }) {
  const [err, setErr] = useState(null);
  const [pw, setPw] = useState('');
  const { signIn } = useAuth();
  const fe = (k) => err?.fields?.[k];
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api('/auth/register', { method: 'POST', body: f }); await signIn({ email: f.email, password: f.password }); onDone(); }
    catch (x) { setErr(x); }
  };
  return (
    <form className="form" onSubmit={submit}>
      <Field label="Full name" error={fe('fullName')}><input name="fullName" autoComplete="name" autoFocus required /></Field>
      <Field label="Username" error={fe('username')}><input name="username" autoComplete="username" required /></Field>
      <Field label="Email" error={fe('email')}><input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></Field>
      <Field label="Phone" error={fe('phone')}><input name="phone" type="tel" autoComplete="tel" placeholder="0912345678" required /></Field>
      <div className="full">
        <PasswordField label="Password" name="password" autoComplete="new-password" error={fe('password')} onChange={(e) => setPw(e.target.value)}>
          <ul className="rules" aria-label="Password requirements">
            {RULES.map(([l, ok]) => <li key={l} className={ok(pw) ? 'ok' : ''}><Icon d={CHECK} />{l}</li>)}
          </ul>
        </PasswordField>
      </div>
      <div className="full"><Notice error={err && !err.fields ? err : null} /></div>
      <button className="btn primary wide full" type="submit">Create account</button>
      {hint && <div className="full">{hint}</div>}
    </form>
  );
}
