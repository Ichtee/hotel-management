import { useEffect, useRef, useState } from 'react';
import { useAuth } from './context/Auth.jsx';
import { AuthShell, AuthTabs, SignIn, Register, ForgotPassword, Captcha } from './AuthForms.jsx';
import { Profile } from './AdminPages.jsx';
import { MyBookings } from './Bookings.jsx';
import { PaymentPage, PaymentResult, SandboxGateway } from './Payments.jsx';
import { api, money } from './api/client.js';
import './resort.css';
import NotificationBell from './Notifications.jsx';
import { Notice } from './ui.jsx';
import { LiveRooms as Rooms, LiveRoomDetail as RoomDetail, LiveCheckout as Checkout } from './LiveBooking.jsx';

const NAV = [
  { label: 'Home', href: '#/' },
  { label: 'Rooms', items: [['#/rooms', 'All rooms', 'Compare every room type'], ['#/rooms?cat=standard', 'Standard rooms', 'Deluxe & Superior'], ['#/rooms?cat=suite', 'Suites', 'Family & Presidential']] },
  { label: 'Offers', href: '#/offers' },
  { label: 'Help', items: [['#/offers', 'Booking policies', 'Deposit and cancellation']] }
];

const parse = (route) => {
  const [path, q = ''] = route.split('?');
  return [path, Object.fromEntries(new URLSearchParams(q))];
};
const route0 = (q) => `${q.in}${q.out}${q.guests}`;
const nightsBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 864e5)) : 0);
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const Stars = ({ n }) => <span className="stars" role="img" aria-label={`${n} out of 5`}>{'★'.repeat(Math.round(n))}{'☆'.repeat(5 - Math.round(n))}</span>;

