import { useEffect, useRef, useState } from 'react';
import { MENU } from './data.js';
import AdminRoomMap from './pages/AdminRoomMap.jsx';
import AdminRoomTypes from './pages/AdminRoomTypes.jsx';
import HousekeepingTasks from './HousekeepingTasks.jsx';
import HousekeepingAssignments from './HousekeepingAssignments.jsx';
import RoomIssues from './RoomIssues.jsx';
import AdHocCleaningRequest from './AdHocCleaningRequest.jsx';
import StayRequests, { IdPhotoLink } from './StayRequests.jsx';
import Invoices from './Invoices.jsx';
import RoomAvailability from './RoomAvailability.jsx';
import NotificationBell, { NotificationsPage } from './Notifications.jsx';
import { AuditLog, Catalog, Reviews, StaffPermissions } from './ManagerPages.jsx';
import './admin.css';
import { useAuth } from './context/Auth.jsx';
import { Badge, BrandName, DataTable, Field, LineChart, Notice, PageHead, Screen, useApi, useScreen } from './ui.jsx';
import { AuthShell, SignIn, ForgotPassword } from './AuthForms.jsx';
import { Coupons, DepositPolicy, Occupancy, Profile, ChangePassword, Revenue, Users } from './AdminPages.jsx';
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

// Hiện mục menu khi có ít nhất một quyền; manager.only dành riêng cho quản lý.
const allowed = (item, perms, role) => !item[3] || item[3].some((p) => (p === 'manager.only' ? role === 'manager' : p === 'admin.only' ? role === 'admin' : p === 'role.receptionist' ? role === 'receptionist' : perms.includes(p)));

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
        <a className="brand" href="#/admin"><BrandName /><small>Management</small></a>
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
      <NotificationBell allHref="#/admin/notifications" />
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

// Bảng điều khiển lấy dữ liệu từ API.
const vnDay = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + offset * 864e5));
const shortDate = (iso) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Ho_Chi_Minh' });
const ROOM_STATUSES = [['available', 'Available'], ['occupied', 'Occupied'], ['cleaning', 'Cleaning'], ['maintenance', 'Maintenance']];
const canSeeBookings = (u) => ['manager', 'admin'].includes(u.role) || u.permissions.includes('bookings.managed.read');

function Stat({ label, value, hint, href }) {
  const body = <><p>{label}</p><strong>{value ?? '—'}</strong>{hint && <small className="muted">{hint}</small>}</>;
  return href ? <a className="kpi kpi-link" href={href}>{body}</a> : <div className="kpi">{body}</div>;
}

