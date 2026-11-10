import { useState } from 'react';
import { api, dateLabel, inputDate, money } from './api/client.js';
import { useAuth } from './context/Auth.jsx';
import { Badge, DataTable, Field, LineChart, Notice, PageHead, Screen, WaitScreen, useApi, useEditPage } from './ui.jsx';

const qs = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))).toString();
const day = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + offset * 864e5));
export function DepositPolicy() {
  const s = useApi('/policies/deposit');
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pct, setPct] = useState('');
  const current = s.meta?.current;
  const value = Number(pct);
  const valid = pct !== '' && Number.isInteger(value) && value >= 1 && value <= 100;
  const sample = 3000000;
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setOk(null);
    try {
      await api('/policies/deposit', { method: 'POST', body: { percentage: value } });
      setErr(null); setPct(''); setOk(`Saved. New online reservations now require a ${value}% deposit.`); s.reload();
    } catch (x) { setErr(x); } finally { setSaving(false); }
  };
  const fieldError = err?.fields?.percentage;
  return (
    <>
      <PageHead title="Deposit & cancellation policy" sub="Deposit, cancellation / refund tiers, stay rules and hotel information (UC27)" />
      <div className="policy-grid">
        <section className="panel policy-now" aria-labelledby="pol-now">
          <h2 id="pol-now">In force now</h2>
          {current ? (
            <>
              <p className="pct">{current.deposit.value}<span>%</span></p>
              <p className="muted">of the booking total · since {dateLabel(current.effectiveFrom)}</p>
            </>
          ) : <p className="muted">No deposit policy yet. Set one so online reservations can be confirmed.</p>}
        </section>
        <form className="panel policy-form" onSubmit={submit} noValidate>
          <h2>Set a new deposit</h2>
          <label htmlFor="pol-pct">Deposit percentage</label>
          <div className="pct-input">
            <input id="pol-pct" type="number" inputMode="numeric" min="1" max="100" step="1" value={pct} onChange={(e) => { setPct(e.target.value); setOk(null); }}
              aria-describedby={`pol-help${fieldError ? ' pol-err' : ''}`} aria-invalid={Boolean(fieldError) || (pct !== '' && !valid)} required />
            <span aria-hidden="true">%</span>
          </div>
          <p id="pol-help" className="muted">Whole number from 1 to 100. Applies to new online reservations only; existing bookings keep their deposit.</p>
          {fieldError && <p id="pol-err" className="err" role="alert">{fieldError}</p>}
          {pct !== '' && !valid && !fieldError && <p className="err" role="alert">Enter a whole number between 1 and 100.</p>}
          {valid && <p className="preview" aria-live="polite">On a {money(sample)} booking the deposit would be <strong>{money(Math.round(sample * value / 100))}</strong>.</p>}
          <button className="btn primary" type="submit" disabled={!valid || saving}>{saving ? 'Saving…' : 'Save policy'}</button>
          <Notice error={err && !err.fields ? err : null} ok={ok} />
        </form>
      </div>
      <h2 className="mt">History</h2>
      {s.loading || s.error ? <Loading s={s} /> : <DataTable cols={['Policy', 'Deposit', 'From', 'To', 'Status']} rows={s.data.map((p) => [p.name, `${p.deposit.value}%`, dateLabel(p.effectiveFrom), p.effectiveTo ? dateLabel(p.effectiveTo) : '—', p.isActive ? 'active' : <Badge v="retired" />])} />}
      <CancellationPolicy />
      <HotelInfo />
    </>
  );
}