function SiteHeader({ route }) {
  const { user, signOut } = useAuth();
  const staff = user && user.scope !== 'self';
  const [open, setOpen] = useState(null);
  const [mobile, setMobile] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(null); };
    addEventListener('click', close); addEventListener('keydown', close);
    return () => { removeEventListener('click', close); removeEventListener('keydown', close); };
  }, []);

  const done = () => { setOpen(null); setMobile(false); };
  const name = user?.customerProfile?.fullName || user?.username || '';

  return (
    <header className="topbar site" ref={ref}>
      <div className="bar">
        <a className="brand" href="#/">Grand<span>Stay</span></a>
        <button className="menu-btn" aria-expanded={mobile} aria-controls="nav" onClick={() => setMobile(!mobile)}>{mobile ? 'Close' : 'Menu'}</button>
        <nav id="nav" className={mobile ? 'open' : ''} aria-label="Main">
          <ul>
            {NAV.map((m, i) => m.items ? (
              <li className="dd" key={m.label}>
                <button aria-expanded={open === i} aria-haspopup="true" onClick={() => setOpen(open === i ? null : i)}>{m.label} <span className="caret" aria-hidden="true">▾</span></button>
                {open === i && (
                  <ul className="dd-menu">
                    {m.items.map(([h, l, s]) => <li key={l}><a href={h} onClick={done}><strong>{l}</strong>{s && <small>{s}</small>}</a></li>)}
                    {/* My trips dropdown sign out */ user && m.label === "My trips" && (
                      <li style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 4, paddingTop: 4 }}>
                        <button type="button" onClick={async () => { done(); await signOut(); location.hash = "#/"; }} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: ".5rem 1rem", color: "#ff6b6b", cursor: "pointer", fontSize: ".9rem", fontWeight: 600 }}>Sign out</button>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            ) : <li key={m.label}><a className={route.split('?')[0] === m.href ? 'active' : ''} href={m.href} onClick={done}>{m.label}</a></li>)}
          </ul>
          <div className="right">
            {user ? (
              <>
                <a className="btn gold" href="#/rooms" onClick={done}>Book now</a>
                <NotificationBell bookingHref="#/my-bookings" />
                <div className="dd account">
                  <button className="acct" aria-expanded={open === 'acct'} aria-haspopup="true" onClick={() => setOpen(open === 'acct' ? null : 'acct')}>
                    <span className="avatar" aria-hidden="true">{(name || 'U')[0].toUpperCase()}</span>
                    <span className="acct-name">{name}</span>
                    <span className="caret" aria-hidden="true">▾</span>
                  </button>
                  {open === 'acct' && (
                    <ul className="dd-menu end">
                      <li className="acct-head"><strong>{name}</strong><small>{user.email}</small></li>
                      <li><a href="#/my-bookings" onClick={done}><strong>My bookings</strong></a></li>
                      <li><a href="#/profile" onClick={done}><strong>My profile</strong></a></li>
                      {staff && <li><a href="#/admin" onClick={done}><strong>Staff portal</strong></a></li>}
                      <li><button className="signout" onClick={async () => { done(); await signOut(); location.hash = '#/'; }}>Sign out</button></li>
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <>
                <a className="signin" href="#/login" onClick={done}>Sign in</a>
                <a className="btn gold" href="#/rooms" onClick={done}>Book now</a>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}

function SearchBar({ q = {} }) {
  const hotel = useHotel();
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    location.hash = `#/rooms?${new URLSearchParams({ in: f.get('in'), out: f.get('out'), guests: f.get('guests') })}`;
  };
  return (
    <form className="c-search" onSubmit={submit}>
      <label>Destination<input value={hotel ? [hotel.name, hotel.city].filter(Boolean).join(' ') : ''} readOnly /></label>
      <label>Check-in<input name="in" type="date" min={day(0)} defaultValue={q.in || day(7)} required /></label>
      <label>Check-out<input name="out" type="date" min={day(1)} defaultValue={q.out || day(10)} required /></label>
      <label>Guests<select name="guests" defaultValue={q.guests || "2"}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></label>
      <button className="btn gold" type="submit">Search rooms</button>
    </form>
  );
}

function RoomCard({ r, q = '' }) {
  return (
    <article className="c-card">
      <a className="c-media" href={`#/room/${r.id}${q}`} tabIndex={-1} aria-hidden="true">
        <Pic src={r.img} alt="" loading="lazy" width="900" height="1125" />
        <span className="c-price">From <b>{money(r.price)}</b> / night</span>
      </a>
      <div className="c-body">
        <p className="kicker">{[r.bed, r.size && `${r.size} m²`, `Up to ${r.guests} guests`].filter(Boolean).join(' · ')}</p>
        <h3><a href={`#/room/${r.id}${q}`}>{r.name}</a></h3>
        {r.rating && <Stars n={r.rating} />}
        {r.amenities.length > 0 && <ul className="tags">{r.amenities.slice(0, 3).map((a) => <li key={a}>{a}</li>)}</ul>}
        <a className="more-link" href={`#/room/${r.id}${q}`}>View room <span aria-hidden="true">→</span></a>
      </div>
    </article>
  );
}

let hotelReq;
// The hotel's own name, city and contact details (Hotel & policies screen), fetched once.
function useHotel() {
  const [h, setH] = useState(null);
  useEffect(() => {
    hotelReq ??= api('/hotel-info').then((x) => x.data).catch(() => { hotelReq = null; return null; });
    hotelReq.then(setH);
  }, []);
  return h;
}
function usePromos() {
  const [list, setList] = useState([]);
  useEffect(() => { api('/public/promotions').then((x) => setList(x.data)).catch(() => {}); }, []);
  return list;
}
const Pic = ({ src, ...p }) => (src ? <img src={src} {...p} /> : <div className="img-ph" />);

function Home() {
  const perks = [
    ['Best price guarantee', 'Coupons and seasonal rates applied automatically.', 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z M7 7h.01'],
    ['Verified reviews', 'Only guests who stayed can review.', 'M12 2l3 6.3 6.9.9-5 4.8 1.2 6.9L12 17.5 5.9 20.9 7.1 14 2.1 9.2l6.9-.9z'],
    ['Secure payment', 'Pay a deposit online, the rest when you check out.', 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4']
  ];

  const hotel = useHotel();
  const promos = usePromos();
  const policy = usePolicies();
  const fullRefundHours = Math.max(...(policy?.cancellationTiers || []).filter((t) => t.refundPercent === 100).map((t) => t.minHoursBeforeCheckIn), -1);
  if (fullRefundHours >= 0) perks.splice(1, 0, ['Free cancellation', `Full deposit back when you cancel ${fullRefundHours ? `at least ${fullRefundHours} hours before check-in` : 'in time'}.`, 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 8v4l3 2']);
  const [featuredRooms, setFeaturedRooms] = useState([]);
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    roomTypeServiceFetch();
  }, []);

  const roomTypeServiceFetch = async () => {
    try {
      const res = await roomApi.getRoomTypes({ isActive: true });
      if (res.data && res.data.length > 0) {
        const mapped = res.data.slice(0, 3).map(toCard);
        setFeaturedRooms(mapped);
        const lists = await Promise.all(res.data.map((t) => api(`/public/room-types/${t._id}/reviews?limit=2`).then((x) => x.data.map((v) => ({ ...v, room: t.name }))).catch(() => [])));
        setReviews(lists.flat().slice(0, 3));
      }
    } catch {
      // Fallback
    }
  };

  return (
    <>
      <section className="c-hero">
        <div className="c-wrap hero-copy">
          {hotel && <p className="eyebrow">{[hotel.name, hotel.city].filter(Boolean).join(' · ')}</p>}
          <h1>Where the sea<br />meets stillness</h1>
          <p className="lead">Ocean-view rooms and suites, a quiet pool above the beach, and a team that takes care of the details.</p>
        </div>
        <div className="c-wrap"><SearchBar /></div>
      </section>

      <section className="c-wrap c-section intro">
        <div>
          <p className="eyebrow ink">Welcome</p>
          <h2 className="display">A five-star retreat{hotel?.city ? ` in ${hotel.city}` : ''}</h2>
          <p className="lead-ink">Wake up to the sound of the waves, spend the afternoon by the pool and end the day with dinner by the sea. Book online in a few minutes and manage your stay from your account.</p>
          <a className="more-link" href="#/rooms">Explore rooms &amp; suites <span aria-hidden="true">→</span></a>
        </div>
        <div className="intro-img" role="img" aria-label="Pool surrounded by palm trees" />
      </section>

      <section className="c-wrap c-section">
        <div className="sec-head">
          <div><p className="eyebrow ink">Stay</p><h2 className="display">Rooms &amp; suites</h2></div>
          <a className="more-link" href="#/rooms">View all rooms <span aria-hidden="true">→</span></a>
        </div>
        <div className="c-grid">{featuredRooms.map((r) => <RoomCard key={r.id} r={r} />)}</div>
      </section>

      {promos[0] && (
        <section className="band">
          <div className="c-wrap band-copy">
            <p className="eyebrow">Book direct</p>
            <h2 className="display light">Save {promos[0].discountValue}% when you book with us</h2>
            <p>{promos[0].discountValue}% off{promos[0].minimumSpend ? ` stays from ${money(promos[0].minimumSpend)}` : ' your stay'}, applied when you enter the code at checkout.</p>
            <div className="promo-actions">
              <a className="btn gold" href="#/rooms">Book your stay</a>
              <span className="promo-code">Code <b>{promos[0].code}</b></span>
            </div>
          </div>
        </section>
      )}

      <section className="c-wrap c-section perks">
        {perks.map(([t, d, p]) => (
          <div key={t}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p} /></svg>
            <h3>{t}</h3><p>{d}</p>
          </div>
        ))}
      </section>

      {reviews.length > 0 && <section className="reviews">
        <div className="c-wrap c-section">
          <p className="eyebrow ink center">Guest stories</p>
          <h2 className="display center">What our guests say</h2>
          <div className="quotes">{reviews.map((v) => <blockquote key={v._id}><Stars n={v.rating} /><p>“{v.comment || v.title}”</p><footer>Verified guest · {v.room}</footer></blockquote>)}</div>
        </div>
      </section>}
    </>
  );
}

function usePolicies() {
  const [p, setP] = useState(null);
  useEffect(() => { api('/public/policies').then((x) => setP(x.data)).catch(() => {}); }, []);
  return p;
}
const tierText = (t) => `${t.refundPercent}% of the deposit back when you cancel ${t.minHoursBeforeCheckIn ? `at least ${t.minHoursBeforeCheckIn} hours before check-in` : 'later than that'}`;
function PolicyText({ p }) {
  if (!p) return <p className="muted">Loading policies…</p>;
  return (
    <ul className="policy-list">
      {p.depositPercent != null && <li>A deposit of <b>{p.depositPercent}%</b> is paid online to confirm the booking; the rest is paid at the front desk at check-out.</li>}
      {[...p.cancellationTiers].sort((x, y) => y.minHoursBeforeCheckIn - x.minHoursBeforeCheckIn).map((t) => <li key={t.minHoursBeforeCheckIn}>{tierText(t)}.</li>)}
      <li>Check-in from <b>{p.checkInTime}</b>{p.checkOutTime && <>, check-out by <b>{p.checkOutTime}</b></>}.</li>
    </ul>
  );
}

function Offers() {
  const p = usePolicies();
  const promos = usePromos();
  return (
    <div className="c-wrap c-section narrow">
      <h1 className="title">Booking policies</h1>
      <div className="panel"><h2>Deposit &amp; cancellation</h2><PolicyText p={p} /></div>
      {promos.length > 0 && <div className="panel mt"><h2>Promo codes</h2><ul className="policy-list">{promos.map((c) => <li key={c.code}><b>{c.code}</b>: {c.discountValue}% off{c.minimumSpend ? ` stays from ${money(c.minimumSpend)}` : ''}, valid until {new Date(c.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}. Enter it at checkout.</li>)}</ul></div>}
    </div>
  );
}

// Room-type card shape used by the room list, detail and checkout pages.
const toCard = (rt) => ({
  id: rt._id, _id: rt._id, name: rt.name, price: rt.basePrice, guests: rt.maxOccupancy,
  bed: rt.bedType || '', size: rt.roomSizeSqm || null, rating: rt.rating || null, amenities: rt.amenities || [],
  img: rt.images?.[0] || '',
  desc: rt.description || '', cat: rt.name.toLowerCase().includes('suite') ? 'suite' : 'standard',
});

const Confirmation = ({ q }) => (
  <div className="c-wrap c-section center">
    <p className="done" aria-hidden="true">✓</p>
    <h1 className="title">Booking confirmed</h1>
    <p className="muted">Your booking code is <strong>{q.ref || 'confirmed'}</strong>. A confirmation email is on its way.</p>
    <p><a className="btn primary" href="#/my-bookings">View my bookings</a></p>
  </div>
);

function Auth({ note }) {
  const [mode, setMode] = useState('login');
  const [resetSuccess, setResetSuccess] = useState(null);
  const { user, signOut } = useAuth();
  const done = () => { location.hash = sessionStorage.getItem('next') || '#/my-bookings'; sessionStorage.removeItem('next'); };
  if (user) {
    return (
      <AuthShell>
        <h1>Already signed in</h1>
        <p className="muted">You are currently signed in as <strong>{user.customerProfile?.fullName || user.fullName || user.email}</strong>.</p>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
          <button className="btn primary" onClick={done}>Go to My bookings</button>
          <button className="btn" style={{ color: "#d32f2f", borderColor: "#d32f2f", background: "transparent" }} onClick={async () => { await signOut(); location.hash = "#/login"; }}>Sign out</button>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <h1>{mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Create your account' : 'Reset password'}</h1>
      <p className="muted">
        {mode === 'login' ? 'Sign in to manage your bookings.' : mode === 'register' ? 'Book faster and keep every stay in one place.' : 'Enter your details to reset your password.'}
      </p>
      {mode !== 'forgot' && <AuthTabs mode={mode} onChange={(m) => { setMode(m); setResetSuccess(null); }} />}
      {resetSuccess && <p role="status" className="note ok-note">{resetSuccess}</p>}
      {note && <p className="note">{note}</p>}
      {mode === 'login' && <SignIn onDone={done} onForgot={() => { setMode('forgot'); setResetSuccess(null); }} />}
      {mode === 'register' && <Register onDone={(email) => { setMode('login'); setResetSuccess(`Account created. We sent a verification link to ${email}. Open it, then sign in.`); }} />}
      {mode === 'forgot' && (
        <ForgotPassword
          onDone={() => {
            setMode('login');
            setResetSuccess('Password has been reset successfully. Please sign in with your new password.');
          }}
          onCancel={() => setMode('login')}
        />
      )}
    </AuthShell>
  );
}

// Target of the link in the verification email: #/verify-email?token=…&email=…
function VerifyEmail({ token, email }) {
  const [state, setState] = useState({ busy: true });
  useEffect(() => {
    api('/auth/verify-email', { method: 'POST', body: { token: token || '', ...(email ? { email } : {}) } })
      .then((r) => setState({ ok: r.data.message }))
      .catch((x) => setState({ error: x }));
  }, [token, email]);
  return (
    <AuthShell>
      <h1>Email verification</h1>
      {state.busy ? <p className="muted">Verifying your email…</p> : <Notice error={state.error} ok={state.ok} />}
      {state.error && <p className="muted">If the link expired, try signing in and choose "Resend verification email".</p>}
      <p><a className="btn primary" href="#/login">Go to sign in</a></p>
    </AuthShell>
  );
}

function SiteFooter() {
  const hotel = useHotel();
  return (
    <footer className="site-foot">
      <div className="c-wrap c-grid g4">
        <div><a className="brand" href="#/">Grand<span>Stay</span></a>{hotel?.description && <p>{hotel.description}</p>}</div>
        <div><h4>Explore</h4><a href="#/rooms">Rooms &amp; suites</a><a href="#/offers">Booking policies</a><a href="#/my-bookings">My bookings</a></div>
        <div><h4>Guests</h4><a href="#/login">Sign in or register</a><a href="#/profile">My profile</a></div>
        <div><h4>Contact</h4>{hotel?.address && <p>{hotel.address}</p>}{hotel?.email && <p>{hotel.email}</p>}{hotel?.phone && <p>{hotel.phone}</p>}<a href="#/admin">Staff portal</a></div>
      </div>
      {hotel?.name && <p className="copy">© {new Date().getFullYear()} {hotel.name}</p>}
    </footer>
  );
}

const PROTECTED = ['#/checkout', '#/confirmation', '#/my-bookings', '#/profile'];

export default function Customer({ route }) {
  const { user, loading } = useAuth();
  const [path, q] = parse(route);

  let page;
  if (loading) page = <p className="muted c-wrap c-section">Loading…</p>;
  else if ((PROTECTED.includes(path) || path.startsWith('#/pay/')) && !user) { sessionStorage.setItem('next', route); page = <Auth note="Please sign in to continue." />; }
  else if (path === '#/profile') page = <div className="c-wrap c-section"><Profile /></div>;
  else
  if (path === '#/pay/result') page = <PaymentResult paymentId={q.payment} back={q.r} />;
  else if (path.startsWith('#/pay/sandbox/')) page = <SandboxGateway orderId={path.split('/')[3]} paymentId={q.payment} />;
  else if (path.startsWith('#/pay/')) page = <PaymentPage id={path.split('/')[2]} kind={q.kind} />;
  else if (path.startsWith('#/room/')) page = <RoomDetail id={path.split('/')[2]} q={q} />;
  else if (path === '#/rooms') page = <Rooms q={q} />;
  else if (path === '#/offers') page = <Offers />;
  else if (path === '#/checkout') page = <Checkout q={q} user={user} />;
  else if (path === '#/confirmation') page = <Confirmation q={q} />;
  else if (path === '#/my-bookings') page = <MyBookings />;
  else if (path === '#/login') page = <Auth />;
  else if (path === '#/verify-email') page = <VerifyEmail token={q.token} email={q.email} />;
  else page = <Home />;

  return (
    <div className="cx">
      <a className="skip" href="#main">Skip to content</a>
      <SiteHeader route={route} />
      <main id="main">{page}</main>
      <SiteFooter />
    </div>
  );
}