// Tổng hợp khách đến và rời đi trong ngày, gồm cả booking quá hạn.
function useFrontDesk(enabled) {
  const arrivals = useApi('/bookings/search?view=arrivals&limit=100', enabled);
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
  const desk = canSeeBookings(user) && user.role !== 'admin';
  const fd = useFrontDesk(desk);
  const canRev = user.permissions.includes('revenue.read');
  const rev = useApi(`/reports/revenue?from=${vnDay(-13)}&to=${vnDay(0)}&groupBy=day`, canRev);
  const rooms = useApi('/rooms?limit=100', user.role === 'manager');
  const cx = useApi('/frontdesk/cancellations', user.permissions.includes('cancellations.review'));
  const sc = useScreen();
  // Hiện số nhiệm vụ hoặc tài khoản theo vai trò đang đăng nhập.
  const mine = useApi('/housekeeping/tasks/mine', user.permissions.includes('cleaning_tasks.own.read'));
  const managers = useApi('/users?role=manager&limit=1', user.role === 'admin');
  const cardValue = (href) => (href === '#/admin/cleaning' && mine.data ? `${mine.data.filter((t) => ['assigned', 'in_progress'].includes(t.status)).length} open` : href === '#/admin/users' && managers.meta ? String(managers.meta.total) : 'Open');
  const series = rev.data?.series || [];
  const roomList = (rooms.data || []).filter((r) => r.isActive !== false);
  const count = (s) => roomList.filter((r) => r.status === s).length;
  const occupancy = roomList.length ? `${Math.round((count('occupied') / roomList.length) * 100)}%` : null;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
  if (sc.name) return <BookingScreen sc={sc} onDone={fd.reload} />;
  return (
    <>
      <PageHead title={`Hello, ${name}`} sub={`${today} · ${user.roleName}`} />
      <div className="kpis">
        {desk && <Stat label="Arrivals today" value={fd.arrivals.data?.length} hint="Confirmed, not checked in" href="#/admin/bookings?view=arrivals" />}
        {desk && <Stat label="Departures today" value={fd.inHouse.data ? fd.departures.length : null} hint="Due to check out" href="#/admin/bookings?view=departures" />}
        {desk && <Stat label="In-house guests" value={fd.inHouse.data?.length} hint="Checked in now" href="#/admin/bookings" />}
        {cx.data && <Stat label="Cancellation requests" value={cx.data.length} hint="Waiting for review" href="#/admin/cancellations" />}
        {occupancy && <Stat label="Occupancy now" value={occupancy} hint={`${count('occupied')} of ${roomList.length} rooms`} href="#/admin/rooms" />}
        {canRev && <Stat label="Revenue today" value={series.length ? money(series[series.length - 1].net) : null} hint="Receipts minus refunds" href="#/admin/revenue" />}
      </div>
      {desk && <div className="qgrid">
        <Queue title="Today’s arrivals" rows={fd.arrivals.data || []} loading={fd.arrivals.loading} empty="No arrivals waiting." action="Check in" onAction={user.permissions.includes('stays.check_in') ? (b) => sc.go('check-in', b._id) : null} />
        <Queue title="Today’s departures" rows={fd.departures} loading={fd.inHouse.loading} empty="No departures due." action="Check out" onAction={user.permissions.includes('stays.check_out') ? (b) => sc.go('check-out', b._id) : null} />
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
      {!desk && !canRev && (
        <div className="kpis">
          {MENU.flatMap((g) => g.items || []).filter((item) => allowed(item, user.permissions, user.role)).map(([href, label, hint]) => <Stat key={href} label={label} value={cardValue(href)} hint={hint || ''} href={href} />)}
        </div>
      )}
    </>
  );
}

// Ưu tiên bộ lọc công việc trong ngày trước bộ lọc trạng thái.
const BOOKING_VIEWS = { arrivals: 'Arrivals', overdue_check_in: 'Overdue check-in', departures: 'Departures', overdue_check_out: 'Overdue check-out' };
const BOOKING_STATUSES = ['pending', 'confirmed', 'cancellation_requested', 'checked_in', 'checked_out', 'cancelled', 'no_show', 'expired'];
const VIEW_HINT = {
  arrivals: 'Confirmed bookings due to check in today or earlier, oldest first.',
  overdue_check_in: 'Confirmed bookings whose check-in date has passed and the guest has not arrived.',
  departures: 'In-house guests due to check out today or earlier.',
  overdue_check_out: 'In-house guests still in the room after their check-out date.',
};
function Bookings() {
  const { user } = useAuth();
  // Lưu bộ lọc vào URL để mở đúng danh sách từ liên kết và bảng điều khiển.
  const f = new URLSearchParams(location.hash.split('?')[1] || '').get('view') || 'all';
  const [search, setSearch] = useState('');
  // Gắn trang với bộ lọc và từ khóa để đổi điều kiện sẽ về trang đầu, tránh lệch state với hash.
  const [paging, setPaging] = useState({ of: '', page: 1 });
  const listKey = `${f}|${search}`;
  const page = paging.of === listKey ? paging.page : 1;
  const setPage = (p) => setPaging({ of: listKey, page: p });
  const setF = (v) => { location.hash = v === 'all' ? '#/admin/bookings' : `#/admin/bookings?view=${v}`; };
  const sc = useScreen();
  const [notice, setNotice] = useState(null);
  // Tạo lại hóa đơn khi lỗi; dùng lại hóa đơn nếu đã tồn tại.
  const generateInvoice = async (b) => {
    try { setNotice({ ok: `Invoice ${(await api(`/front-desk/bookings/${b._id}/invoice`, { method: 'POST' })).data.invoiceNumber} is ready.` }); }
    catch (x) { setNotice({ error: x }); }
  };

  const query = new URLSearchParams({ page, limit: 10, ...(BOOKING_VIEWS[f] ? { view: f } : f !== 'all' ? { status: f } : {}), ...(search.trim() ? { q: search.trim() } : {}) });
  const live = useApi(`/bookings/search?${query}`);
  const bookingsList = live.data || [];
  const pages = live.meta?.pages || 1;
  if (sc.name === 'new') return <WalkInBooking onClose={sc.close} onCreated={(b) => location.replace(`#/admin/bookings?screen=check-in&id=${b._id}`)} />;
  if (sc.name) return <BookingScreen sc={sc} onDone={live.reload} />;

  return (
    <>
      <PageHead
        title="Bookings"
        sub="All reservations, newest first"
        action={user.role === 'receptionist' ? 'New booking' : null}
        onAction={() => sc.go('new')}
      />
      <div className="filter-groups">
        <div role="group" aria-label="Today">
          <p className="filter-title">Today</p>
          <div className="chips">
            {[['all', 'All'], ...Object.entries(BOOKING_VIEWS)].map(([key, label]) => (
              <button key={key} className={f === key ? 'chip on' : 'chip'} aria-pressed={f === key} onClick={() => setF(key)}>{label}</button>
            ))}
          </div>
        </div>
        <div role="group" aria-label="Status">
          <p className="filter-title">Status</p>
          <div className="chips">
            {BOOKING_STATUSES.map((s) => (
              <button key={s} className={f === s ? 'chip on' : 'chip'} aria-pressed={f === s} onClick={() => setF(s)}>{s.replaceAll('_', ' ')}</button>
            ))}
          </div>
        </div>
      </div>
      <input
        type="search"
        className="list-search"
        aria-label="Search bookings"
        placeholder="Search code, guest name or phone"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {VIEW_HINT[f] && <p className="muted">{VIEW_HINT[f]}</p>}
      <Notice error={live.error || notice?.error} ok={notice?.ok} />
      <DataTable
        cols={['Booking', 'Guest', 'Stay', 'Total', 'Status', '']}
        rows={bookingsList.map((b) => [
          <span key="c" className="nw"><b>{b.bookingReference || b._id.slice(-8).toUpperCase()}</b><small className="muted" style={{ display: 'block' }}>{roomOf(b)}</small></span>,
          <span key="g" className="nw">{b.guestName || '—'}{b.guestPhone && <small className="muted" style={{ display: 'block' }}>{b.guestPhone}</small>}</span>,
          <span key="s" className="nw">{dateLabel(b.checkInDate)} → {dateLabel(b.checkOutDate)}</span>,
          money(b.totalAmount),
          b.status,
          <RowActions key={b._id} actions={[
            b.status === 'confirmed' && ['Check in', () => sc.go('check-in', b._id)],
            b.status === 'checked_in' && ['Check out', () => sc.go('check-out', b._id)],
            ['pending', 'confirmed', 'checked_in', 'checked_out'].includes(b.status) && [b.status === 'checked_in' ? 'Extend / edit' : 'Edit', () => sc.go('edit', b._id)],
            ['confirmed', 'checked_in'].includes(b.status) && [b.status === 'confirmed' ? 'Change room type' : 'Change room', () => sc.go('change-room', b._id)],
            b.status === 'checked_in' && ['Add service', () => sc.go('service', b._id)],
            ['checked_in', 'checked_out'].includes(b.status) && ['Penalties', () => sc.go('penalties', b._id)],
            b.status === 'checked_out' && ['Generate invoice', () => generateInvoice(b)],
            b.status === 'confirmed' && ['Cancel', () => sc.go('cancel', b._id)],
          ].filter(Boolean)} />
        ])}
      />
      {!live.loading && bookingsList.length === 0 && <p className="empty">No bookings match this filter.</p>}
      {live.meta && (
        <div className="between" style={{ marginTop: '1rem' }}>
          <span className="muted">{live.meta.total} booking{live.meta.total === 1 ? '' : 's'} · page {live.meta.page} of {pages}</span>
          <span className="row-actions">
            <button className="btn sm" disabled={page <= 1 || live.loading} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn sm" disabled={page >= pages || live.loading} onClick={() => setPage(page + 1)}>Next</button>
          </span>
        </div>
      )}
    </>
  );
}

// Mỗi thao tác lễ tân có URL riêng để mở lại đúng booking.
const BOOKING_TASKS = { 'check-in': CheckInBooking, 'check-out': CheckOutBooking, cancel: CancelBooking, edit: EditBooking, 'change-room': ChangeRoom, service: AddService, penalties: Penalties };
function BookingScreen({ sc, onDone }) {
  const b = useApi(`/bookings/${sc.id}`);
  const Task = BOOKING_TASKS[sc.name];
  if (!Task) return <Screen title="Not found" onClose={sc.close}><p className="muted">This page does not exist.</p></Screen>;
  if (b.loading || b.error) return <Screen title="Booking" onClose={sc.close}>{b.loading ? <p className="muted">Loading booking…</p> : <Notice error={b.error} />}</Screen>;
  return <Task booking={b.data} onClose={() => { onDone(); sc.close(); }} />;
}

// Giữ một nút chính, gom thao tác phụ vào menu để hàng gọn hơn.
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
  const [query, setQuery] = useState(''); const [status, setStatus] = useState(''); const sc = useScreen();
  const list = useApi(`/customers?limit=100&q=${encodeURIComponent(query)}${status ? `&status=${status}` : ''}`);
  const selected = (list.data || []).find((u) => u._id === sc.id);
  if (sc.name === 'status') return selected ? <CustomerStatus customer={selected} onClose={() => { list.reload(); sc.close(); }} /> : <Screen title="Customer" onClose={sc.close}><p className="muted">{list.loading ? 'Loading…' : 'Customer not found.'}</p></Screen>;
  return <><PageHead title="Customer accounts" sub="Search customers and manage the blacklist" />
    <form className="chips" onSubmit={(e) => e.preventDefault()}><input className="list-search" style={{ marginBottom: 0 }} aria-label="Search customers" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, username or email" /><select aria-label="Customer status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Blacklisted</option></select></form>
    <Notice error={list.error} />
    <DataTable cols={['Name', 'Username', 'Email', 'Phone', 'Status', '']} rows={(list.data || []).map((u) => [u.customerProfile?.fullName || '—', u.username, u.email, u.phone || '—', u.status, <button key={u._id} className={`btn sm${u.status === 'active' ? ' danger' : ''}`} onClick={() => sc.go('status', u._id)}>{u.status === 'active' ? 'Blacklist' : 'Restore'}</button>])} />
  </>;
}

