import { useEffect, useState } from 'react';
import { api, dateLabel, money } from './api/client.js';
import { DataTable, Field, Notice, PageHead, Screen, WaitScreen, useApi, useEditPage, useScreen } from './ui.jsx';

/* UC34: catalogs of additional services and compensation items. Entries are deactivated, never deleted (BR-43). */
export function Catalog() {
  const tab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'services'; // in the URL so a refresh keeps the tab
  return <CatalogTab key={tab} tab={tab} />; // a new tab is a new mount: the list is loaded for it (the list used to stay on the first tab)
}
function CatalogTab({ tab }) {
  const setTab = (k) => { location.hash = `#/admin/catalog?tab=${k}`; };
  const list = useApi(`/catalog/${tab}`);
  const E = useEditPage(list.data);
  const [msg, setMsg] = useState(null);
  const toggle = async (e) => {
    try { await api(`/catalog/${tab}/${e._id}`, { method: 'PATCH', body: { isActive: !e.isActive } }); setMsg(`${e.name} ${e.isActive ? 'deactivated' : 'reactivated'}.`); list.reload(); } catch (x) { setMsg(null); alert(x.message); }
  };
  const label = tab === 'services' ? 'service' : 'compensation item';
  if (E.missing) return <WaitScreen loading={list.loading} onClose={E.close} />;
  if (E.open) return <CatalogEntry tab={tab} label={label} entry={E.open} onClose={E.close} onSaved={(m) => { setMsg(m); list.reload(); E.close(); }} />;
  return (
    <>
      <PageHead title="Services & compensation items" sub="What the front desk can add to a bill: extra services, and the price of damaged or missing items" action={`Add ${label}`} onAction={E.add} />
      <div className="seg" role="tablist" style={{ maxWidth: 420, marginBottom: '1rem' }}>
        {[['services', 'Services'], ['compensation-items', 'Compensation items']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMsg(null); }}>{l}</button>
        ))}
      </div>
      <Notice error={list.error} ok={msg} />
      {list.loading ? <p className="muted">Loading…</p> : !list.data?.length ? <p className="empty">No entries yet.</p> : (
        <DataTable cols={['Name', tab === 'services' ? 'Unit price' : 'Compensation price', 'Status', '']} rows={list.data.map((e) => [
          e.name, money(e.price), e.isActive ? 'active' : 'inactive',
          <span key="a" className="row-actions"><button className="btn sm" onClick={() => E.edit(e)}>Edit</button><button className={`btn sm${e.isActive ? ' danger' : ''}`} onClick={() => toggle(e)}>{e.isActive ? 'Deactivate' : 'Reactivate'}</button></span>,
        ])} />
      )}
      <p className="muted" style={{ marginTop: '.75rem' }}>An entry already used on a booking keeps its recorded amount; deactivating only hides it from new bills.</p>
    </>
  );
}

