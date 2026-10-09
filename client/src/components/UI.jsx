import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { api } from "../api/client";
export function useResource(path) {
  const [state, setState] = useState({
    data: null,
    meta: null,
    loading: true,
    error: null,
  });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path, { signal: controller.signal })
      .then((r) => setState({ ...r, loading: false, error: null }))
      .catch((error) => {
        if (error.name !== "AbortError")
          setState((s) => ({ ...s, loading: false, error }));
      });
    return () => controller.abort();
  }, [path, version]);
  return { ...state, reload: () => setVersion((v) => v + 1) };
}
export function ErrorBanner({ error, retry }) {
  return error ? (
    <div className="notice error" role="alert">
      <AlertCircle size={18} />
      <span>{error.message || error}</span>
      {retry && (
        <button className="text-button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  ) : null;
}
export function Success({ message }) {
  return message ? (
    <div className="notice success" role="status">
      <Check size={18} />
      {message}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      Loading your workspace…
    </div>
  );
}
export function Empty({ title = "Nothing here yet", text, action }) {
  return (
    <div className="empty">
      <span className="empty-rule" />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function PageHeader({ eyebrow, title, description, action }) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="subheading">{description}</p>
      </div>
      {action && <div className="heading-action">{action}</div>}
    </header>
  );
}
export function Field({ label, hint, error, children, ...props }) {
  const id = useId();
  return (
    <div className={`field ${props.className || ""}`}>
      <label htmlFor={id}>{label}</label>
      {children ? (
        <select
          {...props}
          id={id}
          aria-invalid={!!error}
          aria-describedby={hint || error ? `${id}-hint` : undefined}
        >
          {children}
        </select>
      ) : (
        <input
          {...props}
          id={id}
          aria-invalid={!!error}
          aria-describedby={hint || error ? `${id}-hint` : undefined}
        />
      )}
      {(error || hint) && (
        <small id={`${id}-hint`} className={error ? "field-error" : ""}>
          {error || hint}
        </small>
      )}
    </div>
  );
}
export function Submit({ busy, children }) {
  return (
    <button type="submit" className="button primary" disabled={busy}>
      {busy && <LoaderCircle className="spin" size={16} />}
      {busy ? "Saving…" : children}
    </button>
  );
}
export function Badge({ value }) {
  return (
    <span
      className={`badge ${["active", "success"].includes(value) ? "positive" : ["suspended", "inactive", "expired", "deleted"].includes(value) ? "muted" : ""}`}
    >
      {value?.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}
    </span>
  );
}
export function Modal({ title, open, onClose, children }) {
  const ref = useRef();
  const id = useId();
  useEffect(() => {
    if (open && !ref.current.open) ref.current.showModal();
    else if (!open && ref.current.open) ref.current.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={id}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="modal-heading">
        <div>
          <p className="eyebrow">WORKSPACE / EDITOR</p>
          <h2 id={id}>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {open && children}
    </dialog>
  );
}
export function SearchToolbar({
  value,
  onChange,
  children,
  placeholder = "Search by name or email",
}) {
  return (
    <div className="toolbar">
      <div className="search-field">
        <Search size={18} />
        <input
          aria-label="Search"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {children}
    </div>
  );
}
export function Pagination({ meta, setPage }) {
  if (!meta) return null;
  return (
    <div className="pagination">
      <span>
        {meta.total === 0
          ? "0 results"
          : `${(meta.page - 1) * meta.limit + 1}–${Math.min(meta.page * meta.limit, meta.total)} of ${meta.total} results`}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="Previous page"
          disabled={meta.page <= 1}
          onClick={() => setPage(meta.page - 1)}
        >
          <ArrowLeft size={17} />
        </button>
        <span>
          Page {meta.page} of {meta.pages}
        </span>
        <button
          className="icon-button"
          aria-label="Next page"
          disabled={meta.page >= meta.pages}
          onClick={() => setPage(meta.page + 1)}
        >
          <ArrowRight size={17} />
        </button>
      </div>
    </div>
  );
}