function CustomerStatus({ customer, onClose }) {
  const [reason, setReason] = useState(''); const [error, setError] = useState(null); const [saving, setSaving] = useState(false); const blacklisting = customer.status === 'active';
  const submit = async (e) => { e.preventDefault(); setSaving(true); setError(null); try { await api(`/customers/${customer._id}/blacklist`, { method: 'PATCH', body: { action: blacklisting ? 'blacklist' : 'restore', reason } }); onClose(); } catch (x) { setError(x); } finally { setSaving(false); } };
  return <Screen title={blacklisting ? 'Blacklist customer' : 'Restore customer'} onClose={onClose}><form className="form" onSubmit={submit}><p className="full muted">{customer.customerProfile?.fullName || customer.username}</p><Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} required /></Field><div className="full"><Notice error={error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : blacklisting ? 'Blacklist customer' : 'Restore customer'}</button></div></form></Screen>;
}

// Chia khoản còn thiếu qua tiền mặt, POS và chuyển khoản tại quầy.
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
    <Field label={`Amount (VND) · ${money(Number(amount) || 0)}`} error={error?.fields?.amount}><input key={balance} name="amount" type="number" min="1" max={balance} step="1" defaultValue={balance} onChange={(e) => setAmount(e.target.value)} required /></Field>
    {method === 'cash' && <Field label="Cash received from guest (optional)"><input type="number" min="0" step="1000" value={received} onChange={(e) => setReceived(e.target.value)} /></Field>}
    {method === 'cash' && received !== '' && <p className="full" role="status">{change >= 0 ? <>Change to give back: <strong>{money(change)}</strong></> : <>Still short by <strong>{money(-change)}</strong></>}</p>}
    {method !== 'cash' && <Field label="Transaction reference" error={error?.fields?.transactionRef}><input name="transactionRef" required maxLength={100} /></Field>}
    <div className="full"><Notice error={error} /></div>
    <div className="full pay-row"><button className="btn primary" disabled={saving}>{saving ? 'Recording…' : 'Record payment'}</button></div>
  </form>;
}

