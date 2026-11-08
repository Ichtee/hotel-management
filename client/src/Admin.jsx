import { useEffect, useRef, useState } from 'react';
import { MENU } from './data.js';
import AdminRoomMap from './pages/AdminRoomMap.jsx';
import AdminRoomTypes from './pages/AdminRoomTypes.jsx';
import HousekeepingTasks from './HousekeepingTasks.jsx';
import HousekeepingAssignments from './HousekeepingAssignments.jsx';
import RoomIssues from './RoomIssues.jsx';
import AdHocCleaningRequest from './AdHocCleaningRequest.jsx';
import StayRequests from './StayRequests.jsx';
import Invoices from './Invoices.jsx';
import RoomAvailability from './RoomAvailability.jsx';
import NotificationBell from './Notifications.jsx';
import { AuditLog, Catalog, Reviews, StaffPermissions } from './ManagerPages.jsx';
import './admin.css';
import { useAuth } from './context/Auth.jsx';
import { Badge, DataTable, Field, LineChart, Modal, Notice, PageHead, useApi } from './ui.jsx';
import { AuthShell, SignIn, ForgotPassword } from './AuthForms.jsx';
import { Coupons, DepositPolicy, Occupancy, Profile, Revenue, Roles, Users } from './AdminPages.jsx';
import { Cancellations, Refunds } from './Cancellations.jsx';
import { api, dateLabel, money } from './api/client.js';

const ICONS = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  calendar: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  bed: 'M2 4v16 M2 8h18a2 2 0 0 1 2 2v10 M2 17h20 M6 8v9',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  card: 'M2 5h20v14H2z M2 10h20',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z'
};
const SECTION_ICON = { 'Front desk': 'calendar', Rooms: 'bed', Housekeeping: 'sparkle', Billing: 'card', 'Guests & staff': 'users', Settings: 'gear' };
const Icon = ({ n, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[n]} /></svg>
);

// A menu entry shows when the user has any of its permissions ('manager.only' = the Hotel Manager role).
const allowed = (item, perms, role) => !item[3] || item[3].some((p) => (p === 'manager.only' ? role === 'manager' : p === 'admin.only' ? role === 'admin' : perms.includes(p)));

function Sidebar({ route, open, onClose }) {
  const { user, signOut } = useAuth();
  const link = (href, label, icon) => (
    <a key={href} href={href} className={route === href ? 'on' : ''} aria-current={route === href ? 'page' : undefined} onClick={onClose}>
      {icon && <Icon n={icon} />}<span>{label}</span>
    </a>
  );
  return (
    <>
      {open && <div className="scrim" onClick={onClose} />}
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Admin navigation">
        <a className="brand" href="#/admin">Grand<span>Stay</span><small>Management</small></a>
        <div className="snav" role="navigation" aria-label="Sections">
          {link('#/admin', 'Dashboard', 'grid')}
          {MENU.filter((m) => m.items).map((m) => ({ ...m, items: m.items.filter((i) => allowed(i, user.permissions, user.role)) })).filter((m) => m.items.length).map((m) => (
            <div className="grp" key={m.label}>
              <p>{m.label}</p>
              {m.items.map(([h, l]) => link(h, l, null))}
            </div>
          ))}
        </div>
        <a className="site-link" href="#/"><Icon n="globe" /> View website</a>
        <button type="button" className="site-link" style={{ background: "none", border: "none", width: "100%", textAlign: "left", cursor: "pointer", color: "#ff6b6b" }} onClick={async () => { await signOut(); location.hash = "#/admin/login"; }}><Icon n="lock" /> Sign out</button>
      </aside>
    </>
  );
}

function Topbar({ onMenu }) {
  const { user, signOut } = useAuth();
  const name = user.customerProfile?.fullName || user.username;
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setMenu(false); };
    addEventListener('click', close); addEventListener('keydown', close);
    return () => { removeEventListener('click', close); removeEventListener('keydown', close); };
  }, []);
  return (
    <header className="atop" ref={ref}>
      <button className="ibtn burger" aria-label="Open menu" onClick={onMenu}><Icon n="menu" /></button>
      <span className="atop-gap" />
      <NotificationBell />
      <div className="aprofile">
        <button aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu(!menu)}>
          <span className="avatar">{initials}</span><span className="who"><b>{name}</b><small>{user.roleName}</small></span>
        </button>
        {menu && (
          <ul className="pop">
            <li><a href="#/admin/profile" onClick={() => setMenu(false)}>My profile</a></li>
            <li><a href="#/" onClick={() => setMenu(false)}>View website</a></li>
            <li><button onClick={async () => { setMenu(false); await signOut(); location.hash = '#/admin/login'; }}>Sign out</button></li>
          </ul>
        )}
      </div>
    </header>
  );
}

/* ---------- Dashboard: live data only ---------- */
const vnDay = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + offset * 864e5));
const shortDate = (iso) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Ho_Chi_Minh' });
const endOfToday = () => encodeURIComponent(`${vnDay(0)}T23:59:59+07:00`);
const ROOM_STATUSES = [['available', 'Available'], ['occupied', 'Occupied'], ['cleaning', 'Cleaning'], ['maintenance', 'Maintenance']];
const canSeeBookings = (u) => ['manager', 'admin'].includes(u.role) || u.permissions.includes('bookings.managed.read');

function Stat({ label, value, hint, href }) {
  const body = <><p>{label}</p><strong>{value ?? '—'}</strong>{hint && <small className="muted">{hint}</small>}</>;
  return href ? <a className="kpi kpi-link" href={href}>{body}</a> : <div className="kpi">{body}</div>;
}

// Today's arrivals (confirmed, check-in today or overdue) and departures (in-house, check-out today or overdue).
function useFrontDesk(enabled) {
  const arrivals = useApi(`/bookings/search?status=confirmed&checkInTo=${endOfToday()}&limit=100`, enabled);
  const inHouse = useApi('/bookings/search?status=checked_in&limit=100', enabled);
  const end = new Date(`${vnDay(0)}T23:59:59+07:00`);
  const departures = (inHouse.data || []).filter((b) => new Date(b.checkOutDate) <= end);
  return { arrivals, inHouse, departures, reload: () => { arrivals.reload(); inHouse.reload(); } };
}

