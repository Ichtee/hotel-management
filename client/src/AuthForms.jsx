import { useEffect, useRef, useState } from 'react';
import { api } from './api/client.js';
import { useAuth } from './context/Auth.jsx';
import { BrandName, Field, Notice, useHotelName } from './ui.jsx';

const Icon = ({ d }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const EYE = 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z';
const EYE_OFF = 'M3 3l18 18 M10.6 6.1A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4 M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 4.4-1';
const CHECK = 'M20 6L9 17l-5-5';

// Dùng chung bố cục đăng nhập, đổi nội dung theo cổng khách hoặc nhân viên.
export function AuthShell({ staff, children }) {
  const hotelName = useHotelName();
  const points = staff
    ? ['Manage accounts, roles and promotions', 'Live revenue and occupancy reports', 'Role-based access for every team member']
    : ['Best-price guarantee on every room', 'Cancel or change a booking online', 'Manage all your bookings in one place'];
  return (
    <div className={`split ${staff ? 'staff' : ''}`}>
      <aside className="split-side">
        <a className="brand" href={staff ? '#/admin' : '#/'}><BrandName /></a>
        <div>
          <h2>{staff ? 'Run the hotel with confidence' : 'Your next stay, sorted'}</h2>
          <ul>{points.map((p) => <li key={p}><span className="tick"><Icon d={CHECK} /></span>{p}</li>)}</ul>
        </div>
        <small>© 2026 {hotelName}</small>
      </aside>
      <section className="split-main">
        <div className="split-card">
          {staff && <a className="brand dark mobile-brand" href="#/admin"><BrandName /></a>}
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

function PasswordField({ label, name, error, autoComplete, onChange, minLength, maxLength, children }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} error={error}>
      <span className="pw">
        <input
          name={name}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          onChange={onChange}
          minLength={minLength}
          maxLength={maxLength}
          required
        />
        <button type="button" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow(!show)}><Icon d={show ? EYE_OFF : EYE} /></button>
      </span>
      {children}
    </Field>
  );
}