const FEE_LABEL = { early_check_in: 'Early check-in fee', late_check_out: 'Late check-out fee', extra_night: 'Extra night (after 18:00)' };
// Tính phí trả muộn và yêu cầu kiểm tra phòng; chỉ trả phòng khi đủ tiền và đã xử lý kiểm tra.
function CheckOutBooking({ booking, onClose }) {
  const [bill, setBill] = useState(null); const [error, setError] = useState(null); const [saving, setSaving] = useState(false); const [skip, setSkip] = useState(false); const [done, setDone] = useState(null);
  const load = () => api(`/front-desk/bookings/${booking._id}/check-out/start`, { method: 'POST' }).then((r) => setBill(r.data)).catch(setError);
  useEffect(() => { load(); }, [booking._id]);
  const submit = async (e) => {
    e.preventDefault(); if (!window.confirm(`Are you sure you want to complete the check-out of ${booking.bookingReference}?`)) return;
    setSaving(true); setError(null);
    try { const r = await api(`/front-desk/bookings/${booking._id}/check-out`, { method: 'POST', body: skip ? { skipInspection: true } : {} }); setDone(r); }
    catch (x) { setError(x); load(); } finally { setSaving(false); }
  };
  if (done) return <Screen title={`Checked out · ${booking.bookingReference}`} onClose={onClose}>
    <Notice ok={done.message} error={done.warning} />
    {done.data.invoice && <p>Invoice <strong>{done.data.invoice.invoiceNumber}</strong> · {money(done.data.invoice.totalAmount)}. Print it from Invoices.</p>}
    <div className="modal-actions"><button className="btn primary" onClick={onClose}>Close</button></div>
  </Screen>;
  if (!bill) return <Screen title="Check out customer" onClose={onClose}>{error ? <Notice error={error} /> : <p className="muted">Requesting the room inspection and preparing the final bill…</p>}</Screen>;
  const inspected = bill.inspection?.status === 'completed';
  return <Screen title={`Check out · ${booking.bookingReference}`} onClose={onClose}>
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
  </Screen>;
}

