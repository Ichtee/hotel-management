import { useEffect, useRef, useState } from 'react';
import { BOOKINGS, MENU, ROOMS, TABLES } from './data.js';
import './admin.css';
import { useAuth } from './context/Auth.jsx';
import { Badge, DataTable, LineChart, PageHead, useApi } from './ui.jsx';
import { AuthShell, SignIn } from './AuthForms.jsx';
import { Coupons, Profile, Revenue, Roles, Users } from './AdminPages.jsx';
import { money } from './api/client.js';

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
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z'
};
const SECTION_ICON = { 'Front desk': 'calendar', Rooms: 'bed', Housekeeping: 'sparkle', Billing: 'card', 'Guests & staff': 'users', Settings: 'gear' };
const Icon = ({ n, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[n]} /></svg>
);

const allowed = (item, perms) => !item[3] || item[3].some((p) => perms.includes(p));

function Sidebar({ route, open, onClose }) {
  const { user } = useAuth();
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
          {MENU.filter((m) => m.items).map((m) => ({ ...m, items: m.items.filter((i) => allowed(i, user.permissions)) })).filter((m) => m.items.length).map((m) => (
            <div className="grp" key={m.label}>
              <p>{m.label}</p>
              {m.items.map(([h, l]) => link(h, l, null))}
            </div>
          ))}
        </div>
        <a className="site-link" href="#/"><Icon n="globe" /> View website</a>
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
      <label className="asearch"><Icon n="search" size={16} /><input type="search" placeholder="Search bookings, guests, rooms…" aria-label="Search" /></label>
      <button className="ibtn bell" aria-label="Notifications, 3 unread"><Icon n="bell" /><i>3</i></button>
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

const TablePage = ({ id }) => {
  const t = TABLES[id];
  return <><PageHead title={t.title} sub={t.sub} action={t.action} /><DataTable cols={t.cols} rows={t.rows} /></>;
};

/* ---------- Dashboard charts (inline SVG, reference-palette blue + muted comparison) ---------- */
const DAYS = ['29 Sep', '30 Sep', '1 Oct', '2 Oct', '3 Oct', '4 Oct', '5 Oct', '6 Oct', '7 Oct', '8 Oct', '9 Oct', '10 Oct', '11 Oct', '12 Oct'];
const CUR = [3200, 3550, 3100, 4100, 4400, 5200, 5600, 4300, 4600, 4000, 4900, 5300, 5900, 4860];
const PREV = [2900, 3000, 3300, 3500, 3800, 4300, 4900, 3900, 4100, 3700, 4200, 4600, 5000, 4400];
const fmt = (n) => `$${n.toLocaleString('en-US')}`;

function Sparkline({ data }) {
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 24}`).join(' ');
  return <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} fill="none" stroke="var(--series-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}

function Kpi({ label, value, delta, up, data, cmp = 'vs last week' }) {
  return (
    <div className="kpi">
      <p>{label}</p>
      <strong>{value}</strong>
      <small className={up ? 'up' : 'down'}>{up ? '▲' : '▼'} {delta} <span>{cmp}</span></small>
      <Sparkline data={data} />
    </div>
  );
}

const TYPE_OCC = [['Deluxe Double', 86], ['Superior Twin', 72], ['Family Suite', 64], ['Presidential Suite', 40]];
const ACTIVITY = [
  ['Tran Binh checked in', 'Room 512 · 10 min ago'], ['Payment received $75', 'BK-1042 · 32 min ago'],
  ['Room 305 marked dirty', 'by Mai · 1 h ago'], ['Cancellation request', 'BK-1029 · 2 h ago'], ['New review (5★)', 'Nguyen An · 3 h ago']
];
const STATUSES = [['available', 'Available'], ['occupied', 'Occupied'], ['dirty', 'Dirty'], ['maintenance', 'Maintenance']];

const vnDay = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + offset * 864e5));
const shortDate = (iso) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Ho_Chi_Minh' });

function Dashboard() {
  const { user } = useAuth();
  const name = user.customerProfile?.fullName?.split(' ').pop() || user.username;
  const canRev = user.permissions.includes('revenue.read');
  const rev = useApi(`/reports/revenue?from=${vnDay(-27)}&to=${vnDay(0)}&groupBy=day`, canRev);
  const series = rev.data?.series || [];
  const real = canRev && series.length === 28 ? { cur: series.slice(14).map((r) => r.net), prev: series.slice(0, 14).map((r) => r.net), labels: series.slice(14).map((r) => shortDate(r.date)) } : null;
  const sample = { cur: CUR, prev: PREV, labels: DAYS };
  const chart = real || sample;
  const fmtMoney = real ? money : fmt;
  const total = chart.cur.reduce((a, b) => a + b, 0);
  const last = chart.cur[chart.cur.length - 1], before = chart.cur[chart.cur.length - 2];
  const pct = before ? Math.round(((last - before) / before) * 100) : 0;
  const count = (s) => ROOMS.filter((r) => r.status === s).length;
  return (
    <>
      <PageHead title={`Hello, ${name}`} sub={`${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${user.roleName}`} action="New booking" extra={<button className="btn">Export report</button>} />
      <div className="kpis">
        <Kpi label="Occupancy" value="78%" delta="4%" up data={[70, 72, 68, 74, 75, 73, 78]} />
        <Kpi label="Revenue today" value={fmtMoney(last)} delta={`${Math.abs(pct)}%`} up={pct >= 0} data={chart.cur.slice(-7)} cmp="vs yesterday" />
        <Kpi label="Arrivals / Departures" value="12 / 9" delta="2" up data={[8, 10, 9, 11, 12, 10, 12]} />
        <Kpi label="Cancellations" value="3" delta="1" up={false} data={[1, 2, 1, 0, 2, 4, 3]} />
      </div>

      <div className="dgrid">
        <section className="panel span2">
          <div className="phead"><h2>Revenue</h2><span className="muted">{real ? 'Last 14 days' : 'Sample data · last 14 days'} · <b>{fmtMoney(total)}</b></span></div>
          {canRev && rev.loading ? <p className="muted">Loading…</p> : <LineChart labels={chart.labels} cur={chart.cur} prev={chart.prev} format={fmtMoney} summary={`Daily revenue for the last 14 days, total ${fmtMoney(total)}`} />}
        </section>
        <section className="panel">
          <div className="phead"><h2>Room status</h2><span className="muted">{ROOMS.length} rooms</span></div>
          <div className="stack-bar" role="img" aria-label={STATUSES.map(([s, l]) => `${l} ${count(s)}`).join(', ')}>
            {STATUSES.map(([s]) => count(s) > 0 && <span key={s} className={`s-${s}`} style={{ flex: count(s) }} />)}
          </div>
          <ul className="rs-list">
            {STATUSES.map(([s, l]) => <li key={s}><i className={`s-${s}`} />{l}<b>{count(s)}</b></li>)}
          </ul>
          <a className="more" href="#/admin/rooms">Open room map →</a>
        </section>

        <section className="panel span2">
          <div className="phead"><h2>Today’s arrivals</h2><a className="more" href="#/admin/frontdesk">Front desk →</a></div>
          <DataTable cols={['Code', 'Guest', 'Room', 'Type', 'Status']} rows={BOOKINGS.slice(0, 5).map((b) => [b.code, b.guest, b.room, b.type, b.status])} />
        </section>
        <section className="panel">
          <div className="phead"><h2>Occupancy by room type</h2></div>
          <ul className="hbars">
            {TYPE_OCC.map(([n, v]) => (
              <li key={n}>
                <div className="between"><span>{n}</span><b>{v}%</b></div>
                <div className="track"><div className="fillb" style={{ width: `${v}%` }} /></div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel span2">
          <div className="phead"><h2>Housekeeping progress</h2><span className="muted">7 of 12 tasks done</span></div>
          <div className="track big"><div className="fillb" style={{ width: '58%' }} /></div>
          <div className="mini-stats">
            <div><b>7</b><span>Done</span></div><div><b>3</b><span>In progress</span></div><div><b>2</b><span>Pending</span></div><div><b>2</b><span>Open issues</span></div>
          </div>
        </section>
        <section className="panel">
          <div className="phead"><h2>Recent activity</h2></div>
          <ul className="feed">
            {ACTIVITY.map(([t, s]) => <li key={t}><b>{t}</b><span>{s}</span></li>)}
          </ul>
        </section>
      </div>
    </>
  );
}

function Bookings() {
  const [f, setF] = useState('all');
  const rows = BOOKINGS.filter((b) => f === 'all' || b.status === f);
  return (
    <>
      <PageHead title="Bookings" sub="All reservations" action="New booking" />
      <div className="chips" role="group" aria-label="Filter by status">
        {['all', 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'].map((s) => (
          <button key={s} className={f === s ? 'chip on' : 'chip'} aria-pressed={f === s} onClick={() => setF(s)}>{s.replace('_', ' ')}</button>
        ))}
      </div>
      <DataTable cols={['Code', 'Guest', 'Room', 'Type', 'Check-in', 'Check-out', 'Total', 'Status']} rows={rows.map((b) => [b.code, b.guest, b.room, b.type, b.inD, b.outD, b.total, b.status])} />
    </>
  );
}

function FrontDesk() {
  const list = (status, label) => BOOKINGS.filter((b) => b.status === status).map((b) => (
    <li key={b.code}><div><strong>{b.guest}</strong><small>{b.code} · Room {b.room}</small></div><button className="btn">{label}</button></li>
  ));
  return (
    <>
      <PageHead title="Check-in / Check-out" sub="Today’s front desk queue" />
      <div className="two">
        <section className="panel"><h2>Arrivals</h2><ul className="queue">{list('confirmed', 'Check in')}{list('pending', 'Check in')}</ul></section>
        <section className="panel"><h2>Departures</h2><ul className="queue">{list('checked_in', 'Check out')}</ul></section>
      </div>
    </>
  );
}

function RoomMap() {
  const floors = [...new Set(ROOMS.map((r) => r.no[0]))];
  return (
    <>
      <PageHead title="Room map" sub="Live status by floor" action="Add room" />
      <div className="legend">{STATUSES.map(([s, l]) => <span key={s}><i className={`s-${s}`} />{l}</span>)}</div>
      {floors.map((fl) => (
        <section key={fl} className="floor">
          <h2>Floor {fl}</h2>
          <div className="rooms">
            {ROOMS.filter((r) => r.no[0] === fl).map((r) => (
              <button key={r.no} className={`room s-${r.status}`} aria-label={`Room ${r.no}, ${r.status}`}><b>{r.no}</b><small>{r.status}</small></button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function Hotel() {
  return (
    <>
      <PageHead title="Hotel & policies" sub="Property details and booking rules" />
      <form className="panel form" onSubmit={(e) => e.preventDefault()}>
        <label>Hotel name<input defaultValue="GrandStay Da Nang" /></label>
        <label>City<input defaultValue="Da Nang" /></label>
        <label>Address<input defaultValue="1 Vo Nguyen Giap" /></label>
        <label>Star rating<select defaultValue="5">{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
        <label>Check-in time<input type="time" defaultValue="14:00" /></label>
        <label>Check-out time<input type="time" defaultValue="12:00" /></label>
        <label>Free cancellation (hours before)<input type="number" defaultValue="48" min="0" /></label>
        <label>Deposit (%)<input type="number" defaultValue="20" min="0" max="100" /></label>
        <button className="btn primary" type="submit">Save changes</button>
      </form>
    </>
  );
}

function Login() {
  const { user, signOut } = useAuth();
  if (user && user.scope !== 'self') { location.hash = '#/admin'; return null; }
  return (
    <AuthShell staff>
      <h1>Staff sign in</h1>
      <p className="muted">Use your hotel account to continue.</p>
      {user && <p className="note bad-note">You are signed in as a customer ({user.email}). <button className="linklike" onClick={signOut}>Sign out</button> to use a staff account.</p>}
      <SignIn onDone={() => { location.hash = '#/admin'; }} hint={<a className="more" href="#/">← Back to website</a>} />
    </AuthShell>
  );
}

const PAGES = { '#/admin': Dashboard, '#/admin/users': Users, '#/admin/staff': Users, '#/admin/roles': Roles, '#/admin/coupons': Coupons, '#/admin/revenue': Revenue, '#/admin/profile': Profile, '#/admin/bookings': Bookings, '#/admin/frontdesk': FrontDesk, '#/admin/rooms': RoomMap, '#/admin/hotel': Hotel };

const Forbidden = () => <><PageHead title="No access" sub="Your role does not include this area." /><a className="btn" href="#/admin">Back to dashboard</a></>;

const NEEDS = { '#/admin/users': 'users.manage', '#/admin/staff': 'staff.manage', '#/admin/roles': 'roles.manage', '#/admin/coupons': 'promotions.manage', '#/admin/revenue': 'revenue.read' };

export default function Admin({ route }) {
  const { user, loading } = useAuth();
  const [drawer, setDrawer] = useState(false);
  if (loading) return <p className="muted center-msg">Loading…</p>;
  if (route === '#/admin/login') return <Login />;
  if (!user || user.scope === 'self') { if (location.hash !== '#/admin/login') location.hash = '#/admin/login'; return null; }
  const denied = NEEDS[route] && !user.permissions.includes(NEEDS[route]);
  const id = route.slice(8);
  const Page = denied ? Forbidden : PAGES[route] || (TABLES[id] ? () => <TablePage id={id} /> : Dashboard);
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