// Lấy khóa reCAPTCHA từ máy chủ; dùng khóa thử nghiệm nếu chưa cấu hình.
export function Captcha({ onToken, resetKey }) {
  const box = useRef(null); const widget = useRef(null);
  useEffect(() => {
    let alive = true;
    const draw = (siteKey) => { if (alive && box.current && widget.current == null) widget.current = window.grecaptcha.render(box.current, { sitekey: siteKey, callback: onToken, 'expired-callback': () => onToken('') }); };
    api('/auth/captcha-config').then(({ data: { siteKey } }) => {
      if (window.grecaptcha?.render) return draw(siteKey);
      window.__onCaptchaLoad = () => draw(siteKey);
      if (!document.getElementById('recaptcha-js')) document.head.append(Object.assign(document.createElement('script'), { id: 'recaptcha-js', src: 'https://www.google.com/recaptcha/api.js?onload=__onCaptchaLoad&render=explicit', async: true }));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (resetKey && widget.current != null) { window.grecaptcha.reset(widget.current); onToken(''); } }, [resetKey]);
  return <div ref={box} style={{ minHeight: 78 }} />;
}

export function SignIn({ onDone, hint, onForgot }) {
  const { signIn } = useAuth();
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(''); const [tries, setTries] = useState(0);
  const [unverified, setUnverified] = useState(null); const [resent, setResent] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    setBusy(true); setResent(null);
    try { await signIn({ email: f.email, password: f.password, captchaToken: token || undefined }); setErr(null); onDone(); }
    // Mỗi token CAPTCHA chỉ dùng một lần.
    catch (x) { setErr(x); setUnverified(x.code === 'EMAIL_NOT_VERIFIED' ? f.email : null); setBusy(false); setTries((t) => t + 1); }
  };
  const resend = async () => {
    try { setResent({ ok: (await api('/auth/resend-verification', { method: 'POST', body: { email: unverified } })).data.message }); }
    catch (x) { setResent({ error: x }); }
  };
  return (
    <form className="form one" onSubmit={submit}>
      <Field label="Email" error={err?.fields?.email}><input name="email" type="email" autoComplete="email" placeholder="you@example.com" autoFocus required /></Field>
      <PasswordField label="Password" name="password" autoComplete="current-password" error={err?.fields?.password} />
      {onForgot && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-0.35rem', marginBottom: '0.25rem' }}>
          <button
            type="button"
            className="linklike"
            onClick={onForgot}
            style={{ fontSize: '0.85rem', color: 'var(--blue)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Forgot password?
          </button>
        </div>
      )}
      <Captcha onToken={setToken} resetKey={tries} />
      <Notice error={err} />
      {unverified && <p><button type="button" className="btn sm" onClick={resend}>Resend verification email</button></p>}
      {resent && <Notice error={resent.error} ok={resent.ok} />}
      <button className="btn primary wide" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {hint}
    </form>
  );
}

// Liên kết đặt lại mật khẩu đã có email và token nên chỉ yêu cầu mật khẩu mới.
export function ForgotPassword({ onDone, onCancel, link }) {
  const step = link ? 'reset' : 'request';
  const [email, setEmail] = useState(link?.email || '');
  const token = link?.token || '';
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(false);
  const fe = (k) => err?.fields?.[k];

  const handleRequest = async (e) => {
    e.preventDefault();
    setErr(null);
    setOk(null);
    const f = Object.fromEntries(new FormData(e.target));
    const em = (f.email || '').trim();
    if (!em) return;
    setBusy(true);
    try {
      const res = await api('/auth/forgot-password', { method: 'POST', body: { email: em } });
      setEmail(em);
      setOk(res.data?.message || 'If an account exists, a reset link was sent. It is valid for 30 minutes.');
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setErr(null);
    const f = Object.fromEntries(new FormData(e.target));

    if (!RULES.every(([, ok]) => ok(f.newPassword || ''))) {
      setErr({ message: 'Use 8–128 characters with an upper-case letter, a lower-case letter and a number.', fields: { newPassword: 'Use 8–128 characters with an upper-case letter, a lower-case letter and a number.' } });
      return;
    }
    if (f.newPassword !== f.confirmPassword) {
      setErr({ message: 'Passwords do not match.', fields: { confirmPassword: 'Passwords do not match.' } });
      return;
    }

    setBusy(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: {
          email,
          token,
          newPassword: f.newPassword,
          confirmPassword: f.confirmPassword,
        }
      });
      onDone();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form one">
      {step === 'request' ? (
        <form onSubmit={handleRequest} className="form one">
          <Field label="Enter your account email" error={fe('email')}>
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              defaultValue={email}
              autoFocus
              required
            />
          </Field>
          <Notice error={err} ok={ok} />
          <button className="btn primary wide" type="submit" disabled={busy}>
            {busy ? 'Sending link…' : 'Send reset link'}
          </button>
          <button type="button" className="btn wide" onClick={onCancel} style={{ marginTop: '0.25rem' }}>
            Back to Sign in
          </button>
        </form>
      ) : (
        <form onSubmit={handleReset} className="form one">
          <p className="muted" style={{ fontSize: '0.9rem', margin: 0 }}>
            Resetting password for: <strong>{email}</strong>
          </p>
          <PasswordField
            label="New password"
            name="newPassword"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            error={fe('newPassword')}
            onChange={(e) => setPw(e.target.value)}
          >
            <ul className="rules" aria-label="Password requirements">
              {RULES.map(([l, isOk]) => (
                <li key={l} className={isOk(pw) ? 'ok' : ''}>
                  <Icon d={CHECK} />
                  {l}
                </li>
              ))}
            </ul>
          </PasswordField>
          <PasswordField
            label="Confirm new password"
            name="confirmPassword"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            error={fe('confirmPassword')}
          />
          <Notice error={err} ok={ok} />
          <button className="btn primary wide" type="submit" disabled={busy}>
            {busy ? 'Resetting password…' : 'Reset password'}
          </button>
          <button type="button" className="btn wide" onClick={onCancel} style={{ marginTop: '0.25rem' }}>
            Back to Sign in
          </button>
        </form>
      )}
    </div>
  );
}

const RULES = [['8+ characters', (p) => p.length >= 8], ['An upper-case letter', (p) => /[A-Z]/.test(p)], ['A lower-case letter', (p) => /[a-z]/.test(p)], ['A number', (p) => /\d/.test(p)]];

export function Register({ onDone, hint }) {
  const [err, setErr] = useState(null);
  const [pw, setPw] = useState('');
  const fe = (k) => err?.fields?.[k];
  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    const f = Object.fromEntries(new FormData(e.target));

    const fullName = (f.fullName || '').trim();
    if (fullName.length < 2 || fullName.length > 50) {
      setErr({
        message: 'Full name must be 2–50 characters.',
        fields: { fullName: 'Full name must be 2–50 characters.' }
      });
      return;
    }

    const username = (f.username || '').trim();
    if (username.length < 3 || username.length > 40) {
      setErr({
        message: 'Username must be 3–40 characters.',
        fields: { username: 'Username must be 3–40 characters.' }
      });
      return;
    }

    const email = (f.email || '').trim();
    if (email.length < 3 || email.length > 254) {
      setErr({
        message: 'Email must be 3–254 characters.',
        fields: { email: 'Email must be 3–254 characters.' }
      });
      return;
    }

    const phone = (f.phone || '').trim();
    if (!/^(\d{10,11}|\+\d{8,15})$/.test(phone)) {
      setErr({
        message: 'Phone number must have 10 to 11 digits, or + and 8 to 15 digits with the country code.',
        fields: { phone: 'Phone number must have 10 to 11 digits, or + and 8 to 15 digits with the country code.' }
      });
      return;
    }

    if (!RULES.every(([, ok]) => ok(f.password || ''))) {
      setErr({ message: 'Use 8–128 characters with an upper-case letter, a lower-case letter and a number.', fields: { password: 'Use 8–128 characters with an upper-case letter, a lower-case letter and a number.' } });
      return;
    }

    if (f.password !== f.confirmPassword) {
      setErr({
        message: 'Passwords do not match.',
        fields: { confirmPassword: 'Passwords do not match.' }
      });
      return;
    }

    try {
      await api('/auth/register', { method: 'POST', body: { ...f, consent: f.consent === 'on' } });
      // Tài khoản phải xác minh email trước khi đăng nhập.
      onDone(f.email);

    } catch (x) {
      setErr(x);
    }
  };
  return (
    <form className="form" onSubmit={submit}>
      <Field label="Full name" error={fe('fullName')}>
        <input
          name="fullName"
          autoComplete="name"
          minLength={2}
          maxLength={50}
          autoFocus
          required
        />
      </Field>
      <Field label="Username" error={fe('username')}>
        <input
          name="username"
          autoComplete="username"
          minLength={3}
          maxLength={40}
          required
        />
      </Field>
      <Field label="Email" error={fe('email')}>
        <input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          maxLength={254}
          required
        />
      </Field>
      <Field label="Phone" error={fe('phone')}>
        <input
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="0912345678"
          pattern="([0-9]{10,11}|\+[0-9]{8,15})"
          minLength={9}
          maxLength={16}
          title="10–11 digits, or + and 8–15 digits with the country code."
          required
        />
      </Field>
      <div className="full">
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          error={fe('password')}
          onChange={(e) => setPw(e.target.value)}
        >
          <ul className="rules" aria-label="Password requirements">
            {RULES.map(([l, ok]) => <li key={l} className={ok(pw) ? 'ok' : ''}><Icon d={CHECK} />{l}</li>)}
          </ul>
        </PasswordField>
      </div>
      <div className="full">
        <PasswordField
          label="Confirm password"
          name="confirmPassword"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          error={fe('confirmPassword')}
        />
      </div>
      <label className="check full"><input type="checkbox" name="consent" required /><span className="consent-text">I agree to the processing of my personal data (<a href="#/offers" target="_blank" rel="noreferrer">privacy notice</a>) *</span></label>
      {fe('consent') && <p className="full note bad-note" role="alert">{fe('consent')}</p>}
      <div className="full"><Notice error={err && !err.fields ? err : null} /></div>
      <button className="btn primary wide full" type="submit">Create account</button>
      {hint && <div className="full">{hint}</div>}
    </form>
  );
}