// Ghi nhận, giảm hoặc miễn khoản bồi thường do housekeeping đề xuất.
function Penalties({ booking, onClose }) {
  const after = booking.status === 'checked_out'; const bill = useApi(`/bookings/${booking._id}`, after);
  const list = useApi(`/frontdesk/bookings/${booking._id}/penalties`); const catalog = useApi('/frontdesk/compensation-items'); const [pick, setPick] = useState(''); const [qty, setQty] = useState(1); const [amt, setAmt] = useState(''); const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const act = async (path, method, body) => { setSaving(true); setError(null); try { await api(path, { method, body }); list.reload(); if (after) bill.reload(); return true; } catch (x) { setError(x); return false; } finally { setSaving(false); } };
  const submit = async (e) => { e.preventDefault(); const form = e.target; const f = Object.fromEntries(new FormData(form)); if (await act(`/frontdesk/bookings/${booking._id}/penalties`, 'POST', { itemName: pick && pick !== 'other' ? `${(catalog.data || []).find((i) => i._id === pick)?.name}${Number(qty) > 1 ? ` x${qty}` : ''}` : f.itemName, amount: Number(amt), description: f.description || undefined })) form.reset(); setPick(''); setQty(1); setAmt(''); };
  const confirm = (p) => { const value = window.prompt(`Confirmed amount (at most ${p.proposedAmount})`, p.proposedAmount); if (value !== null) act(`/frontdesk/penalties/${p._id}`, 'PATCH', { action: 'confirm', amount: Number(value) }); };
  const waive = (p) => { const reason = window.prompt('Reason for waiving this penalty'); if (reason) act(`/frontdesk/penalties/${p._id}`, 'PATCH', { action: 'waive', reason }); };
  return <Screen title={`Penalties · ${booking.bookingReference}`} onClose={onClose}>
    {list.loading ? <p className="muted">Loading penalties…</p> : !(list.data || []).length ? <p className="muted">No damage or loss recorded for this booking yet.</p> : <DataTable cols={['Item', 'Proposed', 'Charged', 'Status', '']} rows={(list.data || []).map((p) => [p.itemName + (p.afterCheckout ? ' (after check-out)' : ''), money(p.proposedAmount), p.amount == null ? '—' : money(p.amount), p.status, ['proposed', 'confirmed'].includes(p.status) ? <span className="row-actions">{p.status === 'proposed' && <button className="btn sm" disabled={saving} onClick={() => confirm(p)}>Confirm</button>}<button className="btn sm danger" disabled={saving} onClick={() => waive(p)}>Waive</button></span> : p.waivedReason || ''])} />}
    {after && bill.data && bill.data.totalAmount - (bill.data.paidAmount || 0) > 0 && <>
      <p><strong>Guest owes {money(bill.data.totalAmount - (bill.data.paidAmount || 0))} after check-out.</strong> Record the payment when it arrives; a supplementary invoice is issued.</p>
      <SettleBalance booking={booking} balance={bill.data.totalAmount - (bill.data.paidAmount || 0)} onPaid={() => { bill.reload(); list.reload(); }} />
    </>}
    <form className="form" onSubmit={submit}>
      <Field label="Damaged / lost item"><select value={pick} required onChange={(e) => { setPick(e.target.value); const it = (catalog.data || []).find((i) => i._id === e.target.value); setAmt(it ? String(it.price * qty) : ''); }}><option value="">Select an item…</option>{(catalog.data || []).map((i) => <option key={i._id} value={i._id}>{i.name} · {money(i.price)}</option>)}<option value="other">Other (describe)</option></select></Field>
      {pick === 'other' && <Field label="Item description"><input name="itemName" required maxLength={120} /></Field>}
      {pick && pick !== 'other' && <Field label="Quantity"><input type="number" min="1" step="1" value={qty} onChange={(e) => { setQty(e.target.value); const it = (catalog.data || []).find((i) => i._id === pick); if (it) setAmt(String(it.price * Number(e.target.value || 0))); }} /></Field>}
      <Field label={`Amount (VND)${amt ? ` · ${money(Number(amt) || 0)}` : ''}`}><input type="number" min="1" step="1" required value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
      <Field label="Description"><input name="description" maxLength={500} /></Field>
      <div className="full"><Notice error={list.error || error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Record penalty'}</button></div>
    </form>
  </Screen>;
}

function AddService({ booking, onClose }) {
  const services = useApi('/front-desk/services'); const detail = useApi(`/bookings/${booking._id}`); const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const submit = async (e) => { e.preventDefault(); setSaving(true); setError(null); const f = Object.fromEntries(new FormData(e.target)); try { await api(`/front-desk/bookings/${booking._id}/services`, { method: 'POST', body: { ...f, quantity: Number(f.quantity) } }); onClose(); } catch (x) { setError(x); } finally { setSaving(false); } };
  const voidLine = async (line) => { const reason = window.prompt(`Reason for voiding ${line.name}:`); if (!reason) return; try { await api(`/front-desk/bookings/${booking._id}/services/${line._id}/void`, { method: 'POST', body: { reason } }); detail.reload(); } catch (x) { setError(x); } };
  return <Screen title={`Add service · ${booking.bookingReference}`} onClose={onClose}><form className="form" onSubmit={submit}>
    <Field label="Service"><select name="serviceId" required disabled={services.loading}><option value="">Select a service</option>{services.data?.map((s) => <option key={s._id} value={s._id}>{s.name} · {money(s.unitPrice)}</option>)}</select></Field>
    <Field label="Quantity"><input name="quantity" type="number" min="1" max="100" defaultValue="1" required /></Field>
    <div className="full"><Notice error={services.error || detail.error || error} /></div>
    <div className="full">{detail.data?.services?.length > 0 && <DataTable cols={['Recorded service', 'Amount', 'Status', '']} rows={detail.data.services.map((line) => [line.name, money(line.amount), line.status || 'active', line.status !== 'voided' ? <button type="button" className="btn sm danger" onClick={() => voidLine(line)}>Void</button> : ''])} />}</div>
    <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving || services.loading}>{saving ? 'Adding…' : 'Add service'}</button></div>
  </form></Screen>;
}

