import { useState } from 'react';
import { api, dateLabel, inputDate, money } from './api/client.js';
import { useAuth } from './context/Auth.jsx';
import { DataTable, Field, LineChart, Modal, Notice, PageHead, useApi } from './ui.jsx';

const qs = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))).toString();
const day = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + offset * 864e5));
export function DepositPolicy() {
  const s = useApi('/policies/deposit');
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api('/policies/deposit', { method: 'POST', body: { percentage: +f.percentage } });
      setErr(null); setOk('Saved. The new deposit applies to new online reservations only.'); s.reload();
    } catch (x) { setErr(x); setOk(null); }
  };
  const current = s.meta?.current;
  return (
    <>
      <PageHead title="Deposit policy" sub="Share of the booking total paid online to confirm a reservation" />
      <form className="panel form" onSubmit={submit}>
        <Field label="Deposit (%)" error={err?.fields?.percentage}><input key={current?._id} name="percentage" type="number" min="1" max="100" step="1" defaultValue={current?.deposit.value} required /></Field>
        <button className="btn primary" type="submit">Save policy</button>
        <div className="full"><Notice error={err && !err.fields ? err : null} ok={ok} /></div>
      </form>
      {s.loading || s.error ? <Loading s={s} /> : <DataTable cols={['Policy', 'Deposit', 'From', 'To', 'Status']} rows={s.data.map((p) => [p.name, `${p.deposit.value}%`, dateLabel(p.effectiveFrom), p.effectiveTo ? dateLabel(p.effectiveTo) : '—', p.isActive ? 'active' : 'inactive'])} />}
    </>
  );
}
const Loading = ({ s }) => s.loading ? <p className="muted">Loading…</p> : s.error ? <Notice error={s.error} /> : null;

function Filters({ onApply, statuses, extra }) {
  return (
    <form className="filters-row" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.target); onApply(Object.fromEntries(f)); }}>
      <label className="grow">Search<input name="q" type="search" placeholder="Search…" /></label>
      <label>Status<select name="status"><option value="">All</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select></label>
      {extra}
      <button className="btn" type="submit">Apply</button>
    </form>
  );
}