const DEFAULT_TIERS = [{ minHoursBeforeCheckIn: 48, refundPercent: 100 }, { minHoursBeforeCheckIn: 0, refundPercent: 0 }];
// UC27: cancellation / refund tiers (100% or 0%, no gap from 0 h) with the stay rules; each save is a new version (BR-35).
function CancellationPolicy() {
  const s = useApi('/policies/cancellation?limit=5');
  const cur = s.meta?.current;
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);
  const tiers = rows || cur?.cancellationTiers || DEFAULT_TIERS;
  const edit = (i, k, val) => { setOk(null); setRows(tiers.map((t, j) => (j === i ? { ...t, [k]: val } : t))); };
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = {
      tiers: tiers.map((t) => ({ minHoursBeforeCheckIn: Number(t.minHoursBeforeCheckIn), refundPercent: Number(t.refundPercent) })),
      checkInTime: f.checkInTime, checkOutTime: f.checkOutTime, earlyCheckInFee: Number(f.earlyCheckInFee), lateCheckOutFee: Number(f.lateCheckOutFee),
    };
    try { await api('/policies/cancellation', { method: 'POST', body }); setErr(null); setRows(null); setOk('Saved. New bookings use these tiers; existing bookings keep theirs.'); s.reload(); } catch (x) { setErr(x); }
  };
  if (s.loading || s.error) return <Loading s={s} />;
  return (
    <form className="panel policy-form mt" onSubmit={submit} key={cur?._id || 'new'}>
      <h2>Cancellation &amp; stay rules</h2>
      <p className="muted">{cur ? `In force since ${dateLabel(cur.effectiveFrom)}.` : 'No cancellation policy yet: until one is saved, every cancellation is refunded in full.'} The time is counted from the request to the check-in time of the check-in date.</p>
      {tiers.map((t, i) => (
        <div className="tier-row" key={i}>
          <label>Hours before check-in (at least)<input type="number" min="0" max="8760" step="1" value={t.minHoursBeforeCheckIn} onChange={(e) => edit(i, 'minHoursBeforeCheckIn', e.target.value)} required /></label>
          <label>Refund<select value={t.refundPercent} onChange={(e) => edit(i, 'refundPercent', e.target.value)}><option value="100">Full deposit (100%)</option><option value="0">None (0%)</option></select></label>
          {tiers.length > 1 && <button type="button" className="btn sm" aria-label={`Remove tier ${i + 1}`} onClick={() => setRows(tiers.filter((_, j) => j !== i))}>Remove</button>}
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => setRows([...tiers, { minHoursBeforeCheckIn: 0, refundPercent: 0 }])}>+ Add tier</button>
      {err?.fields?.tiers && <p className="err" role="alert">{err.fields.tiers}</p>}
      <div className="tier-row">
        <Field label="Check-in time" error={err?.fields?.checkInTime}><input name="checkInTime" type="time" defaultValue={cur?.checkInTime || '14:00'} required /></Field>
        <Field label="Check-out time" error={err?.fields?.checkOutTime}><input name="checkOutTime" type="time" defaultValue={cur?.checkOutTime || '12:00'} required /></Field>
        <Field label="Early check-in fee (VND)" error={err?.fields?.earlyCheckInFee}><input name="earlyCheckInFee" type="number" min="0" step="1000" defaultValue={cur?.earlyCheckInFee ?? 0} required /></Field>
        <Field label="Late check-out fee (VND)" error={err?.fields?.lateCheckOutFee}><input name="lateCheckOutFee" type="number" min="0" step="1000" defaultValue={cur?.lateCheckOutFee ?? 0} required /></Field>
      </div>
      <button className="btn primary">Save cancellation policy</button>
      <Notice error={err && !err.fields ? err : null} ok={ok} />
    </form>
  );
}

// UC27: general hotel information shown on Hotel & Room Information.
function HotelInfo() {
  const s = useApi('/hotel-info');
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api('/hotel-info', { method: 'PUT', body: f }); setErr(null); setOk('Hotel information saved.'); s.reload(); } catch (x) { setErr(x); setOk(null); }
  };
  if (s.loading || s.error) return <Loading s={s} />;
  const h = s.data || {};
  const fe = (k) => err?.fields?.[k];
  return (
    <form className="panel form one mt" onSubmit={submit} key={h.updatedAt || 'new'}>
      <h2>Hotel information</h2>
      <Field label="Hotel name" error={fe('name')}><input name="name" defaultValue={h.name} required /></Field>
      <Field label="Address" error={fe('address')}><input name="address" defaultValue={h.address} /></Field>
      <Field label="Phone" error={fe('phone')}><input name="phone" inputMode="tel" defaultValue={h.phone} /></Field>
      <Field label="E-mail" error={fe('email')}><input name="email" type="email" defaultValue={h.email} /></Field>
      <Field label="Description" error={fe('description')}><textarea name="description" rows="3" defaultValue={h.description} /></Field>
      <button className="btn primary">Save hotel information</button>
      <Notice error={err && !err.fields ? err : null} ok={ok} />
    </form>
  );
}
const Loading =({ s }) => s.loading ? <p className="muted">Loading…</p> : s.error ? <Notice error={s.error} /> : null;

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
  const list = useApi(`${base}?${qs({ ...filters, ...(isAdmin ? { role: 'manager' } : {}), limit: 50 })}`); // BR-25: the Admin manages Hotel Manager accounts only
  const options = useApi('/options');
  const E = useEditPage(list.data);
  const [msg, setMsg] = useState('');
  const roleName = (k) => options.data?.roles.find((r) => r.key === k)?.name || k;
  const toggle = async (u) => {
    try { await api(`${base}/${u._id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'suspended' : 'active' } }); setMsg(''); list.reload(); }
    catch (e) { setMsg(e); }
  };
  if (E.missing) return <WaitScreen loading={list.loading} onClose={E.close} />;
  if (E.open) return <UserForm user={E.open} isStaff={!isAdmin} base={base} options={options.data} onClose={E.close} onSaved={() => { list.reload(); E.close(); }} />;
  return (
    <>
      <PageHead title={isAdmin ? 'Hotel manager accounts' : 'Staff'} sub={isAdmin ? 'Create, update and deactivate Hotel Manager accounts' : 'Receptionists and housekeeping at your hotel'} action={isAdmin ? 'Add hotel manager' : 'Add staff'} onAction={E.add} />
      <Filters onApply={setFilters} statuses={['active', 'suspended', 'deleted']} />
      <Notice error={msg || null} />
      <Loading s={list} />
      {list.data && (
        <DataTable cols={['Name', 'Username', 'Email', 'Role', 'Status', '']} rows={list.data.map((u) => [
          u.customerProfile?.fullName || '—', u.username, u.email, roleName(u.role), u.status,
          <span className="row-actions" key={u._id}>
            <button className="btn sm" onClick={() => E.edit(u)}>Edit</button>
            {u.role !== 'admin' && <button className={`btn sm${u.status === 'active' ? ' danger' : ''}`} onClick={() => toggle(u)}>{u.status === 'active' ? 'Suspend' : 'Activate'}</button>}
          </span>
        ])} />
      )}
      {list.data?.length === 0 && <p className="empty muted">No accounts match.</p>}
    </>
  );
}

function UserForm({ user, isStaff, base, options, onClose, onSaved }) {
  const creating = !user._id;
  const [role, setRole] = useState(user.role || (isStaff ? 'receptionist' : 'manager'));
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
    <Screen title={creating ? 'New account' : 'Edit account'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Full name" error={fe('fullName')}><input name="fullName" defaultValue={user.customerProfile?.fullName} required /></Field>
        <Field label="Email" error={fe('email')}><input name="email" type="email" defaultValue={user.email} required /></Field>
        {creating && <Field label="Username" error={fe('username')}><input name="username" required /></Field>}
        {creating && <Field label="Password" error={fe('password')}><input name="password" type="password" autoComplete="new-password" required /></Field>}
        <Field label="Phone" error={fe('phone')}><input name="phone" defaultValue={user.phone} required={scope === 'hotel'} /></Field>
        <Field label="Role" error={fe('role')}>
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={user.role === 'admin'}>
            {options?.roles.filter((r) => isStaff || r.key === 'manager' || r.key === user.role).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
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
    </Screen>
  );
}

/* ---------------- Promotions (UC33) ---------------- */
export function Coupons() {
  const [filters, setFilters] = useState({});
  const list = useApi(`/promotions?${qs({ ...filters, limit: 50 })}`);
  const E = useEditPage(list.data);
  const [msg, setMsg] = useState('');
  const act = async (fn) => { try { await fn(); setMsg(''); list.reload(); } catch (e) { setMsg(e); } };
  if (E.missing) return <WaitScreen loading={list.loading} onClose={E.close} />;
  if (E.open) return <CouponForm coupon={E.open} onClose={E.close} onSaved={() => { list.reload(); E.close(); }} />;
  return (
    <>
      <PageHead title="Coupons" sub="Promotions and discount codes for your hotel" action="Create coupon" onAction={E.add} />
      <Filters onApply={setFilters} statuses={['active', 'inactive']} />
      <Notice error={msg || null} />
      <Loading s={list} />
      {list.data && (
        <DataTable cols={['Code', 'Discount', 'Min. spend', 'Used', 'Valid', 'Status', '']} rows={list.data.map((c) => [
          c.code, c.discountType === 'percentage' ? `${c.discountValue}%` : money(c.discountValue), c.minimumSpend ? money(c.minimumSpend) : '—',
          `${c.usageCount} / ${c.usageLimit}`, `${dateLabel(c.startDate)} – ${dateLabel(c.endDate)}`, c.isActive ? 'active' : 'inactive',
          <span className="row-actions" key={c._id}>
            <button className="btn sm" onClick={() => E.edit(c)}>Edit</button>
            <button className={`btn sm${c.isActive ? ' danger' : ''}`} onClick={() => act(() => api(`/promotions/${c._id}`, { method: 'PATCH', body: { isActive: !c.isActive } }))}>{c.isActive ? 'Disable' : 'Enable'}</button>
            <button className="btn sm danger" onClick={() => confirm(`Delete ${c.code}?`) && act(() => api(`/promotions/${c._id}`, { method: 'DELETE' }))}>Delete</button>
          </span>
        ])} />
      )}
      {list.data?.length === 0 && <p className="empty muted">No coupons yet.</p>}
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
    <Screen title={creating ? 'New coupon' : `Edit ${coupon.code}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Code" error={fe('code')}><input name="code" defaultValue={coupon.code} required /></Field>
        <Field label="Type" error={fe('discountType')}><select name="discountType" defaultValue={coupon.discountType || 'percentage'}><option value="percentage">Percentage (1 to 100)</option><option value="fixed">Fixed amount (VND)</option></select></Field>
        <Field label="Discount value" error={fe('discountValue')}><input name="discountValue" type="number" min="1" step="1" defaultValue={coupon.discountValue} required /></Field>
        <Field label="Usage limit" error={fe('usageLimit')}><input name="usageLimit" type="number" min="1" defaultValue={coupon.usageLimit} required /></Field>
        <Field label="Minimum spend (VND)" error={fe('minimumSpend')}><input name="minimumSpend" type="number" min="0" defaultValue={coupon.minimumSpend || 0} /></Field>
        <span />
        <Field label="Start date" error={fe('startDate')}><input name="startDate" type="date" defaultValue={inputDate(coupon.startDate)} required /></Field>
        <Field label="End date (exclusive)" error={fe('endDate')}><input name="endDate" type="date" defaultValue={inputDate(coupon.endDate)} required /></Field>
        <label className="check full"><input type="checkbox" name="isActive" defaultChecked={coupon.isActive ?? true} />Active</label>
        <div className="full"><Notice error={err && !err.fields ? err : null} /></div>
        <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit">Save</button></div>
      </form>
    </Screen>
  );
}

/* ---------------- Revenue (UC36) ---------------- */
// CR-05: 2026-11-07 -> 07/11/2026, 2026-11 -> 11/2026
const period = (s) => (/^\d{4}-\d{2}(-\d{2})?$/.test(String(s)) ? String(s).split('-').reverse().join('/') : s);
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
          <DataTable cols={['Period', 'Received', 'Refunded', 'Net', 'Payments', 'Refunds']} rows={d.series.map((r) => [period(r.date), money(r.received), money(r.refunded), money(r.net), r.paymentCount, r.refundCount])} />
        </>
      )}
    </>
  );
}