// Đổi phòng theo tình trạng trống; nâng hạng có thu phí, hạ hạng cần khách đồng ý khi hết lựa chọn tốt hơn.
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
  return <Screen title={`${byType ? 'Change room type' : 'Change room'} · ${booking.bookingReference}`} onClose={onClose}><form className="form" onSubmit={submit}>
    <p className="full muted">{byType ? 'Before check-in the room type changes for the whole stay; the deposit does not change. The room itself is chosen at check-in.' : 'The remaining nights are charged at the new room type; the old room goes to cleaning.'}</p>
    {options.meta?.onlyLower && <p className="full note">No room of the booked or a higher-priced type is free: only lower-priced types are offered.</p>}
    <Field label={byType ? 'Available room type' : 'Available room'}><select value={pick} onChange={(e) => setPick(e.target.value)} required disabled={options.loading}><option value="">{byType ? 'Select a room type' : 'Select a room'}</option>{options.data?.map((o) => <option key={o._id} value={o._id}>{byType ? o.roomType.name : `Room ${o.roomNumber} · ${o.roomType?.name}`}{diff(o)}</option>)}</select></Field>
    {chosen?.lower && <label className="check full"><input type="checkbox" checked={agrees} onChange={(e) => setAgrees(e.target.checked)} required /> The guest agrees to the lower-priced room type</label>}
    {byType && booking.couponCode && <label className="check full"><input type="checkbox" checked={dropCoupon} onChange={(e) => setDropCoupon(e.target.checked)} /> If the coupon {booking.couponCode} no longer applies, the guest agrees to continue without the discount</label>}
    <div className="full"><Notice error={options.error || error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving || options.loading || !options.data?.length}>{saving ? 'Saving…' : 'Confirm change'}</button></div>
  </form></Screen>;
}

// Điền sẵn thông tin đã duyệt để đối chiếu giấy tờ khi nhận phòng.
function CheckInBooking({ booking, onClose }) {
  const rooms = useApi(`/front-desk/bookings/${booking._id}/available-rooms`); const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const pre = rooms.meta?.request;
  const submit = async (e) => { e.preventDefault(); setSaving(true); setError(null); const f = Object.fromEntries(new FormData(e.target)); try { await api(`/front-desk/bookings/${booking._id}/check-in`, { method: 'POST', body: { ...f, guestCount: Number(f.guestCount) } }); onClose(); } catch (x) { setError(x); } finally { setSaving(false); } };
  if (rooms.loading) return <Screen title={`Check in ${booking.bookingReference}`} onClose={onClose}><p className="muted">Loading rooms…</p></Screen>;
  return <Screen title={`Check in ${booking.bookingReference}`} onClose={onClose}><form className="form" onSubmit={submit}>
    {pre && <p className="full note">Pre-filled from the guest's check-in request: verify it against the original ID document. {pre.hasIdPhoto && <IdPhotoLink requestId={pre._id} />}</p>}
    <Field label="Available room"><select name="roomId" required><option value="">Select a room</option>{rooms.data?.map((r) => <option key={r._id} value={r._id}>Room {r.roomNumber} · Floor {r.floor}</option>)}</select></Field>
    <Field label="Number of guests"><input name="guestCount" type="number" min="1" defaultValue={pre?.guestCount || booking.rooms?.[0]?.guestCount || 1} required /></Field><Field label="ID / passport number"><input name="idDocumentNo" defaultValue={pre?.idDocumentNo || ''} required /></Field>
    <div className="full"><Notice error={rooms.error || error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving || !rooms.data?.length}>{saving ? 'Checking in…' : 'Confirm check-in'}</button></div>
  </form></Screen>;
}

// Xác minh giấy tờ tại quầy; thu thập tài khoản ngân hàng ở bước hoàn tiền.
function CancelBooking({ booking, onClose }) {
  const [error, setError] = useState(null); const [saving, setSaving] = useState(false); const [hotel, setHotel] = useState(false); const [done, setDone] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); if (!window.confirm(`Are you sure you want to cancel ${booking.bookingReference}?`)) return;
    setSaving(true); setError(null); const f = Object.fromEntries(new FormData(e.target));
    try { setDone((await api(`/front-desk/bookings/${booking._id}/cancel`, { method: 'POST', body: hotel ? { hotelCaused: true, ...(f.reason ? { reason: f.reason } : {}) } : { reason: f.reason } })).message); }
    catch (x) { setError(x); } finally { setSaving(false); }
  };
  if (done) return <Screen title={`Cancel ${booking.bookingReference}`} onClose={onClose}><Notice ok={done} /><p className="muted">A paid deposit is reviewed in Cancellations; a refund is then handled in Refunds, where the customer's bank account is entered.</p><div className="modal-actions"><button className="btn primary" onClick={onClose}>Close</button></div></Screen>;
  return <Screen title={`Cancel ${booking.bookingReference}`} onClose={onClose}><form className="form" onSubmit={submit}>
    <p className="full muted">Check that the ID document matches the name of the person who made the booking. For a request by phone use Cancellations (code sent by e-mail).</p>
    <label className="check full"><input type="checkbox" checked={hotel} onChange={(e) => setHotel(e.target.checked)} /> The hotel cannot provide the room (100% refund, approved at once)</label>
    <Field label={hotel ? 'Reason (optional)' : 'Cancellation reason'}><input name="reason" required={!hotel} maxLength={500} /></Field>
    <div className="full"><Notice error={error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Confirm cancellation'}</button></div>
  </form></Screen>;
}