const roomOf = (b) => (b.rooms?.[0]?.roomId?.roomNumber ? `Room ${b.rooms[0].roomId.roomNumber}` : b.rooms?.[0]?.roomTypeId?.name || '—');

function Queue({ title, rows, empty, action, onAction, loading }) {
  return (
    <section className="panel">
      <div className="phead"><h2>{title}</h2><span className="pill">{rows.length}</span></div>
      {loading ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="empty">{empty}</p> : (
        <ul className="queue">
          {rows.map((b) => (
            <li key={b._id}>
              <div><strong>{b.guestName || 'Guest'}</strong><small>{b.bookingReference} · {roomOf(b)} · {dateLabel(b.checkInDate)} → {dateLabel(b.checkOutDate)}</small></div>
              {onAction && <button className="btn sm primary" onClick={() => onAction(b)}>{action}</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const name = user.customerProfile?.fullName?.split(' ').pop() || user.username;
  const desk = canSeeBookings(user);
  const fd = useFrontDesk(desk);
  const canRev = user.permissions.includes('revenue.read');
  const rev = useApi(`/reports/revenue?from=${vnDay(-13)}&to=${vnDay(0)}&groupBy=day`, canRev);
  const rooms = useApi('/rooms?limit=100', user.role === 'manager');
  const cx = useApi('/frontdesk/cancellations', user.permissions.includes('cancellations.review'));
  const [checkingIn, setCheckingIn] = useState(null);
  const [checkingOut, setCheckingOut] = useState(null);
  const series = rev.data?.series || [];
  const roomList = (rooms.data || []).filter((r) => r.isActive !== false);
  const count = (s) => roomList.filter((r) => r.status === s).length;
  const occupancy = roomList.length ? `${Math.round((count('occupied') / roomList.length) * 100)}%` : null;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
  return (
    <>
      <PageHead title={`Hello, ${name}`} sub={`${today} · ${user.roleName}`} />
      <div className="kpis">
        {desk && <Stat label="Arrivals today" value={fd.arrivals.data?.length} hint="Confirmed, not checked in" href="#/admin/frontdesk" />}
        {desk && <Stat label="Departures today" value={fd.inHouse.data ? fd.departures.length : null} hint="Due to check out" href="#/admin/frontdesk" />}
        {desk && <Stat label="In-house guests" value={fd.inHouse.data?.length} hint="Checked in now" href="#/admin/bookings" />}
        {cx.data && <Stat label="Cancellation requests" value={cx.data.length} hint="Waiting for review" href="#/admin/cancellations" />}
        {occupancy && <Stat label="Occupancy now" value={occupancy} hint={`${count('occupied')} of ${roomList.length} rooms`} href="#/admin/rooms" />}
        {canRev && <Stat label="Revenue today" value={series.length ? money(series[series.length - 1].net) : null} hint="Receipts minus refunds" href="#/admin/revenue" />}
      </div>
      {desk && <div className="qgrid">
        <Queue title="Today’s arrivals" rows={fd.arrivals.data || []} loading={fd.arrivals.loading} empty="No arrivals waiting." action="Check in" onAction={user.permissions.includes('stays.check_in') ? setCheckingIn : null} />
        <Queue title="Today’s departures" rows={fd.departures} loading={fd.inHouse.loading} empty="No departures due." action="Check out" onAction={user.permissions.includes('stays.check_out') ? setCheckingOut : null} />
      </div>}
      <div className="dgrid">
        {canRev && (
          <section className="panel span2">
            <div className="phead"><h2>Revenue · last 14 days</h2><span className="muted"><b>{money(series.reduce((a, r) => a + r.net, 0))}</b></span></div>
            {rev.loading ? <p className="muted">Loading…</p> : series.length ? <LineChart labels={series.map((r) => shortDate(r.date))} cur={series.map((r) => r.net)} format={money} summary="Daily revenue for the last 14 days" /> : <p className="empty">No revenue yet.</p>}
          </section>
        )}
        {roomList.length > 0 && (
          <section className="panel">
            <div className="phead"><h2>Room status</h2><span className="muted">{roomList.length} rooms</span></div>
            <div className="stack-bar" role="img" aria-label={ROOM_STATUSES.map(([s, l]) => `${l} ${count(s)}`).join(', ')}>
              {ROOM_STATUSES.map(([s]) => count(s) > 0 && <span key={s} className={`s-${s}`} style={{ flex: count(s) }} />)}
            </div>
            <ul className="rs-list">{ROOM_STATUSES.map(([s, l]) => <li key={s}><i className={`s-${s}`} />{l}<b>{count(s)}</b></li>)}</ul>
            <a className="more" href="#/admin/rooms">Open room map →</a>
          </section>
        )}
      </div>
      {!desk && !canRev && <p className="empty">Use the menu to open your tasks.</p>}
      {checkingIn && <CheckInBooking booking={checkingIn} onClose={() => { setCheckingIn(null); fd.reload(); }} />}
      {checkingOut && <CheckOutBooking booking={checkingOut} onClose={() => { setCheckingOut(null); fd.reload(); }} />}
    </>
  );
}

function Bookings() {
  const { user } = useAuth();
  const [f, setF] = useState('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [checkingIn, setCheckingIn] = useState(null);
  const [changingRoom, setChangingRoom] = useState(null);
  const [addingService, setAddingService] = useState(null);
  const [checkingOut, setCheckingOut] = useState(null);
  const [penalizing, setPenalizing] = useState(null);
  const [notice, setNotice] = useState(null);
  // UC20 7a: generate the invoice again after a failure (an existing invoice is returned as it is).
  const generateInvoice = async (b) => {
    try { setNotice({ ok: `Invoice ${(await api(`/front-desk/bookings/${b._id}/invoice`, { method: 'POST' })).data.invoiceNumber} is ready.` }); }
    catch (x) { setNotice({ error: x }); }
  };

  const statusParam = f !== 'all' ? `&status=${f}` : '';
  const searchParam = search ? `&reference=${encodeURIComponent(search)}` : '';
  const live = useApi(`/bookings/search?limit=100${statusParam}${searchParam}`);
  const bookingsList = live.data || [];

  return (
    <>
      <PageHead
        title="Bookings"
        sub="All reservations, newest first"
        action={user.role === 'receptionist' || user.role === 'admin' ? 'New booking' : null}
        onAction={() => setCreating(true)}
      />
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="chips" role="group" aria-label="Filter by status" style={{ margin: 0 }}>
          {['all', 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'].map((s) => (
            <button key={s} className={f === s ? 'chip on' : 'chip'} aria-pressed={f === s} onClick={() => setF(s)}>{s.replace('_', ' ')}</button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search booking code or reference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '0.45rem 0.8rem', borderRadius: '8px', border: '1px solid var(--line)', minWidth: '240px' }}
        />
      </div>
      <Notice error={live.error || notice?.error} ok={notice?.ok} />
      <DataTable
        cols={['Booking', 'Guest', 'Stay', 'Total', 'Status', '']}
        rows={bookingsList.map((b) => [
          <span key="c" className="nw"><b>{b.bookingReference || b._id.slice(-8).toUpperCase()}</b><small className="muted" style={{ display: 'block' }}>{roomOf(b)}</small></span>,
          b.guestName || '—',
          <span key="s" className="nw">{dateLabel(b.checkInDate)} → {dateLabel(b.checkOutDate)}</span>,
          money(b.totalAmount),
          b.status,
          <RowActions key={b._id} actions={[
            b.status === 'confirmed' && ['Check in', () => setCheckingIn(b)],
            b.status === 'checked_in' && ['Check out', () => setCheckingOut(b)],
            ['pending', 'confirmed', 'checked_in', 'checked_out'].includes(b.status) && [b.status === 'checked_in' ? 'Extend / edit' : 'Edit', () => setEditing(b)],
            ['confirmed', 'checked_in'].includes(b.status) && [b.status === 'confirmed' ? 'Change room type' : 'Change room', () => setChangingRoom(b)],
            b.status === 'checked_in' && ['Add service', () => setAddingService(b)],
            ['checked_in', 'checked_out'].includes(b.status) && ['Penalties', () => setPenalizing(b)],
            b.status === 'checked_out' && ['Generate invoice', () => generateInvoice(b)],
            b.status === 'confirmed' && ['Cancel', () => setCancelling(b)],
          ].filter(Boolean)} />
        ])}
      />
      {!live.loading && bookingsList.length === 0 && <p className="empty">No bookings match this filter.</p>}
      {creating && <WalkInBooking onClose={() => { setCreating(false); live.reload(); }} />}
      {editing && <EditBooking booking={editing} onClose={() => { setEditing(null); live.reload(); }} />}
      {cancelling && <CancelBooking booking={cancelling} onClose={() => { setCancelling(null); live.reload(); }} />}
      {checkingIn && <CheckInBooking booking={checkingIn} onClose={() => { setCheckingIn(null); live.reload(); }} />}
      {changingRoom && <ChangeRoom booking={changingRoom} onClose={() => { setChangingRoom(null); live.reload(); }} />}
      {addingService && <AddService booking={addingService} onClose={() => { setAddingService(null); live.reload(); }} />}
      {checkingOut && <CheckOutBooking booking={checkingOut} onClose={() => { setCheckingOut(null); live.reload(); }} />}
      {penalizing && <Penalties booking={penalizing} onClose={() => { setPenalizing(null); live.reload(); }} />}
    </>
  );
}

// First action as a button, the rest in a "More" menu, so a row never turns into a wall of buttons.
function RowActions({ actions }) {
  if (!actions.length) return null;
  const [[label, run], ...rest] = actions;
  return (
    <span className="row-actions">
      <button className="btn sm" onClick={run}>{label}</button>
      {rest.length > 0 && (
        <details className="rowmenu">
          <summary className="btn sm" aria-label="More actions">More ▾</summary>
          <div>{rest.map(([l, fn]) => <button key={l} onClick={(e) => { e.currentTarget.closest('details').open = false; fn(); }}>{l}</button>)}</div>
        </details>
      )}
    </span>
  );
}

function CustomerAccounts() {
  const [query, setQuery] = useState(''); const [status, setStatus] = useState(''); const [selected, setSelected] = useState(null);
  const list = useApi(`/customers?limit=100&q=${encodeURIComponent(query)}${status ? `&status=${status}` : ''}`);
  return <><PageHead title="Customer accounts" sub="Search customers and manage the blacklist" />
    <form className="chips" onSubmit={(e) => e.preventDefault()}><input aria-label="Search customers" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, username or email" /><select aria-label="Customer status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Blacklisted</option></select></form>
    <Notice error={list.error} />
    <DataTable cols={['Name', 'Username', 'Email', 'Phone', 'Status', '']} rows={(list.data || []).map((u) => [u.customerProfile?.fullName || '—', u.username, u.email, u.phone || '—', u.status, <button key={u._id} className={`btn sm${u.status === 'active' ? ' danger' : ''}`} onClick={() => setSelected(u)}>{u.status === 'active' ? 'Blacklist' : 'Restore'}</button>])} />
    {selected && <CustomerStatus customer={selected} onClose={() => { setSelected(null); list.reload(); }} />}
  </>;
}

function CustomerStatus({ customer, onClose }) {
  const [reason, setReason] = useState(''); const [error, setError] = useState(null); const [saving, setSaving] = useState(false); const blacklisting = customer.status === 'active';
  const submit = async (e) => { e.preventDefault(); setSaving(true); setError(null); try { await api(`/customers/${customer._id}/blacklist`, { method: 'PATCH', body: { action: blacklisting ? 'blacklist' : 'restore', reason } }); onClose(); } catch (x) { setError(x); } finally { setSaving(false); } };
  return <Modal title={blacklisting ? 'Blacklist customer' : 'Restore customer'} onClose={onClose}><form className="form" onSubmit={submit}><p className="full muted">{customer.customerProfile?.fullName || customer.username}</p><Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} required /></Field><div className="full"><Notice error={error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : blacklisting ? 'Blacklist customer' : 'Restore customer'}</button></div></form></Modal>;
}

// UC11: the balance is split over cash, POS and bank transfer until it is 0 (BR-14: never online, BR-21).
function SettleBalance({ booking, balance, onPaid }) {
  const [method, setMethod] = useState('cash'); const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState(balance); const [received, setReceived] = useState('');
  const change = Number(received) - Number(amount);
  useEffect(() => setAmount(balance), [balance]);
  const submit = async (e) => {
    e.preventDefault(); const form = e.target; const f = Object.fromEntries(new FormData(form)); setSaving(true); setError(null);
    try { await api(`/frontdesk/bookings/${booking._id}/payments`, { method: 'POST', body: { method, amount: Number(f.amount), transactionRef: method === 'cash' ? undefined : f.transactionRef } }); form.reset(); setReceived(''); onPaid(); }
    catch (x) { setError(x); } finally { setSaving(false); }
  };
  return <form className="form" onSubmit={submit}>
    <Field label="Payment method"><select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="pos">Card (POS)</option><option value="bank_transfer">Bank transfer</option></select></Field>
    <Field label="Amount (VND)" error={error?.fields?.amount}><input key={balance} name="amount" type="number" min="1" max={balance} step="1" defaultValue={balance} onChange={(e) => setAmount(e.target.value)} required /></Field>
    {method === 'cash' && <Field label="Cash received from guest (optional)"><input type="number" min="0" step="1000" value={received} onChange={(e) => setReceived(e.target.value)} /></Field>}
    {method === 'cash' && received !== '' && <p className="full" role="status">{change >= 0 ? <>Change to give back: <strong>{money(change)}</strong></> : <>Still short by <strong>{money(-change)}</strong></>}</p>}
    {method !== 'cash' && <Field label="Transaction reference" error={error?.fields?.transactionRef}><input name="transactionRef" required maxLength={100} /></Field>}
    <div className="full"><Notice error={error} /></div>
    <div className="full pay-row"><button className="btn primary" disabled={saving}>{saving ? 'Recording…' : 'Record payment'}</button></div>
  </form>;
}

const FEE_LABEL = { early_check_in: 'Early check-in fee', late_check_out: 'Late check-out fee', extra_night: 'Extra night (after 18:00)' };
// UC20: opening it requests the urgent room inspection and posts the late check-out fee (or one extra night after 18:00,
// BR-47); check-out needs the whole balance paid (UC11) and the inspection done or skipped (BR-20, BR-22).
function CheckOutBooking({ booking, onClose }) {
  const [bill, setBill] = useState(null); const [error, setError] = useState(null); const [saving, setSaving] = useState(false); const [skip, setSkip] = useState(false); const [done, setDone] = useState(null);
  const load = () => api(`/front-desk/bookings/${booking._id}/check-out/start`, { method: 'POST' }).then((r) => setBill(r.data)).catch(setError);
  useEffect(() => { load(); }, [booking._id]);
  const submit = async (e) => {
    e.preventDefault(); if (!window.confirm(`Are you sure you want to complete the check-out of ${booking.bookingReference}?`)) return; // MSG-09
    setSaving(true); setError(null);
    try { const r = await api(`/front-desk/bookings/${booking._id}/check-out`, { method: 'POST', body: skip ? { skipInspection: true } : {} }); setDone(r); }
    catch (x) { setError(x); load(); } finally { setSaving(false); }
  };
  if (done) return <Modal title={`Checked out · ${booking.bookingReference}`} onClose={onClose}>
    <Notice ok={done.message} error={done.warning} />
    {done.data.invoice && <p>Invoice <strong>{done.data.invoice.invoiceNumber}</strong> · {money(done.data.invoice.totalAmount)}. Print it from Invoices.</p>}
    <div className="modal-actions"><button className="btn primary" onClick={onClose}>Close</button></div>
  </Modal>;
  if (!bill) return <Modal title="Check out customer" onClose={onClose}>{error ? <Notice error={error} /> : <p className="muted">Requesting the room inspection and preparing the final bill…</p>}</Modal>;
  const inspected = bill.inspection?.status === 'completed';
  return <Modal title={`Check out · ${booking.bookingReference}`} onClose={onClose}>
    <dl className="sum">
      {bill.feeLines.map((f, i) => <div key={i}><dt>{FEE_LABEL[f.type]}</dt><dd>{money(f.amount)}</dd></div>)}
      <div><dt>Total</dt><dd>{money(bill.totalAmount)}</dd></div>
      <div><dt>Paid (deposit and front desk)</dt><dd>{money(bill.paidAmount)}</dd></div>
      <div className="tot"><dt>Balance due</dt><dd><strong>{money(bill.balance)}</strong></dd></div>
    </dl>
    <p role="status">Room inspection: <Badge v={bill.inspection?.status || 'pending'} />{bill.inspection?.assignedTo ? ` · ${bill.inspection.assignedTo}` : ' · no staff responsible yet'} <button type="button" className="btn sm" onClick={load}>Refresh</button></p>
    {bill.proposedPenalties > 0 && <p className="note bad-note">{bill.proposedPenalties} damage / loss item(s) reported by Housekeeping: confirm or waive them in Penalties first.</p>}
    {bill.balance > 0 && <SettleBalance booking={booking} balance={bill.balance} onPaid={load} />}
    <form className="form" onSubmit={submit}>
      {!inspected && <label className="check full"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> The guest cannot wait: skip the inspection (closed as "Skipped at check-out"; damage found later is handled with the guest)</label>}
      <div className="full"><Notice error={error} /></div>
      <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving || bill.balance > 0 || bill.proposedPenalties > 0 || (!inspected && !skip)} title={bill.balance > 0 ? 'Record the payments first' : undefined}>{saving ? 'Checking out…' : 'Complete check-out'}</button></div>
    </form>
  </Modal>;
}

// UC38: record a damage / loss item, or confirm (possibly reduced) / waive one proposed by Housekeeping.
function Penalties({ booking, onClose }) {
  const after = booking.status === 'checked_out'; const bill = useApi(`/bookings/${booking._id}`, after);
  const list = useApi(`/frontdesk/bookings/${booking._id}/penalties`); const catalog = useApi('/frontdesk/compensation-items'); const [pick, setPick] = useState(''); const [qty, setQty] = useState(1); const [amt, setAmt] = useState(''); const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const act = async (path, method, body) => { setSaving(true); setError(null); try { await api(path, { method, body }); list.reload(); if (after) bill.reload(); return true; } catch (x) { setError(x); return false; } finally { setSaving(false); } };
  const submit = async (e) => { e.preventDefault(); const form = e.target; const f = Object.fromEntries(new FormData(form)); if (await act(`/frontdesk/bookings/${booking._id}/penalties`, 'POST', { itemName: pick && pick !== 'other' ? `${(catalog.data || []).find((i) => i._id === pick)?.name}${Number(qty) > 1 ? ` x${qty}` : ''}` : f.itemName, amount: Number(amt), description: f.description || undefined })) form.reset(); setPick(''); setQty(1); setAmt(''); };
  const confirm = (p) => { const value = window.prompt(`Confirmed amount (at most ${p.proposedAmount})`, p.proposedAmount); if (value !== null) act(`/frontdesk/penalties/${p._id}`, 'PATCH', { action: 'confirm', amount: Number(value) }); };
  const waive = (p) => { const reason = window.prompt('Reason for waiving this penalty'); if (reason) act(`/frontdesk/penalties/${p._id}`, 'PATCH', { action: 'waive', reason }); };
  return <Modal title={`Penalties · ${booking.bookingReference}`} onClose={onClose}>
    {list.loading ? <p className="muted">Loading penalties…</p> : <DataTable cols={['Item', 'Proposed', 'Charged', 'Status', '']} rows={(list.data || []).map((p) => [p.itemName + (p.afterCheckout ? ' (after check-out)' : ''), money(p.proposedAmount), p.amount == null ? '—' : money(p.amount), p.status, ['proposed', 'confirmed'].includes(p.status) ? <span className="row-actions">{p.status === 'proposed' && <button className="btn sm" disabled={saving} onClick={() => confirm(p)}>Confirm</button>}<button className="btn sm danger" disabled={saving} onClick={() => waive(p)}>Waive</button></span> : p.waivedReason || ''])} />}
    {after && bill.data && bill.data.totalAmount - (bill.data.paidAmount || 0) > 0 && <>
      <p><strong>Guest owes {money(bill.data.totalAmount - (bill.data.paidAmount || 0))} after check-out.</strong> Record the payment when it arrives; a supplementary invoice is issued.</p>
      <SettleBalance booking={booking} balance={bill.data.totalAmount - (bill.data.paidAmount || 0)} onPaid={() => { bill.reload(); list.reload(); }} />
    </>}
    <form className="form" onSubmit={submit}>
      <Field label="Damaged / lost item"><select value={pick} required onChange={(e) => { setPick(e.target.value); const it = (catalog.data || []).find((i) => i._id === e.target.value); setAmt(it ? String(it.price * qty) : ''); }}><option value="">Select an item…</option>{(catalog.data || []).map((i) => <option key={i._id} value={i._id}>{i.name} · {money(i.price)}</option>)}<option value="other">Other (describe)</option></select></Field>
      {pick === 'other' && <Field label="Item description"><input name="itemName" required maxLength={120} /></Field>}
      {pick && pick !== 'other' && <Field label="Quantity"><input type="number" min="1" step="1" value={qty} onChange={(e) => { setQty(e.target.value); const it = (catalog.data || []).find((i) => i._id === pick); if (it) setAmt(String(it.price * Number(e.target.value || 0))); }} /></Field>}
      <Field label="Amount (VND)"><input type="number" min="1" step="1" required value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
      <Field label="Description"><input name="description" maxLength={500} /></Field>
      <div className="full"><Notice error={list.error || error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Record penalty'}</button></div>
    </form>
  </Modal>;
}

function AddService({ booking, onClose }) {
  const services = useApi('/front-desk/services'); const detail = useApi(`/bookings/${booking._id}`); const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const submit = async (e) => { e.preventDefault(); setSaving(true); setError(null); const f = Object.fromEntries(new FormData(e.target)); try { await api(`/front-desk/bookings/${booking._id}/services`, { method: 'POST', body: { ...f, quantity: Number(f.quantity) } }); onClose(); } catch (x) { setError(x); } finally { setSaving(false); } };
  const voidLine = async (line) => { const reason = window.prompt(`Reason for voiding ${line.name}:`); if (!reason) return; try { await api(`/front-desk/bookings/${booking._id}/services/${line._id}/void`, { method: 'POST', body: { reason } }); detail.reload(); } catch (x) { setError(x); } };
  return <Modal title={`Add service · ${booking.bookingReference}`} onClose={onClose}><form className="form" onSubmit={submit}>
    <Field label="Service"><select name="serviceId" required disabled={services.loading}><option value="">Select a service</option>{services.data?.map((s) => <option key={s._id} value={s._id}>{s.name} · {money(s.unitPrice)}</option>)}</select></Field>
    <Field label="Quantity"><input name="quantity" type="number" min="1" max="100" defaultValue="1" required /></Field>
    <div className="full"><Notice error={services.error || detail.error || error} /></div>
    <div className="full">{detail.data?.services?.length > 0 && <DataTable cols={['Recorded service', 'Amount', 'Status', '']} rows={detail.data.services.map((line) => [line.name, money(line.amount), line.status || 'active', line.status !== 'voided' ? <button type="button" className="btn sm danger" onClick={() => voidLine(line)}>Void</button> : ''])} />}</div>
    <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving || services.loading}>{saving ? 'Adding…' : 'Add service'}</button></div>
  </form></Modal>;
}

// UC18: during the stay a room of the same or a higher-priced type (an upgrade is always charged); before check-in the
// room type. A lower-priced type is listed only when nothing better is free, and needs the guest's agreement (BR-38).
function ChangeRoom({ booking, onClose }) {
  const options = useApi(`/front-desk/bookings/${booking._id}/change-room-options`); const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState(''); const [agrees, setAgrees] = useState(false); const [dropCoupon, setDropCoupon] = useState(false);
  const byType = options.data && options.meta?.mode === 'room_type';
  const chosen = (options.data || []).find((o) => o._id === pick);
  const submit = async (e) => {
    e.preventDefault(); setSaving(true); setError(null);
    try { await api(`/front-desk/bookings/${booking._id}/change-room`, { method: 'POST', body: { [byType ? 'newRoomTypeId' : 'newRoomId']: pick, ...(chosen?.lower ? { guestAgrees: agrees } : {}), ...(dropCoupon ? { dropCoupon: true } : {}) } }); onClose(); }
    catch (x) { setError(x); } finally { setSaving(false); }
  };
  const diff = (o) => (o.difference > 0 ? ` · +${money(o.difference)}` : o.difference < 0 ? ` · −${money(-o.difference)}` : ' · same price');
  return <Modal title={`${byType ? 'Change room type' : 'Change room'} · ${booking.bookingReference}`} onClose={onClose}><form className="form" onSubmit={submit}>
    <p className="full muted">{byType ? 'Before check-in the room type changes for the whole stay; the deposit does not change. The room itself is chosen at check-in.' : 'The remaining nights are charged at the new room type; the old room goes to cleaning.'}</p>
    {options.meta?.onlyLower && <p className="full note">No room of the booked or a higher-priced type is free: only lower-priced types are offered.</p>}
    <Field label={byType ? 'Available room type' : 'Available room'}><select value={pick} onChange={(e) => setPick(e.target.value)} required disabled={options.loading}><option value="">{byType ? 'Select a room type' : 'Select a room'}</option>{options.data?.map((o) => <option key={o._id} value={o._id}>{byType ? o.roomType.name : `Room ${o.roomNumber} · ${o.roomType?.name}`}{diff(o)}</option>)}</select></Field>
    {chosen?.lower && <label className="check full"><input type="checkbox" checked={agrees} onChange={(e) => setAgrees(e.target.checked)} required /> The guest agrees to the lower-priced room type</label>}
    {byType && booking.couponCode && <label className="check full"><input type="checkbox" checked={dropCoupon} onChange={(e) => setDropCoupon(e.target.checked)} /> If the coupon {booking.couponCode} no longer applies, the guest agrees to continue without the discount</label>}
    <div className="full"><Notice error={options.error || error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving || options.loading || !options.data?.length}>{saving ? 'Saving…' : 'Confirm change'}</button></div>
  </form></Modal>;
}

// UC17: an approved check-in request pre-fills the guests and the ID number, which are checked against the document.
function CheckInBooking({ booking, onClose }) {
  const rooms = useApi(`/front-desk/bookings/${booking._id}/available-rooms`); const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const pre = rooms.meta?.request;
  const submit = async (e) => { e.preventDefault(); setSaving(true); setError(null); const f = Object.fromEntries(new FormData(e.target)); try { await api(`/front-desk/bookings/${booking._id}/check-in`, { method: 'POST', body: { ...f, guestCount: Number(f.guestCount) } }); onClose(); } catch (x) { setError(x); } finally { setSaving(false); } };
  if (rooms.loading) return <Modal title={`Check in ${booking.bookingReference}`} onClose={onClose}><p className="muted">Loading rooms…</p></Modal>;
  return <Modal title={`Check in ${booking.bookingReference}`} onClose={onClose}><form className="form" onSubmit={submit}>
    {pre && <p className="full note">Pre-filled from the guest's check-in request: verify it against the original ID document.</p>}
    <Field label="Available room"><select name="roomId" required><option value="">Select a room</option>{rooms.data?.map((r) => <option key={r._id} value={r._id}>Room {r.roomNumber} · Floor {r.floor}</option>)}</select></Field>
    <Field label="Number of guests"><input name="guestCount" type="number" min="1" defaultValue={pre?.guestCount || booking.rooms?.[0]?.guestCount || 1} required /></Field><Field label="ID / passport number"><input name="idDocumentNo" defaultValue={pre?.idDocumentNo || ''} required /></Field>
    <div className="full"><Notice error={rooms.error || error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving || !rooms.data?.length}>{saving ? 'Checking in…' : 'Confirm check-in'}</button></div>
  </form></Modal>;
}

// UC16 at the desk: the ID document is checked here; the bank account for a refund is asked later, in UC21 (BR-17).
function CancelBooking({ booking, onClose }) {
  const [error, setError] = useState(null); const [saving, setSaving] = useState(false); const [hotel, setHotel] = useState(false); const [done, setDone] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); if (!window.confirm(`Are you sure you want to cancel ${booking.bookingReference}?`)) return; // MSG-09
    setSaving(true); setError(null); const f = Object.fromEntries(new FormData(e.target));
    try { setDone((await api(`/front-desk/bookings/${booking._id}/cancel`, { method: 'POST', body: hotel ? { hotelCaused: true, ...(f.reason ? { reason: f.reason } : {}) } : { reason: f.reason } })).message); }
    catch (x) { setError(x); } finally { setSaving(false); }
  };
  if (done) return <Modal title={`Cancel ${booking.bookingReference}`} onClose={onClose}><Notice ok={done} /><p className="muted">A paid deposit is reviewed in Cancellations; a refund is then handled in Refunds, where the customer's bank account is entered.</p><div className="modal-actions"><button className="btn primary" onClick={onClose}>Close</button></div></Modal>;
  return <Modal title={`Cancel ${booking.bookingReference}`} onClose={onClose}><form className="form" onSubmit={submit}>
    <p className="full muted">Check that the ID document matches the name of the person who made the booking. For a request by phone use Cancellations (code sent by e-mail).</p>
    <label className="check full"><input type="checkbox" checked={hotel} onChange={(e) => setHotel(e.target.checked)} /> The hotel cannot provide the room (100% refund, approved at once)</label>
    <Field label={hotel ? 'Reason (optional)' : 'Cancellation reason'}><input name="reason" required={!hotel} maxLength={500} /></Field>
    <div className="full"><Notice error={error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Confirm cancellation'}</button></div>
  </form></Modal>;
}

function EditBooking({ booking, onClose }) {
  const detail = useApi(`/bookings/${booking._id}`); const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  if (detail.loading) return <Modal title="Modify booking" onClose={onClose}><p className="muted">Loading booking…</p></Modal>;
  const b = detail.data || booking; const checkedOut = b.status === 'checked_out';
  const submit = async (e) => { e.preventDefault(); setSaving(true); setError(null); const f = Object.fromEntries(new FormData(e.target)); try { await api(`/front-desk/bookings/${b._id}`, { method: 'PATCH', body: { fullName: f.fullName, phone: f.phone, ...(f.idDocumentNo ? { idDocumentNo: f.idDocumentNo } : {}), ...(checkedOut ? {} : { ...(b.status === 'checked_in' ? {} : { checkInDate: f.checkInDate }), checkOutDate: f.checkOutDate, guestCount: Number(f.guestCount) }), ...(f.dropCoupon ? { dropCoupon: true } : {}) } }); onClose(); } catch (x) { setError(x); } finally { setSaving(false); } };
  return <Modal title={b.status === 'checked_in' ? 'Extend or edit stay' : 'Modify booking'} onClose={onClose}><form className="form" onSubmit={submit}>
    {!checkedOut && <p className="full muted">{b.status === 'checked_in' ? 'Extra nights are priced at the rate of each night and need no deposit.' : 'The deposit already paid does not change; the difference is paid at check-out.'}</p>}
    {!checkedOut && b.couponCode && <label className="check full"><input type="checkbox" name="dropCoupon" /> If the coupon {b.couponCode} no longer applies to the new stay, the guest agrees to continue without the discount</label>}
    <Field label="Guest full name"><input name="fullName" defaultValue={b.guestName} required /></Field><Field label="Phone"><input name="phone" defaultValue={b.guestPhone} required /></Field>{['checked_in', 'checked_out'].includes(b.status) && <Field label="ID / passport number"><input name="idDocumentNo" defaultValue={b.guestIdDocumentNo} required /></Field>}
    {!checkedOut && <><Field label="Check-in"><input name="checkInDate" type="date" defaultValue={b.checkInDate?.slice(0, 10)} required disabled={b.status === 'checked_in'} /></Field><Field label="Check-out"><input name="checkOutDate" type="date" defaultValue={b.checkOutDate?.slice(0, 10)} required /></Field><Field label="Guests"><input name="guestCount" type="number" min="1" defaultValue={b.rooms?.[0]?.guestCount || 1} required /></Field></>}
    <div className="full"><Notice error={detail.error || error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
  </form></Modal>;
}

function WalkInBooking({ onClose }) {
  const types = useApi('/public/room-types'); // active room types; /room-types is the Hotel Manager's catalogue
  const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setSaving(true); setError(null);
    const f = Object.fromEntries(new FormData(e.target));
    try { await api('/front-desk/bookings', { method: 'POST', body: { ...f, guestCount: Number(f.guestCount) } }); onClose(); }
    catch (x) { setError(x); } finally { setSaving(false); }
  };
  return <Modal title="Create walk-in booking" onClose={onClose}>
    <form className="form" onSubmit={submit}>
      <p className="full muted">Walk-in booking · no deposit required</p>
      <Field label="Check-in"><input name="checkInDate" type="date" required /></Field>
      <Field label="Check-out"><input name="checkOutDate" type="date" required /></Field>
      <Field label="Room type"><select name="roomTypeId" required disabled={types.loading}><option value="">Select a room type</option>{types.data?.map((t) => <option key={t._id} value={t._id}>{t.name} · {money(t.basePrice)} / night</option>)}</select></Field>
      <Field label="Guests"><input name="guestCount" type="number" min="1" max="20" defaultValue="1" required /></Field>
      <Field label="Guest full name"><input name="fullName" required /></Field>
      <Field label="Phone"><input name="phone" inputMode="numeric" required /></Field>
      <Field label="Email"><input name="email" type="email" required /></Field>
      <Field label="ID / passport number"><input name="idDocumentNo" required /></Field>
      <div className="full"><Notice error={types.error || error} /></div>
      <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving || types.loading}>{saving ? 'Creating…' : 'Create booking'}</button></div>
    </form>
  </Modal>;
}

function FrontDesk() {
  const { user } = useAuth();
  const fd = useFrontDesk(true);
  const [checkingIn, setCheckingIn] = useState(null);
  const [checkingOut, setCheckingOut] = useState(null);
  const done = (set) => () => { set(null); fd.reload(); };
  return (
    <>
      <PageHead title="Check-in / Check-out" sub="Today’s arrivals and departures, including overdue ones" />
      <Notice error={fd.arrivals.error || fd.inHouse.error} />
      <div className="qgrid">
        <Queue title="Arrivals" rows={fd.arrivals.data || []} loading={fd.arrivals.loading} empty="No arrivals waiting." action="Check in" onAction={user.permissions.includes('stays.check_in') ? setCheckingIn : null} />
        <Queue title="Departures" rows={fd.departures} loading={fd.inHouse.loading} empty="No departures due today." action="Check out" onAction={user.permissions.includes('stays.check_out') ? setCheckingOut : null} />
        <div className="qfull"><Queue title="In-house guests" rows={fd.inHouse.data || []} loading={fd.inHouse.loading} empty="Nobody is checked in." /></div>
      </div>
      {checkingIn && <CheckInBooking booking={checkingIn} onClose={done(setCheckingIn)} />}
      {checkingOut && <CheckOutBooking booking={checkingOut} onClose={done(setCheckingOut)} />}
    </>
  );
}

const METHOD = { cash: 'Cash', pos: 'Card (POS)', credit_card: 'Card', e_wallet: 'E-wallet', bank_transfer: 'Bank transfer' };
const STAMP = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '—');

function Payments() {
  const [status, setStatus] = useState('');
  const list = useApi(`/frontdesk/payments${status ? `?status=${status}` : ''}`);
  const rows = list.data || [];
  const received = rows.filter((p) => p.status === 'success').reduce((a, p) => a + p.amount, 0); // a refunded deposit is no longer held
  return (
    <>
      <PageHead title="Payments" sub="Deposits paid online and balances collected at the front desk" />
      <div className="chips" role="group" aria-label="Filter by status">
        {[['', 'All'], ['success', 'Paid'], ['pending', 'Pending'], ['failed', 'Failed'], ['refunded', 'Refunded']].map(([v, l]) => <button key={l} className={status === v ? 'chip on' : 'chip'} aria-pressed={status === v} onClick={() => setStatus(v)}>{l}</button>)}
      </div>
      <Notice error={list.error} />
      {list.loading ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="empty">No payments yet.</p> : <>
        <p className="muted">{rows.length} payments · net received {money(received)}</p>
        <DataTable cols={['Date', 'Booking', 'Guest', 'Type', 'Method', 'Amount', 'Status']} rows={rows.map((p) => [STAMP(p.paidAt || p.createdAt), p.bookingId?.bookingReference || '—', p.bookingId?.guestName || '—', p.kind, METHOD[p.method] || p.method, money(p.amount), p.status === 'success' ? 'paid' : p.status])} />
      </>}
    </>
  );
}

function Login() {
  const { user, signOut } = useAuth();
  const [forgot, setForgot] = useState(false);
  const [msg, setMsg] = useState(null);
  if (user && user.scope !== 'self') { location.hash = '#/admin'; return null; }
  return (
    <AuthShell staff>
      <h1>{forgot ? 'Reset staff password' : 'Staff sign in'}</h1>
      <p className="muted">{forgot ? 'Enter your details to reset your password.' : 'Use your hotel account to continue.'}</p>
      {msg && <p role="status" className="note ok-note">{msg}</p>}
      {user && (
        <div style={{ background: '#fee2e2', border: '1px solid #f87171', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ color: '#991b1b', fontSize: '0.9rem' }}>
            You are signed in as a customer (<strong>{user.email}</strong>). Please sign out to access the staff portal.
          </span>
          <button
            type="button"
            onClick={signOut}
            style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 14px', fontWeight: 600, cursor: 'pointer' }}
          >
            Sign out now
          </button>
        </div>
      )}
      {forgot ? (
        <ForgotPassword
          onDone={() => {
            setForgot(false);
            setMsg('Password reset successfully. Sign in with your new password.');
          }}
          onCancel={() => setForgot(false)}
        />
      ) : (
        <SignIn
          onDone={() => { location.hash = '#/admin'; }}
          onForgot={() => { setForgot(true); setMsg(null); }}
          hint={<a className="more" href="#/">← Back to website</a>}
        />
      )}
    </AuthShell>
  );
}

const PAGES = {
  '#/admin': Dashboard,
  '#/admin/customers': CustomerAccounts,
  '#/admin/users': Users,
  '#/admin/staff': Users,
  '#/admin/roles': Roles,
  '#/admin/coupons': Coupons,
  '#/admin/revenue': Revenue,
  '#/admin/occupancy': Occupancy,
  '#/admin/profile': Profile,
  '#/admin/bookings': Bookings,
  '#/admin/frontdesk': FrontDesk,
  '#/admin/payments': Payments,
  '#/admin/invoices': Invoices,
  '#/admin/rooms': AdminRoomMap,
  '#/admin/assignments': HousekeepingAssignments,
  '#/admin/cleaning-request': AdHocCleaningRequest,
  '#/admin/stay-requests': StayRequests,
  '#/admin/room-availability': RoomAvailability,
  '#/admin/roomtypes': AdminRoomTypes,
  '#/admin/cleaning': HousekeepingTasks,
  '#/admin/issues': RoomIssues,
  '#/admin/policy': DepositPolicy,
  '#/admin/cancellations': Cancellations,
  '#/admin/refunds': Refunds,
  '#/admin/catalog': Catalog,
  '#/admin/permissions': StaffPermissions,
  '#/admin/reviews': Reviews,
  '#/admin/audit': AuditLog
};

const Forbidden = () => <><PageHead title="No access" sub="Your role does not include this area." /><a className="btn" href="#/admin">Back to dashboard</a></>;

const NEEDS = { '#/admin/users': 'users.manage', '#/admin/staff': 'staff.manage', '#/admin/roles': 'roles.manage', '#/admin/coupons': 'promotions.manage', '#/admin/revenue': 'revenue.read', '#/admin/occupancy': 'revenue.read', '#/admin/policy': 'policies.manage', '#/admin/cancellations': 'cancellations.review', '#/admin/refunds': 'refunds.handle', '#/admin/room-availability': 'rooms.search', '#/admin/cleaning': 'cleaning_tasks.own.read', '#/admin/cleaning-request': 'cleaning_tasks.ad_hoc.create', '#/admin/stay-requests': 'stay_requests.manage' };

export default function Admin({ route }) {
  const { user, loading } = useAuth();
  const [drawer, setDrawer] = useState(false);
  if (loading) return <p className="muted center-msg">Loading…</p>;
  if (route === '#/admin/login') return <Login />;
  if (!user || user.scope === 'self') { if (location.hash !== '#/admin/login') location.hash = '#/admin/login'; return null; }
  const denied = (['#/admin/customers', '#/admin/assignments', '#/admin/catalog', '#/admin/permissions', '#/admin/reviews', '#/admin/rooms', '#/admin/roomtypes'].includes(route) && user.role !== 'manager') || (route === '#/admin/audit' && user.role !== 'admin') || (NEEDS[route] && !user.permissions.includes(NEEDS[route]));
  const Page = denied ? Forbidden : PAGES[route] || Dashboard;
  return (
    <div className="adm">
      <a className="skip" href="#main">Skip to content</a>
      <Sidebar route={route} open={drawer} onClose={() => setDrawer(false)} />
      <div className="amain">
        <Topbar onMenu={() => setDrawer(true)} />
        <main id="main" className="acontent"><Page /></main>
      </div>
    </div>
  );
}