/* ---------------- Occupancy Report (UC37 - Member 2) ---------------- */
export function Occupancy() {
  const [p, setP] = useState({ from: day(-29), to: day(0) });
  const rep = useApi(`/reports/occupancy?${qs(p)}`);
  const d = rep.data;
  const labels = d?.series.map((r) => r.date) || [];
  const pctFmt = (n) => `${Number(n || 0).toFixed(1)}%`;

  return (
    <>
      <PageHead
        title="Occupancy Report"
        sub="Room-night utilization and capacity, excluding maintenance/blocked rooms"
        extra={<a className="btn" href={`/api/reports/occupancy?${qs({ ...p, format: 'csv' })}`}>Export CSV</a>}
      />
      <form className="filters-row" onSubmit={(e) => { e.preventDefault(); setP(Object.fromEntries(new FormData(e.target))); }}>
        <label>From<input name="from" type="date" defaultValue={p.from} required /></label>
        <label>To<input name="to" type="date" defaultValue={p.to} required /></label>
        <button className="btn" type="submit">Apply</button>
      </form>
      <Loading s={rep} />
      {d && (
        <>
          {/* BR-27: occupied room-nights / available room-nights; inactive rooms and rooms in Maintenance are not available */}
          <div className="kpis">
            <div className="kpi"><p>Occupancy rate</p><strong>{pctFmt(d.totals.rate)}</strong><small className="muted">{d.from} → {d.to}</small></div>
            <div className="kpi"><p>Occupied room-nights</p><strong>{d.totals.occupiedRoomNights}</strong><small className="muted">Checked-in and checked-out stays</small></div>
            <div className="kpi"><p>Available room-nights</p><strong>{d.totals.availableRoomNights}</strong><small className="muted">Active rooms not in Maintenance</small></div>
          </div>

          <section className="panel">
            <div className="phead"><h2>Daily occupancy rate</h2></div>
            {d.series.length > 1 ? (
              <LineChart labels={labels} cur={d.series.map((r) => r.rate)} format={pctFmt} summary={`Daily occupancy from ${d.from} to ${d.to}, average ${pctFmt(d.totals.rate)}`} />
            ) : (
              <p className="muted">Choose a longer range to see an occupancy trend.</p>
            )}
          </section>

          <h2 className="mt">Daily details</h2>
          <DataTable cols={['Date', 'Available room-nights', 'Occupied room-nights', 'Occupancy rate']} rows={d.series.map((r) => [period(r.date), String(r.availableRoomNights), String(r.occupiedRoomNights), pctFmt(r.rate)])} />
        </>
      )}
    </>
  );
}