/* ---------------- Users / staff (UC09, UC38) ---------------- */
export function Users() {
  const { user } = useAuth();
  const isAdmin = user.permissions.includes('users.manage');
  const base = isAdmin ? '/users' : '/staff';
  const [filters, setFilters] = useState({});
  const list = useApi(`${base}?${qs({ ...filters, limit: 50 })}`);
  const options = useApi('/options');
  const [edit, setEdit] = useState(null); // {} = new, user object = edit
  const [msg, setMsg] = useState('');
  const roleName = (k) => options.data?.roles.find((r) => r.key === k)?.name || k;
  const toggle = async (u) => {
    try { await api(`${base}/${u._id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'suspended' : 'active' } }); setMsg(''); list.reload(); }
    catch (e) { setMsg(e); }
  };
  return (
    <>
      <PageHead title={isAdmin ? 'Users' : 'Staff'} sub={isAdmin ? 'All accounts: guests and staff' : 'Receptionists and housekeeping at your hotel'} action={isAdmin ? 'Add user' : 'Add staff'} onAction={() => setEdit({})} />
      <Filters onApply={setFilters} statuses={['active', 'suspended', 'deleted']} />
      <Notice error={msg || null} />
      <Loading s={list} />
      {list.data && (
        <DataTable cols={['Name', 'Username', 'Email', 'Role', 'Status', '']} rows={list.data.map((u) => [
          u.customerProfile?.fullName || '—', u.username, u.email, roleName(u.role), u.status,
          <span className="row-actions" key={u._id}>
            <button className="btn sm" onClick={() => setEdit(u)}>Edit</button>
            {u.role !== 'admin' && <button className="btn sm" onClick={() => toggle(u)}>{u.status === 'active' ? 'Suspend' : 'Activate'}</button>}
          </span>
        ])} />
      )}
      {list.data?.length === 0 && <p className="muted">No accounts match.</p>}
      {edit && <UserForm user={edit} isStaff={!isAdmin} base={base} options={options.data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </>
  );
}

function UserForm({ user, isStaff, base, options, onClose, onSaved }) {
  const creating = !user._id;
  const [role, setRole] = useState(user.role || (isStaff ? 'receptionist' : 'customer'));
  const [err, setErr] = useState(null);
  const scope = options?.roles.find((r) => r.key === role)?.scope;
  const fe = (k) => err?.fields?.[k];
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = { fullName: f.fullName, email: f.email, phone: f.phone, role, status: f.status };
    if (creating) { body.username = f.username; body.password = f.password; delete body.status; }
    if (scope === 'hotel') { Object.assign(body, { position: f.position, shift: f.shift, hireDate: f.hireDate || null }); }
    try { await api(creating ? base : `${base}/${user._id}`, { method: creating ? 'POST' : 'PATCH', body }); onSaved(); } catch (x) { setErr(x); }
  };
  const ep = user.employeeProfile || {};
  return (
    <Modal title={creating ? 'New account' : 'Edit account'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Full name" error={fe('fullName')}><input name="fullName" defaultValue={user.customerProfile?.fullName} required /></Field>
        <Field label="Email" error={fe('email')}><input name="email" type="email" defaultValue={user.email} required /></Field>
        {creating && <Field label="Username" error={fe('username')}><input name="username" required /></Field>}
        {creating && <Field label="Password" error={fe('password')}><input name="password" type="password" autoComplete="new-password" required /></Field>}
        <Field label="Phone" error={fe('phone')}><input name="phone" defaultValue={user.phone} required={scope === 'hotel'} /></Field>
        <Field label="Role" error={fe('role')}>
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={user.role === 'admin'}>
            {options?.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </Field>
        {!creating && user.role !== 'admin' && <Field label="Status"><select name="status" defaultValue={user.status}><option>active</option><option>suspended</option><option>deleted</option></select></Field>}
        {scope === 'hotel' && <>
          <Field label="Position"><input name="position" defaultValue={ep.position} /></Field>
          <Field label="Shift"><input name="shift" defaultValue={ep.shift} /></Field>
          <Field label="Hire date" error={fe('hireDate')}><input name="hireDate" type="date" defaultValue={inputDate(ep.hireDate)} /></Field>
        </>}
        <div className="full"><Notice error={err && !err.fields ? err : null} /></div>
        <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit">Save</button></div>
      </form>
    </Modal>
  );
}

/* ---------------- Roles & permissions (UC10) ---------------- */
export function Roles() {
  const list = useApi('/roles');
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState('');
  const remove = async (r) => {
    if (!confirm(`Delete role “${r.name}”?`)) return;
    try { await api(`/roles/${r._id}`, { method: 'DELETE' }); setMsg(''); list.reload(); } catch (e) { setMsg(e); }
  };
  return (
    <>
      <PageHead title="Roles" sub="Access levels and what each role may do" action="Add role" onAction={() => setEdit({})} />
      <Notice error={msg || null} />
      <Loading s={list} />
      {list.data && (
        <DataTable cols={['Role', 'Key', 'Scope', 'Permissions', 'Status', '']} rows={list.data.map((r) => [
          r.name + (r.isSystem ? ' (system)' : ''), r.key, r.scope, r.permissions.length ? r.permissions.join(', ') : '—', r.isActive ? 'active' : 'inactive',
          <span className="row-actions" key={r._id}>
            <button className="btn sm" onClick={() => setEdit(r)}>Edit</button>
            {!r.isSystem && <button className="btn sm" onClick={() => remove(r)}>Delete</button>}
          </span>
        ])} />
      )}
      {edit && <RoleForm role={edit} catalog={list.meta?.permissions || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </>
  );
}

function RoleForm({ role, catalog, onClose, onSaved }) {
  const creating = !role._id;
  const [scope, setScope] = useState(role.scope || 'hotel');
  const [perms, setPerms] = useState(role.permissions || []);
  const [err, setErr] = useState(null);
  const avail = catalog.filter((c) => c.scope === scope);
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = { name: f.name, permissions: perms.filter((p) => avail.some((a) => a.key === p)) };
    if (creating) Object.assign(body, { key: f.key, scope }); else body.isActive = f.isActive === 'on';
    try { await api(creating ? '/roles' : `/roles/${role._id}`, { method: creating ? 'POST' : 'PATCH', body }); onSaved(); } catch (x) { setErr(x); }
  };
  const fe = (k) => err?.fields?.[k];
  return (
    <Modal title={creating ? 'New role' : `Edit ${role.name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Name" error={fe('name')}><input name="name" defaultValue={role.name} required /></Field>
        {creating && <Field label="Key (lowercase, underscores)" error={fe('key')}><input name="key" required /></Field>}
        {creating && <Field label="Scope"><select value={scope} onChange={(e) => { setScope(e.target.value); setPerms([]); }}><option value="hotel">Hotel staff</option><option value="self">Customer (own data)</option></select></Field>}
        <fieldset className="full">
          <legend>Permissions</legend>
          {avail.length === 0 && <p className="muted">This scope has no assignable permissions.</p>}
          {avail.map((p) => (
            <label className="check" key={p.key}>
              <input type="checkbox" checked={perms.includes(p.key)} onChange={() => setPerms(perms.includes(p.key) ? perms.filter((x) => x !== p.key) : [...perms, p.key])} />{p.name}
            </label>
          ))}
          <Notice error={fe('permissions')} />
        </fieldset>
        {!creating && <label className="check full"><input type="checkbox" name="isActive" defaultChecked={role.isActive} />Role is active</label>}
        <div className="full"><Notice error={err && !err.fields ? err : null} /></div>
        <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit">Save</button></div>
      </form>
    </Modal>
  );
}

/* ---------------- Promotions (UC33) ---------------- */
export function Coupons() {
  const [filters, setFilters] = useState({});
  const list = useApi(`/promotions?${qs({ ...filters, limit: 50 })}`);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState('');
  const act = async (fn) => { try { await fn(); setMsg(''); list.reload(); } catch (e) { setMsg(e); } };
  return (
    <>
      <PageHead title="Coupons" sub="Promotions and discount codes for your hotel" action="Create coupon" onAction={() => setEdit({})} />
      <Filters onApply={setFilters} statuses={['active', 'inactive']} />
      <Notice error={msg || null} />
      <Loading s={list} />
      {list.data && (
        <DataTable cols={['Code', 'Discount', 'Min. spend', 'Used', 'Valid', 'Status', '']} rows={list.data.map((c) => [
          c.code, c.discountType === 'percentage' ? `${c.discountValue}%` : money(c.discountValue), c.minimumSpend ? money(c.minimumSpend) : '—',
          `${c.usageCount} / ${c.usageLimit}`, `${dateLabel(c.startDate)} – ${dateLabel(c.endDate)}`, c.isActive ? 'active' : 'inactive',
          <span className="row-actions" key={c._id}>
            <button className="btn sm" onClick={() => setEdit(c)}>Edit</button>
            <button className="btn sm" onClick={() => act(() => api(`/promotions/${c._id}`, { method: 'PATCH', body: { isActive: !c.isActive } }))}>{c.isActive ? 'Disable' : 'Enable'}</button>
            <button className="btn sm" onClick={() => confirm(`Delete ${c.code}?`) && act(() => api(`/promotions/${c._id}`, { method: 'DELETE' }))}>Delete</button>
          </span>
        ])} />
      )}
      {list.data?.length === 0 && <p className="muted">No coupons yet.</p>}
      {edit && <CouponForm coupon={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </>
  );
}

function CouponForm({ coupon, onClose, onSaved }) {
  const creating = !coupon._id;
  const [err, setErr] = useState(null);
  const fe = (k) => err?.fields?.[k];
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = { code: f.code, discountType: f.discountType, discountValue: +f.discountValue, usageLimit: +f.usageLimit, minimumSpend: +f.minimumSpend || 0, startDate: f.startDate, endDate: f.endDate, isActive: f.isActive === 'on' };
    try { await api(creating ? '/promotions' : `/promotions/${coupon._id}`, { method: creating ? 'POST' : 'PATCH', body }); onSaved(); } catch (x) { setErr(x); }
  };
  return (
    <Modal title={creating ? 'New coupon' : `Edit ${coupon.code}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Code" error={fe('code')}><input name="code" defaultValue={coupon.code} required /></Field>
        <Field label="Type" error={fe('discountType')}><select name="discountType" defaultValue={coupon.discountType || 'percentage'}><option value="percentage">Percentage</option></select></Field>
        <Field label="Discount value" error={fe('discountValue')}><input name="discountValue" type="number" min="0.01" max="100" step="any" defaultValue={coupon.discountValue} required /></Field>
        <Field label="Usage limit" error={fe('usageLimit')}><input name="usageLimit" type="number" min="1" defaultValue={coupon.usageLimit} required /></Field>
        <Field label="Minimum spend (VND)" error={fe('minimumSpend')}><input name="minimumSpend" type="number" min="0" defaultValue={coupon.minimumSpend || 0} /></Field>
        <span />
        <Field label="Start date" error={fe('startDate')}><input name="startDate" type="date" defaultValue={inputDate(coupon.startDate)} required /></Field>
        <Field label="End date (exclusive)" error={fe('endDate')}><input name="endDate" type="date" defaultValue={inputDate(coupon.endDate)} required /></Field>
        <label className="check full"><input type="checkbox" name="isActive" defaultChecked={coupon.isActive ?? true} />Active</label>
        <div className="full"><Notice error={err && !err.fields ? err : null} /></div>
        <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit">Save</button></div>
      </form>
    </Modal>
  );
}

/* ---------------- Revenue (UC36) ---------------- */
export function Revenue() {
  const [p, setP] = useState({ from: day(-29), to: day(0), groupBy: 'day' });
  const rep = useApi(`/reports/revenue?${qs(p)}`);
  const d = rep.data;
  const labels = d?.series.map((r) => r.date) || [];
  return (
    <>
      <PageHead title="Revenue" sub="Receipts minus refunds, Vietnam time (UTC+7)" extra={<a className="btn" href={`/api/reports/revenue?${qs({ ...p, format: 'csv' })}`}>Export CSV</a>} />
      <form className="filters-row" onSubmit={(e) => { e.preventDefault(); setP(Object.fromEntries(new FormData(e.target))); }}>
        <label>From<input name="from" type="date" defaultValue={p.from} required /></label>
        <label>To<input name="to" type="date" defaultValue={p.to} required /></label>
        <label>Group by<select name="groupBy" defaultValue={p.groupBy}><option value="day">Day</option><option value="month">Month</option></select></label>
        <button className="btn" type="submit">Apply</button>
      </form>
      <Loading s={rep} />
      {d && (
        <>
          <div className="kpis">
            <div className="kpi"><p>Received</p><strong>{money(d.totals.received)}</strong><small>{d.totals.paymentCount} payments</small></div>
            <div className="kpi"><p>Refunded</p><strong>{money(d.totals.refunded)}</strong><small>{d.totals.refundCount} refunds</small></div>
            <div className="kpi"><p>Net revenue</p><strong>{money(d.totals.net)}</strong><small>{d.from} → {d.to}</small></div>
          </div>
          <section className="panel">
            <div className="phead"><h2>Net revenue</h2></div>
            {d.series.length > 1
              ? <LineChart labels={labels} cur={d.series.map((r) => r.net)} format={money} summary={`Net revenue from ${d.from} to ${d.to}, total ${money(d.totals.net)}`} />
              : <p className="muted">Choose a longer range to see a trend.</p>}
          </section>
          <h2 className="mt">Details</h2>
          <DataTable cols={['Period', 'Received', 'Refunded', 'Net', 'Payments', 'Refunds']} rows={d.series.map((r) => [r.date, money(r.received), money(r.refunded), money(r.net), r.paymentCount, r.refundCount])} />
        </>
      )}
    </>
  );
}

/* ---------------- Profile & password (UC03), shared by both shells ---------------- */
export function Profile() {
  const { user, setUser } = useAuth();
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState('');
  const [pErr, setPErr] = useState(null);
  const [pOk, setPOk] = useState('');
  const cp = user.customerProfile || {};
  const save = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { const r = await api('/profile', { method: 'PATCH', body: { fullName: f.fullName, phone: f.phone, address: f.address, dateOfBirth: f.dateOfBirth } }); setUser(r.data); setErr(null); setOk('Profile saved.'); }
    catch (x) { setErr(x); setOk(''); }
  };
  const pw = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { const r = await api('/profile/password', { method: 'PUT', body: { currentPassword: f.currentPassword, newPassword: f.newPassword } }); e.target.reset(); setPErr(null); setPOk(r.data.message); }
    catch (x) { setPErr(x); setPOk(''); }
  };
  return (
    <>
      <PageHead title="My profile" sub={`${user.roleName} · ${user.email}`} />
      <div className="two">
        <form className="panel form one" onSubmit={save}>
          <h2>Personal details</h2>
          <Field label="Full name" error={err?.fields?.fullName}><input name="fullName" defaultValue={cp.fullName} required /></Field>
          <Field label="Phone" error={err?.fields?.phone}><input name="phone" defaultValue={user.phone} /></Field>
          <Field label="Address" error={err?.fields?.address}><input name="address" defaultValue={cp.address} /></Field>
          <Field label="Date of birth" error={err?.fields?.dateOfBirth}><input name="dateOfBirth" type="date" defaultValue={inputDate(cp.dateOfBirth)} /></Field>
          <Notice error={err && !err.fields ? err : null} ok={ok} />
          <button className="btn primary" type="submit">Save changes</button>
        </form>
        <form className="panel form one" onSubmit={pw}>
          <h2>Change password</h2>
          <Field label="Current password" error={pErr?.fields?.currentPassword}><input name="currentPassword" type="password" autoComplete="current-password" required /></Field>
          <Field label="New password (10+ characters, a letter and a number)" error={pErr?.fields?.newPassword}><input name="newPassword" type="password" autoComplete="new-password" required /></Field>
          <Notice error={pErr && !pErr.fields ? pErr : null} ok={pOk} />
          <button className="btn primary" type="submit">Update password</button>
        </form>
      </div>
    </>
  );
}

