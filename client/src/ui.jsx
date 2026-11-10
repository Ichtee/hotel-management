import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api/client.js';

export const Badge = ({ v, pre }) => <span className={`badge b-${v}`}>{pre}{String(v).replace('_', ' ')}</span>;

export const PageHead = ({ title, sub, action, onAction, extra }) => (
  <div className="page-head">
    <div><h1>{title}</h1><p>{sub}</p></div>
    <div className="head-actions">{extra}{action && <button className="btn primary" onClick={onAction}>+ {action}</button>}</div>
  </div>
);

export const Notice = ({ error, ok }) => (error || ok) ? <p role={error ? 'alert' : 'status'} className={error ? 'note bad-note' : 'note ok-note'}>{error?.message || error || ok}</p> : null;

export const Field = ({ label, error, children }) => (
  <label className={error ? 'has-err' : ''}>{label}{children}{error && <small className="err">{error}</small>}</label>
);

// A task is its own page with its own URL: #/path?screen=name&id=123. Back, refresh and a copied link all work.
const hashParts = () => { const [base, qs = ''] = location.hash.split('?'); return [base, new URLSearchParams(qs)]; };
let navigated = false;
export function useScreen() {
  const read = () => { const [, q] = hashParts(); return { name: q.get('screen') || '', id: q.get('id') || '' }; };
  const [s, setS] = useState(read);
  useEffect(() => {
    const on = () => setS(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const go = (name, id = '') => {
    const [base, q] = hashParts();
    q.set('screen', name);
    if (id) q.set('id', id); else q.delete('id');
    navigated = true;
    location.hash = `${base}?${q}`;
  };
  const close = () => {
    if (navigated) { navigated = false; history.back(); return; }
    const [base, q] = hashParts();
    q.delete('screen'); q.delete('id');
    location.hash = q.toString() ? `${base}?${q}` : base;
  };
  return { ...s, go, close };
}
// New / edit pages of a list: #/path?screen=new, or ?screen=edit&id=... (items are the loaded list).
export function useEditPage(items) {
  const sc = useScreen();
  const open = sc.name === 'new' ? {} : sc.name === 'edit' ? (items || []).find((x) => x._id === sc.id) : undefined;
  return { open, missing: sc.name === 'edit' && !open, add: () => sc.go('new'), edit: (x) => sc.go('edit', x._id), close: sc.close };
}
export function Dialog({ title, onClose, children }) {
  const heading = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    heading.current?.focus();
    document.body.classList.add('dlg-open');
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', esc);
    return () => { removeEventListener('keydown', esc); document.body.classList.remove('dlg-open'); before?.focus?.(); };
  }, []);
  return createPortal(
    <div className="dlg-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div className="dlg-head"><h2 id="dlg-title" tabIndex={-1} ref={heading}>{title}</h2><button type="button" className="btn sm" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="dlg-body">{children}</div>
      </div>
    </div>, document.body);
}
export const WaitScreen = ({ loading, onClose }) => (
  <Screen title={loading ? 'Loading…' : 'Not found'} onClose={onClose}><p className="muted">{loading ? 'Loading…' : 'This item was not found.'}</p></Screen>
);
export function Screen({ title, onClose, children }) {
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus();
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, []);
  return (
    <section className="screen">
      <div className="screen-head">
        <button type="button" className="btn back" onClick={onClose}><span aria-hidden="true">←</span> Back</button>
        <h1 tabIndex={-1} ref={heading}>{title}</h1>
      </div>
      <div className="screen-body">{children}</div>
    </section>
  );
}

// A task opens as its own screen in the page area (no overlay): the page behind is hidden, the header shows "Back",
// and the browser Back button returns to the list. One history entry is pushed per screen and removed when it closes.
let screens = 0;
export function Modal({ title, onClose, children }) {
  const [id] = useState(() => ++screens);
  const close = useRef(onClose); close.current = onClose;
  const host = typeof document !== 'undefined' ? document.getElementById('main') : null;
  const heading = useRef(null);
  const alive = useRef(false); const pushed = useRef(false);
  useEffect(() => {
    alive.current = true;
    const scrollY = window.scrollY;
    host?.classList.add('has-screen'); window.scrollTo(0, 0); heading.current?.focus();
    if (!pushed.current) { history.pushState({ screen: id }, ''); pushed.current = true; }
    const back = () => close.current();
    const esc = (e) => { if (e.key === 'Escape') close.current(); };
    window.addEventListener('popstate', back); window.addEventListener('keydown', esc);
    return () => {
      alive.current = false;
      window.removeEventListener('popstate', back); window.removeEventListener('keydown', esc);
      // Deferred: React strict mode unmounts and remounts once in development; only a real close drops our history entry.
      setTimeout(() => {
        if (alive.current) return;
        if (!host?.querySelector('.screen')) host?.classList.remove('has-screen');
        if (history.state?.screen === id) history.back(); // closed by a button, not by Back
        window.scrollTo(0, scrollY);
      }, 0);
    };
  }, []);
  const screen = (
    <section className="screen" aria-labelledby={`screen-${id}`}>
      <div className="screen-head">
        <button type="button" className="btn back" onClick={onClose}><span aria-hidden="true">←</span> Back</button>
        <h1 id={`screen-${id}`} tabIndex={-1} ref={heading}>{title}</h1>
      </div>
      <div className="screen-body">{children}</div>
    </section>
  );
  return host ? createPortal(screen, host) : screen;
}

