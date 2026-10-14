import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api/client.js';

export const Badge = ({ v }) => <span className={`badge b-${v}`}>{String(v).replace('_', ' ')}</span>;

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

// Native <dialog>: focus trap, Esc and inert background come for free.
export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="modal-card">
        <div className="phead"><h2>{title}</h2><button className="ibtn" aria-label="Close" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </dialog>
  );
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
  const words = /^(confirmed|checked_in|checked_out|cancelled|pending|active|inactive|paid|done|in_progress|open|resolved|high|medium|low|published|suspended|deleted)$/;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{typeof c === 'string' && words.test(c) ? <Badge v={c} /> : c}</td>)}</tr>
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
  const short = (v) => (v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}k` : v);
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
