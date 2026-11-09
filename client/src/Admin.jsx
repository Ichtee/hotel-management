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
import LiveFrontDesk from './pages/FrontDesk.jsx';
import { StayCatalog, StayTasks, StayNotifications, StayHotelInfo } from './pages/StaySupport.jsx';
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
  const openStay = () => { location.hash = "#/admin/frontdesk"; };
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
        <Queue title="Today’s arrivals" rows={fd.arrivals.data || []} loading={fd.arrivals.loading} empty="No arrivals waiting." action="Check in" onAction={user.permissions.includes('stays.check_in') ? openStay : null} />
        <Queue title="Today’s departures" rows={fd.departures} loading={fd.inHouse.loading} empty="No departures due." action="Check out" onAction={user.permissions.includes('stays.check_out') ? openStay : null} />
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
    </>
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
  '#/admin/bookings': LiveFrontDesk,
  '#/admin/frontdesk': LiveFrontDesk,
  '#/admin/services': StayCatalog,
  '#/admin/cleaning': StayTasks,
  '#/admin/issues': RoomIssues,
  '#/admin/invoices': LiveFrontDesk,
  '#/admin/payments': Payments,
  '#/admin/notifications': StayNotifications,
  '#/admin/rooms': AdminRoomMap,
  '#/admin/assignments': HousekeepingAssignments,
  '#/admin/cleaning-request': AdHocCleaningRequest,
  '#/admin/stay-requests': StayRequests,
  '#/admin/room-availability': RoomAvailability,
  '#/admin/roomtypes': AdminRoomTypes,
  '#/admin/hotel': StayHotelInfo,
  '#/admin/policy': DepositPolicy,
  '#/admin/cancellations': Cancellations,
  '#/admin/refunds': Refunds,
  '#/admin/catalog': StayCatalog,
  '#/admin/permissions': StaffPermissions,
  '#/admin/reviews': Reviews,
  '#/admin/audit': AuditLog
};

const Forbidden = () => <><PageHead title="No access" sub="Your role does not include this area." /><a className="btn" href="#/admin">Back to dashboard</a></>;

const NEEDS = { '#/admin/bookings': 'bookings.managed.read', '#/admin/frontdesk': 'bookings.managed.read', '#/admin/invoices': 'invoices.print', '#/admin/payments': 'payments.settle', '#/admin/hotel': 'policies.manage', '#/admin/users': 'users.manage', '#/admin/staff': 'staff.manage', '#/admin/roles': 'roles.manage', '#/admin/coupons': 'promotions.manage', '#/admin/revenue': 'revenue.read', '#/admin/occupancy': 'revenue.read', '#/admin/policy': 'policies.manage', '#/admin/cancellations': 'cancellations.review', '#/admin/refunds': 'refunds.handle', '#/admin/room-availability': 'rooms.search', '#/admin/cleaning': 'cleaning_tasks.own.read', '#/admin/cleaning-request': 'cleaning_tasks.ad_hoc.create', '#/admin/stay-requests': 'stay_requests.manage' };

export default function Admin({ route }) {
  const { user, loading } = useAuth();
  const [drawer, setDrawer] = useState(false);
  if (loading) return <p className="muted center-msg">Loading…</p>;
  if (route === '#/admin/login') return <Login />;
  if (!user || user.scope === 'self') { if (location.hash !== '#/admin/login') location.hash = '#/admin/login'; return null; }
  const denied = (['#/admin/services', '#/admin/customers', '#/admin/assignments', '#/admin/catalog', '#/admin/permissions', '#/admin/reviews', '#/admin/rooms', '#/admin/roomtypes'].includes(route) && user.role !== 'manager') || (route === '#/admin/audit' && user.role !== 'admin') || (NEEDS[route] && !user.permissions.includes(NEEDS[route]));
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