// Fetches a list endpoint and reloads when the path or params change.
export function useApi(path, enabled = true) {
  const [state, setState] = useState({ data: null, meta: null, error: null, loading: true });
  const load = useCallback(() => {
    if (!enabled || !path) return;
    setState((s) => ({ ...s, loading: true }));
    api(path).then((r) => setState({ data: r.data, meta: r.meta, error: null, loading: false }))
      .catch((error) => setState({ data: null, meta: null, error, loading: false }));
  }, [path, enabled]);
  useEffect(load, [load]);
  return { ...state, reload: load };
}

export function DataTable({ cols, rows }) {
  const words = /^(confirmed|cancellation_requested|checked_in|checked_out|cancelled|pending|assigned|active|inactive|paid|completed|skipped|done|in_progress|open|resolved|high|medium|low|normal|urgent|published|suspended|deleted|approved|rejected|refunded|expired|no_show|unpaid|deposit_paid|fully_paid)$/;
  const figures = /^[\d\s.,:/₫$%+\-–→]+$/; // dates, times and amounts must not wrap
  // "30 Jan 2027" and codes such as BK-MW7Q-10E2 must not break over two lines either
  const tight = (c) => figures.test(c) || /^\d{1,2} [A-Za-z]{3,4} \d{4}$/.test(c) || /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(c);
  return (
    <div className="table-wrap">
      <table className="cards">
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} data-label={cols[j]} className={typeof c === 'string' && tight(c) ? 'nw' : undefined}>{typeof c === 'string' && words.test(c) ? <Badge v={c} /> : c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const niceMax = (v) => { const p = 10 ** Math.floor(Math.log10(v || 1)); return Math.ceil((v || 1) / p) * p; };

// Line/area chart with a hover crosshair; `prev` is an optional comparison series.
export function LineChart({ labels, cur, prev, format, summary }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 240, L = 58, R = 12, T = 12, B = 28;
  const MAX = niceMax(Math.max(...cur, ...(prev || [0])));
  const n = Math.max(cur.length - 1, 1);
  const x = (i) => L + (i / n) * (W - L - R);
  const y = (v) => T + (1 - v / MAX) * (H - T - B);
  const line = (d) => d.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.min(cur.length - 1, Math.max(0, Math.round(((px - L) / (W - L - R)) * n))));
  };
  const step = Math.ceil(labels.length / 5);
  const short = (v) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  return (
    <div className="chart">
      <div className="legend-row"><span><i className="sw cur" />This period</span>{prev && <span><i className="sw prev" />Previous period</span>}</div>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} onMouseMove={move} onMouseLeave={() => setHover(null)}>
          {[0, 1, 2, 3].map((k) => { const t = (MAX / 3) * k; return (
            <g key={k}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="axis">{short(Math.round(t))}</text></g>
          ); })}
          {labels.map((d, i) => i % step === 0 && <text key={d + i} x={x(i)} y={H - 8} textAnchor="middle" className="axis">{d}</text>)}
          <path d={`${line(cur)} L${x(cur.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} className="area" />
          {prev && <path d={line(prev)} className="l-prev" />}
          <path d={line(cur)} className="l-cur" />
          {hover !== null && <g><line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross" /><circle cx={x(hover)} cy={y(cur[hover])} r="5" className="dot" /></g>}
        </svg>
        {hover !== null && (
          <div className="tip" style={{ left: `${Math.min(88, Math.max(12, (x(hover) / W) * 100))}%` }}>
            <b>{labels[hover]}</b>
            <span><i className="sw cur" />This period <b>{format(cur[hover])}</b></span>
            {prev && <span><i className="sw prev" />Previous <b>{format(prev[hover])}</b></span>}
          </div>
        )}
      </div>
    </div>
  );
}