function CatalogEntry({ tab, label, entry, onClose, onSaved }) {
  const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setSaving(true); setError(null);
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const body = { name: f.name.trim(), price: Number(f.price) };
      await api(entry._id ? `/catalog/${tab}/${entry._id}` : `/catalog/${tab}`, { method: entry._id ? 'PATCH' : 'POST', body });
      onSaved(`${body.name} saved.`);
    } catch (x) { setError(x); setSaving(false); }
  };
  return (
    <Screen title={entry._id ? `Edit ${label}` : `Add ${label}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Name" error={error?.fields?.name}><input name="name" defaultValue={entry.name} maxLength="120" required autoFocus /></Field>
        <Field label="Price (VND)" error={error?.fields?.price}><input name="price" type="number" min={tab === 'services' ? 0 : 1} step="1" defaultValue={entry.price} required /></Field>
        <div className="full"><Notice error={error} /></div>
        <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Screen>
  );
}

/* UC33: the manager ticks the functions of the Receptionist and Housekeeping roles. Active sessions of those users end. */
export function StaffPermissions() {
  const list = useApi('/staff/roles');
  const [key, setKey] = useState('receptionist');
  const [picked, setPicked] = useState(null);
  const [msg, setMsg] = useState(null); const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const role = list.data?.find((r) => r.key === key);
  // UC33: any business function of 2.4.3 can be granted to either role; the role's default column is listed first.
  const catalog = [...(list.meta?.permissions || [])].sort((a, b) => b.defaultRoles.includes(key) - a.defaultRoles.includes(key));
  const current = picked ?? role?.permissions ?? [];
  const flip = (k) => setPicked(current.includes(k) ? current.filter((p) => p !== k) : [...current, k]);
  const save = async () => {
    setSaving(true); setError(null); setMsg(null);
    try { await api(`/staff/roles/${role._id}/permissions`, { method: 'PATCH', body: { permissions: current } }); setMsg(`${role.name} permissions saved. Users with this role must sign in again.`); setPicked(null); list.reload(); }
    catch (x) { setError(x); } finally { setSaving(false); }
  };
  return (
    <>
      <PageHead title="Role permissions" sub="Choose what Receptionists and Housekeeping staff can do. Changes apply from their next sign-in." />
      <div className="seg" role="tablist" style={{ maxWidth: 420, marginBottom: '1rem' }}>
        {[['receptionist', 'Receptionist'], ['housekeeping', 'Housekeeping']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={key === k} className={key === k ? 'on' : ''} onClick={() => { setKey(k); setPicked(null); setMsg(null); }}>{l}</button>
        ))}
      </div>
      <Notice error={list.error || error} ok={msg} />
      {list.loading ? <p className="muted">Loading…</p> : role && (
        <div className="panel">
          <ul className="perm-list">
            {catalog.map((p) => (
              <li key={p.key}><label className="check"><input type="checkbox" checked={current.includes(p.key)} onChange={() => flip(p.key)} /> {p.name}</label></li>
            ))}
          </ul>
          <div className="modal-actions"><button className="btn" disabled={!picked} onClick={() => setPicked(null)}>Reset</button><button className="btn primary" disabled={!picked || saving} onClick={save}>{saving ? 'Saving…' : 'Save permissions'}</button></div>
        </div>
      )}
    </>
  );
}

/* UC12 / BR-23: the manager hides a review that breaks the rules (with a reason) or shows it again. */
export function Reviews() {
  const types = useApi('/room-types?limit=100');
  const typeId = new URLSearchParams(location.hash.split('?')[1] || '').get('type') || '';
  const setTypeId = (v) => { location.hash = `#/admin/reviews?type=${v}`; };
  // With no room type chosen, open the first one that has reviews (the first in the list is often empty).
  const [auto, setAuto] = useState('');
  useEffect(() => {
    if (typeId || !types.data?.length) return undefined;
    let live = true;
    Promise.all(types.data.map((t) => api(`/room-types/${t._id}/reviews?limit=1`).then((r) => [t._id, r.meta?.summary?.count || 0]).catch(() => [t._id, 0])))
      .then((rows) => live && setAuto((rows.find(([, n]) => n > 0) || rows[0])[0]));
    return () => { live = false; };
  }, [typeId, types.data]);
  const id = typeId || auto || types.data?.[0]?._id;
  const list = useApi(id ? `/room-types/${id}/reviews?limit=50` : null, Boolean(id));
  const sc = useScreen(); const [msg, setMsg] = useState(null);
  const show = async (r) => { try { await api(`/reviews/${r._id}/visibility`, { method: 'PATCH', body: { hidden: false } }); setMsg('Review is visible again.'); list.reload(); } catch (x) { alert(x.message); } };
  const s = list.meta?.summary;
  if (sc.name === 'hide') {
    const r = (list.data || []).find((x) => x._id === sc.id);
    return r ? <HideReview review={r} onClose={sc.close} onDone={() => { setMsg('Review hidden.'); list.reload(); sc.close(); }} /> : <WaitScreen loading={list.loading} onClose={sc.close} />;
  }
  return (
    <>
      <PageHead title="Guest reviews" sub="Hide a review with offensive language, personal data or spam; guests then no longer see it" />
      <div className="form" style={{ maxWidth: 420, marginBottom: '1rem' }}>
        <Field label="Room type"><select value={id || ''} onChange={(e) => { setTypeId(e.target.value); setMsg(null); }}>{(types.data || []).map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select></Field>
      </div>
      {s && <p className="muted">{s.count} visible reviews{s.averageRating ? ` · average ${s.averageRating.toFixed(1)} / 5` : ''}</p>}
      <Notice error={types.error || list.error} ok={msg} />
      {list.loading ? <p className="muted">Loading…</p> : !list.data?.length ? <p className="empty">No reviews for this room type yet.</p> : (
        <DataTable cols={['Date', 'Rating', 'Review', 'Status', '']} rows={list.data.map((r) => [
          dateLabel(r.createdAt), '★'.repeat(r.rating), <span key="t"><b>{r.title}</b>{r.title && r.comment ? ' — ' : ''}{r.comment}{r.hiddenReason && <small className="muted"><br />Hidden: {r.hiddenReason}</small>}</span>,
          r.status === 'hidden' ? 'hidden' : 'visible',
          r.status === 'hidden' ? <button key="s" className="btn sm" onClick={() => show(r)}>Show</button> : <button key="h" className="btn sm" onClick={() => sc.go('hide', r._id)}>Hide</button>,
        ])} />
      )}
    </>
  );
}

function HideReview({ review, onClose, onDone }) {
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); const reason = new FormData(e.target).get('reason');
    try { await api(`/reviews/${review._id}/visibility`, { method: 'PATCH', body: { hidden: true, reason } }); onDone(); } catch (x) { setError(x); }
  };
  return (
    <Screen title="Hide review" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Reason"><select name="reason" required defaultValue=""><option value="" disabled>Choose a reason</option><option>Offensive language</option><option>Personal data</option><option>Spam or advertising</option><option>Not about this stay</option></select></Field>
        <div className="full"><Notice error={error} /></div>
        <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Hide review</button></div>
      </form>
    </Screen>
  );
}