/* ---------------- Profile (UC03) and Change Password: two pages, shared by both shells ---------------- */
const ProfileTabs = ({ base, on }) => (
  <div className="subnav" role="navigation" aria-label="Account">
    <a href={base} className={on === 'profile' ? 'on' : ''} aria-current={on === 'profile' ? 'page' : undefined}>Personal details</a>
    <a href={`${base}/password`} className={on === 'password' ? 'on' : ''} aria-current={on === 'password' ? 'page' : undefined}>Change password</a>
  </div>
);
export function Profile({ base = '#/profile' }) {
  const { user, setUser } = useAuth();
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState('');
  const cp = user.customerProfile || {};
  const save = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { const r = await api('/profile', { method: 'PATCH', body: { fullName: f.fullName, phone: f.phone, address: f.address, dateOfBirth: f.dateOfBirth, ...(f.email ? { email: f.email } : {}) } }); setUser(r.data); setErr(null); setOk(r.message || 'Profile saved.'); }
    catch (x) { setErr(x); setOk(''); }
  };
  return (
    <>
      <PageHead title="My profile" sub={`${user.roleName} · ${user.email}`} />
      <ProfileTabs base={base} on="profile" />
      <form className="panel form acct" onSubmit={save}>
        <Field label="Full name" error={err?.fields?.fullName}><input name="fullName" defaultValue={cp.fullName} required minLength={2} maxLength={50} /></Field>
        {/* UC03 4b: only a Customer changes the e-mail, through a link sent to the new address (BR-24) */}
        {user.role === 'customer' && <Field label={user.pendingEmail ? `E-mail (waiting for verification: ${user.pendingEmail})` : 'E-mail'} error={err?.fields?.email}><input name="email" type="email" defaultValue={user.email} required /></Field>}
        <Field label="Phone" error={err?.fields?.phone}><input name="phone" defaultValue={user.phone} pattern="([0-9]{10,11}|\+[0-9]{8,15})" title="10-11 digits, or + and 8-15 digits with the country code." /></Field>
        <Field label="Address" error={err?.fields?.address}><input name="address" defaultValue={cp.address} /></Field>
        <Field label="Date of birth" error={err?.fields?.dateOfBirth}><input name="dateOfBirth" type="date" defaultValue={inputDate(cp.dateOfBirth)} /></Field>
        <Notice error={err && !err.fields ? err : null} ok={ok} />
        <div className="modal-actions"><button className="btn primary" type="submit">Save changes</button></div>
      </form>
    </>
  );
}
export function ChangePassword({ base = '#/profile' }) {
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.newPassword !== f.confirmPassword) { setErr({ message: 'Passwords do not match.', fields: { confirmPassword: 'Passwords do not match.' } }); return; }
    setBusy(true);
    try { const r = await api('/profile/password', { method: 'PUT', body: { currentPassword: f.currentPassword, newPassword: f.newPassword } }); e.target.reset(); setErr(null); setOk(r.data.message); }
    catch (x) { setErr(x); setOk(''); }
    finally { setBusy(false); }
  };
  return (
    <>
      <PageHead title="Change password" sub="Use 8 or more characters with an upper-case letter, a lower-case letter and a number." />
      <ProfileTabs base={base} on="password" />
      <form className="panel form one" onSubmit={submit} style={{ maxWidth: 480 }}>
        <Field label="Current password" error={err?.fields?.currentPassword}><input name="currentPassword" type="password" autoComplete="current-password" required /></Field>
        <Field label="New password" error={err?.fields?.newPassword}><input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></Field>
        <Field label="Confirm new password" error={err?.fields?.confirmPassword}><input name="confirmPassword" type="password" autoComplete="new-password" required /></Field>
        <Notice error={err && !err.fields ? err : null} ok={ok} />
        <div className="modal-actions"><button className="btn primary" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></div>
      </form>
    </>
  );
}