function EditBooking({ booking, onClose }) {
  const detail = useApi(`/bookings/${booking._id}`); const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  if (detail.loading) return <Screen title="Modify booking" onClose={onClose}><p className="muted">Loading booking…</p></Screen>;
  const b = detail.data || booking; const checkedOut = b.status === 'checked_out';
  const submit = async (e) => { e.preventDefault(); setSaving(true); setError(null); const f = Object.fromEntries(new FormData(e.target)); try { await api(`/front-desk/bookings/${b._id}`, { method: 'PATCH', body: { fullName: f.fullName, phone: f.phone, ...(f.idDocumentNo ? { idDocumentNo: f.idDocumentNo } : {}), ...(checkedOut ? {} : { ...(b.status === 'checked_in' ? {} : { checkInDate: f.checkInDate }), checkOutDate: f.checkOutDate, guestCount: Number(f.guestCount) }), ...(f.dropCoupon ? { dropCoupon: true } : {}) } }); onClose(); } catch (x) { setError(x); } finally { setSaving(false); } };
  return <Screen title={b.status === 'checked_in' ? 'Extend or edit stay' : 'Modify booking'} onClose={onClose}><form className="form" onSubmit={submit}>
    {!checkedOut && <p className="full muted">{b.status === 'checked_in' ? 'Extra nights are priced at the rate of each night and need no deposit.' : 'The deposit already paid does not change; the difference is paid at check-out.'}</p>}
    {!checkedOut && b.couponCode && <label className="check full"><input type="checkbox" name="dropCoupon" /> If the coupon {b.couponCode} no longer applies to the new stay, the guest agrees to continue without the discount</label>}
    <Field label="Guest full name"><input name="fullName" defaultValue={b.guestName} required /></Field><Field label="Phone"><input name="phone" defaultValue={b.guestPhone} required /></Field>{['checked_in', 'checked_out'].includes(b.status) && <Field label="ID / passport number"><input name="idDocumentNo" defaultValue={b.guestIdDocumentNo} required /></Field>}
    {!checkedOut && <><Field label="Check-in"><input name="checkInDate" type="date" defaultValue={b.checkInDate?.slice(0, 10)} required disabled={b.status === 'checked_in'} /></Field><Field label="Check-out"><input name="checkOutDate" type="date" defaultValue={b.checkOutDate?.slice(0, 10)} required /></Field><Field label="Guests"><input name="guestCount" type="number" min="1" defaultValue={b.rooms?.[0]?.guestCount || 1} required /></Field></>}
    <div className="full"><Notice error={detail.error || error} /></div><div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
  </form></Screen>;
}