/* UC32 step 5: the Admin reads the audit log (read-only), filtered by actor, action, target and date. */
// "key: value" instead of raw JSON; long ids are shortened.
const detailText = (d) => !d ? '' : Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : /^[0-9a-f]{24}$/.test(String(v)) ? `…${String(v).slice(-6)}` : v}`).join(' · ');
export function AuditLog() {
  const [q, setQ] = useState({});
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(q).filter(([, v]) => v)), page, limit: 50 });
  const list = useApi(`/audit-logs?${qs}`);
  const total = list.meta?.total || 0;
  const filter = (e) => { e.preventDefault(); setQ(Object.fromEntries(new FormData(e.currentTarget))); setPage(1); };
  const who = (a) => a.actorId ? (a.actorId.customerProfile?.fullName || a.actorId.email) : 'System (scheduled job)';
  return (
    <>
      <PageHead title="Audit log" sub="Sensitive operations recorded by the system. Read-only." />
      <form className="filters-row" onSubmit={filter}>
        <Field label="Actor (name or e-mail)"><input name="actor" /></Field>
        <Field label="Action"><input name="action" placeholder="e.g. refund" /></Field>
        <Field label="Target"><input name="targetType" placeholder="e.g. booking" /></Field>
        <Field label="From"><input name="from" type="date" /></Field>
        <Field label="To"><input name="to" type="date" /></Field>
        <button className="btn primary">Filter</button>
      </form>
      <Notice error={list.error} />
      {list.loading ? <p className="muted">Loading…</p> : !list.data?.length ? <p className="empty">No records match.</p> : (
        <DataTable cols={['Time', 'Actor', 'Action', 'Target', 'Detail']} rows={list.data.map((a) => [
          new Date(a.createdAt).toLocaleString('en-GB'), who(a), a.action, `${a.targetType}${a.targetId ? ` · …${String(a.targetId).slice(-6)}` : ''}`,
          <small key="d" className="muted" style={{ display: 'block', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={detailText(a.detail)}>{detailText(a.detail) || '—'}</small>,
        ])} />
      )}
      {total > 50 && <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: '.75rem' }}>
        <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="muted">Page {page} of {Math.ceil(total / 50)}</span>
        <button className="btn sm" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>Next</button>
      </div>}
    </>
  );
}