// Đặt phòng tại quầy bắt đầu hôm nay; chỉ chọn loại còn trống suốt kỳ lưu trú rồi chuyển sang nhận phòng.
function WalkInBooking({ onClose, onCreated }) {
  const today = vnDay(0);
  const [stay, setStay] = useState({ checkOutDate: vnDay(1), guestCount: '1', roomTypeId: '' }); const [coupon, setCoupon] = useState('');
  const set = (k) => (e) => setStay({ ...stay, [k]: e.target.value });
  const valid = stay.checkOutDate > today && +stay.guestCount >= 1;
  const types = useApi(`/public/availability?${new URLSearchParams({ checkIn: today, checkOut: stay.checkOutDate, guests: stay.guestCount })}`, valid);
  const [quote, setQuote] = useState(null);
  useEffect(() => {
    setQuote(null);
    if (!stay.roomTypeId || !valid) return undefined;
    let live = true;
    api('/bookings/quote', { method: 'POST', body: { roomTypeId: stay.roomTypeId, checkInDate: today, checkOutDate: stay.checkOutDate, ...(coupon ? { couponCode: coupon } : {}) } })
      .then((r) => live && setQuote(r.data)).catch(() => {});
    return () => { live = false; };
  }, [stay.roomTypeId, stay.checkOutDate, coupon]);
  const [error, setError] = useState(null); const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setSaving(true); setError(null);
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const made = await api('/front-desk/bookings', { method: 'POST', body: { roomTypeId: stay.roomTypeId, checkInDate: today, checkOutDate: stay.checkOutDate, guestCount: Number(stay.guestCount), fullName: f.fullName, phone: f.phone, idDocumentNo: f.idDocumentNo, ...(f.email ? { email: f.email } : {}), ...(coupon && !quote?.couponError ? { couponCode: coupon } : {}) } });
      onCreated(made.data);
    } catch (x) { setError(x); } finally { setSaving(false); }
  };
  return <Screen title="Create walk-in booking" onClose={onClose}>
    <form className="form" onSubmit={submit}>
      <p className="full muted">Walk-in booking for tonight ({dateLabel(today)}) · no deposit · the check-in opens after it is created</p>
      <Field label="Check-out"><input type="date" min={vnDay(1)} value={stay.checkOutDate} onChange={set('checkOutDate')} required /></Field>
      <Field label="Guests"><input type="number" min="1" max="20" value={stay.guestCount} onChange={set('guestCount')} required /></Field>
      <Field label="Available room type"><select value={stay.roomTypeId} onChange={set('roomTypeId')} required disabled={types.loading}><option value="">{types.data && !types.data.length ? 'No room type is available' : 'Select a room type'}</option>{types.data?.map((t) => <option key={t._id} value={t._id}>{t.name} · {money(t.stayAmount)} · {t.roomsLeft} left</option>)}</select></Field>
      <Field label="Coupon code (optional)"><input onBlur={(e) => setCoupon(e.target.value.trim().toUpperCase())} autoCapitalize="characters" /></Field>
      {quote && <p className="full note">{quote.couponError ? `${quote.couponError} The booking continues without the discount. ` : ''}Total {money(quote.totalAmount)}{quote.discountAmount > 0 ? ` (discount ${money(quote.discountAmount)})` : ''}, paid at check-out.</p>}
      <Field label="Guest full name"><input name="fullName" required /></Field>
      <Field label="Phone"><input name="phone" inputMode="tel" required /></Field>
      <Field label="Email (optional)"><input name="email" type="email" /></Field>
      <Field label="ID / passport number"><input name="idDocumentNo" required /></Field>
      <div className="full"><Notice error={types.error || error} /></div>
      <div className="full modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving || types.loading || !stay.roomTypeId}>{saving ? 'Creating…' : 'Create booking and check in'}</button></div>
    </form>
  </Screen>;
}

const METHOD = { cash: 'Cash', pos: 'Card (POS)', credit_card: 'Card', e_wallet: 'E-wallet', bank_transfer: 'Bank transfer' };
const STAMP = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '—');

function Payments() {
  const [status, setStatus] = useState('');
  const list = useApi(`/frontdesk/payments${status ? `?status=${status}` : ''}`);
  const rows = list.data || [];
  // Cọc đã hoàn không còn được tính vào số tiền đang giữ.
  const received = rows.filter((p) => p.status === 'success').reduce((a, p) => a + p.amount, 0);
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
  '#/admin/coupons': Coupons,
  '#/admin/revenue': Revenue,
  '#/admin/occupancy': Occupancy,
  '#/admin/notifications': () => <NotificationsPage bookingHref="#/admin/bookings" />,
  '#/admin/profile': () => <Profile base="#/admin/profile" />,
  '#/admin/profile/password': () => <ChangePassword base="#/admin/profile" />,
  '#/admin/bookings': Bookings,
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


export default function Admin({ route: fullRoute }) {
  const route = fullRoute.split('?')[0];
  const { user, loading } = useAuth();
  const [drawer, setDrawer] = useState(false);
  if (loading) return <p className="muted center-msg">Loading…</p>;
  if (route === '#/admin/login') return <Login />;
  if (!user || user.scope === 'self') { if (location.hash !== '#/admin/login') location.hash = '#/admin/login'; return null; }
  // Dùng chung quy tắc cho menu và chặn truy cập trang; trang cá nhân mở cho mọi nhân viên.
  const rule = MENU.flatMap((g) => g.items || []).find((item) => item[0] === route);
  const denied = rule && !allowed(rule, user.permissions, user.role);
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
